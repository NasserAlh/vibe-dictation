; Single NSIS hooks file for the installer — referenced by
; bundle.windows.nsis.installerHooks in tauri.conf.json
; (Tauri accepts one hooks file per build).

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

; --- VC++ redistributable (inherited from upstream Vibe) ------------------
; NOTE: this section DOWNLOADS vc_redist.x64.exe from aka.ms during install
; when the runtime is missing — the one network access in the installer.
; The app's zero-egress guarantee covers the running app, not this step.

Section
    ; Check if the VC++ Redistributable is already installed
    ReadRegStr $0 HKLM "SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"

    ${If} $0 != ""
        DetailPrint "vc_redist found! Skipping installation."
    ${Else}
        ; Define download URL and target path for vc_redist.x64.exe
        StrCpy $0 "https://aka.ms/vs/17/release/vc_redist.x64.exe"
        StrCpy $1 "$TEMP\vc_redist.x64.exe"

        ; Download the vc_redist.x64.exe installer
        NSISdl::download $0 $1
        Pop $0
        ${If} $0 == "success"
            DetailPrint "vc_redist downloaded successfully"
        ${Else}
            DetailPrint "vc_redist failed to download"
            Call InstallFailed
            Abort "vc_redist download failed, aborting installation"
        ${EndIf}

        ; Execute the downloaded installer
        ExecWait '"$1" /install /passive /norestart' $0
        ${If} $0 == 0
            DetailPrint "vc_redist installation completed successfully"
        ${Else}
            DetailPrint "vc_redist installation failed"
            Call InstallFailed
            Abort "vc_redist installation failed, aborting process"
        ${EndIf}
    ${EndIf}
SectionEnd


Function InstallFailed
    DetailPrint "vc_redist failed to download"
    ; Show a message box to inform the user
    MessageBox MB_OK|MB_ICONEXCLAMATION "Failed to download VC++ Redistributable. Please download and install it manually. Click OK to open the URL to download."
    ; Open the URL in the default browser
    ExecShell "open" "https://aka.ms/vs/17/release/vc_redist.x64.exe"
FunctionEnd
