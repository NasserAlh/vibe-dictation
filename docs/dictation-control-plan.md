# Dictation control (the orb): a floating control that starts dictation

Date: 2026-09-17. Based on a read of the code at `main` (`b8e8572`, v1.5.0
published). Revised 2026-09-18 after the Prompt 0 spike: §2.4, §2.8 and §2.10
now record decisions and measurements, §2.11 is new, and the prompts in §6
were updated to match. Revised a second time on 2026-09-18, after Prompt 1 was
committed (`8938e5b`) and a read-through review of the code at that commit:
§2.12 is new (the clickable-icon routes, ranked, and the startup-resting
defect), Prompt 1b is new, Prompt 2 is **split** into 2a and 2b — its owner
text is unchanged and now sits under 2b — the tray entries move out of
Prompt 3 into a new Prompt 4, and §5, §7 and §8 are updated to match. Nothing
was renumbered: the split and the new prompts take lettered ids after the
prompt they belong to. Companion to
[dictation-indicator-plan.md](dictation-indicator-plan.md); same shape, same
discipline. Claims are tagged **[verified]** (read in source, file:line
given), **[measured]** (spike, 2026-09-17) or **[unverified]**; section 10
lists every claim that is still unverified.

Feature in one line: the existing indicator window gains a resting state (a
small orb) that can be clicked to start dictation in a chosen language,
becomes today's pill while a session runs, and folds back to the orb.

## Owner rulings

Dated `Sun Sep 6 00:19:59 2026 +0300` (`git log -1 --format=%cd`).

1. **Owner ruling.** The orb is OPT-IN, OFF BY DEFAULT, beside today's pill.
   One new boolean under Settings → Dictation, subordinate to the existing
   indicator toggle. With it off, today's behaviour is unchanged: the pill
   still hides when idle. Reason: a permanently visible topmost window is a
   new always-on presence; this repo's precedent is that anything holding
   screen or VRAM at rest ships off by default (live dictation, model
   warmup). It also makes the first failure mode after an upgrade "nothing
   happened".
2. **Owner ruling.** Stops are SYMMETRIC: any input stops any recording —
   hotkey or click, either way round. The existing per-language guard is
   preserved for hotkey RELEASES only (a stray AR release must never cut a
   held EN session); a click always targets the active session's language.
   Reason: a user who started with the mouse will reach for F9/F10 to stop; a
   no-op there is the worse failure.
   *Refined by the owner on 2026-09-18 — see §2.11, which governs where the
   two differ: a hotkey-started session keeps today's rule in full (its own
   language's hotkey only, presses included), and "any input" applies to
   click-started sessions and to clicks.*
3. **Owner ruling.** The orb AUTO-HIDES whenever the OS reports fullscreen or
   presenting, per section 2.6 below, with no extra setting. The ruling in
   (1) is the manual escape hatch.

## 1. What the pill does today

One Tauri window, label `dictation-indicator`, 400×64 logical px, always on
top, **click-through, never focused** — created once at startup by
`initialize` → `create_window`
([dictation_indicator.rs:172-225, 227-250](../desktop/src-tauri/src/dictation_indicator.rs)),
hidden whenever no session state is active (`on_page_load`, :189-202;
`hide_dictation_indicator`, :380-424). The pill inside is content-sized and
centred; the rest of the window is transparent.

Every `show_dictation_indicator` re-places the window bottom-centre on the
foreground window's monitor (`position_window`, called at :341 and at :223),
sizes it physically for that monitor's DPI, shows it and re-raises it
(`raise_topmost`, :139-167).

What to draw is decided by the pure `pillContent`
([lib/indicator-content.ts:94-151](../desktop/src/lib/indicator-content.ts));
the component only renders it. All show/hide decisions and hide timing
(completed 1.5 s, errors 5 s) are made in the main window's
[hotkey.tsx](../desktop/src/providers/hotkey.tsx). There is exactly one
dictation loop: `handleHotkeyDown` (:304-392) starts, `handleHotkeyUp`
(:394-410) stops, the `record_finish` listener (:414 on) transcribes and
delivers. The only way in is a global hotkey (:635-659).

The pill cannot be clicked, and there is no way to start dictation with the
mouse. The tray menu has two entries, Show and Quit
([setup.rs:143-172](../desktop/src-tauri/src/setup.rs)).

## 2. The mechanism, and the evidence

### 2.1 A clickable control must never take focus — and the window already has the style

The final text is typed only into the window that was in front when the
recording stopped: `handleHotkeyUp` records `GetForegroundWindow` at that
instant (hotkey.tsx:401 → [cmd/app.rs:97-107](../desktop/src-tauri/src/cmd/app.rs)),
and `type_text_if_foreground` compares it with `GetForegroundWindow` at
delivery time (app.rs:115-129). **[verified]** A control that became the
foreground window when clicked would turn every click-stopped dictation into
the amber "Focus changed" clipboard fallback.

`.focusable(false)` sets `WS_EX_NOACTIVATE` — tao 0.34.6
`platform_impl/windows/window_state.rs:296-298` — and the pill window is
built with it (dictation_indicator.rs:184). **[verified]** Non-activation
rests entirely on that style, and the spike confirmed it holds: clicks reach
the webview and the foreground window never changes (§2.10, C1, C2, C5).
**[measured]**

**Do not plan on handling `WM_MOUSEACTIVATE`.** tao never handles it (zero
occurrences of `WM_MOUSEACTIVATE` / `MA_NOACTIVATE` in tao 0.34.6) and its
window procedure falls through to `DefWindowProcW`
(`platform_impl/windows/event_loop.rs:2264`). **[verified]** Hooking that
message would mean subclassing an HWND whose wndproc tao owns
(`SetWindowLongPtrW` + `CallWindowProc` chaining) — fragile, and the spike
showed no activation that would call for it. It stays a documented fallback
only, to be revisited if the owner's C3 run fails.

### 2.2 Click-through is all-or-nothing per window

`set_ignore_cursor_events(true)` (dictation_indicator.rs:208) sets
`WS_EX_TRANSPARENT | WS_EX_LAYERED` on the whole window (tao
`window_state.rs:285-287`). **[verified]** There is no per-region form of it.
A clickable orb needs click-through cleared for the window it lives in.

### 2.3 Transparency does not depend on the layered style

