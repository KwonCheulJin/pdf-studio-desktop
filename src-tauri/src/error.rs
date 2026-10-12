//! 커맨드 에러. 프론트에는 `{ code, message }`로 간다.
//! 화면 문구는 프론트가 `code`로 고르고, `message`는 로그용이다.

use std::io;
use std::path::{Path, PathBuf};

use pdf_core::{DocumentError, MergeError, SaveError, TiffConversionError};
use serde::Serialize;

/// 커맨드가 프론트에 돌려주는 에러
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type, thiserror::Error)]
#[error("{code}: {message}")]
pub(crate) struct AppError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// 커맨드 처리 중 생긴 실패. pdf-core 에러는 그쪽 `code()`를 그대로 쓴다.
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
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드. 변형의 이름이 바뀌어도 값은 유지한다.
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::PathNotAllowed { .. } => "PATH_NOT_ALLOWED",
            Self::UnsupportedFileType { .. } => "UNSUPPORTED_FILE_TYPE",
            Self::OutputIsSource { .. } => "OUTPUT_IS_SOURCE",
            Self::JobAlreadyRunning { .. } => "JOB_ALREADY_RUNNING",
            Self::InvalidDialogPath { .. } => "INVALID_DIALOG_PATH",
            Self::EngineUnavailable => "ENGINE_UNAVAILABLE",
            Self::NotReady { .. } => "NOT_READY",
            Self::TaskFailed { .. } => "TASK_FAILED",
            Self::Document(error) => error.code(),
            Self::Save(error) => error.code(),
            Self::Merge(error) => error.code(),
            Self::Tiff(error) => error.code(),
        }
    }
}

impl From<CommandError> for AppError {
    fn from(error: CommandError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
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
