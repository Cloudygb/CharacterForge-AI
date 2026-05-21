; CharacterForgeAI NSIS installer hooks.
; This file is product installer behavior, not an internal plan.
; UAC/admin safety: Tauri is configured for current-user installation, and this
; hook intentionally documents requestexecutionlevel user behavior instead of
; requiring elevation for the whole installer.

!include LogicLib.nsh

!define CFAI_APP_NAME "CharacterForgeAI"
!define CFAI_LOG_DIR "$TEMP\CharacterForgeAI"
!define CFAI_DEPENDENCY_TITLE "CharacterForgeAI setup"
!define CFAI_DEPENDENCY_MESSAGE "CharacterForgeAI can check your computer for required tools before the app is installed. This helps confirm WebView2, AWS CLI v2, AWS SAM CLI, and Docker Desktop guidance are ready for local deployment workflows."
!define CFAI_INSTALL_MESSAGE "Install missing tools now? CharacterForgeAI can help install WebView2 Runtime, AWS CLI v2, and AWS SAM CLI from official HTTPS sources. Docker Desktop is shown as guided-install messaging so you can choose the right Windows setup option."

Var CFAI_RunDependencyInstallers

!macro CFAI_ShowWelcome
  MessageBox MB_OK|MB_ICONINFORMATION \
    "Welcome to CharacterForgeAI.\r\n\r\nThis installer adds the desktop app for building, testing, and managing game-ready AI characters. The next steps let you choose where CharacterForgeAI is installed and decide whether to add desktop shortcut and Start Menu entries."
!macroend

!macro CFAI_ExtractInstallerHelpers
  InitPluginsDir
  File /oname=$PLUGINSDIR\detect-dependencies.ps1 "installer\detect-dependencies.ps1"
  File /oname=$PLUGINSDIR\install-webview2-runtime.ps1 "installer\install-webview2-runtime.ps1"
  File /oname=$PLUGINSDIR\install-aws-cli-v2.ps1 "installer\install-aws-cli-v2.ps1"
  File /oname=$PLUGINSDIR\install-aws-sam-cli.ps1 "installer\install-aws-sam-cli.ps1"
  File /oname=$PLUGINSDIR\show-docker-guidance.ps1 "installer\show-docker-guidance.ps1"
!macroend

!macro CFAI_ValidateDependencies
  CreateDirectory "${CFAI_LOG_DIR}"
  !insertmacro CFAI_ExtractInstallerHelpers
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "${CFAI_DEPENDENCY_MESSAGE}\r\n\r\nRun a quick dependency validation now?" \
    IDYES cfai_validate_dependencies IDNO cfai_skip_dependency_validation

  cfai_validate_dependencies:
    DetailPrint "Checking your computer for required tools..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\detect-dependencies.ps1" -LogPath "${CFAI_LOG_DIR}\dependency-validation.log"'
    Goto cfai_dependency_validation_done

  cfai_skip_dependency_validation:
    DetailPrint "Dependency validation skipped by the user."

  cfai_dependency_validation_done:
!macroend

!macro CFAI_ConfirmDependencyInstallers
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "${CFAI_INSTALL_MESSAGE}\r\n\r\nYou can also skip this and install tools later from the CharacterForgeAI setup screen." \
    IDYES cfai_install_dependencies IDNO cfai_skip_dependency_installers

  cfai_install_dependencies:
    StrCpy $CFAI_RunDependencyInstallers "yes"
    DetailPrint "Preparing to install missing tools from official HTTPS sources."
    Goto cfai_dependency_install_choice_done

  cfai_skip_dependency_installers:
    StrCpy $CFAI_RunDependencyInstallers "no"
    DetailPrint "Dependency installers skipped by the user."

  cfai_dependency_install_choice_done:
!macroend

!macro CFAI_RunDependencyInstallers
  ${If} $CFAI_RunDependencyInstallers == "yes"
    DetailPrint "Installing WebView2 Runtime if needed..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-webview2-runtime.ps1" -LogPath "${CFAI_LOG_DIR}\install-webview2-runtime.log"'

    DetailPrint "Installing AWS CLI v2 if needed..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-aws-cli-v2.ps1" -LogPath "${CFAI_LOG_DIR}\install-aws-cli-v2.log"'

    DetailPrint "Installing AWS SAM CLI if needed..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-aws-sam-cli.ps1" -LogPath "${CFAI_LOG_DIR}\install-aws-sam-cli.log"'

    DetailPrint "Showing Docker Desktop guided-install status..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\show-docker-guidance.ps1" -LogPath "${CFAI_LOG_DIR}\docker-guidance.log"'
  ${Else}
    DetailPrint "Dependency installation skipped. CharacterForgeAI can guide setup later."
  ${EndIf}
!macroend

!macro CFAI_ShowFinish
  MessageBox MB_OK|MB_ICONINFORMATION \
    "CharacterForgeAI is ready.\r\n\r\nUse Launch CharacterForgeAI on the finish page to open the app now, or start it later from your Start Menu or desktop shortcut if you selected one."
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CFAI_ShowWelcome
  DetailPrint "Choose where CharacterForgeAI is installed on the installer directory page."
  DetailPrint "Choose desktop shortcut and Start Menu shortcut options on the shortcut pages."
  DetailPrint "Progress is shown while files and optional tools are installed."
  !insertmacro CFAI_ValidateDependencies
  !insertmacro CFAI_ConfirmDependencyInstallers
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro CFAI_RunDependencyInstallers
  !insertmacro CFAI_ShowFinish
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Preparing to remove CharacterForgeAI for this Windows user."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "CharacterForgeAI has been removed."
!macroend
