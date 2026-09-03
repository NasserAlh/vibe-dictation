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

## Shipped in v1.4.1 (2026-08-25)

**Verification record (partial gate — owner ruling, 2026-08-25): shipped
with 2 of 6 criteria run, WORSE than the v1.3.0/v1.4.0 3-of-6 split, because
the owner's live EN + AR functional pass has not been run against this build.**
Published 2026-08-25: tag `v1.4.1` pushed, GitHub Release cut, installer
attached (asset `Vibe.Dictation_1.4.1_x64-setup.exe`, hash re-verified by
downloading the published asset back). Four criteria remain unrun against this
build: **3** netstat sampler during live dictation, **4** firewall-block test,
**5** functional EN + AR dictation into MS Word, **6** live-dictation
functional check — all four need the owner (an elevated shell for 4, a
dictating voice for 3, 5 and 6). The release notes went out without a
verification statement; amended 2026-09-03 to carry the same partial-gate
disclosure as the v1.3.0 and v1.4.0 notes.

Build-step check (not one of the six criteria): sidecar content pins —
`desktop/src-tauri/binaries/` was already populated, so the sidecar binaries
themselves were hashed against `docs/sona-sidecar-sha256.txt` rather than the
zip: `sona` `96C7BA10…F1207` and `ffmpeg` `1326DDE4…3EC5E`, both exact matches.

Run and passed:

1. **Strings audit** on `target/release/vibe.exe` AND the post-install exe,
   identical results on both: forbidden patterns zero; positive control `sona`
   hit 91×; all five `updater` hits are the known substrings (h2
   `next_window_update` / `is_pending_window_update`, rustls `KeyUpdateRequest`
   / `KeyUpdateReceivedInQuic` / `TooManyKeyUpdateRequests`, Win32
   `GetUpdateRect`); both `huggingface.co` hits are the downloader manifest
   prefix `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/` and the
   "failed to reach huggingface.co" error string.
2. **Install** — NSIS `/S`, quoted HKCU Run entry pointing at the installed exe.

Not passed (carried debt, now against v1.4.1):

3. **Netstat sampler — NOT MEASURED.** A sweep ran (75 samples at ~1 s
   intervals, ~75 s) and was clean: only three distinct sockets owned by
   `vibe.exe`/`sona.exe`, all loopback — sona LISTENING on `127.0.0.1:58946`
   (never `0.0.0.0`) plus the established loopback pair to the shell, zero
   non-loopback rows. **But it sampled an idle app, and the criterion requires
   ~2 min during live dictation.** It proves the steady-state socket surface,
   not the in-dictation one, so it does not satisfy the criterion.
4. **Firewall-block test — BLOCKED.** Still no outbound-block rules for the
   installed `vibe.exe`/`sona.exe` — `Get-NetFirewallApplicationFilter`
   matching either program returns zero. Missing since v1.2.0 and unrecreated
   through v1.3.0 and v1.4.0. Creating them needs an elevated shell.
5. **Functional EN + AR dictation into MS Word — NOT RUN.** Needs the owner
   speaking. v1.4.0's pass is not inherited: this document's standing rule is
   that verification is re-proven per artifact.
6. **Live-dictation functional check — NOT RUN.** Needs the owner speaking.

