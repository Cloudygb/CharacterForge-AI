import json
from collections.abc import Mapping
from typing import Any

import pytest

from characterforge.api import lambda_handler
from characterforge.services.character_store import InMemoryCharacterStore
from characterforge.services.llm_client import MockLLMClient
from characterforge.services.session_store import InMemorySessionStore


@pytest.fixture(autouse=True)
def reset_lambda_dependencies(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("USE_MOCK_LLM", "true")
    monkeypatch.setenv("CHARACTERFORGE_RECENT_HISTORY_LIMIT", "10")
    monkeypatch.setenv("CHARACTERFORGE_AUTH_LOCAL_DEV_MODE", "true")
    reset = lambda_handler.configure_dependencies_for_testing(
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
    query: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "queryStringParameters": dict(query or {}),
        "body": None if body is None else json.dumps(body),
        "isBase64Encoded": False,
    }


def response_body(response: dict[str, Any]) -> Any:
    if response["body"] == "":
        return ""
    return json.loads(response["body"])


def valid_character_payload() -> dict[str, Any]:
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


def test_lambda_handler_routes_character_and_chat_flow() -> None:
    create_response = lambda_handler.handler(
        api_event("POST", "/characters", body=valid_character_payload()), None
    )
    created = response_body(create_response)

    assert create_response["statusCode"] == 201
    assert created["name"] == "Captain Mira Voss"

    character_id = created["character_id"]
    chat_response = lambda_handler.handler(
        api_event(
            "POST",
            f"/characters/{character_id}/chat",
            body={
                "session_id": "session-123",
                "player_id": "player-456",
                "message": "I can help recover the sky map.",
                "context": {"location": "Harbor of Kites"},
            },
        ),
        None,
    )
    chat_body = response_body(chat_response)

    assert chat_response["statusCode"] == 200
    assert chat_body["message"] == "Captain Mira Voss responds to the player in character."
    assert chat_body["actions"] == [{"type": "give_quest", "payload": {"mock": True}}]

    history_response = lambda_handler.handler(
        api_event("GET", "/sessions/session-123", query={"limit": "2"}), None
    )
    history_body = response_body(history_response)

    assert history_response["statusCode"] == 200
    assert [message["role"] for message in history_body["messages"]] == ["player", "assistant"]


def test_lambda_handler_routes_update_delete_and_not_found() -> None:
    created = response_body(
        lambda_handler.handler(
            api_event("POST", "/characters", body=valid_character_payload()), None
        )
    )
    character_id = created["character_id"]

    update_response = lambda_handler.handler(
        api_event(
            "PUT",
            f"/characters/{character_id}",
            body={"description": "A captain preparing for a dangerous storm route."},
        ),
        None,
    )
    assert response_body(update_response)["description"] == (
        "A captain preparing for a dangerous storm route."
    )

    delete_response = lambda_handler.handler(
        api_event("DELETE", f"/characters/{character_id}"), None
    )
    assert delete_response["statusCode"] == 204

    missing_response = lambda_handler.handler(api_event("GET", f"/characters/{character_id}"), None)
    assert missing_response["statusCode"] == 404


def test_lambda_handler_returns_errors_for_invalid_json_and_unknown_routes() -> None:
    invalid_response = lambda_handler.handler(
        {
            "rawPath": "/characters",
            "requestContext": {"http": {"method": "POST"}},
            "body": "{not json",
        },
        None,
    )
    unknown_response = lambda_handler.handler(api_event("GET", "/missing"), None)

    assert invalid_response["statusCode"] == 400
    assert response_body(invalid_response)["error"]["code"] == "invalid_json"
    assert unknown_response["statusCode"] == 404
    assert response_body(unknown_response)["error"]["code"] == "not_found"
