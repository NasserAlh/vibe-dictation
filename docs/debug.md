# Troubleshooting Vibe Dictation

Windows-only fork; everything runs on-device. There is **no in-app bug reporting**
(the report button and all network code were removed), so debugging is local:
the log file, the Windows Event Viewer, and running from a terminal with tracing
enabled.

## Run with logs

Close any running instance, then launch from `cmd.exe` with tracing on:

```console
taskkill /IM vibe.exe /F
taskkill /IM sona.exe /F
set RUST_BACKTRACE=1
set RUST_LOG=vibe=debug,whisper_rs=debug
"%LOCALAPPDATA%\Vibe Dictation\vibe.exe"
```

The log directive is `vibe=debug` (the Rust crate is still named `vibe`).
Reproduce the problem, then read the console output or the log file.

## Log file

```
%APPDATA%\net.nasserhub.dictation\log_YYYY-MM-DD.txt
```

The Tauri identifier is `net.nasserhub.dictation`, so the data / settings / log
folders live under that name — isolated from any upstream Vibe install.

## Common issues

### Crash with no visible error

Open **Event Viewer** → Windows Logs → Application and look for a matching error
around the crash time.

### `vulkan-1.dll` or `vcomp140.dll` is missing

- `vcomp140.dll` — install [vc_redist.x64.exe](https://aka.ms/vs/17/release/vc_redist.x64.exe)
- `vulkan-1.dll` — install the Vulkan runtime
  ([VulkanRT installer](https://sdk.lunarg.com/sdk/download/1.3.290.0/windows/VulkanRT-1.3.290.0-Installer.exe))

These are the usual fixes for a stall at Vulkan init or first model load.

### Nothing transcribes / model errors

- Confirm a model is present. The app performs **no downloads** — drop a Whisper
  `ggml-*.bin` into the models folder (Settings → Select Model → Models Folder).
  The default is `ggml-large-v3.bin`. See [models.md](models.md).
- Verify the model file against the pins in
  [superpowers/notes/model-sha256.txt](superpowers/notes/model-sha256.txt).
- Native transcription / GPU issues almost always live in the **Sona sidecar**,
  not this repo (see [architecture.md](architecture.md)). Run the engine directly
  to check GPU enumeration:
  ```console
  "%LOCALAPPDATA%\Vibe Dictation\sona.exe" devices
  ```
  Expect a JSON entry naming the discrete GPU (e.g.
  `{"description": "AMD Radeon RX 7900 XTX", "index": 0, "name": "Vulkan0", "type": "gpu"}`).

### Injected text is mangled

MS Word is the reference injection target. The Windows 11 tabbed Notepad mangles
synthetic keystrokes; for Arabic (RTL), switch to **clipboard** output mode
(Settings → Dictation) — the documented RTL-safe fallback.

### Autostart didn't launch at login

v1.0.1 writes a **quoted** HKCU Run entry and works natively; confirm it:

```console
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Vibe Dictation"
```

Expect `"...\Vibe Dictation\vibe.exe"` **with** the quotes. (v1.0.0 wrote it
unquoted and needed a manual stopgap — see the verification report §5c/§9.)
