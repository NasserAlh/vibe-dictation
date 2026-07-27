use crate::{
    cli::{self, is_cli_detected},
    config::STORE_FILENAME,
    error::LogError,
    sona::SonaProcess,
};
use eyre::eyre;
use once_cell::sync::Lazy;
use std::fs;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager, WindowEvent};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

pub static STATIC_APP: Lazy<std::sync::Mutex<Option<tauri::AppHandle>>> = Lazy::new(|| std::sync::Mutex::new(None));

pub struct SonaState {
    pub process: Option<SonaProcess>,
    pub loaded_model_path: Option<String>,
    pub loaded_gpu_device: Option<i32>,
}

pub fn setup(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    // Create app directories
    let local_app_data_dir = app.path().app_local_data_dir()?;
    let app_config_dir = app.path().app_config_dir()?;
    fs::create_dir_all(&local_app_data_dir)
        .unwrap_or_else(|_| panic!("cant create local app data directory at {}", local_app_data_dir.display()));
    fs::create_dir_all(&app_config_dir)
        .unwrap_or_else(|_| panic!("cant create app config directory at {}", app_config_dir.display()));

    // Manage sona state
    app.manage(Mutex::new(SonaState {
        process: None,
        loaded_model_path: None,
        loaded_gpu_device: None,
    }));
    app.manage(crate::dictation_indicator::DictationIndicatorRuntime::default());

    let store = app.store(STORE_FILENAME)?;

    // Setup logging to terminal
    {
        let mut app_handle = STATIC_APP.lock().expect("lock");
        *app_handle = Some(app.handle().clone());
    }
    crate::logging::setup_logging(app.handle(), store).unwrap();
    crate::cleaner::clean_old_logs(app.handle()).log_error();
    crate::cleaner::clean_old_files().log_error();
    tracing::debug!("Vibe App Running");

    // Crash handler

    let _handler = crash_handler::CrashHandler::attach(unsafe {
        crash_handler::make_crash_event(move |cc: &crash_handler::CrashContext| {
            #[cfg(windows)]
            let info = cc.exception_code;

            #[cfg(windows)]
            tracing::error!("Crash exception code: {}", info);

            #[cfg(target_os = "macos")]
            let info = cc.exception;

            #[cfg(target_os = "linux")]
            let info = cc.siginfo;

            #[cfg(unix)]
            tracing::error!("Crash exception code: {:?}", info);

            crash_handler::CrashEventResult::Handled(true)
        })
    });

    // Log some useful data
    if let Ok(version) = tauri::webview_version() {
        tracing::debug!("webview version: {}", version);
    }

    tracing::debug!("AVX2: {}", crate::cmd::app::is_avx2_enabled());
    tracing::debug!("Executable Architecture: {}", std::env::consts::ARCH);

    tracing::debug!("APP VERSION: {}", app.package_info().version.to_string());
    tracing::debug!("COMMIT HASH: {}", env!("COMMIT_HASH"));
    tracing::debug!("App Info: {}", crate::diagnostics::get_app_info());

    let app_handle = app.app_handle().clone();
    if is_cli_detected() {
        tracing::debug!("CLI mode");
        tauri::async_runtime::spawn(async move {
            cli::run(&app_handle).await.map_err(|e| eyre!("{:?}", e)).log_error();
        });
    } else {
        tracing::debug!("Non CLI mode");
        // Create main window
        let result = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .inner_size(800.0, 700.0)
            .min_inner_size(800.0, 700.0)
            .center()
            .title("Vibe Dictation")
            .resizable(true)
            .focused(true)
            .shadow(true)
            .visible(true)
            .build();
        match result {
            Ok(window) => {
                // Closing the main window hides it instead of exiting, so the
                // tray icon (and the armed global hotkey) stay alive.
                let closable_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = closable_window.hide();
                    }
                });
            }
            Err(error) => tracing::error!("{:?}", error),
        }
        crate::dictation_indicator::initialize(app.handle());
        build_tray(app)?;
    }
    Ok(())
}

fn build_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}