Hashes: installer
`a86b6bba5aaff205c9a35cbb5938de05711be19b0c423639853d246dbc764b77`, installed
`vibe.exe` `37186b76b237412b63236fcc99148a069ed92a4964e62f1461958fe7f40e1ff9`
(raw `target/release/vibe.exe` at
`299f5d5618975409ae9a404bfd9a92fe3b66dec057be087c1570a296d695636d` — the usual
3-byte Tauri NSIS bundle-type stamp difference, located this release at offset
`0x737C94`, `UNK` → `NSS`). Installer archived to
`..\releases\vibe-dictation\v1.4.1\` and the copy's hash re-verified.

- **Release-notes filename mismatch (defect, found 2026-08-25, scoped
  2026-09-03).** GitHub replaces the space in an uploaded asset name with a
  dot, so the published file is `Vibe.Dictation_<version>_x64-setup.exe` while
  notes written from the local build name the spaced original: anyone pasting
  the notes' `Get-FileHash` command gets file-not-found instead of a hash.
  Checked against every published release: the v1.4.1 notes had it (three
  occurrences — the Install line, the hash table row and the command;
  corrected in the 2026-09-03 amendment) and the v1.2.0 notes had it too
  (same three occurrences, corrected on the live release 2026-09-03 together
  with `RELEASE-NOTES-v1.2.0.md` in this repo at lines 6, 45 and 49, which is
  where the spaced name came from; that file was removed on 2026-09-03 once
  its hashes were copied into the v1.2.0 record below — no other release keeps
  an in-repo notes copy).
  v1.3.0 and v1.4.0 are unaffected: v1.3.0's notes carry a `sha256sum`-style
  line and v1.4.0's name no file. Rule for the publish step: write asset
  names in release notes with the dot, as GitHub will serve them.

- **Reopening from the shortcut** (commit `009ef8d`). Closing the main window
  hides it so the tray icon and global hotkeys survive — but a subsequent
  launch from the Start-menu/taskbar shortcut then did nothing at all, leaving
  the tray icon as the only route back to the UI. The second process hands its
  argv to the running instance via `tauri-plugin-single-instance` and exits,
  and that callback only called `set_focus()`; tao's Windows backend
  early-returns from `set_focus` unless the window is already visible and not
  minimized, so on a hidden window it was a silent no-op. Only the tray
  handlers worked, because they call `show()` first. Fixed with
  `setup::show_main_window()` — show, unminimize, focus — now used by the
  single-instance callback and both tray handlers; `unminimize` matters
  independently, since `SW_SHOW` leaves a minimized window minimized.
  Verified on the installed 1.4.1 build: close-to-tray → shortcut relaunch →
  window visible; minimize → shortcut relaunch → restored and foreground.
- **Installer cannot upgrade over an orphaned Sona sidecar** (found 2026-08-26,
  fixed on main in `6a980de` — the published v1.4.1 installer does NOT contain
  the fix; it first ships in the next release's installer). Upgrading on the
  owner's machine failed with `Error opening file for writing: …\sona.exe`:
  two orphaned `sona.exe` processes (leftover from a run whose teardown never
  executed) held locks on the install dir, and the stock Tauri NSIS template
  closes only the main executable. Fix: `windows/hooks.nsh` adds
  `NSIS_HOOK_PREINSTALL`/`NSIS_HOOK_PREUNINSTALL` macros running
  `taskkill /F /IM sona.exe /T` before any file is touched; the vc_redist
  logic moved into the same file (Tauri accepts one hooks file), and
  `tauri.windows.conf.json` — whose own `installerHooks` entry silently
  overrode the main config — was merged into `tauri.conf.json` and deleted.
  **Verified in a real install (2026-08-26):** a detached `sona.exe serve`
  was spawned from the install dir (PID 122536, path confirmed), the
  hooks-bearing locally built installer ran `/S` → exit code 0, the orphan
  was gone afterwards, and the install dir was rewritten (new `vibe.exe`
  build stamp + fresh `uninstall.exe`) — the exact condition that produced
  the file-write error the day before. The published artifact was then
  restored: the GitHub asset was re-downloaded and hash-verified
  (`a86b6bba…`, exact match), reinstalled `/S`, and the installed `vibe.exe`
  re-hashed to `37186b76…` — byte-identical to the published record.

## Shipped in v1.4.0 (2026-08-25)

**Verification record (partial gate — owner ruling, 2026-08-25):** shipped with
3 of 6 criteria run, same split as v1.3.0. Run and passed: strings audit on
both the built and installed exe (all forbidden patterns zero; positive
control `sona` hit 31×; all four `updater` hits are the known h2/rustls/Win32
substrings — `GetUpdateRect`, rustls `KeyUpdate*`, h2 `next_window_update`;
both `huggingface.co` hits are the downloader manifest prefix and host
string), NSIS `/S` install with the quoted HKCU Run entry pointing at the
installed exe, and functional EN + AR dictation into MS Word within ~2 s
(run with **large-v3-turbo**, the owner's active model — not large-v3).
NOT RUN at ship time (carried debt, now against v1.4.0): netstat sampler,
firewall-block test, live-dictation functional checks. Hashes: installer
`42161e0927310d5a76d3e5e74c99fb996de7e7ea72eeebd86daeee085b539993`, installed
`vibe.exe` `f05a9bd09f198e75148306d23af9a5249bbe0fec02eab2d732f37f5b5d62e318`
(raw `target/release/vibe.exe` at
`b6c92c3d59cf57ac97b9b90c0ec3ec1ee2b8dd52cd1906a6ac4922b3c0fa7170` — the
usual 3-byte Tauri NSIS bundle-type stamp difference). Installer re-archived
2026-09-03 to `..\releases\vibe-dictation\v1.4.0\` from the GitHub Release
asset — the copy recorded as archived on 2026-08-25 was not in the archive
folder — and the copy's hash re-verified: `42161e09…`, exact match.

- **Startup ready-feedback** (commit `4fb99a9`). Closes the v1.3.0
  silent-startup defect: the dictation indicator shows "Starting…" from launch
  (state seeded Rust-side before the webview loads) until the first
  hotkey-registration pass settles, then flashes "Ready — F9 / F10" (the
  actual registered accelerators) for 5 s and hides. If hotkeys are enabled
  but nothing registered, the indicator says so instead of vanishing.
  Verified live: Ready flash screenshot-confirmed in dev, Starting phase +
  flash owner-observed on the installed build's cold start.
- **Opt-in model warmup** (Settings → Dictation, off by default). Preloads the
  selected model at startup — and immediately when toggled on — so the first
  dictation skips the lazy load. Off by default: holds ~3 GB VRAM from launch
  on an autostarted app. Failures fall through to the normal load path.

## Shipped in v1.3.0 (2026-08-24)

**Verification record (partial gate — owner ruling, 2026-08-24):** shipped with
3 of 6 criteria run. Run and passed: strings audit on both the built and
installed exe (all forbidden patterns zero; positive control hit; sole
`updater` hit is h2's `next_window_update`; both `huggingface.co` hits are the
downloader manifest prefix + its error string), NSIS `/S` install with the HKCU
Run entry pointing at the installed exe, and functional EN + AR dictation into
MS Word under 2 s. NOT RUN at ship time: netstat sampler, firewall-block test
(the v1.2.0 outbound-block rules were found missing and had not yet been
recreated), and the live-dictation functional checks — to be run post-release
against the installed build. Hashes: installer
`d4005b86cb253f014caab67fc2cdd2a6889bf1a1680d929207121b6bb3bc7e2b`, installed
`vibe.exe` `c975c5d6b67917d0c55f3bc874c9d23c7c92f77fd7e3c01e84a6a14727cd29d9`
(NSIS-stamped; the raw `target/release/vibe.exe` differs by 3 bytes — Tauri's
`__TAURI_BUNDLE_TYPE_VAR` marker — at
`54a4ab3b2ce14ed88d86fb86c324b7fd084e78350334fa9b3be50fca92f7e5e0`).

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

Hashes (copied 2026-09-03 from the published v1.2.0 release notes, which were
the only in-repo record until then): installer
`Vibe.Dictation_1.2.0_x64-setup.exe` (44,172,357 bytes)
`4450b3e3e10324b0ec08a363d8db4fbe54e9239e5b8371bc61a5bb47b96e9a2c`, installed
`vibe.exe` `4f09209914b3e0f50db1d1fd7044e4a6c2cf47757f2e5cedb729bacea6b0d9ea`.
Verified by hand before release on 2026-07-28: strings audit, loopback-only
netstat sample during live dictation, dictate-under-firewall-block test.

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
