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
/// The floating control (resting orb), docs/dictation-control-plan.md. Opt-in,
/// off by default, subordinate to `ENABLED_KEY` (owner ruling 1). Tauri store,
/// not WebView2 localStorage (ROADMAP "Preferences can silently stop persisting").
const CONTROL_ENABLED_KEY: &str = "dictation_control_enabled";
/// Physical top-left of the resting orb, `{ "x": i32, "y": i32 }`. Our own key
/// is authoritative: tauri-plugin-window-state also records this label, but it
/// records every move — the pill's placement included — so its entry is never
/// read (control plan §2.8).
const CONTROL_POSITION_KEY: &str = "dictation_control_position";
const STATUS_IDLE: &str = "idle";
// Logical px. The pill inside is content-sized and centred, so the window is
// only a transparent, click-through bound; 400 fits "Listening · release to
// finish · EN · 0:07 · ⌨" and the "Still transcribing — wait" hint without
// truncation (plan §4, checked against docs/screenshots/indicator/).
const WIDTH: f64 = 400.0;
const HEIGHT: f64 = 64.0;
/// Logical px of the resting orb's square window. WIDTH, HEIGHT and ORB are
/// the single source of truth for the window's size.
const ORB: f64 = 40.0;
const BOTTOM_MARGIN: f64 = 48.0;

/// What the window currently draws. The window is ALWAYS sized to the visible
/// shape — never pill-sized while only an orb is drawn. That tight window is
/// the whole hit-testing mechanism: there is no per-pixel hit-test code, no
/// `WM_NCHITTEST` handling and no `SetWindowRgn`. Reason (control plan §2.4,
/// spike criterion C6, 2026-09-17): with click-through cleared, a 400×64
/// clickable window ate every click in its rectangle — a click 40 px beside
/// the visible pill never reached the application underneath. A tight orb
/// loses only the corners of its own 40 px square.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowMode {
    Orb,
    Pill,
}

/// Which side of the window stays fixed while it grows or shrinks.
#[cfg_attr(not(test), allow(dead_code))] // first caller: control plan Prompt 2 (click-started sessions grow in place)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Anchor {
    Left,
    Right,
}

/// Physical window size for `mode` on a monitor with DPI `scale`.
fn window_size(mode: WindowMode, scale: f64) -> (u32, u32) {
    let (width, height) = match mode {
        WindowMode::Orb => (ORB, ORB),
        WindowMode::Pill => (WIDTH, HEIGHT),
    };
    ((width * scale).round() as u32, (height * scale).round() as u32)
}

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
    /// "formatting-skipped" — "completed" delivered the raw transcript because
    /// the Ollama pass failed or timed out.
    pub fallback: Option<String>,
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

/// The floating control is on only when its own setting is on AND the
/// indicator it lives in is on. Default off: with it off every code path in
/// this file behaves exactly as before the control existed.
pub fn is_control_enabled(app: &tauri::AppHandle) -> bool {
    is_enabled(app)
        && app
            .store(STORE_FILENAME)
            .ok()
            .and_then(|store| store.get(CONTROL_ENABLED_KEY))
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
}

fn stored_orb_position(app: &tauri::AppHandle) -> Option<(i32, i32)> {
    let value = app.store(STORE_FILENAME).ok()?.get(CONTROL_POSITION_KEY)?;
    let x = i32::try_from(value.get("x")?.as_i64()?).ok()?;
    let y = i32::try_from(value.get("y")?.as_i64()?).ok()?;
    Some((x, y))
}

fn store_orb_position(app: &tauri::AppHandle, position: (i32, i32)) {
    let Ok(store) = app.store(STORE_FILENAME) else {
        return;
    };
    store.set(CONTROL_POSITION_KEY, serde_json::json!({ "x": position.0, "y": position.1 }));
    if let Err(error) = store.save() {
        tracing::warn!("[indicator] could not save the orb position: {error}");
    }
}

