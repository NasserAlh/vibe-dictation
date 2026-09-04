# Dictation indicator — manual test matrix

Companion to [dictation-indicator-plan.md](dictation-indicator-plan.md) §2. One
row per case; the "cause" column says which §2 item the row proves or rules
out. Written for Prompt 0 (instrumented build), re-run at Prompt 5 closeout.
The "expected" column still describes the **pre-fix** code so the observed
values read as before/after; the Prompt 0 `[indicator]` instrumentation was
trimmed at closeout to one info line per show and per hide (timestamp,
session, status, visible, position, size), so the detailed log lines quoted
below come from builds up to `4e7121f`.

## How to run

```console
# from desktop/, in a shell with the MSVC environment loaded
$env:RUST_LOG = "vibe=debug"
pnpm exec tauri dev
```

- **Rust lines** start with `[indicator] t=<ms>ms` and print to the dev
  console (and to `%APPDATA%\net.nasserhub.dictation\log_<date>.txt`). `t` is
  ms since app setup.
- **Frontend lines** start with `[indicator] t=<ms>ms vis=<visibilityState>`
  (main window) or `[indicator-window] …` (the pill's own webview). Console
  output is **not** forwarded to the Rust log. Open DevTools on the main
  window (right-click → Inspect, or Ctrl+Shift+I) *before* the case starts —
  leave it open for the whole run, including case (e). To read the pill's
  console, right-click is impossible (click-through); use
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and
  open `http://127.0.0.1:9222` in a Chromium browser.
- Every row assumes: indicator enabled (Settings → Dictation), a model
  selected, hotkeys F9 (EN) / F10 (AR) unless stated.
- Rows c, e, h and i can be driven without a microphone through the same
  Tauri commands the UI calls (`show_dictation_indicator`,
  `set_dictation_indicator_enabled`, …) over the WebView2 debug port; rows
  a, b, f and g need a person at the keyboard, row d a second monitor.

## Matrix

| # | Case | Steps | Expected (today's code) | Cause | Observed | Log excerpt |
|---|------|-------|-------------------------|-------|----------|-------------|
| a | Push-to-talk phrase under 1 s | Push-to-talk mode. Focus Word. Press F9, say one word, release within ~0.8 s. Repeat 5×. | "Listening…" is shown only after `start_record resolved`; with `sinceDownMs` in the hundreds the key is often already released, so the visible sequence is "Transcribing…" → "Inserted"/"Copied" (1.5 s) or nothing registers. Log shows `hotkey down accepted` → `get_audio_devices resolved` → `start_record resolved` → `showIndicator recording` → `hotkey up`, with `sinceDownMs` on `start_record resolved`. | 2.2 | Owner, 2026-09-05, after Prompts 1–4, toggle mode: "Listening" with the "F9 to stop" hint appeared on the key press and the hint faded after about 2 s; EN badge and red ring shown; transcribing and inserted colours correct; Arabic run also correct. `sinceDownMs` not read. | — |
| b | No default mic | Unplug / power off the mic (or Settings → Sound → disable the input device) so Windows has no default input. Press F9. Then re-enable, and repeat with the Bluetooth headset switching profiles (start speaking as it connects). | Nothing on screen, no notification. Main-window console shows `start FAILED silently: no default input device` (devices list without an `isDefault && isInput` entry) or `start FAILED silently: start_record threw` with the error. No Rust `[indicator] show requested` line at all. | 2.1 | Not run. Fix landed in `91c6f05`; the cpal error-text classifier is unverified against a real device failure. | — |
| c | Task Manager always-on-top over the pill | Task Manager → Options → Always on top. Drag it so it covers the bottom-centre of the monitor under the mouse. Click Task Manager once (raises it). Press F9 and dictate. | Rust `show/after show()` says `visible=Ok(true)` with the expected position, but the pill is not visible on screen. The `z-order:` line names Task Manager (`title="Task Manager" class="TaskManagerWindow"`) as the nearest visible window above the pill. Then close Task Manager: pill is visible on the next dictation. | 2.3 | Reproduced 2026-09-04 with a TopMost stand-in (see below). Re-run after `4fdb773`: only system helper windows above the pill; stand-in no longer covers it. **Closeout build (2026-09-05): pass** — pill shown at (1420,1272) 600×96 while the stand-in was up; Win32 z-order walk: pill visible-index 3 (`Tauri Window`), stand-in index 4, screenshot shows the pill drawn over the orange stand-in. | see below |
| d | Two monitors, different scale, mouse on the other one | Set monitor A to 100 %, B to 150 % (Settings → Display). Focus Word on A. Park the mouse on B. Press F9. Then swap (Word on B, mouse on A). | Pill appears on **B** (mouse monitor), not A where you type: `position_window: cursor=… monitor(name=B, scale=1.5)`. Check `show/after set_size` vs `show/after show()`: `outer_size` should be 280×64 × B's scale (420×96); if it is 280×64 × A's scale (280×64) the label is clipped — `window_monitor(scale)` and `cursor_monitor(scale)` differ in the snapshot lines. | 2.4 | Not testable: one monitor on this machine. Fix (foreground-window monitor, position before physical size) landed in `4fdb773` with unit tests. | — |
| e | Main window in tray for 6 minutes | Close the main window (goes to tray). Keep DevTools attached (open it first, then close the window — the DevTools window stays). Wait ≥ 6 min. Enable live dictation (type mode), focus Word, press F9 and dictate ~10 s in toggle mode, press F9 again. | Note `vis=` on every frontend line while hidden. If it says `hidden`: `live-dictation interval fired` shows `sinceLastMs` ≫ 1500 (1000 alignment at first, 60000 after 5 min) and `hide timer fired` shows `lateMs` in the hundreds or more, so "Inserted" lingers. If it says `visible`: timers fire on time and 2.5 is ruled out on this machine. | 2.5 | Refuted 2026-09-04: `visibilityState` stayed "visible", 272 timers within 1500–1516 ms. The window re-appearing during the wait was the owner opening it. **Closeout build (2026-09-05, short form): same** — window closed to tray (`isVisible=false`), `visibilityState` "visible", `hidden=false`, four chained 1500 ms timers at 1516 / 1515 / 1514 / 1501 ms. | see below |
| f | Fullscreen game / video | Start an exclusive-fullscreen game (or a YouTube video in browser fullscreen as the borderless control). Press F9 and dictate. | Exclusive fullscreen: Rust reports `visible=Ok(true)` but nothing is drawn over the game — expected, cannot be fixed. Borderless/browser fullscreen: pill should be visible; if not, the `z-order:` line names what is above. | 2.3 (documented limitation) | Not run. | — |
| g | Hotkey pressed while "Transcribing…" | Dictate a long phrase (~10 s, cold model so transcription takes a few seconds). The moment "Transcribing…" appears, press F9 again (push-to-talk: press and release; toggle: press once). | Press is dropped silently: `hotkey event received` followed by `hotkey down DROPPED by busy guard` with `stopping: true`. Pill keeps showing "Transcribing…" then "Inserted"/"Copied"; no new session, no feedback that the press was ignored. | 2.1 (third path) | Not run. Fix ("Still transcribing — wait" for 1 s) landed in `91c6f05`. | — |
| h | Indicator re-enabled in Settings, then dictate immediately | Settings → Dictation → indicator off, then on again (window is re-created). Press F9 within a second. | Pill webview console: `mounted; fetching initial state` … `listen registered`. If a `[indicator] show` fires between those two lines and before `initial state fetch resolved`, the window shows a stale or empty state until the next event. **Blocked by row (i) on Windows — the re-enable never completes.** | 2.6 | Fix (listen before fetch) landed in `4fdb773`. **Closeout build (2026-09-05): pass** — disable, re-enable (69.6 ms), then `show_dictation_indicator(recording)` 5.7 ms later; 1.5 s on, the freshly created pill rendered "Listening / release to finish / EN / 0:01". Driven through the same commands the Settings switch and the hotkey call, not a real key press. | — |
| i | Indicator re-enabled in Settings (Windows) | Settings → Dictation → indicator off, then on again. Then try any other action in the app (open a settings tab, press F9). | Nothing in the app responds any more: every Tauri command hangs, the app has to be killed. `set_dictation_indicator_enabled(true)` is a *synchronous* command that calls `WebviewWindowBuilder::build()`; tauri documents that this deadlocks on Windows from a sync command. Same code path as the lazy create inside `show_dictation_indicator` (indicator enabled while the window is missing). | new — 2.7 | Reproduced twice 2026-09-04. After `4fdb773` (async commands): off/on twice via the same command returned in 13–83 ms, app responsive, pill returned. **Closeout build (2026-09-05): pass** — off 14.6 / on 70.9 / off 11.0 / on 65.6 ms, IPC answered in 2.4 ms afterwards, indicator enabled. Settings switch click itself not exercised. | see below |

### Prompt 5 closeout, 2026-09-05

- Rows a (owner run), b, d, f, g keep the owner's observed values above; they
  need a microphone, a second monitor or a fullscreen game and were not
  re-run by the automation. Row f is documented as a known limitation in
  [debug.md](debug.md) (exclusive fullscreen hides every topmost window).
- Rows c, e (short form), h and i were re-run against the closeout build on
  2026-09-05 after the owner's own `tauri dev` instance (which had held port
  1420 without a debug port) was closed; all four pass — details in the
  observed column. Without the Prompt 0 z-order log, row c now uses a Win32
  `GetTopWindow`/`GW_HWNDNEXT` walk over visible top-level windows plus a
  screenshot of the pill over the stand-in.
