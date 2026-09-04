use crate::config::STORE_FILENAME;
use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

const WINDOW_LABEL: &str = "dictation-indicator";
const ENABLED_KEY: &str = "dictation_indicator_enabled";
const WIDTH: f64 = 280.0;
const HEIGHT: f64 = 64.0;
const BOTTOM_MARGIN: f64 = 48.0;

// --- Prompt 0 instrumentation (docs/dictation-indicator-plan.md §5) ----------
// Temporary diagnostics for the show/hide flakiness investigation. First
// touched in `initialize` (app setup), so "uptime" is ms since setup ran —
// close enough to process start for correlating with the frontend's
// performance.now() stamps.
static PROCESS_START: LazyLock<Instant> = LazyLock::new(Instant::now);

fn uptime_ms() -> u128 {
    PROCESS_START.elapsed().as_millis()
}

/// One-line snapshot of everything §2.3–2.4 depend on: visibility, physical
/// geometry, and the scale of the monitor the window sits on versus the one
/// under the cursor (`position_window` picks the cursor monitor, `set_size`
/// with a `LogicalSize` uses the window's current monitor).
fn log_window_snapshot(context: &str, window: &WebviewWindow, session_id: u64, status: &str) {
    let window_monitor_scale = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| (monitor.scale_factor(), monitor.name().cloned()));
    let cursor_monitor_scale = window
        .cursor_position()
        .ok()
        .and_then(|cursor| window.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .map(|monitor| (monitor.scale_factor(), monitor.name().cloned()));
    tracing::info!(
        "[indicator] t={}ms {context}: session={session_id} status={status} visible={:?} outer_position={:?} outer_size={:?} window_monitor(scale,name)={:?} cursor_monitor(scale,name)={:?}",
        uptime_ms(),
        window.is_visible(),
        window.outer_position(),
        window.outer_size(),
        window_monitor_scale,
        cursor_monitor_scale,
    );
}

/// Logs the window directly above the pill in z-order (`GW_HWNDPREV`) — that
/// is what covers it when `show()` succeeds but nothing is visible (§2.3).
/// The immediate predecessor is often an invisible helper window, so the
/// nearest *visible* predecessor is logged too.
#[cfg(windows)]
fn log_window_above(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindow, GetWindowTextW, IsWindowVisible, GW_HWNDPREV};

    fn describe(hwnd: HWND) -> String {
        let mut title = [0u16; 256];
        let mut class = [0u16; 128];
        // SAFETY: valid buffers; the functions only write up to the buffer length.
        let (title_len, class_len, visible) = unsafe {
            (
                GetWindowTextW(hwnd, &mut title),
                GetClassNameW(hwnd, &mut class),
                IsWindowVisible(hwnd).as_bool(),
            )
        };
        format!(
            "hwnd={:#x} visible={visible} title={:?} class={:?}",
            hwnd.0 as isize,
            String::from_utf16_lossy(&title[..title_len.max(0) as usize]),
            String::from_utf16_lossy(&class[..class_len.max(0) as usize]),
        )
    }

    // tauri re-exports HWND from its own `windows` crate version; rewrap the
    // raw pointer for ours.
    let Ok(pill) = window.hwnd() else {
        tracing::warn!("[indicator] t={}ms z-order: could not get pill HWND", uptime_ms());
        return;
    };
    let pill = HWND(pill.0);
    // SAFETY: `pill` is a live window handle owned by this process.
    let above = unsafe { GetWindow(pill, GW_HWNDPREV) };
    let Ok(above) = above else {
        tracing::info!(
            "[indicator] t={}ms z-order: pill {:#x} is topmost of its band (no window above)",
            uptime_ms(),
            pill.0 as isize
        );
        return;
    };
    let mut nearest_visible = None;
    let mut cursor = above;
    for _ in 0..64 {
        // SAFETY: `cursor` came from GetWindow on a live handle.
        if unsafe { IsWindowVisible(cursor) }.as_bool() {
            nearest_visible = Some(cursor);
            break;
        }
        match unsafe { GetWindow(cursor, GW_HWNDPREV) } {
            Ok(next) => cursor = next,
            Err(_) => break,
        }
    }
    tracing::info!(
        "[indicator] t={}ms z-order: pill hwnd={:#x}; immediately above: {}; nearest visible above: {}",
        uptime_ms(),
        pill.0 as isize,
        describe(above),
        nearest_visible.map(describe).unwrap_or_else(|| "none".to_string()),
    );
}

