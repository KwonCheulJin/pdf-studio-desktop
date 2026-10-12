//! pdfium 동적 라이브러리의 경로를 정하고 프로세스에 바인딩한다.
//! 라이브러리 경로 결정은 이 모듈 한 곳에서만 한다.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use pdfium_render::prelude::{Pdfium, PdfiumError};

/// 개발·테스트에서 번들 경로 대신 쓸 라이브러리 파일 경로
const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";

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

    /// 바인딩이 끝난 pdfium. 문서를 열고 만드는 모든 처리는 이 핸들을 거친다.
    pub(crate) fn pdfium(&self) -> &Pdfium {
        &self.pdfium
    }

    pub fn library_path(&self) -> &Path {
        &self.library_path
    }

    /// 바인딩이 따르는 pdfium FPDF API 버전 (예: `V7881`)
    pub fn api_version(&self) -> &str {
        &self.api_version
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
