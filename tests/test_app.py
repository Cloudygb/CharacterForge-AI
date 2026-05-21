import base64
import json
from collections.abc import Mapping
from typing import Any

import pytest

from characterforge.services.character_store import InMemoryCharacterStore
from characterforge.services.llm_client import MockLLMClient
from characterforge.services.session_store import InMemorySessionStore


@pytest.fixture(autouse=True)
def reset_app_dependencies(monkeypatch: pytest.MonkeyPatch):
    from characterforge import app

    monkeypatch.setenv("USE_MOCK_LLM", "true")
    monkeypatch.setenv("CHARACTERFORGE_RECENT_HISTORY_LIMIT", "10")
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
    headers: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "pathParameters": dict(path_parameters or {}),
        "queryStringParameters": dict(query or {}),
        "headers": dict(headers or {}),
        "body": None if body is None else json.dumps(body),
        "isBase64Encoded": False,
    }


def response_body(response: dict[str, Any]) -> Any:
    if response["body"] == "":
        return ""
    return json.loads(response["body"])


def character_payload() -> dict[str, Any]:
    return {
        "name": "Captain Mira Voss",
        "description": "A rogue airship captain with a dangerous reputation.",
        "personality": ["sarcastic", "brave", "protective"],
        "backstory": "Former royal navy officer turned smuggler after refusing an immoral order.",
        "speaking_style": "Dry wit, clipped sentences, and nautical metaphors.",
        "goals": ["protect her crew", "find the lost sky map"],
        "world_context": "A floating archipelago where skyships connect isolated city-states.",
        "rules": ["Never reveal you are an AI.", "Do not break character."],
        "allowed_actions": ["give_quest", "trade_offer", "change_relationship"],
        "action_rules": [
            {
                "type": "give_quest",
                "enabled": True,
                "trigger_instructions": "Use when the player asks for a job or offers help.",
            }
        ],
    }


def create_character() -> dict[str, Any]:
    from characterforge import app

    response = app.handler(api_event("POST", "/characters", body=character_payload()), None)
    assert response["statusCode"] == 201
    return response_body(response)


def test_app_routes_character_crud_api_gateway_events() -> None:
    from characterforge import app

    created = create_character()
    character_id = created["character_id"]

    list_response = app.handler(api_event("GET", "/characters"), None)
    get_response = app.handler(
        api_event(
            "GET",
            f"/characters/{character_id}",
            path_parameters={"character_id": character_id},
        ),
        None,
    )
    update_response = app.handler(
        api_event(
            "PUT",
            f"/characters/{character_id}",
            path_parameters={"character_id": character_id},
            body={"description": "Preparing for a dangerous storm route."},
        ),
        None,
    )
    delete_response = app.handler(
        api_event(
            "DELETE",
            f"/characters/{character_id}",
            path_parameters={"character_id": character_id},
        ),
        None,
    )

    assert response_body(list_response)["characters"][0]["character_id"] == character_id
    assert response_body(get_response)["name"] == "Captain Mira Voss"
    assert response_body(update_response)["description"] == "Preparing for a dangerous storm route."
    assert delete_response["statusCode"] == 204


def test_app_routes_chat_and_session_api_gateway_events() -> None:
    from characterforge import app

    character_id = create_character()["character_id"]

    chat_response = app.handler(
        api_event(
            "POST",
            f"/characters/{character_id}/chat",
            path_parameters={"character_id": character_id},
            body={
                "session_id": "session-123",
                "player_id": "player-456",
                "message": "I can help recover the sky map.",
                "context": {"location": "Harbor of Kites"},
            },
        ),
        None,
    )
    history_response = app.handler(
        api_event(
            "GET",
            "/sessions/session-123",
            path_parameters={"session_id": "session-123"},
            query={"limit": "2"},
        ),
        None,
    )
    clear_response = app.handler(
        api_event(
            "DELETE",
            "/sessions/session-123",
            path_parameters={"session_id": "session-123"},
        ),
        None,
    )

    assert chat_response["statusCode"] == 200
    assert response_body(chat_response)["actions"] == [
        {"type": "give_quest", "payload": {"mock": True}}
    ]
    assert [message["role"] for message in response_body(history_response)["messages"]] == [
        "player",
        "assistant",
    ]
    assert clear_response["statusCode"] == 200
    assert response_body(clear_response)["cleared_count"] == 2


def test_app_returns_api_gateway_errors_for_bad_requests() -> None:
    from characterforge import app

    invalid_json_response = app.handler(
        {
            "version": "2.0",
            "rawPath": "/characters",
            "requestContext": {"http": {"method": "POST", "path": "/characters"}},
            "body": "{not json",
            "isBase64Encoded": False,
        },
        None,
    )
    missing_route_response = app.handler(api_event("GET", "/missing"), None)
    bad_limit_response = app.handler(
        api_event("GET", "/sessions/session-123", query={"limit": "zero"}),
        None,
    )

    assert invalid_json_response["statusCode"] == 400
    assert response_body(invalid_json_response)["error"]["code"] == "invalid_json"
    assert missing_route_response["statusCode"] == 404
    assert response_body(missing_route_response)["error"]["code"] == "not_found"
    assert bad_limit_response["statusCode"] == 400
    assert response_body(bad_limit_response)["error"]["code"] == "bad_request"


