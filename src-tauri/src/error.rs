//! 커맨드 에러. 프론트에는 `{ code, message, path }`로 간다.
//! 화면 문구는 프론트가 `code`로 고르고, `message`는 로그용이다.

use std::io;
use std::path::{Path, PathBuf};

use pdf_core::{DocumentError, MergeError, SaveError, TiffConversionError};
use serde::Serialize;

/// 화면 문구를 고르는 오류 코드. 직렬화 값(`PATH_NOT_ALLOWED` 등)이 바인딩의 문자열 union이 되고,
/// 변형의 이름이 바뀌어도 값은 유지한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ErrorCode {
    // src-tauri 커맨드
    PathNotAllowed,
    UnsupportedFileType,
    OutputIsSource,
    JobAlreadyRunning,
    InvalidDialogPath,
    EngineUnavailable,
    NotReady,
    TaskFailed,
    // pdf-core 문서 열기
    NotFound,
    FileUnreadable,
    InputTooLarge,
    InvalidPdf,
    PasswordProtected,
    PdfiumFailure,
    // pdf-core 저장
    OutputDirectoryNotFound,
    WriteFailed,
    // pdf-core 병합
    EmptyRequest,
    TooManyFiles,
    EmptySource,
    InvalidPage,
    Cancelled,
    // pdf-core TIFF 변환
    InvalidTiff,
    UnsupportedTiffCompression,
    UnsupportedTiffFormat,
    ImageTooLarge,
}

/// 커맨드가 프론트에 돌려주는 에러
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type, thiserror::Error)]
#[error("{code:?}: {message}")]
pub(crate) struct AppError {
    pub(crate) code: ErrorCode,
    pub(crate) message: String,
    /// 실패를 일으킨 입력 파일(pdf-core가 열다 실패한 문서 등). 알 수 없으면 `null`이다.
    /// 검증을 거친 canonical 경로라, 병합 소스면 `open_files`가 돌려준 `pdfPath`와 같다.
    pub(crate) path: Option<PathBuf>,
}

