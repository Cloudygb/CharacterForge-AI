from characterforge.models.action import CharacterAction
from characterforge.models.chat import MessageRecord
from characterforge.security.principal import Principal
from characterforge.services.session_store import InMemorySessionStore, SessionStore


def sample_principal(*, user_id: str = "user_player_1") -> Principal:
    return Principal(
        tenant_id="tenant_skyforge",
        game_id="game_aesail",
        environment_id="env_dev",
        user_id=user_id,
        scopes=frozenset({"sessions:read", "sessions:write"}),
    )


def test_in_memory_session_store_implements_session_store_interface() -> None:
    store: SessionStore = InMemorySessionStore()

    message = store.save_player_message(
        session_id="session_001",
        character_id="char_mira",
        player_id="player_42",
        content="Hello there.",
    )

    assert isinstance(message, MessageRecord)
    assert message.role == "player"


def test_in_memory_session_store_saves_player_messages() -> None:
    store = InMemorySessionStore()

    message = store.save_player_message(
        session_id="session_001",
        character_id="char_mira",
        player_id="player_42",
        content="Can I help with the ruins?",
    )

    assert message.message_id
    assert message.session_id == "session_001"
    assert message.character_id == "char_mira"
    assert message.player_id == "player_42"
    assert message.role == "player"
    assert message.content == "Can I help with the ruins?"
    assert message.actions == []
    assert message.emotion is None


def test_in_memory_session_store_persists_ownership_and_audit_metadata() -> None:
    store = InMemorySessionStore()

    message = store.save_player_message(
        "session_001",
        "char_mira",
        "player_42",
        "Can I help with the ruins?",
        principal=sample_principal(),
    )

    assert message.tenant_id == "tenant_skyforge"
    assert message.game_id == "game_aesail"
    assert message.environment_id == "env_dev"
    assert message.created_by == "user_player_1"
    assert message.updated_by == "user_player_1"
    assert message.updated_at == message.created_at
    assert store.get_recent_history("session_001") == [message]


def test_message_record_backfills_legacy_dev_ownership_metadata() -> None:
    migrated = MessageRecord.model_validate(
        {
            "message_id": "msg_legacy",
            "session_id": "session_legacy",
            "character_id": "char_mira",
            "player_id": "player_42",
            "role": "player",
            "content": "Legacy message",
            "created_at": "2026-05-24T12:00:00Z",
        }
    )

    assert migrated.tenant_id == "legacy-local-tenant"
    assert migrated.game_id == "legacy-local-game"
    assert migrated.environment_id == "legacy-local"
    assert migrated.created_by == "legacy-dev-data"
    assert migrated.updated_by == "legacy-dev-data"
    assert migrated.updated_at == migrated.created_at


def test_in_memory_session_store_saves_character_messages() -> None:
    store = InMemorySessionStore()

    message = store.save_character_message(
        session_id="session_001",
        character_id="char_mira",
        player_id="player_42",
        content="The ruins are no place for idle hands.",
        emotion="concerned",
        actions=[
            CharacterAction(type="give_quest", payload={"quest_id": "ruins_intro"}),
        ],
    )

    assert message.role == "assistant"
    assert message.content == "The ruins are no place for idle hands."
    assert message.emotion == "concerned"
    assert len(message.actions) == 1
    assert message.actions[0].type == "give_quest"
    assert message.actions[0].payload == {"quest_id": "ruins_intro"}


def test_in_memory_session_store_retrieves_recent_history_by_session_id() -> None:
    store = InMemorySessionStore()
    store.save_player_message("session_001", "char_mira", "player_42", "First")
    second = store.save_character_message("session_001", "char_mira", "player_42", "Second")
    third = store.save_player_message("session_001", "char_mira", "player_42", "Third")
    store.save_player_message("session_other", "char_mira", "player_42", "Other session")

    history = store.get_recent_history("session_001", limit=2)

    assert [message.message_id for message in history] == [second.message_id, third.message_id]
    assert [message.content for message in history] == ["Second", "Third"]
    assert all(message.session_id == "session_001" for message in history)


def test_in_memory_session_store_returns_defensive_history_copies() -> None:
    store = InMemorySessionStore()
    saved = store.save_player_message("session_001", "char_mira", "player_42", "Original")

    history = store.get_recent_history("session_001")
    history[0].content = "Mutated outside store"

    assert store.get_recent_history("session_001")[0].content == "Original"
    assert store.get_recent_history("session_001")[0] == saved
    assert store.get_recent_history("session_001")[0] is not saved


def test_in_memory_session_store_returns_empty_history_for_missing_session() -> None:
    store = InMemorySessionStore()

    assert store.get_recent_history("missing-session") == []


def test_in_memory_session_store_clear_session_removes_only_that_session() -> None:
    store = InMemorySessionStore()
    store.save_player_message("session_001", "char_mira", "player_42", "Remove me")
    kept = store.save_player_message("session_other", "char_mira", "player_42", "Keep me")

    cleared_count = store.clear_session("session_001")

    assert cleared_count == 1
    assert store.get_recent_history("session_001") == []
    assert store.get_recent_history("session_other") == [kept]


def test_in_memory_session_store_clear_missing_session_returns_zero() -> None:
    store = InMemorySessionStore()

    assert store.clear_session("missing-session") == 0
