#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$LogPath = (Join-Path $env:TEMP "CharacterForgeAI\install-aws-cli-v2.log"),
    [string]$DownloadDirectory = (Join-Path $env:TEMP "CharacterForgeAI\downloads")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ToolName = "aws-cli-v2"
$DownloadUrl = "https://awscli.amazonaws.com/AWSCLIV2.msi"
$InstallerFileName = "AWSCLIV2.msi"

$EXIT_SUCCESS = 0
$EXIT_INVALID_ARGUMENTS = 2
$EXIT_DOWNLOAD_FAILED = 10
$EXIT_INSTALL_FAILED = 20
$EXIT_UNEXPECTED_ERROR = 99

function Redact-SensitiveValue {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) { return $null }
    return ($Value -replace '(?i)(key|credential|bearer|authorization)=\S+', '$1=[REDACTED]' -replace '[A-Za-z0-9+/=]{32,}', '[REDACTED]')
}

function Write-CharacterForgeAILog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $directory = Split-Path -Parent $LogPath
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Add-Content -Path $LogPath -Encoding UTF8 -Value "[$timestamp] $(Redact-SensitiveValue $Message)"
}

function New-Result {
    param(
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [Parameter(Mandatory = $true)][string]$Message,
        [bool]$Downloaded = $false,
        [bool]$Installed = $false,
        [string]$InstallerPath = $null,
        [AllowNull()][object]$InstallerExitCode = $null,
        [string]$DetectedPath = $null,
        [string]$DetectedVersion = $null
    )
    [ordered]@{
        schemaVersion = 1
        tool = $ToolName
        dryRun = [bool]$DryRun
        exitCode = $ExitCode
        message = $Message
        downloadUrl = $DownloadUrl
        logPath = $LogPath
        downloaded = $Downloaded
        installed = $Installed
        alreadyInstalled = $Installed -and -not $Downloaded
        wouldDownload = [bool]$DryRun
        wouldInstall = [bool]$DryRun
        installerPath = $InstallerPath
        installerExitCode = $InstallerExitCode
        detectedPath = $DetectedPath
        detectedVersion = $DetectedVersion
    }
}

function Test-DependencyInstalled {
    $candidates = New-Object System.Collections.Generic.List[string]
    $command = Get-Command aws -ErrorAction SilentlyContinue
    if ($command) { $candidates.Add($command.Source) }
    foreach ($path in @(
        "$env:ProgramFiles\Amazon\AWSCLIV2\aws.exe",
        "${env:ProgramFiles(x86)}\Amazon\AWSCLIV2\aws.exe"
    )) {
        if ($path -and (Test-Path $path -PathType Leaf)) { $candidates.Add($path) }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        try {
            $version = (& $candidate --version 2>&1 | Select-Object -First 1).ToString().Trim()
            return [ordered]@{ installed = $true; path = $candidate; version = $version }
        } catch {
            return [ordered]@{ installed = $true; path = $candidate; version = $null }
        }
    }

    [ordered]@{ installed = $false; path = $null; version = $null }
}

function Assert-InstallerSignature {
    param([Parameter(Mandatory = $true)][string]$Path)
    $signature = Get-AuthenticodeSignature -FilePath $Path
    if ($signature.Status -ne 'Valid') {
        throw "Signature verification failed for downloaded installer: $($signature.Status)"
    }
    Write-CharacterForgeAILog "Downloaded installer signature verified."
}

try {
    Write-CharacterForgeAILog "Starting $ToolName installer helper. Dry-run: $([bool]$DryRun)."

    if ($DryRun) {
        Write-CharacterForgeAILog "Dry-run mode: would download AWS CLI v2 from official AWS HTTPS source and run quiet MSI install."
        New-Result -ExitCode $EXIT_SUCCESS -Message "Dry-run completed; no download or install was performed." | ConvertTo-Json -Depth 6
        exit $EXIT_SUCCESS
    }

    $existing = Test-DependencyInstalled
    if ($existing.installed) {
        Write-CharacterForgeAILog "$ToolName already installed; skipping download and install."
        New-Result -ExitCode $EXIT_SUCCESS -Message "Already installed; skipping download and install." -Installed $true -DetectedPath $existing.path -DetectedVersion $existing.version | ConvertTo-Json -Depth 6
        exit $EXIT_SUCCESS
    }

    if (-not (Test-Path $DownloadDirectory)) {
        New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
    }

    $installerPath = Join-Path $DownloadDirectory $InstallerFileName
    $msiLogPath = Join-Path $DownloadDirectory "AWSCLIV2-msi.log"
    Write-CharacterForgeAILog "Downloading $ToolName from official HTTPS source."
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $installerPath -UseBasicParsing -ErrorAction Stop
        Assert-InstallerSignature -Path $installerPath
    } catch {
        Write-CharacterForgeAILog "Download failed for $ToolName."
        New-Result -ExitCode $EXIT_DOWNLOAD_FAILED -Message "Download failed." -InstallerPath $installerPath | ConvertTo-Json -Depth 6
        exit $EXIT_DOWNLOAD_FAILED
    }

    Write-CharacterForgeAILog "Running $ToolName quiet MSI installer. MSI log: $msiLogPath"
    $arguments = @('/i', $installerPath, '/qn', '/norestart', '/L*v', $msiLogPath)
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru
    $afterInstall = Test-DependencyInstalled
    if ($process.ExitCode -ne 0 -and -not $afterInstall.installed) {
        Write-CharacterForgeAILog "Installer exited with code $($process.ExitCode). MSI log: $msiLogPath"
        New-Result -ExitCode $EXIT_INSTALL_FAILED -Message "Installer failed." -Downloaded $true -InstallerPath $installerPath -InstallerExitCode $process.ExitCode | ConvertTo-Json -Depth 6
        exit $EXIT_INSTALL_FAILED
    }

    Write-CharacterForgeAILog "$ToolName installation completed."
    New-Result -ExitCode $EXIT_SUCCESS -Message "Installation completed." -Downloaded $true -Installed $true -InstallerPath $installerPath -InstallerExitCode $process.ExitCode -DetectedPath $afterInstall.path -DetectedVersion $afterInstall.version | ConvertTo-Json -Depth 6
    exit $EXIT_SUCCESS
} catch [System.Management.Automation.ParameterBindingException] {
    Write-CharacterForgeAILog "Invalid arguments supplied."
    New-Result -ExitCode $EXIT_INVALID_ARGUMENTS -Message "Invalid arguments." | ConvertTo-Json -Depth 6
    exit $EXIT_INVALID_ARGUMENTS
} catch {
    Write-CharacterForgeAILog "Unexpected installer helper failure."
    New-Result -ExitCode $EXIT_UNEXPECTED_ERROR -Message "Unexpected failure." | ConvertTo-Json -Depth 6
    exit $EXIT_UNEXPECTED_ERROR
}
