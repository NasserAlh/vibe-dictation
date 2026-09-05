# Dictation indicator (the pill): why it is flaky, and what it should become

Date: 2026-09-04. Based on a read of the code at `main` (last indicator change: `4fb99a9`).

## 1. What the pill does today

One Tauri window, label `dictation-indicator`, 280×64 logical px, always on top,
click-through, no focus ([dictation_indicator.rs](../desktop/src-tauri/src/dictation_indicator.rs)).
The React component in [dictation-indicator.tsx](../desktop/src/components/dictation-indicator.tsx)
renders logo + divider + one icon + one label. Six states: `starting`, `ready`,
`recording`, `transcribing`, `completed`, `error`.

All show/hide decisions are made in the **main window's** JavaScript
([hotkey.tsx](../desktop/src/providers/hotkey.tsx) lines 149–158, 284, 321, 397, 401, 503–519).
Rust only executes them. Hide is guarded by a session number so a stale timer
cannot hide a newer session.

## 2. Why it "sometimes appears and sometimes disappears"

Seven causes. Status after Prompt 0 (run 2026-09-04, one monitor at 150 %,
no microphone driven):

| # | Cause | Status |
|---|---|---|
| 2.1 | Silent failure paths before the pill shows | Code-confirmed. Rows a, b, g still yours. |
| 2.2 | Pill comes up late | Partly refuted: `get_audio_devices` costs 5–9 ms. Any delay is in `start_record`. Row a will show it. |
| 2.3 | `show()` does not re-raise a topmost window | **Reproduced, fixed in `4fdb773`.** A TopMost stand-in sat directly above the pill while the pill logged `visible=true`; after the fix only system helper windows sit above it. |
| 2.4 | Wrong monitor / wrong size across DPI | Not testable on one monitor. Row d is yours. Fix is cheap and kept. |
| 2.5 | Timers throttled in the hidden main webview | **Refuted on this machine.** `visibilityState` stays "visible" in the tray; 272 chained 1500 ms timers fired within 1500–1516 ms over 411 s. tao hides the HWND but nobody calls WebView2 `SetIsVisible(false)`. |
| 2.6 | First state event lost on a freshly created window | Code-confirmed; could not be reached because of 2.7. |
| 2.7 | **Creating the window from a sync command deadlocks the app** | **Reproduced twice, fixed in `4fdb773`.** Commands are async; off/on twice returned in 13–83 ms with the app responsive. |

Commits so far: `d53e7c5` instrumentation and test matrix (Prompt 0), `4fdb773`
deadlock, z-order, monitor choice, DPI sizing, fade, listen-first (Prompt 1).
Prompt 1 also moved both error timeouts to 5 s. `76040fc` this plan.
`91c6f05` pill at key-down, visible failures (`lib/indicator-messages.ts`),
"still transcribing" hint, 10 s device cache (Prompt 2). No dependency change.
`e921de6` richer states: payload fields lang/phase/words/hint/shortcut plus
`severity` (amber vs red), pure `lib/indicator-content.ts`, rebuilt component,
window width 280 → 400 logical px, screenshots in `docs/screenshots/indicator/`
(Prompt 3). Design rulings: busy microphone is amber; focus-lost uses the
short label; fixed labels never truncate.
`4bada78` short focus-lost label; width audit of all 40 fixed-label rows
(widest 358 px of 384). `e9073c6` live level meter: per-buffer peak via
`AtomicU32::fetch_max`, 66 ms drain task with 0.8 decay, `emit_to` the
indicator only, five bars, reset on any status or session change (Prompt 4).
`2500c40` ROADMAP item moved to Shipped.
Pending a microphone run: row a timing, the cpal error-text classifier in
`classifyStartRecordError`, phase transitions, word count, focus-lost path,
the real cpal → atomic → pill signal path and decay feel on speech, and the
Arabic wording of all new strings.

### 2.1 Nothing is shown when the start fails (confirmed)

In `handleHotkeyDown` (hotkey.tsx 255–300) the pill is shown only **after**
`get_audio_devices` and `start_record` both succeed (line 284). Three paths
show nothing and tell you nothing:

- no default input device → `console.error` and return (263–266);
- `start_record` throws (Bluetooth headset switching, mic unplugged, device busy) → `console.error` only (292–296);
- key pressed while the previous dictation is still finishing → dropped by the guard on line 256.

