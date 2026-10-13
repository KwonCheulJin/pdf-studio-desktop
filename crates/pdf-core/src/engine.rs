//! pdfium 동적 라이브러리의 경로를 정하고 프로세스에 바인딩한다. pdfium을 쓰는 구간은 프로세스 잠금
//! 하나로 줄 세운다([`PdfiumSession`]). 라이브러리 경로 결정은 이 모듈 한 곳에서만 한다.

use std::cell::Cell;
use std::ffi::OsString;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use pdfium_render::prelude::{Pdfium, PdfiumError};

/// 개발·테스트에서 번들 경로 대신 쓸 라이브러리 파일 경로
const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";

/// pdfium을 쓰는 구간을 한 번에 하나로 줄 세우는 프로세스 잠금(ADR 0001 §15 "pdfium 잠금").
/// pdfium은 스레드 안전하지 않고, pdfium-render `thread_safe`는 pdfium 함수 467개 중 182개
/// (`FPDFPageObj_SetStrokeColor`·`FPDF_NewXObjectFromPage`·`FPDFText_GetCharBox`·
/// `FPDF_RenderPageBitmapWithMatrix` 등)를 잠금 없이 부른다. 두 스레드가 동시에 장을 그리면 공유
/// 색공간의 참조 수가 깨져 죽는다(`tests/pdfium_concurrency.rs`). 함수마다가 아니라 구간마다 잡으므로
/// 열기와 실패 이유 읽기(`FPDF_GetLastError`, 스레드마다 따로 있지 않다) 사이에 다른 스레드가 끼지도
/// 못한다. pdfium은 프로세스에 하나이므로 잠금도 하나다.
static PDFIUM_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("failed to bind pdfium library at {path}: {source}")]
    Bind {
        path: PathBuf,
        #[source]
        source: PdfiumError,
    },
}

pub struct PdfEngine {
    pdfium: Pdfium,
    library_path: PathBuf,
    api_version: String,
}

impl PdfEngine {
    /// `PDFIUM_LIB_PATH`가 있으면 그 파일을, 없으면 `bundled_library_dir` 안의
    /// 플랫폼별 라이브러리(`libpdfium.dylib`/`pdfium.dll`/`libpdfium.so`)를 바인딩한다.
    /// pdfium 바인딩은 프로세스당 한 번만 성공한다.
    pub fn bind(bundled_library_dir: &Path) -> Result<Self, EngineError> {
        let library_path =
            resolve_library_path(std::env::var_os(LIBRARY_PATH_ENV), bundled_library_dir);
        // `Pdfium::new`가 `FPDF_InitLibrary`를 부른다.
        let _guard = lock_pdfium();
        let bindings =
            Pdfium::bind_to_library(&library_path).map_err(|source| EngineError::Bind {
                path: library_path.clone(),
                source,
            })?;
        let api_version = format!("{:?}", bindings.version());
        Ok(Self {
            pdfium: Pdfium::new(bindings),
            library_path,
            api_version,
        })
    }

    /// pdfium을 혼자 쓰는 구간을 연다(다른 스레드가 쓰고 있으면 끝날 때까지 기다린다). 문서를 열고 만드는
    /// 모든 처리는 이 세션이 빌려 주는 핸들을 거친다. pdfium을 쓰는 공개 함수는 시작할 때 한 번 잡고,
    /// 세션을 쥔 채 다른 공개 함수를 부르지 않는다(같은 스레드가 다시 잡으면 멈춘다).
    pub(crate) fn session(&self) -> PdfiumSession<'_> {
        PdfiumSession {
            pdfium: &self.pdfium,
            guard: Cell::new(Some(lock_pdfium())),
        }
    }

    pub fn library_path(&self) -> &Path {
        &self.library_path
    }

    /// 바인딩이 따르는 pdfium FPDF API 버전 (예: `V7881`)
    pub fn api_version(&self) -> &str {
        &self.api_version
    }
}

fn lock_pdfium() -> MutexGuard<'static, ()> {
    // 잠금은 데이터를 지키지 않으므로 다른 스레드의 패닉으로 오염돼도 그대로 쓴다.
    PDFIUM_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// [`PDFIUM_LOCK`]을 쥔 구간. `Deref`로 빌려 주는 `&Pdfium`으로 연 문서·쪽·비트맵은 이 세션보다 오래 살 수
/// 없으므로(컴파일러가 확인한다) pdfium 호출과 객체 해제(`FPDF_Close*`)가 모두 잠금 안에서 일어난다.
/// 다른 스레드로 넘길 수 없다.
pub(crate) struct PdfiumSession<'e> {
    pdfium: &'e Pdfium,
    /// [`PdfiumSession::unlocked`]가 도는 동안만 비어 있다.
    guard: Cell<Option<MutexGuard<'static, ()>>>,
}

impl PdfiumSession<'_> {
    /// pdfium을 부르지 않는 긴 일(OCR 추론, 파일 해시)을 잠금 밖에서 돌리고 다시 잡는다. 그동안 다른 작업이
    /// pdfium을 쓸 수 있다. 열어 둔 문서는 그대로 두되 `work` 안에서는 pdfium을 부르지 않는다.
    pub(crate) fn unlocked<T>(&self, work: impl FnOnce() -> T) -> T {
        drop(self.guard.take());
        let _relock = Relock(self);
        work()
    }
}

impl Deref for PdfiumSession<'_> {
    type Target = Pdfium;

    fn deref(&self) -> &Pdfium {
        self.pdfium
    }
}

/// `unlocked`의 일이 끝나면(패닉으로 풀려도) 잠금을 다시 잡는다. 그래야 세션이 빌려 준 문서의 해제가
/// 잠금 안에서 일어난다.
struct Relock<'s, 'e>(&'s PdfiumSession<'e>);

impl Drop for Relock<'_, '_> {
    fn drop(&mut self) {
        self.0.guard.set(Some(lock_pdfium()));
    }
}

fn resolve_library_path(env_value: Option<OsString>, bundled_library_dir: &Path) -> PathBuf {
    match env_value {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => Pdfium::pdfium_platform_library_name_at_path(bundled_library_dir),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    const PLATFORM_LIBRARY_FILE: &str = "libpdfium.dylib";
    #[cfg(target_os = "windows")]
    const PLATFORM_LIBRARY_FILE: &str = "pdfium.dll";
    #[cfg(target_os = "linux")]
    const PLATFORM_LIBRARY_FILE: &str = "libpdfium.so";

    fn missing_dir() -> PathBuf {
        PathBuf::from("/nonexistent/pdfium")
    }

    #[test]
    fn env_path_wins_over_bundled_dir() {
        let resolved =
            resolve_library_path(Some(OsString::from("/opt/libpdfium.dylib")), &missing_dir());

        assert_eq!(resolved, PathBuf::from("/opt/libpdfium.dylib"));
    }

    #[test]
    fn falls_back_to_platform_library_in_bundled_dir() {
        let expected = missing_dir().join(PLATFORM_LIBRARY_FILE);

        assert_eq!(resolve_library_path(None, &missing_dir()), expected);
        assert_eq!(
            resolve_library_path(Some(OsString::new()), &missing_dir()),
            expected
        );
    }
}
