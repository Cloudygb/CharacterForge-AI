#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipNpmCi,
    [switch]$SignArtifacts,
    [switch]$ReleaseMode,
    [string]$SigningConfigPath
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

function Import-SigningConfig {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path $Path -PathType Leaf)) {
        throw "Signing configuration not found: $Path"
    }

    $config = Import-PowerShellDataFile -Path $Path
    foreach ($requiredKey in @("SignToolPath", "TimestampUrl", "ExpectedPublisher")) {
        if (-not $config.ContainsKey($requiredKey) -or [string]::IsNullOrWhiteSpace([string]$config[$requiredKey]) -or ([string]$config[$requiredKey]) -like "<*") {
            throw "Signing configuration must define a real $requiredKey. Use scripts\code-signing.example.psd1 as the placeholder template."
        }
    }

    $hasThumbprint = $config.ContainsKey("CertificateThumbprint") -and
        -not [string]::IsNullOrWhiteSpace([string]$config["CertificateThumbprint"]) -and
        ([string]$config["CertificateThumbprint"]) -notlike "<*"
    $hasSubject = $config.ContainsKey("CertificateSubject") -and
        -not [string]::IsNullOrWhiteSpace([string]$config["CertificateSubject"]) -and
        ([string]$config["CertificateSubject"]) -notlike "<*"

    if (-not ($hasThumbprint -or $hasSubject)) {
        throw "Signing configuration must provide a real CertificateThumbprint or CertificateSubject before -SignArtifacts can run."
    }

    return $config
}

function Invoke-Code-Signing {
    param(
        [Parameter(Mandatory = $true)][string]$ArtifactPath,
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [switch]$RequireVerification
    )

    if (-not (Test-Path $ArtifactPath -PathType Leaf)) {
        throw "Signing artifact not found: $ArtifactPath"
    }

    $signToolPath = [string]$Config["SignToolPath"]
    if ($signToolPath -eq "signtool") {
        Assert-Command "signtool"
    } elseif (-not (Test-Path $signToolPath -PathType Leaf)) {
        throw "signtool path not found: $signToolPath"
    }

    $arguments = @(
        "sign",
        "/fd", "SHA256",
        "/td", "SHA256",
        "/tr", [string]$Config["TimestampUrl"]
    )

    if ($Config.ContainsKey("CertificateThumbprint") -and
        -not [string]::IsNullOrWhiteSpace([string]$Config["CertificateThumbprint"]) -and
        ([string]$Config["CertificateThumbprint"]) -notlike "<*") {
        $arguments += @("/sha1", [string]$Config["CertificateThumbprint"])
    } elseif ($Config.ContainsKey("CertificateSubject") -and
        -not [string]::IsNullOrWhiteSpace([string]$Config["CertificateSubject"]) -and
        ([string]$Config["CertificateSubject"]) -notlike "<*") {
        $arguments += @("/n", [string]$Config["CertificateSubject"])
    }

    if ($Config.ContainsKey("AdditionalSignToolArgs")) {
        $arguments += @($Config["AdditionalSignToolArgs"])
    }

    $arguments += $ArtifactPath

    Invoke-Checked $signToolPath @arguments

    if (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue) {
        $signature = Get-AuthenticodeSignature -LiteralPath $ArtifactPath
        if ($signature.Status -ne "Valid") {
            throw "Signature verification failed for $ArtifactPath. Status: $($signature.Status)"
        }

        $expectedPublisher = [string]$Config["ExpectedPublisher"]
        $actualPublisher = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { "" }
        if ($actualPublisher -notlike "*$expectedPublisher*") {
            throw "Signer publisher mismatch for $ArtifactPath. Expected publisher '$expectedPublisher'; got '$actualPublisher'."
        }

        if (-not $signature.TimeStamperCertificate) {
            throw "Timestamp signature is required for $ArtifactPath."
        }

        Write-Host "Signature verified for $ArtifactPath"
    } else {
        if ($RequireVerification) {
            throw "Release signing verification requires Get-AuthenticodeSignature on this host."
        }
        Write-Host "Get-AuthenticodeSignature is not available; skipped local signature verification for $ArtifactPath"
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
$ReleaseDir = Join-Path $TauriDir "target\release"
# Expected Tauri NSIS output folder: target\release\bundle\nsis
$NsisDir = Join-Path $ReleaseDir "bundle\nsis"
$AppExecutable = Join-Path $ReleaseDir "CharacterForgeAI.exe"
$DistDir = Join-Path $RepoRoot "dist"
$InstallerOutput = Join-Path $DistDir "characterforgeai-installer.exe"
$ReleaseManifestJson = Join-Path $DistDir "release-manifest.json"
$ReleaseManifestMarkdown = Join-Path $DistDir "release-manifest.md"
$InstallerVerificationJson = Join-Path $DistDir "installer-verification.json"
$DashboardPackageJson = Join-Path $DashboardDir "package.json"

if (-not $SigningConfigPath) {
    if ($ReleaseMode) {
        throw "Release mode requires a signing configuration path with certificate, timestamp URL, and expected publisher."
    }
    $SigningConfigPath = Join-Path $ScriptDir "code-signing.example.psd1"
}

if ($ReleaseMode -and -not $SignArtifacts) {
    throw "Release mode requires -SignArtifacts so unsigned installers cannot be staged as public releases."
}

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

$signingConfig = $null
if ($SignArtifacts) {
    Write-Step "Loading code-signing configuration"
    $signingConfig = Import-SigningConfig -Path $SigningConfigPath
}

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

if ($SignArtifacts) {
    Write-Step "Signing CharacterForgeAI.exe"
    Invoke-Code-Signing -ArtifactPath $AppExecutable -Config $signingConfig -RequireVerification:$ReleaseMode
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

if ($SignArtifacts) {
    Write-Step "Signing characterforgeai-installer.exe"
    Invoke-Code-Signing -ArtifactPath $InstallerOutput -Config $signingConfig -RequireVerification:$ReleaseMode
}

if ($ReleaseMode) {
    Write-Step "Verifying signed release installer"
    $verificationArguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $ScriptDir "verify-windows-installer.ps1"),
        "-InstallerPath", $InstallerOutput,
        "-SkipInstalledArtifacts",
        "-ReleaseMode",
        "-ExpectedPublisher", ([string]$signingConfig["ExpectedPublisher"]),
        "-Json"
    )
    Write-Host "> powershell $($verificationArguments -join ' ')"
    $verificationJson = & powershell @verificationArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: powershell $($verificationArguments -join ' ')"
    }
    $verificationJson | Out-File $InstallerVerificationJson -Encoding utf8

    Write-Step "Generating release manifest from signed artifact"
    $package = Get-Content -LiteralPath $DashboardPackageJson -Raw | ConvertFrom-Json
    Invoke-Checked "node" (Join-Path $ScriptDir "generate-release-manifest.mjs") "--artifact" $InstallerOutput "--version" ([string]$package.version) "--signature-json" $InstallerVerificationJson "--output" $ReleaseManifestJson "--markdown-output" $ReleaseManifestMarkdown
}

$Staged = Get-Item $InstallerOutput
Write-Host "Staged $($Installer.Name) as $($Staged.FullName)"
Write-Host "Size: $($Staged.Length) bytes"
if ($SignArtifacts) {
    Write-Host "Signing was enabled for CharacterForgeAI.exe and characterforgeai-installer.exe"
}
