; CharacterForgeAI NSIS installer page flow and hooks.
; This file is product installer behavior, not an internal plan.
; UAC/admin safety: Tauri is configured for per-machine installation so the
; generated NSIS installer requests elevation. This is intentional because
; WebView2, AWS CLI v2, and AWS SAM CLI installers can require Administrator
; rights. Expected generated behavior: RequestExecutionLevel admin.

!include LogicLib.nsh
!include nsDialogs.nsh

!define CFAI_APP_NAME "CharacterForgeAI"
!define CFAI_EXE_NAME "CharacterForgeAI.exe"
!define CFAI_LOG_DIR "$TEMP\CharacterForgeAI"
!define CFAI_START_MENU_DIR "$SMPROGRAMS\CharacterForgeAI"
!define CFAI_DEPENDENCY_MESSAGE "CharacterForgeAI can check your computer for required tools before the app is installed. This helps confirm WebView2, AWS CLI v2, AWS SAM CLI, and Docker Desktop guidance are ready for local deployment workflows."
!define CFAI_INSTALL_MESSAGE "CharacterForgeAI can help install WebView2 Runtime, AWS CLI v2, and AWS SAM CLI from official HTTPS sources. Docker Desktop is shown as guided-install messaging so you can choose the right Windows setup option."

Var CFAI_RunDependencyValidation
Var CFAI_RunDependencyInstallers
Var CFAI_CreateDesktopShortcut
Var CFAI_CreateStartMenuShortcut
Var CFAI_LaunchNow
Var CFAI_DependencyValidationCheckbox
Var CFAI_DependencyInstallCheckbox
Var CFAI_DesktopShortcutCheckbox
Var CFAI_StartMenuShortcutCheckbox
Var CFAI_LaunchNowCheckbox

; The requested wizard order is declared here instead of relying on modal
; MessageBox prompts:
; 1. Welcome page.
; 2. License page.
; 3. Dependency validation page.
; 4. Dependency install confirmation page.
; 5. Install directory page.
; 6. Shortcut options page.
; 7. Install progress page.
; 8. Finish page with a Launch CharacterForgeAI now checkbox.
Page custom CFAI_CreateWelcomePage
; Tauri stages bundle.licenseFile as `license_file` beside the generated NSIS
; script before this hook is compiled. Use that staged path instead of a repo-
; relative path because makensis runs from target/release/nsis/<arch>.
LicenseData "license_file"
Page license
Page custom CFAI_CreateDependencyValidationPage CFAI_LeaveDependencyValidationPage
Page custom CFAI_CreateDependencyInstallPage CFAI_LeaveDependencyInstallPage
Page directory
Page custom CFAI_CreateShortcutOptionsPage CFAI_LeaveShortcutOptionsPage
Page instfiles
Page custom CFAI_CreateFinishPage CFAI_LeaveFinishPage

!macro CFAI_ExtractInstallerHelpers
  InitPluginsDir
  File /oname=$PLUGINSDIR\detect-dependencies.ps1 "${__FILEDIR__}\detect-dependencies.ps1"
  File /oname=$PLUGINSDIR\install-webview2-runtime.ps1 "${__FILEDIR__}\install-webview2-runtime.ps1"
  File /oname=$PLUGINSDIR\install-aws-cli-v2.ps1 "${__FILEDIR__}\install-aws-cli-v2.ps1"
  File /oname=$PLUGINSDIR\install-aws-sam-cli.ps1 "${__FILEDIR__}\install-aws-sam-cli.ps1"
  File /oname=$PLUGINSDIR\show-docker-guidance.ps1 "${__FILEDIR__}\show-docker-guidance.ps1"
!macroend

!macro CFAI_RunDependencyValidation
  CreateDirectory "${CFAI_LOG_DIR}"
  !insertmacro CFAI_ExtractInstallerHelpers
  ${If} $CFAI_RunDependencyValidation == "1"
    DetailPrint "Checking your computer for required tools..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\detect-dependencies.ps1" -LogPath "${CFAI_LOG_DIR}\dependency-validation.log"'
  ${Else}
    DetailPrint "Dependency validation skipped by the user."
  ${EndIf}
!macroend

