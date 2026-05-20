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
) -> dict[str, Any]:
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "pathParameters": dict(path_parameters or {}),
        "queryStringParameters": dict(query or {}),
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
