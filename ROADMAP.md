# Roadmap

Where Vibe Dictation is going. This is a personal project with no fixed
schedule — items move when they move.

Status key: **Planned** = intended, **Considering** = not decided, **Known
issue** = a defect that exists today, **Shipped** = done, on main.

---

## Known issues

- **Stale commit stamp.** The installed binary can self-report an older commit
  hash than it was built from. A frontend-only change does not re-run the
  `build.rs` stamp step. Cosmetic — it does not affect the app — but it makes
  "which build is this?" harder to answer from inside the app. Fix: force the
  stamp step to re-run on any source change.
- **RTL text injection.** Typing Arabic at the cursor mangles character order in
  some target applications. The workaround today is clipboard output mode. A
  proper fix means changing how synthetic keystrokes are sent, or detecting
  RTL and switching output mode automatically.
- **No signed installer.** Releases are unsigned, so Windows SmartScreen warns on
  download and some antivirus flags the keystroke-injection behaviour. Signing
  needs a code-signing certificate.

## Planned

- **Animated recording indicator.** The floating indicator is static while
  recording — "Listening…" with a fixed dot. Animate it with a smooth
  level meter driven by the live microphone signal (a small waveform or
  pulsing bars scaled to input level), so you can see the app is hearing you
  before any text arrives. The backend already mirrors samples during capture;
  the indicator needs a lightweight level event from it (local, status-only —
  the indicator never shows transcript text, per the standing owner decision).
- **Better first-run experience.** Right now a new user installs, then has to
  fetch a model (via the opt-in in-app download or by hand) and select it. A
  guided first launch would remove the remaining steps.
- **Model management in Settings.** See which models are present, their size, and
  which one is active, without leaving the app.
- **Hotkey recorder in Settings.** The shortcut field is a plain text input:
  it captures no keystrokes, accepts invalid accelerator strings, and shows
  nothing when registration fails. Replace it with a real recorder — focus the
  field, press the key, done — with validation and visible feedback when a
  shortcut cannot be registered.

## Considering

- **Dictation history.** A short local log of recent dictations, so a lost
  transcript can be recovered. Local-only, with an easy way to clear it.
- **Continuous integration.** There is no CI today, by design — every release is
  hand-verified against `RELEASING.md`. CI would speed up testing, but a build
  server that produces the shipped binary changes the trust story, so this needs
  thought before it happens.
- **Reproducible builds.** Would let anyone confirm that a published installer
  really was built from the published source. This is the strongest possible
  version of the zero-egress claim.

## Not planned

- **macOS and Linux.** Windows-only is a deliberate scope choice. The text
  injection, autostart, and firewall enforcement are all Windows-specific.
- **Cloud transcription of any kind.** The entire point is that audio never
  leaves the machine.
- **A general-purpose transcription app.** This is a dictation tool. File
  transcription, subtitles, and batch processing are what upstream
  [Vibe](https://github.com/thewh1teagle/vibe) is for.

## Shipped

- **Reopening the app from its shortcut** (2026-08). Closing the window hides
  it so the tray icon and hotkeys stay alive — but launching from the
  Start-menu or taskbar shortcut afterwards did nothing at all, leaving the
  tray icon as the only way back to the interface. The second launch now
  shows the window, restores it if it was minimized, and brings it to the
  front.
- **Startup ready-feedback** (2026-08). Closes the silent startup window found
  in v1.3.0 acceptance testing: for a few seconds after launch the dictation
  hotkeys were not yet registered, so an early F9/F10 press was silently lost.
  Now the floating indicator shows "Starting…" from launch (state seeded on the
  Rust side before the webview loads) until the first hotkey-registration pass
  settles, then flashes "Ready — dictate with F9 / F10" (the actual registered
  shortcuts) and hides. If hotkeys are enabled but none registered — shortcut
  taken by another app, or both fields empty — the indicator says so instead of
  vanishing. Companion, opt-in (Settings → Dictation, off by default): model
  warmup preloads the model at startup so the first dictation is as fast as
  every later one; off by default because it holds ~3 GB of VRAM from launch on
  an autostarted app.
- **Custom vocabulary** (2026-08). Settings → Dictation: one shared list for
  both languages, one entry per line. A plain line ("Claude") biases Whisper
  toward the word by joining the engine's init prompt (appended glossary,
  length-capped). A "wrong = right" line ("clod = Claude") additionally
  applies a deterministic whole-word, case-insensitive replacement to partial
  and final transcripts — before the optional LLM formatting pass, so the
  formatter only ever sees corrected text. Frontend-only; empty list is a
  strict no-op.
- **Show transcriptions in realtime** (2026-08). Opt-in "Live dictation —
  type as you speak" (Settings → Dictation, off by default, requires
  type-at-cursor output): recognized words are typed directly at the cursor
  while you speak and self-correct as context improves; the final pass
  reconciles the target to the definitive transcript. A foreground-window
  guard stops typing the moment focus leaves the target (the text then
  arrives via clipboard). The pinned engine has no streaming-input endpoint
  and Whisper is not a streaming model, so this re-transcribes the growing
  recording every ~1.5 s through the existing loopback pipeline. Costs extra
  GPU while recording — only while speech is arriving: a tail-energy gate
  pauses the loop during silence, which is also what stops Whisper's
  silence hallucinations ("Thank you.") from ever being typed (found and
  fixed in live testing; a denylist of known phantom phrases backs it up
  for partials, and the final pass is never filtered).
- **Automatic model download option** (2026-08). Settings → Select Model →
  "Download a model". Opt-in per download: nothing is fetched without an
  explicit confirmation naming the exact URL and size. The downloadable set is
  exactly the two content-pinned models (large-v3, large-v3-turbo); the URL
  prefix, redirect host allowlist, and SHA-256 pins are compile-time constants,
  and a `--no-default-features` build removes the downloader entirely. The
  deliberate — and only — exception to zero egress.
- **Single-key default shortcuts** (2026-08). F9 (English) and F10 (Arabic)
  replace the upstream three-key chords. A dictation hotkey is held down while
  speaking, so chords were hostile to the core use — and with live dictation,
  held modifiers would corrupt the injected keystrokes. Stored preferences
  override the defaults, so existing profiles keep their own shortcuts.

---

## Suggestions

Open an issue. Bug reports should say which Windows version, which GPU, and
which model you are running.