#[cfg(not(windows))]
fn log_window_above(_window: &WebviewWindow) {}
// --- end Prompt 0 instrumentation --------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationIndicatorPayload {
    pub session_id: u64,
    pub status: String,
    pub output: Option<String>,
    pub message: Option<String>,
}

#[derive(Default)]
pub struct DictationIndicatorRuntime {
    current: Mutex<Option<DictationIndicatorPayload>>,
}

pub fn is_enabled(app: &tauri::AppHandle) -> bool {
    app.store(STORE_FILENAME)
        .ok()
        .and_then(|store| store.get(ENABLED_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
}

fn create_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::App("index.html?window=dictation-indicator".into()),
    )
    .inner_size(WIDTH, HEIGHT)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .focused(false)
    .focusable(false)
    .skip_taskbar(true)
    .transparent(true)
    .shadow(false)
    .visible(true)
    .on_page_load(|window, payload| {
        if payload.event() == PageLoadEvent::Finished {
            tracing::info!("Dictation indicator page loaded: {}", payload.url());
            let has_active_state = window
                .app_handle()
                .state::<DictationIndicatorRuntime>()
                .current
                .lock()
                .is_ok_and(|state| state.is_some());
            if !has_active_state {
                let _ = window.hide();
            }
        }
    })
    .build()
    .map_err(|error| error.to_string())?;

    window
        .set_size(LogicalSize::new(WIDTH, HEIGHT))
        .map_err(|error| error.to_string())?;
    window.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    unsafe {
        use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};

        let native_window: &NSWindow = &*window.ns_window().map_err(|error| error.to_string())?.cast();
        native_window.setCollectionBehavior(
            native_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        native_window.setLevel(NSStatusWindowLevel);
        native_window.setOpaque(false);
    }
    position_window(app, &window)?;
    Ok(window)
}

pub fn initialize(app: &tauri::AppHandle) {
    // Anchor the instrumentation clock as early as possible.
    LazyLock::force(&PROCESS_START);
    tracing::info!("Initializing dictation indicator (enabled={})", is_enabled(app));
    if is_enabled(app) && app.get_webview_window(WINDOW_LABEL).is_none() {
        // Seed a "starting…" state before the window loads so the indicator is
        // visible from launch until the frontend has registered the dictation
        // hotkeys (it then replaces this with a ready flash and hides session 0).
        // Closes the silent startup window: a too-early keypress is visibly
        // "not yet" instead of silently ignored.
        if let Ok(mut current) = app.state::<DictationIndicatorRuntime>().current.lock() {
            *current = Some(DictationIndicatorPayload {
                session_id: 0,
                status: "starting".to_string(),
                output: None,
                message: None,
            });
        }
        if let Err(error) = create_window(app) {
            tracing::error!("Could not initialize dictation indicator: {error}");
        } else {
            tracing::info!("Dictation indicator window initialized in starting state");
        }
    }
}

