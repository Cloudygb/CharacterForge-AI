from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTH_MODEL = ROOT / "docs" / "security" / "auth-model.md"
APP_SOURCE = ROOT / "src" / "characterforge" / "app.py"

EXPECTED_ROUTES = {
    ("POST", "/characters"): ("characters:write", "tenant_id + game_id + environment_id"),
    ("GET", "/characters"): ("characters:read", "tenant_id + game_id + environment_id"),
    ("GET", "/characters/{character_id}"): ("characters:read", "tenant_id + game_id + environment_id + character_id"),
    ("PUT", "/characters/{character_id}"): ("characters:write", "tenant_id + game_id + environment_id + character_id"),
    ("DELETE", "/characters/{character_id}"): ("characters:delete", "tenant_id + game_id + environment_id + character_id"),
    ("POST", "/characters/{character_id}/chat"): ("sessions:write", "tenant_id + game_id + environment_id + character_id + player_id/session_id"),
    ("GET", "/sessions/{session_id}"): ("sessions:read", "tenant_id + game_id + environment_id + session_id"),
    ("DELETE", "/sessions/{session_id}"): ("sessions:delete", "tenant_id + game_id + environment_id + session_id"),
}

REQUIRED_TERMS = [
    "tenant_id",
    "game_id",
    "environment_id",
    "user_id",
    "service_principal_id",
    "player_id",
    "roles",
    "scopes",
    "Cognito/OIDC/JWT",
    "PKCE",
    "IAM/SigV4",
    "local development",
    "migration impact",
    "API keys are metering only",
    "OWASP API1",
    "OWASP API2",
    "OWASP API5",
    "threat model",
    "acceptance criteria",
]

FORBIDDEN_PATTERNS = [
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----"),
    re.compile(r"https://[a-z0-9]{6,}\.execute-api\.[a-z0-9-]+\.amazonaws\.com", re.IGNORECASE),
    re.compile(r"cf_live_[A-Za-z0-9_=-]+"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*[A-Za-z0-9_./+=-]{24,}"),
]


def _auth_model_text() -> str:
    assert AUTH_MODEL.exists(), f"Missing production identity model at {AUTH_MODEL.relative_to(ROOT)}"
    return AUTH_MODEL.read_text(encoding="utf-8")


def test_identity_model_defines_principals_claims_tokens_and_api_key_boundary() -> None:
    content = _auth_model_text()

    for term in REQUIRED_TERMS:
        assert term in content

    assert "human user principal" in content
    assert "service principal" in content
    assert "game backend proxy" in content
    assert "direct API-key use is local-development only" in content
    assert "API keys MUST NOT grant authorization" in content


def test_identity_model_maps_each_current_api_route_to_scope_and_ownership_rule() -> None:
    content = _auth_model_text()
    app_source = APP_SOURCE.read_text(encoding="utf-8")

    for (method, route), (scope, ownership_rule) in EXPECTED_ROUTES.items():
        assert route.replace("{character_id}", "{character_id}").replace("{session_id}", "{session_id}") in content
        assert f"| {method} | `{route}` |" in content
        assert scope in content
        assert ownership_rule in content

    for route in ["/characters", "/characters/{character_id}", "/characters/{character_id}/chat", "/sessions/{session_id}"]:
        assert route.replace("{character_id}", "{character_id}") in content
    assert "if method == \"POST\" and path == \"/characters\"" in app_source


def test_identity_model_records_threat_model_migration_and_acceptance_criteria() -> None:
    content = _auth_model_text()

    for threat in [
        "leaked API key",
        "cross-tenant object access",
        "public game client secret extraction",
        "confused deputy",
        "audit attribution gap",
    ]:
        assert threat in content

    for migration_item in [
        "Add tenant_id/game_id/environment_id keys",
        "Backfill existing characters and sessions",
        "Introduce JWT authorizer before enforcing scopes",
        "Move game clients behind a backend proxy",
    ]:
        assert migration_item in content

    for criterion in [
        "No production handler trusts x-api-key as identity",
        "Every request resolves exactly one principal",
        "Every object read/write checks tenant_id, game_id, and environment_id",
        "Negative cross-tenant and cross-game tests exist",
    ]:
        assert criterion in content


def test_identity_model_doc_is_public_safe() -> None:
    content = _auth_model_text()
    forbidden_internal_artifact_markers = [
        "Best_Practice_Audit" + "_Implementation_Guide",
        "Best_Practice_Audit" + "_2026",
        "." + "pdf",
    ]
    for marker in forbidden_internal_artifact_markers:
        assert marker not in content

    failures: list[str] = []
    for pattern in FORBIDDEN_PATTERNS:
        if match := pattern.search(content):
            line_number = content.count("\n", 0, match.start()) + 1
            failures.append(f"line {line_number} matched {pattern.pattern}")

    assert failures == []
