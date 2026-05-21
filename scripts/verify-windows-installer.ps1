#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$InstallerPath,
    [string]$ExpectedInstallerName = "characterforgeai-installer.exe",
    [int]$ExpectedMinSizeMB = 40,
    [Nullable[int]]$ExpectedMaxSizeMB,
    [string]$ExpectedInstallDir,
    [switch]$SkipInstalledArtifacts,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    if (-not $Json) {
        Write-Host "`n==> $Message"
    }
}

function Add-Check {
    param(
        [System.Collections.ArrayList]$Checks,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Passed,
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet("info", "warning", "error")][string]$Severity = "error",
        [hashtable]$Data = @{}
    )

    [void]$Checks.Add([ordered]@{
        name = $Name
        passed = $Passed
        severity = $Severity
        message = $Message
        data = $Data
    })

    if (-not $Json) {
        $prefix = if ($Passed) { "PASS" } elseif ($Severity -eq "warning") { "WARN" } else { "FAIL" }
        Write-Host "[$prefix] $Name - $Message"
    }
}

function Resolve-RepoRoot {
    $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
    return (Resolve-Path (Join-Path $scriptDir "..")).Path
}

function Get-DefaultInstallerPath {
    $repoRoot = Resolve-RepoRoot
    # Default expected staged artifact: dist\characterforgeai-installer.exe
    return (Join-Path $repoRoot "dist\characterforgeai-installer.exe")
}

function Get-KnownInstallCandidates {
    $candidates = New-Object System.Collections.ArrayList

    if ($ExpectedInstallDir) {
        [void]$candidates.Add((Join-Path $ExpectedInstallDir "CharacterForgeAI.exe"))
    }

    $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
    $appData = [Environment]::GetFolderPath("ApplicationData")
    $desktop = [Environment]::GetFolderPath("DesktopDirectory")
    $programFiles = [Environment]::GetFolderPath("ProgramFiles")
    $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")

    if ($localAppData) {
        [void]$candidates.Add((Join-Path $localAppData "Programs\CharacterForgeAI\CharacterForgeAI.exe"))
        [void]$candidates.Add((Join-Path $localAppData "CharacterForgeAI\CharacterForgeAI.exe"))
    }
    if ($programFiles) {
        [void]$candidates.Add((Join-Path $programFiles "CharacterForgeAI\CharacterForgeAI.exe"))
    }
    if ($programFilesX86) {
        [void]$candidates.Add((Join-Path $programFilesX86 "CharacterForgeAI\CharacterForgeAI.exe"))
    }
    if ($appData) {
        [void]$candidates.Add((Join-Path $appData "Microsoft\Windows\Start Menu\Programs\CharacterForgeAI\CharacterForgeAI.lnk"))
    }
    if ($desktop) {
        # Desktop shortcut is optional in the installer UI, but report it when present.
        [void]$candidates.Add((Join-Path $desktop "CharacterForgeAI.lnk"))
    }

    return $candidates | Select-Object -Unique
}

function Get-FileSummary {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        path = $item.FullName
        name = $item.Name
        sizeBytes = $item.Length
        sizeMB = [Math]::Round($item.Length / 1MB, 2)
        lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString("o")
    }
}

if (-not $InstallerPath) {
    $InstallerPath = Get-DefaultInstallerPath
}

$checks = New-Object System.Collections.ArrayList
$installerSummary = $null
$signatureSummary = $null
$installedArtifacts = New-Object System.Collections.ArrayList

Write-Step "Checking staged Windows installer"