- Instrumentation trimmed to one info line per show and per hide, e.g.
  `[indicator] t=68394ms show: session=0 status=error visible=Some(true)
  position=Some((1420, 1272)) size=Some((600, 96))` (taken from the owner's
  instance after it rebuilt with the closeout code). Everything else from
  Prompt 0 — snapshots at each step, the z-order walk, the frontend
  `console.info` timing lines — is gone.
- Full check set at closeout: cargo fmt / clippy / 41 tests, check_i18n,
  i18n:generate, tsc, eslint, 66 vitest tests — all green. No dependency
  change against `main`.

### Owner microphone run, 2026-09-05 (after Prompts 1–4)

Dev build, toggle mode, English then Arabic. Everything worked: "Listening"
on the key press with the "F9 to stop" hint for about 2 s, EN badge, red
ring, correct colours for transcribing and inserted, Arabic labels correct.
The five-bar level meter followed the voice and settled on silence — the
cpal → atomic → pill path is verified live. Owner note: bar movement is
subtle; a perceptual curve is requested in Prompt 5. Rows b, f, g and h were
not run in this session.

## Observed on this machine (automated Prompt 0 run, 2026-09-04)

Dev build, `RUST_LOG=vibe=debug`, single monitor `\\.\DISPLAY11` 3440×1440 at
150 %. Commands were driven through the main window's `window.__TAURI__` over
the WebView2 remote-debugging port, so **no microphone, clipboard or keyboard
injection was touched** — rows (a), (b), (f), (g) still need a human run. The
"observed" column above is deliberately left empty for that run.