/// Where the resting orb goes, physically sized for the monitor it lands on.
/// A stored position wins and is re-clamped to the monitor that contains it;
/// when there is none, or its monitor is gone, the default is used (primary
/// monitor, bottom-right) and written back so the orb does not wander between
/// monitors from one rest to the next.
fn resting_rect(app: &tauri::AppHandle, window: &WebviewWindow) -> Option<(i32, i32, u32, u32)> {
    if let Some((x, y)) = stored_orb_position(app) {
        // Probe with a point inside the orb, not its corner, so an orb flush
        // with a monitor's edge still finds that monitor.
        let probe = ORB / 2.0;
        if let Ok(Some(monitor)) = window.monitor_from_point(f64::from(x) + probe, f64::from(y) + probe) {
            let size = window_size(WindowMode::Orb, monitor.scale_factor());
            let position = monitor.position();
            let monitor_size = monitor.size();
            let (x, y) = clamp_to_monitor(
                (x, y),
                size,
                (position.x, position.y),
                (monitor_size.width, monitor_size.height),
            );
            return Some((x, y, size.0, size.1));
        }
    }
    let monitor = window.primary_monitor().ok().flatten().or_else(|| target_monitor(window).0)?;
    let position = monitor.position();
    let monitor_size = monitor.size();
    let rect = orb_default_rect(
        (position.x, position.y),
        (monitor_size.width, monitor_size.height),
        monitor.scale_factor(),
    );
    store_orb_position(app, (rect.0, rect.1));
    Some(rect)
}

/// Enters resting mode: the window becomes the orb. `position_window` does
/// NOT run here — it would re-place the window bottom-centre. Click-through
/// is cleared because the tight window is the hit-testing mechanism (see
/// `WindowMode`). Only reached when `is_control_enabled`.
fn enter_resting(app: &tauri::AppHandle, window: &WebviewWindow, session_id: u64) -> Result<(), String> {
    let state = DictationIndicatorPayload {
        session_id,
        status: STATUS_IDLE.to_string(),
        ..Default::default()
    };
    *app.state::<DictationIndicatorRuntime>()
        .current
        .lock()
        .map_err(|error| error.to_string())? = Some(state.clone());
    let Some((x, y, width, height)) = resting_rect(app, window) else {
        return Err("no monitor to rest the dictation control on".to_string());
    };
    window.set_ignore_cursor_events(false).map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    raise_topmost(window);
    log_window_state("rest", window, session_id, STATUS_IDLE);
    if let Err(error) = window.emit("dictation-indicator-state", &state) {
        tracing::error!("Could not update dictation indicator: {error}");
    }
    Ok(())
}

/// Physical rectangle `(x, y, width, height)` of the pill, bottom-centre on a
/// monitor at `monitor_pos`/`monitor_size` (physical px) with DPI `scale`.
/// Pure so it can be unit-tested; `position_window` applies it.
fn pill_rect(monitor_pos: (i32, i32), monitor_size: (u32, u32), scale: f64) -> (i32, i32, u32, u32) {
    let (width, height) = window_size(WindowMode::Pill, scale);
    let margin = (BOTTOM_MARGIN * scale).round() as i32;
    let x = monitor_pos.0 + (monitor_size.0 as i32 - width as i32) / 2;
    let y = monitor_pos.1 + monitor_size.1 as i32 - height as i32 - margin;
    (x, y, width, height)
}

/// Physical rectangle of the resting orb the first time it is ever shown:
/// bottom-right of the monitor, inset on both axes by the same margin the
/// pill keeps from the bottom edge.
fn orb_default_rect(monitor_pos: (i32, i32), monitor_size: (u32, u32), scale: f64) -> (i32, i32, u32, u32) {
    let (width, height) = window_size(WindowMode::Orb, scale);
    let margin = (BOTTOM_MARGIN * scale).round() as i32;
    let x = monitor_pos.0 + monitor_size.0 as i32 - width as i32 - margin;
    let y = monitor_pos.1 + monitor_size.1 as i32 - height as i32 - margin;
    (x, y, width, height)
}

