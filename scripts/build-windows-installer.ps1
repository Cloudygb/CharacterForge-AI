#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipNpmCi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "`n==> $Message"
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH. Install it before building the Windows installer."
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    Write-Host "> $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

$isWindowsHost = if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
    $IsWindows
} else {
    [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
}

if (-not $isWindowsHost) {
    throw "This installer build script must run on Windows so Tauri can produce the NSIS .exe bundle."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$DashboardDir = Join-Path $RepoRoot "apps\dashboard"
$TauriDir = Join-Path $DashboardDir "src-tauri"
$NsisDir = Join-Path $TauriDir "target\release\bundle\nsis"
$DistDir = Join-Path $RepoRoot "dist"
$InstallerOutput = Join-Path $DistDir "characterforgeai-installer.exe"

if (-not (Test-Path $DashboardDir -PathType Container)) {
    throw "Dashboard app directory not found: $DashboardDir"
}

if (-not (Test-Path (Join-Path $TauriDir "tauri.conf.json") -PathType Leaf)) {
    throw "Tauri configuration not found under: $TauriDir"
}

Write-Step "Validating developer build prerequisites"
Assert-Command "node"
Assert-Command "npm"
Assert-Command "rustc"
Assert-Command "cargo"

$nodeVersion = (& node --version).Trim()
$npmVersion = (& npm --version).Trim()
$rustVersion = (& rustc --version).Trim()
$cargoVersion = (& cargo --version).Trim()

Write-Host "Node:  $nodeVersion"
Write-Host "npm:   $npmVersion"
Write-Host "Rust:  $rustVersion"
Write-Host "Cargo: $cargoVersion"

Push-Location $DashboardDir
try {
    if (-not $SkipNpmCi) {
        Write-Step "Installing locked dashboard dependencies"
        # npm ci
        Invoke-Checked "npm" "ci"
    }

    Write-Step "Running dashboard typecheck"
    # npm run typecheck
    Invoke-Checked "npm" "run" "typecheck"

    Write-Step "Running dashboard tests"
    # npm test -- --run
    Invoke-Checked "npm" "test" "--" "--run"

    Write-Step "Building dashboard web assets"
    # npm run build
    Invoke-Checked "npm" "run" "build"

    Write-Step "Building Tauri desktop installer bundles"
    # npm run desktop:build
    Invoke-Checked "npm" "run" "desktop:build"
} finally {
    Pop-Location
}

Write-Step "Locating newest NSIS installer"
if (-not (Test-Path $NsisDir -PathType Container)) {
    throw "NSIS bundle directory not found: $NsisDir"
}

$Installer = Get-ChildItem -Path $NsisDir -Filter "*.exe" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if (-not $Installer) {
    throw "No NSIS installer .exe was found in: $NsisDir"
}

Write-Step "Staging release installer"
New-Item -Path $DistDir -ItemType Directory -Force | Out-Null
Copy-Item -Path $Installer.FullName -Destination $InstallerOutput -Force

if (-not (Test-Path $InstallerOutput -PathType Leaf)) {
    throw "Failed to stage installer at: $InstallerOutput"
}

$Staged = Get-Item $InstallerOutput
Write-Host "Staged $($Installer.Name) as $($Staged.FullName)"
Write-Host "Size: $($Staged.Length) bytes"
