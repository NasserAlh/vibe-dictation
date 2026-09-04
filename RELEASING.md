# Releasing Vibe Dictation

Private release procedure for this fork. Every release re-runs the full
verification below — the zero-egress claim is re-proven per artifact, never
inherited from a previous release.

**Scope of the claim (owner ruling, 2026-09-03): the zero-egress guarantee
covers the installer as well as the running app.** The installer contacts
nothing: WebView2 is taken from Windows 11 in-box
(`bundle.windows.webviewInstallMode` = `skip`, so Tauri's bootstrapper
download is not compiled in), and the Microsoft VC++ runtime DLLs that
`sona.exe` needs are bundled app-local and content-pinned (see *Bundled
Microsoft VC++ runtime* under Build) instead of downloaded. The only
network access anywhere in the product remains the opt-in, per-download
model fetch inside the running app. Releases before this ruling (v1.2.0 to
v1.4.1) shipped installers that could reach `aka.ms` and `go.microsoft.com`;
see the 2026-09-03 audit record in the v1.4.1 section.

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

### Bundled Microsoft VC++ runtime (app-local, content-pinned)

`sona.exe` hard-imports five Microsoft Visual C++ runtime DLLs (`MSVCP140`,
`MSVCP140_1`, `VCRUNTIME140`, `VCRUNTIME140_1` and the OpenMP runtime
`VCOMP140`); `vibe.exe` and `ffmpeg.exe` import only the Universal CRT
api-sets that ship with Windows. Since the ruling of 2026-09-03 (option b2)
the five DLLs are bundled **app-local**: tracked in
`desktop/src-tauri/windows/vcredist/`, placed in the install root beside
`sona.exe` by `bundle.resources` in `tauri.conf.json`, and content-pinned in
`docs/sona-sidecar-sha256.txt` like the sidecars. Nothing is installed
system-wide and the installer never downloads a runtime. They are exact,
unmodified copies from the Build Tools redistributable folder
`VC\Redist\MSVC\14.44.35112\x64\` (`Microsoft.VC143.CRT\` and
`Microsoft.VC143.OpenMP\`):

| File | File version | Bytes | SHA-256 |
|---|---|---|---|
| `msvcp140.dll` | 14.44.35211.0 | 557,728 | `0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9` |
| `msvcp140_1.dll` | 14.44.35211.0 | 35,952 | `bfad5aef4c63a669e3c140655cdfdf395b6c979b400a447bd5dcb65ed8826c3d` |
| `vcruntime140.dll` | 14.44.35211.0 | 124,544 | `d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066` |
| `vcruntime140_1.dll` | 14.44.35211.0 | 49,792 | `1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f` |
| `vcomp140.dll` | 14.44.35211.0 | 193,152 | `55aba23cdcd6484fbb06f4155b8ca75adfce7a881f10afd0c49457165e677164` |

Re-pin whenever the DLLs are refreshed from a newer Build Tools; the strings
audit expects these five names to hit (see Verify step 1). Servicing
trade-off, accepted by the ruling: Windows Update does not patch app-local
copies, so runtime security fixes reach users only through a new release.

Redistribution licence (checked 2026-09-03): the Build Tools install's own
`Licenses\1033\Redist.txt` points at `https://aka.ms/vs/17/redist.txt`, which
resolves to Microsoft's *Visual Studio 2022 Redistribution* page — the
"Distributable List"/"REDIST.txt" that the **Distributable Code** section of
the Visual Studio 2022 licence terms references. Its *Visual C++ Runtime
Files* section reads: "Subject to the License Terms for the software, you may
copy and distribute with your program any of the files within the following
folder and its subfolders except as noted below. You may not modify these
files. — `[VisualStudioFolder]\VC\redist`", and adds that distribution of the
runtime package, merge modules and individual binaries "is limited to
licensed Visual Studio users and is subject to its license terms". The
excluded folders are the `debug_nonredist` ones only; these five files are
retail. Microsoft's *Redistribute Visual C++ files* page names the
application-local folder as a supported deployment location ("It's also
possible to directly install the Redistributable DLLs in the application
local folder"), recommending central deployment only for servicing reasons.
The Build Tools 2022 licence page itself
(`https://visualstudio.microsoft.com/license-terms/vs2022-ga-diagnosticbuildtools/`)
is rendered by script and could not be retrieved as text from a shell; its
Distributable Code section was not quoted verbatim here — confirm it once
from the Visual Studio Installer's licence view.

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
   **Expected hits from the bundled VC++ runtime:** `msvcp140`,
   `msvcp140_1`, `vcruntime140`, `vcruntime140_1` and `vcomp140` are the
   five app-local DLLs beside `sona.exe`; their names hit in `sona.exe`'s
   import table and in the installer's file list and are not egress
   indicators — confirm each hit is one of those and nothing else.
   **Installer audit (same step):** the generated
   `target/release/nsis/x64/installer.nsi` must carry
   `!define INSTALLWEBVIEW2MODE ""` and include `windows/hooks.nsh`, and
   `hooks.nsh` must contain no `NSISdl`, no `inetc`, no `ExecShell "open"`
   and no URL. A `makensis /V4` recompile of that script to a scratch path
   lists the packed files (the five DLLs, `sona`, `ffmpeg`) and must show no
   plugin command from `NSISdl`.
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

## Release tooling (per machine)

Two clones refresh this repository. Publishing and verification depend on
tooling that lives outside the repo, so it is recorded here per machine.

**Machine A — the workstation that cut v1.4.1 (commits authored as
Nasser Al-Husayan; recorded 2026-09-03):**

| Tool | Version / location |
|---|---|
| Windows | 11, build 10.0.26200 |
| Git | 2.55.0.windows.3 |
| `gh` | 2.98.0 (2026-08-20), WinGet package path, logged in to github.com as NasserAlh (keyring); the only machine authenticated to cut Releases |
| Node | v24.19.0 |
| pnpm | 10.4.1 **via `corepack pnpm` only** — bare `pnpm` is not on PATH; `tauri build`'s `beforeBuildCommand` needs a `pnpm` shim on PATH |
| Tauri CLI | 2.10.0 (`@tauri-apps/cli`; NSIS 3.11 cached under `%LOCALAPPDATA%\tauri\NSIS`) |
| Rust | cargo 1.97.1 / rustc 1.97.1 |
| MSVC | Build Tools 2022 17.14 (package 17.14.37516.0), toolset 14.44.35207, `VsDevCmd.bat -arch=x64` under `Common7\Tools`; redist 14.44.35112 (source of the five app-local DLLs) |
| Python / uv | Python 3.12.14 via uv 0.12.5 (`python3.12`; bare `python` is the Store stub) |
| Installer archive | `..\releases\vibe-dictation\<tag>\` — holds v1.4.0 and v1.4.1 |
| Model store | `%LOCALAPPDATA%\net.nasserhub.dictation\` (large-v3, large-v3-turbo) |

**Machine B — the machine that committed on 2026-08-26 (commits authored
as nasser):** tooling not yet recorded; its only SSH key pair is
`~/.ssh/id_ed25519_vps`, and it holds no installer archive that has been
listed. Fill this in from B.

## Unreleased — queued for v1.5.0 (dictation indicator rework, 2026-09-04/05)

**Not yet built or gated.** Everything below is on `main` only; the six
verification criteria run when the installer is cut. Nothing here changes
the guarantee surface: no new crates, crate features or Tauri plugins, and
`git diff main -- desktop/src-tauri/Cargo.toml Cargo.lock desktop/package.json
pnpm-lock.yaml` is empty. The only new runtime traffic is two **in-process**
Tauri events from Rust to the indicator window (`dictation-indicator-hide`,
`dictation-indicator-level`); no socket, no file, no host.

What changed (docs/dictation-indicator-plan.md, Prompts 0–5):

- `d53e7c5` instrumentation and the manual test matrix
  (docs/dictation-indicator-tests.md); `4fdb773` deadlock fix, z-order
  re-raise, foreground-window monitor, DPI-correct sizing, fade-before-hide,
  listen-before-fetch; `91c6f05` pill at key-down and visible start failures;
  `e921de6` redesigned pill (language badge, elapsed, destination glyph,
  phases, word count, amber/red errors, 400 px window); `4bada78` short
  focus-lost label and label-width audit; `e9073c6` live level meter;
  `4e7121f` dB curve for the meter; closeout commit trims the Prompt 0
  instrumentation to one info line per show and per hide, updates CLAUDE.md,
  README.md and docs/debug.md, and records the re-run of the test matrix.
- User-visible: the pill appears the moment the hotkey is pressed; every
  failure before recording is an amber or red pill plus a notification; a
  press during transcription says "Still transcribing — wait"; recording shows
  a five-bar level meter, EN/ع badge, elapsed time, type/clipboard glyph and a
  2 s stop hint; transcribing shows loading-model → "Transcribing N s…" →
  formatting; completed shows the word count; errors stay 5 s; states
  cross-fade and the pill fades before hiding; `prefers-reduced-motion`
  disables the motion.

Findings worth keeping (they explain code that would otherwise look odd):

1. **2.7 — window creation inside a synchronous command deadlocks the app on
   Windows.** `set_dictation_indicator_enabled`, `show_dictation_indicator`
   and `hide_dictation_indicator` were sync `#[tauri::command]`s; the first
   two could call `WebviewWindowBuilder::build()`. tauri 2.10.3 documents this
   ("On Windows, this function deadlocks when used in a synchronous command …
   use async commands"). Reproduced twice on 2026-09-04: turning the indicator
   off and on again in Settings froze v1.4.0/v1.4.1 (every IPC call hung until
   the process was killed; the store key was already written, so a restart
   came back with the indicator enabled). All three commands are `async fn`
   now; verified by hand — four off/on toggles returned in 13–83 ms and the
   pill returned.
2. **tao z-order.** tao 0.34.6 `set_visible(true)` only calls `ShowWindow` and
   its style refresh passes `SWP_NOZORDER`, so a re-shown topmost window is
   not raised; `set_always_on_top(true)` is a no-op when the flag is already
   set (tao diffs the flag). Any topmost window raised after the pill's last
   raise covered it (reproduced with a TopMost stand-in; the z-order log named
   it directly above the pill). Fix: `SetWindowPos(HWND_TOPMOST, … SWP_NOMOVE |
   SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW)` after every `show()`.
   Exclusive-fullscreen games still hide every topmost window — documented as a
   known limitation in docs/debug.md.
3. **Timer throttling in the hidden main webview — refuted.** Hypothesis: the
   hide timers and the live-dictation interval run in the main window, which
   sits hidden in the tray, and Chromium throttles hidden pages. Measured
   2026-09-04 with the window closed to tray: `document.visibilityState`
   stayed "visible", no `visibilitychange` fired, a 1500 ms timer took
   1506.6 ms, and 272 chained 1500 ms timers over 411 s ranged 1500–1516 ms.
   tao hides the HWND but nothing calls WebView2 `SetIsVisible(false)`, so the
   page never learns it is hidden. The JS timers stay; the Rust-owned
   auto-hide drafted in Prompt 1 was dropped.
4. Also measured: `get_audio_devices` costs 5–9 ms, so the pill-at-key-down
   change is about the WASAPI stream start, not enumeration.

Test matrix status at closeout (docs/dictation-indicator-tests.md): owner
microphone run 2026-09-05 after Prompts 1–4 — English and Arabic dictation,
hint, badge, colours and meter all correct. Rows b, f, g not run; d not
testable on one monitor; c, h, i verified through the same commands the UI
calls. The gate for v1.5.0 is the full six criteria, unchanged.

## Shipped in v1.4.1 (2026-08-25)

**Verification record (partial gate — owner ruling, 2026-08-25): shipped
with 2 of 6 criteria run, WORSE than the v1.3.0/v1.4.0 3-of-6 split, because
the owner's live EN + AR functional pass has not been run against this build.**
Published 2026-08-25: tag `v1.4.1` pushed, GitHub Release cut, installer
attached (asset `Vibe.Dictation_1.4.1_x64-setup.exe`, hash re-verified by
downloading the published asset back). Criterion **3** (netstat sampler during
live dictation) was run and passed post-release on 2026-09-04 (see below),
bringing the build to 3 of 6. Three criteria remain unrun against this build:
**4** firewall-block test, **5** functional EN + AR dictation into MS Word,
**6** live-dictation functional check — all three need the owner (a dictating
voice for 5 and 6; 4 no longer needs an elevated shell, see item 4). The
release notes went out without a verification statement; amended 2026-09-03 to
carry the same partial-gate disclosure as the v1.3.0 and v1.4.0 notes.

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
3. **Netstat sampler during live dictation — PASSED 2026-09-04** (Machine A,
   installed `vibe.exe` hash re-checked before the run and equal to the
   `37186b76…` recorded below). Sampled 16:30:17–16:33:17 UTC: 175 `netstat -ano`
   samples at ~1 s, all TCP/UDP states including TIME_WAIT, rows kept for the
   `vibe.exe`/`sona.exe`/`ollama.exe` PIDs plus PID-0 TIME_WAIT rows on their
   ports. The app log shows six hotkey dictation sessions (24–29) completed
   inside the window — each recorded, transcribed by sona and passed through
   the Ollama formatting pass (`qwen3.5:9b`, LLM formatting on) — plus session
   30 recording from 16:32:54 (its transcription at 16:33:24 fell just after
   the window closed), so the sample covers the in-dictation socket surface,
   not an idle app. Result: 28 distinct
   rows, **zero non-loopback**. `sona.exe` LISTENING on `127.0.0.1:59645` in
   all 175 samples (never `0.0.0.0`); the `vibe.exe`↔`sona.exe` loopback pair
   (`62913`↔`59645`) ESTABLISHED in 172 of 175 samples (absent only in the
   first three, before session 24's transcription began); `vibe.exe`→`127.0.0.1:11434`
   ESTABLISHED for one to three consecutive samples per session and its
   TIME_WAIT trace (PID 0, as documented in the criterion) visible for ~2 min
   afterwards — the v1.1.0 finding reproduced. The remaining rows are Ollama's
   own loopback connection to its runner subprocess (`127.0.0.1:50956`), not
   the app's. No model download was in progress. Two things the sample cannot
   show: the app log carries no per-session language, so the EN/AR split of the
   seven sessions is not recorded; and no live-dictation snapshot ran (live
   dictation was off). One incidental observation: session 29's Ollama output
   diverged from the transcript (131 chars in, 1246 out) and the divergence
   check fell back to the raw transcript as designed.
   **Corroboration:** a second, independent sampler of the same design ran in
   parallel on the same machine in two windows, 16:26:03–16:31:03 UTC (292
   samples, 15 distinct rows, sessions 24–26 completed inside) and
   16:31:27–16:34:27 UTC (175 samples, 27 distinct rows, sessions 28–30
   completed inside), both **zero non-loopback**, same sona listener and
   `62913`↔`59645` pair, same `vibe.exe`→`11434` ESTABLISHED/TIME_WAIT pattern.
   Across all three windows: 642 samples, ~2.6 min of dictation-active
   sampling, zero non-loopback rows. Raw sample logs and summaries were kept
   only in session scratch space, as for every earlier release record.

Not passed (carried debt, now against v1.4.1):

4. **Firewall-block test — NOT RUN (no longer BLOCKED as of 2026-09-04).** The
   2026-08-25 finding was that no outbound-block rules existed for the
   installed `vibe.exe`/`sona.exe`. **Both rules were created by the owner on
   Machine A on 2026-09-03** (owner statement 2026-09-04; corroborated on A by
   the firewall event log — two "rule has been added" events, id 2097, at
   2026-09-03 20:45:29 UTC, modifying user the owner's account SID, via the
   WMI provider that `New-NetFirewallRule` uses — and by the two
   `New-NetFirewallRule` commands from `docs/deployment.md` in the owner's
   interactive PowerShell history), in an elevated shell:
   `Vibe Dictation - block outbound` (program
   `%LOCALAPPDATA%\Vibe Dictation\vibe.exe`) and
   `Vibe Dictation Sona - block outbound` (program `…\sona.exe`), both
   Outbound, Block, profile Any, enabled. The seven dictation sessions of the
   criterion-3 sample above ran with those rules enabled, which is the
   "dictation still works under the block" half of the criterion; the other
   half — a model download attempted under the block fails cleanly (error
   dialog, `.part` removed, dictation unaffected) — has not been attempted.
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
- **Installer egress audit and ruling (2026-09-03; fixed on main in
  `1f64e26` — the published v1.4.1 installer still has both paths; the fix
  first ships in the next release).** Read-only audit of the NSIS installer
  (Tauri CLI 2.10.0 template plus `windows/hooks.nsh`) found four network
  paths: (1) the inherited vc_redist section's `NSISdl::download` of
  `https://aka.ms/vs/17/release/vc_redist.x64.exe` (25,635,768 bytes, 301 to
  `download.visualstudio.microsoft.com`) when the
  `HKLM\SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64`
  key is absent, followed by `ExecWait … /install /passive` (needs
  elevation); (2) on failure, `ExecShell "open"` of the same URL in the
  browser; (3) the template's WebView2 section — `webviewInstallMode` was
  unset, and the CLI's default is `downloadBootstrapper`, so a missing
  WebView2 `pv` key triggered `NSISdl::download` of
  `https://go.microsoft.com/fwlink/p/?LinkId=2124703` (1,783,000-byte
  bootstrapper, which then fetches the runtime itself) — dormant on Windows
  11, which ships WebView2 in-box, but silent and undocumented; (4) the
  template's Chromium-updater `ExecWait`, only when `minimumWebview2Version`
  is set (it is not). The hooks file is included at line 29 of the template,
  so its unnamed section ran first, before Tauri's own checks. Import-table
  analysis of the installed binaries: `sona.exe` hard-imports `MSVCP140`,
  `MSVCP140_1`, `VCRUNTIME140`, `VCRUNTIME140_1`, `VCOMP140` (and
  delay-loads `vulkan-1`); `vibe.exe` and `ffmpeg.exe` import only Universal
  CRT api-sets, so the runtime is needed by Sona alone. **NSISdl HTTPS
  finding:** the NSIS wiki states NSISdl cannot download over HTTPS and both
  URLs redirect from plain HTTP to HTTPS, which would have meant the
  download path never worked; a probe installer compiled with Tauri's cached
  makensis and run on 2026-09-03 returned `success` for both URLs, so the
  path was functional — it had simply never been exercised by a release
  test. Options costed: keep the download and widen the scope statement;
  bundle `vc_redist.x64.exe` (+25.6 MB, +58 %); bundle the five DLLs
  app-local (+961,168 bytes raw, no elevation, no system change); or drop
  the hook and stop with a message. **Ruling: app-local DLLs plus
  `webviewInstallMode` = `skip`** (implemented in `1f64e26`; pins and
  licence citation under Build). Verification build from that commit:
  installer `Vibe Dictation_1.4.1_x64-setup.exe` 44,405,731 bytes
  (`5f75dd9a…`; +263,503 bytes over the published v1.4.1), raw
  `target/release/vibe.exe` `01f3814d…`. Installed `/S` → exit 0; the five
  DLLs landed beside `sona.exe` with hashes matching the pins; the
  generated `installer.nsi` compiled with `INSTALLWEBVIEW2MODE ""` and a
  `/V4` recompile packed the five DLLs and both sidecars with no `NSISdl`
  command; the installed `sona.exe`, spawned exactly as the app spawns it,
  loaded all five DLLs from the install directory (not `System32`), loaded
  `ggml-large-v3-turbo.bin` in 1.1 s and transcribed a Windows-TTS clip
  correctly ("Testing the bundled runtime 1, 2, 3", 0.4 s); the installed
  app itself then spawned Sona on loopback only (`127.0.0.1` LISTEN plus
  the established pair) with the same app-local DLLs. Not run: the owner's
  hotkey dictation (criteria 5 and 6 stand as before). Published bytes then
  restored: the archived v1.4.1 installer (`a86b6bba…`) reinstalled `/S`,
  installed `vibe.exe` `37186b76…`, `sona.exe` `96c7ba10…`, `ffmpeg.exe`
  `1326dde4…`; the hook-less v1.4.1 installer left the five DLLs in place,
  so they were removed by hand to match the published layout. `cargo clean`
  run afterwards. A verification build, not a release: nothing archived.
- **The `v1.4.1` tag stays where it is (owner ruling, 2026-09-03).** The tag
  points at `4f5ab3d`, whose copy of this file claims a 4-of-6 gate; the
  correction to 2 of 6 landed one commit later in `fb44c6c`, and the
  publication record and everything since live on `main`. The tagged tree is
  the one the published artifact was built from, which is what the hashes
  need. Anyone reading the record at the tag is reading an overstated gate;
  `main` carries the correction. Not retagged.
- **Still in the published v1.4.1 installer until v1.4.2 ships:** both
  installer network paths (vc_redist download from `aka.ms`, WebView2
  bootstrapper download when WebView2 is absent) and the sona-lock upgrade
  defect. All three are fixed on `main` (`6a980de`, `1f64e26`).

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

*Artifact unrecoverable (recorded 2026-09-03): no git tag (the 2026-07-28
history squash predates tagging), no GitHub Release asset, no hash ever
recorded, no archive copy on machine A. The entries below are the only
trace. Same for v1.1.0 and v1.1.1.*

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

*Artifact unrecoverable — no tag, no asset, no hash (see the v1.0.1 note).*

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

*Artifact unrecoverable — no tag, no asset, no hash (see the v1.0.1 note).*

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
- **Locale trim re-verification — CLOSED 2026-09-03.** Phase B trimmed bundled
  locales to en + ar; the open question was whether paraglide output stays
  consistent after locale-related dependency updates. Checked against the
  current lockfile (`@inlang/paraglide-js` 2.21.0) on machine A at `ae18541`:
  `uv run scripts/check_i18n.py` → "i18n audit passed"; `pnpm i18n:generate`
  compiled the inlang project cleanly; `tsc --noEmit` clean; 43/43 vitest.
  The language picker no longer exists (removed in v1.2.0), so that half of
  the check is moot. Re-run the three commands whenever `paraglide-js` or
  the `i18n/` sources change; nothing is carried to the next release.
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
