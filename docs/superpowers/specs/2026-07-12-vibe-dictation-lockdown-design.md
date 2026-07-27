# Vibe Dictation — Local-Only Lockdown Build

**Date:** 2026-07-12
**Author:** Nasser Al-Husayan (with Claude)
**Status:** Draft for review

## 1. Overview

Transform the upstream **Vibe** transcription app into a stripped-down, fully
local, GPU-accelerated **dictation-only** tool. The app should let the user press
a global hotkey, speak, and have the recognized text typed (or pasted) into
whatever application is focused — the same interaction model as Wispr Flow, but
with **zero network egress** and running on the local GPU.

This is a **lockdown fork**, not a rewrite: the Vibe codebase is kept intact, but
every non-dictation feature and every network-capable component is **removed at
compile time** so it is not present in the shipped binary.

## 2. Goals

- **Dictation only.** Global hotkey → mic → local speech-to-text → type/paste into
  the focused app. Push-to-talk and toggle modes, "type" and "clipboard" output
  modes, and the on-screen dictation indicator are all retained.
- **Zero network at runtime.** The only socket the running app may open is to
  `127.0.0.1` (the local Sona engine). This is enforced by **removing** the
  network-capable code, not by disabling it — so it is auditable via a firewall,
  `netstat`, or `strings`.
- **GPU accelerated.** Runs on the discrete GPU via Vulkan on Windows. Target
  hardware (both Windows, both 24 GB VRAM, identical build + Vulkan path):
  - **Home PC (primary):** RTX 4090 24 GB, i9-14900K, 96 GB RAM.
  - **Work PC:** RX 7900 XTX 24 GB (RDNA3), Ryzen 9 7950X3D, 64 GB RAM.
  Vulkan covers both NVIDIA and AMD, so there is no CUDA-specific path.
- **English + Arabic dictation.** Default model is Whisper large-v3-turbo (best
  bilingual coverage, fast on the 4090).
- **Own identity.** Renamed under the `net.nasserhub` namespace so it installs and
  stores settings side-by-side with any official Vibe, without collision.

## 3. Non-Goals

- File/batch transcription, subtitle export (SRT/VTT/DOCX/PDF/etc.), diarization
  UI, printing, YouTube/media-URL download, transcript summarization (Claude API /
  Ollama), analytics, and auto-update are all **out of scope and removed**.
- No mobile, no CLI transcription surface beyond what dictation needs.
- The AMD/second machine is the same OS (Windows) and same build; no separate
  Linux/GPU port is in scope. (Noted as a trivial "build it there too" step, not
  new engineering.)

## 4. Architecture

Unchanged core: **Tauri 2** shell (Rust backend in `desktop/src-tauri`, React/TS
frontend in `desktop/src`) that spawns the **Sona** runner (whisper.cpp, Vulkan)
as a bundled sidecar and talks to it over local HTTP on `127.0.0.1`.

### 4.1 Dictation data flow (retained)

1. `tauri-plugin-global-shortcut` fires on the configured hotkey
   (`desktop/src/providers/hotkey.tsx`).
2. Mic capture starts (`cmd::audio::start_record`), writing a temp WAV.
3. Audio is sent to the local Sona engine (`sona::transcribe_stream`,
   `http://127.0.0.1:<port>`).
4. Recognized text is emitted; the frontend routes it to output:
   - **type** → `cmd::app::type_text` (enigo keystroke injection), or
   - **clipboard** → clipboard manager + paste.
5. The floating **dictation indicator** window
   (`desktop/src-tauri/src/dictation_indicator.rs`) shows status.

### 4.2 Components removed (compile-out)

