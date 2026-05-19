import json
from typing import Any

from characterforge.handlers.sessions import clear_session_history, get_session_history
from characterforge.models.action import CharacterAction
from characterforge.services.session_store import InMemorySessionStore


def response_body(response: dict[str, Any]) -> Any:
    if response["body"] == "":
        return ""
    return json.loads(response["body"])


def test_get_session_history_returns_serialized_messages_in_chronological_order() -> None:
    store = InMemorySessionStore()
    first = store.save_player_message(
        "session-123",
        "char-mira",
        "player-456",
        "Can you help me find the sky map?",
    )
    second = store.save_character_message(
        "session-123",
        "char-mira",
        "player-456",
        "Only if you can keep up.",
        emotion="amused",
        actions=[CharacterAction(type="give_quest", payload={"quest_id": "sky_map"})],
    )
    store.save_player_message("other-session", "char-mira", "player-456", "Do not include me")

    response = get_session_history("session-123", store)
    body = response_body(response)

    assert response["statusCode"] == 200
    assert response["headers"]["Content-Type"] == "application/json"
    assert [message["message_id"] for message in body["messages"]] == [
        first.message_id,
        second.message_id,
    ]
    assert [message["content"] for message in body["messages"]] == [
        "Can you help me find the sky map?",
        "Only if you can keep up.",
    ]
    assert body["messages"][1]["emotion"] == "amused"
    assert body["messages"][1]["actions"] == [
        {"type": "give_quest", "payload": {"quest_id": "sky_map"}}
    ]


def test_get_session_history_applies_limit_to_recent_messages() -> None:
    store = InMemorySessionStore()
    store.save_player_message("session-123", "char-mira", "player-456", "First")
    second = store.save_character_message("session-123", "char-mira", "player-456", "Second")
    third = store.save_player_message("session-123", "char-mira", "player-456", "Third")

    response = get_session_history("session-123", store, limit=2)
    body = response_body(response)

    assert response["statusCode"] == 200
    assert [message["message_id"] for message in body["messages"]] == [
        second.message_id,
        third.message_id,
    ]


def test_clear_session_history_removes_existing_session_messages() -> None:
    store = InMemorySessionStore()
    store.save_player_message("session-123", "char-mira", "player-456", "Remove me")
    kept = store.save_player_message("other-session", "char-mira", "player-456", "Keep me")

    response = clear_session_history("session-123", store)
    body = response_body(response)

    assert response["statusCode"] == 200
    assert body == {"cleared_count": 1}
    assert store.get_recent_history("session-123") == []
    assert store.get_recent_history("other-session") == [kept]


def test_clear_session_history_returns_zero_for_missing_session() -> None:
    store = InMemorySessionStore()

    response = clear_session_history("missing-session", store)
    body = response_body(response)

    assert response["statusCode"] == 200
    assert body == {"cleared_count": 0}
