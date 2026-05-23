import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "apps" / "dashboard" / "src-tauri" / "installer"

INSTALL_SCRIPTS = {
    "webview2": INSTALLER / "install-webview2-runtime.ps1",
    "aws_cli": INSTALLER / "install-aws-cli-v2.ps1",
    "sam_cli": INSTALLER / "install-aws-sam-cli.ps1",
}
DOCKER_GUIDANCE = INSTALLER / "show-docker-guidance.ps1"

OFFICIAL_URLS = {
    "webview2": "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
    "aws_cli": "https://awscli.amazonaws.com/AWSCLIV2.msi",
    "sam_cli": "https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi",
    "docker_docs": "https://docs.docker.com/desktop/setup/install/windows-install/",
}

EXIT_CODES = {
    "success": 0,
    "invalid_arguments": 2,
    "download_failed": 10,
    "install_failed": 20,
    "unexpected_error": 99,
}


def _powershell_exe() -> str | None:
    # Prefer native Linux PowerShell when present because it understands WSL paths.
    native = shutil.which("pwsh") or shutil.which("powershell")
    if native:
        return native
    windows_powershell = Path("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
    if windows_powershell.exists():
        return str(windows_powershell)
    return None


def _for_powershell(ps: str, path: Path) -> str:
    if ps.startswith("/mnt/c/Windows/"):
        converted = subprocess.run(["wslpath", "-w", str(path)], text=True, capture_output=True, check=True)
        return converted.stdout.strip()
    return str(path)


def _log_path_for_powershell(ps: str, requested: Path) -> Path:
    if ps.startswith("/mnt/c/Windows/"):
        log_dir = ROOT / ".pytest-installer-logs"
        log_dir.mkdir(exist_ok=True)
        return log_dir / requested.name
    return requested


def _run_dry_run(script: Path, log_path: Path) -> tuple[dict, Path]:
    ps = _powershell_exe()
    if ps is None:
        pytest.skip("PowerShell is not available for dry-run behavior test")

    actual_log_path = _log_path_for_powershell(ps, log_path)
    if actual_log_path.exists():
        actual_log_path.unlink()

    command = [
        ps,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        _for_powershell(ps, script),
        "-DryRun",
        "-LogPath",
        _for_powershell(ps, actual_log_path),
    ]
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=30)
    assert completed.returncode == EXIT_CODES["success"], completed.stderr + completed.stdout
    assert completed.stderr.strip() == ""
    return json.loads(completed.stdout), actual_log_path


def test_prerequisite_installer_scripts_use_official_https_sources_and_stable_exit_codes() -> None:
    for name, script_path in INSTALL_SCRIPTS.items():
        script = script_path.read_text(encoding="utf-8")
        normalized = script.lower()

        assert "#requires -version 5.1" in normalized
        assert "[switch]$dryrun" in normalized
        assert "characterforgeai" in normalized
        assert "write-characterforgeailog" in normalized
        assert OFFICIAL_URLS[name].lower() in normalized
        assert "$exit_success = 0" in normalized
        assert "$exit_invalid_arguments = 2" in normalized
        assert "$exit_download_failed = 10" in normalized
        assert "$exit_install_failed = 20" in normalized
        assert "$exit_unexpected_error = 99" in normalized
        assert "invoke-webrequest" in normalized
        assert "assert-installersignature" in normalized
        assert "get-authenticodesignature" in normalized
        assert "signature verification failed" in normalized
        signature_check_position = normalized.index("assert-installersignature -path $installerpath")
        assert normalized.index("invoke-webrequest") < signature_check_position < normalized.index("start-process")
        assert "start-process" in normalized
        assert "convertto-json" in normalized
        assert "redact-sensitivevalue" in normalized

        forbidden = [
            "http://",
            "access_key",
            "secret_access_key",
            "session_token",
            "password",
            "aws configure",
            "sam deploy",
            "aws cloudformation",
            "docker run",
        ]
        for term in forbidden:
            assert term not in normalized


def test_prerequisite_installers_check_existing_tools_before_download_or_install() -> None:
    for name, script_path in INSTALL_SCRIPTS.items():
        script = script_path.read_text(encoding="utf-8")
        normalized = script.lower()

        assert "test-dependencyinstalled" in normalized
        assert "already installed; skipping download and install." in normalized
        assert "installerexitcode" in normalized
        assert "msi log" in normalized or "installer log" in normalized

        precheck_position = normalized.index("test-dependencyinstalled")
        download_position = normalized.index("invoke-webrequest")
        install_position = normalized.index("start-process")
        assert precheck_position < download_position < install_position, name


