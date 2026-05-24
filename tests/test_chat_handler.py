import json
from typing import Any

from characterforge.handlers.chat import LLMClient, chat_with_character
from characterforge.models.character import CreateCharacterRequest
from characterforge.services.character_store import InMemoryCharacterStore
from characterforge.services.llm_client import MockLLMClient
from characterforge.services.session_store import InMemorySessionStore


class RecordingMockLLMClient(MockLLMClient):
    def __init__(self) -> None:
        super().__init__()
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return super().generate(prompt)


class InvalidJsonLLMClient:
    prompts: list[str]

    def __init__(self) -> None:
        self.prompts = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return "not-json"


def valid_create_request(name: str = "Captain Mira Voss") -> CreateCharacterRequest:
    return CreateCharacterRequest(
        name=name,
        description="A rogue airship captain with a dangerous reputation.",
        personality=["sarcastic", "brave", "protective"],
        backstory="Former royal navy officer turned smuggler after refusing an immoral order.",
        speaking_style="Dry wit, clipped sentences, and nautical metaphors.",
        goals=["protect her crew", "find the lost sky map"],
        world_context="A floating archipelago where skyships connect isolated city-states.",
        rules=["Never reveal you are an AI.", "Do not break character."],
        allowed_actions=["give_quest", "trade_offer", "change_relationship"],
        action_rules=[],
    )


def valid_chat_payload(character_id: str) -> dict[str, Any]:
    return {
        "character_id": character_id,
        "session_id": "session-123",
        "player_id": "player-456",
        "message": "Can you help me find the sky map?",
        "context": {"location": "Harbor of Kites"},
    }


def response_body(response: dict[str, Any]) -> Any:
    return json.loads(response["body"])


def principal(
    *,
    tenant_id: str = "tenant-alpha",
    game_id: str = "game-skyships",
    environment_id: str = "prod",
    user_id: str | None = "player-456",
    service_principal_id: str | None = None,
    scopes: set[str] | None = None,
):
    from characterforge.security.principal import Principal

    return Principal(
        tenant_id=tenant_id,
        game_id=game_id,
        environment_id=environment_id,
        user_id=user_id,
        service_principal_id=service_principal_id,
        scopes=frozenset(scopes or {"characters:read", "sessions:read", "sessions:write"}),
    )


def test_chat_with_character_builds_prompt_saves_conversation_and_returns_chat_response() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = RecordingMockLLMClient()
    character = character_store.create(valid_create_request())
    session_store.save_player_message(
        "session-123",
        character.character_id,
        "player-456",
        "I heard you know old routes through the storm wall.",
    )

    response = chat_with_character(
        valid_chat_payload(character.character_id),
        character_store,
        session_store,
        llm_client,
    )
    body = response_body(response)
    history = session_store.get_recent_history("session-123")

    assert response["statusCode"] == 200
    assert response["headers"]["Content-Type"] == "application/json"
    assert body == {
        "message": "Captain Mira Voss responds to the player in character.",
        "emotion": "calm",
        "actions": [],
        "relationship_delta": 0,
        "token_usage": None,
    }
    assert len(llm_client.prompts) == 1
    assert "I heard you know old routes through the storm wall." in llm_client.prompts[0]
    assert "Current player message: Can you help me find the sky map?" in llm_client.prompts[0]
    assert [message.role for message in history] == ["player", "player", "assistant"]
    assert history[-2].content == "Can you help me find the sky map?"
    assert history[-1].content == "Captain Mira Voss responds to the player in character."
    assert history[-1].emotion == "calm"


def test_chat_with_character_returns_not_found_without_saving_messages() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = RecordingMockLLMClient()

    response = chat_with_character(
        valid_chat_payload("missing-character"),
        character_store,
        session_store,
        llm_client,
    )
    body = response_body(response)

    assert response["statusCode"] == 404
    assert body["error"]["code"] == "not_found"
    assert "missing-character" in body["error"]["message"]
    assert session_store.get_recent_history("session-123") == []
    assert llm_client.prompts == []


def test_chat_with_character_returns_validation_error_without_calling_llm() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = RecordingMockLLMClient()

    response = chat_with_character(
        {"character_id": "char_missing_required_fields"},
        character_store,
        session_store,
        llm_client,
    )
    body = response_body(response)

    assert response["statusCode"] == 400
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"]
    assert llm_client.prompts == []
    assert session_store.get_recent_history("session-123") == []


def test_chat_with_character_returns_llm_error_without_saving_messages() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client: LLMClient = InvalidJsonLLMClient()
    character = character_store.create(valid_create_request())

    response = chat_with_character(
        valid_chat_payload(character.character_id),
        character_store,
        session_store,
        llm_client,
    )
    body = response_body(response)

    assert response["statusCode"] == 502
    assert body["error"]["code"] == "llm_response_error"
    assert "valid JSON" in body["error"]["message"]
    assert session_store.get_recent_history("session-123") == []


def test_chat_with_character_requires_session_write_scope() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = RecordingMockLLMClient()
    caller = principal(scopes={"characters:read", "sessions:read"})
    character = character_store.create(valid_create_request(), principal=caller)

    response = chat_with_character(
        valid_chat_payload(character.character_id),
        character_store,
        session_store,
        llm_client,
        principal=caller,
    )
    body = response_body(response)

    assert response["statusCode"] == 403
    assert body["error"]["code"] == "forbidden"
    assert session_store.get_recent_history("session-123") == []
    assert llm_client.prompts == []


def test_chat_with_character_hides_cross_tenant_character() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = RecordingMockLLMClient()
    owner = principal(tenant_id="tenant-alpha")
    caller = principal(tenant_id="tenant-beta")
    character = character_store.create(valid_create_request(), principal=owner)

    response = chat_with_character(
        valid_chat_payload(character.character_id),
        character_store,
        session_store,
        llm_client,
        principal=caller,
    )

    assert response["statusCode"] == 404
    assert session_store.get_recent_history("session-123") == []
    assert llm_client.prompts == []


def test_chat_with_character_hides_existing_session_owned_by_another_principal() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = RecordingMockLLMClient()
    owner = principal(user_id="player-456")
    other_player = principal(user_id="player-999")
    character = character_store.create(valid_create_request(), principal=owner)
    session_store.save_player_message(
        "session-123",
        character.character_id,
        "player-456",
        "Existing owner-only history.",
        principal=owner,
    )

    response = chat_with_character(
        {**valid_chat_payload(character.character_id), "player_id": "player-999"},
        character_store,
        session_store,
        llm_client,
        principal=other_player,
    )

    assert response["statusCode"] == 404
    assert [message.content for message in session_store.get_recent_history("session-123")] == [
        "Existing owner-only history."
    ]
    assert llm_client.prompts == []


def test_chat_with_character_requires_user_player_id_to_match_principal() -> None:
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = RecordingMockLLMClient()
    caller = principal(user_id="player-456")
    character = character_store.create(valid_create_request(), principal=caller)

    response = chat_with_character(
        {**valid_chat_payload(character.character_id), "player_id": "player-999"},
        character_store,
        session_store,
        llm_client,
        principal=caller,
    )
    body = response_body(response)

    assert response["statusCode"] == 403
    assert body["error"]["code"] == "forbidden"
    assert session_store.get_recent_history("session-123") == []
    assert llm_client.prompts == []
