# Releasing Vibe Dictation

Private release procedure for this fork. Every release re-runs the full
verification below — the zero-egress claim is re-proven per artifact, never
inherited from a previous release.

## Build

1. Open a shell with the MSVC environment loaded (`Enter-VsDevShell`/`VsDevCmd
   -arch=x64` — required so the MSVC `link.exe` wins over coreutils on PATH).
2. `uv run scripts/pre_build.py` — fetches the pinned Sona + ffmpeg Vulkan
   sidecars (`.sona-version`); verify the zip hash against
   `docs/sona-sidecar-sha256.txt`.
   **If the sidecars already exist in `desktop/src-tauri/binaries/`, the
   script skips the fetch** (and even on a fresh fetch the zip is extracted
   in-memory, never written to disk) — in that case verify by hashing the
   sidecar binaries themselves against the `exe:` and `ffmpeg:` pins.
   Equivalent-or-stronger than the zip hash: it checks the exact bytes that
   get bundled.
3. `cd desktop && pnpm install && pnpm exec tauri build` — produces
   `target/release/bundle/nsis/Vibe Dictation_<version>_x64-setup.exe`.

## Verify (the zero-egress audit — full pass on every release, no inheritance)

1. **Strings audit** on `target/release/vibe.exe` AND the post-install exe —
   patterns as an ARRAY (never `-SimpleMatch` with a `|`-joined string):
   `Select-String -Path $exe -Pattern "aptabase","yt-dlp","ytdlp","anthropic","api.anthropic","github.com/thewh1teagle"`
   → zero matches; `"updater"` hits must be only the known h2/rustls/Win32
   substrings; **positive control** `"sona"` must hit (a clean audit must be
   shown able to find something). `"huggingface.co"` is **expected** to hit —
   it is the opt-in model downloader's pinned manifest
   (`src/model_download.rs`, cargo feature `model-download`, in defaults);
   confirm the hits are the manifest URL prefix and nothing else. A
   `--no-default-features` build must have zero `huggingface.co` hits.
2. **Install** (NSIS `/S`), launch, confirm the HKCU Run entry points at the
   installed exe (autostart preference-sync).
3. **Netstat sampler** (~2 min, during live dictation): all sockets owned by
   `vibe.exe`/`sona.exe` are loopback-only; Sona LISTENING on `127.0.0.1`,
   never `0.0.0.0`. If the LLM-formatting setting is enabled during the sample,
   `vibe.exe` may additionally hold a loopback connection to the local Ollama
   port (default `127.0.0.1:11434`) — loopback-only still holds.
   **Observing the Ollama connection requires a denser sampler**: it lives
   ~1–2 s per format request and closes immediately, so 5 s-interval
   LISTENING/ESTABLISHED-only polling misses it (v1.1.0 finding). Sample at
   ~1 s intervals and include TIME_WAIT rows (client trace remains visible
   for ~1–2 min after close; its PID column shows 0 by design).
   Run the sample with **no model download in progress** — a user-initiated
   download is the one permitted non-loopback connection (`huggingface.co` /
   `*.hf.co` CDN over 443) and exists only for the download's duration.
4. **Firewall**: outbound-block rules for the installed `vibe.exe` + `sona.exe`
   exist (recreate if the install path changed); dictation still works under
   the block. A model download attempted under the block must fail cleanly
   (error dialog, `.part` file removed) without affecting dictation.
5. **Functional**: one English + one Arabic dictation into MS Word (reference
   target; Windows 11 Notepad is a known-bad injection target); latency within
   ~2 s of key release after warmup.

## Rules learned the hard way

- **Never launch `target\release\vibe.exe` directly.** Any release-profile exe
  rewrites the autostart Run entry to itself by design (preference-sync) —
  release candidates get **installed** (NSIS `/S` is fine) and run from the
  install path only. Debug builds are gated and never write the entry.
- After any release work, `cargo clean` (once the installer is archived and
  hash-verified) so no stray exes exist for autostart or app-resume mechanisms
  to resurrect.

## Content-pin + archive

