# Building

Windows-only fork. See [README.md](../README.md) for the short version and
[RELEASING.md](../RELEASING.md) for the release + verification procedure.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (MSVC toolchain) + VS 2022
  Build Tools with the C++ workload and a Windows SDK
- [pnpm](https://pnpm.io/) and Node
- [uv](https://docs.astral.sh/uv/) (build scripts)

**All cargo/tauri commands run from a shell with the MSVC environment loaded**
(`VsDevCmd.bat -arch=x64`, `Enter-VsDevShell`, or a "Developer PowerShell for
VS 2022"). This also ensures the MSVC `link.exe` wins over any `link.exe`
shadowing it on PATH (e.g. GNU coreutils).

## Build

Fetch the pinned Sona + ffmpeg Vulkan sidecars (pin: `.sona-version`; verify
against `docs/sona-sidecar-sha256.txt`):

```console
uv run scripts/pre_build.py
```

Then from `desktop/`:

```console
pnpm install
pnpm i18n:generate     # paraglide output (gitignored); needed before bare tsc/eslint —
                       # tauri dev/build run it automatically
pnpm exec tauri dev    # develop
pnpm exec tauri build  # NSIS installer
```

Or in one step: `uv run scripts/pre_build.py --dev` (or `--build`).

Models are placed manually — the app performs no downloads. Drop a Whisper
`ggml-*.bin` into the app's models folder (Settings → Select Model → Models
Folder); see [models.md](models.md) for sources.

## Build Sona from source (escape hatch)

Normally the prebuilt sidecar from `pre_build.py` is all you need. Build Sona
yourself only when debugging engine-level issues (Vulkan stalls, whisper.cpp
behavior). Sona lives in a separate repo — clone
[github.com/thewh1teagle/sona](https://github.com/thewh1teagle/sona) to `./sona`
(the path is gitignored).

Download prebuilt whisper.cpp libs (one-time):

```console
uv run sona/scripts/download-libs.py
```

Install [MSYS2](https://www.msys2.org/), then MinGW and Vulkan headers:

```console
pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-vulkan-devel
```

Open an MSYS2 MinGW64 shell with your full Windows PATH (so `rustc`, `cargo`,
etc. are available):

```console
C:\msys64\msys2_shell.cmd -mingw64 -defterm -no-start -use-full-path
```

Build and place as sidecar:

```console
cargo build --manifest-path sona/Cargo.toml -p sona --release
cp sona/target/release/sona.exe desktop/src-tauri/binaries/sona-x86_64-pc-windows-msvc.exe
# copy into the dev target so `tauri dev` picks it up immediately:
cp desktop/src-tauri/binaries/sona-x86_64-pc-windows-msvc.exe target/debug/sona.exe
```

## Test and lint

```console
cargo test -- --nocapture          # Rust (set RUST_LOG=trace for detail)
cargo fmt && cargo clippy          # Rust lint
pnpm test                          # frontend (from desktop/)
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint .
uv run scripts/check_i18n.py       # locale key parity (from repo root)
```

Normalize a wav file for test input:

```console
ffmpeg -i file.wav -ar 16000 -ac 1 -c:a pcm_s16le normal.wav
```

## Releases

Follow [RELEASING.md](../RELEASING.md) — build, full zero-egress re-verification
(strings audit, loopback netstat, firewall test), content-pinning, and archiving.
Releases are unsigned NSIS installers for private use; there is no CI.

## Updating dependencies

```console
# frontend (from desktop/)
pnpm install
pnpx ncu -u

# Rust (from desktop/src-tauri)
cargo install cargo-edit
CARGO_NET_GIT_FETCH_WITH_CLI=true cargo upgrade
# OR
cargo +nightly -Zunstable-options update --breaking
```

Notes:

- Update crates and the lockfile in a dedicated commit so it is easy to revert.
- Don't upgrade load-bearing crates (tauri, the plugins) without need — and any
  dependency change requires the RELEASING.md verification pass, since new
  crates can introduce network capability.

## Gotchas

### Faster dev builds (cranelift)

```console
rustup toolchain install nightly
rustup component add rustc-codegen-cranelift-preview --toolchain nightly
# PowerShell
$env:CARGO_PROFILE_DEV_CODEGEN_BACKEND="cranelift" ; cargo +nightly build -Zcodegen-backend
```