| Area | Files / hooks | Action |
|---|---|---|
| Analytics | `analytics.rs`, `tauri-plugin-aptabase` dep, call sites in `main.rs`, `cli.rs`, `cmd/sona_cmd.rs`, `cmd/app.rs::track_analytics_event` | Delete module + dep + calls |
| Auto-updater | `tauri-plugin-updater` plugin (`main.rs`), `updater` block + `createUpdaterArtifacts` in `tauri.conf.json`, `cleaner::clean_updater_files` | Delete plugin + config |
| Model download | `cmd/download.rs` (`download_file`, `download_model`), handlers in `main.rs`, `tauri-plugin-deep-link` `vibe://download` usage | Delete; models placed manually |
| YouTube / yt-dlp | `cmd/ytdlp.rs` + 3 handlers | Delete |
| Summarize | frontend `pages/settings/sections/summarize.tsx` + related UI/providers; audit `tauri-plugin-http` (`unsafe-headers`) and drop dep if now unused | Delete UI + http egress |
| Online check | `cmd/app.rs::is_online` / internet probe | Delete |
| Bug report link | `diagnostics.rs` GitHub issue URL / report button | Remove report UI |
| Deep link | `tauri-plugin-deep-link` (`vibe://` scheme, used for `vibe://download`) | Remove the dep entirely once `vibe://download` is gone, if nothing else uses the scheme (confirm during implementation) |

### 4.3 Components kept

`global-shortcut`, `clipboard-manager`, `notification`, `fs`, `os`, `dialog`,
`store`, `process`, `single-instance`, `window-state`, `opener`; the
`dictation_indicator` module; `cmd::app::type_text`; `cmd::audio::*`;
`cmd::sona_cmd::{load_model, get_gpu_devices, get_model_metadata,
get_api_base_url, start_api_server, stop_api_server}`; and the Sona
localhost client (`sona/process.rs`, already `.no_proxy()`).

## 5. UI Lockdown

- App boots directly into a **minimal dictation panel**: current status + the
  Dictation settings (hotkey, activation mode, output mode, normalize, indicator
  toggle), model selection (pointing at the local Whisper model), GPU device, and
  mic device.
- Remove from navigation/routes: transcription home, batch, export formats,
  diarization, print, YouTube, summarize, and any model-store/download UI.
- Confirm the app can **minimize to tray** and keep the hotkey armed in the
  background; add a tray presence if not already present (dictation is a
  background tool — a persistent window should not be required).
- **Autostart at login** via `tauri-plugin-autostart` (local, no egress), so the
  hotkey is armed after boot without opening a window.
- **Arabic RTL fallback:** *clipboard* output mode is the documented fallback if
  `enigo` synthetic keystrokes mangle Arabic RTL character ordering in some target
  apps.

## 6. Model & GPU

- **Model (empirical default).** The default is chosen by measurement, not
  declared up front. Bring-up includes an **A/B of Whisper large-v3-turbo vs
  large-v3 on the user's own Arabic speech** (latency and accuracy), and the default
  is set from those results. Both stay selectable. Whichever wins is obtained
  **once, manually**, and placed in the app's models folder — the running app
  performs no download. The streaming dictation models (Parakeet TDT v3 / Nemotron)
  also remain selectable for English-only low-latency use but are not the default.
- **GPU:** Sona's Vulkan sidecar is fetched by `scripts/pre_build.py`
  (`sona-windows-amd64-with-ffmpeg.zip`, pinned by `.sona-version` = v0.3.4).
  Vulkan covers both NVIDIA and AMD. On each machine there is a single discrete
  GPU, so default device selection suffices; `get_gpu_devices` remains available.
  With 24 GB VRAM on both machines the model choice is unconstrained (large-v3
  would also fit if maximum Arabic accuracy is ever preferred over latency).
- **Hang diagnosis (target: home PC / RTX 4090).** The developer's prebuilt binary
  hung on the home PC (RTX 4090), so the trace-log diagnosis starts there. With
  NVIDIA's Vulkan stack the GPU itself is rarely the fault; the prime suspects are a
  missing Vulkan runtime (`vulkan-1.dll`) / `vc_redist`, or a first-load stall on
  the large model. Bring-up: run with `RUST_LOG=vibe=debug,whisper_rs=debug` and
  confirm the trace shows a Vulkan device bound and the model loading past first
  load. If it stalls: install VulkanRT / vc_redist (per `docs/debug.md`); note that
  large-v3-**turbo** is lighter than large-v3, and a smaller/quantized model is the
  fallback.

