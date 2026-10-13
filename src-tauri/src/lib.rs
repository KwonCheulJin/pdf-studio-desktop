mod access;
mod commands;
mod compare;
mod contract;
mod error;
mod files;
mod jobs;
mod merge;
mod notices;
mod pdf_engine;
mod report;
#[cfg(test)]
mod test_support;

use std::error::Error;
use std::path::PathBuf;
use std::time::SystemTime;

use tauri::{App, AppHandle, DragDropEvent, Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::StateFlags;

use access::{AppDirectories, PathAccess, STALE_SESSION_AGE};
use compare::CompareState;
use jobs::JobRegistry;

/// TIFF 변환 결과 PDF를 두는 앱 캐시 하위 폴더
const CONVERTED_DIRECTORY: &str = "converted";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta = commands::specta_builder();
    tauri::Builder::default()
        // 창 크기·위치·최대화만 기억한다. 표시 여부는 저장된 값이 아니라 창 설정(`visible`)을 따른다.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
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
            app.manage(CompareState::for_app(app)?);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                event: WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }),
                ..
            } => allow_dropped(app, &paths),
            RunEvent::Exit => remove_session(app),
            _ => {}
        });
}

/// 창에 드롭한 파일을 허용 경로 목록(D13)에 기록한다. 이 콜백은 Tauri가 같은 드롭 이벤트를
/// 웹뷰에 보내기(`tauri://drag-drop`) 전에 같은 메인 스레드에서 불린다. 그래서 프론트가
/// 그 이벤트를 받고 `open_files`를 부를 때는 이미 기록돼 있다.
fn allow_dropped(app: &AppHandle, paths: &[PathBuf]) {
    if let Some(access) = app.try_state::<PathAccess>() {
        access.allow_dropped(paths);
    }
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
