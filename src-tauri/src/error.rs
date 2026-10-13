//! 커맨드 에러. 프론트에는 `{ code, message, path }`로 간다.
//! 화면 문구는 프론트가 `code`로 고르고, `message`는 로그용이다.

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use pdf_core::{
    CompareError, CompareOptionsError, DocumentError, MergeError, ParagraphError, ReportError,
    SaveError, TiffConversionError,
};
use serde::Serialize;
use translate::{ApiError, ApiErrorCode, FailReason};

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
    ResourceUnavailable,
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
    // pdf-core 비교
    InvalidRange,
    // pdf-core 리포트 내보내기
    EmptyReport,
    ImageEncodeFailed,
    // pdf-core TIFF 변환
    InvalidTiff,
    UnsupportedTiffCompression,
    UnsupportedTiffFormat,
    ImageTooLarge,
    // 번역(ADR 0002 §11). API·네트워크 오류는 crates/translate `ApiErrorCode`와 짝이다.
    ApiKeyMissing,
    ApiKeyInvalid,
    ApiPermissionDenied,
    ApiBilling,
    ModelUnavailable,
    ApiRequestRejected,
    ApiRateLimited,
    ApiUnavailable,
    ApiTimeout,
    NetworkUnavailable,
    /// 문단·쪽 상태로만 쓴다(`TranslatedParagraph.failCode`·`TranslatedPage.failCode`).
    TranslationMismatch,
    TranslationTruncated,
    TranslationRefused,
    KeychainUnavailable,
    NoTranslatableText,
    SourceLanguageUnknown,
    TranslationRecordNotFound,
    GlossaryTooLarge,
}

impl fmt::Display for ErrorCode {
    /// 직렬화 값(`INVALID_PDF` 등) 그대로 쓴다. 로그 앞머리가 프론트가 받는 코드와 같다.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.serialize(formatter)
    }
}

