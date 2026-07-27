<p align="center">
  <img width="96" alt="Vibe Dictation logo" src="./design/logo.svg" />
</p>

<h1 align="center">Vibe Dictation</h1>

<p align="center"><strong>Local-only bilingual dictation. Your voice never leaves the machine.</strong></p>

A privacy-locked, dictation-only fork of [Vibe](https://github.com/thewh1teagle/vibe):
press a global hotkey anywhere, speak English or Arabic, and the recognized text is
typed at the cursor (or copied to the clipboard). Everything runs on-device.

## Properties

- **Zero network egress — OS-enforced.** Every network-capable component of the
  upstream app (analytics, auto-updater, model download, deep-link, YouTube/yt-dlp,
  LLM summarization, HTTP plugin) is removed at compile time; the only socket the
  running app opens is loopback to its local speech engine, and permanent Windows
  Firewall outbound-block rules sit on top. Every release is re-verified by hand:
  a strings audit of the shipped binary, loopback-only netstat sampling during
  live dictation, and a dictate-under-firewall-block test (see
  [RELEASING.md](RELEASING.md)).
- **Bilingual EN + Arabic** via per-language hotkeys — each dictation is
  transcribed in the language of the hotkey that started it, never auto-detected
  (Whisper `large-v3` by default, chosen by A/B on real speech).
- **GPU-accelerated** via Vulkan (NVIDIA and AMD; verified on RTX 4090 and
  RX 7900 XTX).
- **Background utility:** system tray, close-to-tray, autostart at login
  (preference-synced), hotkey armed by default, on-screen dictation indicator.
- **Windows-only.** Push-to-talk or toggle activation; type-at-cursor or clipboard
  output (clipboard is the RTL-safe fallback — MS Word is the reference injection
  target; the Windows 11 tabbed Notepad mangles synthetic keystrokes).

## Build

Prerequisites: Rust (MSVC toolchain), Node + `pnpm`, `uv`, VS 2022 Build Tools
(C++ workload). All build commands run from a shell with the MSVC environment
loaded (`VsDevCmd.bat -arch=x64` / `Enter-VsDevShell`).

```console
uv run scripts/pre_build.py      # fetch pinned Sona + ffmpeg Vulkan sidecars
cd desktop
pnpm install
pnpm i18n:generate               # generate paraglide i18n output (needed before bare tsc/eslint;
                                 # tauri dev/build run it automatically)
pnpm exec tauri dev              # develop
pnpm exec tauri build            # NSIS installer
```

Models are placed **manually** (the app performs no downloads): drop a Whisper
`ggml-*.bin` into the app's models folder (Settings → Select Model → Models
Folder). See [docs/models.md](docs/models.md) for sources.

Releases follow [RELEASING.md](RELEASING.md) — every artifact re-runs the full
zero-egress verification (strings audit, loopback netstat, firewall test) before
it ships anywhere.

Putting it on a new machine (audited-release deploy or full source build):
[docs/deployment.md](docs/deployment.md).

## Attribution

This is a fork of **[Vibe](https://github.com/thewh1teagle/vibe)** by
[@thewh1teagle](https://github.com/thewh1teagle), used and modified under the
[MIT License](LICENSE). The heavy lifting — the Tauri app foundation, the Sona
transcription engine (whisper.cpp), and the dictation UX — is upstream's work;
this fork strips it to a dictation-only, zero-egress core. Not affiliated with
or endorsed by upstream.
