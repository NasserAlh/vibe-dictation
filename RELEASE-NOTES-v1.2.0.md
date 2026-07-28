Local-only bilingual dictation for Windows. Press a hotkey, speak English or
Arabic, and the text is typed at your cursor. Nothing leaves the machine.

## Install

Download `Vibe Dictation_1.2.0_x64-setup.exe` and run it. It installs per-user to
`%LOCALAPPDATA%\Vibe Dictation\`.

**The installer is unsigned.** Windows SmartScreen will warn you — choose "More
info" then "Run anyway". Some antivirus software also flags the app, because
typing text at your cursor means sending synthetic keystrokes, which looks like
what a keylogger does in reverse. Both warnings are expected. Verify the download
against the hash below if you want to be sure of what you have.

## You also need a model

The app downloads nothing, ever. You supply the speech model yourself:

1. Get a Whisper `ggml-large-v3.bin` (see [docs/models.md](../blob/main/docs/models.md)).
2. Put it in the models folder — Settings → Select Model → Models Folder.
3. Select **Large V3** in Settings.

Roughly 3 GB. Smaller models work but were less accurate on bilingual speech.

## Requirements

- Windows 11 x64
- A Vulkan-capable GPU. Verified on RTX 4090 and RX 7900 XTX. There is no CPU
  fallback worth using.

## What's in this release

- **Per-language hotkeys.** Separate English and Arabic shortcuts. The hotkey you
  press decides the language — there is no auto-detection, which used to silently
  translate short English phrases into Arabic.
- **Prompt-injection guard** for the optional local formatting pass. If you
  dictate something shaped like an instruction, the formatter rewrites it instead
  of answering it.
- **English-only interface.** The display-language picker is gone.

## Verification

| Item | SHA-256 |
|---|---|
| `Vibe Dictation_1.2.0_x64-setup.exe` (44,172,357 bytes) | `4450B3E3E10324B0EC08A363D8DB4FBE54E9239E5B8371BC61A5BB47B96E9A2C` |
| installed `vibe.exe` | `4F09209914B3E0F50DB1D1FD7044E4A6C2CF47757F2E5CEDB729BACEA6B0D9EA` |

```powershell
(Get-FileHash '.\Vibe Dictation_1.2.0_x64-setup.exe' -Algorithm SHA256).Hash
```

This binary was built from source commit `9707a1c` and verified by hand before
release: binary strings audit for any network-capable code, a loopback-only
netstat sample taken during live dictation, and a dictate-under-firewall-block
test. The procedure is in [RELEASING.md](../blob/main/RELEASING.md).

Note that `9707a1c` is a commit in this project's pre-publication history, which
is not part of this repository — the public history starts at the initial publish
commit. The tag on this release marks the published tree, not the literal build
commit. Builds you make from this source will not be byte-identical to the
attached installer.

## Optional: local LLM formatting

If you run [Ollama](https://ollama.com) locally, the app can clean up punctuation
and capitalisation using a model on your own machine. It is off by default. Only
local models are offered — Ollama cloud models are filtered out and re-checked
before every request, because they would send your dictation off-device. If the
formatter fails for any reason, you get the raw transcript rather than nothing.

## Known issues

See [ROADMAP.md](../blob/main/ROADMAP.md). The short version: Arabic typed at the
cursor can come out in the wrong order in some applications — use clipboard output
mode for Arabic. The installed binary may also self-report an older commit hash
than it was built from.
