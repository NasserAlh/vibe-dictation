use crate::config::STORE_FILENAME;
use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

/// Label of the pill window; `cmd::audio` targets it with the level event.
pub(crate) const WINDOW_LABEL: &str = "dictation-indicator";
const ENABLED_KEY: &str = "dictation_indicator_enabled";
// Logical px. The pill inside is content-sized and centred, so the window is
// only a transparent, click-through bound; 400 fits "Listening · release to
// finish · EN · 0:07 · ⌨" and the "Still transcribing — wait" hint without
// truncation (plan §4, checked against docs/screenshots/indicator/).
const WIDTH: f64 = 400.0;
const HEIGHT: f64 = 64.0;
const BOTTOM_MARGIN: f64 = 48.0;

// Monotonic clock for the `[indicator]` log lines (ms since app setup), so a
// show and its hide can be paired and timed from the log alone. Anchored in
// `initialize`.
static PROCESS_START: LazyLock<Instant> = LazyLock::new(Instant::now);

fn uptime_ms() -> u128 {
    PROCESS_START.elapsed().as_millis()
}

/// The one info line per show and per hide: timestamp, session, status,
/// visibility, physical position and size. Enough to diagnose "the pill did
/// not appear" from the log without the Prompt 0 instrumentation.
fn log_window_state(action: &str, window: &WebviewWindow, session_id: u64, status: &str) {
    tracing::info!(
        "[indicator] t={}ms {action}: session={session_id} status={status} visible={:?} position={:?} size={:?}",
        uptime_ms(),
        window.is_visible().ok(),
        window.outer_position().ok().map(|position| (position.x, position.y)),
        window.outer_size().ok().map(|size| (size.width, size.height)),
    );
}

/// Status-only payload for the pill. Never carries transcript text (owner
/// decision). The optional fields feed the richer states of plan §4; the
/// frontend fills them and the pill component renders them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationIndicatorPayload {
    pub session_id: u64,
    pub status: String,
    /// "type" | "clipboard" — destination glyph while recording, wording of "completed".
    pub output: Option<String>,
    /// Error text, the transient "Still transcribing — wait" hint, or the ready-flash shortcuts.
    pub message: Option<String>,
    /// "en" | "ar" — language badge.
    pub lang: Option<String>,
    /// "loading-model" | "transcribing" | "formatting" — sub-phase of "transcribing".
    pub phase: Option<String>,
    /// Word count shown with "completed".
    pub words: Option<u32>,
    /// "release" | "toggle" — which stop hint to show for the first seconds of recording.
    pub hint: Option<String>,
    /// Accelerator of the active language ("F9"), for the toggle hint and the ready flash.
    pub shortcut: Option<String>,
    /// "warning" (amber: no mic, focus lost) | "error" (red) — ring colour of "error".
    pub severity: Option<String>,
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

/// Physical rectangle `(x, y, width, height)` of the pill, bottom-centre on a
/// monitor at `monitor_pos`/`monitor_size` (physical px) with DPI `scale`.
/// Pure so it can be unit-tested; `position_window` applies it.
fn pill_rect(monitor_pos: (i32, i32), monitor_size: (u32, u32), scale: f64) -> (i32, i32, u32, u32) {
    let width = (WIDTH * scale).round() as u32;
    let height = (HEIGHT * scale).round() as u32;
    let margin = (BOTTOM_MARGIN * scale).round() as i32;
    let x = monitor_pos.0 + (monitor_size.0 as i32 - width as i32) / 2;
    let y = monitor_pos.1 + monitor_size.1 as i32 - height as i32 - margin;
    (x, y, width, height)
}

/// Monitor the pill should appear on, plus the name of the strategy that won:
/// the monitor holding the foreground window (where the user is typing), else
/// the monitor under the cursor, else the primary (plan §2.4).
fn target_monitor(window: &WebviewWindow) -> (Option<tauri::Monitor>, &'static str) {
    #[cfg(windows)]
    if let Some(monitor) = foreground_window_monitor(window) {
        return (Some(monitor), "foreground-window");
    }
    if let Ok(cursor) = window.cursor_position() {
        if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
            return (Some(monitor), "cursor");
        }
    }
    (window.primary_monitor().ok().flatten(), "primary")
}

