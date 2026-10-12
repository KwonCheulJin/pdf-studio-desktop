mod access;
mod commands;
mod contract;
mod error;
mod files;
mod jobs;
mod merge;
mod pdf_engine;
#[cfg(test)]
mod test_support;

use std::error::Error;
use std::time::SystemTime;

use tauri::{App, AppHandle, Manager, RunEvent};

use access::{AppDirectories, PathAccess, STALE_SESSION_AGE};
use jobs::JobRegistry;

/// TIFF 변환 결과 PDF를 두는 앱 캐시 하위 폴더
const CONVERTED_DIRECTORY: &str = "converted";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta = commands::specta_builder();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(JobRegistry::default())
        .invoke_handler(specta.invoke_handler())
        .setup(|app| {
            pdf_engine::bind_bundled(app);
            let directories = app_directories(app)?;
            if let Err(error) =
                directories.remove_stale_sessions(STALE_SESSION_AGE, SystemTime::now())
            {
                log::warn!("stale temp sessions were not removed: {error}");
            }
            app.manage(PathAccess::new(directories));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                remove_session(app);
            }
        });
}

/// 병합 임시 폴더는 시스템 임시 폴더 아래 앱 식별자 폴더(그 안에 실행마다 세션 폴더),
/// TIFF 변환 결과는 앱 캐시 폴더 아래에 둔다.
fn app_directories(app: &App) -> Result<AppDirectories, Box<dyn Error>> {
    let temp_root = app.path().temp_dir()?.join(&app.config().identifier);
    let converted = app.path().app_cache_dir()?.join(CONVERTED_DIRECTORY);
    Ok(AppDirectories::create(&temp_root, &converted)?)
}

/// 종료할 때 이 실행의 세션 폴더(병합 미리보기 결과)를 지운다. 실패는 로그만 남긴다.
fn remove_session(app: &AppHandle) {
    let Some(access) = app.try_state::<PathAccess>() else {
        return;
    };
    if let Err(error) = access.directories().remove_session() {
        log::warn!("temp session was not removed: {error}");
    }
}
