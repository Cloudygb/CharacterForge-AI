import json
from typing import Any

from characterforge.handlers.characters import (
    create_character,
    delete_character,
    get_character,
    list_characters,
    update_character,
)
from characterforge.security.principal import Principal
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


def principal(
    *,
    tenant_id: str = "tenant-alpha",
    game_id: str = "game-skyships",
    environment_id: str = "prod",
    scopes: set[str] | None = None,
    user_id: str = "user-designer",
) -> Principal:
    return Principal(
        tenant_id=tenant_id,
        game_id=game_id,
        environment_id=environment_id,
        user_id=user_id,
        scopes=frozenset(scopes or {"characters:read", "characters:write"}),
    )


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


def test_create_character_requires_write_scope_when_principal_is_present() -> None:
    store = InMemoryCharacterStore()

    response = create_character(
        valid_character_payload(),
        store,
        principal=principal(scopes={"characters:read"}),
    )
    body = response_body(response)

    assert response["statusCode"] == 403
    assert body["error"]["code"] == "forbidden"
    assert store.list() == []


def test_list_characters_requires_read_scope_and_filters_to_owned_characters() -> None:
    store = InMemoryCharacterStore()
    alpha = principal(tenant_id="tenant-alpha")
    beta = principal(tenant_id="tenant-beta", user_id="user-beta")
    alpha_character = response_body(create_character(valid_character_payload(name="Alpha Captain"), store, principal=alpha))
    create_character(valid_character_payload(name="Beta Captain"), store, principal=beta)

    forbidden = list_characters(store, principal=principal(scopes={"characters:write"}))
    response = list_characters(store, principal=alpha)
    body = response_body(response)

    assert forbidden["statusCode"] == 403
    assert response["statusCode"] == 200
    assert [item["character_id"] for item in body["characters"]] == [alpha_character["character_id"]]
    assert [item["tenant_id"] for item in body["characters"]] == ["tenant-alpha"]


def test_get_character_hides_cross_tenant_character_existence() -> None:
    store = InMemoryCharacterStore()
    alpha = principal(tenant_id="tenant-alpha")
    beta = principal(tenant_id="tenant-beta", user_id="user-beta")
    alpha_character = response_body(create_character(valid_character_payload(), store, principal=alpha))

    response = get_character(alpha_character["character_id"], store, principal=beta)
    body = response_body(response)

    assert response["statusCode"] == 404
    assert body["error"]["code"] == "not_found"


def test_update_character_requires_write_scope_and_matching_ownership() -> None:
    store = InMemoryCharacterStore()
    alpha = principal(tenant_id="tenant-alpha")
    beta = principal(tenant_id="tenant-beta", user_id="user-beta")
    alpha_character = response_body(create_character(valid_character_payload(), store, principal=alpha))

    read_only = update_character(
        alpha_character["character_id"],
        {"description": "Read-only callers cannot update."},
        store,
        principal=principal(scopes={"characters:read"}),
    )
    cross_tenant = update_character(
        alpha_character["character_id"],
        {"description": "Cross-tenant callers cannot update."},
        store,
        principal=beta,
    )
    stored = store.get(alpha_character["character_id"])

    assert read_only["statusCode"] == 403
    assert cross_tenant["statusCode"] == 404
    assert stored is not None
    assert stored.description == "A rogue airship captain with a dangerous reputation."


def test_delete_character_requires_write_scope_and_matching_ownership() -> None:
    store = InMemoryCharacterStore()
    alpha = principal(tenant_id="tenant-alpha")
    beta = principal(tenant_id="tenant-beta", user_id="user-beta")
    alpha_character = response_body(create_character(valid_character_payload(), store, principal=alpha))

    read_only = delete_character(alpha_character["character_id"], store, principal=principal(scopes={"characters:read"}))
    cross_tenant = delete_character(alpha_character["character_id"], store, principal=beta)

    assert read_only["statusCode"] == 403
    assert cross_tenant["statusCode"] == 404
    assert store.get(alpha_character["character_id"]) is not None
