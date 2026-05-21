#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$LogPath = (Join-Path $env:TEMP "CharacterForgeAI\install-webview2-runtime.log"),
    [string]$DownloadDirectory = (Join-Path $env:TEMP "CharacterForgeAI\downloads")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ToolName = "webview2-runtime"
$DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
$InstallerFileName = "MicrosoftEdgeWebView2RuntimeInstaller.exe"

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
        [string]$InstallerPath = $null
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
        wouldDownload = [bool]$DryRun
        wouldInstall = [bool]$DryRun
        installerPath = $InstallerPath
    }
}

try {
    Write-CharacterForgeAILog "Starting $ToolName installer helper. Dry-run: $([bool]$DryRun)."

    if ($DryRun) {
        Write-CharacterForgeAILog "Dry-run mode: would download WebView2 Runtime from official Microsoft HTTPS source and run silent installer."
        New-Result -ExitCode $EXIT_SUCCESS -Message "Dry-run completed; no download or install was performed." | ConvertTo-Json -Depth 6
        exit $EXIT_SUCCESS
    }

    if (-not (Test-Path $DownloadDirectory)) {
        New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
    }

    $installerPath = Join-Path $DownloadDirectory $InstallerFileName
    Write-CharacterForgeAILog "Downloading $ToolName from official HTTPS source."
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $installerPath -UseBasicParsing -ErrorAction Stop
    } catch {
        Write-CharacterForgeAILog "Download failed for $ToolName."
        New-Result -ExitCode $EXIT_DOWNLOAD_FAILED -Message "Download failed." -InstallerPath $installerPath | ConvertTo-Json -Depth 6
        exit $EXIT_DOWNLOAD_FAILED
    }

    Write-CharacterForgeAILog "Running $ToolName silent installer."
    $process = Start-Process -FilePath $installerPath -ArgumentList @('/silent', '/install') -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        Write-CharacterForgeAILog "Installer exited with code $($process.ExitCode)."
        New-Result -ExitCode $EXIT_INSTALL_FAILED -Message "Installer failed." -Downloaded $true -InstallerPath $installerPath | ConvertTo-Json -Depth 6
        exit $EXIT_INSTALL_FAILED
    }

    Write-CharacterForgeAILog "$ToolName installation completed."
    New-Result -ExitCode $EXIT_SUCCESS -Message "Installation completed." -Downloaded $true -Installed $true -InstallerPath $installerPath | ConvertTo-Json -Depth 6
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
