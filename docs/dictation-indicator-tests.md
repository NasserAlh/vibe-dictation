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

## Floating control rows (j–v)

Added 2026-09-17 for [dictation-control-plan.md](dictation-control-plan.md).
Same matrix, same columns, continuing the letters. Two differences from rows
a–i: the "expected" column describes the **target** behaviour (nothing is
built yet, so there is no pre-fix behaviour to contrast), and the "cause"
column points at a section of the control plan. Rows j and k are the spike's
hand checks. Observed is empty until a prompt or the owner fills it. Row s
(tray entries) was deleted on 2026-09-18: the tray is a start route only and
no stop route that would record the menu window as the target is being
built; the letter is not reused.

| # | Case | Steps | Expected (target) | Cause | Observed | Log excerpt |
|---|------|-------|-------------------|-------|----------|-------------|
| j | Click with Word focused | Orb setting on. Put the caret in a Word document. Click the orb's EN target, say a sentence, click the pill to stop. | Word's title bar never loses its active colour and the caret keeps blinking through both clicks; the text is typed into Word, green "Inserted". No amber "Focus changed". | control §2.1, §2.10 items 1–2 | Spike 2026-09-17 (C1, C2, C5): click reached the webview and Rust 1–2 ms apart; Word (`hwnd=131994`) foreground before and after, pill never focused; click-started session stopped by F9 delivered 105 characters into Word, `type_text_if_foreground` true. Physical-keyboard check (C3) **not run — owner**. | see "Control spike" below |
| k | Transparency with click-through cleared | Orb setting on. Rest the orb over a bright, busy background (a photo, a web page). | Only the orb is drawn; its bounding square shows the background, not black or white, and no frame. | control §2.3, §2.10 item 3 | Spike 2026-09-17 (C4): screenshots with click-through off show the background right up to the pill, at 400×64 and at 40 px; no rectangle, no outline. Owner's eyes **not run**. | see "Control spike" below |
| l | Click beside the shape | Rest the orb over a window with a clickable target under the corner of the orb's bounding square. Click that corner, then a point 2 px outside the square. | The point outside reaches the app underneath. The corner inside the square is the accepted loss of option (a): note whether it is noticeable; if it is, option (b) is the remedy. | control §2.4 | Spike 2026-09-17 (C6), synthetic clicks over a logging window: inside the 400×64 window's transparent area the click is eaten; with a 40 px window the transparent corner is eaten, 20 px outside passes through, and the area the big window used to cover passes through. The dead zone is exactly the window rectangle. Owner's hand check **not run**. | see "Control spike" below |
| m | Stopping and ownership, all four combinations | For each of hotkey→hotkey, hotkey→click, click→hotkey, click→click, in both activation modes and both languages: start, speak, stop. Then: hold F9 (push-to-talk) and tap F10 while speaking; in toggle mode start with F9 and press F10; start an Arabic session by click and tap F9. | Every combination in the list stops and delivers. A **hotkey-started** session is stopped only by its own language's hotkey, exactly as today: the F10 tap during a held F9 session and the F10 press during a toggled F9 session do **not** stop it. A **click-started** session is stopped by any input — a click, or either language's hotkey, press or release — and is transcribed in the session's own language, not the pressed key's (the click-started Arabic session stopped by F9 comes out Arabic). A click stops any session. | owner ruling 2 as refined by control §2.11; §2.7 | | |
| n | Click-stop while another app is in front | Start in Word (type mode). Alt-Tab to Notepad, leave the caret there, click the pill to stop. | The text is typed into **Notepad**: the target is recorded at the stop instant. Same as releasing the hotkey in Notepad today; recorded so it is a known behaviour, not a surprise. | control §2.7 | | |
| o | Click during "Transcribing…" | Dictate ~10 s with a cold model. While the pill says "Transcribing…", click the pill, then hover where the orb rests. | "Still transcribing — wait" for 1 s, then the phase label returns. No second recording, no unfold while a session runs. | control §4 (one busy guard, hotkey.tsx:305-321) | | |
| p | Fullscreen and presenting | With the orb resting: browser F11; a PowerPoint slide show; a borderless-windowed game; an exclusive-fullscreen game; Win+L and back. Note the `QUNS_*` value logged for each. | The orb hides within about a second in each case and returns within about a second afterwards, re-raised. A dictation started by hotkey during fullscreen still shows the pill as today. | owner ruling 3; control §2.6 | | |
| q | Drag and persisted position | Drag the orb to a corner. Quit from the tray, relaunch. Then change the display layout (unplug a monitor, or change scale), and with two monitors at different scales drag it across. | The orb comes back where it was left. After a layout change it is fully on a visible monitor. It keeps its physical size ratio across DPI. A hotkey session in between does not move where the orb rests afterwards. | control §2.8 | | |
| r | Setting off means today's behaviour | Fresh profile: confirm the orb switch is off. Dictate by hotkey. Turn the orb on, then turn the indicator off. | Off: no orb, the pill hides when idle, the pill cannot be clicked (clicks pass through). Indicator off: no orb either, and the orb switch is disabled. | owner ruling 1 | | |
| t | Resting cost | Orb resting for five minutes, nothing else happening. Sample CPU and GPU of the app's WebView2 processes (Task Manager or `Get-Counter`), then the same with the orb setting off. | No measurable difference at rest; no animation frames while resting (the 4 Hz clock runs only for recording/transcribing). | control §2.5 | | |
| u | Live dictation started by click | Live dictation on, type mode, caret in Word. Click EN, speak ~10 s, click to stop. Repeat, but Alt-Tab away mid-sentence. | Partials are typed into Word while speaking; the final pass reconciles. After Alt-Tab the session freezes and ends as the amber clipboard fallback — the target was armed at the start click. | control §2.7 (`start_live_typing`, app.rs:146-151) | | |
| v | Arabic by click | Click the `ع` target, dictate in Arabic, in clipboard mode and in type mode into Word. | Transcribed as Arabic (language forced by the target, as by F10). `ع` badge, no mirroring of badge or elapsed time; "click to stop" hint readable in the Arabic locale. | control §4 | | |