/// Monitor under the centre of the foreground window, if there is one and it
/// is on-screen (a minimized window sits at -32000,-32000 and yields `None`).
#[cfg(windows)]
fn foreground_window_monitor(window: &WebviewWindow) -> Option<tauri::Monitor> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let foreground = crate::cmd::app::foreground_window();
    if foreground == 0 {
        return None;
    }
    let mut rect = RECT::default();
    // SAFETY: `foreground` is a window handle returned by the OS a moment ago
    // and `rect` is a valid out-pointer that GetWindowRect only writes to.
    unsafe { GetWindowRect(HWND(foreground as *mut _), &mut rect) }.ok()?;
    let centre_x = f64::from(rect.left) + f64::from(rect.right - rect.left) / 2.0;
    let centre_y = f64::from(rect.top) + f64::from(rect.bottom - rect.top) / 2.0;
    window.monitor_from_point(centre_x, centre_y).ok().flatten()
}

/// Re-raises the pill to the top of the topmost band (plan §2.3). tao's
/// `set_visible(true)` only calls `ShowWindow` and its style refresh passes
/// `SWP_NOZORDER`, so z-order is never touched; and `set_always_on_top(true)`
/// is a no-op when the flag is already set (tao diffs the flag and returns
/// early). Among topmost windows the last one *raised* wins, so anything
/// topmost raised after the pill's last raise (Task Manager "Always on top",
/// Teams call controls, PiP video, overlays) would otherwise cover it.
#[cfg(windows)]
fn raise_topmost(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    let Ok(hwnd) = window.hwnd() else {
        tracing::warn!("[indicator] raise_topmost: could not get pill HWND");
        return;
    };
    // tauri's HWND comes from its own `windows` crate version; rewrap the raw pointer.
    // SAFETY: `hwnd` is a live window handle owned by this process; the call
    // passes no pointers and SWP_NOMOVE | SWP_NOSIZE ignore the zero geometry.
    let result = unsafe {
        SetWindowPos(
            HWND(hwnd.0),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    };
    if let Err(error) = result {
        tracing::warn!("[indicator] raise_topmost: SetWindowPos failed: {error}");
    }
}

#[cfg(not(windows))]
fn raise_topmost(_window: &WebviewWindow) {}

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

    // No LogicalSize here: position_window below moves the window and then
    // sizes it physically for the target monitor's DPI (plan §2.4).
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
    // Anchor the log clock as early as possible.
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
                ..Default::default()
            });
        }
        if let Err(error) = create_window(app) {
            tracing::error!("Could not initialize dictation indicator: {error}");
        } else {
            tracing::info!("Dictation indicator window initialized in starting state");
        }
    }
}

