; Single NSIS hooks file for the installer — referenced by
; bundle.windows.nsis.installerHooks in tauri.conf.json
; (Tauri accepts one hooks file per build).
;
; This file must never reach the network. The installer's zero-egress
; guarantee is part of RELEASING.md's scope statement: the VC++ runtime DLLs
; that sona.exe needs are bundled app-local (windows/vcredist/, content-pinned
; in docs/sona-sidecar-sha256.txt) instead of downloaded, and WebView2 is
; taken from Windows 11 in-box (bundle.windows.webviewInstallMode = skip).

; --- Kill orphaned Sona sidecar -------------------------------------------
; The stock Tauri NSIS template only closes the main app executable before
; installing. It knows nothing about the bundled sidecars, so an orphaned
; sona.exe (left behind when the app crashes or is force-killed and its
; teardown never runs) keeps a lock on the install dir and the upgrade fails
; with "Error opening file for writing". Kill it before install/uninstall.
; /T also takes down any child processes; Sleep lets Windows release handles.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM sona.exe /T'
  Pop $0
  Sleep 300
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM sona.exe /T'
  Pop $0
  Sleep 300
!macroend