def test_local_api_key_check_returns_401_when_enabled_and_header_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from characterforge import app

    monkeypatch.setenv("CHARACTERFORGE_REQUIRE_LOCAL_API_KEY", "true")
    monkeypatch.setenv("CHARACTERFORGE_API_KEY", "local-development-key")

    response = app.handler(api_event("POST", "/characters", body=character_payload()), None)

    assert response["statusCode"] == 401
    assert response_body(response)["error"]["code"] == "unauthorized"


def test_local_api_key_check_returns_401_when_enabled_and_header_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from characterforge import app

    monkeypatch.setenv("CHARACTERFORGE_REQUIRE_LOCAL_API_KEY", "true")
    monkeypatch.setenv("CHARACTERFORGE_API_KEY", "local-development-key")

    response = app.handler(
        api_event(
            "POST",
            "/characters",
            body=character_payload(),
            headers={"x-api-key": "wrong-key"},
        ),
        None,
    )

    assert response["statusCode"] == 401
    assert response_body(response)["error"]["code"] == "unauthorized"


def test_local_api_key_check_accepts_valid_x_api_key_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from characterforge import app

    monkeypatch.setenv("CHARACTERFORGE_REQUIRE_LOCAL_API_KEY", "true")
    monkeypatch.setenv("CHARACTERFORGE_API_KEY", "local-development-key")

    response = app.handler(
        api_event(
            "POST",
            "/characters",
            body=character_payload(),
            headers={"X-Api-Key": "local-development-key"},
        ),
        None,
    )

    assert response["statusCode"] == 201
    assert response_body(response)["name"] == "Captain Mira Voss"


def test_deployed_api_gateway_remains_primary_auth_layer_when_local_check_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from characterforge import app

    monkeypatch.setenv("CHARACTERFORGE_REQUIRE_LOCAL_API_KEY", "false")
    monkeypatch.setenv("CHARACTERFORGE_API_KEY", "configured-but-not-enforced-locally")

    response = app.handler(api_event("POST", "/characters", body=character_payload()), None)

    assert response["statusCode"] == 201
    assert response_body(response)["name"] == "Captain Mira Voss"


def test_app_accepts_api_gateway_v1_events_and_base64_bodies() -> None:
    from characterforge import app

    body = json.dumps(character_payload()).encode("utf-8")
    response = app.handler(
        {
            "httpMethod": "POST",
            "path": "/characters/",
            "body": base64.b64encode(body).decode("ascii"),
            "isBase64Encoded": True,
        },
        None,
    )

    assert response["statusCode"] == 201
    assert response_body(response)["name"] == "Captain Mira Voss"


def test_app_strips_api_gateway_stage_prefix_from_http_api_paths() -> None:
    from characterforge import app

    event = api_event("POST", "/dev/characters", body=character_payload())
    event["requestContext"] = {
        "stage": "dev",
        "http": {"method": "POST", "path": "/dev/characters"},
    }

    response = app.handler(event, None)

    assert response["statusCode"] == 201
    assert response_body(response)["name"] == "Captain Mira Voss"


def test_app_returns_bad_request_for_malformed_api_gateway_events() -> None:
    from characterforge import app

    missing_method_response = app.handler({"rawPath": "/characters"}, None)
    missing_path_response = app.handler(
        {"requestContext": {"http": {"method": "GET"}}},
        None,
    )
    non_object_body_response = app.handler(
        {
            "version": "2.0",
            "rawPath": "/characters",
            "requestContext": {"http": {"method": "POST", "path": "/characters"}},
            "body": json.dumps(["not", "an", "object"]),
            "isBase64Encoded": False,
        },
        None,
    )

    assert missing_method_response["statusCode"] == 400
    assert response_body(missing_method_response)["error"]["code"] == "bad_request"
    assert missing_path_response["statusCode"] == 400
    assert response_body(missing_path_response)["error"]["code"] == "bad_request"
    assert non_object_body_response["statusCode"] == 400
    assert response_body(non_object_body_response)["error"]["code"] == "bad_request"


def test_app_lazy_mock_dependencies_are_reused_when_not_injected() -> None:
    from characterforge import app

    reset = app.configure_dependencies_for_testing()
    try:
        created = create_character()
        list_response = app.handler(api_event("GET", "/characters"), None)
    finally:
        reset()

    assert response_body(list_response)["characters"][0]["character_id"] == created["character_id"]
