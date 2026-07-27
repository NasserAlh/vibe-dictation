//! Login autostart via a QUOTED HKCU Run entry.
//!
//! `tauri-plugin-autostart`'s underlying `auto-launch` crate writes the Run
//! value unquoted (`format!("{} {}", path, args)`), which silently fails to
//! launch on Windows 11 when the install path contains a space (v1.0.0 defect;
//! see docs/superpowers/notes/verification-report.md §5c). We own the write
//! here and always quote the exe path. The value name matches the product name
//! so it overwrites any prior entry the plugin — or the manual stopgap — left.

const VALUE_NAME: &str = "Vibe Dictation";

#[cfg(windows)]
mod platform {
    use super::VALUE_NAME;
    use eyre::{Context, Result};
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    /// Write the HKCU Run entry with a quoted current-exe path (idempotent).
    pub fn enable() -> Result<()> {
        let exe = std::env::current_exe().context("resolve current exe path")?;
        let quoted = format!("\"{}\"", exe.display());
        let (run, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(RUN_KEY)
            .context("open HKCU Run key")?;
        run.set_value(VALUE_NAME, &quoted).context("write autostart Run value")
    }

    /// Remove the HKCU Run entry (idempotent — already-absent is success).
    pub fn disable() -> Result<()> {
        let run = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
            .context("open HKCU Run key")?;
        match run.delete_value(VALUE_NAME) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e).context("delete autostart Run value"),
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use eyre::Result;

    pub fn enable() -> Result<()> {
        Ok(())
    }

    pub fn disable() -> Result<()> {
        Ok(())
    }
}

pub use platform::{disable, enable};

/// Set login autostart. Release builds only — a dev build must never write the
/// Run entry (it would point login at a transient `target\debug` exe that shares
/// this app's store/identifier). Mirrors the `cfg!(debug_assertions)` gate in
/// main.rs and `isDevBuild` in advanced.tsx.
#[tauri::command]
pub fn set_autostart(enabled: bool) -> eyre::Result<()> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    if enabled {
        enable()
    } else {
        disable()
    }
}
