from __future__ import annotations

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
PENDING_REASON_PREFIX = "Audit gate pending remediation"


def _pending_gate(gate: str) -> str:
    return f"{PENDING_REASON_PREFIX}: {gate}"


@pytest.mark.xfail(reason=_pending_gate("auth required"))
def test_auth_required_for_production_api_routes() -> None:
    """auth required: production API routes must reject unauthenticated calls."""
    pytest.fail("Replace this placeholder with an authentication regression test.")


@pytest.mark.xfail(reason=_pending_gate("object auth"))
def test_object_auth_prevents_cross_character_or_session_access() -> None:
    """object auth: callers must not access another principal's character/session data."""
    pytest.fail("Replace this placeholder with an object authorization regression test.")


@pytest.mark.xfail(reason=_pending_gate("no wildcard production CORS"))
def test_no_wildcard_production_cors() -> None:
    """no wildcard production CORS: production responses/templates must not allow any origin."""
    pytest.fail("Replace this placeholder with a production CORS regression test.")


def test_desktop_csp_non_null() -> None:
    """CSP non-null: desktop/Tauri configuration must enforce a real Content Security Policy."""
    security_tests = (ROOT / "tests" / "test_tauri_security_config.py").read_text(encoding="utf-8")

    assert "test_production_tauri_csp_is_strict_and_not_null" in security_tests
    assert "test_production_tauri_csp_does_not_allow_broad_remote_origins" in security_tests
    assert "test_production_tauri_csp_does_not_embed_live_endpoints_or_credentials" in security_tests


def test_installer_signing_required_for_release_builds() -> None:
    """installer signing required: release installers must be signed or release verification must fail."""
    release_tests = (ROOT / "tests" / "test_installer_release_verification.py").read_text(encoding="utf-8")

    assert "test_release_build_requires_signing_certificate_timestamp_publisher_and_verification" in release_tests
    assert "test_release_verifier_fails_unsigned_unknown_or_untrusted_signatures" in release_tests
    assert "test_public_readme_does_not_normalize_smartscreen_bypass_for_release_builds" in release_tests


def test_updater_is_real_or_disabled_in_release_ui() -> None:
    """updater real-or-disabled: release UI must not expose placeholder update controls."""
    app_source = (ROOT / "apps" / "dashboard" / "src" / "App.tsx").read_text(encoding="utf-8")
    app_tests = (ROOT / "apps" / "dashboard" / "src" / "App.test.tsx").read_text(encoding="utf-8")

    assert "Check for updates" not in app_source
    assert "Update Now" not in app_source
    assert "Manual updates only" in app_source
    assert "signed auto-update infrastructure is not configured" in app_source
    assert "check_for_updates" not in app_source
    assert "install_update" not in app_source
    assert "keeps updater controls hidden" in app_tests


def test_start_end_requires_user_typed_confirmation() -> None:
    """typed Start/End confirmation: destructive deployment actions require user-entered confirmation."""
    ipc_tests = (ROOT / "tests" / "test_tauri_ipc_permissions.py").read_text(encoding="utf-8")
    assert "test_dangerous_ipc_options_require_native_session_token" in ipc_tests
    assert "test_dashboard_commands_are_split_into_explicit_tauri_capabilities" in ipc_tests


def test_release_installers_block_normal_downgrades() -> None:
    """downgrades blocked: release installer config must prevent vulnerable rollback."""
    packaging_tests = (ROOT / "tests" / "test_dashboard_tauri_packaging.py").read_text(encoding="utf-8")
    tauri_config = (ROOT / "apps" / "dashboard" / "src-tauri" / "tauri.conf.json").read_text(
        encoding="utf-8"
    )

    assert "test_tauri_release_installers_block_normal_downgrades" in packaging_tests
    assert '"allowDowngrades": false' in tauri_config
    assert '"allowDowngrades": true' not in tauri_config


