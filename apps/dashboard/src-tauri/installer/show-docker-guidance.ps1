#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$LogPath = (Join-Path $env:TEMP "CharacterForgeAI\docker-guidance.log")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ToolName = "docker-desktop"
$InstallUrl = "https://docs.docker.com/desktop/setup/install/windows-install/"

$EXIT_SUCCESS = 0
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

function Get-DockerStatus {
    $command = Get-Command docker -ErrorAction SilentlyContinue
    $installed = $false
    $running = $false
    $version = $null
    $path = $null

    if ($command) {
        $installed = $true
        $path = $command.Source
        try {
            # Equivalent user-facing check: docker --version
            $versionOutput = & $command.Source --version 2>$null | Select-Object -First 1
            if ($versionOutput) { $version = ([string]$versionOutput).Trim() }
        } catch {
            $version = $null
        }

        try {
            # Equivalent engine check: docker info
            & $command.Source info --format "{{json .ServerVersion}}" 2>$null | Out-Null
            $running = $LASTEXITCODE -eq 0
        } catch {
            $running = $false
        }
    }

    [ordered]@{
        installed = $installed
        running = $running
        version = $version
        path = $path
    }
}

try {
    Write-CharacterForgeAILog "Starting Docker Desktop guided-install check. Dry-run: $([bool]$DryRun)."
    $docker = Get-DockerStatus
    $message = if ($docker.installed -and $docker.running) {
        "Docker Desktop is installed and running."
    } elseif ($docker.installed) {
        "Docker Desktop appears to be installed, but the engine is not running. Start Docker Desktop before local SAM builds."
    } else {
        "Docker Desktop was not detected. Install Docker Desktop from the official Docker Windows installation guide, then restart CharacterForgeAI setup."
    }

    if ($DryRun) {
        Write-CharacterForgeAILog "Dry-run guided-install mode: no Docker installer was downloaded or launched."
    } else {
        Write-CharacterForgeAILog "Docker guided-install message prepared. User should open official Docker documentation manually."
    }

    [ordered]@{
        schemaVersion = 1
        tool = $ToolName
        dryRun = [bool]$DryRun
        exitCode = $EXIT_SUCCESS
        installUrl = $InstallUrl
        logPath = $LogPath
        installed = $docker.installed
        running = $docker.running
        version = $docker.version
        path = $docker.path
        message = $message
    } | ConvertTo-Json -Depth 6
    exit $EXIT_SUCCESS
} catch {
    Write-CharacterForgeAILog "Unexpected Docker guided-install failure."
    [ordered]@{
        schemaVersion = 1
        tool = $ToolName
        dryRun = [bool]$DryRun
        exitCode = $EXIT_UNEXPECTED_ERROR
        installUrl = $InstallUrl
        logPath = $LogPath
        installed = $false
        running = $false
        version = $null
        path = $null
        message = "Unexpected failure while preparing Docker guidance."
    } | ConvertTo-Json -Depth 6
    exit $EXIT_UNEXPECTED_ERROR
}