/// 커맨드가 프론트에 돌려주는 에러
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type, thiserror::Error)]
#[error("{code}: {message}")]
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
    #[error("bundled resource is unavailable: {name}: {detail}")]
    ResourceUnavailable { name: &'static str, detail: String },
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error(transparent)]
    Save(#[from] SaveError),
    #[error(transparent)]
    Merge(#[from] MergeError),
    #[error(transparent)]
    Tiff(#[from] TiffConversionError),
    #[error(transparent)]
    Compare(#[from] CompareError),
    #[error(transparent)]
    Report(#[from] ReportError),
    #[error(transparent)]
    Paragraph(#[from] ParagraphError),
    /// 작업을 멈춘 API·네트워크 오류. 글은 코드·상태·오류 `type`·`request-id`뿐이다(ADR 0002 §12).
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error("job was cancelled")]
    Cancelled,
    #[error("API key is not in the keychain")]
    ApiKeyMissing,
    /// 받은 키 글은 담지 않는다.
    #[error("API key format is invalid")]
    ApiKeyInvalid,
    #[error("keychain is unavailable: {kind}")]
    KeychainUnavailable { kind: &'static str },
    #[error("settings could not be saved: {detail}")]
    SettingsUnavailable { detail: String },
    #[error("nothing to translate in the page range")]
    NoTranslatableText,
    #[error("source language could not be detected")]
    SourceLanguageUnknown,
    #[error("translation record or paragraph was not found")]
    TranslationRecordNotFound,
    #[error("glossary exceeds the limits")]
    GlossaryTooLarge,
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
            Self::ResourceUnavailable { .. } => ErrorCode::ResourceUnavailable,
            Self::Document(error) => document_code(error),
            Self::Save(error) => save_code(error),
            Self::Merge(error) => merge_code(error),
            Self::Tiff(error) => tiff_code(error),
            Self::Compare(error) => compare_code(error),
            Self::Report(error) => report_code(error),
            Self::Paragraph(error) => paragraph_code(error),
            Self::Api(error) => api_code(error.code),
            Self::Cancelled => ErrorCode::Cancelled,
            Self::ApiKeyMissing => ErrorCode::ApiKeyMissing,
            Self::ApiKeyInvalid => ErrorCode::ApiKeyInvalid,
            Self::KeychainUnavailable { .. } => ErrorCode::KeychainUnavailable,
            Self::SettingsUnavailable { .. } => ErrorCode::WriteFailed,
            Self::NoTranslatableText => ErrorCode::NoTranslatableText,
            Self::SourceLanguageUnknown => ErrorCode::SourceLanguageUnknown,
            Self::TranslationRecordNotFound => ErrorCode::TranslationRecordNotFound,
            Self::GlossaryTooLarge => ErrorCode::GlossaryTooLarge,
        }
    }

    /// 실패를 일으킨 입력 파일. pdf-core가 문서를 열거나 TIFF를 읽다 실패했을 때만 안다.
    /// 출력(저장) 쪽 실패와 커맨드 자체의 거부는 `None`이다.
    fn input_path(&self) -> Option<&Path> {
        match self {
            Self::Document(error) => Some(document_path(error)),
            Self::Merge(error) => merge_input_path(error),
            Self::Tiff(error) => tiff_input_path(error),
            Self::Compare(error) => compare_input_path(error),
            Self::Report(error) => report_input_path(error),
            Self::Paragraph(error) => paragraph_input_path(error),
            Self::PathNotAllowed { .. }
            | Self::UnsupportedFileType { .. }
            | Self::OutputIsSource { .. }
            | Self::JobAlreadyRunning { .. }
            | Self::InvalidDialogPath { .. }
            | Self::EngineUnavailable
            | Self::NotReady { .. }
            | Self::TaskFailed { .. }
            | Self::ResourceUnavailable { .. }
            | Self::Save(_)
            | Self::Api(_)
            | Self::Cancelled
            | Self::ApiKeyMissing
            | Self::ApiKeyInvalid
            | Self::KeychainUnavailable { .. }
            | Self::SettingsUnavailable { .. }
            | Self::NoTranslatableText
            | Self::SourceLanguageUnknown
            | Self::TranslationRecordNotFound
            | Self::GlossaryTooLarge => None,
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

fn compare_code(error: &CompareError) -> ErrorCode {
    match error {
        CompareError::Document(error) => document_code(error),
        CompareError::Options(CompareOptionsError::InvalidRange { .. }) => ErrorCode::InvalidRange,
        CompareError::Cancelled => ErrorCode::Cancelled,
    }
}

fn report_code(error: &ReportError) -> ErrorCode {
    match error {
        ReportError::OutputIsSource { .. } => ErrorCode::OutputIsSource,
        ReportError::InvalidPage { .. } => ErrorCode::InvalidPage,
        ReportError::EmptyReport => ErrorCode::EmptyReport,
        ReportError::Cancelled => ErrorCode::Cancelled,
        ReportError::Compose { .. } => ErrorCode::PdfiumFailure,
        ReportError::Encode { .. } => ErrorCode::ImageEncodeFailed,
        ReportError::Document(error) => document_code(error),
        ReportError::Save(error) => save_code(error),
    }
}

fn paragraph_code(error: &ParagraphError) -> ErrorCode {
    match error {
        ParagraphError::Document(error) => document_code(error),
        ParagraphError::InvalidRange { .. } => ErrorCode::InvalidRange,
        ParagraphError::InvalidPage { .. } => ErrorCode::InvalidPage,
        ParagraphError::Encode { .. } => ErrorCode::ImageEncodeFailed,
    }
}

/// crates/translate의 API 오류 코드 → 계약 코드. translate에 코드가 늘면 여기서 컴파일이 멈춘다.
fn api_code(code: ApiErrorCode) -> ErrorCode {
    match code {
        ApiErrorCode::KeyInvalid => ErrorCode::ApiKeyInvalid,
        ApiErrorCode::PermissionDenied => ErrorCode::ApiPermissionDenied,
        ApiErrorCode::Billing => ErrorCode::ApiBilling,
        ApiErrorCode::ModelUnavailable => ErrorCode::ModelUnavailable,
        ApiErrorCode::RequestRejected => ErrorCode::ApiRequestRejected,
        ApiErrorCode::RateLimited => ErrorCode::ApiRateLimited,
        ApiErrorCode::Unavailable => ErrorCode::ApiUnavailable,
        ApiErrorCode::Timeout => ErrorCode::ApiTimeout,
        ApiErrorCode::NetworkUnavailable => ErrorCode::NetworkUnavailable,
    }
}

/// 문단·스캔 쪽 실패 사유 → 계약 코드(`failCode`)
pub(crate) fn fail_code(reason: FailReason) -> ErrorCode {
    match reason {
        FailReason::Mismatch => ErrorCode::TranslationMismatch,
        FailReason::Truncated => ErrorCode::TranslationTruncated,
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

/// 쪽 범위 오류는 입력 파일이 아니라 사용자가 쓴 범위 문자열이 원인이라 경로를 싣지 않는다.
fn compare_input_path(error: &CompareError) -> Option<&Path> {
    match error {
        CompareError::Document(error) => Some(document_path(error)),
        CompareError::Options(_) | CompareError::Cancelled => None,
    }
}

/// 문서를 열다 실패했을 때만 그 문서다. 쪽 범위(사용자가 쓴 글)·없는 쪽·그림 인코딩은 입력 파일 탓이 아니다.
fn paragraph_input_path(error: &ParagraphError) -> Option<&Path> {
    match error {
        ParagraphError::Document(error) => Some(document_path(error)),
        ParagraphError::InvalidRange { .. }
        | ParagraphError::InvalidPage { .. }
        | ParagraphError::Encode { .. } => None,
    }
}

/// 결과의 쪽 번호가 문서 밖이면 그 문서(다른 파일을 넘겼다)를 싣는다. 출력이 원본인 거부와 새 문서
/// 조립·그림·저장 실패는 입력 파일 탓이 아니다.
fn report_input_path(error: &ReportError) -> Option<&Path> {
    match error {
        ReportError::InvalidPage { path, .. } => Some(path),
        ReportError::Document(error) => Some(document_path(error)),
        ReportError::OutputIsSource { .. }
        | ReportError::EmptyReport
        | ReportError::Cancelled
        | ReportError::Compose { .. }
        | ReportError::Encode { .. }
        | ReportError::Save(_) => None,
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