tao makes the window transparent with `DwmEnableBlurBehindWindow` and an
empty blur region (`platform_impl/windows/window.rs:1283-1295`), and wry
gives WebView2 a transparent background (wry 0.54.2
`src/webview2/mod.rs:127, 443, 449`). **[verified]** Clearing click-through
strips `WS_EX_TRANSPARENT | WS_EX_LAYERED`, and the spike's screenshots show
the window still visually transparent at 400×64 and at 40 px (§2.10, C4).
**[measured; the owner's eyes on C4 are still unrun]**

### 2.4 Per-shape click-through: the decision

**A tight window is THE answer.** The spike's C6 measured the damage: with
click-through off, the dead zone is exactly the window rectangle. At 400×64
a click 40 logical px left of the visible pill was taken by the pill's
document and the window underneath received nothing; the same click just
outside the window reached it. **[measured]** A full-size clickable indicator
window would punch a 400×64 hole in whatever the user is working in, for the
length of every dictation. That is not acceptable. So the window is always
sized to the visible shape — a ~40 px orb at rest loses only the corners of
its own bounding square, which is the smallest dead zone there can be — and
there is no hit-test code and no new crate feature.

**Hard requirement that comes with it (C7).** When the window grows orb →
pill it must keep the visible content stationary: anchor on the orb's edge
nearest the screen edge plus its vertical centre, never the window origin.
The spike resized around the top-left corner and the content visibly jumped
from the window's left edge to its centre (§2.10, C7); without the anchor
rule the fold is a lurch every time. The same rule runs in reverse for pill →
orb, using the anchor side remembered from the grow, not recomputed —
recomputing "nearest edge" from the wider pill can pick the other side and
land the orb somewhere else. Consequence for the frontend: inside the grown
window the pill must draw its logo at the anchored end, so the orb's pixels
stay where they were.

Fallbacks, in order, unbuilt:

1. **`SetWindowRgn` with a rounded rect** — returned to only if the owner's
   C7 run shows tight-window resizing is visibly wrong. Needs the `windows`
   feature `Win32_Graphics_Gdi` (`SetWindowRgn`, `CreateRoundRectRgn` exist in
   windows 0.62.2 `Win32/Graphics/Gdi/mod.rs:1966, :413`; feature at the
   crate's `Cargo.toml:440`). **[verified]** That a region on a DWM-blur
   window with a WebView2 child clips drawing and releases clicks outside it
   to other processes is documented region behaviour. **[unverified]**
2. **`WM_NCHITTEST`, last and unbuilt.** Per-shape click-through cannot come
   from the parent's `WM_NCHITTEST`: the WebView2 is a child HWND covering the
   whole window (`WS_CHILD | WS_CLIPCHILDREN`, sized to `parent_bounds` — wry
   `src/webview2/mod.rs:181-270`, styles at :224, bounds at :246), so it takes
   the hit test **[verified]**, and `HTTRANSPARENT` is documented as passing
   the hit to underlying windows *in the same thread* — not a mechanism for
   handing a click to another process **[unverified — Microsoft
   documentation]**. Closed unless this document first answers how a click on
   the transparent area reaches a different process.

### 2.5 Efficiency: state it, then check it

Claim: a resting orb is a static composited layer. The 4 Hz
`requestAnimationFrame` clock runs only for `recording` / `transcribing`
([components/dictation-indicator.tsx:181-204](../desktop/src/components/dictation-indicator.tsx),
condition at :194), and the window already exists from startup
(dictation_indicator.rs:227-250) — no second WebView2 is created.
**[verified for the code paths; the resting CPU/GPU cost is unverified and
is test row t]** The orb's resting style must therefore have no running CSS
animation; a hover effect is a transition, not a loop. C6 supports the same
choice from the other direction: a 40×40 resting window is also the smallest
dead zone that can be had.

### 2.6 Fullscreen and presenting: ask the OS

Use `SHQueryUserNotificationState`; hide the orb on `QUNS_BUSY`,
`QUNS_RUNNING_D3D_FULL_SCREEN`, `QUNS_PRESENTATION_MODE` and
`QUNS_NOT_PRESENT`; poll at ~1 Hz **only while resting**. The function and
the `QUNS_*` constants exist in windows 0.62.2 (`Win32/UI/Shell/mod.rs:3744,
:53332-53338`) behind the feature `Win32_UI_Shell` (crate `Cargo.toml:702`).
**[verified]** Do not hand-roll a window-rect-versus-monitor heuristic — it
gets borderless-windowed games and slide shows wrong. How the OS classifies
browser F11, a PowerPoint slide show and a borderless-windowed game on this
machine is **[unverified — test row p]**. This needs a crate feature, which
the revised Prompt 1 forbids, so it has no prompt yet — see §7, open list.

### 2.7 Which instant defines the delivery target

The target is recorded when the recording **stops**, whatever stopped it,
because every stop goes through `handleHotkeyUp` (hotkey.tsx:394-410):

| Started by | Stopped by | Instant the target is recorded |
|---|---|---|
| hotkey | hotkey | key release (push-to-talk) or second press (toggle) — today |
| hotkey | click | the stop click |
| click | hotkey | the hotkey press or release that stops it (§2.11) |
| click | click | the stop click |

Live dictation additionally records its target at **start**
(`start_live_typing`, app.rs:146-151, called at hotkey.tsx:378) and freezes on
any change, for all four combinations. **[verified]**

Consequence: **a click-stop executed while the user is in another app
records that app as the target and will type there.** Not new behaviour — a
hotkey released in another app does the same today — but click-stopping
makes it easy to reach, so it has a test row (n). The spike confirmed the
mechanism end to end for click-start / hotkey-stop: recorded target Word,
never the pill (§2.10, C5). **[measured]**

### 2.8 Position persistence: our own store key is authoritative

Revised 2026-09-18. An earlier revision of this section proposed riding on
`tauri-plugin-window-state` alone; that does not hold up, for the reason in
the second bullet.

- The plugin is already a dependency, registered for all windows with
  `StateFlags::VISIBLE` masked ([main.rs:88-92](../desktop/src-tauri/src/main.rs)).
  Plugin 2.4.1 restores a window's state when the window is created
  (`lib.rs:428-429`), tracks `Moved` and `Resized` (:455, :473) and writes on
  `CloseRequested` and at exit (:448, :503). **[verified]**
- It records this label's geometry too — **position and size, of every move
  and resize, including the pill's own placement on the foreground monitor**
  — so it cannot tell where the orb rests from where the pill last was. So the
  orb's position lives in **our own store key**, which is authoritative on
  every show, and the plugin's entry for `dictation-indicator` is never read
  by us. The plugin still restores its entry at window creation, before our
  first show; `position_window` already re-applies position and size on every
  pill show, and every entry into resting mode re-applies position and size
  from our key, so nothing leaks.
- `position_window()` re-places the window bottom-centre on every
  `show_dictation_indicator` (dictation_indicator.rs:341) and at creation
  (:223). It must **not run in resting mode**.
- A stored position is re-clamped to a monitor on every entry into resting
  mode; if its monitor is gone, the default is used again. Default, first
  ever launch: bottom-right, inset by the same margin the pill uses.
- The setting and the position both go in the **tauri store** next to
  `dictation_indicator_enabled` (dictation_indicator.rs:11, :76-82, :303-306),
  **not** WebView2 localStorage — that is the "Preferences can silently stop
  persisting" defect ([ROADMAP.md:22-29](../ROADMAP.md)).

### 2.9 Reaching the dictation loop from the pill window

App-defined `#[tauri::command]` handlers are reachable from the pill window
without a capability entry: `dictation_indicator_ready` is invoked from the
pill today (components/dictation-indicator.tsx:144) while
`capabilities/dictation-indicator.json` grants only `core:event:default`,
`core:path:default`, `os:allow-locale`. **[verified]** The spike exercised
both routes from the pill window: three app commands were invoked, and an
event emitted from the pill reached a listener in the main window, all with
no capability change. **[measured]**

### 2.10 What the spike settled

Spike of 2026-09-17, branch `spike/dictation-control-noactivate` (local only,
never pushed, never merged; spike state at `4bbfd8e`, reverted by `53fb9cd`;
`git checkout 4bbfd8e -- desktop` restores it). Criteria C1–C8 are the
owner's. Full table, raw log lines and the owner's run sheet:
[dictation-indicator-tests.md](dictation-indicator-tests.md), "Control
spike". Images: [screenshots/control-spike/](screenshots/control-spike/).
This section replaces "what the spike must settle"; its five items map onto
C1–C8 as recorded in the tests doc.

| # | Result | Numbers |
|---|---|---|
| C1 click reaches the webview | **PASS** | 10/10 clicks delivered. Pointerdown to Rust 1–2 ms; invoke round trip 2–16 ms, median 5; OS click to JS pointerdown ≤ 17 ms. |
| C2 click does not activate | **PASS** | Foreground `hwnd=131994 'Document1 - Word'` unchanged before and after; 11 s watch at 50 ms; every line `pill_is_focused=Some(false) pill_is_foreground=false`. |
| C3 keyboard still goes to the target | **UNRUN — owner** | Synthetic pre-check passed (keys typed after a pill click landed in Word with no extra click). The criterion is the physical keyboard. **C1 without C3 is not a pass.** |
| C4 transparency survives | **UNRUN — owner's eyes** | Automated look passed: [c4-pill-clickthrough-off.png](screenshots/control-spike/c4-pill-clickthrough-off.png), [c6-orb-40px-over-receiver.png](screenshots/control-spike/c6-orb-40px-over-receiver.png). |
| C5 delivery end to end | **PASS** | Recorded `target=131994`; `type_text_if_foreground` `will_type=true`, `applied=true chars=105 words=19`; the pill window `198504` was never the target. |
| C6 click-through damage | **Measured** | The dead zone is exactly the window rectangle (§2.4). Owner's hand re-check unrun. |
| C7 tight-window viability | **UNRUN — owner's eyes** | tao accepted 60×60, `outer_size=(60,60)`. Captured at ~30 ms per frame: the first changed frame is already the full pill; content jumped because the spike anchored the top-left corner (§2.4). Frames: `c7-grow-frame-*.png`, `c7-shrink-frame-*.png`. |
| C8 drag through an app command | **PASS** | `worst_lag_px=0`, `fg_changed_samples=0` across four drags; resolution below one 15 ms sample. Synthetic motion. |

Not covered by C1–C8: **hover without a click** (a `pointermove` with no
button reaching a no-activate WebView2). The unfold design in §4 depends on
it. The revised Prompt 1 checks it in its drag step — §7, open list.

If the owner's C3 run fails, the design changes: the press is handled in Rust
through the window procedure with the webview used for drawing only, and
§2.1's fallback becomes the plan.

### 2.11 Stopping, and who owns a session

Owner ruling, 2026-09-18, verbatim:

> A session is owned by whatever started it. A hotkey-started session is
> stopped only by its own language's hotkey, exactly as today (release in
> push-to-talk, second press in toggle) — do not change that. A click-started
> session is owned by the control, which is language-agnostic, so any input
> stops it: a click, or either language's hotkey (release or press). A click
> stops any session, whoever started it. Implementation invariant: when
> stopping a session owned by a different language, pass
> activeLangRef.current into the stop path, never the pressed key's language.

It is a strict superset of today's behaviour: every hotkey-started session
behaves exactly as now, and the new stops exist only for inputs and sessions
that do not exist today. Proven by reading the registration effect at
hotkey.tsx:638-651 (toggle routes a press to `handleHotkeyUp(lang)` when
recording, else `handleHotkeyDown(lang)`; push-to-talk routes press and
release) and the early return at hotkey.tsx:304-311 (the head of
`handleHotkeyDown`'s busy guard, which runs to :321 — a press during a
recording starts nothing). The per-language ownership itself is the guard in
`handleHotkeyUp` at hotkey.tsx:396 (`activeLangRef.current !== lang`), which
is why the invariant says to pass `activeLangRef.current`. **[verified]**
Implemented in Prompt 2a, not Prompt 1.

### 2.12 The clickable-icon routes, ranked (review of 2026-09-18, at `8938e5b`)

The goal stated for this work is dictation that starts from an icon — floating
or fixed — and not from a keyboard key. Four routes can carry that, and they
differ in cost by two orders of magnitude. Findings below are from reading the
code at `8938e5b`; the orb commit built the resting state (window mode, size,
clamp, anchor math, setting, render) and stopped, so **nothing in the tree can
start a dictation from a click yet**:

- The orb is inert on purpose: it carries no pointer handler at all, and its
  render ends "Inert until Prompt 2" — rename that to 2a when 2a runs
  (components/dictation-indicator.tsx:250). Grepping
  `dictation-control-press` across `desktop/src` returns nothing.
  **[verified]**
- The tray has two entries, Show and Quit (setup.rs:144-145). **[verified]**
- The main window's dictation page is a Mic glyph, the two hotkey chips and a
  Settings button (pages/dictation-home/page.tsx:26-53). **[verified]**
- `nearest_anchor` and `anchored_origin` are built, unit-tested and
  `dead_code`-annotated "first caller: control plan Prompt 2"
  (dictation_indicator.rs:48, :260, :279). **[verified]**

**What the mechanism already gives us.** The delivery target is recorded when
the recording *stops* (`handleHotkeyUp` → `foreground_window_handle`,
hotkey.tsx:394-404), and a click on the control cannot change it because the
window never activates (§2.1, spike C2). So click-start needs no new delivery
rule at all — it is the same rule the hotkeys already follow (§2.7). That is
why the orb route is cheap: it is wiring, not mechanism.

| # | Route | Cost | Depends on | Delivery caveat |
|---|---|---|---|---|
| a | **Main-window start/stop button** | ~40 lines in `dictation-home/page.tsx` + two context entries | Nothing at all — calls `handleHotkeyDown` / `handleHotkeyUp` directly, in the same provider | While that window is focused it *is* the recorded target, so the transcript should land in an in-app text panel (below) |
| b | **Tray entries** "Dictate — English / العربية" | ~15 lines in `build_tray` + one emit | Nothing — start route only, per §7 | The menu takes focus (to the shell) and the target is recorded at stop, so it lands correctly in toggle mode; in push-to-talk the release instant decides |
| c | **The resting orb** (tap a language target) | Prompt 2a: wiring + the permanently-unfolded orb. Prompt 2b adds the geometry | 2a needs nothing; 2b needs C7; the hover unfold needs the open hover claim | None — the click never activates (§2.1) |
| d | **A desktop/taskbar shortcut** (`vibe.exe --dictate`) | A new start route in `main.rs`/`cli.rs` + `single-instance` handoff | A ruling, and the cold-start race | Same as (b) |

**Route (a) closes a hole that exists today.** With hotkeys switched off, or
when registration failed (hotkey.tsx:693-699 — "Dictation hotkeys could not be
registered"), there is currently **no way to start a dictation at all**: no
button, no tray entry, no orb that responds. **[verified]** A window button is
that fallback, and it needs no capability, no window, and no event — the
button lives in the same React tree as `handleHotkeyDown`. Its one honest
consequence is that the main window is the focused window, so the recorded
target is the app itself; the clean landing is a transcript panel with a Copy
button, which is also the "I lost the text" fallback the app does not have.
That is a product decision, not a mechanism one — question 5 below.

**Route (b) is the cheapest fixed icon, and Prompt 3's tray step was
overloaded.** The menu entries themselves are Rust and need no frontend work;
only the "(F9)" / "(F10)" suffixes need the registered accelerators, which
live in the frontend. Splitting them (Prompt 4 for the entries, Prompt 3 keeps
the labels) lets the entries ship without waiting on the unfold at all.
**[verified]**

**Route (d) is the literal reading of "fixed icon", and it is one argument
away.** A shortcut can only launch a process, and `is_cli_detected()` treats
*any* first argument as CLI mode and forwards it to the bundled sona binary
(cli.rs:28-45). So a `--dictate` shortcut would be swallowed by the CLI path
today. **[verified]** But `tauri-plugin-single-instance` is already registered
and already routes a second launch into the running instance — so a second
launch whose argv is `--dictate` can emit the same in-process start event the
orb emits, giving a pinnable Start-menu or taskbar icon that dictates in the
background with no new plugin, no new host, and no socket. What it needs is a
ruling that `--dictate` is ours and not sona's, plus a first-run rule: on a
*stopped* app the shortcut must launch, arm, and then start dictation once the
page has loaded and the model path is known — the same startup race the ready
flash already covers. Not built; ranked here because it is the only route that
survives the main window being closed to tray.

**Route (c) sequencing, and why the split matters.** The owner's Prompt 2 text
does five things at once: the event and its routing, the §2.11 ownership
rules, the click hint and stop target, the grow-in-place geometry under the
anchor rule, and drag. Only the last two depend on anything unproven (C7, and
for the unfold the open hover claim), and only the last two are large. So 2a
takes the wiring and the permanently-unfolded orb — the shortest path to a
working click-to-dictate — and 2b takes the transitions and drag. The 2a build
also *exercises hover's successor*: it is the first time a real cursor reaches
the no-activate webview, so the hover check rides along in 2b.

**Defect found in the resting state (new; §7).** With the control setting on,
the orb does **not** appear at launch: `initialize` seeds a `"starting"` state
and `create_window` builds pill-sized, runs `position_window` and shows
(dictation_indicator.rs:424-443, :416). It only folds to the orb when the ready
flash's timed `hideDictationIndicator(0)` returns
(hotkey.tsx:682-703 → dictation_indicator.rs:689-692). So the pill appears
first and the orb arrives ~5 s later, which contradicts §7 ("at launch, the
ready flash would fold into the orb") and question 9.3. It also means the
**pill-sized clickable window is briefly live**, which §2.4 spent a whole
spike criterion ruling out — with click-through cleared, that rectangle eats
every click in it for those seconds. Prompt 1b fixes it.

## 3. Why the orb is the right shape

- **Not a second floating object.** Two topmost things from one app compete
  for the eye and for z-order, and the second one would duplicate what the
  pill already says. The pill's colours and states are already learned; the
  control should *be* the pill at rest.
- **Not a second window.** A second Tauri window is a second WebView2
  (memory at rest, contrary to the precedent in ruling 1), a second
  `WebviewWindowBuilder::build()` with its sync-command deadlock rule
  (indicator plan §2.7), and a second z-order and DPI story to keep correct.
  The existing window already exists from startup and already has
  `WS_EX_NOACTIVATE`.
- **An orb, not a bar.** At rest it must be small enough to ignore and
  lose almost nothing to a tight bounding square (§2.4). A circle of ~40 px
  does both.

## 4. Target design

One window, four appearances. Status only, as today — never transcript text.

| Appearance | When | What it shows | Click |
|---|---|---|---|
| **Resting orb** | orb setting on, no session, OS not fullscreen/presenting | ~40 px circle, logo mark, faint grey ring, low opacity until the pointer is near; no running animation | — (see unfold) |
| **Unfolded** | pointer over the orb | the orb plus two targets, `EN` and `ع` | a target starts dictation in that language |
| **Active pill** | a session runs | today's pill: meter, badge, elapsed, phases; hint "click to stop" for a click-started session | anywhere on the pill stops the recording (§2.11) |
| **Completed / error** | 1.5 s / 5 s as today | today's content | — |

Rules:

- The starting control decides the language, as the hotkeys do. No
  auto-detect.
- Stopping follows §2.11: ownership decides which hotkeys stop a session; a
  click stops any session, in that session's own language.
- **Where the active pill appears.** A click-started session grows **in
  place at the orb** — the mouse is the anchor and the eye is already there —
  under the anchor rule of §2.4: the visible content stays stationary, the
  pill grows out of the orb away from the nearest screen edge, clamped to the
  monitor. A hotkey-started session keeps today's placement, bottom-centre
  on the foreground window's monitor; with the orb on, the orb therefore
  leaves its resting place for the length of that session and returns to it
  afterwards.
- After completed/error the window **folds back to the orb** instead of
  hiding. With the orb setting off it hides, exactly as today.
- A press during transcription shows "Still transcribing — wait", from a
  click as from a key (hotkey.tsx:305-321 is the one busy guard).
- Drag moves the orb; the position is remembered (§2.8).
- The orb hides while the OS reports fullscreen or presenting (ruling 3,
  §2.6) and returns afterwards. A running session is not affected.
- Cross-fades and the unfold are 150 ms like today's; `prefers-reduced-motion`
  removes them — the orb then swaps to the unfolded form without motion.
- Arabic: `ع` target and badge never mirror; labels use `dir="auto"`.

## 5. What it touches

Rust:

- [dictation_indicator.rs](../desktop/src-tauri/src/dictation_indicator.rs) —
  store keys and `get`/`set` commands for the orb setting and position
  (async where they create, close or move the window — same rule as the three
  existing commands); a resting mode that clears click-through, skips
  `position_window` and sizes the window to the orb (§2.4); fold-back in
  place of `window.hide()`; an app command that moves the window during a
  drag; re-clamp on every entry into resting mode. Pure geometry (window size
  per mode, orb default rect, clamp, anchor) as unit-tested functions beside
  `pill_rect`. The `hint` doc comment (:60-61) gains the third value.
- [setup.rs](../desktop/src-tauri/src/setup.rs) — tray entries "Dictate —
  English (F9)" and "Dictate — العربية (F10)" next to Show/Quit (:143-172),
  emitting the same event the orb emits. **Start route only** (owner,
  2026-09-18): there is no tray stop item, because a stop issued from the
  tray menu would record the menu's own window as the delivery target. It is
  the fallback if the owner's C3 run fails and the only route to the same
  action that does not need the orb. The accelerators live in the frontend,
  so the labels are set from the frontend after registration, or shown
  without the key until then. **Revised 2026-09-18 (§2.12): the entries are
  Prompt 4, on their own, because only the key suffixes need that frontend
  step** — the menu items and their emit are Rust-only and need no capability
  entry.
- The **dictation shortcut route** (§2.12 d, not built, no prompt until
  question 5 is answered): `single-instance` already hands a second launch to
  the running app, so an argv marker such as `--dictate` becomes a pinnable
  desktop/taskbar icon that starts a dictation in the background. It must be
  taken out of `cli.rs`'s "any argument means CLI mode" rule (:28) and must
  not collide with the args that are forwarded to sona. No new plugin, no new
  host.
- `Cargo.toml` — no `windows` feature is added by Prompts 1–3 as revised.
  `Win32_UI_Shell` arrives with the fullscreen auto-hide when that gets a
  prompt; `Win32_Graphics_Gdi` only if the `SetWindowRgn` fallback is ever
  taken. Each is named in the prompt and the commit that adds it.

Frontend:

- [hotkey.tsx](../desktop/src/providers/hotkey.tsx) — one listener for the
  control event, routed into the existing `handleHotkeyDown` /
  `handleHotkeyUp`. One dictation loop, not two. Session ownership and the
  stop rule of §2.11. `hint: 'click'` for a click-started session.
- [lib/dictation-indicator.ts](../desktop/src/lib/dictation-indicator.ts) and
  [lib/indicator-content.ts](../desktop/src/lib/indicator-content.ts) — the
  `hint` union is `release | toggle` today (dictation-indicator.ts:6;
  indicator-content.ts:108-111); it gains `click` ("click to stop"). A new
  `idle` status with the orb's resting and unfolded content. Both pure, both
  unit-tested — same discipline as today.
- [components/dictation-indicator.tsx](../desktop/src/components/dictation-indicator.tsx) —
  renders the orb, the unfold and the click targets; emits the control
  event; draws the pill's logo at the anchored end when it grows in place.
  **Prompt 1 built the resting render** (:246-262). **[verified]**
- [desktop/src/pages/dictation-home/page.tsx](../desktop/src/pages/dictation-home/page.tsx)
  — the main-window start/stop button (§2.12 a, added by this revision):
  a Start button that calls the same two provider functions a hotkey calls,
  and the transcript panel the text lands in. This is the only route that
  works when the hotkeys are off or failed to register, and it is the only
  one that needs no event. One new provider field exposes the in-flight
  session's start/stop so the button can render as a stop target while
  recording.
- Settings → Dictation — one switch under the indicator switch
  (`pages/settings/sections/dictation.tsx:104-110`), disabled when the
  indicator is off. Strings in both locale files. **Built by Prompt 1**
  (`dictationControlSetting`, `dictationControlSettingInfo`,
  `dictationControlOrbLabel` in both locales). **[verified]**

Docs: rows j–v in [dictation-indicator-tests.md](dictation-indicator-tests.md)
(row s deleted 2026-09-18, the letter is not reused); CLAUDE.md step 7,
README, RELEASING.md at closeout (a later plan revision).

## 6. Prompts for Claude Code

Run them in order. Each one is self-contained. Paste one at a time. Commit
between prompts. Prompt 0 has been run (§2.10); its three owner-run rows are
the only part outstanding. **Prompt 1 has been run and committed** (`8938e5b`:
steps 1-5 and 7; step 6, drag and the hover check, deliberately not built
because those owner rows are unrun).

Revised 2026-09-18 (§2.12): **Prompt 1b is new** (the launch resting state),
**Prompt 2 is split** into 2a (wiring and the permanently-unfolded orb) and 2b
(transitions and drag), and **the tray entries move out of Prompt 3** into a
new Prompt 4, because only their key suffixes need frontend work. Prompt 2's
owner text is unchanged and now appears under 2b.

### Prompt 0 — Spike

The owner's text, verbatim, as run on 2026-09-17.

```
Read CLAUDE.md and docs/dictation-control-plan.md sections 2-4 first. This is a throwaway spike: work on a scratch branch (`spike/dictation-control-noactivate`), never merge it, and revert every product change before you report. Only docs/dictation-indicator-tests.md keeps permanent content. No new crates, no new crate features, no new Tauri plugins.

Goal: settle the criteria below with raw evidence, before any product design is committed to. Do not fix or improve anything else you notice.

Criteria C1-C8 below are authoritative. Your section 2.10 and rows j-v predate them and cannot have covered C6. Map each criterion onto the section 2.10 item it corresponds to, add the ones that are missing, and in your report say explicitly what changed — do not silently renumber.

Setup (temporary, every line marked `// SPIKE:` so it is trivial to find and revert):
1. In desktop/src-tauri/src/dictation_indicator.rs create_window, call set_ignore_cursor_events(false) instead of true.
2. Add one temporary #[tauri::command] fn spike_click_reached(app: tauri::AppHandle, note: String) that logs at info level: timestamp ms since app setup, the note, GetForegroundWindow() as an integer plus its window title (GetWindowTextW) and process id, the pill window's is_focused(), and whether the pill window is the foreground window. Register it in the generate_handler! list in main.rs, marked `// SPIKE:`. App-defined commands need no capability entry for the pill window — dictation_indicator_ready proves that, so do not edit capabilities.
3. In desktop/src/components/dictation-indicator.tsx, add a temporary onPointerDown on the pill element that console.info's the timestamp and the pointer coordinates and calls invoke('spike_click_reached', { note: 'pointerdown' }).

Criteria, each PASS / FAIL with evidence attached:
C1 The click reaches the webview: the pill's console logs the pointerdown AND the Rust log shows spike_click_reached with a matching timestamp. Report the end-to-end latency (pointerdown to Rust log) — the hover-unfold decisions later depend on it.
C2 The click does not activate the window: GetForegroundWindow() is identical before and after the click, and the pill's is_focused() stays false.
C3 The keyboard still goes to the target application: after clicking the pill while Word has the caret, typing on the physical keyboard lands in Word at the caret with no extra click first. C1 without C3 is not a pass, and your report must say so in those words.
C4 Transparency survives: with click-through off, screenshot the pill and compare against docs/screenshots/indicator/. No opaque or black rectangle, no visible bounding box.
C5 Delivery still works end to end: click-start a recording by invoking the same path the hotkey uses, stop it with the hotkey, and confirm type_text_if_foreground returns true and the text lands in Word. Report whether the pill window ever became the recorded target.
C6 Measure the click-through damage (do NOT defer this to a test row — it decides Prompt 1's design): with the current 400x64 window and click-through off, click ~40 px to the left of the visible pill over a text editor over the window underneath. Does the editor receive the click? Then size the window to a ~40 px square temporarily and click its transparent corner and 20 px outside it — does the click below get through? Record both answers.
C7 Tight-window viability: with the window sized to the orb (~40 px, undecorated, non-resizable) and then resized to the pill size (400x64), does the resize produce a visible flash, jump or partially drawn frame? Does tao accept a window that small? Include screenshots or a short screen recording of the transition in both directions.
C8 Drag behaviour: with a temporary app command that moves the window by a pointer delta (setPointerCapture on pointerdown, pointermove while down, release on pointerup), is the drag smooth, and is GetForegroundWindow() unchanged for the whole drag? Report the worst-case position lag you observe.

Owner-driven rows: C3, C4, C6, C7 need me at the keyboard or my eyes. Produce a numbered run sheet for those four with the exact clicks, what to look for, and what counts as PASS. Leave the build in the spike state so I can run them, and say clearly in your report that those rows are unrun until I do.

Then: revert every SPIKE change, confirm `git status` is clean on the spike branch apart from docs, and report PASS / FAIL per criterion with the raw log lines, the screenshots and the measured numbers. If C1 or C3 or C5 fails, stop there and say so: the design then needs the press handled in Rust via the window procedure with the webview used for drawing only, and section 3's mechanism ranking changes. Do not start Prompt 1.

Run cargo fmt, cargo clippy, cargo test from desktop/src-tauri, and pnpm i18n:generate, pnpm exec tsc --noEmit -p tsconfig.json, pnpm lint, pnpm test from desktop/ — in a shell with the MSVC environment loaded — with the spike code in place, and report the results. To read the pill's console, launch with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 and open http://127.0.0.1:9222 in Chromium (docs/dictation-indicator-tests.md, "How to run").
```

### Prompt 1 — Resting orb, tight window, anchor rule, the setting, drag

The owner's text of 2026-09-18, verbatim. It replaces the earlier draft: the
fullscreen poll is gone from this prompt (it needs a crate feature), and
position persistence uses our own store key (§2.8).

```
Step 0. State whether C3, C4 and C7 have been run (I will have pasted the results). If C3 failed, stop and say so. If they are still unrun, do steps 1-5 and 7 only, and stop before step 6.

Read CLAUDE.md and docs/dictation-control-plan.md sections 2 and 4. The spike proved the webview handles the click and the window never activates. This prompt builds the resting orb, the hit-testing, drag, position persistence and the off-by-default setting. No new crates, no new crate features, no new Tauri plugins — say so in the commit.

1. Sizing. Add const ORB: f64 = 40.0 (logical) beside WIDTH and HEIGHT. Make the window rect a pure function of mode: orb mode -> ORB x ORB, pill mode -> WIDTH x HEIGHT, both scaled physically for the target monitor's scale factor exactly as pill_rect already does. Keep WIDTH/HEIGHT/ORB the single source of truth and extend the existing unit tests over both modes and the monitor edge cases already covered.

2. Tight window as the hit-testing mechanism (C6). The window is always sized to the visible shape — never 400x64 while only an orb is drawn. There is no per-pixel hit-test code and no WM_NCHITTEST. State this in the code comment with the C6 number: a 400x64 clickable window ate every click in its rectangle. Do not call SetWindowRgn.

3. The anchor rule (C7). When switching orb -> pill, keep the visible content stationary: compute the new window origin from the orb's current edge nearest the screen edge plus its vertical centre, so the orb's pixels stay put and only the pill grows out of them. Same rule in reverse for pill -> orb. Add a pure unit test for the origin math in both directions and on a second monitor.

4. The setting. One new boolean in the tauri store beside dictation_indicator_enabled (dictation_indicator.rs) — NOT localStorage, for the reason in ROADMAP.md. Default false: with it false, today's behaviour is byte-for-byte unchanged, the window stays pill-sized and still hides when idle. Add get/set commands mirroring the existing indicator pair, async where they create or close the window (the deadlock rule in that file's comment applies), and the Settings toggle under the existing indicator toggle. Both locales.

5. Resting vs active placement. In resting mode, position_window must NOT re-place the window bottom-centre (dictation_indicator.rs:341 today). The orb's position comes from its own store key and is re-applied on every entry into resting mode; the plugin's entry for this label is never read. On first ever launch with no stored position, place it at the bottom-right edge, inset by the same margin the pill uses.

6. Drag. Use pointer capture on the orb (pointerdown -> setPointerCapture, pointermove while down, pointerup releases and writes the position to the store key). Move the window through an app command that applies a pointer delta; it needs no capability entry, as dictation_indicator_ready proves. The drag must never activate the window — assert GetForegroundWindow() is unchanged at pointerup and log a warning if it is not (C8 measured zero changes across four drags). While you are here, confirm in the log that hover events arrive without a click (pointermove with no button): the unfold design in section 4 depends on it, it was the one gap the spike left, and drag already exercises the path. If hover does not arrive, stop and report — do not design around it.

7. Remove the fallback: pill mode still hides when idle exactly as today. Do not add the hover unfold, motion, tray entry or screenshots — that is Prompt 3.

8. Run cargo fmt, clippy, cargo test from desktop/src-tauri and pnpm i18n:generate, pnpm exec tsc --noEmit -p tsconfig.json, pnpm lint, pnpm test from desktop/, in a shell with the MSVC environment loaded. Do not force-stop my installed app without asking; if a dev instance cannot start because of it, stop and tell me instead.

9. Commit as one change. In the message, name C6 as the reason for the tight window and C7 for the anchor rule, and state that no crate, feature or plugin was added, so the RELEASING.md dependency rule is visibly satisfied.
```

**Status: run and committed as `8938e5b`** (steps 1-5 and 7). Step 6 was not
built — the owner's C3, C4 and C7 rows are still unrun, and the prompt says to
stop before it in that case. So drag, the position write-back and the
hover-without-a-click check are all still outstanding; 2b carries them.

### Prompt 1b — The resting orb at launch (review, 2026-09-18)

Drafted from the §2.12 read of `8938e5b`. Small, self-contained, and
independent of C3/C4/C7.

```
Read CLAUDE.md and docs/dictation-control-plan.md §2.12 (the defect paragraph at the end) and §7. Prompt 1 is committed at 8938e5b. This prompt fixes one ordering defect it left: with the control setting on, the orb does not appear at launch.

1. Today: initialize seeds status "starting" (dictation_indicator.rs:424-443) and create_window builds pill-sized, runs position_window and shows (:416). The orb only arrives when the ready flash's timed hide_dictation_indicator(0) returns (hotkey.tsx:682-703 -> dictation_indicator.rs:689-692), so the pill is on screen first and the fold happens about 5 s later. Section 7 says "at launch", question 9.3 expects it, and meanwhile a pill-sized clickable window is live — which is exactly the dead zone §2.4 and spike criterion C6 ruled out.

2. Fix: when is_control_enabled, seed status "idle" instead of "starting", create the window at ORB size through the existing window_size path, and enter resting instead of leaving it pill-sized. Do not duplicate the resting placement logic — enter_resting already sets position, size, click-through and the state; call it. Keep the ready flash: with the control on, the ready flash should still be able to show (it is the "hotkeys are armed" signal) and fold back to the orb when it ends. Decide and say which you chose: (a) the flash replaces the orb briefly and hide folds back to it, or (b) the flash is suppressed when the control is on and the orb carries the ready signal. Prefer (a) if it does not flicker; the pill already folds back through hide_dictation_indicator.

3. The first-run case stays intact: no stored position means the default bottom-right inset, and the position is written back (resting_rect already does this). The setting off path must behave byte-for-byte as before: seeded "starting", pill-sized, hidden when idle.

4. Add a unit test for the pure part you touch. The window geometry is already tested; if the choice in step 2 is expressible as a pure function (e.g. "which status to seed and which mode to create in, given control_enabled"), extract it and test both settings, rather than asserting on Tauri calls.

5. Run cargo fmt, clippy, cargo test from desktop/src-tauri and pnpm i18n:generate, pnpm exec tsc --noEmit -p tsconfig.json, pnpm lint, pnpm test from desktop/, in a shell with the MSVC environment loaded. Do not force-stop my installed app without asking.

6. Commit as one change, naming the defect and the §2.12 paragraph, and state that no crate, feature or plugin was added. If you cannot verify the launch behaviour on a dev build without stopping my installed app, say so in the report instead of claiming it works.
```

### Prompt 2a — Wire the control into the loop (review, 2026-09-18)

Drafted from §2.12. This is the shortest path to dictation that starts from an
icon: it needs no geometry, no drag and no hover, so it is independent of
C3/C4/C7. The owner's Prompt 2 text follows under 2b and now covers only what
is left after this.

```
Read CLAUDE.md and docs/dictation-control-plan.md sections 2.1, 2.4, 2.7, 2.11 and 4, and §2.12. The orb, the setting and the tight window are built and committed (8938e5b). This prompt makes a click start and stop dictation. It deliberately does NOT touch the window geometry, dragging or hover — that is 2b. There must be one dictation loop, not two.

1. One event. The pill window emits a single event to the main window, name it dictation-control-press, carrying { action: 'start' | 'stop', lang?: 'en' | 'ar' }. No new capability entry: app-defined commands and core:event:default already covered this in the spike (§2.9, §2.10 item 12). Emit it from the component when a target is clicked.

2. The orb unfolds permanently. Until 2b builds the hover unfold, the resting orb shows its two language targets permanently — EN and ع — inside the existing idle state. Keep the window sized to what is visible (§2.4): ORB is 40 logical px and the targets do not fit beside it inside a square, so either raise a named constant for the unfolded resting size (pure function of mode and scale, unit-tested like window_size) or stack the two targets under the orb inside a taller resting rect. Pick the one that keeps the clickable area to the drawn shape, and say which you picked and why in the commit. No hover, no transition, no animation at rest (§2.5).

3. Route, do not copy. In desktop/src/providers/hotkey.tsx listen for that event and route 'start' into handleHotkeyDown(lang) and 'stop' into the existing stop path. Do not duplicate either function, and do not add a second recording loop.

4. Ownership (§2.11). Record what started the session: a hotkey with its language, or the control. A hotkey-started session is stopped only by its own language's hotkey, exactly as today — do not change that path. A click-started session is stopped by any input: a click, or either language's hotkey, release or press. A click stops any session, whoever started it. Invariant: when stopping a session owned by a different language, pass activeLangRef.current into the stop path, never the pressed key's language. Extract the decision into a pure function in desktop/src/lib/ with vitest cases for every start/stop combination in §2.7, in both activation modes, including the "click stops a hotkey-started session" and "a foreign hotkey does not stop a held session" rows.

5. The pill is the stop target. While a session runs and the control setting is on, the whole active pill is a click target that emits action 'stop', and the window is sized to the pill's visible shape (§2.4 — a full-size clickable window is not acceptable). With the setting off the pill stays click-through and unclickable, exactly as today. A click during transcription goes through the existing busy guard (§4, hotkey.tsx:304-321) and shows "Still transcribing — wait": the same guard, not a second one.

6. Hint. A click-started session shows hint 'click' ("click to stop"): extend the hint union in lib/dictation-indicator.ts and lib/indicator-content.ts with its tests, the Rust doc comment on `hint` in dictation_indicator.rs, and both locale files. A hotkey-started session keeps release/toggle exactly as today.

7. Do not build: grow-in-place, the anchor math, drag, the hover unfold, tray entries. §2.12 sequences those into 2b, Prompt 3 and Prompt 4.

8. Run cargo fmt, clippy, cargo test from desktop/src-tauri and pnpm i18n:generate, pnpm exec tsc --noEmit -p tsconfig.json, pnpm lint, pnpm test from desktop/, in a shell with the MSVC environment loaded. Fill rows j, m and o of docs/dictation-indicator-tests.md as far as automation can; rows needing a microphone stay for the owner. Do not force-stop my installed app without asking.

9. Commit as one change. State in the message that no crate, feature or plugin was added (the RELEASING.md dependency rule), and that C7 and the hover claim are untouched by this prompt.
```

### Prompt 2b — Grow in place and drag

The owner's Prompt 2, text unchanged. After 2a it covers the residue: the
geometry steps (4, and the second half of 5), drag and the position
write-back, and step 6's hover check. Its step 3 — the ownership rules — was
already implemented in 2a; running it twice is harmless but redundant, so drop
it if 2a's pure function and tests are in place. **Not pasteable until the
owner's C3 and C7 rows are run**: 2b resizes a clickable window around a
remembered anchor, which is exactly what C7 measures.

```
Read CLAUDE.md and docs/dictation-control-plan.md sections 2.7, 2.11, 4 and the owner rulings. Wire the orb into the existing dictation loop. There must be one loop, not two.

1. The pill window emits one event to the main window (name it dictation-control-press) carrying { action: 'start' | 'stop', lang?: 'en' | 'ar' }. No new capability: core:event:default already covers it (the spike emitted from the pill to the main window). Until Prompt 3 the orb shows its EN and ع targets permanently unfolded.

2. In desktop/src/providers/hotkey.tsx, listen for that event and route start into handleHotkeyDown(lang) and stop into the existing stop path. Do not copy either function.

3. Stopping and ownership (plan section 2.11). Record what started the session: a hotkey (with its language) or the control. A hotkey-started session is stopped only by its own language's hotkey, exactly as today — do not change that path. A click-started session is stopped by any input: a click, or either language's hotkey, release or press. A click stops any session, whoever started it. Invariant: when stopping a session owned by a different language, pass activeLangRef.current into the stop path, never the pressed key's language. Extract the decision into a pure function in desktop/src/lib/ with vitest cases for every start/stop combination in plan section 2.7, in both activation modes.

4. While a session runs and the orb setting is on, the whole active pill is a stop target, and the window is sized to the pill's visible shape (section 2.4 — a full-size clickable window is not acceptable). With the setting off the pill stays click-through, as today.

5. A click-started session shows hint 'click' ("click to stop"): extend DictationIndicatorHint, pillContent and its tests, the Rust doc comment on `hint`, and both locale files. A click-started session grows in place at the orb under the anchor rule of section 2.4, using the pure origin math from Prompt 1 and remembering the anchor side for the fold-back; the pill draws its logo at the anchored end so the orb's pixels stay put. Hotkey-started sessions keep position_window.

6. A click during transcription shows "Still transcribing — wait" through the existing busy guard.

7. Run the full lint and test set from CLAUDE.md. Fill rows j, m, n, o, u and v of docs/dictation-indicator-tests.md as far as the automation can; rows that need a microphone stay for the owner. State in the commit: no new crates, features or plugins.
```

### Prompt 3 — Unfold, motion, screenshots

The owner's text, with **the tray step moved out to Prompt 4** (this revision,
§2.12: only the "(F9)" / "(F10)" suffixes need the frontend, so the entries
themselves are no longer gated on the unfold). Step 3 below is struck in the
listing only — the step numbers are kept so the remaining steps still read as
the owner wrote them. Still not pasteable until the hover claim is settled.

```
Read CLAUDE.md and docs/dictation-control-plan.md sections 4 and 5. Finish the design.

1. Hover unfold: the resting orb shows only the logo mark; pointer over it unfolds the EN and ع targets, pointer away folds them after a short delay. The window is resized to the unfolded shape, under the anchor rule of section 2.4, before the targets become clickable. 150 ms transitions; no running animation at rest. prefers-reduced-motion: swap without motion. Depends on hover reaching the no-activate webview — confirmed or refuted by Prompt 1 step 6 (carried by 2b).

2. Resting opacity lowers when the pointer is far and rises when it is near, using CSS only.

3. The frontend sends the registered accelerators to Rust after registration so the tray labels can read "(F9)" / "(F10)"; without them the labels have no key. (The menu entries and their emit are Prompt 4 and are already built by the time this runs.)

4. Screenshots of every appearance — resting, unfolded, active click-started pill with the "click to stop" hint, fold-back — under docs/screenshots/control/, both at a screen edge and mid-screen, for owner review.

5. Both locales, uv run scripts/check_i18n.py, then the full lint and test set. State in the commit: no new crates, features or plugins.
```

### Prompt 4 — Tray entries: dictation from a fixed icon (review, 2026-09-18)

Drafted from §2.12. No dependency on C3/C4/C7, on the unfold, or on hover: the
entries emit the same event 2a already routes. Paste after 2a.

```
Read CLAUDE.md and docs/dictation-control-plan.md sections 2.7, 2.11, 5 and §2.12 (route b). 2a is committed: the pill emits dictation-control-press and the main window routes it into the existing loop. This prompt adds the tray as a second route to the same event.

1. In desktop/src-tauri/src/setup.rs build_tray (:143-172), add two entries next to Show and Quit: "Dictate — English" and "Dictate — العربية", ids dictate-en and dictate-ar. On click they emit the same dictation-control-press start payload the pill emits, to the main window. No stop item (plan §7): a stop issued from the tray menu would record the menu's own window as the delivery target.

2. Start route only, and never a second loop. While a recording or a transcription is in flight the entries do nothing beyond the existing busy guard — do not add a queue, and do not start a second recording. The guard is the one in handleHotkeyDown (hotkey.tsx:304-321); route through the same listener 2a added rather than a new one.

3. The tray menu takes focus to the shell, and the delivery target is recorded at stop (hotkey.tsx:394-404). That is correct behaviour for toggle-mode sessions and must not be "fixed": do not add a foreground-window capture at menu-open time. Say this in a code comment with the §2.7 reason, so nobody later mistakes it for a bug.

4. Labels carry no key for now: the accelerators live in the frontend and reach Rust in Prompt 3. If it is cheap, read the registered EN/AR accelerators from the store and append them; if not, ship the plain labels and note it in the commit.

5. Both locales if any user-visible string moves into the frontend; the tray labels themselves are Rust strings (the tray menu is built in Rust and does not go through the frontend i18n). Run uv run scripts/check_i18n.py anyway.

6. Run cargo fmt, clippy, cargo test from desktop/src-tauri and pnpm i18n:generate, pnpm exec tsc --noEmit -p tsconfig.json, pnpm lint, pnpm test from desktop/, in a shell with the MSVC environment loaded. Do not force-stop my installed app without asking.

7. Commit as one change. State that no crate, feature or plugin was added, and that the tray is a start route only.
```

Verification and closeout are deliberately not written. They belong to a
later revision of this plan.

## 7. What only you can do, and what is open

Only you:

- Run C3, then C4 and C7, from the run sheet in
  [dictation-indicator-tests.md](dictation-indicator-tests.md) ("Control
  spike"). C3 is the authority row: if it fails the design flips to
  Rust-mediated presses (§2.10). Prompt 1 stopped before its drag step because
  of them, and §2.12's split keeps everything that depends on them inside
  Prompt 2b — **2a and Prompt 4 are built and pasteable without them**.
  Reproducible: the spike branch is still present locally
  (`spike/dictation-control-noactivate`, tip `53fb9cd`) and
  `git checkout 4bbfd8e -- desktop` restores the spike state.
- Answer the questions in section 9.
- Rows that need a microphone, a second monitor, a slide show or a game:
  m, n, p, q (two monitors), u, v.
- Native check of the new Arabic strings (the setting's label and tooltip,
  the orb's accessible name; later "click to stop" and the tray entries).

Closed since the first revision: Prompt 0's text (supplied and run); the
reading of ruling 2 for push-to-talk (superseded by §2.11); whether the tray
entries stop a recording (they do not — start route only).

Open list:

- **NEW (review, 2026-09-18): the resting orb does not appear at launch.** The
  startup ordering defect in §2.12's last paragraph: the pill is built and
  shown first, and the fold to the orb only happens when the ready flash's
  timed hide returns, ~5 s later. Until Prompt 1b runs, a pill-sized clickable
  window is live in that window of time. Prompt 1b fixes it.
- **NEW: the main-window start button's landing (question 5).** Route (a) of
  §2.12 works today and closes the "hotkeys off or failed to register" hole,
  but while that window is focused it is the recorded delivery target. Needs a
  ruling: type into an in-app transcript panel, or clipboard. Not built.
- **NEW: the desktop/taskbar shortcut route (route d of §2.12).** The only
  route that survives the main window being closed to tray, and it needs one
  ruling — that a marker such as `--dictate` belongs to the app and not to
  `cli.rs`'s arg-forwarding to sona — plus a cold-start rule. No prompt.
- **Hover without a click.** Whether a `pointermove` with no button reaches
  the no-activate WebView2 was not among C1–C8. The unfold in §4 depends on
  it. Prompt 1 step 6 checks it; if hover does not arrive, stop and report —
  do not design around it.
- **Fullscreen auto-hide (ruling 3) has no prompt.** It needs the `windows`
  feature `Win32_UI_Shell` (§2.6) and the revised Prompt 1 adds no crate
  feature. The orb ships off by default, so nothing is exposed meanwhile; it
  needs a prompt of its own before the orb is recommended to anyone.
- **Dev only: reloading the main page breaks F9/F10.** The old page's
  registration stays in Rust, the new page's `register` fails and the pill
  shows "Dictation hotkeys could not be registered". Same family as the
  unproven startup flash in the indicator plan §7. Not fixed; noted in
  [debug.md](debug.md).
- **Dev only: a dev launch can exit when the installed app's WebView2 profile
  goes away.** Both use one WebView2 user-data folder; a dev instance started
  seconds after the installed app was stopped exited by itself ~50 s later
  with code −1. Not investigated; noted in [debug.md](debug.md).
- **The tray entry is a start route only.** A stop from the tray menu would
  record the menu's own window as the delivery target; not built, and its
  test row (s) is deleted.
- **Harness rule.** Test harnesses that synthesize keystrokes must refuse to
  type unless the expected window is foreground. Adopted after the spike
  typed into a browser tab the owner had switched to; it is a rule now, not a
  note.
- Whether the orb appears at launch is still formally question 9.3. Prompt 1
  as written ("first ever launch") implies at launch, after the ready flash,
  and is built that way.

## 8. Guarantee surface

Unchanged, and each prompt's commit says so.

- No new crates. No new Tauri plugins.
- Prompts 1, 1b, 2a, 2b, 3 and 4 as revised add **no** `windows` crate
  feature, and Prompt 4 adds no frontend dependency: the tray entries are
  `tauri::menu::MenuItem`s in the existing tray, emitting an in-process event.
  When the fullscreen auto-hide gets a prompt it will add `Win32_UI_Shell` for
  `SHQueryUserNotificationState`, and `Win32_Graphics_Gdi` would come only
  with the `SetWindowRgn` fallback; each is named in the prompt and the commit
  that adds it — the same disclosure RELEASING.md made for
  `Win32_UI_WindowsAndMessaging` in v1.3.0 (RELEASING.md:1263). Both are
  local Win32 calls; neither opens a socket.
- In-process Tauri events only, between the two existing windows and the
  tray. No egress, no new file beyond two keys in the existing tauri store,
  no new host.
- Any dependency change still triggers the full RELEASING.md
  re-verification pass; none is planned.
- docs/dictation-indicator-tests.md is extended (rows j–v, s deleted); there
  is no second matrix.
- All cargo/tauri commands run from a shell with the MSVC environment loaded.
- The spike branch stays local: never pushed, never merged.

## 9. Questions put back to the owner

Not decided here.

1. **Gesture.** *Hover-unfold into EN / ع, then click* versus
   *press-and-hold on the orb as a walkie-talkie.*
   - Hover-unfold: two deliberate steps, so a brushed orb starts nothing;
     language is chosen by the click, as the hotkeys choose it. Risk: an
     unfold that opens under a passing pointer near a screen edge, and a
     hover that depends on the open item in §7 (hover without activation).
   - Press-and-hold: one gesture, mirrors push-to-talk, release is the stop.
     Risks: the language has to come from somewhere else (last used, or two
     orbs); the hand is pinned to the mouse for the whole dictation; any
     pointer-capture loss mid-hold ends the recording; and the release
     instant defines the delivery target with the pointer still over the
     orb, which the spike shows is fine (non-activation holds). Accidental
     start is *more* likely than with two steps — a press is enough.
2. **Edge-snapped or free-floating?** Snapping keeps the orb out of the way
   and makes "grow away from the edge" unambiguous; free-floating lets it sit
   beside the text being written but covers content wherever it rests.
3. **At launch, or only after the first dictation?** At launch, the ready
   flash would fold into the orb and the control is there from the start.
   After the first dictation, a fresh login shows nothing until the hotkey
   has been used once — quieter, but the control is absent exactly when
   someone without the hotkey habit would look for it. (Prompt 1 is built as
   "at launch"; see §7.)
4. **Do the spike's results change any of these?** Partly answered. Drag
   through an app command is smooth and never activates (C8), so
   free-floating is viable and question 2 is a matter of taste, not of
   mechanism. Resizing showed no flash in the capture (C7, owner's eyes
   pending), so the tight window and "grow in place" stand. Hover was not
   tested, so question 1 cannot be closed yet: if hover does not reach the
   webview, hover-unfold is off the table and the choice is between a
   permanently unfolded orb and press-and-hold.

5. **NEW (review, 2026-09-18): where does a dictation started *inside the main
   window* land?** §2.12 route (a) is the cheapest click-to-dictate there is,
   and the only route that works when the hotkeys are off or failed to
   register. But the main window is the foreground window while it is used, so
   the target recorded at stop is the app itself. Options: (i) an in-app
   transcript panel with a Copy button — nothing is lost, and it doubles as
   the missing "I lost the text" fallback; (ii) clipboard, with the existing
   green "Copied" pill; (iii) do not build it, and rely on the orb and the
   tray. Not decided here.
6. **NEW: does the tray route need push-to-talk to behave?** Route (b) takes
   focus to the shell, so in push-to-talk the release instant decides the
   target, and a tray-started session is stopped by a hotkey release the user
   may never press. Is "tray entries are for toggle mode" acceptable, or
   should the tray entry arm push-to-talk against the window that was in front
   when the menu opened? Ruling 2's symmetry argues for the second, and the
   stored-target mechanism for it already exists (`type_text_if_foreground`
   compares at delivery time). Not built either way.

## 10. Claims not verified from source

Numbering kept from the first revision; items the spike closed say so.

1. WebView2 inside a `WS_EX_NOACTIVATE` window receives pointer down and up —
   **closed, measured (C1)**. Move while a button is down — **closed (C8)**.
   **Hover with no button: still unverified** (§7).
2. A click on it leaves the previous foreground window in front; WebView2
   does not take focus programmatically — **closed, measured (C2, C5)** for
   synthesized input; the physical-keyboard check (C3) is the owner's and
   unrun.
3. Clearing click-through leaves the window visually transparent —
   **measured (C4 screenshots)**; owner's eyes unrun.
4. `HTTRANSPARENT` only passes hits within the same thread — from
   Microsoft's documentation, not tested (§2.4).
5. tao accepting a ~40 px undecorated window — **closed, measured (C7:
   60×60 physical)**. Resizing without a visible flash — no flash in a ~30 ms
   capture; owner's eyes unrun.
6. `SetWindowRgn` on a DWM-blur window with a WebView2 child clips drawing
   and releases outside clicks to other processes (§2.4, fallback only).
7. The resting orb costs next to nothing in CPU/GPU (§2.5; row t).
8. How `SHQueryUserNotificationState` classifies browser F11, a PowerPoint
   slide show and a borderless-windowed game; that a small topmost window of
   our own does not affect its answer (§2.6; row p).
9. Whether tauri-plugin-window-state refuses an off-screen position on
   restore — **moot**: its entry for this label is never read by us (§2.8).
10. Pointer-driven drag through an app command is smooth and never activates
    the window — **closed, measured (C8)**, synthetic motion.
11. A stop issued from the tray menu records the tray's menu window as the
    delivery target — **moot**: the tray is a start route only and no stop
    route is built (§5).
12. `core:event:default` lets the pill window emit to the main window —
    **closed, measured**: the spike emitted `spike-control-press` from the
    pill and the main window's listener received it (C5).