fn position_window(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let cursor = window.cursor_position().map_err(|error| error.to_string())?;
    let monitor = window
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let width = WIDTH * scale;
        let height = HEIGHT * scale;
        let x = monitor_position.x as f64 + (monitor_size.width as f64 - width) / 2.0;
        let y = monitor_position.y as f64 + monitor_size.height as f64 - height - BOTTOM_MARGIN * scale;
        // Prompt 0 instrumentation (§2.4): which monitor the cursor picked.
        tracing::info!(
            "[indicator] t={}ms position_window: cursor=({:.0},{:.0}) monitor(name={:?}, position={:?}, size={:?}, scale={scale}) -> target=({},{}) expected_physical_size=({width:.0}x{height:.0})",
            uptime_ms(),
            cursor.x,
            cursor.y,
            monitor.name(),
            monitor_position,
            monitor_size,
            x.round() as i32,
            y.round() as i32,
        );
        window
            .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|error| error.to_string())?;
    } else if let Some(main) = app.get_webview_window("main") {
        tracing::info!(
            "[indicator] t={}ms position_window: no monitor under cursor and no primary; falling back to main window position",
            uptime_ms()
        );
        window
            .set_position(main.outer_position().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_dictation_indicator_enabled(app: tauri::AppHandle) -> bool {
    is_enabled(&app)
}

#[tauri::command]
pub fn set_dictation_indicator_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_FILENAME).map_err(|error| error.to_string())?;
    store.set(ENABLED_KEY, serde_json::Value::Bool(enabled));
    store.save().map_err(|error| error.to_string())?;
    if !enabled {
        *app.state::<DictationIndicatorRuntime>()
            .current
            .lock()
            .map_err(|error| error.to_string())? = None;
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            window.close().map_err(|error| error.to_string())?;
        }
    } else if app.get_webview_window(WINDOW_LABEL).is_none() {
        create_window(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_dictation_indicator(app: tauri::AppHandle, state: DictationIndicatorPayload) -> Result<(), String> {
    tracing::info!(
        "[indicator] t={}ms show requested: status={}, session={}",
        uptime_ms(),
        state.status,
        state.session_id
    );
    if !is_enabled(&app) {
        tracing::info!("Dictation indicator show skipped because it is disabled");
        return Ok(());
    }
    *app.state::<DictationIndicatorRuntime>()
        .current
        .lock()
        .map_err(|error| error.to_string())? = Some(state.clone());
    let window = match app.get_webview_window(WINDOW_LABEL) {
        Some(window) => window,
        None => {
            tracing::info!(
                "[indicator] t={}ms show: window did not exist, creating it lazily (§2.6 — emit may precede page load)",
                uptime_ms()
            );
            create_window(&app)?
        }
    };
    log_window_snapshot("show/before set_size", &window, state.session_id, &state.status);
    window
        .set_size(LogicalSize::new(WIDTH, HEIGHT))
        .map_err(|error| error.to_string())?;
    log_window_snapshot(
        "show/after set_size, before position",
        &window,
        state.session_id,
        &state.status,
    );
    if let Err(error) = position_window(&app, &window) {
        tracing::error!("Could not position dictation indicator: {error}");
    }
    log_window_snapshot("show/after position, before show()", &window, state.session_id, &state.status);
    window.show().map_err(|error| error.to_string())?;
    log_window_snapshot("show/after show()", &window, state.session_id, &state.status);
    log_window_above(&window);
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2_app_kit::{NSStatusWindowLevel, NSWindow};

        let native_window: &NSWindow = &*window.ns_window().map_err(|error| error.to_string())?.cast();
        native_window.setLevel(NSStatusWindowLevel);
        native_window.orderFrontRegardless();
    }
    if let Err(error) = window.emit("dictation-indicator-state", &state) {
        tracing::error!("Could not update dictation indicator: {error}");
    }
    tracing::info!(
        "[indicator] t={}ms show done: session={} status={} emitted state (title={:?}, url={:?})",
        uptime_ms(),
        state.session_id,
        state.status,
        window.title(),
        window.url()
    );
    Ok(())
}

#[tauri::command]
pub fn get_dictation_indicator_state(app: tauri::AppHandle) -> Result<Option<DictationIndicatorPayload>, String> {
    app.state::<DictationIndicatorRuntime>()
        .current
        .lock()
        .map(|state| state.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn dictation_indicator_ready(window: tauri::WebviewWindow) {
    tracing::info!(
        "Dictation indicator webview ready: label={}, url={:?}",
        window.label(),
        window.url()
    );
}

#[tauri::command]
pub fn hide_dictation_indicator(app: tauri::AppHandle, session_id: u64) -> Result<(), String> {
    let runtime = app.state::<DictationIndicatorRuntime>();
    let mut current = runtime.current.lock().map_err(|error| error.to_string())?;
    let (current_session, current_status) = current
        .as_ref()
        .map(|state| (Some(state.session_id), state.status.clone()))
        .unwrap_or((None, "none".to_string()));
    tracing::info!(
        "[indicator] t={}ms hide requested: session={session_id} (current session={current_session:?} status={current_status})",
        uptime_ms()
    );
    if current.as_ref().is_some_and(|state| state.session_id == session_id) {
        *current = None;
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            log_window_snapshot("hide/before hide()", &window, session_id, &current_status);
            window.hide().map_err(|error| error.to_string())?;
            log_window_snapshot("hide/after hide()", &window, session_id, &current_status);
        } else {
            tracing::info!("[indicator] t={}ms hide: no window to hide", uptime_ms());
        }
    } else {
        tracing::info!(
            "[indicator] t={}ms hide ignored: stale session {session_id} (current={current_session:?})",
            uptime_ms()
        );
    }
    Ok(())
}
