//! 결과 PDF를 출력 폴더 안의 임시 파일에 쓴 뒤 rename해 원자적으로 저장한다.
//! 저장이 실패하면 임시 파일을 지우므로 출력 경로에는 완성된 파일만 나타난다.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(any(windows, test))]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use pdfium_render::prelude::{PdfDocument, PdfiumError};

/// 출력 경로가 파일 이름뿐일 때(`merged.pdf`) 쓰는 폴더
const CURRENT_DIRECTORY: &str = ".";
/// 임시 파일 이름 앞부분. 점으로 시작해 macOS·Linux 파일 목록에서 숨는다.
const TEMP_FILE_PREFIX: &str = ".pdf-studio-";
const TEMP_FILE_EXTENSION: &str = "tmp";

/// 같은 프로세스 안에서 만든 파일 이름이 겹치지 않게 하는 일련번호
static FILE_NAME_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Windows에서 rename을 다시 시도할 에러 코드 (winerror.h)
#[cfg(windows)]
const ERROR_SHARING_VIOLATION: i32 = 32;
#[cfg(windows)]
const ERROR_LOCK_VIOLATION: i32 = 33;

/// Windows에서 다른 프로세스(뷰어·백신)가 파일을 잡고 있을 때 rename을 다시 시도하는 횟수와
/// 첫 대기 시간. 대기는 시도마다 두 배가 된다(200 → 400 → 800ms).
#[cfg(any(windows, test))]
const REPLACE_MAX_RETRIES: u32 = 3;
#[cfg(any(windows, test))]
const REPLACE_BASE_DELAY: Duration = Duration::from_millis(200);

#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error("output directory does not exist: {path}")]
    DirectoryNotFound { path: PathBuf },
    #[error("failed to write {path}: {source}")]
    Write {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("pdfium failed to serialize {path}: {source}")]
    Pdfium {
        path: PathBuf,
        #[source]
        source: PdfiumError,
    },
}

impl SaveError {
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드. 변형의 이름이 바뀌어도 값은 유지한다.
    pub fn code(&self) -> &'static str {
        match self {
            Self::DirectoryNotFound { .. } => "OUTPUT_DIRECTORY_NOT_FOUND",
            Self::Write { .. } => "WRITE_FAILED",
            Self::Pdfium { .. } => "PDFIUM_FAILURE",
        }
    }
}

/// 출력 폴더가 있는지 확인하고 돌려준다. 폴더는 만들지 않는다.
pub(crate) fn ensure_output_directory(output_path: &Path) -> Result<&Path, SaveError> {
    let directory = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new(CURRENT_DIRECTORY));
    if directory.is_dir() {
        Ok(directory)
    } else {
        Err(SaveError::DirectoryNotFound {
            path: directory.to_path_buf(),
        })
    }
}

/// 출력 폴더 안의 새 임시 파일에 저장한 뒤 `output_path`로 rename한다.
/// 같은 이름의 파일이 있으면 바꿔치기한다. 실패하면 임시 파일을 지운다.
pub(crate) fn save_atomically(document: &PdfDocument, output_path: &Path) -> Result<(), SaveError> {
    let directory = ensure_output_directory(output_path)?;
    let write_error = |source: io::Error| SaveError::Write {
        path: output_path.to_path_buf(),
        source,
    };
    let (temp_path, file) = create_temp_file(directory).map_err(write_error)?;

    let result = write_document(document, file, output_path)
        .and_then(|()| replace_file(&temp_path, output_path).map_err(write_error));
    if result.is_err() {
        // 정리는 최선 노력이다. 정리 실패보다 원래 에러가 원인에 가깝다.
        let _ = fs::remove_file(&temp_path);
    }
    result
}

/// `source`를 `destination` 폴더 안의 새 임시 파일에 복사한 뒤 `destination`으로 rename한다.
/// 같은 이름의 파일이 있으면 바꿔치기한다. 실패하면 임시 파일을 지운다. `source`는 읽기만 한다.
pub fn copy_atomically(source: &Path, destination: &Path) -> Result<(), SaveError> {
    let directory = ensure_output_directory(destination)?;
    let write_error = |error: io::Error| SaveError::Write {
        path: destination.to_path_buf(),
        source: error,
    };
    let (temp_path, file) = create_temp_file(directory).map_err(write_error)?;

    let result = copy_contents(source, file)
        .and_then(|()| replace_file(&temp_path, destination))
        .map_err(write_error);
    if result.is_err() {
        // 정리는 최선 노력이다. 정리 실패보다 원래 에러가 원인에 가깝다.
        let _ = fs::remove_file(&temp_path);
    }
    result
}