def test_nsis_prerequisite_helpers_check_return_codes_and_fail_only_required_helpers() -> None:
    nsis = (INSTALLER / "characterforgeai.nsh").read_text(encoding="utf-8")

    helper_scripts = [
        "detect-dependencies.ps1",
        "install-webview2-runtime.ps1",
        "install-aws-cli-v2.ps1",
        "install-aws-sam-cli.ps1",
        "show-docker-guidance.ps1",
    ]
    for helper_script in helper_scripts:
        exec_position = nsis.index(f'nsExec::ExecToLog \'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\\{helper_script}"')
        following_hook = nsis[exec_position : exec_position + 700]
        assert "Pop $CFAI_PrerequisiteHelperExitCode" in following_hook, helper_script
        assert "CFAI_RecordPrerequisiteHelperResult" in following_hook, helper_script

    assert 'CFAI_RecordPrerequisiteHelperResult "WebView2 Runtime" $CFAI_PrerequisiteHelperExitCode "1"' in nsis
    assert 'CFAI_RecordPrerequisiteHelperResult "AWS CLI v2" $CFAI_PrerequisiteHelperExitCode "1"' in nsis
    assert 'CFAI_RecordPrerequisiteHelperResult "AWS SAM CLI" $CFAI_PrerequisiteHelperExitCode "1"' in nsis
    assert 'CFAI_RecordPrerequisiteHelperResult "Docker Desktop guidance" $CFAI_PrerequisiteHelperExitCode "0"' in nsis
    assert "MessageBox MB_ICONSTOP" in nsis
    assert "Abort" in nsis
    assert "MessageBox MB_ICONEXCLAMATION" in nsis
    assert "required prerequisite helper failed" in nsis
    assert "optional prerequisite helper warning" in nsis


def test_docker_guidance_script_detects_and_guides_without_installing_docker() -> None:
    script = DOCKER_GUIDANCE.read_text(encoding="utf-8")
    normalized = script.lower()

    assert "#requires -version 5.1" in normalized
    assert "[switch]$dryrun" in normalized
    assert "get-dockerstatus" in normalized
    assert "docker --version" in normalized
    assert "docker info" in normalized
    assert OFFICIAL_URLS["docker_docs"].lower() in normalized
    assert "characterforgeai" in normalized
    assert "convertto-json" in normalized
    assert "$exit_success = 0" in normalized
    assert "$exit_unexpected_error = 99" in normalized

    forbidden_installers = [
        "invoke-webrequest",
        "start-process",
        "winget install",
        "choco install",
        "docker run",
    ]
    for term in forbidden_installers:
        assert term not in normalized


def test_prerequisite_installer_dry_run_outputs_json_and_logs_without_downloads(tmp_path: Path) -> None:
    for name, script_path in INSTALL_SCRIPTS.items():
        log_path = tmp_path / f"{name}.log"
        output, actual_log_path = _run_dry_run(script_path, log_path)

        assert output["schemaVersion"] == 1
        assert output["tool"] in {"webview2-runtime", "aws-cli-v2", "aws-sam-cli"}
        assert output["dryRun"] is True
        assert output["exitCode"] == EXIT_CODES["success"]
        assert output["downloadUrl"] == OFFICIAL_URLS[name]
        if _powershell_exe() and _powershell_exe().startswith("/mnt/c/Windows/"):
            assert output["logPath"].endswith(actual_log_path.name)
        else:
            assert output["logPath"] == str(actual_log_path)
        assert output["downloaded"] is False
        assert output["installed"] is False
        assert output["wouldDownload"] is True
        assert output["wouldInstall"] is True

        log = actual_log_path.read_text(encoding="utf-8").lower()
        assert "dry-run" in log
        assert "secret" not in log
        assert "access_key" not in log
        assert "session_token" not in log
        assert "password" not in log


def test_docker_guidance_dry_run_outputs_json_and_logs_without_installing(tmp_path: Path) -> None:
    log_path = tmp_path / "docker-guidance.log"
    output, actual_log_path = _run_dry_run(DOCKER_GUIDANCE, log_path)

    assert output["schemaVersion"] == 1
    assert output["tool"] == "docker-desktop"
    assert output["dryRun"] is True
    assert output["exitCode"] == EXIT_CODES["success"]
    assert output["installUrl"] == OFFICIAL_URLS["docker_docs"]
    if _powershell_exe() and _powershell_exe().startswith("/mnt/c/Windows/"):
        assert output["logPath"].endswith(actual_log_path.name)
    else:
        assert output["logPath"] == str(actual_log_path)
    assert output["installed"] in {True, False}
    assert output["running"] in {True, False}
    assert "Docker Desktop" in output["message"]

    log = actual_log_path.read_text(encoding="utf-8").lower()
    assert "guided-install" in log
    assert "winget install" not in log
    assert "choco install" not in log