/// Moves `origin` the least distance that puts a `size` rectangle fully inside
/// the monitor. A stored orb position is re-clamped on every entry into
/// resting mode, so a changed display layout can never leave it off-screen.
fn clamp_to_monitor(origin: (i32, i32), size: (u32, u32), monitor_pos: (i32, i32), monitor_size: (u32, u32)) -> (i32, i32) {
    let max_x = monitor_pos.0 + (monitor_size.0 as i32 - size.0 as i32).max(0);
    let max_y = monitor_pos.1 + (monitor_size.1 as i32 - size.1 as i32).max(0);
    (origin.0.clamp(monitor_pos.0, max_x), origin.1.clamp(monitor_pos.1, max_y))
}

/// The side of `rect` nearest a vertical screen edge — the side that stays
/// put when the window grows out of the orb, so the pill grows away from the
/// edge and towards the middle of the screen.
#[cfg_attr(not(test), allow(dead_code))] // first caller: control plan Prompt 2
fn nearest_anchor(rect: (i32, i32, u32, u32), monitor_pos: (i32, i32), monitor_size: (u32, u32)) -> Anchor {
    let left_gap = rect.0 - monitor_pos.0;
    let right_gap = (monitor_pos.0 + monitor_size.0 as i32) - (rect.0 + rect.2 as i32);
    if right_gap < left_gap {
        Anchor::Right
    } else {
        Anchor::Left
    }
}

