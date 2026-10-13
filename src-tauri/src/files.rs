//! 파일 커맨드의 처리. 경로는 모두 `PathAccess`로 검증한 뒤 pdf-core에 넘긴다.
//! Tauri 런타임 없이 테스트할 수 있게 엔진과 허용 목록을 인자로 받는다.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use pdf_core::{DocumentError, MAX_INPUT_FILE_BYTES, PdfEngine, convert_tiff, read_pdf_info};

use crate::access::{OPENABLE_EXTENSIONS, PDF_EXTENSION, PathAccess, is_tiff};
use crate::contract::{OpenedFile, PdfInfo, byte_count};
use crate::error::{CommandError, read_error, write_error};

/// 파일마다 확장자 판별 → (TIFF면 캐시 폴더로 변환) → 정보 조회를 한다.
/// 한 파일이 실패해도 나머지는 계속하고, 입력 순서대로 파일별 결과를 돌려준다(B16).
pub(crate) fn open_files(
    engine: &PdfEngine,
    access: &PathAccess,
    paths: &[PathBuf],
) -> Vec<OpenedFile> {
    paths
        .iter()
        .map(|path| match open_file(engine, access, path) {
            Ok(opened) => opened,
            Err(error) => OpenedFile::Failed {
                source_path: path.clone(),
                error: error.into(),
            },
        })
        .collect()
}

fn open_file(
    engine: &PdfEngine,
    access: &PathAccess,
    path: &Path,
) -> Result<OpenedFile, CommandError> {
    let canonical = access.readable(path, &OPENABLE_EXTENSIONS)?;
    let size_bytes = fs::metadata(&canonical)
        .map_err(|source| read_error(&canonical, source))?
        .len();
    let (pdf_path, display_name) = if is_tiff(&canonical) {
        // 파일 추가 중에는 취소하지 않는다.
        let never_cancelled = AtomicBool::new(false);
        let conversion = convert_tiff(
            engine,
            &canonical,
            &access.directories().converted,
            &never_cancelled,
        )?;
        (conversion.pdf_path, conversion.display_name)
    } else {
        let display_name = file_name_of(&canonical);
        (canonical, display_name)
    };
    let info = read_pdf_info(engine, &pdf_path)?;
    Ok(OpenedFile::Opened {
        source_path: path.to_path_buf(),
        pdf_path,
        display_name,
        size_bytes: byte_count(size_bytes),
        info: PdfInfo::from(info),
    })
}

/// pdf.js 표시용으로 PDF 바이트를 읽는다. 열기 다이얼로그에서 고른 파일이나 앱 폴더
/// (TIFF 변환 결과, 이 실행의 병합 미리보기) 안의 PDF만, 크기 상한 안에서 읽는다.
pub(crate) fn read_pdf(access: &PathAccess, path: &Path) -> Result<Vec<u8>, CommandError> {
    let canonical = access.readable(path, &[PDF_EXTENSION])?;
    let size_bytes = fs::metadata(&canonical)
        .map_err(|source| read_error(&canonical, source))?
        .len();
    if size_bytes > MAX_INPUT_FILE_BYTES {
        return Err(DocumentError::InputTooLarge {
            path: canonical,
            size_bytes,
            limit_bytes: MAX_INPUT_FILE_BYTES,
        }
        .into());
    }
    fs::read(&canonical).map_err(|source| read_error(&canonical, source))
}

/// 이 실행의 병합 미리보기 결과를 저장 다이얼로그에서 고른 경로로 원자적으로 복사한다.
/// 대상이 사용자가 연 원본 파일이면 거부한다(원본은 덮어쓰지 않는다).
pub(crate) fn copy_file(
    access: &PathAccess,
    source: &Path,
    destination: &Path,
) -> Result<(), CommandError> {
    let source = access.temp_file(source)?;
    let destination = access.save_target(destination)?;
    if destination == source || access.is_opened(&destination) {
        return Err(CommandError::OutputIsSource { path: destination });
    }
    pdf_core::copy_atomically(&source, &destination)?;
    Ok(())
}

/// 이 실행의 세션 폴더 안의 파일 하나만 지운다(B4).
pub(crate) fn discard_temp(access: &PathAccess, path: &Path) -> Result<(), CommandError> {
    let file = access.temp_file(path)?;
    fs::remove_file(&file).map_err(|source| write_error(&file, source))
}