/// 커맨드 처리 중 생긴 실패. pdf-core 에러의 코드·입력 경로는 아래 `code()`·`input_path()`가 변형마다 고른다.
#[derive(Debug, thiserror::Error)]
pub(crate) enum CommandError {
    #[error("path is not in the allowed list: {path}")]
    PathNotAllowed { path: PathBuf },
    #[error("file type is not supported: {path}")]
    UnsupportedFileType { path: PathBuf },
    #[error("output path is one of the merge sources: {path}")]
    OutputIsSource { path: PathBuf },
    #[error("job is already running: {job_id}")]
    JobAlreadyRunning { job_id: String },
    #[error("dialog returned a path that is not a local file: {detail}")]
    InvalidDialogPath { detail: String },
    #[error("pdfium is not available")]
    EngineUnavailable,
    #[error("app state is not ready: {component}")]
    NotReady { component: &'static str },
    #[error("background task failed: {detail}")]
    TaskFailed { detail: String },
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error(transparent)]
    Save(#[from] SaveError),
    #[error(transparent)]
    Merge(#[from] MergeError),
    #[error(transparent)]
    Tiff(#[from] TiffConversionError),
}

impl CommandError {
    /// 직렬화·화면 문구 선택에 쓰는 코드. pdf-core 에러는 변형마다 짝을 지어 둬서,
    /// pdf-core에 변형이 늘면 여기서 컴파일이 멈춘다.
    pub(crate) fn code(&self) -> ErrorCode {
        match self {
            Self::PathNotAllowed { .. } => ErrorCode::PathNotAllowed,
            Self::UnsupportedFileType { .. } => ErrorCode::UnsupportedFileType,
            Self::OutputIsSource { .. } => ErrorCode::OutputIsSource,
            Self::JobAlreadyRunning { .. } => ErrorCode::JobAlreadyRunning,
            Self::InvalidDialogPath { .. } => ErrorCode::InvalidDialogPath,
            Self::EngineUnavailable => ErrorCode::EngineUnavailable,
            Self::NotReady { .. } => ErrorCode::NotReady,
            Self::TaskFailed { .. } => ErrorCode::TaskFailed,
            Self::Document(error) => document_code(error),
            Self::Save(error) => save_code(error),
            Self::Merge(error) => merge_code(error),
            Self::Tiff(error) => tiff_code(error),
        }
    }

    /// 실패를 일으킨 입력 파일. pdf-core가 문서를 열거나 TIFF를 읽다 실패했을 때만 안다.
    /// 출력(저장) 쪽 실패와 커맨드 자체의 거부는 `None`이다.
    fn input_path(&self) -> Option<&Path> {
        match self {
            Self::Document(error) => Some(document_path(error)),
            Self::Merge(error) => merge_input_path(error),
            Self::Tiff(error) => tiff_input_path(error),
            Self::PathNotAllowed { .. }
            | Self::UnsupportedFileType { .. }
            | Self::OutputIsSource { .. }
            | Self::JobAlreadyRunning { .. }
            | Self::InvalidDialogPath { .. }
            | Self::EngineUnavailable
            | Self::NotReady { .. }
            | Self::TaskFailed { .. }
            | Self::Save(_) => None,
        }
    }
}

impl From<CommandError> for AppError {
    fn from(error: CommandError) -> Self {
        Self {
            code: error.code(),
            path: error.input_path().map(Path::to_path_buf),
            message: error.to_string(),
        }
    }
}

fn document_code(error: &DocumentError) -> ErrorCode {
    match error {
        DocumentError::NotFound { .. } => ErrorCode::NotFound,
        DocumentError::Unreadable { .. } => ErrorCode::FileUnreadable,
        DocumentError::InputTooLarge { .. } => ErrorCode::InputTooLarge,
        DocumentError::InvalidPdf { .. } => ErrorCode::InvalidPdf,
        DocumentError::PasswordProtected { .. } => ErrorCode::PasswordProtected,
        DocumentError::Pdfium { .. } => ErrorCode::PdfiumFailure,
    }
}

fn save_code(error: &SaveError) -> ErrorCode {
    match error {
        SaveError::DirectoryNotFound { .. } => ErrorCode::OutputDirectoryNotFound,
        SaveError::Write { .. } => ErrorCode::WriteFailed,
        SaveError::Pdfium { .. } => ErrorCode::PdfiumFailure,
    }
}

fn merge_code(error: &MergeError) -> ErrorCode {
    match error {
        MergeError::EmptyRequest => ErrorCode::EmptyRequest,
        MergeError::TooManyFiles { .. } => ErrorCode::TooManyFiles,
        MergeError::EmptySource { .. } => ErrorCode::EmptySource,
        MergeError::InvalidPage { .. } => ErrorCode::InvalidPage,
        MergeError::Cancelled => ErrorCode::Cancelled,
        MergeError::Document(error) => document_code(error),
        MergeError::Save(error) => save_code(error),
    }
}

fn tiff_code(error: &TiffConversionError) -> ErrorCode {
    match error {
        TiffConversionError::InvalidTiff { .. } => ErrorCode::InvalidTiff,
        TiffConversionError::UnsupportedCompression { .. } => ErrorCode::UnsupportedTiffCompression,
        TiffConversionError::UnsupportedFormat { .. } => ErrorCode::UnsupportedTiffFormat,
        TiffConversionError::ImageTooLarge { .. } => ErrorCode::ImageTooLarge,
        TiffConversionError::Cancelled => ErrorCode::Cancelled,
        TiffConversionError::Document(error) => document_code(error),
        TiffConversionError::Save(error) => save_code(error),
    }
}

fn document_path(error: &DocumentError) -> &Path {
    match error {
        DocumentError::NotFound { path }
        | DocumentError::Unreadable { path, .. }
        | DocumentError::InputTooLarge { path, .. }
        | DocumentError::InvalidPdf { path }
        | DocumentError::PasswordProtected { path }
        | DocumentError::Pdfium { path, .. } => path,
    }
}

fn merge_input_path(error: &MergeError) -> Option<&Path> {
    match error {
        MergeError::EmptySource { path, .. } | MergeError::InvalidPage { path, .. } => Some(path),
        MergeError::Document(error) => Some(document_path(error)),
        MergeError::EmptyRequest
        | MergeError::TooManyFiles { .. }
        | MergeError::Cancelled
        | MergeError::Save(_) => None,
    }
}

fn tiff_input_path(error: &TiffConversionError) -> Option<&Path> {
    match error {
        TiffConversionError::InvalidTiff { path, .. }
        | TiffConversionError::UnsupportedCompression { path, .. }
        | TiffConversionError::UnsupportedFormat { path, .. }
        | TiffConversionError::ImageTooLarge { path, .. } => Some(path),
        TiffConversionError::Document(error) => Some(document_path(error)),
        TiffConversionError::Cancelled | TiffConversionError::Save(_) => None,
    }
}

/// 경로를 읽다 난 I/O 에러를 pdf-core와 같은 코드(`NOT_FOUND`/`FILE_UNREADABLE`)로 바꾼다.
pub(crate) fn read_error(path: &Path, source: io::Error) -> CommandError {
    let path = path.to_path_buf();
    let error = if source.kind() == io::ErrorKind::NotFound {
        DocumentError::NotFound { path }
    } else {
        DocumentError::Unreadable { path, source }
    };
    CommandError::Document(error)
}

/// 앱 폴더 안 파일을 지우거나 쓰다 난 I/O 에러
pub(crate) fn write_error(path: &Path, source: io::Error) -> CommandError {
    CommandError::Save(SaveError::Write {
        path: path.to_path_buf(),
        source,
    })
}
