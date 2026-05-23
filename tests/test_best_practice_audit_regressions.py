from __future__ import annotations

import pytest


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


@pytest.mark.xfail(reason=_pending_gate("CSP non-null"))
def test_desktop_csp_non_null() -> None:
    """CSP non-null: desktop/Tauri configuration must enforce a real Content Security Policy."""
    pytest.fail("Replace this placeholder with a CSP regression test.")


@pytest.mark.xfail(reason=_pending_gate("installer signing required"))
def test_installer_signing_required_for_release_builds() -> None:
    """installer signing required: release installers must be signed or release verification must fail."""
    pytest.fail("Replace this placeholder with an installer signing regression test.")


@pytest.mark.xfail(reason=_pending_gate("updater real-or-disabled"))
def test_updater_is_real_or_disabled_in_release_ui() -> None:
    """updater real-or-disabled: release UI must not expose placeholder update controls."""
    pytest.fail("Replace this placeholder with an updater capability regression test.")


@pytest.mark.xfail(reason=_pending_gate("typed Start/End confirmation"))
def test_start_end_requires_user_typed_confirmation() -> None:
    """typed Start/End confirmation: destructive deployment actions require user-entered confirmation."""
    pytest.fail("Replace this placeholder with a Start/End confirmation regression test.")


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
