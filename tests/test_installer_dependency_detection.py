import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "apps" / "dashboard" / "src-tauri" / "installer"
SCRIPT = INSTALLER / "detect-dependencies.ps1"
SAMPLE = INSTALLER / "samples" / "dependency-detection.sample.json"


def test_dependency_detection_script_covers_required_checks_without_installing() -> None:
    script = SCRIPT.read_text(encoding="utf-8")
    normalized = script.lower()

    assert "#requires -version 5.1" in normalized
    assert "convertto-json" in normalized
    assert "test-adminstatus" in normalized
    assert "test-supportedwindowsversion" in normalized
    assert "get-webview2status" in normalized
    assert "get-commandstatus" in normalized
    assert "aws" in normalized
    assert "sam" in normalized
    assert "docker" in normalized
    assert "get-dockerstatus" in normalized
    assert "get-characterforgeaiinstallstatus" in normalized
    assert "get-diskspacestatus" in normalized

    forbidden_install_actions = [
        "start-process msiexec",
        "winget install",
        "choco install",
        "npm install",
        "sam deploy",
        "aws cloudformation",
        "docker run",
    ]
    for forbidden in forbidden_install_actions:
        assert forbidden not in normalized


def test_sample_dependency_detection_json_has_stable_contract() -> None:
    data = json.loads(SAMPLE.read_text(encoding="utf-8"))

    assert data["schemaVersion"] == 1
    assert data["generatedAtUtc"].endswith("Z")
    assert set(data) >= {
        "schemaVersion",
        "generatedAtUtc",
        "admin",
        "windows",
        "webview2",
        "awsCli",
        "samCli",
        "docker",
        "characterForgeAI",
        "diskSpace",
        "summary",
    }

    assert set(data["admin"]) >= {"isAdmin", "requiredForPerMachineInstall"}
    assert set(data["windows"]) >= {"isSupported", "caption", "version", "buildNumber", "minimumBuildNumber"}
    assert set(data["webview2"]) >= {"installed", "version", "source"}
    assert set(data["awsCli"]) >= {"installed", "version", "path"}
    assert set(data["samCli"]) >= {"installed", "version", "path"}
    assert set(data["docker"]) >= {"installed", "version", "path", "running"}
    assert set(data["characterForgeAI"]) >= {"installed", "version", "installPath", "source"}
    assert set(data["diskSpace"]) >= {"path", "freeBytes", "freeGB", "requiredFreeGB", "hasEnoughSpace"}
    assert set(data["summary"]) >= {"ready", "warnings", "errors"}

    assert isinstance(data["summary"]["warnings"], list)
    assert isinstance(data["summary"]["errors"], list)


def test_sample_dependency_detection_json_is_safe_placeholder_data() -> None:
    raw = SAMPLE.read_text(encoding="utf-8").lower()

    assert "secret" not in raw
    assert "access_key" not in raw
    assert "session_token" not in raw
    assert "password" not in raw
    assert "token" not in raw
    assert "cloudformation" not in raw
    assert "arn:" not in raw