pub(crate) fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};

    use super::*;
    use crate::contract::OpenedFile;
    use crate::error::ErrorCode;
    use crate::test_support::{TestDir, engine, entries};

    fn error_code(opened: &OpenedFile) -> Option<ErrorCode> {
        match opened {
            OpenedFile::Opened { .. } => None,
            OpenedFile::Failed { error, .. } => Some(error.code),
        }
    }

    fn file_size(path: &Path) -> u64 {
        fs::metadata(path).expect("file metadata").len()
    }

    /// 크기만 상한을 넘는 희소 파일. 내용은 읽지 않으므로 디스크를 차지하지 않는다.
    fn oversized_file(path: &Path) {
        File::create(path)
            .and_then(|file| file.set_len(MAX_INPUT_FILE_BYTES + 1))
            .expect("create sparse file");
    }

    #[test]
    fn open_files_returns_a_result_for_every_file_in_order() {
        let test_dir = TestDir::new("open-files");
        let access = test_dir.access();
        let pdf = test_dir.copy_fixture("three-pages.pdf", "report.pdf");
        let tiff = test_dir.copy_fixture("multipage.tif", "scan.tif");
        let broken = test_dir.copy_fixture("not-a-pdf.pdf", "broken.pdf");
        let text = test_dir.user("notes.txt");
        fs::write(&text, "not a document").expect("write text");
        let oversized = test_dir.user("huge.pdf");
        oversized_file(&oversized);
        for path in [&pdf, &tiff, &broken, &text, &oversized] {
            access.allow_opened(path).expect("pick");
        }
        let not_picked = test_dir.copy_fixture("one-page.pdf", "not-picked.pdf");

        let paths = vec![
            pdf.clone(),
            not_picked,
            tiff.clone(),
            text,
            broken,
            oversized,
        ];
        let results = open_files(engine(), &access, &paths);

        let codes: Vec<_> = results.iter().map(error_code).collect();
        assert_eq!(
            codes,
            vec![
                None,
                Some(ErrorCode::PathNotAllowed),
                None,
                Some(ErrorCode::UnsupportedFileType),
                Some(ErrorCode::InvalidPdf),
                Some(ErrorCode::InputTooLarge),
            ]
        );
        let sources: Vec<_> = results
            .iter()
            .map(|result| match result {
                OpenedFile::Opened { source_path, .. } | OpenedFile::Failed { source_path, .. } => {
                    source_path.clone()
                }
            })
            .collect();
        assert_eq!(sources, paths);

        let OpenedFile::Opened {
            pdf_path,
            display_name,
            size_bytes,
            info,
            ..
        } = &results[0]
        else {
            panic!("pdf opens");
        };
        assert_eq!(pdf_path, &pdf.canonicalize().expect("canonical"));
        assert_eq!(display_name, "report.pdf");
        assert_eq!(u64::from(*size_bytes), file_size(&pdf));
        assert_eq!(info.page_count, 3);

        let OpenedFile::Opened {
            pdf_path,
            display_name,
            size_bytes,
            info,
            ..
        } = &results[2]
        else {
            panic!("tiff opens");
        };
        assert!(pdf_path.starts_with(&access.directories().converted));
        assert_eq!(display_name, "scan.pdf");
        // 화면에 보일 크기는 사용자가 고른 TIFF의 크기다(변환 결과 PDF가 아니다).
        assert_eq!(u64::from(*size_bytes), file_size(&tiff));
        assert_ne!(file_size(&tiff), file_size(pdf_path));
        assert_eq!(info.page_count, 3);
        assert!(tiff.exists());
    }

    #[test]
    fn read_pdf_reads_only_picked_files_within_the_size_limit() {
        let test_dir = TestDir::new("read-pdf");
        let access = test_dir.access();
        let not_picked = test_dir.copy_fixture("one-page.pdf", "not-picked.pdf");
        let oversized = test_dir.user("huge.pdf");
        oversized_file(&oversized);
        access.allow_opened(&oversized).expect("pick");

        let outside = read_pdf(&access, &not_picked).unwrap_err();
        let too_large = read_pdf(&access, &oversized).unwrap_err();

        assert_eq!(outside.code(), ErrorCode::PathNotAllowed);
        assert_eq!(too_large.code(), ErrorCode::InputTooLarge);
    }

    #[test]
    fn copy_file_takes_only_session_results_and_never_overwrites_an_opened_original() {
        let test_dir = TestDir::new("copy-file");
        let access = test_dir.access();
        let temp_result = access.directories().temp.join("merged.pdf");
        fs::write(&temp_result, b"%PDF-merged").expect("write temp result");
        let original = test_dir.copy_fixture("one-page.pdf", "original.pdf");
        let original_bytes = fs::read(&original).expect("read original");
        access.allow_opened(&original).expect("pick original");
        access
            .allow_save_target(&original)
            .expect("pick original to save");
        let destination = test_dir.user("saved.pdf");
        access
            .allow_save_target(&destination)
            .expect("pick destination");

        let outside = copy_file(&access, &original, &destination).unwrap_err();
        assert_eq!(outside.code(), ErrorCode::PathNotAllowed);
        assert!(!destination.exists());
        let overwrite = copy_file(&access, &temp_result, &original).unwrap_err();
        assert_eq!(overwrite.code(), ErrorCode::OutputIsSource);
        assert_eq!(fs::read(&original).expect("read original"), original_bytes);

        copy_file(&access, &temp_result, &destination).expect("copy");
        assert_eq!(fs::read(&destination).expect("read copy"), b"%PDF-merged");
    }

    #[test]
    fn discard_temp_deletes_only_files_inside_the_session_folder() {
        let test_dir = TestDir::new("discard-temp");
        let access = test_dir.access();
        let temp = access.directories().temp.clone();
        let outside = test_dir.copy_fixture("one-page.pdf", "keep.pdf");
        access.allow_opened(&outside).expect("pick");
        let traversal = temp.join("..").join("..").join("user").join("keep.pdf");
        let other_session = temp.with_file_name("session-other");
        fs::create_dir_all(&other_session).expect("create other session");
        let other_preview = other_session.join("preview.pdf");
        fs::write(&other_preview, b"%PDF").expect("write other preview");

        for path in [&outside, &traversal, &temp, &other_preview] {
            let error = discard_temp(&access, path).unwrap_err();
            assert_eq!(
                error.code(),
                ErrorCode::PathNotAllowed,
                "{}",
                path.display()
            );
        }
        #[cfg(unix)]
        {
            let link = temp.join("link.pdf");
            std::os::unix::fs::symlink(&outside, &link).expect("symlink");
            let error = discard_temp(&access, &link).unwrap_err();
            assert_eq!(error.code(), ErrorCode::PathNotAllowed);
            fs::remove_file(&link).expect("remove link");
        }
        assert!(outside.exists());
        assert!(other_preview.exists());

        let preview = temp.join("preview.pdf");
        fs::write(&preview, b"%PDF").expect("write preview");
        discard_temp(&access, &preview).expect("discard");
        assert!(entries(&temp).is_empty());
    }
}