| Cause | Verdict | Evidence |
|---|---|---|
| 2.1 silent start failures | **Confirmed from code**, not exercised. | The three paths are now logged (`start FAILED silently: …`, `hotkey down DROPPED by busy guard`). No mic was unplugged in this run. |
| 2.2 pill shown late | **Half refuted, half untested.** Device enumeration is not the cost. | `get_audio_devices` × 5 from the running app: 8.7 / 6.5 / 5.5 / 6.4 / 6.1 ms (3 devices, default input "Microphone (HyperX QuadCast 2)"). Whatever latency exists is in `start_record` (WASAPI stream start), which `start_record resolved sinceDownMs=` will show on a real dictation. |
| 2.3 show() does not raise | **Reproduced.** | A TopMost WinForms window was raised over bottom-centre after the pill's last raise, then `show_dictation_indicator` was invoked. Rust reported the pill visible, and the stand-in immediately above it in z-order: `[indicator] t=60932ms show/after show(): session=9001 status=recording visible=Ok(true) outer_position=Ok(PhysicalPosition { x: 1510, y: 1272 }) outer_size=Ok(PhysicalSize { width: 420, height: 96 })` followed by `[indicator] t=60932ms z-order: pill hwnd=0x20056e; immediately above: hwnd=0x70528 visible=true title="PROMPT0 TOPMOST STANDIN" class="WindowsForms10.Window.8.app.0.3acffc2_r3_ad1"`. tao 0.34.6 `WindowState::apply_diff` confirms the mechanism: `ShowWindow(SW_SHOW)` for the VISIBLE flag, `SetWindowPos(HWND_TOPMOST…)` only when the ALWAYS_ON_TOP flag *changes*, and the final style refresh uses `SWP_NOZORDER`. |
| 2.4 wrong monitor / wrong size | **Not reproducible here** (one monitor). Size path partially checked. | Every snapshot shows `window_monitor(scale)=1.5` and `cursor_monitor(scale)=1.5`, `outer_size=420×96` = 280×64 × 1.5, and `position_window` targets `(1510,1272)`. With one monitor the LogicalSize/scale mismatch cannot occur; the instrumentation is in place for a two-monitor run (row d). tao `set_inner_size` does use `self.scale_factor()` — the window's current monitor — so the mechanism in the plan is real. |
| 2.5 timers throttled in hidden webview | **Refuted on this machine.** | Main window closed to tray via `close()` (CloseRequested → `hide()`): `winVisible=false` but `document.visibilityState="visible"`, `document.hidden=false`, no `visibilitychange` event fired. A 1500 ms `setTimeout` took 1506.6 ms; chained 1500 ms timers measured 1513 / 1501 / 1509 ms while hidden. After 6 minutes hidden: see the line below. Cause: tao hides the HWND but nothing calls WebView2 `Controller.SetIsVisible(false)`, so Chromium never considers the page hidden. |
| 2.6 first state event lost on lazy create | **Could not be reached** — blocked by 2.7. | The disable → enable → show sequence never got past enable. The component-side ordering log (`mounted; fetching initial state (listen not yet registered)` → `listen registered`) is in place for when 2.7 is fixed. |
| 2.7 (new) sync command creates a window → deadlock | **Reproduced twice.** | `set_dictation_indicator_enabled(false)` closed the pill window normally; `set_dictation_indicator_enabled(true)` never returned, a new `about:blank` webview target appeared and never navigated, no `position_window` line was logged, and every subsequent IPC call (`isVisible`, `get_dictation_indicator_enabled`) hung until the process was killed (exit `0xffffffff`). Rust log after the last successful command: nothing (0 lines after `[indicator] t=98577ms hide/after hide(): session=9001`). tauri 2.10.3 `WebviewWindowBuilder::new` docs: "On Windows, this function deadlocks when used in a synchronous command and event handlers … You should use `async` commands and separate threads when creating windows." Both `set_dictation_indicator_enabled` and `show_dictation_indicator` are sync `fn` commands calling `create_window`. Startup works only because `initialize` runs from the setup hook. Side effect to know: the store key is written *before* the deadlock, so after a kill the setting is already `true` again. |

Six-minute hidden-window sample (row e, timer half): 272 chained 1500 ms
timers over 411.5 s, min 1500 ms, max 1516 ms, last ten
1502 / 1506 / 1502 / 1506 / 1502 / 1505 / 1516 / 1502 / 1502 / 1500;
`visibilityState` was "visible" at every tick and no `visibilitychange` event
ever fired. Caveat: at the end of the wait the main window reported
`isVisible=true` again (something re-showed it during the wait — not this
probe), so the hidden stretch is shorter than 411 s; the 5-minute chained-timer
throttle would still have registered as a ≥ 60 000 ms tick if the page had
ever been considered hidden, and none appeared. The live-dictation interval and
the hide timers are therefore **not** the source of lingering "Inserted" on
this machine; Prompt 1's Rust-owned auto-hide is still worthwhile for
robustness, but not to fix 2.5.
