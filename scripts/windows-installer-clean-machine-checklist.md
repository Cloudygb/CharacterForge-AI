# Clean-machine Windows installer verification checklist

Release installer policy: NSIS-only current-user installation. CharacterForgeAI publishes the NSIS `.exe` installer as the supported Windows release artifact; MSI output is not built for release because the custom dependency pages and helper checks live in the NSIS flow.

This checklist is for release QA on a fresh Windows machine or VM. Keep it with the installer scripts rather than public docs because it is an operational release checklist, not an end-user guide.

## Scope

- Verify the staged installer at `dist/characterforgeai-installer.exe`.
- Verify that the installed app creates the expected local artifacts, especially `CharacterForgeAI.exe`.
- Confirm signer information when signature status is available on the machine.
- Confirm the supported release policy remains NSIS-only and current-user scoped.

## Before starting

- Use a clean Windows 10/11 machine or VM snapshot.
- Copy or clone the repo checkout containing the staged `dist/characterforgeai-installer.exe`.
- If validating a release candidate, record the commit SHA and installer file hash in the release notes kept outside this checklist.
- Do not enter credentials into the checklist, terminal transcript, screenshots, or bug report.

## Staged installer checks

From PowerShell at the repo root using `scripts/verify-windows-installer.ps1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-windows-installer.ps1 -SkipInstalledArtifacts
```

Expected results:

- `dist/characterforgeai-installer.exe` exists.
- File name is exactly `characterforgeai-installer.exe`.
- File size meets the script's minimum size threshold. If a release intentionally changes the expected size, rerun with `-ExpectedMinSizeMB <value>` and document why.
- Signature status is reported. Release-mode verification must show `Valid`, match the expected publisher, and include a timestamp; unsigned local builds are allowed only in explicit development checks.
- The script exits with code `0` unless an installer existence, name, size, or invalid-signature error is found.

Optional JSON capture:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-windows-installer.ps1 -SkipInstalledArtifacts -Json | Out-File .\dist\installer-preinstall-verification.json -Encoding utf8
```

## Install flow checks

1. Run `dist/characterforgeai-installer.exe` as a normal non-admin user.
2. Confirm the installer shows CharacterForgeAI branding.
3. Confirm the dependency validation page is understandable.
4. Confirm optional prerequisite installer prompts are opt-in.
5. Confirm the install location is a current-user location by default.
6. Leave Desktop shortcut and Start Menu shortcut enabled for this verification pass.
7. Finish installation and launch CharacterForgeAI if prompted.

Do not run SAM deploy. Do not run AWS CloudFormation. Do not configure or paste credentials as part of this installer-only checklist.

## Installed artifact checks

After installation, from PowerShell at the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-windows-installer.ps1
```

Expected results:

- `CharacterForgeAI.exe` exists in the current-user app install location.
- Start Menu shortcut exists under the CharacterForgeAI folder.
- Desktop shortcut is reported; it may be optional in future installer flows, but for this checklist pass it should be present when the checkbox was enabled.
- The script reports signature status for the staged installer when Windows exposes Authenticode metadata.
- The script exits with code `0` when required checks pass. Warnings should be reviewed before release.

If testing a nonstandard install directory, pass it explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-windows-installer.ps1 -ExpectedInstallDir "C:\Path\To\CharacterForgeAI"
```

## App launch smoke checks

- Launch `CharacterForgeAI.exe` from the Start Menu.
- Confirm the dashboard opens without a blank WebView.
- Confirm first-run setup/tutorial appears when expected.
- Confirm dependency/setup checks display guidance without exposing secrets.
- Close and relaunch the app once to confirm persisted UI preferences load.

## Uninstall checks

- Uninstall CharacterForgeAI from Windows Apps or the generated uninstaller.
- Confirm the app executable is removed from the install directory.
- Confirm shortcuts are removed or clearly marked stale if Windows delays cleanup.
- Rerun the verification script and confirm it fails the installed executable check after uninstall unless `-SkipInstalledArtifacts` is supplied.

## Failure report template

- Repo commit SHA:
- Windows version/build:
- Installer path:
- Installer size:
- Signature status:
- Verification script command:
- Verification script JSON or console summary:
- Install mode/location:
- Start Menu shortcut present:
- Desktop shortcut present:
- App launch result:
- Screenshots/logs with credentials and account-specific details redacted:
