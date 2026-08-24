# Roadmap

Where Vibe Dictation is going. This is a personal project with no fixed
schedule — items move when they move.

Status key: **Planned** = intended, **Considering** = not decided, **Known
issue** = a defect that exists today, **Shipped** = done, on main.

---

## Known issues

- **Silent startup window** (found 2026-08-24, v1.3.0 acceptance testing). For a
  few seconds after launch, the dictation hotkeys are not yet registered — the
  frontend registers them only once the webview and React app finish loading —
  so pressing F9/F10 does nothing, with zero feedback, and a dictation attempted
  in that window is silently lost. Related but distinct: the model is loaded
  lazily on the first dictation, so the first transcription after launch is slow
  (not lossy — recording works; it just waits on the load). With autostart the
  window is rarely hit in practice, but a launch-then-immediately-dictate flow
  loses speech with no indication anything went wrong.
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

- **Startup ready-feedback** (next cycle's headline). Close the silent startup
  window: show the dictation indicator in a "starting…" state from launch until
  the hotkeys are actually registered, then confirm readiness (indicator flash
  or one-shot notification "Vibe ready — F9/F10"), so a too-early keypress is
  visibly "not yet" instead of silently ignored. Companion, opt-in: a model
  warmup setting that preloads the model at startup so the first dictation is
  as fast as every later one — off by default, since it holds ~3 GB of VRAM
  from launch on an autostarted app.
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