To you this is: "I pressed the key and the pill did not come up."

### 2.2 The pill comes up late (partly refuted)

Even on success, "Listening…" waits for `get_audio_devices` and
`start_record`. Prompt 0 measured enumeration at 5–9 ms, so the only
candidate is the WASAPI stream start inside `start_record`. Row a of the
test matrix (`sinceDownMs`) settles it. If it is under ~100 ms, drop step 1
of Prompt 2 and keep the rest.

### 2.3 `show()` does not bring the pill back to the top (confirmed in tao 0.34.6)

tao's Windows `apply_diff` shows a hidden window with `ShowWindow(SW_SHOW)` and
then a `SetWindowPos(... SWP_NOZORDER ...)`. Z-order is not touched. Among
topmost windows the last one *raised* wins. Anything topmost raised after the
pill's last raise sits above it: Task Manager with "Always on top", Teams call
controls, PowerToys, picture-in-picture video, Snipping Tool, some game
overlays. The pill is "shown" but you cannot see it.

Calling `set_always_on_top(true)` again does **not** fix this: tao diffs the
flag, sees no change, and returns early. The fix is a raw
`SetWindowPos(hwnd, HWND_TOPMOST, …, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW)`
on every show. `windows` crate feature `Win32_UI_WindowsAndMessaging` is already
enabled (used by `GetForegroundWindow` in [cmd/app.rs](../desktop/src-tauri/src/cmd/app.rs)),
so no dependency change.

Exclusive-fullscreen games hide every topmost window. That one cannot be fixed
and should be documented as expected.

### 2.4 Wrong monitor, wrong size (likely — verify)

`position_window` (dictation_indicator.rs 116–140) places the pill on the
monitor under the **mouse**, not where you are typing. With two monitors, the
mouse resting on the other screen puts the pill out of your field of view.

`show_dictation_indicator` also calls `set_size(LogicalSize)` **before**
`set_position`. tao converts a logical size using the window's *current*
monitor scale. If the target monitor has a different scale (100 % vs 150 %),
the physical size is computed for the wrong monitor and the pill can be
clipped: label cut off, only logo + icon visible. That matches "a static icon
with no indication of why it is here."

### 2.5 Timers live in a hidden webview (refuted on this machine)

The hide timers (1.5 s / 3.5 s / 5 s) and the live-dictation 1.5 s interval
run in the main window's JavaScript. The main window is normally hidden
(close-to-tray). Chromium throttles timers in hidden pages, so this was a
candidate. Prompt 0 showed the page never learns it is hidden:
`document.visibilityState` stays "visible", `visibilitychange` never fires,
and 272 chained timers stayed within 16 ms of schedule over 411 s. The JS
timers stay. The Rust-owned auto-hide that an earlier draft of Prompt 1
proposed is dropped.

Side effect worth knowing: the hidden main window keeps rendering. Not a
pill problem; noted for a later power/CPU pass.

### 2.6 First state event can be lost (minor)

When the window is created lazily inside `show_dictation_indicator`
(indicator re-enabled in Settings), `emit` fires before the page has loaded.
The component recovers by calling `get_dictation_indicator_state` on mount,
but it registers `listen` *after* starting that fetch (dictation-indicator.tsx
15–24). A state emitted in that gap is dropped. Register `listen` first, then
fetch.

### 2.7 Creating the window from a sync command deadlocks the app (reproduced)

`set_dictation_indicator_enabled` and `show_dictation_indicator` are
synchronous `#[tauri::command]`s, and both can call `create_window`, which
calls `WebviewWindowBuilder::build()`. Tauri 2.10.3 documents this
(`crates/tauri/src/webview/webview_window.rs`, "Known issues"): "On Windows,
this function deadlocks when used in a synchronous command and event
handlers. You should use `async` commands and separate threads when creating
windows."

Prompt 0 reproduced it twice: `set_dictation_indicator_enabled(true)` never
returns and every later IPC call hangs until the process is killed. In
practice: **turning the indicator off and back on in Settings freezes the
app today.** The lazy create inside `show_dictation_indicator` is the same
path; it only avoids the hang because the window normally already exists
from startup (`initialize` runs in `setup`, not in a command, so it is safe).

