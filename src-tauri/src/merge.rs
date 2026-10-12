//! 병합 요청을 검증해 pdf-core 요청으로 바꾸고 실행한다.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use pdf_core::PdfEngine;

use crate::access::{PDF_EXTENSION, PathAccess};
use crate::contract::{MergeOutput, MergeProgress, MergeRequest, MergeResult, count};
use crate::error::CommandError;

/// - 소스는 허용 경로 목록(또는 앱 폴더) 안의 PDF만 받는다.
/// - 출력은 `temp`면 앱 임시 폴더의 새 이름, `userPath`면 저장 다이얼로그에서 고른 경로만 받는다.
/// - 출력 경로가 소스 중 하나이거나 열어 둔 원본이면(canonical 비교) 거부한다. 원본을 덮지 않기 위해서다.
/// - 소스 수 상한·페이지 범위·취소·원자적 저장은 pdf-core가 맡는다.
pub(crate) fn merge(
    engine: &PdfEngine,
    access: &PathAccess,
    request: &MergeRequest,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(MergeProgress),
) -> Result<MergeResult, CommandError> {
    let sources = request
        .sources
        .iter()
        .map(|source| {
            Ok(pdf_core::MergeSource {
                path: access.readable(&source.path, &[PDF_EXTENSION])?,
                pages: source
                    .pages
                    .iter()
                    .map(|page| pdf_core::MergePage {
                        // u32 → usize는 지원하는 플랫폼(32·64비트)에서 실패하지 않는다.
                        // 실패하면 최댓값이 되어 pdf-core가 페이지 범위 오류로 거부한다.
                        index: usize::try_from(page.index).unwrap_or(usize::MAX),
                        rotation: page.rotation.into(),
                    })
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>, CommandError>>()?;
    let output_path = resolve_output(access, &request.output)?;
    if access.is_opened(&output_path) || sources.iter().any(|source| source.path == output_path) {
        return Err(CommandError::OutputIsSource { path: output_path });
    }

    let core_request = pdf_core::MergeRequest {
        sources,
        output_path,
    };
    let result = pdf_core::merge_pdfs(engine, &core_request, cancel, |progress| {
        on_progress(progress.into());
    })?;
    Ok(MergeResult {
        output_path: core_request.output_path,
        page_count: count(result.page_count),
    })
}

fn resolve_output(access: &PathAccess, output: &MergeOutput) -> Result<PathBuf, CommandError> {
    match output {
        MergeOutput::Temp => access.new_temp_output(),
        MergeOutput::UserPath { path } => access.save_target(path),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::Ordering;

    use super::*;
    use crate::contract::{MergePage, MergeSource, MergeStage, Rotation};
    use crate::test_support::{TestDir, engine, entries};

    const JOB_ID: &str = "job";

    fn whole_document(path: &Path, page_count: u32) -> MergeSource {
        MergeSource {
            path: path.to_path_buf(),
            pages: (0..page_count)
                .map(|index| MergePage {
                    index,
                    rotation: Rotation::Degrees0,
                })
                .collect(),
        }
    }

    fn request(sources: Vec<MergeSource>, output: MergeOutput) -> MergeRequest {
        MergeRequest {
            job_id: JOB_ID.to_owned(),
            sources,
            output,
        }
    }

    fn run(access: &PathAccess, request: &MergeRequest) -> Result<MergeResult, CommandError> {
        merge(engine(), access, request, &AtomicBool::new(false), |_| {})
    }

    #[test]
    fn output_equal_to_a_source_is_rejected_and_the_source_is_untouched() {
        let test_dir = TestDir::new("merge-output-is-source");
        let access = test_dir.access();
        let source = test_dir.copy_fixture("three-pages.pdf", "contract.pdf");
        let original_bytes = fs::read(&source).expect("read source");
        access.allow_opened(&source).expect("pick source");
        access
            .allow_save_target(&source)
            .expect("pick same path to save");

        let error = run(
            &access,
            &request(
                vec![whole_document(&source, 3)],
                MergeOutput::UserPath {
                    path: source.clone(),
                },
            ),
        )
        .unwrap_err();

        assert_eq!(error.code(), "OUTPUT_IS_SOURCE");
        assert_eq!(fs::read(&source).expect("read source"), original_bytes);
    }

    #[test]
    fn output_equal_to_an_opened_original_that_is_not_a_source_is_rejected() {
        let test_dir = TestDir::new("merge-output-is-opened");
        let access = test_dir.access();
        let opened = test_dir.copy_fixture("three-pages.pdf", "opened.pdf");
        let source = test_dir.copy_fixture("one-page.pdf", "source.pdf");
        let original_bytes = fs::read(&opened).expect("read opened");
        access.allow_opened(&opened).expect("pick opened");
        access.allow_opened(&source).expect("pick source");
        access
            .allow_save_target(&opened)
            .expect("pick opened path to save");

        let error = run(
            &access,
            &request(
                vec![whole_document(&source, 1)],
                MergeOutput::UserPath {
                    path: opened.clone(),
                },
            ),
        )
        .unwrap_err();

        assert_eq!(error.code(), "OUTPUT_IS_SOURCE");
        assert_eq!(fs::read(&opened).expect("read opened"), original_bytes);
    }

    #[test]
    fn user_output_must_be_picked_in_the_save_dialog() {
        let test_dir = TestDir::new("merge-output-not-picked");
        let access = test_dir.access();
        let source = test_dir.copy_fixture("one-page.pdf", "source.pdf");
        access.allow_opened(&source).expect("pick source");
        let output = test_dir.user("merged.pdf");

        let error = run(
            &access,
            &request(
                vec![whole_document(&source, 1)],
                MergeOutput::UserPath {
                    path: output.clone(),
                },
            ),
        )
        .unwrap_err();

        assert_eq!(error.code(), "PATH_NOT_ALLOWED");
        assert!(!output.exists());
    }

    #[test]
    fn temp_output_is_written_inside_the_app_temp_folder() {
        let test_dir = TestDir::new("merge-temp-output");
        let access = test_dir.access();
        let first = test_dir.copy_fixture("one-page.pdf", "first.pdf");
        let second = test_dir.copy_fixture("three-pages.pdf", "second.pdf");
        access.allow_opened(&first).expect("pick");
        access.allow_opened(&second).expect("pick");

        let result = run(
            &access,
            &request(
                vec![whole_document(&first, 1), whole_document(&second, 3)],
                MergeOutput::Temp,
            ),
        )
        .expect("merge");

        assert_eq!(result.page_count, 4);
        assert_eq!(
            result.output_path.parent(),
            Some(access.directories().temp.as_path())
        );
        assert!(result.output_path.is_file());
    }

    #[test]
    fn cancelled_merge_leaves_no_file_in_the_app_temp_folder() {
        let test_dir = TestDir::new("merge-cancel");
        let access = test_dir.access();
        let source = test_dir.copy_fixture("thirty-pages.pdf", "long.pdf");
        access.allow_opened(&source).expect("pick");
        let cancel = AtomicBool::new(false);

        let error = merge(
            engine(),
            &access,
            &request(vec![whole_document(&source, 30)], MergeOutput::Temp),
            &cancel,
            |progress| {
                // 사용자가 페이지 합치기 도중 "취소"를 누른 것과 같다.
                if matches!(progress.stage, MergeStage::MergePages) && progress.done > 0 {
                    cancel.store(true, Ordering::Relaxed);
                }
            },
        )
        .unwrap_err();

        assert_eq!(error.code(), "CANCELLED");
        assert!(entries(&access.directories().temp).is_empty());
    }
}
