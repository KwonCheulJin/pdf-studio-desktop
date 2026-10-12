mod pdf_engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            pdf_engine::bind_bundled(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