Fix: make the three indicator commands `async fn` (show, hide, set-enabled).
Async commands run off the main thread, which is what the docs ask for. No
`await` is needed inside; the change is the signature plus not holding the
`Mutex` guard across any await. Prompt 1 does this first, because its own
re-enable test would otherwise hang.

## 3. Why it feels dull

It answers none of the three questions you have while dictating:

1. Is it hearing me? — a fixed red dot cannot tell you. (ROADMAP already plans a level meter.)
2. Which language, and where will the text go? — not shown. EN vs AR and type vs clipboard are the two things that go wrong most.
3. What happens next, and did it work? — "Transcribing…" with no progress looks like a hang on a cold model load (several seconds). "Inserted" says nothing about how much.

Owner decision stands: **never transcript text in the pill.** Everything
below is status only.

## 4. Target design

One dark pill, one line, 48 px tall. Left to right:

| State | Ring colour | Left slot | Label | Right slot |
|---|---|---|---|---|
| starting | grey | spinner | "Starting…" | — |
| ready (5 s flash) | green | check | "Ready" | "F9 EN · F10 AR" |
| recording | red | **live level meter** (5 bars) | "Listening" | "EN" or "ع" badge · elapsed `0:07` · destination glyph (keyboard = type, clipboard = copy) |
| transcribing | blue | spinner | "Loading model…" → "Transcribing 8 s…" → "Formatting…" (Ollama pass only) | badge |
| completed | green | check | "Inserted · 42 words" / "Copied · 42 words" | — |
| error | amber (no mic, focus lost) or red (failure) | warning | plain-English message | — |

Rules:

- Push-to-talk shows a small hint "release to finish" for the first 2 s of recording; toggle shows "F9 to stop". After that the hint fades and elapsed time stays.
- Focus lost during live dictation → amber "Focus changed — copied to clipboard".
- Errors stay 5 s (today 3.5 s). Completed stays 1.5 s.
- State changes cross-fade 150 ms; the pill fades out 150 ms before the window hides. `prefers-reduced-motion` disables all motion, including the meter (falls back to the pulsing dot).
- Arabic labels render RTL inside the pill; the badge never mirrors.
- The level meter is driven by a Rust event at ~15 Hz. In-process only. No new sockets. Zero-egress guarantee untouched.

## 5. Prompts for Claude Code

Run them in order. Each one is self-contained. Paste one at a time. Commit
between prompts. Do not skip Prompt 0 — it decides which of 2.4 and 2.5 are
real on your machine.

### Prompt 0 — Instrument and reproduce

```
Read CLAUDE.md and docs/dictation-indicator-plan.md sections 1–2 first.

Goal: prove or rule out each cause in section 2 before changing behaviour. Do not fix anything in this prompt.

1. In desktop/src-tauri/src/dictation_indicator.rs, extend the tracing in show_dictation_indicator and hide_dictation_indicator to log, at info level: a monotonic timestamp (ms since process start), session_id, status, window.is_visible(), outer_position(), outer_size(), the scale factor of the monitor the window is on, and the scale factor of the monitor under the cursor. After show(), also log the HWND immediately above the pill in z-order (GetWindow(hwnd, GW_HWNDPREV) with its title via GetWindowTextW) so we can see what is covering it. Use only the windows crate features already enabled in Cargo.toml (Win32_UI_WindowsAndMessaging, Win32_Foundation). Do not add crate features.

2. In desktop/src/providers/hotkey.tsx, log with console.info and performance.now(): hotkey event received (lang, state), get_audio_devices resolved, start_record resolved, every showIndicator/finishIndicator call, and every timer firing. Also log document.visibilityState at each of these points.

3. Add a temporary log line in handleHotkeyDown's two silent failure paths (no default input device; start_record catch) so they are visible in the Rust log via console → tauri log plugin, if the app forwards console output; otherwise console.error is enough for a dev run.

4. Write a manual test matrix to docs/dictation-indicator-tests.md with one row per case and columns: steps, expected, observed, log excerpt. Cases: (a) push-to-talk phrase under 1 s; (b) Bluetooth mic disconnected / no default mic; (c) Task Manager open with Options → Always on top, overlapping bottom-centre; (d) two monitors with different scale, mouse on the monitor you are not typing on; (e) main window closed to tray for 6 minutes, then dictate — check whether the hide timer and the live-dictation interval fire on time and what visibilityState says; (f) a fullscreen game or video; (g) hotkey pressed again while "Transcribing…" is showing.

5. Run cargo fmt, cargo clippy, pnpm i18n:generate, pnpm exec tsc --noEmit -p tsconfig.json, pnpm lint. Do not commit test logs. Report which of causes 2.1–2.6 you could reproduce and paste the relevant log lines for each.
```