- Record SHA-256 of the installer and built exe in your release record.
- Copy the installer to a release archive outside the repo, e.g.
  `..\releases\vibe-dictation\<tag>\` — outside `target/`, so `cargo clean`
  cannot remove it — and verify the copy's hash.
- Tag the release commit (`vX.Y.Z`) and push with tags.

## Unreleased (next release)

- **Custom vocabulary** (Settings → Dictation, `lib/vocabulary.ts`). One
  shared list for EN + AR: plain lines bias whisper via the (previously
  unused) `init_prompt` → sona `prompt` field; `wrong = right` lines are
  whole-word, case-insensitive replacements applied to partial and final
  transcripts before the optional Ollama pass (single-pass alternation — no
  rule cascading; Unicode-boundary matching for Arabic). Frontend-only, no
  new dependencies, no egress impact; an empty list sends no prompt field
  and changes nothing.
- **Default dictation shortcuts are now F9 (EN) and F10 (AR)** — single keys
  instead of the upstream-inherited three-key chords (owner request; F9/F10
  matches how the app is actually used). Stored prefs override defaults, so
  existing profiles are unaffected.
- **Live dictation — type as you speak** (Settings → Dictation, opt-in, off by
  default, requires the type-at-cursor output mode). While recording, the
  audio callback mirrors samples into an in-memory buffer; the frontend
  snapshots it every ~1.5 s (`snapshot_live_recording` → 16 kHz WAV via the
  bundled ffmpeg), re-transcribes the growing recording through the existing
  loopback sona pipeline (`quiet` transcribe mode — no taskbar progress, no
  segment events), and types the stable prefix at the cursor
  (`inject_live_update`), backspace-reconciling earlier words when a later
  pass revises them. Safety: a foreground-window guard (GetForegroundWindow,
  `windows` crate `Win32_UI_WindowsAndMessaging` feature — no egress) refuses
  injections once focus leaves the starting window; the final text then goes
  to the clipboard with a notification. The final pass reconciles the target
  to the definitive transcript, so the end state is identical to a non-live
  dictation. The dictation indicator shows status only (the earlier
  indicator-text preview was removed — owner decision). Silence-hallucination
  guard, two live-test findings (2026-08-09): pressing the hotkey typed
  "Thank you" before any speech, and "Watermelon" + 25 s of held silence grew
  a phantom "Thank you" that later self-corrected. Fix: a **tail-energy
  gate** — a snapshot is produced only when speech-level samples arrived
  since the last snapshot, so partials pause entirely during silence (also
  saving GPU) — plus whole-partial matches against known whisper silence
  phrases (EN + AR) are suppressed. Partials only; the final pass is never
  filtered. Release functional check: dictate one word, hold 20+ s of
  silence — nothing may be appended. No egress impact:
  loopback only. Functional check for the release pass: dictate with live
  dictation ON into MS Word, confirm words appear at the cursor while
  speaking and the final text matches a non-live dictation; click into
  another window mid-dictation and confirm typing stops and the result
  arrives via clipboard + notification.
- **Opt-in model downloader** (`src/model_download.rs`,
  `cmd/model_download_cmd.rs`, Settings → Select Model → "Download a model") —
  the one deliberate exception to zero egress. Per-download confirmation
  dialog naming the exact URL and size; manifest limited to the two
  content-pinned models with a compile-time URL prefix, redirect host
  allowlist (`huggingface.co` / `*.hf.co`), and SHA-256 pins cross-checked
  against `docs/model-sha256.txt` by a unit test. Streams to a `.part` file,
  verifies size + hash before moving the file into the models folder, and
  removes partials on cancel or failure. Cargo feature `model-download` (in
  defaults); `--no-default-features` deletes the path entirely. Verification
  impact: strings audit now expects `huggingface.co` (step 1), the netstat
  sample must run with no download in progress (step 3), and under the
  firewall block a download fails cleanly while dictation works (step 4).

## Resolved in v1.0.1

- **Version string** — adopted a `1.0.x` fork versioning scheme; `tauri.conf.json`
  bumped from the upstream-inherited `3.0.22` to `1.0.1` (installer artifacts are
  now `Vibe Dictation_1.0.1_x64-setup.exe`).
- **Autostart quoting defect (was HIGH).** v1.0.0's `auto-launch` crate wrote the
  HKCU Run value unquoted with a trailing space, so a spaced install path never
  launched at logon on Windows 11. v1.0.1 owns the write in `src/autostart.rs`
  (quoted, winreg-based) across both the startup sync and the settings toggle,
  verified over a real reboot.

## Shipped in v1.2.0

- **English-only interface.** The Settings → General display-language picker and
  the whole `displayLanguage` preference are removed (owner request: the Arabic
  UI was never used). Paraglide now compiles with `baseLocale` as the sole
  strategy, so a stale `PARAGLIDE_LOCALE`/`prefs_display_language` value in an
  old store can never switch the UI; `en-US` is the only reachable locale at
  compile time. The ar-SA message files stay in `i18n/` (inert, keeps
  `check_i18n.py` parity); dictation Arabic is unaffected — model language is
  owned by the per-language hotkeys.
- **Per-language dictation hotkeys + display-locale decoupling — the §11 fix,
  both halves together.** Dictation has no auto-detection path anymore: the
  existing shortcut forces `en`, a new second shortcut (default
  `CmdOrCtrl+Alt+Space`) forces `ar`, and the hotkey that starts a recording
  owns it (the other one cannot cut it short). `setLanguageDefaults` no longer
  writes the model language on a display-locale change (text direction only);
  stored `modelOptions.lang` affects file transcription only. Shortcut
  collisions are detected with parser-equivalent normalization (CmdOrCtrl ≡
  Ctrl on Windows — shared between the registration skip and the settings
  warning) and accelerators are trimmed before registration. Home screen and
  Settings show both labeled shortcuts; en-US + ar-SA locales updated.

## Shipped in v1.1.1

- **Dictation prompt-injection guard** (`src/ollama.rs`). In-the-wild v1.1.0
  incident: a command-shaped dictation ("check the codebase and provide a
  summary…") was *answered* by the formatting model with a hallucinated
  project description instead of being cleaned up. Two layers, both
  compile-time: the transcript is now sent wrapped in `<transcript>` tags with
  a fixed guard epilogue appended to the (user-editable) formatting
  instructions, and a deterministic divergence check discards any output that
  balloons past 2× the input length or retains under half of the input's
  vocabulary (Arabic-normalized: diacritics stripped, alef/ya/ta-marbuta
  folded) — falling back to the raw transcript, same fail-open as a dead
  Ollama. The incident pair is a permanent regression test.

## Shipped in v1.1.0

- **Opt-in LLM formatting via local Ollama** (`src/ollama.rs`, `cmd/ollama_cmd.rs`,
  Settings → Dictation). Loopback-only (host is a compile-time `127.0.0.1`
  constant), Ollama cloud models filtered from the list and re-blocked at format
  time, `think` disabled for reasoning models, context pinned to 8K
  (`num_ctx` — full native context otherwise starves Whisper of VRAM), output
  bounded, deterministic Arabic punctuation-spacing fix. Any failure falls back
  to the raw transcript. None of the deferred v1.0.2 items below shipped in
  v1.1.0.

## Deferred to a future release (was v1.0.2)

- **Transcription-language control lost + display-locale clobber (FUNCTIONAL
  GAP, found 2026-07-14 during acceptance testing).** The Task 10
  UI lockdown removed the only transcription-language picker, leaving the
  effective `lang` (localStorage `prefs_modal_args`) invisible and
  user-unreachable (`resetOptions()` orphaned). Sole surviving writer: changing
  the **display** locale silently pins `lang` to `en`/`ar` — never `auto` —
  via `setLanguageDefaults` (preference.tsx:190-195). Combined with Whisper
  large-v3 misdetecting short/accented English as Arabic (covert translation;
  evidence in report §11), bilingual dictation has no reliable control. Fix as
  one change: **per-language hotkeys** (F9 = force `en`, second hotkey = force
  `ar`) and **delete the display→model-language coupling** — UI locale must
  never touch model lang. Until shipped: never change the display language;
  dictate Arabic or long-form English on `auto`.
- **ffmpeg resolution pin** — the app-side recording conversion resolves
  `ffmpeg` from PATH (observed picking up an unrelated `ffmpeg` shim) instead
  of the bundled
  `ffmpeg.exe` next to the installed exe; Sona correctly gets the bundled one
  via `SONA_FFMPEG_PATH`. Pin the app-side lookup to the bundled binary so the
  audited install is self-contained and PATH drift can't change conversion
  behavior.
- **`cli.rs` review** — CLI surface untouched by the lockdown pass; audit which
  arguments still make sense for a dictation-only tool.
- **Locale trim re-verification** — Phase B trimmed bundled locales to en + ar;
  next release must confirm the language picker and paraglide output stay
  consistent after any locale-related dependency updates.
- **Stale commit stamp** — the embedded commit hash lags the actual build
  commit (build.rs needs a `cargo:rerun-if-changed=.git/HEAD`-style directive);
  the v1.0.0 binary reported `c64da41` though built at `f9d3906`.
- **Hotkey shortcut field — no recorder, no validation, no register feedback:**
  the Advanced → hotkey field is a **plain text input**, not a key recorder — it
  never captures keystrokes in any state; it only accepts typed/pasted accelerator
  strings in exact Tauri syntax. (Corrects an earlier mis-report of a "three-stage
  recorder degradation": there was no recorder, and the "empty image 3" was just
  the empty text box.) Three defects:
  1. **No key-capture** — users must know accelerator syntax by heart. Replace
     with a real recorder: focus the field, press keys, render chips from the
     actual keydown events, Esc cancels.
  2. **No validation** — modifier-only combos (`Ctrl+Win`) and garbage strings
     are accepted and silently break the hotkey. Require ≥1 non-modifier key at
     entry.
  3. **No registration feedback** — a `register()` failure leaves the UI showing
     success while the app is left hotkey-less. Surface the error and keep the
     last-known-good shortcut registered (swap, not drop).
