import pytest
from pydantic import ValidationError

from characterforge.models.action import SUPPORTED_ACTION_TYPES, CharacterAction

EXPECTED_ACTION_TYPES = {
    "give_quest",
    "advance_quest",
    "complete_quest",
    "fail_quest",
    "start_dialogue",
    "show_choice",
    "trigger_scene",
    "open_shop",
    "trade_offer",
    "give_item",
    "take_item",
    "give_currency",
    "take_currency",
    "set_flag",
    "clear_flag",
    "set_variable",
    "change_variable",
    "change_relationship",
    "change_reputation",
    "change_faction_standing",
    "spawn_entity",
    "despawn_entity",
    "move_entity",
    "start_combat",
    "end_combat",
    "set_npc_hostile",
    "set_npc_friendly",
    "apply_condition",
    "unlock_location",
    "lock_location",
    "reveal_location",
    "teleport_player",
    "escort_player",
    "open_door",
    "close_door",
    "unlock_door",
    "lock_door",
}


def test_supported_action_types_match_the_mvp_action_list() -> None:
    assert set(SUPPORTED_ACTION_TYPES) == EXPECTED_ACTION_TYPES



@pytest.mark.parametrize("action_type", sorted(EXPECTED_ACTION_TYPES))
def test_character_action_accepts_every_supported_action_type(action_type: str) -> None:
    action = CharacterAction(type=action_type, payload={"source": "test"})

    assert action.type == action_type
    assert action.payload == {"source": "test"}


def test_character_action_accepts_custom_action_type() -> None:
    action = CharacterAction(type="cast_spell", payload={"spell": "spark"})

    assert action.type == "cast_spell"
    assert action.payload == {"spell": "spark"}


def test_character_action_rejects_blank_action_type() -> None:
    with pytest.raises(ValidationError):
        CharacterAction(type="   ", payload={})


def test_character_action_payload_defaults_to_empty_dictionary() -> None:
    action = CharacterAction(type="give_quest")

    assert action.payload == {}


def test_character_action_rejects_non_dictionary_payload() -> None:
    with pytest.raises(ValidationError):
        CharacterAction(type="give_quest", payload=["not", "a", "dict"])


def test_character_action_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        CharacterAction(type="give_quest", payload={}, unexpected="value")


def test_character_action_can_be_serialized_for_api_responses() -> None:
    action = CharacterAction(
        type="trade_offer",
        payload={
            "item_id": "storm_compass",
            "price": 150,
            "currency": "gold",
        },
    )

    assert action.model_dump() == {
        "type": "trade_offer",
        "payload": {
            "item_id": "storm_compass",
            "price": 150,
            "currency": "gold",
        },
    }