/// Places the pill bottom-centre on the target monitor, then sizes it for that
/// monitor's DPI. Order matters (plan §2.4): move first, then set a *physical*
/// size computed from the target monitor's scale. A `LogicalSize` set before
/// the move is converted with the window's *current* monitor scale and comes
/// out wrong (clipped label) when the two monitors differ.
fn position_window(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let (monitor, strategy) = target_monitor(window);

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let (x, y, width, height) = pill_rect(
            (monitor_position.x, monitor_position.y),
            (monitor_size.width, monitor_size.height),
            scale,
        );
        tracing::debug!(
            "[indicator] position_window: strategy={strategy} monitor(name={:?}, position={:?}, size={:?}, scale={scale}) -> rect=({x},{y},{width}x{height})",
            monitor.name(),
            monitor_position,
            monitor_size,
        );
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        window
            .set_size(PhysicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
    } else if let Some(main) = app.get_webview_window("main") {
        tracing::debug!("[indicator] position_window: no monitor found by any strategy; falling back to main window position");
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

// The three commands below are `async fn` on purpose (plan §2.7): an async
// command runs off the main thread, and `create_window` →
// `WebviewWindowBuilder::build()` deadlocks on Windows when called from a
// synchronous command (tauri 2.10.3 webview_window.rs, "Known issues").
// Re-enabling the indicator in Settings froze the whole app before this.
// Rule for these bodies: never hold the `DictationIndicatorRuntime` mutex
// guard across an `.await`.
#[tauri::command]
pub async fn set_dictation_indicator_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
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
pub async fn show_dictation_indicator(app: tauri::AppHandle, state: DictationIndicatorPayload) -> Result<(), String> {
    if !is_enabled(&app) {
        tracing::debug!("Dictation indicator show skipped because it is disabled");
        return Ok(());
    }
    *app.state::<DictationIndicatorRuntime>()
        .current
        .lock()
        .map_err(|error| error.to_string())? = Some(state.clone());
    let window = match app.get_webview_window(WINDOW_LABEL) {
        Some(window) => window,
        None => {
            // Lazy create (indicator re-enabled in Settings). The emit below
            // may precede page load; the component recovers by fetching the
            // current state after it registers its listener (plan §2.6).
            tracing::debug!("[indicator] show: window did not exist, creating it");
            create_window(&app)?
        }
    };
    if let Err(error) = position_window(&app, &window) {
        tracing::error!("Could not position dictation indicator: {error}");
    }
    window.show().map_err(|error| error.to_string())?;
    raise_topmost(&window);
    log_window_state("show", &window, state.session_id, &state.status);
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
pub async fn hide_dictation_indicator(app: tauri::AppHandle, session_id: u64) -> Result<(), String> {
    let runtime = app.state::<DictationIndicatorRuntime>();
    // Scoped so the guard is dropped before the fade `.await` below.
    let (matches, current_session, current_status) = {
        let current = runtime.current.lock().map_err(|error| error.to_string())?;
        let (current_session, current_status) = current
            .as_ref()
            .map(|state| (Some(state.session_id), state.status.clone()))
            .unwrap_or((None, "none".to_string()));
        (current_session == Some(session_id), current_session, current_status)
    };
    if !matches {
        tracing::debug!("[indicator] hide ignored: stale session {session_id} (current={current_session:?})");
        return Ok(());
    }
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        tracing::debug!("[indicator] hide: no window to hide (session {session_id})");
        if let Ok(mut current) = runtime.current.lock() {
            *current = None;
        }
        return Ok(());
    };

    // Fade before hide: tell the pill to fade out, give it 150 ms, then hide
    // the window — unless a newer session was shown in the meantime, in which
    // case the newer show owns the window and this hide stands down.
    if let Err(error) = app.emit_to(WINDOW_LABEL, "dictation-indicator-hide", session_id) {
        tracing::warn!("[indicator] could not emit fade event: {error}");
    }
    tokio::time::sleep(Duration::from_millis(150)).await;
    {
        let mut current = runtime.current.lock().map_err(|error| error.to_string())?;
        if !current.as_ref().is_some_and(|state| state.session_id == session_id) {
            tracing::debug!(
                "[indicator] hide superseded during fade: session {session_id} (current={:?})",
                current.as_ref().map(|state| state.session_id)
            );
            return Ok(());
        }
        *current = None;
    }
    window.hide().map_err(|error| error.to_string())?;
    log_window_state("hide", &window, session_id, &current_status);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::pill_rect;

    #[test]
    fn pill_rect_scale_1_0() {
        // 1920×1080 at 100 %: 400×64, centred, 48 px above the bottom.
        assert_eq!(pill_rect((0, 0), (1920, 1080), 1.0), (760, 968, 400, 64));
    }

    #[test]
    fn pill_rect_scale_1_25() {
        // 2560×1440 at 125 %: 500×80, margin 60.
        assert_eq!(pill_rect((0, 0), (2560, 1440), 1.25), (1030, 1300, 500, 80));
    }

    #[test]
    fn pill_rect_scale_1_5() {
        // 3440×1440 at 150 % — the Prompt 0 machine: 600×96, margin 72.
        assert_eq!(pill_rect((0, 0), (3440, 1440), 1.5), (1420, 1272, 600, 96));
    }

    #[test]
    fn pill_rect_scale_2_0() {
        // 3840×2160 at 200 %: 800×128, margin 96.
        assert_eq!(pill_rect((0, 0), (3840, 2160), 2.0), (1520, 1936, 800, 128));
    }

    #[test]
    fn pill_rect_second_monitor_at_negative_x() {
        // A 1920×1080 monitor to the left of the primary: x stays negative.
        assert_eq!(pill_rect((-1920, 0), (1920, 1080), 1.0), (-1160, 968, 400, 64));
    }

    #[test]
    fn pill_rect_second_monitor_offset_and_scaled() {
        // Monitor to the right of a 3440-wide primary, at 125 %.
        assert_eq!(
            pill_rect((3440, 200), (1920, 1080), 1.25),
            (3440 + 710, 200 + 1080 - 80 - 60, 500, 80)
        );
    }
}
