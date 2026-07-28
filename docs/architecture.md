# Vibe Architecture

## Overview

Vibe Dictation is a Windows-only, zero-egress **dictation** fork of Vibe, built
with **Tauri** (Rust backend + React/TypeScript frontend).

## Components

### Desktop App (`desktop/`)

- **Frontend**: TypeScript + React (UI)
- **Backend**: Rust/Tauri (`desktop/src-tauri/`)
- Owns UI, settings, the global hotkey, mic capture, and text injection (typed
  keystrokes / clipboard) — no analytics, updater, or download code (all removed
  in the lockdown fork)
- Spawns and communicates with the Sona runner via local HTTP on `127.0.0.1`
- Optionally talks to a **user-run local Ollama server** on `127.0.0.1` for the
  LLM-formatting pass (Settings → Dictation). The host is a compile-time
  constant in `desktop/src-tauri/src/ollama.rs`; only the port is configurable.
  Ollama is never spawned, bundled, or downloaded by this app.

### Sona Runner

- **Language**: Rust + whisper.cpp bindings
- **Location**: Separate repository at `github.com/thewh1teagle/sona`
- **Purpose**: single local runner process for audio transcription and model
  loading (this fork uses transcription only — diarization/streaming UI is removed)
- Bundled as one `sona` binary sidecar with the desktop app
- **Build**: separate CI/CD in the Sona repository
- **Distribution**: the pinned prebuilt Sona binary is fetched by
  `scripts/pre_build.py` (content-pinned via `.sona-version` + a SHA-256 check);
  this fork has no CI of its own

### FFmpeg Helper

- The Windows build bundles `ffmpeg` from the Sona release archive
- The app passes its path to Sona via `SONA_FFMPEG_PATH`

### Build Flow

1. Run `scripts/pre_build.py` manually (this fork has no CI)
2. It fetches the pinned prebuilt Sona + ffmpeg binaries from Sona releases and
   verifies the archive SHA-256 against the pin
3. Binaries are placed in `desktop/src-tauri/binaries/`
4. `tauri build` bundles `sona` and `ffmpeg` into the final NSIS installer

## Where transcription bugs actually live

Native runtime compatibility issues for transcription usually come from the Sona runner or its linked whisper/ggml libraries, not the Vibe UI code.

To fix Sona runtime compatibility issues, update **Sona's** build configuration in the Sona repository, then bump `.sona-version` in Vibe.
