from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from characterforge.models.action import CharacterAction
from characterforge.models.chat import ChatRequest, ChatResponse, MessageRecord, TokenUsage


def test_chat_request_accepts_required_chat_fields() -> None:
    request = ChatRequest(
        character_id="char_mira_voss",
        session_id="session_stormwall_001",
        player_id="player_123",
        message="What have you got for sale?",
        context={"location": "Aurelion Skyport", "reputation": "neutral"},
    )

    assert request.character_id == "char_mira_voss"
    assert request.session_id == "session_stormwall_001"
    assert request.player_id == "player_123"
    assert request.message == "What have you got for sale?"
    assert request.context == {"location": "Aurelion Skyport", "reputation": "neutral"}


def test_chat_request_defaults_optional_context_to_empty_dictionary() -> None:
    request = ChatRequest(
        character_id="char_mira_voss",
        session_id="session_stormwall_001",
        player_id="player_123",
        message="Hello there.",
    )

    assert request.context == {}


def test_chat_request_trims_required_string_fields() -> None:
    request = ChatRequest(
        character_id="  char_mira_voss  ",
        session_id="  session_stormwall_001  ",
        player_id="  player_123  ",
        message="  Hello there.  ",
    )

    assert request.character_id == "char_mira_voss"
    assert request.session_id == "session_stormwall_001"
    assert request.player_id == "player_123"
    assert request.message == "Hello there."


@pytest.mark.parametrize("field_name", ["character_id", "session_id", "player_id", "message"])
def test_chat_request_rejects_blank_required_string_fields(field_name: str) -> None:
    payload = {
        "character_id": "char_mira_voss",
        "session_id": "session_stormwall_001",
        "player_id": "player_123",
        "message": "Hello there.",
    }
    payload[field_name] = "   "

    with pytest.raises(ValidationError):
        ChatRequest(**payload)


def test_chat_request_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(
            character_id="char_mira_voss",
            session_id="session_stormwall_001",
            player_id="player_123",
            message="Hello there.",
            unexpected="value",
        )


def test_token_usage_accepts_optional_counts_and_calculates_total_when_missing() -> None:
    usage = TokenUsage(prompt_tokens=10, completion_tokens=15)

    assert usage.prompt_tokens == 10
    assert usage.completion_tokens == 15
    assert usage.total_tokens == 25


def test_token_usage_rejects_negative_counts() -> None:
    with pytest.raises(ValidationError):
        TokenUsage(prompt_tokens=-1, completion_tokens=15)


def test_chat_response_accepts_message_emotion_actions_and_token_usage() -> None:
    response = ChatResponse(
        message="I've got storm compasses, rope, and regrettable advice.",
        emotion="amused",
        actions=[
            CharacterAction(
                type="open_shop",
                payload={"shop_id": "mira_airship_supplies"},
            )
        ],
        relationship_delta=1,
        token_usage=TokenUsage(prompt_tokens=50, completion_tokens=25),
    )

    assert response.message == "I've got storm compasses, rope, and regrettable advice."
    assert response.emotion == "amused"
    assert response.actions[0].type == "open_shop"
    assert response.actions[0].payload == {"shop_id": "mira_airship_supplies"}
    assert response.relationship_delta == 1
    assert response.token_usage is not None
    assert response.token_usage.total_tokens == 75


def test_chat_response_defaults_actions_to_empty_list() -> None:
    response = ChatResponse(message="No action is needed right now.")

    assert response.actions == []
    assert response.emotion is None
    assert response.relationship_delta is None
    assert response.token_usage is None


def test_chat_response_rejects_blank_message() -> None:
    with pytest.raises(ValidationError):
        ChatResponse(message="   ")


def test_chat_response_serializes_for_api_clients() -> None:
    response = ChatResponse(
        message="Take this compass and try not to die.",
        emotion="concerned",
        actions=[
            {
                "type": "give_item",
                "payload": {"item_id": "storm_compass", "quantity": 1},
            }
        ],
        token_usage={"prompt_tokens": 80, "completion_tokens": 20},
    )

    assert response.model_dump() == {
        "message": "Take this compass and try not to die.",
        "emotion": "concerned",
        "actions": [
            {
                "type": "give_item",
                "payload": {"item_id": "storm_compass", "quantity": 1},
            }
        ],
        "relationship_delta": None,
        "token_usage": {
            "prompt_tokens": 80,
            "completion_tokens": 20,
            "total_tokens": 100,
        },
    }


def test_message_record_accepts_player_message_history() -> None:
    created_at = datetime(2026, 5, 18, 21, 30, tzinfo=UTC)

    record = MessageRecord(
        message_id="msg_001",
        session_id="session_stormwall_001",
        character_id="char_mira_voss",
        player_id="player_123",
        role="player",
        content="Can I buy something?",
        created_at=created_at,
    )

    assert record.message_id == "msg_001"
    assert record.role == "player"
    assert record.content == "Can I buy something?"
    assert record.actions == []
    assert record.created_at == created_at


def test_message_record_accepts_assistant_actions() -> None:
    created_at = datetime(2026, 5, 18, 21, 31, tzinfo=UTC)

    record = MessageRecord(
        message_id="msg_002",
        session_id="session_stormwall_001",
        character_id="char_mira_voss",
        player_id="player_123",
        role="assistant",
        content="I've got a few things you might survive using.",
        actions=[{"type": "open_shop", "payload": {"shop_id": "mira_airship_supplies"}}],
        emotion="amused",
        created_at=created_at,
    )

    assert record.role == "assistant"
    assert record.actions[0].type == "open_shop"
    assert record.emotion == "amused"


def test_message_record_rejects_invalid_role() -> None:
    with pytest.raises(ValidationError):
        MessageRecord(
            message_id="msg_003",
            session_id="session_stormwall_001",
            character_id="char_mira_voss",
            player_id="player_123",
            role="npc",
            content="Invalid role.",
            created_at=datetime(2026, 5, 18, 21, 32, tzinfo=UTC),
        )


def test_message_record_rejects_blank_content() -> None:
    with pytest.raises(ValidationError):
        MessageRecord(
            message_id="msg_004",
            session_id="session_stormwall_001",
            character_id="char_mira_voss",
            player_id="player_123",
            role="player",
            content="   ",
            created_at=datetime(2026, 5, 18, 21, 33, tzinfo=UTC),
        )
