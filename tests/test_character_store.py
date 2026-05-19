from characterforge.models.character import (
    CharacterProfile,
    CharacterSummary,
    CreateCharacterRequest,
    UpdateCharacterRequest,
)
from characterforge.services.character_store import CharacterStore, InMemoryCharacterStore


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


def test_in_memory_character_store_implements_character_store_interface() -> None:
    store: CharacterStore = InMemoryCharacterStore()

    profile = store.create(valid_create_request())

    assert isinstance(profile, CharacterProfile)
    assert profile.character_id


def test_in_memory_character_store_creates_and_gets_character_profiles() -> None:
    store = InMemoryCharacterStore()

    created = store.create(valid_create_request())
    fetched = store.get(created.character_id)

    assert fetched == created
    assert fetched is not created
    assert fetched.name == "Captain Mira Voss"
    assert fetched.created_at == created.created_at
    assert fetched.updated_at == created.updated_at


def test_in_memory_character_store_returns_none_for_missing_character() -> None:
    store = InMemoryCharacterStore()

    assert store.get("missing-character") is None


def test_in_memory_character_store_lists_character_summaries_in_creation_order() -> None:
    store = InMemoryCharacterStore()
    first = store.create(valid_create_request(name="Captain Mira Voss"))
    second = store.create(valid_create_request(name="Archivist Juno Vale"))

    summaries = store.list()

    assert [summary.character_id for summary in summaries] == [
        first.character_id,
        second.character_id,
    ]
    assert all(isinstance(summary, CharacterSummary) for summary in summaries)
    assert [summary.name for summary in summaries] == ["Captain Mira Voss", "Archivist Juno Vale"]


def test_in_memory_character_store_updates_existing_character() -> None:
    store = InMemoryCharacterStore()
    created = store.create(valid_create_request())

    updated = store.update(
        created.character_id,
        UpdateCharacterRequest(
            description="A reformed captain trying to earn trust.",
            goals=["repair her ship", "protect the harbor"],
        ),
    )

    assert updated is not None
    assert updated.character_id == created.character_id
    assert updated.name == created.name
    assert updated.description == "A reformed captain trying to earn trust."
    assert updated.goals == ["repair her ship", "protect the harbor"]
    assert updated.created_at == created.created_at
    assert updated.updated_at > created.updated_at
    assert store.get(created.character_id) == updated


def test_in_memory_character_store_returns_none_when_updating_missing_character() -> None:
    store = InMemoryCharacterStore()

    updated = store.update(
        "missing-character",
        UpdateCharacterRequest(description="This character does not exist."),
    )

    assert updated is None


def test_in_memory_character_store_deletes_existing_character() -> None:
    store = InMemoryCharacterStore()
    created = store.create(valid_create_request())

    deleted = store.delete(created.character_id)

    assert deleted is True
    assert store.get(created.character_id) is None
    assert store.list() == []


def test_in_memory_character_store_returns_false_when_deleting_missing_character() -> None:
    store = InMemoryCharacterStore()

    assert store.delete("missing-character") is False
