from __future__ import annotations

import base64
import json
from collections.abc import Mapping
from typing import Any

import pytest

from characterforge.services.character_store import InMemoryCharacterStore
from characterforge.services.llm_client import MockLLMClient
from characterforge.services.session_store import InMemorySessionStore

AUTH_PENDING_REASON = "Audit gate pending remediation: production authorization enforcement"


def _b64url_json(payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def bearer_token(
    *,
    tenant_id: str = "tenant-alpha",
    game_id: str = "game-skyships",
    environment_id: str = "prod",
    user_id: str | None = "user-designer",
    service_principal_id: str | None = None,
    scopes: list[str] | None = None,
) -> str:
    """Create an unsigned JWT-shaped token for authorization regression tests.

    These tokens are deliberately synthetic. Production validation must reject unsigned
    tokens unless a future test-only auth mode explicitly enables them.
    """

    claims: dict[str, Any] = {
        "iss": "https://identity.example.test/characterforge",
        "aud": "characterforge-api",
        "tenant_id": tenant_id,
        "game_id": game_id,
        "environment_id": environment_id,
        "roles": ["developer"],
        "scopes": scopes or ["characters:read", "characters:write", "sessions:read", "sessions:write"],
    }
    if user_id is not None:
        claims["sub"] = user_id
        claims["user_id"] = user_id
    if service_principal_id is not None:
        claims.pop("sub", None)
        claims.pop("user_id", None)
        claims["sub"] = service_principal_id
        claims["service_principal_id"] = service_principal_id

    return f"Bearer {_b64url_json({'alg': 'none', 'typ': 'JWT'})}.{_b64url_json(claims)}."


@pytest.fixture(autouse=True)
def reset_app_dependencies(monkeypatch: pytest.MonkeyPatch):
    from characterforge import app

    monkeypatch.setenv("USE_MOCK_LLM", "true")
    monkeypatch.setenv("CHARACTERFORGE_RECENT_HISTORY_LIMIT", "10")
    monkeypatch.setenv("CHARACTERFORGE_AUTH_MODE", "production")
    monkeypatch.setenv("CHARACTERFORGE_AUTH_TEST_TOKENS", "true")
    monkeypatch.delenv("CHARACTERFORGE_REQUIRE_LOCAL_API_KEY", raising=False)
    monkeypatch.delenv("CHARACTERFORGE_API_KEY", raising=False)
    reset = app.configure_dependencies_for_testing(
        character_store=InMemoryCharacterStore(),
        session_store=InMemorySessionStore(),
        llm_client=MockLLMClient(include_actions=True),
    )
    yield
    reset()


def api_event(
    method: str,
    path: str,
    *,
    body: Mapping[str, Any] | None = None,
    path_parameters: Mapping[str, str] | None = None,
    query: Mapping[str, str] | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": token} if token is not None else {}
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "pathParameters": dict(path_parameters or {}),
        "queryStringParameters": dict(query or {}),
        "headers": headers,
        "body": None if body is None else json.dumps(body),
        "isBase64Encoded": False,
    }


def response_body(response: dict[str, Any]) -> Any:
    if response["body"] == "":
        return ""
    return json.loads(response["body"])


def character_payload(name: str = "Captain Mira Voss") -> dict[str, Any]:
    return {
        "name": name,
        "description": "A rogue airship captain with a dangerous reputation.",
        "personality": ["sarcastic", "brave", "protective"],
        "backstory": "Former royal navy officer turned smuggler after refusing an immoral order.",
        "speaking_style": "Dry wit, clipped sentences, and nautical metaphors.",
        "goals": ["protect her crew", "find the lost sky map"],
        "world_context": "A floating archipelago where skyships connect isolated city-states.",
        "rules": ["Never reveal you are an AI.", "Do not break character."],
    }


def create_character_for_token(token: str, *, name: str = "Captain Mira Voss") -> str:
    from characterforge import app

    response = app.handler(api_event("POST", "/characters", body=character_payload(name), token=token), None)
    assert response["statusCode"] == 201
    return response_body(response)["character_id"]


def create_session_for_token(token: str, character_id: str, *, session_id: str = "session-alpha") -> None:
    from characterforge import app

    response = app.handler(
        api_event(
            "POST",
            f"/characters/{character_id}/chat",
            path_parameters={"character_id": character_id},
            body={
                "session_id": session_id,
                "player_id": "player-1",
                "message": "I can help recover the sky map.",
            },
            token=token,
        ),
        None,
    )
    assert response["statusCode"] == 200


@pytest.mark.xfail(reason=AUTH_PENDING_REASON, strict=True)
def test_unauthenticated_production_requests_are_rejected() -> None:
    from characterforge import app

    response = app.handler(api_event("GET", "/characters"), None)

    assert response["statusCode"] == 401
    assert response_body(response)["error"]["code"] == "unauthorized"


@pytest.mark.xfail(reason=AUTH_PENDING_REASON, strict=True)
def test_invalid_bearer_tokens_are_rejected() -> None:
    from characterforge import app

    response = app.handler(
        api_event(
            "POST",
            "/characters",
            body=character_payload(),
            token="Bearer not-a-valid-token",
        ),
        None,
    )

    assert response["statusCode"] == 401
    assert response_body(response)["error"]["code"] == "unauthorized"


@pytest.mark.xfail(reason=AUTH_PENDING_REASON, strict=True)
def test_read_only_tokens_cannot_write_characters() -> None:
    from characterforge import app

    read_only_token = bearer_token(scopes=["characters:read", "sessions:read"])

    response = app.handler(
        api_event("POST", "/characters", body=character_payload(), token=read_only_token),
        None,
    )

    assert response["statusCode"] == 403
    assert response_body(response)["error"]["code"] == "forbidden"


@pytest.mark.xfail(reason=AUTH_PENDING_REASON, strict=True)
def test_one_tenant_cannot_read_another_tenants_character() -> None:
    from characterforge import app

    tenant_alpha_token = bearer_token(tenant_id="tenant-alpha")
    tenant_beta_token = bearer_token(tenant_id="tenant-beta")
    character_id = create_character_for_token(tenant_alpha_token, name="Alpha Captain")

    response = app.handler(
        api_event(
            "GET",
            f"/characters/{character_id}",
            path_parameters={"character_id": character_id},
            token=tenant_beta_token,
        ),
        None,
    )

    assert response["statusCode"] in {403, 404}


@pytest.mark.xfail(reason=AUTH_PENDING_REASON, strict=True)
def test_one_tenant_cannot_read_another_tenants_session_history() -> None:
    from characterforge import app

    tenant_alpha_token = bearer_token(tenant_id="tenant-alpha")
    tenant_beta_token = bearer_token(tenant_id="tenant-beta")
    character_id = create_character_for_token(tenant_alpha_token, name="Alpha Captain")
    create_session_for_token(tenant_alpha_token, character_id, session_id="session-alpha")

    response = app.handler(
        api_event(
            "GET",
            "/sessions/session-alpha",
            path_parameters={"session_id": "session-alpha"},
            query={"limit": "2"},
            token=tenant_beta_token,
        ),
        None,
    )

    assert response["statusCode"] in {403, 404}


@pytest.mark.xfail(reason=AUTH_PENDING_REASON, strict=True)
def test_service_tokens_are_scoped_by_game_and_environment_for_runtime_writes() -> None:
    from characterforge import app

    production_service_token = bearer_token(
        user_id=None,
        service_principal_id="svc-runtime-prod",
        tenant_id="tenant-alpha",
        game_id="game-skyships",
        environment_id="prod",
        scopes=["characters:read", "sessions:write", "sessions:read"],
    )
    staging_service_token = bearer_token(
        user_id=None,
        service_principal_id="svc-runtime-staging",
        tenant_id="tenant-alpha",
        game_id="game-skyships",
        environment_id="staging",
        scopes=["characters:read", "sessions:write", "sessions:read"],
    )
    character_id = create_character_for_token(production_service_token, name="Production Captain")

    response = app.handler(
        api_event(
            "POST",
            f"/characters/{character_id}/chat",
            path_parameters={"character_id": character_id},
            body={
                "session_id": "session-prod",
                "player_id": "player-1",
                "message": "Can staging reach production?",
            },
            token=staging_service_token,
        ),
        None,
    )

    assert response["statusCode"] in {403, 404}