I fill in the "observed" column by running the matrix, then move on.

### Prompt 1 — Make show and hide deterministic (Rust)

Revised after Prompt 0: the deadlock fix (2.7) comes first, and the
Rust-owned auto-hide is dropped because 2.5 was refuted.

```
Read CLAUDE.md, docs/dictation-indicator-plan.md section 2 (note 2.7 and the refuted 2.5), and docs/dictation-indicator-tests.md. Then change desktop/src-tauri/src/dictation_indicator.rs as follows, in this order. Windows-only app; keep the existing macOS cfg blocks compiling but do not extend them. Keep the Prompt 0 [indicator] tracing in place; Prompt 5 trims it.

0. Deadlock first. Make show_dictation_indicator, hide_dictation_indicator and set_dictation_indicator_enabled `async fn` so WebviewWindowBuilder::build() never runs inside a synchronous command (Tauri 2.10.3 webview_window.rs "Known issues": on Windows it deadlocks in sync commands). Take AppHandle by value. Do not hold the DictationIndicatorRuntime mutex guard across any await; there should be no await inside these bodies except the fade in step 5. Update the TS wrappers if the signatures change. Then verify the fix by hand before continuing: run the dev build, Settings → Dictation → toggle "Show status indicator" off and on twice, and confirm the app stays responsive and the pill returns. Say in your report that you did this.

1. Raise on every show. After window.show(), call SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW) using window.hwnd() and the windows crate (feature Win32_UI_WindowsAndMessaging is already enabled; do not add features). Put it in fn raise_topmost(window: &WebviewWindow) with a comment: tao's set_visible does not touch z-order, and set_always_on_top(true) is a no-op when the flag is already set. Re-run test row c (TopMost stand-in) and confirm the z-order log now shows nothing above the pill.

2. Position on the monitor where the user is typing. Replace the cursor-based lookup in position_window with: GetForegroundWindow → GetWindowRect → centre point → window.monitor_from_point(x, y). Fall back to the cursor monitor, then primary. Reuse the foreground_window() helper in cmd/app.rs (make it pub(crate); do not duplicate). Log which strategy won at debug level.

3. Fix size across DPI. Compute the target monitor first. Then set_position (physical) and then set_size(PhysicalSize::new(WIDTH * scale, HEIGHT * scale)) using the target monitor's scale factor. Never call set_size with a LogicalSize before the move. Scale BOTTOM_MARGIN the same way.

4. Keep the hide timers in hotkey.tsx as they are (Prompt 0 proved they fire on time). Only change the error timeout from 3500 to 5000 ms.

5. Fade before hide. In hide_dictation_indicator, when the session matches: emit "dictation-indicator-hide" to the indicator window, await tokio::time::sleep(150 ms) with the mutex guard already dropped, re-check the session still matches, then hide. The component handles the fade in Prompt 3; for now it may ignore the event.

6. In desktop/src/components/dictation-indicator.tsx, register listen("dictation-indicator-state") before calling getDictationIndicatorState, and apply the fetched state only if no event has arrived in the meantime.

7. Fix the stale comment at desktop/src-tauri/src/cmd/audio.rs lines 31–34: the live buffer feeds live typing at the cursor, not the indicator.

8. Unit tests in dictation_indicator.rs for the pure positioning math: extract fn pill_rect(monitor_pos: (i32, i32), monitor_size: (u32, u32), scale: f64) -> (x, y, w, h) and test scale 1.0, 1.25, 1.5, 2.0 and a second monitor at negative x.

9. Run cargo fmt, cargo clippy, cargo test, pnpm i18n:generate, pnpm exec tsc --noEmit -p tsconfig.json, pnpm lint, pnpm test. No new crates, no new crate features, no new Tauri plugins; say so in the commit message so the RELEASING.md dependency rule is visibly satisfied. Commit as one change with a message that names 2.7 and 2.3 as the fixed causes.
```

### Prompt 2 — Never silent (frontend)

