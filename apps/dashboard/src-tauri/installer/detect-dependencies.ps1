#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$InstallPath = "$env:LOCALAPPDATA\Programs\CharacterForgeAI",
    [string]$DiskPath = $env:SystemDrive,
    [int]$RequiredFreeGB = 4
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-Status {
    param(
        [Parameter(Mandatory = $true)][bool]$Installed,
        [string]$Version = $null,
        [string]$Path = $null,
        [string]$Source = $null,
        [string]$Message = $null
    )

    [ordered]@{
        installed = $Installed
        version = $Version
        path = $Path
        source = $Source
        message = $Message
    }
}

function Test-AdminStatus {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)

    [ordered]@{
        isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        requiredForPerMachineInstall = $true
    }
}

function Test-SupportedWindowsVersion {
    $minimumBuildNumber = 19041
    $caption = $null
    $version = [System.Environment]::OSVersion.Version.ToString()
    $buildNumber = [int][System.Environment]::OSVersion.Version.Build

    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $caption = $os.Caption
        $version = $os.Version
        $buildNumber = [int]$os.BuildNumber
    } catch {
        $caption = "Windows"
    }

    [ordered]@{
        isSupported = $buildNumber -ge $minimumBuildNumber
        caption = $caption
        version = $version
        buildNumber = $buildNumber
        minimumBuildNumber = $minimumBuildNumber
    }
}

function Get-WebView2Status {
    $registryPaths = @(
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )

    foreach ($registryPath in $registryPaths) {
        try {
            $item = Get-ItemProperty -Path $registryPath -ErrorAction Stop
            if ($item.pv) {
                return [ordered]@{
                    installed = $true
                    version = [string]$item.pv
                    source = $registryPath
                }
            }
        } catch {
            continue
        }
    }

    [ordered]@{
        installed = $false
        version = $null
        source = $null
    }
}

function Get-CommandStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$VersionArguments = @("--version")
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        return New-Status -Installed $false -Message "Not found on PATH"
    }

    $version = $null
    try {
        $output = & $command.Source @VersionArguments 2>$null | Select-Object -First 1
        if ($output) {
            $version = ([string]$output).Trim()
        }
    } catch {
        $version = $null
    }

    New-Status -Installed $true -Version $version -Path $command.Source -Source "PATH"
}

function Get-DockerStatus {
    $status = Get-CommandStatus -Name "docker" -VersionArguments @("--version")
    $running = $false
    $message = $status.message

    if ($status.installed) {
        try {
            & $status.path "info" "--format" "{{json .ServerVersion}}" 2>$null | Out-Null
            $running = $LASTEXITCODE -eq 0
            if (-not $running) {
                $message = "Docker CLI is installed, but the Docker engine is not running."
            }
        } catch {
            $running = $false
            $message = "Docker CLI is installed, but the Docker engine status could not be read."
        }
    }

    [ordered]@{
        installed = $status.installed
        version = $status.version
        path = $status.path
        running = $running
        message = $message
    }
}

function Get-CharacterForgeAIInstallStatus {
    param([Parameter(Mandatory = $true)][string]$InstallPath)

    $candidates = @(
        $InstallPath,
        "$env:ProgramFiles\CharacterForgeAI",
        "${env:ProgramFiles(x86)}\CharacterForgeAI"
    ) | Where-Object { $_ }

    foreach ($candidate in $candidates) {
        $exePath = Join-Path $candidate "CharacterForgeAI.exe"
        if (Test-Path $exePath -PathType Leaf) {
            $version = $null
            try {
                $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exePath).ProductVersion
            } catch {
                $version = $null
            }
            return [ordered]@{
                installed = $true
                version = $version
                installPath = $candidate
                source = "file-system"
            }
        }
    }

    [ordered]@{
        installed = $false
        version = $null
        installPath = $null
        source = $null
    }
}

function Get-DiskSpaceStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$RequiredFreeGB
    )

    $resolvedPath = $Path
    if (-not (Test-Path $resolvedPath)) {
        $resolvedPath = $env:SystemDrive
    }

    $qualifier = Split-Path -Qualifier $resolvedPath
    if (-not $qualifier) {
        $qualifier = $env:SystemDrive
    }

    $driveName = $qualifier.TrimEnd(":")
    $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
    $freeBytes = [int64]$drive.Free
    $freeGB = [math]::Round($freeBytes / 1GB, 2)

    [ordered]@{
        path = $qualifier
        freeBytes = $freeBytes
        freeGB = $freeGB
        requiredFreeGB = $RequiredFreeGB
        hasEnoughSpace = $freeGB -ge $RequiredFreeGB
    }
}

$admin = Test-AdminStatus
$windows = Test-SupportedWindowsVersion
$webview2 = Get-WebView2Status
$awsCli = Get-CommandStatus -Name "aws" -VersionArguments @("--version")
$samCli = Get-CommandStatus -Name "sam" -VersionArguments @("--version")
$docker = Get-DockerStatus
$characterForgeAI = Get-CharacterForgeAIInstallStatus -InstallPath $InstallPath
$diskSpace = Get-DiskSpaceStatus -Path $DiskPath -RequiredFreeGB $RequiredFreeGB

$warnings = New-Object System.Collections.Generic.List[string]
$errors = New-Object System.Collections.Generic.List[string]

if (-not $windows.isSupported) { $errors.Add("Windows build $($windows.buildNumber) is below the supported minimum build $($windows.minimumBuildNumber).") }
if (-not $webview2.installed) { $warnings.Add("Microsoft Edge WebView2 Runtime was not detected.") }
if (-not $awsCli.installed) { $warnings.Add("AWS CLI was not detected; deployment setup will need it later.") }
if (-not $samCli.installed) { $warnings.Add("AWS SAM CLI was not detected; deployment setup will need it later.") }
if (-not $docker.installed) { $warnings.Add("Docker was not detected; local SAM builds may need it later.") }
elseif (-not $docker.running) { $warnings.Add("Docker is installed but not running.") }
if (-not $diskSpace.hasEnoughSpace) { $errors.Add("Not enough free disk space on $($diskSpace.path).") }

$result = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    admin = $admin
    windows = $windows
    webview2 = $webview2
    awsCli = $awsCli
    samCli = $samCli
    docker = $docker
    characterForgeAI = $characterForgeAI
    diskSpace = $diskSpace
    summary = [ordered]@{
        ready = $errors.Count -eq 0
        warnings = @($warnings)
        errors = @($errors)
    }
}

$result | ConvertTo-Json -Depth 8
