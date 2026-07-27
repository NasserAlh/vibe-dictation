# Roadmap

Where Vibe Dictation is going. This is a personal project with no fixed
schedule — items move when they move.

Status key: **Planned** = intended, **Considering** = not decided, **Known
issue** = a defect that exists today.

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

- **Automatic model download option.** Models are placed by hand today. An
  opt-in, clearly-labelled download would make first-run much easier. It has to
  stay opt-in and off by default — the zero-egress guarantee is the point of the
  project, so this would be the one deliberate exception and it must be visible.
- **Better first-run experience.** Right now a new user installs, then has to
  find a model, download 3 GB, and point the app at it. A guided first launch
  would remove most of that.
- **Model management in Settings.** See which models are present, their size, and
  which one is active, without leaving the app.
- **Show transcriptions in realtime.** Display the recognized text as you speak
  (in the on-screen dictation indicator), instead of only after the recording
  stops. Today the engine transcribes the finished recording in one pass, so
  this means streaming audio to the engine in chunks and rendering partial
  results as they land.

## Considering

- **More languages.** The engine handles many; the app currently ships English
  and Arabic hotkeys. Adding languages means deciding how many hotkeys is too
  many, and whether a picker beats one hotkey per language.
- **Custom vocabulary.** Names, acronyms, and domain terms that Whisper
  consistently gets wrong could be corrected with a user-supplied word list.
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

---

## Suggestions

Open an issue. Bug reports should say which Windows version, which GPU, and
which model you are running.
