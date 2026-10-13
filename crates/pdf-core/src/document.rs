//! 경로로 PDF 문서를 열고, 열기 실패를 호출자가 구분할 수 있는 에러로 돌려준다.

use std::io;
use std::path::{Path, PathBuf};

use pdfium_render::prelude::{PdfDocument, Pdfium, PdfiumError, PdfiumInternalError};

/// 입력 PDF 한 개의 최대 크기 (512 MiB)
pub const MAX_INPUT_FILE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    #[error("file not found: {path}")]
    NotFound { path: PathBuf },
    #[error("file cannot be read: {path}: {source}")]
    Unreadable {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("file is {size_bytes} bytes, over the {limit_bytes} byte limit: {path}")]
    InputTooLarge {
        path: PathBuf,
        size_bytes: u64,
        limit_bytes: u64,
    },
    #[error("file is not a valid PDF: {path}")]
    InvalidPdf { path: PathBuf },
    #[error("PDF is password protected: {path}")]
    PasswordProtected { path: PathBuf },
    #[error("pdfium failed on {path}: {source}")]
    Pdfium {
        path: PathBuf,
        #[source]
        source: PdfiumError,
    },
}

impl DocumentError {
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드. 변형의 이름이 바뀌어도 값은 유지한다.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound { .. } => "NOT_FOUND",
            Self::Unreadable { .. } => "FILE_UNREADABLE",
            Self::InputTooLarge { .. } => "INPUT_TOO_LARGE",
            Self::InvalidPdf { .. } => "INVALID_PDF",
            Self::PasswordProtected { .. } => "PASSWORD_PROTECTED",
            Self::Pdfium { .. } => "PDFIUM_FAILURE",
        }
    }
}

/// 파일 크기를 먼저 확인한 뒤 암호 없이 문서를 연다. `pdfium`은 pdfium 잠금 세션
/// (`PdfEngine::session`)이 빌려 준 핸들이라, 열기와 실패 이유 읽기(`FPDF_GetLastError`) 사이에 다른
/// 스레드의 열기가 끼어들어 이유를 덮지 못한다(암호 문서가 `InvalidPdf`로 분류되던 문제).
pub(crate) fn open_document<'a>(
    pdfium: &'a Pdfium,
    path: &Path,
) -> Result<PdfDocument<'a>, DocumentError> {
    open_document_with_limit(pdfium, path, MAX_INPUT_FILE_BYTES)
}

fn open_document_with_limit<'a>(
    pdfium: &'a Pdfium,
    path: &Path,
    limit_bytes: u64,
) -> Result<PdfDocument<'a>, DocumentError> {
    ensure_within_limit(path, limit_bytes)?;
    pdfium
        .load_pdf_from_file(path, None)
        .map_err(|source| classify_open_error(path, source))
}

pub(crate) fn ensure_within_limit(path: &Path, limit_bytes: u64) -> Result<(), DocumentError> {
    let size_bytes = std::fs::metadata(path)
        .map_err(|source| classify_io_error(path, source))?
        .len();
    if size_bytes > limit_bytes {
        return Err(DocumentError::InputTooLarge {
            path: path.to_path_buf(),
            size_bytes,
            limit_bytes,
        });
    }
    Ok(())
}

pub(crate) fn classify_io_error(path: &Path, source: io::Error) -> DocumentError {
    if source.kind() == io::ErrorKind::NotFound {
        DocumentError::NotFound {
            path: path.to_path_buf(),
        }
    } else {
        DocumentError::Unreadable {
            path: path.to_path_buf(),
            source,
        }
    }
}

fn classify_open_error(path: &Path, source: PdfiumError) -> DocumentError {
    let path = path.to_path_buf();
    match source {
        PdfiumError::IoError(source) => classify_io_error(&path, source),
        PdfiumError::PdfiumLibraryInternalError(
            PdfiumInternalError::PasswordError | PdfiumInternalError::SecurityError,
        ) => DocumentError::PasswordProtected { path },
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::FormatError) => {
            DocumentError::InvalidPdf { path }
        }
        source => DocumentError::Pdfium { path, source },
    }
}
