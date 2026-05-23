import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAURI_DIR = ROOT / "apps" / "dashboard" / "src-tauri"
CAPABILITIES_DIR = TAURI_DIR / "capabilities"
PERMISSIONS_DIR = TAURI_DIR / "permissions"
LIB_RS = TAURI_DIR / "src" / "lib.rs"

EXPECTED_COMMAND_GROUPS = {
    "dashboard-read-only": {
        "get_app_config",
        "get_character_folder",
        "scan_character_folder",
        "check_for_updates",
        "check_setup_readiness",
        "check_aws_setup_wizard",
        "preview_deployment_start",
    },
    "dashboard-local-file": {
        "save_app_config",
        "open_character_folder",
        "save_character_pack_export",
        "save_character_file",
        "delete_character_file",
    },
    "dashboard-deployment-start": {
        "create_deployment_start_session",
        "start_deployment",
    },
    "dashboard-deployment-end": {
        "create_deployment_end_session",
        "end_deployment",
    },
}

DANGEROUS_COMMANDS = {
    "save_character_pack_export",
    "save_character_file",
    "delete_character_file",
    "start_deployment",
    "end_deployment",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_permission(identifier: str) -> dict:
    return load_json(PERMISSIONS_DIR / f"{identifier}.json")


def load_capability(identifier: str) -> dict:
    return load_json(CAPABILITIES_DIR / f"{identifier}.json")


def permission_allows(permission: dict) -> set[str]:
    permission_set = next(
        (item for item in permission.get("set", []) if item.get("identifier") == permission.get("_identifier")),
        permission.get("set", [{}])[0] if permission.get("set") else {},
    )
    allowed_permissions = set(permission_set.get("permissions", []))
    return {item.removeprefix("allow-").replace("-", "_") for item in allowed_permissions}


def test_dashboard_commands_are_split_into_explicit_tauri_capabilities() -> None:
    assert CAPABILITIES_DIR.is_dir(), "Tauri v2 capabilities must be committed under src-tauri/capabilities."
    assert PERMISSIONS_DIR.is_dir(), "App command permissions must be committed under src-tauri/permissions."

    allowed_by_group = {}
    for identifier, expected_commands in EXPECTED_COMMAND_GROUPS.items():
        permission = load_permission(identifier)
        permission["_identifier"] = identifier
        permission_set = next(item for item in permission.get("set", []) if item.get("identifier") == identifier)
        capability = load_capability(identifier)
        assert permission_set["identifier"] == identifier
        assert capability["identifier"] == identifier
        assert capability.get("local") is True
        assert capability.get("windows") == ["main"]
        assert identifier in capability.get("permissions", [])
        assert permission_allows(permission) == expected_commands
        assert all(entry.startswith("allow-") for entry in permission_set.get("permissions", []))
        allowed_by_group[identifier] = expected_commands

    assert allowed_by_group["dashboard-read-only"].isdisjoint(DANGEROUS_COMMANDS)
    assert allowed_by_group["dashboard-local-file"].isdisjoint({"start_deployment", "end_deployment"})
    assert "start_deployment" not in allowed_by_group["dashboard-deployment-end"]
    assert "end_deployment" not in allowed_by_group["dashboard-deployment-start"]


def test_capabilities_do_not_use_wildcards_or_broad_default_ipc() -> None:
    for path in sorted(CAPABILITIES_DIR.glob("*.json")):
        capability = load_json(path)
        rendered = json.dumps(capability, sort_keys=True)
        assert "*" not in rendered
        assert "all" not in {str(item).lower() for item in capability.get("permissions", [])}
        assert "install_update" not in rendered
        assert "core:default" not in capability.get("permissions", []), "Capabilities should permit only required core/plugin APIs."
        assert "opener:default" not in capability.get("permissions", []), "Do not grant broad opener defaults for app IPC."


def test_dangerous_ipc_options_require_native_session_token() -> None:
    lib_rs = LIB_RS.read_text(encoding="utf-8")
    assert "pub confirmation_token: String" in lib_rs
    assert "create_deployment_start_session" in lib_rs
    assert "create_deployment_end_session" in lib_rs
    assert "validate_and_consume" in lib_rs

    start_body = re.search(r"fn start_deployment\([\s\S]+?\n}\n\n#\[tauri::command\]\nfn end_deployment", lib_rs).group(0)
    end_body = re.search(r"fn end_deployment\([\s\S]+?\n}\n\n#\[cfg\(test\)\]", lib_rs).group(0)
    assert "validate_and_consume" in start_body
    assert "options.confirmation_token" in start_body
    assert "validate_and_consume" in end_body
    assert "options.confirmation_token" in end_body