!macro CFAI_RunDependencyInstallers
  ${If} $CFAI_RunDependencyInstallers == "1"
    DetailPrint "Installing only missing prerequisites. Existing tools are detected and skipped by each helper."

    DetailPrint "Checking WebView2 Runtime before download/install..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-webview2-runtime.ps1" -LogPath "${CFAI_LOG_DIR}\install-webview2-runtime.log"'

    DetailPrint "Checking AWS CLI v2 before download/install..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-aws-cli-v2.ps1" -LogPath "${CFAI_LOG_DIR}\install-aws-cli-v2.log"'

    DetailPrint "Checking AWS SAM CLI before download/install..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-aws-sam-cli.ps1" -LogPath "${CFAI_LOG_DIR}\install-aws-sam-cli.log"'

    DetailPrint "Showing Docker Desktop guided-install status..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\show-docker-guidance.ps1" -LogPath "${CFAI_LOG_DIR}\docker-guidance.log"'
  ${Else}
    DetailPrint "Dependency installation skipped. CharacterForgeAI can guide setup later."
  ${EndIf}
!macroend

!macro CFAI_EnsureDefaultChoices
  ; Silent installs skip custom pages, so initialize the same safe defaults that
  ; the welcome page sets for interactive installs.
  ${If} $CFAI_RunDependencyValidation == ""
    StrCpy $CFAI_RunDependencyValidation "1"
  ${EndIf}
  ${If} $CFAI_RunDependencyInstallers == ""
    StrCpy $CFAI_RunDependencyInstallers "0"
  ${EndIf}
  ${If} $CFAI_CreateDesktopShortcut == ""
    StrCpy $CFAI_CreateDesktopShortcut "1"
  ${EndIf}
  ${If} $CFAI_CreateStartMenuShortcut == ""
    StrCpy $CFAI_CreateStartMenuShortcut "1"
  ${EndIf}
  ${If} $CFAI_LaunchNow == ""
    StrCpy $CFAI_LaunchNow "0"
  ${EndIf}
!macroend

!macro CFAI_ApplyShortcutChoices
  SetShellVarContext all

  ${If} $CFAI_CreateStartMenuShortcut == "1"
    CreateDirectory "${CFAI_START_MENU_DIR}"
    CreateShortCut "${CFAI_START_MENU_DIR}\CharacterForgeAI.lnk" "$INSTDIR\${CFAI_EXE_NAME}"
  ${Else}
    Delete "${CFAI_START_MENU_DIR}\CharacterForgeAI.lnk"
    RMDir "${CFAI_START_MENU_DIR}"
  ${EndIf}

  ${If} $CFAI_CreateDesktopShortcut == "1"
    CreateShortCut "$DESKTOP\CharacterForgeAI.lnk" "$INSTDIR\${CFAI_EXE_NAME}"
  ${Else}
    Delete "$DESKTOP\CharacterForgeAI.lnk"
  ${EndIf}
!macroend

Function CFAI_CreateWelcomePage
  StrCpy $CFAI_RunDependencyValidation "1"
  StrCpy $CFAI_RunDependencyInstallers "0"
  StrCpy $CFAI_CreateDesktopShortcut "1"
  StrCpy $CFAI_CreateStartMenuShortcut "1"
  StrCpy $CFAI_LaunchNow "1"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Welcome to CharacterForgeAI"
  Pop $0
  ${NSD_CreateLabel} 0 34u 100% 72u "This installer adds the desktop app for building, testing, and managing game-ready AI characters.$\r$\n$\r$\nThe setup flow includes the license, dependency validation, dependency install confirmation, install directory, shortcut options, install progress, and finish pages. Choose where CharacterForgeAI is installed on the install directory page."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function CFAI_CreateDependencyValidationPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Dependency validation"
  Pop $0
  ${NSD_CreateLabel} 0 32u 100% 70u "${CFAI_DEPENDENCY_MESSAGE}$\r$\n$\r$\nThe validation writes a local log under ${CFAI_LOG_DIR} and does not deploy AWS resources."
  Pop $0
  ${NSD_CreateCheckbox} 0 112u 100% 12u "Run dependency validation now"
  Pop $CFAI_DependencyValidationCheckbox
  ${If} $CFAI_RunDependencyValidation == "1"
    ${NSD_Check} $CFAI_DependencyValidationCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function CFAI_LeaveDependencyValidationPage
  ${NSD_GetState} $CFAI_DependencyValidationCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CFAI_RunDependencyValidation "1"
  ${Else}
    StrCpy $CFAI_RunDependencyValidation "0"
  ${EndIf}
  !insertmacro CFAI_RunDependencyValidation