## Control spike (Prompt 0), 2026-09-17 — criteria C1–C8

Throwaway spike on branch `spike/dictation-control-noactivate` (never merged).
Spike state: commit `4bbfd8e`; reverted by `53fb9cd`, so the branch tip's
product files equal `main`. Dev build, one monitor 3440×1440 at 150 %, pill
window 600×96 physical at (1420,1272). Mouse and keyboard input was
synthesized with `SetCursorPos` / `mouse_event` / `keybd_event` / `SendKeys`
(real OS-level input, not DOM events); the pill's console was read over the
WebView2 debug port. Screenshots and the distinct C7 transition frames are in
[screenshots/control-spike/](screenshots/control-spike/); raw logs are not
kept — the numbers are in the table below.

### How the owner's criteria map onto plan §2.10

C1–C8 are the owner's and are authoritative. Plan §2.10 and rows j–v were
written before them. Nothing was renumbered; this is the mapping:

| Criterion | Plan §2.10 item | Matrix row | What changed |
|---|---|---|---|
| C1 click reaches the webview, with latency | item 1, first half | j | Latency is new. **Hover without a click** (item 1, second half) is in none of C1–C8 and was not tested — still open. |
| C2 click does not activate | item 2, first half | j | Adds `is_focused()`; §2.10 only spoke of the foreground window. |
| C3 keyboard still goes to the target app | item 2 ("Word keeps its caret") | j | Made its own criterion, physical keyboard, owner-run. |
| C4 transparency survives | item 3 | k | Same. |
| C5 delivery end to end | item 2, second half | j, m (click→hotkey) | Adds "did the pill ever become the recorded target". |
| C6 click-through damage, measured | **none — missing from §2.10** | l | §2.4 ranked the options and deferred the measurement to row l. C6 makes it a spike criterion because it decides Prompt 1. |
| C7 tight-window viability | item 4 | — | Adds "does tao accept a ~40 px window" (was unverified claim 5). |
| C8 drag | item 5 | q (drag part) | Adds a worst-case lag number. |

