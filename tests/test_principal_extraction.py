from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

import pytest


def api_event(
    *,
    claims: Mapping[str, Any] | None = None,
    jwt_scopes: list[str] | None = None,
) -> dict[str, Any]:
    authorizer: dict[str, Any] = {}
    if claims is not None:
        authorizer["jwt"] = {"claims": dict(claims)}
        if jwt_scopes is not None:
            authorizer["jwt"]["scopes"] = list(jwt_scopes)
        authorizer["claims"] = dict(claims)
    return {
        "version": "2.0",
        "rawPath": "/characters",
        "requestContext": {
            "http": {"method": "GET", "path": "/characters"},
            "authorizer": authorizer,
        },
        "headers": {},
        "body": None,
        "isBase64Encoded": False,
    }


def response_body(response: dict[str, Any]) -> Any:
    return json.loads(response["body"])


def test_principal_from_event_normalizes_api_gateway_jwt_claims() -> None:
    from characterforge.security.principal import principal_from_event

    principal = principal_from_event(
        api_event(
            claims={
                "custom:tenant_id": " tenant-alpha ",
                "custom:game_id": "game-skyships",
                "custom:environment_id": "prod",
                "sub": "user-designer",
                "username": "mira",
                "scope": " characters:write  characters:read sessions:read ",
                "cognito:groups": ["developer", "owner"],
            }
        )
    )

    assert principal.tenant_id == "tenant-alpha"
    assert principal.game_id == "game-skyships"
    assert principal.environment_id == "prod"
    assert principal.user_id == "user-designer"
    assert principal.service_principal_id is None
    assert principal.subject == "user-designer"
    assert principal.scopes == frozenset({"characters:write", "characters:read", "sessions:read"})
    assert principal.roles == frozenset({"developer", "owner"})
    assert principal.is_local_dev is False


def test_principal_from_event_supports_service_principal_and_jwt_scope_list() -> None:
    from characterforge.security.principal import principal_from_event

    principal = principal_from_event(
        api_event(
            claims={
                "tenant_id": "tenant-alpha",
                "game_id": "game-skyships",
                "environment_id": "prod",
                "service_principal_id": "svc-runtime-prod",
            },
            jwt_scopes=["sessions:write", "sessions:read"],
        )
    )

    assert principal.user_id is None
    assert principal.service_principal_id == "svc-runtime-prod"
    assert principal.subject == "svc-runtime-prod"
    assert principal.scopes == frozenset({"sessions:write", "sessions:read"})


def test_principal_from_event_rejects_missing_tenant_or_scopes() -> None:
    from characterforge.security.principal import PrincipalError, principal_from_event

    with pytest.raises(PrincipalError, match="tenant_id"):
        principal_from_event(
            api_event(
                claims={
                    "game_id": "game-skyships",
                    "environment_id": "prod",
                    "sub": "user-designer",
                    "scope": "characters:read",
                }
            )
        )

    with pytest.raises(PrincipalError, match="scopes"):
        principal_from_event(
            api_event(
                claims={
                    "tenant_id": "tenant-alpha",
                    "game_id": "game-skyships",
                    "environment_id": "prod",
                    "sub": "user-designer",
                }
            )
        )


def test_principal_from_event_rejects_malformed_authorizer_context() -> None:
    from characterforge.security.principal import PrincipalError, principal_from_event

    with pytest.raises(PrincipalError, match="authorizer claims"):
        principal_from_event({"requestContext": {"authorizer": "not-a-mapping"}})

    with pytest.raises(PrincipalError, match="authorizer claims"):
        principal_from_event({"requestContext": {"authorizer": {"jwt": {"claims": "not-a-mapping"}}}})


def test_principal_from_event_allows_explicit_local_dev_test_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    from characterforge.security.principal import principal_from_event

    monkeypatch.setenv("CHARACTERFORGE_AUTH_LOCAL_DEV_MODE", "true")

    principal = principal_from_event(api_event())

    assert principal.tenant_id == "local-tenant"
    assert principal.game_id == "local-game"
    assert principal.environment_id == "local"
    assert principal.user_id == "local-developer"
    assert principal.scopes == frozenset(
        {"characters:read", "characters:write", "sessions:read", "sessions:write", "deployment:admin"}
    )
    assert principal.is_local_dev is True


def test_lambda_handler_rejects_missing_principal_claims_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    from characterforge import app
    from characterforge.services.character_store import InMemoryCharacterStore
    from characterforge.services.llm_client import MockLLMClient
    from characterforge.services.session_store import InMemorySessionStore

    monkeypatch.delenv("CHARACTERFORGE_AUTH_LOCAL_DEV_MODE", raising=False)
    monkeypatch.setenv("USE_MOCK_LLM", "true")
    reset = app.configure_dependencies_for_testing(
        character_store=InMemoryCharacterStore(),
        session_store=InMemorySessionStore(),
        llm_client=MockLLMClient(include_actions=True),
    )
    try:
        response = app.handler(api_event(), None)
    finally:
        reset()

    assert response["statusCode"] == 401
    assert response_body(response)["error"]["code"] == "unauthorized"


def test_lambda_handler_makes_typed_principal_available_to_route_handlers(monkeypatch: pytest.MonkeyPatch) -> None:
    from characterforge import app
    from characterforge.security.principal import Principal

    captured: dict[str, Any] = {}

    def fake_list_characters(store: Any, *, principal: Principal) -> dict[str, Any]:
        captured["principal"] = principal
        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"characters": []})}

    monkeypatch.setattr(app, "list_characters", fake_list_characters)
    monkeypatch.setenv("USE_MOCK_LLM", "true")

    response = app.handler(
        api_event(
            claims={
                "tenant_id": "tenant-alpha",
                "game_id": "game-skyships",
                "environment_id": "prod",
                "sub": "user-designer",
                "scope": "characters:read",
            }
        ),
        None,
    )

    assert response["statusCode"] == 200
    assert captured["principal"].tenant_id == "tenant-alpha"
    assert captured["principal"].scopes == frozenset({"characters:read"})