/// `bytes`를 `destination`과 같은 폴더의 새 임시 파일에 쓴 뒤 `destination`으로 rename한다(폴더는
/// 있어야 한다). 같은 이름의 파일이 있으면 바꿔치기한다. 실패하면 임시 파일을 지운다.
pub(crate) fn write_atomically(destination: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new(CURRENT_DIRECTORY));
    let (temp_path, mut file) = create_temp_file(directory)?;
    let result = file
        .write_all(bytes)
        .and_then(|()| file.sync_all())
        .and_then(|()| {
            drop(file);
            replace_file(&temp_path, destination)
        });
    if result.is_err() {
        // 정리는 최선 노력이다. 정리 실패보다 원래 에러가 원인에 가깝다.
        let _ = fs::remove_file(&temp_path);
    }
    result
}

/// 원본을 임시 파일에 복사하고 디스크에 내린 뒤 닫는다. rename 전에 닫아야 Windows에서 바꿔치기가 된다.
fn copy_contents(source: &Path, mut file: File) -> io::Result<()> {
    let mut reader = File::open(source)?;
    io::copy(&mut reader, &mut file)?;
    file.sync_all()
}

/// `{prefix}{프로세스 ID}-{나노초}-{일련번호}.{extension}`. 다른 프로세스와는 프로세스 ID로,
/// 같은 프로세스 안에서는 일련번호로 갈린다.
pub(crate) fn unique_file_name(prefix: &str, extension: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let sequence = FILE_NAME_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "{prefix}{}-{nanos}-{sequence}.{extension}",
        std::process::id()
    )
}

/// 이미 있는 파일을 덮지 않도록 `create_new`로 만든다.
fn create_temp_file(directory: &Path) -> io::Result<(PathBuf, File)> {
    let path = directory.join(unique_file_name(TEMP_FILE_PREFIX, TEMP_FILE_EXTENSION));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    Ok((path, file))
}

/// 문서를 파일에 쓰고 디스크에 내린 뒤 닫는다. rename 전에 닫아야 Windows에서 바꿔치기가 된다.
fn write_document(document: &PdfDocument, file: File, output_path: &Path) -> Result<(), SaveError> {
    let write_error = |source: io::Error| SaveError::Write {
        path: output_path.to_path_buf(),
        source,
    };
    let mut writer = BufWriter::new(file);
    document
        .save_to_writer(&mut writer)
        .map_err(|source| match source {
            PdfiumError::IoError(source) => write_error(source),
            source => SaveError::Pdfium {
                path: output_path.to_path_buf(),
                source,
            },
        })?;
    let file = writer
        .into_inner()
        .map_err(|error| write_error(error.into_error()))?;
    file.sync_all().map_err(write_error)
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

/// 대상 파일을 다른 프로세스가 열고 있으면 rename이 공유 위반으로 실패하므로 잠시 뒤 다시 시도한다.
#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    retry_with_backoff(
        || fs::rename(from, to),
        is_sharing_violation,
        std::thread::sleep,
    )
}

#[cfg(windows)]
fn is_sharing_violation(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::PermissionDenied
        || matches!(
            error.raw_os_error(),
            Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION)
        )
}

/// `operation`이 `is_retryable` 에러로 실패하면 최대 `REPLACE_MAX_RETRIES`번 더 시도한다.
#[cfg(any(windows, test))]
fn retry_with_backoff<T>(
    mut operation: impl FnMut() -> io::Result<T>,
    is_retryable: impl Fn(&io::Error) -> bool,
    mut sleep: impl FnMut(Duration),
) -> io::Result<T> {
    let mut retries = 0;
    loop {
        match operation() {
            Err(error) if retries < REPLACE_MAX_RETRIES && is_retryable(&error) => {
                sleep(REPLACE_BASE_DELAY * 2_u32.pow(retries));
                retries += 1;
            }
            result => return result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn busy() -> io::Error {
        io::Error::from(io::ErrorKind::ResourceBusy)
    }

    fn is_busy(error: &io::Error) -> bool {
        error.kind() == io::ErrorKind::ResourceBusy
    }

    /// 항상 `failure`로 실패하는 작업을 돌리고 (결과, 시도 수, 대기 목록)을 돌려준다.
    fn run_always_failing(failure: fn() -> io::Error) -> (io::Result<()>, usize, Vec<Duration>) {
        let mut attempts = 0;
        let mut sleeps = Vec::new();
        let result = retry_with_backoff(
            || -> io::Result<()> {
                attempts += 1;
                Err(failure())
            },
            is_busy,
            |delay| sleeps.push(delay),
        );
        (result, attempts, sleeps)
    }

    #[test]
    fn gives_up_after_three_retries() {
        let (result, attempts, sleeps) = run_always_failing(busy);

        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::ResourceBusy);
        assert_eq!(attempts, 4);
        assert_eq!(
            sleeps,
            vec![
                Duration::from_millis(200),
                Duration::from_millis(400),
                Duration::from_millis(800)
            ]
        );
    }

    #[test]
    fn other_errors_are_not_retried() {
        let (result, attempts, sleeps) =
            run_always_failing(|| io::Error::from(io::ErrorKind::NotFound));

        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::NotFound);
        assert_eq!(attempts, 1);
        assert!(sleeps.is_empty());
    }
}
