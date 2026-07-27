# Deploying Vibe Dictation to a new machine

Two paths. **Path 1 (deploy the audited release)** is the simplest route for a
target that should stay offline during setup — the installer + models copy over by
USB and nothing is fetched on the machine. **Path 2 (full source build)** produces
new bytes, so they require the full [RELEASING.md](../RELEASING.md) verification —
the strings audit, loopback-only netstat, and dictate-under-firewall-block test —
before they replace an audited artifact. Both paths end at the same
[smoke protocol](#new-machine-smoke-protocol).

Written for generic Windows 11 x64; AMD-specific notes in the
[appendix](#appendix-amd-machines-rx-7900-xtx--ryzen-7950x3d).

---

## Path 1 — Deploy the audited release

> The change-record table below documents the artifact's identity — hashes, what it
> does and can't do. It is kept as good practice for any deployment record.

### Change record (artifact identity)

| Field | Value |
|---|---|
| Artifact | `Vibe Dictation_1.0.1_x64-setup.exe` (unsigned NSIS, per-user install; 44,167,947 bytes) |
| Installer SHA-256 | `4A0051C1ACC840038447CFEA5EF3DAA812C678E0DB88440CB3C4195D63A5922B` |
| Installed exe SHA-256 | `514B8EA46FDE12C3AC1A2DC14C72C7D93B2E725BC207E5CCDCD5A33157A6B223` (differs from the pre-NSIS built exe by the NSIS bundle-type stamp, per the verification report §9) |
| What it does | Local speech-to-text dictation (global hotkey → on-device Whisper via Vulkan GPU → text typed at cursor or copied to clipboard). Registers one HKCU Run entry (autostart) and a global hotkey. Injects synthetic keystrokes (may interest endpoint protection). |
| What it cannot do | **No network code is compiled in** — analytics, updater, downloads, and all HTTP client code are physically absent, verified per release by a binary strings audit and loopback-only netstat sampling during live dictation. The only socket is loopback to its own local engine process. OS-enforced outbound-block firewall rules are added on top (step 6). |
| Verification (re-runnable) | Steps 1, 5, 7, 8 below — hash check, GPU/device enumeration, firewall rules, netstat sampler + dictate-under-block. |

### Payload (USB-friendly — no network needed on the target)

From `C:\Users\nasser\Dev\releases\vibe-dictation\v1.0.1\` and the models folder:

1. `Vibe Dictation_1.0.1_x64-setup.exe` + `SHA256.txt`
2. `ggml-large-v3.bin` (default) and optionally `ggml-large-v3-turbo.bin`
3. `model-sha256.txt` (from `docs/superpowers/notes/`) — the model pins

The installer already bundles the Sona + ffmpeg sidecars — **no `pre_build.py`,
no downloads on the target.**

### Steps

1. **Verify the installer hash** against the pin:
   ```powershell
   (Get-FileHash '.\Vibe Dictation_1.0.1_x64-setup.exe' -Algorithm SHA256).Hash -eq (Get-Content .\SHA256.txt).Trim()
   ```
2. **Install** — run the installer (silent: `& '.\Vibe Dictation_1.0.1_x64-setup.exe' /S`).
   Installs to `%LOCALAPPDATA%\Vibe Dictation\` (vibe.exe + sona.exe + ffmpeg.exe).

   > ⚠ **Run the installer, first launch, and all verification from a
   > non-virtualized shell.** A shell inside an MSIX/AppContainer context
   > (e.g. the Claude desktop app's terminal) silently redirects file and HKCU
   > writes to the package's `LocalCache` overlay — producing a "ghost"
   > install that passes every check from inside the container but does not
   > exist on the real machine (verification report §5c correction).
   > Sanity check: a running process's image file must exist at its
   > `Get-Process` path.
3. **First launch** (Start menu → Vibe Dictation). This creates the data dirs and
   the autostart entry (preference-sync writes the HKCU Run entry to the
   installed exe path).
4. **Models:** verify the copied `.bin` hashes against `model-sha256.txt`, place
   them in `%LOCALAPPDATA%\net.nasserhub.dictation\` (or use Settings → Select
   Model → Change Models Folder), then select **Large V3** in Settings → Select
   Model. Leave GPU Device = Auto on single-GPU machines (see AMD appendix for
   dual-device machines).
5. **Verify GPU binding** via the engine's own device enumeration:
   ```powershell
   & "$env:LOCALAPPDATA\Vibe Dictation\sona.exe" devices
   ```
   Expect a JSON entry naming the discrete GPU (e.g.
   `{"description": "NVIDIA GeForce RTX 4090", "name": "Vulkan0", "type": "gpu"}` —
   the verification report §2 citation). App logs, if needed:
   `%APPDATA%\net.nasserhub.dictation\log_YYYY-MM-DD.txt`.
6. **Autostart — fixed in v1.0.1, no stopgap needed:** the app writes its HKCU
   Run entry **quoted** and syncs it to the current exe path on each launch
   (verification report §9). Leave Settings → Advanced → "Start at login" **ON**
   (the default). Confirm the entry is quoted:
   ```powershell
   reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Vibe Dictation"
   ```
   Expect `"...\Vibe Dictation\vibe.exe"` **with** the quotes. (v1.0.0 wrote it
   unquoted and needed the manual stopgap in §5c; that no longer applies.)
7. **Re-create the firewall enforcement — it is per-machine and does not travel
   with the installer.** From an elevated PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "Vibe Dictation - block outbound" -Direction Outbound -Program "$env:LOCALAPPDATA\Vibe Dictation\vibe.exe" -Action Block -Profile Any
   New-NetFirewallRule -DisplayName "Vibe Dictation Sona - block outbound" -Direction Outbound -Program "$env:LOCALAPPDATA\Vibe Dictation\sona.exe" -Action Block -Profile Any
   ```
8. **Mini-audit (per RELEASING.md):** run the netstat sampler while dictating one
   English and one Arabic sentence:
   ```powershell
   1..12 | ForEach-Object { $ids = (Get-Process | Where-Object { $_.ProcessName -match '^(vibe|sona)$' }).Id; netstat -ano | Select-String 'LISTENING|ESTABLISHED' | Where-Object { $ids -contains [int](($_ -split '\s+')[-1]) }; Start-Sleep 5 } | Sort-Object -Unique
   ```
   Expect **only** `127.0.0.1` rows (Sona listener + app↔engine pair), never
   `0.0.0.0`. Then dictate once more **under the block** (rules from step 7
   active) — it must still work; loopback is unaffected.
9. **Record results** (netstat output, device enumeration, hash checks) alongside
   this checklist — that completed record is the per-machine audit evidence.

---

## Path 2 — Full source build on a clean Windows machine

> Produces **new bytes**: the result must pass the full RELEASING.md
> verification (strings audit with positive control, install, netstat, firewall,
> EN+AR dictation) before it may replace the current audited release anywhere.

### Prerequisites (versions verified on the home build machine)

| Tool | Version | Notes |
|---|---|---|
| VS 2022 Build Tools | 17.x with **C++ workload** (MSVC 14.44) + **Windows SDK** (10.0.26100) | `winget install Microsoft.VisualStudio.2022.BuildTools` then add the workload |
| rustup / Rust | 1.92 (stable, **MSVC** host `x86_64-pc-windows-msvc`) | `winget install Rustlang.Rustup` |
| Node | 24.x | `winget install OpenJS.NodeJS` |
| pnpm | **10.4.1** (pinned in `package.json` `packageManager`) | `npm install -g pnpm@10.4.1` |
| uv | 0.11+ | `winget install astral-sh.uv` |
| Git | any recent | `winget install Git.Git` |

### Build sequence

All cargo/tauri commands run **from a VS Developer shell** (`VsDevCmd.bat
-arch=x64` / `Enter-VsDevShell` / "Developer PowerShell for VS 2022").
General gotcha: this also guarantees the MSVC `link.exe` precedes any other
`link.exe` on PATH (GNU coreutils ships one that silently breaks Rust linking).

```powershell
git clone https://github.com/NasserAlh/vibe-dictation.git
cd vibe-dictation

# 1. Fetch the pinned Sona + ffmpeg Vulkan sidecars
uv run scripts/pre_build.py
# 2. Verify the fetched sidecar against the pin:
#    compare with docs/superpowers/notes/sona-sidecar-sha256.txt ("exe:" line)
Get-FileHash desktop\src-tauri\binaries\sona-x86_64-pc-windows-msvc.exe -Algorithm SHA256

# 3. Frontend deps + generated i18n
cd desktop
pnpm install
pnpm i18n:generate     # REQUIRED before any bare tsc/eslint (fresh-clone finding:
                       # paraglide output is gitignored; tauri dev/build generate it)

# 4. Build the NSIS installer
pnpm exec tauri build
# → target\release\bundle\nsis\Vibe Dictation_<version>_x64-setup.exe
```

### Post-build

- Hash and archive the installer per RELEASING.md (archive outside `target\`,
  record SHA-256, `cargo clean` after archiving).
- Run the **full** RELEASING.md verification before deploying the new artifact.
- **Network reachability:** the build fetches from GitHub (Sona sidecars, a
  git-pinned crate), crates.io, and the npm registry, so the build machine needs
  ordinary internet access with no proxy or TLS-interception in the path.

---

## Appendix — AMD machines (RX 7900 XTX + Ryzen 7950X3D)

- **Driver:** Vulkan ships with the standard AMD Adrenalin driver — no extra
  runtime, same build, the whisper.cpp Vulkan backend is vendor-agnostic.
- **One Vulkan device (verified 2026-07-14).** Although the Ryzen 9 7950X3D has an
  RDNA2 iGPU, `sona.exe devices` on this machine enumerates a **single** Vulkan
  device — `AMD Radeon RX 7900 XTX`, index 0; the iGPU surfaces no Vulkan device
  here. This corrected an earlier *assumption* that the machine would enumerate two
  devices (verification report §9).
  ```powershell
  & "$env:LOCALAPPDATA\Vibe Dictation\sona.exe" devices
  ```
- **GPU Device = Auto is correct here.** With a single enumerated device, Auto
  necessarily binds the discrete XTX — no explicit index needed. Only set an index
  (Settings → Select Model → GPU Device number) if a future driver/OS change makes
  the iGPU appear as a second Vulkan device; then pick the entry whose
  `description` is **"AMD Radeon RX 7900 XTX"**.
- **Verifying the binding.** Load-bearing: (1) the enumeration above shows a single
  device, the RX 7900 XTX; (2) near-instant transcription (an iGPU-bound large-v3
  would be sluggish). Corroborating: dedicated VRAM on the XTX rises ~3 GB on first
  model load (Task Manager → Performance → the discrete GPU). The app's runtime log
  (`%APPDATA%\net.nasserhub.dictation\log_YYYY-MM-DD.txt`) does **not** print a GPU
  line — its "device" entries are audio devices only — so don't hunt for one there.
- **Stalls at Vulkan init or first model load:** see [debug.md](debug.md) —
  VulkanRT and `vc_redist` are the usual fixes.

---

## New-machine smoke protocol (both paths end here)

Mirror of the home-machine re-test:

1. **Process paths** — both exes must run from the install path:
   ```powershell
   Get-Process vibe, sona -ErrorAction SilentlyContinue | Select-Object ProcessName, Path
   ```
   Expect both under `%LOCALAPPDATA%\Vibe Dictation\`. Anything else (e.g. a
   `target\...` path) is a fail.
2. **Dictation** — one English and one Arabic sentence into MS Word (reference
   target; Windows 11 tabbed Notepad is a known-bad injection target). First
   dictation after launch carries a one-time GPU warmup (~10 s); subsequent ones
   should land within ~2 s of key release.
3. **Model list** — Settings → Select Model shows the copied model(s), with the
   intended default selected.

Record all three; attach them to the change record above as the per-machine
deployment evidence.
