//! 비교 리포트 내보내기 요청을 검증해 pdf-core 리포트 API(ADR 0001 §14)에 넘긴다. 규칙은 ADR 0001 §17
//! "리포트 커맨드"다.
//!
//! - 결과는 프론트가 비교 커맨드에서 받은 계약 JSON을 그대로 다시 보낸다. 앱은 결과를 따로 두지 않는다.
//! - A·B는 허용 경로 목록(또는 앱 폴더) 안의 PDF만 받는다. 출력은 폴더 다이얼로그에서 고른 폴더 바로 안의
//!   새 이름이다(같은 이름이 있으면 번호를 붙여 덮지 않는다). 출력이 비교한 파일이면 pdf-core가
//!   `OUTPUT_IS_SOURCE`로 거부하는 것이 마지막 방어선이다.
//! - 미리보기 PNG는 base64 문자열로 보낸다. 프론트가 `data:` URL로 바로 그린다(CSP `img-src data:`).

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use base64::prelude::{BASE64_STANDARD, Engine};
use pdf_core::{PdfEngine, ReportSources};

use crate::access::{PDF_EXTENSION, PathAccess};
use crate::contract::{
    ExportAnnotatedPdfRequest, ExportComparePdfRequest, ExportedFile, PreviewCompareReportRequest,
    ReportPreview, core_kinds,
};
use crate::error::CommandError;
use crate::files::file_name_of;

/// 미리보기로 그리는 앞쪽 장 수. 모달에서 넘겨 보는 범위이고, 옵션을 바꿀 때마다 다시 그리므로 작게 둔다
/// (연결선 픽스처 장 하나를 720px로 그리는 데 debug 빌드 약 30 ms).
const PREVIEW_SHEETS: u32 = 8;

/// 비교 PDF를 고른 폴더에 만든다. 취소는 `cancel_job(request.jobId)`로 하고, 취소되면 파일이 남지 않는다.
pub(crate) fn export_compare_pdf(
    engine: &PdfEngine,
    access: &PathAccess,
    request: ExportComparePdfRequest,
    cancel: &AtomicBool,
) -> Result<ExportedFile, CommandError> {
    let sources = readable_sources(access, &request.before, &request.after)?;
    let output = access.export_target(&request.output.directory, &request.output.file_name)?;
    pdf_core::export_compare_pdf(
        engine,
        &request.result.into(),
        &sources,
        &request.options.into(),
        &output,
        cancel,
    )?;
    Ok(exported(output))
}

/// B 사본에 차이를 주석으로 단 PDF를 고른 폴더에 만든다. 원본 B는 읽기만 한다.
pub(crate) fn export_annotated_pdf(
    engine: &PdfEngine,
    access: &PathAccess,
    request: ExportAnnotatedPdfRequest,
    cancel: &AtomicBool,
) -> Result<ExportedFile, CommandError> {
    let after = access.readable(&request.after, &[PDF_EXTENSION])?;
    let output = access.export_target(&request.output.directory, &request.output.file_name)?;
    pdf_core::export_annotated_pdf(
        engine,
        &request.result.into(),
        &after,
        &core_kinds(request.hidden_kinds),
        &output,
        cancel,
    )?;
    Ok(exported(output))
}

/// 같은 옵션으로 만들 비교 PDF의 앞 [`PREVIEW_SHEETS`]장을 그린다. 파일은 쓰지 않는다. 넣을 장이 없으면
/// `EMPTY_REPORT`다.
pub(crate) fn preview_compare_report(
    engine: &PdfEngine,
    access: &PathAccess,
    request: PreviewCompareReportRequest,
) -> Result<ReportPreview, CommandError> {
    let sources = readable_sources(access, &request.before, &request.after)?;
    let preview = pdf_core::preview_compare_report(
        engine,
        &request.result.into(),
        &sources,
        &request.options.into(),
        PREVIEW_SHEETS,
        request.width_px,
    )?;
    Ok(ReportPreview {
        sheet_count: preview.sheet_count,
        images: preview
            .images
            .iter()
            .map(|png| BASE64_STANDARD.encode(png))
            .collect(),
    })
}

fn readable_sources(
    access: &PathAccess,
    before: &Path,
    after: &Path,
) -> Result<ReportSources, CommandError> {
    Ok(ReportSources {
        before: access.readable(before, &[PDF_EXTENSION])?,
        after: access.readable(after, &[PDF_EXTENSION])?,
    })
}

