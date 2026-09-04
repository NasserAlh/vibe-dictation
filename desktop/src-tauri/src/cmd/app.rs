use crate::config::STORE_FILENAME;
use crate::ffmpeg;
use eyre::{Context, Result};
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[tauri::command]
pub fn get_commit_hash() -> String {
    env!("COMMIT_HASH").to_string()
}

#[tauri::command]
pub fn is_avx2_enabled() -> bool {
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(target_os = "macos")))]
    {
        is_x86_feature_detected!("avx2")
    }
    #[cfg(not(all(any(target_arch = "x86", target_arch = "x86_64"), not(target_os = "macos"))))]
    {
        true
    }
}

#[tauri::command]
pub fn get_logs_folder(app_handle: tauri::AppHandle) -> Result<PathBuf> {
    Ok(app_handle.path().app_config_dir()?)
}

#[tauri::command]
pub async fn show_log_path(app_handle: tauri::AppHandle) -> Result<()> {
    let log_path = crate::logging::get_log_path(&app_handle)?;
    if log_path.exists() {
        showfile::show_path_in_file_manager(log_path);
    } else if let Some(parent) = log_path.parent() {
        showfile::show_path_in_file_manager(parent);
    }
    Ok(())
}

#[tauri::command]
pub async fn show_temp_path() -> Result<()> {
    let temp_path = ffmpeg::get_vibe_temp_folder();
    showfile::show_path_in_file_manager(temp_path);
    Ok(())
}

#[tauri::command]
pub fn get_models_folder(app_handle: tauri::AppHandle) -> Result<PathBuf> {
    let store = app_handle.store(STORE_FILENAME)?;

    let models_folder = store.get("models_folder").and_then(|p| p.as_str().map(PathBuf::from));
    if let Some(models_folder) = models_folder {
        tracing::debug!("models folder: {:?}", models_folder);
        return Ok(models_folder);
    }
    let path = app_handle.path().app_local_data_dir().context("Can't get data directory")?;
    Ok(path)
}

#[tauri::command]
pub fn get_logs(app_handle: tauri::AppHandle) -> Result<String> {
    let path = crate::logging::get_log_path(&app_handle)?;
    let content = std::fs::read_to_string(path)?;
    Ok(content)
}

#[tauri::command]
pub fn is_crashed_recently() -> bool {
    tracing::debug!("checking path {}", ffmpeg::get_vibe_temp_folder().join("crash.txt").display());
    ffmpeg::get_vibe_temp_folder().join("crash.txt").exists()
}

#[tauri::command]
pub fn rename_crash_file() -> Result<()> {
    std::fs::rename(
        ffmpeg::get_vibe_temp_folder().join("crash.txt"),
        ffmpeg::get_vibe_temp_folder().join("crash.1.txt"),
    )
    .context("Can't delete file")
}

#[tauri::command]
pub fn type_text(text: String) -> Result<()> {
    use enigo::{Enigo, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| eyre::eyre!("Failed to create enigo: {}", e))?;
    // Small delay to let the user's key release propagate
    std::thread::sleep(std::time::Duration::from_millis(100));
    enigo.text(&text).map_err(|e| eyre::eyre!("Failed to type text: {}", e))?;
    Ok(())
}

/// Frozen until `start_live_typing` arms a session; re-frozen the moment the
/// foreground window changes, and only the next session can un-freeze.
static LIVE_TYPING_FROZEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
#[cfg(windows)]
static LIVE_TARGET_WINDOW: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// HWND of the foreground window as an integer (0 when there is none). Shared
/// with `dictation_indicator`, which places the pill on this window's monitor.
#[cfg(windows)]
pub(crate) fn foreground_window() -> isize {
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow().0 as isize }
}

/// Arms live dictation: remembers the window that holds the cursor so every
/// later injection can verify the user has not moved elsewhere.
#[tauri::command]
pub fn start_live_typing() {
    #[cfg(windows)]
    LIVE_TARGET_WINDOW.store(foreground_window(), std::sync::atomic::Ordering::SeqCst);
    LIVE_TYPING_FROZEN.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// Applies one live-dictation edit at the cursor: `backspaces` deletions of
/// the divergent tail, then `text`. Returns `false` — and freezes the session
/// — when the foreground window is no longer the one dictation started in:
/// synthetic backspaces must never eat text in a window the user moved to
/// mid-dictation. The caller falls back to clipboard delivery.
#[tauri::command]
pub fn inject_live_update(backspaces: u32, text: String) -> Result<bool> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    use std::sync::atomic::Ordering;
    if LIVE_TYPING_FROZEN.load(Ordering::SeqCst) {
        return Ok(false);
    }
    #[cfg(windows)]
    if foreground_window() != LIVE_TARGET_WINDOW.load(Ordering::SeqCst) {
        LIVE_TYPING_FROZEN.store(true, Ordering::SeqCst);
        tracing::info!("live typing frozen: foreground window changed mid-dictation");
        return Ok(false);
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| eyre::eyre!("Failed to create enigo: {}", e))?;
    for _ in 0..backspaces {
        enigo
            .key(Key::Backspace, Direction::Click)
            .map_err(|e| eyre::eyre!("Failed to press backspace: {}", e))?;
    }
    if !text.is_empty() {
        enigo.text(&text).map_err(|e| eyre::eyre!("Failed to type text: {}", e))?;
    }
    Ok(true)
}

#[tauri::command]
pub fn get_cargo_features() -> Vec<String> {
    let mut features = Vec::new();
    if cfg!(feature = "model-download") {
        features.push("model-download".to_string());
    }
    if cfg!(feature = "keepawake") {
        features.push("keepawake".to_string());
    }
    features
}
