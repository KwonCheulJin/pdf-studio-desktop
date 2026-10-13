//! 앱 시작 시 번들된 pdfium을 `pdf-core`에 바인딩하고 엔진을 앱 상태로 둔다.

use std::error::Error;
use std::path::PathBuf;

use pdf_core::PdfEngine;
use tauri::{App, Manager};

/// macOS 번들에서 `Contents/` 아래 dylib가 놓이는 폴더 (`bundle.macOS.frameworks`)
#[cfg(target_os = "macos")]
const MACOS_FRAMEWORKS_DIR: &str = "Frameworks";

/// 번들한 네이티브 라이브러리(pdfium, ONNX Runtime) 폴더.
/// macOS는 실행 파일(`Contents/MacOS/<exe>`) 기준 `Contents/Frameworks`다.
#[cfg(target_os = "macos")]
pub(crate) fn bundled_library_dir(_app: &App) -> Result<PathBuf, Box<dyn Error>> {
    let executable = std::env::current_exe()?;
    let contents_dir = executable
        .parent()
        .and_then(|macos_dir| macos_dir.parent())
        .ok_or("executable has no bundle Contents directory")?;
    Ok(contents_dir.join(MACOS_FRAMEWORKS_DIR))
}

/// Windows·Linux는 리소스 폴더(`bundle.resources`)다.
#[cfg(not(target_os = "macos"))]
pub(crate) fn bundled_library_dir(app: &App) -> Result<PathBuf, Box<dyn Error>> {
    Ok(app.path().resource_dir()?)
}

/// 바인딩에 실패해도 앱은 계속 뜬다. 실패 원인은 로그로 남긴다.
pub fn bind_bundled(app: &App) {
    let library_dir = match bundled_library_dir(app) {
        Ok(directory) => directory,
        Err(error) => {
            log::error!("pdfium library directory unavailable: {error}");
            return;
        }
    };
    match PdfEngine::bind(&library_dir) {
        Ok(engine) => {
            log::info!(
                "pdfium bound: {} (API {})",
                engine.library_path().display(),
                engine.api_version()
            );
            app.manage(engine);
        }
        Err(error) => log::error!("pdfium binding failed: {error}"),
    }
}