fn exported(output_path: PathBuf) -> ExportedFile {
    ExportedFile {
        file_name: file_name_of(&output_path),
        output_path,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use super::*;
    use crate::compare::{CompareState, compare};
    use crate::contract::{
        ChangeKind, CompareOptions, CompareReportOptions, CompareRequest, CompareResult,
        ExportOutput, ReportLayout,
    };
    use crate::error::{AppError, ErrorCode};
    use crate::test_support::{TestDir, engine, entries};

    const FILE_NAME: &str = "contract_v1-v2_비교.pdf";
    const PREVIEW_WIDTH_PX: u32 = 320;
    const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    /// 첫 청크(IHDR)의 너비(빅엔디언 4바이트) 자리
    const PNG_WIDTH_OFFSET: usize = 16;

    fn compare_options() -> CompareOptions {
        CompareOptions {
            range_a: String::new(),
            range_b: String::new(),
            exclude_header: false,
            exclude_footer: false,
            exclude_page_numbers: false,
            ignore_case: false,
        }
    }

    fn report_options() -> CompareReportOptions {
        CompareReportOptions {
            layout: ReportLayout::SideBySide,
            changed_pages_only: false,
            draw_boxes: true,
            hidden_kinds: Vec::new(),
        }
    }

    /// 비교 커맨드가 프론트에 보낸 결과(계약 JSON)
    fn compared(test_dir: &TestDir, access: &PathAccess, before: &Path, after: &Path) -> String {
        let result = compare(
            engine(),
            access,
            &CompareState::new(None, test_dir.user("ocr-cache")),
            &CompareRequest {
                job_id: "compare".to_owned(),
                before: before.to_path_buf(),
                after: after.to_path_buf(),
                options: compare_options(),
            },
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("compare");
        serde_json::to_string(&result).expect("serialize contract result")
    }

    fn received(json: &str) -> CompareResult {
        serde_json::from_str(json).expect("deserialize contract result")
    }

    /// 프론트가 비교 결과 JSON을 그대로 돌려보내면 pdf-core가 직접 만든 결과와 같은 모델이 된다. 회전 쪽
    /// (90·180·270)·CropBox 오프셋(text-geometry), 변경 상자, 짝 없는 행, 빈 쪽 안내(pages-insert)가 다 든
    /// 결과로 본다.
    #[test]
    fn compare_result_sent_back_by_the_front_equals_the_pdf_core_result() {
        let test_dir = TestDir::new("report-result-round-trip");
        let access = test_dir.access();
        let before = access
            .allow_opened(&test_dir.copy_fixture("text-geometry.pdf", "before.pdf"))
            .expect("pick before");
        let after = access
            .allow_opened(&test_dir.copy_fixture("pages-insert.pdf", "after.pdf"))
            .expect("pick after");

        let json = compared(&test_dir, &access, &before, &after);
        let core = pdf_core::compare_pdfs(
            engine(),
            &pdf_core::CompareRequest {
                job_id: "core".to_owned(),
                before,
                after,
                options: pdf_core::CompareOptions::default(),
            },
            None,
            None,
            &pdf_core::ExtractionCache::new(),
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("compare in pdf-core");

        assert!(!core.changes.is_empty() && !core.notices.is_empty());
        assert!(core.page_sizes.before.iter().any(|size| {
            size.rotation == pdf_core::PageRotation::Degrees90 && size.view_box.left != 0.0
        }));
        assert!(core.page_pairs.iter().any(|(before, _)| before.is_none()));
        assert_eq!(pdf_core::CompareResult::from(received(&json)), core);
    }

    /// 출력은 폴더 다이얼로그에서 고른 폴더 바로 안의 새 이름이다. 같은 이름의 파일이 있으면(사용자 파일이든
    /// 앞서 내보낸 파일이든) 덮지 않고 번호를 붙인다. 고르지 않은 폴더, 경로가 섞인 이름, 고르지 않은 원본은
    /// 아무것도 쓰지 않고 거부한다.
    #[test]
    fn exports_never_overwrite_files_and_stay_in_the_picked_folder() {
        let test_dir = TestDir::new("report-export-target");
        let access = test_dir.access();
        let before = test_dir.copy_fixture("diff-base.pdf", "before.pdf");
        let after = test_dir.copy_fixture("diff-edit.pdf", "after.pdf");
        access.allow_opened(&after).expect("pick after");
        let folder = test_dir.user("exports");
        fs::create_dir(&folder).expect("create export folder");
        let existing = folder.join(FILE_NAME);
        fs::write(&existing, b"user file").expect("write user file");
        let output = |file_name: &str| ExportOutput {
            directory: folder.clone(),
            file_name: file_name.to_owned(),
        };
        let export_compare = |access: &PathAccess, output: ExportOutput, json: &str| {
            export_compare_pdf(
                engine(),
                access,
                ExportComparePdfRequest {
                    job_id: "export".to_owned(),
                    result: received(json),
                    before: before.clone(),
                    after: after.clone(),
                    options: report_options(),
                    output,
                },
                &AtomicBool::new(false),
            )
        };
        let code = |result: Result<ExportedFile, CommandError>| {
            AppError::from(result.expect_err("rejected")).code
        };

        access.allow_opened(&before).expect("pick before");
        let json = compared(&test_dir, &access, &before, &after);
        let not_picked_folder = code(export_compare(&access, output(FILE_NAME), &json));
        let picked = access.allow_save_directory(&folder).expect("pick folder");
        let first = export_compare(&access, output(FILE_NAME), &json).expect("export");
        let annotated = export_annotated_pdf(
            engine(),
            &access,
            ExportAnnotatedPdfRequest {
                job_id: "annotate".to_owned(),
                result: received(&json),
                after: after.clone(),
                hidden_kinds: vec![ChangeKind::Delete],
                output: output(FILE_NAME),
            },
            &AtomicBool::new(false),
        )
        .expect("export annotated");
        let escaping_name = code(export_compare(
            &access,
            output(&format!("..{}{FILE_NAME}", std::path::MAIN_SEPARATOR)),
            &json,
        ));
        let other_access = test_dir.access();
        other_access.allow_opened(&after).expect("pick only after");
        other_access
            .allow_save_directory(&folder)
            .expect("pick folder");
        let not_picked_source = code(export_compare(&other_access, output("a.pdf"), &json));

        assert_eq!(not_picked_folder, ErrorCode::PathNotAllowed);
        assert_eq!(escaping_name, ErrorCode::PathNotAllowed);
        assert_eq!(not_picked_source, ErrorCode::PathNotAllowed);
        assert_eq!(fs::read(&existing).expect("read user file"), b"user file");
        assert_eq!(first.file_name, "contract_v1-v2_비교 (2).pdf");
        assert_eq!(first.output_path, picked.join(&first.file_name));
        assert_eq!(annotated.file_name, "contract_v1-v2_비교 (3).pdf");
        assert_eq!(
            entries(&folder),
            [
                "contract_v1-v2_비교 (2).pdf",
                "contract_v1-v2_비교 (3).pdf",
                FILE_NAME
            ]
        );
    }

    /// 미리보기 그림은 표준 base64로 쓴 PNG라 프론트가 `data:image/png;base64,`로 그대로 그린다. 넣을 장이
    /// 없으면(차이 쪽만 + 모든 종류 숨김) `EMPTY_REPORT`다.
    #[test]
    fn preview_sends_standard_base64_pngs_and_empty_report_code() {
        let test_dir = TestDir::new("report-preview");
        let access = test_dir.access();
        let before = access
            .allow_opened(&test_dir.copy_fixture("pages-base.pdf", "before.pdf"))
            .expect("pick before");
        let after = access
            .allow_opened(&test_dir.copy_fixture("pages-insert.pdf", "after.pdf"))
            .expect("pick after");
        let json = compared(&test_dir, &access, &before, &after);
        let preview = |options: CompareReportOptions| {
            preview_compare_report(
                engine(),
                &access,
                PreviewCompareReportRequest {
                    result: received(&json),
                    before: before.clone(),
                    after: after.clone(),
                    options,
                    width_px: PREVIEW_WIDTH_PX,
                },
            )
        };

        let shown = preview(report_options()).expect("preview");
        let empty = preview(CompareReportOptions {
            changed_pages_only: true,
            hidden_kinds: vec![ChangeKind::Insert, ChangeKind::Delete, ChangeKind::Replace],
            ..report_options()
        });

        assert_eq!(shown.sheet_count as usize, received(&json).page_pairs.len());
        assert!(!shown.images.is_empty());
        for image in &shown.images {
            let png = BASE64_STANDARD.decode(image).expect("standard base64");
            assert_eq!(png[..PNG_SIGNATURE.len()], PNG_SIGNATURE);
            let width: [u8; 4] = png[PNG_WIDTH_OFFSET..PNG_WIDTH_OFFSET + 4]
                .try_into()
                .expect("IHDR width");
            assert_eq!(u32::from_be_bytes(width), PREVIEW_WIDTH_PX);
        }
        let error = AppError::from(empty.expect_err("nothing to show"));
        assert_eq!(error.code, ErrorCode::EmptyReport);
        assert_eq!(error.path, None);
    }
}
