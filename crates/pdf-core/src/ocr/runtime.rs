//! ONNX Runtime 동적 라이브러리와 OCR 모델 파일의 경로를 정한다.
//! 경로 결정은 이 모듈 한 곳에서만 한다(pdfium의 `engine.rs`와 같은 규칙).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// 개발·테스트에서 번들 경로 대신 쓸 ONNX Runtime 라이브러리 파일 경로
pub(crate) const ONNXRUNTIME_LIB_PATH_ENV: &str = "ONNXRUNTIME_LIB_PATH";
/// 개발·테스트에서 번들 경로 대신 쓸 모델 폴더
pub(crate) const OCR_MODEL_DIR_ENV: &str = "OCR_MODEL_DIR";

/// `scripts/fetch-ocr.mjs`가 두는 플랫폼별 라이브러리 이름
#[cfg(target_os = "macos")]
const ONNXRUNTIME_LIBRARY_FILE: &str = "libonnxruntime.dylib";
#[cfg(target_os = "windows")]
const ONNXRUNTIME_LIBRARY_FILE: &str = "onnxruntime.dll";
#[cfg(all(unix, not(target_os = "macos")))]
const ONNXRUNTIME_LIBRARY_FILE: &str = "libonnxruntime.so";

/// 환경변수 값이 있으면 그 파일을, 없으면 번들 폴더의 플랫폼별 라이브러리를 쓴다.
pub(crate) fn resolve_library_path(
    env_value: Option<OsString>,
    bundled_library_dir: &Path,
) -> PathBuf {
    match env_value {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => bundled_library_dir.join(ONNXRUNTIME_LIBRARY_FILE),
    }
}

/// 환경변수 값이 있으면 그 폴더를, 없으면 번들 모델 폴더를 쓴다.
pub(crate) fn resolve_model_dir(env_value: Option<OsString>, bundled_model_dir: &Path) -> PathBuf {
    match env_value {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => bundled_model_dir.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled() -> PathBuf {
        PathBuf::from("/nonexistent/bundle")
    }

    #[test]
    fn env_paths_win_over_bundled_dirs() {
        assert_eq!(
            resolve_library_path(Some(OsString::from("/opt/ort.dylib")), &bundled()),
            PathBuf::from("/opt/ort.dylib")
        );
        assert_eq!(
            resolve_model_dir(Some(OsString::from("/opt/models")), &bundled()),
            PathBuf::from("/opt/models")
        );
    }

    #[test]
    fn empty_env_falls_back_to_bundled_dirs() {
        assert_eq!(
            resolve_library_path(Some(OsString::new()), &bundled()),
            bundled().join(ONNXRUNTIME_LIBRARY_FILE)
        );
        assert_eq!(resolve_model_dir(None, &bundled()), bundled());
    }
}