```
Read CLAUDE.md and docs/dictation-indicator-plan.md sections 2.1–2.2. Change desktop/src/providers/hotkey.tsx so the pill appears the moment the hotkey is pressed and every failure is visible.

1. In handleHotkeyDown, bump indicatorSessionRef and call showIndicator('recording') before get_audio_devices, not after start_record. Keep the session bump and the live-dictation setup order otherwise unchanged. Make sure record_finish still ignores sessions that never started recording.

2. Every failure before recording starts becomes finishIndicator('error', { message }) plus the existing notify(). Messages in plain English, added to both i18n/translations/en-US/desktop.json and ar-SA/desktop.json: "No microphone found", "Microphone is busy or unavailable", "Could not start recording". Map the no-default-device path to the first, and start_record errors to the second when the error text mentions the device or stream, else the third.

3. When the hotkey is pressed while isStoppingRef is true (previous dictation still finishing), re-emit the current transcribing state with a short message "Still transcribing — wait" for 1 s, then restore "Transcribing…". Do not start a second recording.

4. Cache the get_audio_devices result for 10 s so the second dictation in a row does not pay for enumeration again. Invalidate the cache on any start_record error.

5. Run uv run scripts/check_i18n.py from the repo root, then pnpm i18n:generate, tsc, lint, pnpm test. Add a vitest test for the error-message mapping function (pure, exported from a new desktop/src/lib/indicator-messages.ts).
```

### Prompt 3 — Richer states and a proper design

```
Read CLAUDE.md and docs/dictation-indicator-plan.md sections 3–4. Implement the target design. The pill never shows transcript text — owner decision.

1. Extend DictationIndicatorPayload (Rust) and DictationIndicatorState (TS, desktop/src/lib/dictation-indicator.ts) with optional fields: lang ('en' | 'ar'), phase ('loading-model' | 'transcribing' | 'formatting'), words (number), hint ('release' | 'toggle'), shortcut (string). Keep serde camelCase. Hide timing stays in hotkey.tsx.

2. In hotkey.tsx, fill them: lang from activeLangRef; hint from hotkeyActivationMode and shortcut from the registered accelerator for that language; phase 'loading-model' before load_model, 'transcribing' before transcribe, 'formatting' before formatWithOllama (only when the LLM pass runs); words = resultText.split(/\s+/).filter(Boolean).length on completion. Report the focus-lost fallback as an error state with message m.liveDictationFocusLost() and auto_hide_ms 5000, amber variant.

3. Rebuild desktop/src/components/dictation-indicator.tsx around a pure function pillContent(state, now): { ring, left, label, right, sub } exported from desktop/src/lib/indicator-content.ts and unit-tested with vitest for every status. The component only renders what that function returns. Elapsed time is computed from a startedAt timestamp captured when the recording state arrives; tick with requestAnimationFrame throttled to 4 Hz, not setInterval.

4. Layout: 48 px pill, ring colour per state (red recording, blue transcribing, green ready/completed, amber warning, red error), left slot 20 px, label truncates, right slot holds the language badge (EN or ع), elapsed, and destination glyph (lucide Keyboard for type, Clipboard for clipboard). Push-to-talk hint "release to finish" / toggle hint "{shortcut} to stop" shows for the first 2 s of recording then fades. Cross-fade state changes 150 ms. Listen for "dictation-indicator-hide" and fade the pill out within 150 ms. Respect prefers-reduced-motion: no fades, no meter, pulsing dot instead.

5. Arabic: the label uses dir="auto"; the badge and numbers stay LTR. Check both locales.

6. Add every new string to both locale files, run uv run scripts/check_i18n.py, pnpm i18n:generate, tsc, lint, pnpm test. Raise the window size constants only if the new content needs it and keep WIDTH/HEIGHT the single source of truth in Rust.
```

### Prompt 4 — Live level meter

