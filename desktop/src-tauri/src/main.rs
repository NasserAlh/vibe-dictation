// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod cleaner;
mod cli;
mod cmd;
mod config;
mod diagnostics;
mod dictation_indicator;
mod error;
mod ffmpeg;
mod logging;
#[cfg(feature = "model-download")]
mod model_download;
mod ollama;
mod setup;
mod sona;
mod transcript;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
mod dock;

use eyre::{eyre, Result};
use tauri_plugin_window_state::StateFlags;

use error::LogError;

#[tokio::main]
async fn main() -> Result<()> {
    // Attach console in Windows:
    #[cfg(all(windows, not(debug_assertions)))]
    cli::attach_console();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            tracing::debug!("{}, {argv:?}, {cwd}", app.package_info().name);
            // A second launch (desktop/Start-menu shortcut) lands here. The window
            // is usually HIDDEN — closing it hides instead of exiting — so it must
            // be shown and unminimized, not merely focused. See show_main_window.
            setup::show_main_window(app);
            app.emit("single-instance", argv).map_err(|e| eyre!("{:?}", e)).log_error();
        }))
        // Registered but inert: the autostart Run-entry write goes through
        // crate::autostart (quoted path) instead of this plugin, whose
        // auto-launch crate writes the value unquoted (v1.0.0 defect).
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            setup::setup(app)?;

            // Sync autostart with the stored preference on every startup: if ON,
            // call enable() — idempotent, and it rewrites the registry Run entry
            // to the CURRENT exe path, so the entry can never go stale across
            // builds. If OFF, do nothing (user's choice is respected; the
            // Advanced-settings toggle owns the preference). Default is ON.
            //
            // Release builds ONLY. A debug/dev build must never write the Run
            // entry: dev runs share the store (same identifier), and a dev
            // instance syncing the entry points login-autostart at a transient
            // target\debug exe (incident: 2026-07-14, verification report §5c).
            if !cfg!(debug_assertions) {
                use tauri_plugin_store::StoreExt;
                if let Ok(store) = app.store(crate::config::STORE_FILENAME) {
                    store.delete("autostart_initialized"); // legacy first-run guard flag
                    let enabled = match store.get("autostart_enabled").and_then(|v| v.as_bool()) {
                        Some(value) => value,
                        None => {
                            store.set("autostart_enabled", serde_json::Value::Bool(true));
                            true
                        }
                    };
                    let _ = store.save();
                    // Write the Run entry ourselves with a QUOTED exe path; the
                    // auto-launch plugin writes it unquoted, which fails to launch
                    // from a spaced install path (v1.0.0 defect). See crate::autostart.
                    if enabled {
                        let _ = crate::autostart::enable();
                    }
                }
            }

            Ok(())
        })
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(!StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init());

    #[cfg(feature = "keepawake")]
    {
        builder = builder.plugin(tauri_plugin_keepawake::init());
    }

    let app = builder
        .invoke_handler(tauri::generate_handler![
            cmd::app::get_cargo_features,
            cmd::transcribe::transcribe,
            cmd::files::glob_files,
            cmd::sona_cmd::load_model,
            cmd::sona_cmd::get_gpu_devices,
            cmd::sona_cmd::get_model_metadata,
            cmd::sona_cmd::get_api_base_url,
            cmd::sona_cmd::start_api_server,
            cmd::sona_cmd::stop_api_server,
            cmd::app::get_commit_hash,
            cmd::app::is_avx2_enabled,
            cmd::files::get_path_dst,
            cmd::app::get_logs,
            cmd::files::open_path,
            cmd::files::get_save_path,
            cmd::files::get_argv,
            cmd::files::get_default_recording_path,
            cmd::audio::get_audio_devices,
            cmd::audio::start_record,
            cmd::audio::snapshot_live_recording,
            cmd::app::get_models_folder,
            cmd::app::get_logs_folder,
            cmd::app::show_log_path,
            cmd::app::show_temp_path,
            cmd::files::get_ffmpeg_path,
            cmd::app::is_crashed_recently,
            cmd::app::rename_crash_file,
            cmd::app::type_text,
            cmd::app::foreground_window_handle,
            cmd::app::type_text_if_foreground,
            cmd::app::start_live_typing,
            cmd::app::inject_live_update,
            cmd::ollama_cmd::ollama_list_models,
            cmd::ollama_cmd::ollama_warm_model,
            cmd::ollama_cmd::ollama_format_text,
            cmd::model_download_cmd::list_downloadable_models,
            cmd::model_download_cmd::download_model,
            cmd::model_download_cmd::cancel_model_download,
            autostart::set_autostart,
            cmd::permissions::request_system_audio_permission,
            cmd::permissions::open_system_audio_settings,
            dictation_indicator::get_dictation_indicator_enabled,
            dictation_indicator::set_dictation_indicator_enabled,
            dictation_indicator::show_dictation_indicator,
            dictation_indicator::get_dictation_indicator_state,
            dictation_indicator::dictation_indicator_ready,
            dictation_indicator::hide_dictation_indicator
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            let mutex = app.state::<tokio::sync::Mutex<setup::SonaState>>();
            if let Ok(mut guard) = mutex.try_lock() {
                if let Some(ref mut process) = guard.process {
                    process.kill();
                }
            };
        }
        _ => {}
    });
    Ok(())
}