def test_prerequisite_helpers_check_exit_codes() -> None:
    """prerequisite helper exit-code handling: NSIS must inspect helper return codes."""
    prerequisite_tests = (ROOT / "tests" / "test_installer_prerequisite_installers.py").read_text(encoding="utf-8")

    assert "test_nsis_prerequisite_helpers_check_return_codes_and_fail_only_required_helpers" in prerequisite_tests
    assert "Pop $CFAI_PrerequisiteHelperExitCode" in prerequisite_tests
    assert "required prerequisite helper failed" in prerequisite_tests
    assert "optional prerequisite helper warning" in prerequisite_tests


def test_prerequisite_installer_metadata_is_pinned() -> None:
    """prerequisite installer metadata pinning: elevated downloads must be deterministic and auditable."""
    prerequisite_tests = (ROOT / "tests" / "test_installer_prerequisite_installers.py").read_text(encoding="utf-8")

    assert "test_prerequisite_installer_scripts_use_pinned_versions_hashes_publishers_and_update_notes" in prerequisite_tests
    assert "$ExpectedSha256" in prerequisite_tests
    assert "$ExpectedSignerPublisher" in prerequisite_tests
    assert "latest/download" in prerequisite_tests
    assert "fwlink" in prerequisite_tests


def test_installer_scope_and_format_is_implemented() -> None:
    """installer scope and format: release builds use one current-user NSIS installer policy."""
    packaging_tests = (ROOT / "tests" / "test_dashboard_tauri_packaging.py").read_text(encoding="utf-8")
    tauri_config = (ROOT / "apps" / "dashboard" / "src-tauri" / "tauri.conf.json").read_text(
        encoding="utf-8"
    )

    assert "test_windows_release_installer_policy_is_current_user_nsis_only_and_documented" in packaging_tests
    assert '"targets": [\n      "nsis"\n    ]' in tauri_config
    assert '"installMode": "currentUser"' in tauri_config
    assert '"msi"' not in tauri_config
    assert '"perMachine"' not in tauri_config


def test_uninstall_data_cleanup_is_opt_in_and_targets_real_appdata_paths() -> None:
    """uninstall data cleanup: uninstaller must target real app data and preserve characters by default."""
    packaging_tests = (ROOT / "tests" / "test_dashboard_tauri_packaging.py").read_text(encoding="utf-8")
    nsis_hook = (ROOT / "apps" / "dashboard" / "src-tauri" / "installer" / "characterforgeai.nsh").read_text(encoding="utf-8")

    assert "test_uninstaller_cleanup_targets_actual_appdata_paths_and_preserves_characters_by_default" in packaging_tests
    assert '$APPDATA\\CharacterForgeAI' in nsis_hook
    assert '${CFAI_APP_DATA_DIR}\\config.json' in nsis_hook
    assert '${CFAI_APP_DATA_DIR}\\cache' in nsis_hook
    assert '${CFAI_APP_DATA_DIR}\\characters' in nsis_hook
    assert 'StrCpy $CFAI_RemoveLocalConfigCache "0"' in nsis_hook
    assert 'StrCpy $CFAI_RemoveUserCharacters "0"' in nsis_hook


@pytest.mark.xfail(reason=_pending_gate("OpenAPI auth responses"))
def test_openapi_documents_auth_error_and_rate_limit_responses() -> None:
    """OpenAPI auth responses: API contract must document 401, 403, 429, and retry metadata."""
    pytest.fail("Replace this placeholder with an OpenAPI auth response regression test.")


@pytest.mark.xfail(reason=_pending_gate("no API key persistence"))
def test_dashboard_does_not_persist_api_keys() -> None:
    """no API key persistence: API keys must not be written to durable dashboard config."""
    pytest.fail("Replace this placeholder with an API key persistence regression test.")


@pytest.mark.xfail(reason=_pending_gate("docs direct-key warning"))
def test_docs_warn_against_shipping_direct_api_keys_in_games() -> None:
    """docs direct-key warning: public docs must warn games not to ship direct API keys."""
    pytest.fail("Replace this placeholder with a docs warning regression test.")


@pytest.mark.xfail(reason=_pending_gate("context naming consistency"))
def test_context_field_naming_is_consistent_across_docs_sdk_and_api() -> None:
    """context naming consistency: docs, SDK, examples, and API must agree on context field names."""
    pytest.fail("Replace this placeholder with a context naming regression test.")