/// The anchor rule (control plan §2.4; spike criterion C7): when the window
/// changes size it must keep the visible content stationary. The spike
/// resized around the window origin and the content visibly jumped from the
/// window's left edge to its centre. So the new origin keeps the `anchor`
/// edge and the vertical centre of `current` fixed; only the far side moves.
/// Growing orb → pill and shrinking pill → orb use the SAME `anchor` — the
/// caller remembers it from the grow; recomputing `nearest_anchor` from the
/// wider pill can pick the other side and land the orb somewhere else.
#[cfg_attr(not(test), allow(dead_code))] // first caller: control plan Prompt 2
fn anchored_origin(current: (i32, i32, u32, u32), new_size: (u32, u32), anchor: Anchor) -> (i32, i32) {
    let x = match anchor {
        Anchor::Left => current.0,
        Anchor::Right => current.0 + current.2 as i32 - new_size.0 as i32,
    };
    let y = current.1 + (current.3 as i32 - new_size.1 as i32) / 2;
    (x, y)
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
        let window = create_window(&app)?;
        if is_control_enabled(&app) {
            enter_resting(&app, &window, 0)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_dictation_control_enabled(app: tauri::AppHandle) -> bool {
    // The stored preference, not `is_control_enabled`: Settings shows what the
    // user chose even while the indicator it depends on is off.
    app.store(STORE_FILENAME)
        .ok()
        .and_then(|store| store.get(CONTROL_ENABLED_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

/// `async fn` for the same reason as the three indicator commands: it can
/// create the window, and `WebviewWindowBuilder::build()` deadlocks inside a
/// synchronous command on Windows. No mutex guard is held across an await.
#[tauri::command]
pub async fn set_dictation_control_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_FILENAME).map_err(|error| error.to_string())?;
    store.set(CONTROL_ENABLED_KEY, serde_json::Value::Bool(enabled));
    store.save().map_err(|error| error.to_string())?;
    if !is_enabled(&app) {
        // Subordinate to the indicator: no indicator window, no orb.
        return Ok(());
    }
    let runtime = app.state::<DictationIndicatorRuntime>();
    if enabled {
        // Rest now only if nothing is on screen; a running session folds back
        // to the orb by itself when it ends.
        let idle = {
            let current = runtime.current.lock().map_err(|error| error.to_string())?;
            current.as_ref().is_none_or(|state| state.status == STATUS_IDLE)
        };
        if idle {
            let window = match app.get_webview_window(WINDOW_LABEL) {
                Some(window) => window,
                None => create_window(&app)?,
            };
            enter_resting(&app, &window, 0)?;
        }
    } else {
        let was_resting = {
            let mut current = runtime.current.lock().map_err(|error| error.to_string())?;
            let resting = current.as_ref().is_some_and(|state| state.status == STATUS_IDLE);
            if resting {
                *current = None;
            }
            resting
        };
        if was_resting {
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                window.hide().map_err(|error| error.to_string())?;
                // Back to today's click-through pill; position_window restores
                // the pill size on the next show.
                window.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
                log_window_state("rest off", &window, 0, STATUS_IDLE);
            }
        }
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
    if is_control_enabled(&app) {
        // Leaving resting mode: the pill is not a click target yet (control
        // plan Prompt 2), and a pill-sized clickable window is exactly what C6
        // rules out — so the pill is click-through, as it always was.
        window.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
    }
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
    if matches && current_status == STATUS_IDLE {
        // Already folded back to the resting orb under this session id; a
        // repeated hide must not fade the orb out.
        tracing::debug!("[indicator] hide ignored: session {session_id} is already resting");
        return Ok(());
    }
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
    if is_control_enabled(&app) {
        // Fold back to the resting orb instead of hiding. With the control
        // off this branch is never taken and the pill hides exactly as before.
        return enter_resting(&app, &window, session_id);
    }
    window.hide().map_err(|error| error.to_string())?;
    log_window_state("hide", &window, session_id, &current_status);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        anchored_origin, clamp_to_monitor, nearest_anchor, orb_default_rect, pill_rect, window_size, Anchor, WindowMode,
    };

    #[test]
    fn window_size_is_a_pure_function_of_mode_and_scale() {
        for (scale, orb, pill) in [
            (1.0, (40, 40), (400, 64)),
            (1.25, (50, 50), (500, 80)),
            (1.5, (60, 60), (600, 96)),
            (2.0, (80, 80), (800, 128)),
        ] {
            assert_eq!(window_size(WindowMode::Orb, scale), orb, "orb at {scale}");
            assert_eq!(window_size(WindowMode::Pill, scale), pill, "pill at {scale}");
        }
    }

    #[test]
    fn pill_rect_uses_the_pill_mode_size() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let (_, _, width, height) = pill_rect((0, 0), (3840, 2160), scale);
            assert_eq!((width, height), window_size(WindowMode::Pill, scale));
        }
    }

    #[test]
    fn orb_default_rect_is_bottom_right_inset_by_the_pill_margin() {
        // 1920×1080 at 100 %: 40 px orb, 48 px from the right and the bottom.
        assert_eq!(orb_default_rect((0, 0), (1920, 1080), 1.0), (1832, 992, 40, 40));
        // 3440×1440 at 150 % — the spike machine: 60 px orb, margin 72.
        assert_eq!(orb_default_rect((0, 0), (3440, 1440), 1.5), (3308, 1308, 60, 60));
        // Same bottom inset as the pill on the same monitor.
        let (_, pill_y, _, pill_h) = pill_rect((0, 0), (3440, 1440), 1.5);
        let (_, orb_y, _, orb_h) = orb_default_rect((0, 0), (3440, 1440), 1.5);
        assert_eq!(pill_y + pill_h as i32, orb_y + orb_h as i32);
        // A monitor to the left of the primary, and one offset to the right at 125 %.
        assert_eq!(orb_default_rect((-1920, 0), (1920, 1080), 1.0), (-88, 992, 40, 40));
        assert_eq!(
            orb_default_rect((3440, 200), (1920, 1080), 1.25),
            (3440 + 1920 - 50 - 60, 200 + 1080 - 50 - 60, 50, 50)
        );
    }

    #[test]
    fn clamp_keeps_the_orb_on_its_monitor() {
        let monitor = ((0, 0), (1920, 1080));
        assert_eq!(clamp_to_monitor((500, 500), (40, 40), monitor.0, monitor.1), (500, 500));
        assert_eq!(clamp_to_monitor((-30, -30), (40, 40), monitor.0, monitor.1), (0, 0));
        assert_eq!(clamp_to_monitor((1900, 1070), (40, 40), monitor.0, monitor.1), (1880, 1040));
        // Second monitor at negative x: clamped into ITS bounds, not the primary's.
        assert_eq!(
            clamp_to_monitor((-2000, 1100), (40, 40), (-1920, 0), (1920, 1080)),
            (-1920, 1040)
        );
        // A rectangle larger than the monitor pins to the monitor's origin.
        assert_eq!(clamp_to_monitor((10, 10), (4000, 40), monitor.0, monitor.1), (0, 10));
    }

    #[test]
    fn nearest_anchor_picks_the_closer_vertical_edge() {
        let monitor = ((0, 0), (3440, 1440));
        assert_eq!(nearest_anchor((100, 700, 60, 60), monitor.0, monitor.1), Anchor::Left);
        assert_eq!(nearest_anchor((3308, 1308, 60, 60), monitor.0, monitor.1), Anchor::Right);
        // Dead centre: a tie goes left, so the pill grows rightwards.
        assert_eq!(nearest_anchor((1690, 700, 60, 60), monitor.0, monitor.1), Anchor::Left);
        // Second monitor at negative x: its own edges decide.
        assert_eq!(nearest_anchor((-1900, 500, 40, 40), (-1920, 0), (1920, 1080)), Anchor::Left);
        assert_eq!(nearest_anchor((-100, 500, 40, 40), (-1920, 0), (1920, 1080)), Anchor::Right);
    }

    #[test]
    fn anchored_origin_grows_out_of_the_orb_without_moving_it() {
        // Orb near the left edge at 150 %: the pill grows rightwards, the
        // orb's left edge and vertical centre stay where they were.
        let orb = (100, 700, 60, 60);
        let pill = window_size(WindowMode::Pill, 1.5);
        let origin = anchored_origin(orb, pill, Anchor::Left);
        assert_eq!(origin, (100, 700 + 30 - 48));
        assert_eq!(
            origin.1 + pill.1 as i32 / 2,
            orb.1 + orb.3 as i32 / 2,
            "vertical centre unchanged"
        );

        // Orb at the default bottom-right: the pill grows leftwards, the
        // orb's RIGHT edge and vertical centre stay where they were.
        let orb = (3308, 1308, 60, 60);
        let origin = anchored_origin(orb, pill, Anchor::Right);
        assert_eq!(origin, (3308 + 60 - 600, 1308 + 30 - 48));
        assert_eq!(origin.0 + pill.0 as i32, orb.0 + orb.2 as i32, "right edge unchanged");
    }

    #[test]
    fn anchored_origin_round_trips_pill_to_orb_with_the_remembered_anchor() {
        let cases = [
            ((100, 700, 60, 60), Anchor::Left, 1.5, ((0, 0), (3440, 1440))),
            ((3308, 1308, 60, 60), Anchor::Right, 1.5, ((0, 0), (3440, 1440))),
            // Second monitor at negative x, 100 %.
            ((-1900, 500, 40, 40), Anchor::Left, 1.0, ((-1920, 0), (1920, 1080))),
            ((-100, 500, 40, 40), Anchor::Right, 1.0, ((-1920, 0), (1920, 1080))),
            // Offset monitor at 125 %.
            ((5200, 900, 50, 50), Anchor::Right, 1.25, ((3440, 200), (1920, 1080))),
        ];
        for (orb, anchor, scale, monitor) in cases {
            assert_eq!(nearest_anchor(orb, monitor.0, monitor.1), anchor, "anchor for {orb:?}");
            let pill_size = window_size(WindowMode::Pill, scale);
            let orb_size = window_size(WindowMode::Orb, scale);
            let grown = anchored_origin(orb, pill_size, anchor);
            let pill = (grown.0, grown.1, pill_size.0, pill_size.1);
            let back = anchored_origin(pill, orb_size, anchor);
            assert_eq!(back, (orb.0, orb.1), "round trip for {orb:?}");
        }
        // Why the anchor is remembered, not recomputed: an orb left of centre
        // grows into a pill whose nearest edge is the RIGHT one.
        let orb = (1600, 700, 60, 60);
        let monitor = ((0, 0), (3440, 1440));
        assert_eq!(nearest_anchor(orb, monitor.0, monitor.1), Anchor::Left);
        let grown = anchored_origin(orb, (600, 96), Anchor::Left);
        assert_eq!(
            nearest_anchor((grown.0, grown.1, 600, 96), monitor.0, monitor.1),
            Anchor::Right
        );
    }

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