## 7. Identity / Rename

- Tauri identifier: `github.com.thewh1teagle.vibe` → `net.nasserhub.dictation`.
- Product name: `vibe` → `Vibe Dictation` (working name; adjustable).
- Consequence: the app-data/settings/models folder path changes with the
  identifier, so this build is fully isolated from any official Vibe install.
  Deep-link scheme `vibe://` is removed with the download feature.

## 8. Build & Packaging

- Prereqs already present: Rust 1.92 (MSVC), Node 24, uv, Python, MSVC C++ toolset
  14.44 + Windows SDK 10.0.26100. **Missing:** `pnpm` (install via
  `npm i -g pnpm@10.4.1` or corepack).
- **Build from a "Developer PowerShell for VS 2022" shell** so the MSVC `link.exe`
  takes precedence over `C:\Program Files\coreutils\bin\link.exe` on PATH.
- Flow: `uv run scripts/pre_build.py` (fetch Vulkan Sona + ffmpeg sidecars) →
  `cd desktop && pnpm install` → `pnpm exec tauri dev` (iterate) /
  `pnpm exec tauri build` (NSIS installer for both machines).
- **Content-pin the sidecar:** record the **SHA-256** of the fetched Sona zip so the
  bundled engine is auditable by content, not just by version tag (`.sona-version`).
  Verify the hash on each fetch.

## 9. Success Criteria / Verification

1. Press the hotkey, speak **English** → correct text typed into Notepad.
2. Press the hotkey, speak **Arabic** → correct Arabic text typed.
3. Logs confirm the **discrete GPU** is in use (Vulkan device bound).
4. **Network audit (outbound + inbound):** with a firewall rule / `netstat`
   monitored during a full dictation session, the app opens **no external
   connections** — only `127.0.0.1` to Sona. Additionally verify the Sona sidecar
   **listens on `127.0.0.1` only, never `0.0.0.0`** (confirm the listening address
   with `netstat`), so the local engine is not reachable from the network.
5. `strings` / dependency check confirms aptabase/updater/ytdlp code is absent
   from the binary.
6. App runs as a background/tray tool with the hotkey armed; no transcription UI
   reachable.
7. **Latency:** in *type* mode, recognized text appears within **~2 seconds** of
   end of speech for a normal-length sentence.

## 10. Risks & Open Items

> **Correction (2026-07-14):** The clearance premise below was written on a false assumption. The AMD workstation (RX 7900 XTX) is a personal endpoint on a home network — no clearance gate applies.

- **The hang** is the main unknown; mitigated by the trace-log diagnosis step
  (§6) before declaring success. It lives in the Sona/Vulkan layer, so a
  worst-case fix is rebuilding Sona from source (separate repo,
  `github.com/thewh1teagle/sona`) — out of scope unless the prebuilt binary
  cannot be made stable.
- **`tauri-plugin-http` removal** depends on nothing else using it after
  summarize is gone; to be confirmed during implementation (frontend audit).
- **Deliberate upstream drift.** Deleting the network modules (analytics, updater,
  download, ytdlp, summarize) is **hard-fork behavior in those areas**, chosen on
  purpose so zero-egress is auditable via `strings`/`netstat` rather than trusted
  from a config flag; the accepted cost is that future upstream merges touching
  those areas are manual.
- **Second-machine (RX 7900 XTX) deployment is out of scope** until the home
  build is stable. Note: a self-built, unsigned installer plus synthetic
  keystroke injection (`enigo`) may trip endpoint-protection software.
- **Git:** initialized locally on `main` with this spec committed before
  implementation; the private Git server remote is added later by the user.