if (Test-Path -LiteralPath $InstallerPath -PathType Leaf) {
    $installerSummary = Get-FileSummary -Path $InstallerPath
    Add-Check $checks "installer exists" $true "Found installer at $InstallerPath" "error" @{
        path = $installerSummary.path
    }

    $actualName = [System.IO.Path]::GetFileName($InstallerPath)
    Add-Check $checks "installer name" ($actualName -eq $ExpectedInstallerName) "Expected $ExpectedInstallerName; found $actualName" "error" @{
        expected = $ExpectedInstallerName
        actual = $actualName
    }

    $minBytes = $ExpectedMinSizeMB * 1MB
    Add-Check $checks "installer minimum size" ($installerSummary.sizeBytes -ge $minBytes) "Expected at least $ExpectedMinSizeMB MB; found $($installerSummary.sizeMB) MB" "error" @{
        expectedMinMB = $ExpectedMinSizeMB
        actualMB = $installerSummary.sizeMB
    }

    if ($null -ne $ExpectedMaxSizeMB) {
        $maxBytes = $ExpectedMaxSizeMB * 1MB
        Add-Check $checks "installer maximum size" ($installerSummary.sizeBytes -le $maxBytes) "Expected at most $ExpectedMaxSizeMB MB; found $($installerSummary.sizeMB) MB" "error" @{
            expectedMaxMB = $ExpectedMaxSizeMB
            actualMB = $installerSummary.sizeMB
        }
    }

    if (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue) {
        $signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
        $signatureSummary = [ordered]@{
            status = $signature.Status.ToString()
            statusMessage = $signature.StatusMessage
            signerCertificateSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
        }

        $signatureOk = $signature.Status -in @("Valid", "NotSigned", "Unknown")
        $severity = if ($signature.Status -eq "Valid") { "info" } elseif ($signature.Status -eq "NotSigned") { "warning" } else { "error" }
        Add-Check $checks "signature status" $signatureOk "Signature status: $($signature.Status)" $severity @{
            status = $signatureSummary.status
            statusMessage = $signatureSummary.statusMessage
        }
    } else {
        Add-Check $checks "signature status" $true "Get-AuthenticodeSignature is not available on this host; signature status was not checked." "warning" @{}
    }
} else {
    Add-Check $checks "installer exists" $false "Installer not found at $InstallerPath" "error" @{
        path = $InstallerPath
    }
}

Write-Step "Checking installed app artifacts"

if ($SkipInstalledArtifacts) {
    Add-Check $checks "installed artifacts" $true "Skipped installed app artifact checks by request." "warning" @{}
} else {
    $candidates = @(Get-KnownInstallCandidates)
    $foundExe = $false
    $foundStartMenu = $false
    $foundDesktopShortcut = $false

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $summary = Get-FileSummary -Path $candidate
            [void]$installedArtifacts.Add($summary)
            if ($summary.name -eq "CharacterForgeAI.exe") {
                $foundExe = $true
            }
            if ($candidate -like "*Start Menu*CharacterForgeAI.lnk") {
                $foundStartMenu = $true
            }
            if ($candidate -like "*Desktop*CharacterForgeAI.lnk") {
                $foundDesktopShortcut = $true
            }
        }
    }

    Add-Check $checks "installed app executable" $foundExe "Expected installed CharacterForgeAI.exe in a current-user or Program Files install location." "error" @{
        searched = $candidates
    }
    Add-Check $checks "start menu shortcut" $foundStartMenu "Expected Start Menu shortcut after installation." "warning" @{}
    Add-Check $checks "desktop shortcut" $true "Desktop shortcut is optional; present=$foundDesktopShortcut." "info" @{
        present = $foundDesktopShortcut
    }
}

$failedErrors = @($checks | Where-Object { -not $_.passed -and $_.severity -eq "error" })
$warnings = @($checks | Where-Object { -not $_.passed -and $_.severity -eq "warning" })
$result = [ordered]@{
    ok = ($failedErrors.Count -eq 0)
    checkedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    installer = $installerSummary
    signature = $signatureSummary
    installedArtifacts = $installedArtifacts
    failedErrors = $failedErrors.Count
    warnings = $warnings.Count
    checks = $checks
}

if ($Json) {
    $result | ConvertTo-Json -Depth 8
} else {
    Write-Step "Summary"
    Write-Host (($result | ConvertTo-Json -Depth 8))
}

if ($failedErrors.Count -gt 0) {
    exit 1
}

exit 0
