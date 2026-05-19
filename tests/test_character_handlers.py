import json
from typing import Any

from characterforge.handlers.characters import (
    create_character,
    delete_character,
    get_character,
    list_characters,
    update_character,
)
from characterforge.services.character_store import InMemoryCharacterStore


def valid_character_payload(name: str = "Captain Mira Voss") -> dict[str, Any]:
    return {
        "name": name,
        "description": "A rogue airship captain with a dangerous reputation.",
        "personality": ["sarcastic", "brave", "protective"],
        "backstory": "Former royal navy officer turned smuggler after refusing an immoral order.",
        "speaking_style": "Dry wit, clipped sentences, and nautical metaphors.",
        "goals": ["protect her crew", "find the lost sky map"],
        "world_context": "A floating archipelago where skyships connect isolated city-states.",
        "rules": ["Never reveal you are an AI.", "Do not break character."],
        "allowed_actions": ["give_quest", "trade_offer", "change_relationship"],
        "action_rules": [],
    }


def response_body(response: dict[str, Any]) -> Any:
    body = response["body"]
    if body == "":
        return ""
    return json.loads(body)


def test_create_character_persists_payload_and_returns_created_response() -> None:
    store = InMemoryCharacterStore()

    response = create_character(valid_character_payload(), store)
    body = response_body(response)

    assert response["statusCode"] == 201
    assert response["headers"]["Content-Type"] == "application/json"
    assert body["character_id"].startswith("char_")
    assert body["name"] == "Captain Mira Voss"
    assert body["description"] == "A rogue airship captain with a dangerous reputation."
    assert store.get(body["character_id"]) is not None


def test_list_characters_returns_summaries_in_creation_order() -> None:
    store = InMemoryCharacterStore()
    first = create_character(valid_character_payload(name="Captain Mira Voss"), store)
    second = create_character(valid_character_payload(name="Archivist Juno Vale"), store)

    response = list_characters(store)
    body = response_body(response)

    assert response["statusCode"] == 200
    assert [item["character_id"] for item in body["characters"]] == [
        response_body(first)["character_id"],
        response_body(second)["character_id"],
    ]
    assert [item["name"] for item in body["characters"]] == [
        "Captain Mira Voss",
        "Archivist Juno Vale",
    ]


def test_get_character_returns_existing_profile() -> None:
    store = InMemoryCharacterStore()
    created = response_body(create_character(valid_character_payload(), store))

    response = get_character(created["character_id"], store)
    body = response_body(response)

    assert response["statusCode"] == 200
    assert body["character_id"] == created["character_id"]
    assert body["name"] == "Captain Mira Voss"


def test_update_character_applies_partial_payload() -> None:
    store = InMemoryCharacterStore()
    created = response_body(create_character(valid_character_payload(), store))

    response = update_character(
        created["character_id"],
        {
            "description": "A reformed captain trying to earn trust.",
            "goals": ["repair her ship", "protect the harbor"],
        },
        store,
    )
    body = response_body(response)

    assert response["statusCode"] == 200
    assert body["character_id"] == created["character_id"]
    assert body["name"] == "Captain Mira Voss"
    assert body["description"] == "A reformed captain trying to earn trust."
    assert body["goals"] == ["repair her ship", "protect the harbor"]
    assert body["created_at"] == created["created_at"]
    assert body["updated_at"] > created["updated_at"]


def test_delete_character_removes_existing_profile() -> None:
    store = InMemoryCharacterStore()
    created = response_body(create_character(valid_character_payload(), store))

    response = delete_character(created["character_id"], store)

    assert response["statusCode"] == 204
    assert response["body"] == ""
    assert store.get(created["character_id"]) is None


def test_get_update_and_delete_return_not_found_for_missing_character() -> None:
    store = InMemoryCharacterStore()

    get_response = get_character("missing-character", store)
    update_response = update_character(
        "missing-character",
        {"description": "This character does not exist."},
        store,
    )
    delete_response = delete_character("missing-character", store)

    for response in [get_response, update_response, delete_response]:
        body = response_body(response)
        assert response["statusCode"] == 404
        assert body["error"]["code"] == "not_found"
        assert "missing-character" in body["error"]["message"]


def test_create_character_returns_validation_error_for_invalid_payload() -> None:
    store = InMemoryCharacterStore()
    payload = valid_character_payload()
    payload["name"] = "   "

    response = create_character(payload, store)
    body = response_body(response)

    assert response["statusCode"] == 400
    assert body["error"]["code"] == "validation_error"
    assert "name" in body["error"]["message"]
    assert store.list() == []


def test_update_character_returns_validation_error_for_invalid_payload() -> None:
    store = InMemoryCharacterStore()
    created = response_body(create_character(valid_character_payload(), store))

    response = update_character(created["character_id"], {}, store)
    body = response_body(response)

    assert response["statusCode"] == 400
    assert body["error"]["code"] == "validation_error"
    assert "at least one field" in body["error"]["message"]