### Results

| # | Verdict | Evidence |
|---|---|---|
| C1 | **PASS** | 10 clicks, 10 `pointerdown`s in the pill's webview, 10 matching Rust lines. Pointerdown → Rust log: 1–2 ms (median 1). `invoke` round trip seen from JS: 2–16 ms (median 5). OS click → JS pointerdown: ≤ 17 ms (upper bound; includes the harness's own call overhead). Pair: `[spike] pointerdown t=228523.0ms js_epoch_ms=1789657752341 client=(200,32) … button=0 mode=log` ↔ `[spike] t=228640ms rust_epoch_ms=1789657752343 click reached: note="pointerdown button=0 mode=log js_epoch_ms=1789657752341" foreground=131994 title="Document1 - Word" pid=26952 own_pid=47164 pill_hwnd=198504 pill_is_focused=Some(false) pill_is_foreground=false`. **C1 without C3 is not a pass** — see C3. |
| C2 | **PASS** | Foreground before click `hwnd=131994 'Document1 - Word'`, after click the same; a 50 ms foreground watch across `show()` + click recorded no change in 11 s. Every Rust line: `pill_is_focused=Some(false) pill_is_foreground=false`. Also held with Chrome in front (`foreground=1574924`, unchanged). `show()` itself did not change the foreground either. |
| C3 | **UNRUN (owner)** — synthetic pre-check passes | Pre-check with synthesized keys only: caret placed in Word by a click, pill clicked, then `SendKeys` with no further click → Word's text became `Control2 after-pill-click`. A physical keyboard is the criterion; run sheet below. |
| C4 | **UNRUN (owner's eyes)** — automated look passes | Screenshot with click-through off: background visible all round the pill, no opaque or black rectangle, no bounding box; same at 40 px over a solid blue window. Compared with `docs/screenshots/indicator/05-recording-en-elapsed.png`: no visible difference in the pill. |
| C5 | **PASS** | Click on the pill → `[spike] control press -> handleHotkeyDown(en)` → `show: session=1 status=recording`; synthetic F9 tap → `[spike] stop: recorded target=131994 lang=en` → `[spike] type_text_if_foreground: target=131994 current=131994 will_type=true` → JS `applied=true target=131994 chars=105 words=19`; Word's document gained those 105 characters. **The pill (hwnd 198504) was never the recorded target.** The audio was whatever the room microphone heard. |
| C6 | **Measured** (owner re-check pending) | **400×64 window, click-through off:** a click 40 logical px left of the visible pill (1473,1320), inside the window's transparent area, was taken by the pill's document (`DOC pointerdown client=(35.3,32) target=DIV`) and the window underneath received **nothing**. Control click just outside the window (1400,1320): received underneath. **40 px window:** its transparent corner (1423,1275) → taken by the pill (`client=(2,2)`), nothing underneath; 20 logical px outside (1390,1302) → received underneath; a point the big window used to cover (1500,1302) → received underneath. Conclusion: the dead zone is exactly the window rectangle. A full-size window is not acceptable with click-through off; a tight window loses only its own corners. |
| C7 | **UNRUN (owner's eyes)** — capture shows no flash | tao accepted the small window: `set_size: requested=60x60 (logical 40x40, scale 1.5) -> outer_size=Some((60, 60)) inner_size=Some((60, 60))`, `GetWindowRect` 60×60. Screen captured at ~30 ms per frame across both transitions: growing, the first changed frame already shows the complete pill, the next 7 frames differ only by the ring colour fading in (~160 ms); shrinking is a single-frame swap. No black, white or half-drawn frame. The content **jumps** from the window's left edge to its centre because the spike keeps the top-left corner fixed — an anchoring choice for Prompt 1, not a rendering fault. A 30 fps capture can miss a single bad 16 ms frame, hence the owner's eyes. |
| C8 | **PASS** | App command `spike_move_by` driven by `setPointerCapture` + `pointermove`. Four drags, 175 samples, speeds ~780 to ~2000 px/s: window exactly under the cursor at every sample (`worst_lag_px=0`), `fg_changed_samples=0`, foreground identical before and after. The sampler cannot resolve below about 15 ms per step, so the honest figure is "lag below one 15 ms sample", not zero. Synthetic motion, not a hand. |

Checks with the spike code in place: `cargo fmt`, `cargo clippy` (no
warnings), `cargo test` 43 passed; `pnpm i18n:generate`, `tsc --noEmit`,
`pnpm lint`, `pnpm test` 77 passed. No crate, crate feature or plugin added.

### Run sheet for the owner — C3, C4, C6, C7

Setup (once):

1. Quit the installed app from the tray (a dev instance is absorbed by it
   otherwise). In an MSVC shell at the repo root:
   `git checkout spike/dictation-control-noactivate` then
   `git checkout 4bbfd8e -- desktop` (restores the spike code into the working
   tree). From `desktop/`: `pnpm exec tauri dev`.
2. In the dev window: Settings → Dictation → activation **Toggle**. Open Word
   with some text and put the caret in it. Press **F9** once: the pill stays
   up ("Listening") until F9 is pressed again. Leave it up for all four rows.
   In this state: **left-click** the pill only logs; **right-click** toggles
   the window between 400×64 and a 40 px square with an orb.

Rows:

3. **C3.** Click in Word so the caret blinks. Left-click the pill once. Without
   clicking anywhere else, type a few words on the physical keyboard.
   PASS: the words appear in Word at the caret; Word's title bar never dims.
   FAIL: nothing appears, or a click back into Word is needed first.
4. **C4.** Move a bright, busy window (a photo, a web page) under the pill.
   Look at the area around the pill, inside where its 400×64 window is.
   PASS: only the pill is drawn; the background shows right up to its rounded
   edge. FAIL: any black, white or grey rectangle, or a visible box outline.
   Compare with `docs/screenshots/indicator/05-recording-en-elapsed.png`.
5. **C6.** Put a text editor under the pill. (a) Click about 40 px to the left
   of the visible pill. Expected from the measurement: the editor's caret does
   **not** move — the click is eaten. (b) Right-click the pill: it becomes a
   40 px orb. Click the orb square's transparent corner, just outside the
   circle: expected eaten. Click 20 px outside the square: expected to land in
   the editor. Record whether your hand agrees with the measurement, and
   whether the corner loss is noticeable in practice.
6. **C7.** Right-click the pill/orb six times, watching closely. PASS: each
   change is a clean swap. FAIL: any black or white flash, a frame where the
   pill is half drawn or stretched, or the orb appearing somewhere other than
   the window's top-left. Note separately whether the jump of the content from
   left edge to centre bothers you — that is an anchoring choice, not a fault.

Teardown: press F9 to end the dictation, close the dev app, then
`git checkout HEAD -- desktop` (back to the reverted tip; `git status` must show
docs only), and start the installed app again.

### Notes from the run

- Reloading the dev main page leaves F9/F10 registered in Rust against the
  old page; the new page's registration fails and the pill shows "hotkeys
  could not be registered". Dev-only (a release page never reloads), and the
  same family as the unproven startup flash in the indicator plan §7. Worked
  around in the spike by unregistering first; not fixed.
- The first dev launch exited by itself ~50 s after start with code −1 and a
  WebView2 teardown message, shortly after the installed app had been stopped.
  The two share one WebView2 user-data folder; the likely cause is the
  stopped app's browser process shutting down underneath the new instance.
  Not investigated further.
- The dev origin (`http://localhost:1420`) had no saved preferences at all.
  The spike set a model path and type mode there for C5 and removed both
  again.
- Harness incident: one batch of synthesized keystrokes was sent while the
  owner had switched to a Chrome/YouTube tab, so that page received them. The
  harness was then changed to refuse to type unless the expected window is
  foreground.