FunctionEnd

Function CFAI_CreateDependencyInstallPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Dependency install confirmation"
  Pop $0
  ${NSD_CreateLabel} 0 32u 100% 80u "${CFAI_INSTALL_MESSAGE}$\r$\n$\r$\nYou can skip this and install tools later from the CharacterForgeAI setup screen. No AWS deployment commands are run by this installer."
  Pop $0
  ${NSD_CreateCheckbox} 0 122u 100% 12u "Install missing tools now"
  Pop $CFAI_DependencyInstallCheckbox
  ${If} $CFAI_RunDependencyInstallers == "1"
    ${NSD_Check} $CFAI_DependencyInstallCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function CFAI_LeaveDependencyInstallPage
  ${NSD_GetState} $CFAI_DependencyInstallCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CFAI_RunDependencyInstallers "1"
  ${Else}
    StrCpy $CFAI_RunDependencyInstallers "0"
  ${EndIf}
FunctionEnd

Function CFAI_CreateShortcutOptionsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Shortcut options"
  Pop $0
  ${NSD_CreateLabel} 0 32u 100% 36u "Choose which Windows shortcuts CharacterForgeAI should create. The installer runs elevated so shortcuts are created in the all-users locations."
  Pop $0
  ${NSD_CreateCheckbox} 0 78u 100% 12u "Desktop shortcut"
  Pop $CFAI_DesktopShortcutCheckbox
  ${If} $CFAI_CreateDesktopShortcut == "1"
    ${NSD_Check} $CFAI_DesktopShortcutCheckbox
  ${EndIf}
  ${NSD_CreateCheckbox} 0 100u 100% 12u "Start Menu shortcut"
  Pop $CFAI_StartMenuShortcutCheckbox
  ${If} $CFAI_CreateStartMenuShortcut == "1"
    ${NSD_Check} $CFAI_StartMenuShortcutCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function CFAI_LeaveShortcutOptionsPage
  ${NSD_GetState} $CFAI_DesktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CFAI_CreateDesktopShortcut "1"
  ${Else}
    StrCpy $CFAI_CreateDesktopShortcut "0"
  ${EndIf}

  ${NSD_GetState} $CFAI_StartMenuShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CFAI_CreateStartMenuShortcut "1"
  ${Else}
    StrCpy $CFAI_CreateStartMenuShortcut "0"
  ${EndIf}
FunctionEnd

Function CFAI_CreateFinishPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "CharacterForgeAI is ready"
  Pop $0
  ${NSD_CreateLabel} 0 34u 100% 50u "Setup has finished installing CharacterForgeAI. You can launch it now, or start it later from the shortcuts you selected."
  Pop $0
  ${NSD_CreateCheckbox} 0 94u 100% 12u "Launch CharacterForgeAI now"
  Pop $CFAI_LaunchNowCheckbox
  ${If} $CFAI_LaunchNow == "1"
    ${NSD_Check} $CFAI_LaunchNowCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function CFAI_LeaveFinishPage
  ${NSD_GetState} $CFAI_LaunchNowCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CFAI_LaunchNow "1"
    ExecShell "open" "$INSTDIR\${CFAI_EXE_NAME}"
    Quit
  ${Else}
    StrCpy $CFAI_LaunchNow "0"
    Quit
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "The CharacterForgeAI page-level installer flow is active."
  DetailPrint "Directory, shortcut, progress, and finish choices are collected before files are installed."
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro CFAI_EnsureDefaultChoices
  !insertmacro CFAI_RunDependencyInstallers
  !insertmacro CFAI_ApplyShortcutChoices
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Preparing to remove CharacterForgeAI for this Windows user."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "CharacterForgeAI has been removed."
!macroend
