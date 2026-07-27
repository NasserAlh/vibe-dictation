# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Vibe Dictation** is a privacy-locked, dictation-only, **Windows-only** hard fork of
[Vibe](https://github.com/thewh1teagle/vibe). Press a global hotkey, speak English or
Arabic, and the recognized text is typed at the cursor or copied to the clipboard.
Everything runs on-device.

The defining constraint is **zero network egress, enforced at compile time**. Every
network-capable component of upstream (analytics, auto-updater, model download,
deep-link, YouTube/yt-dlp, LLM summarization, HTTP plugin) has been *deleted*, not
disabled — so the guarantee is auditable via `strings`/`netstat`/firewall rather than
trusted from a config flag. The only sockets the running app opens are loopback: to the
local Sona speech engine, and — only when the opt-in LLM-formatting setting is enabled —
to a user-run local Ollama server ([desktop/src-tauri/src/ollama.rs](desktop/src-tauri/src/ollama.rs);
host is a compile-time `127.0.0.1` constant, only the port is configurable).
When touching Rust deps, the frontend, or Tauri plugins, do
not reintroduce anything that can open an external connection — any dependency change
requires the full re-verification pass in [RELEASING.md](RELEASING.md). Design rationale
and the removed-component inventory:
[docs/superpowers/specs/2026-07-12-vibe-dictation-lockdown-design.md](docs/superpowers/specs/2026-07-12-vibe-dictation-lockdown-design.md).

## Architecture

Three processes:

1. **Tauri shell** — Rust backend in [desktop/src-tauri/](desktop/src-tauri/), React/TS
   frontend in [desktop/src/](desktop/src/). Owns UI, settings, mic capture, hotkey, and
   text injection.
2. **Sona runner** — the transcription engine (whisper.cpp + Vulkan), bundled as a
   `sona` binary **sidecar**. It is a *separate repo* (`github.com/thewh1teagle/sona`);
   this repo consumes a prebuilt binary. The shell spawns it with `serve --port 0`, reads
   a JSON ready-signal line from its stdout to learn the chosen port, and talks to it over
   `http://127.0.0.1:<port>` ([desktop/src-tauri/src/sona/](desktop/src-tauri/src/sona/)).
3. **ffmpeg** — bundled alongside Sona; its path is passed via `SONA_FFMPEG_PATH`.

**Native transcription/GPU runtime issues almost always live in Sona, not this repo.**
To fix them, change Sona's build in its own repo, then bump [.sona-version](.sona-version)
here. Do not chase them in the UI code.

### Dictation data flow

The core loop lives in [desktop/src/providers/hotkey.tsx](desktop/src/providers/hotkey.tsx):

1. `tauri-plugin-global-shortcut` fires → `handleHotkeyDown` starts mic capture
   (`start_record` Tauri command) writing a temp WAV. Push-to-talk (hold) and toggle
   (press/press) activation modes both route through here. There are **two
   per-language shortcuts** (EN and AR): the hotkey that starts a recording forces
   that dictation's transcription language — dictation never uses Whisper
   auto-detection (it covert-translates this speaker's English to Arabic;
   verification report §11) — and only the starting hotkey can stop the recording.
2. Key release / second press → `stop_record` event → backend emits `record_finish`.
3. Frontend calls `load_model` then `transcribe` (Rust → Sona multipart streaming upload
   in [sona/mod.rs](desktop/src-tauri/src/sona/mod.rs) `transcribe_stream`).
4. Optional: if LLM formatting is enabled (Settings → Dictation), the transcript is sent
   to a user-run local Ollama server (`ollama_format_text` →
   [ollama.rs](desktop/src-tauri/src/ollama.rs), loopback-only, model chosen from
   Ollama's `/api/tags`). Any failure falls back to the raw transcript — dictation is
   never lost to a dead Ollama. The transcript travels wrapped in `<transcript>` tags
   with a compile-time guard epilogue, and a deterministic divergence check falls back
   to the raw transcript when the model *answers* a command-shaped dictation instead
   of rewriting it (prompt injection by dictation).
5. Result is routed by output mode: **type** → `type_text` command (enigo synthetic
   keystrokes), or **clipboard** → clipboard manager. Clipboard is the RTL-safe fallback
   for Arabic; enigo mangles RTL ordering in some targets. MS Word is the reference
   injection target — the Windows 11 tabbed Notepad mangles synthetic keystrokes.
6. The floating [dictation_indicator](desktop/src-tauri/src/dictation_indicator.rs) window
   (a second Tauri window) shows recording/transcribing/completed/error status.

### Rust backend layout

- [main.rs](desktop/src-tauri/src/main.rs) — Tauri builder, plugin registration, the full
  `invoke_handler!` command list, and Sona-process teardown on exit.
- [cmd/](desktop/src-tauri/src/cmd/) — all `#[tauri::command]` handlers, grouped by area
  (`app`, `audio`, `files`, `ollama_cmd`, `permissions`, `sona_cmd`, `transcribe`, `ui`).
  This is the Rust↔frontend API surface.
- [sona/](desktop/src-tauri/src/sona/) — sidecar lifecycle (`process.rs`), HTTP client and
  event stream (`mod.rs`), GPU device enumeration (`devices.rs`), tests (`tests.rs`).
- [ollama.rs](desktop/src-tauri/src/ollama.rs) — loopback-only client for the optional
  LLM-formatting pass (`/api/tags` model list, `/api/chat` formatting). Ollama is
  user-run, never spawned or bundled by this app. Ollama **cloud models** (entries with
  `remote_host`, which forward requests to ollama.com) are filtered from the model list
  AND re-checked at format time — they would send dictations off-device.
- [setup.rs](desktop/src-tauri/src/setup.rs) holds `SonaState` (the managed process
  handle); [config.rs](desktop/src-tauri/src/config.rs) has store filename / log constants.

### Autostart quirk (read before touching main.rs setup)

Autostart syncs to the stored preference on every launch, but **only in release builds**
(`if !cfg!(debug_assertions)`). A dev build must never write the login Run entry — dev and
release share the same store identifier, so a dev instance would point login-autostart at
a transient `target\debug` exe. See the comment at
[main.rs:44-77](desktop/src-tauri/src/main.rs#L44-L77) and the incident note in the
verification report.

## Common commands

All `cargo`/`tauri` commands **must run from a shell with the MSVC environment loaded**
(`VsDevCmd.bat -arch=x64` / `Enter-VsDevShell` / "Developer PowerShell for VS 2022") — this
also ensures MSVC `link.exe` beats any `link.exe` shadowing it on PATH.

```console
# One-time / after .sona-version bump — fetch pinned Sona + ffmpeg Vulkan sidecars
uv run scripts/pre_build.py          # add --dev or --build to chain the tauri step

# From desktop/
pnpm install
pnpm i18n:generate                   # REQUIRED before bare tsc/eslint (see i18n below)
pnpm exec tauri dev                  # develop (runs i18n:generate automatically)
pnpm exec tauri build                # NSIS installer
```

### Test and lint

```console
cargo test -- --nocapture            # Rust (RUST_LOG=trace for detail); from desktop/src-tauri
cargo fmt && cargo clippy            # Rust format + lint
pnpm test                            # frontend (vitest); from desktop/
pnpm test -- <file-or-name>          # single frontend test
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint .
uv run scripts/check_i18n.py         # locale key parity; from repo ROOT
```

### i18n (paraglide) — the sharp edge

Frontend i18n uses `@inlang/paraglide-js`. Generated output lands in `desktop/src/paraglide/`
and is **gitignored**. `tauri dev`/`build` regenerate it, but **bare `tsc`/`eslint`/`vitest`
will fail on missing imports unless you run `pnpm i18n:generate` first**. Source strings live
in [i18n/](i18n/) and `desktop/project.inlang/`. Run `scripts/check_i18n.py` to check key
parity across locales.

## Build & runtime conventions

- **Sidecar is content-pinned.** [.sona-version](.sona-version) picks the tag; the SHA-256
  is verified against `docs/superpowers/notes/sona-sidecar-sha256.txt` on every fetch. The
  bundled engine is auditable by content, not just tag.
- **Models are placed manually** — the app performs *no downloads*. Drop a Whisper
  `ggml-*.bin` into the models folder (Settings → Select Model → Models Folder). Default is
  Whisper `large-v3` (chosen by A/B on real bilingual speech). See [docs/models.md](docs/models.md).
- **GPU:** Vulkan (covers both NVIDIA and AMD); no CUDA path.
- **Rust crate is still named `vibe`** ([Cargo.toml](desktop/src-tauri/Cargo.toml)) and the
  log directive is `vibe=DEBUG`; the Tauri identifier is `net.nasserhub.dictation`. Debug an
  install with `RUST_LOG=vibe=debug,whisper_rs=debug` (see [docs/debug.md](docs/debug.md)).
- **Releases** are unsigned NSIS installers for private use — **there is no CI**. Every
  release re-runs the full zero-egress verification by hand: [RELEASING.md](RELEASING.md).

## More docs

- [docs/architecture.md](docs/architecture.md) — component/build-flow detail
- [docs/building.md](docs/building.md) — full build, Sona-from-source escape hatch, dep updates
- [docs/deployment.md](docs/deployment.md) — putting a release on a new machine
- The zero-egress guarantee is re-verified by hand for every release (strings
  audit, loopback-only netstat, dictate-under-firewall-block) per [RELEASING.md](RELEASING.md).