```
Read CLAUDE.md, ROADMAP.md "Animated recording indicator", and docs/dictation-indicator-plan.md section 4. Implement the meter. In-process only: no sockets, no crates, no plugins.

1. In desktop/src-tauri/src/cmd/audio.rs, in build_input_stream_typed's callback, compute the peak absolute sample of each buffer as f32 and store it in a static AtomicU32 (to_bits). Do this for every recording, not only capture_live. Keep the callback allocation-free and never block (same rule as write_input_data).

2. In start_record, after the streams play, spawn a tauri::async_runtime task that every 66 ms reads the peak, applies a simple decay (level = max(peak, level * 0.8)), and emits "dictation-indicator-level" { level: f32 in 0..1 } to the dictation-indicator window only (emit_to). Stop the task when stop_record fires. Skip the emit entirely when the indicator is disabled (dictation_indicator::is_enabled) or the window does not exist.

3. In the indicator component, render five bars in the left slot during recording. Bar heights follow the level with per-bar multipliers (0.6, 0.85, 1, 0.85, 0.6) and a 100 ms CSS transition. Below 0.02 show the resting state (short bars, no motion). Under prefers-reduced-motion fall back to the pulsing dot.

4. Add a Rust unit test for the decay function and a vitest test for the bar-height mapping.

5. Run cargo fmt, clippy, cargo test, pnpm test, tsc, lint. Then update ROADMAP.md: move the item from Planned to Done with the commit hash.
```

### Prompt 5 — Verify and document

```
Read CLAUDE.md and RELEASING.md. Close out the indicator work.

1. Re-run every row of docs/dictation-indicator-tests.md on the dev build and record observed results. Rows (c) and (d) must now pass; (f) fullscreen is expected to fail and should be documented as a known limitation in docs/debug.md.

2. Remove the temporary Prompt 0 instrumentation that is not useful long-term. Keep one info line per show and hide (timestamp, session, status, visible, position, size).

3. Confirm no dependency change: git diff main -- desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock desktop/package.json pnpm-lock.yaml must be empty. If it is not, stop and say so — CLAUDE.md requires the full RELEASING.md re-verification pass for any dependency change.

4. Update CLAUDE.md "Dictation data flow" step 7 to describe the new states, the level event, and Rust-owned auto-hide. Update README.md line 33 if the wording no longer fits.

5. Add a RELEASING.md entry under the next version: what changed; the deadlock finding (2.7: window creation inside a sync command hangs the app on Windows — re-enabling the indicator in Settings froze v1.4.0); the tao z-order finding (set_visible does not raise; set_always_on_top is a no-op when unchanged); the refuted timer-throttling hypothesis with its numbers; and that the guarantee surface is unchanged (in-process events only).

6. Run the full lint and test set from CLAUDE.md. Summarise what changed and what remains open.
```

## 6. What only you can do

- Commit the Prompt 0 work on its own before Prompt 1, so the fix diff is clean: instrumentation + docs/dictation-indicator-tests.md.
- Run the remaining matrix rows with a microphone: a, b, d, f, g, and h/i after Prompt 1. Row a's `sinceDownMs` decides whether Prompt 2 step 1 is needed.
- Closed: the main window re-appearing during the Prompt 0 tray wait was the owner opening it. Not a bug.

## 7. Open after closeout (2026-09-05, at `0407600`)

- Test rows b (no default microphone; Bluetooth profile switch), f (exclusive fullscreen) and g (hotkey pressed during a real transcription) are not run. Row d (two monitors, different scale) is not testable on the owner's single monitor. The cpal error-text classifier in `classifyStartRecordError` (`lib/indicator-messages.ts`) keys on "device" / "stream" in cpal's error text and has never been checked against a real device failure.
- Arabic wording: nine new keys plus the reworded Ready/Listening strings in `i18n/translations/ar-SA/desktop.json` are machine wording awaiting the owner's native check. The owner's 2026-09-05 run found the Arabic labels correct on screen, but did not review every new string.
- Startup registration flash: twice, after a `tauri dev` watcher rebuild, the fresh instance showed the amber "Dictation hotkeys could not be registered" pill for 5 s. Not seen on a normal launch. Likely the outgoing process still holding F9/F10 during the restart; a release build cannot hit that path because a second launch is routed to the running instance. Unproven. A single registration retry after one second, before showing the error, would cover it and any other app briefly holding the key. Not gating.
- Row h was verified through the same commands the Settings switch and the hotkey call, not by a click followed by a key press within one second.
- Decide the hint wording for toggle mode ("F9 to stop" vs "press F9 again").
- Look at the Arabic labels on a real AR dictation; machine wording for "release to finish" needs a native check.
- Owner decision to re-confirm: status only, no transcript text. The plan assumes it stands.
