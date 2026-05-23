from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from characterforge.models.action import ActionPayloadTemplate
from characterforge.models.character import (
    CharacterProfile,
    CharacterSummary,
    CreateCharacterRequest,
    UpdateCharacterRequest,
)


def valid_character_payload() -> dict:
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
                "trigger_instructions": "Offer the quest when the player asks for work.",
            },
            {
                "type": "open_shop",
                "enabled": False,
                "trigger_instructions": "Open the shop only after this action is enabled.",
            },
        ],
        "payload_templates": [
            {
                "template_id": "quest_offer",
                "action_type": "give_quest",
                "description": "Payload shape for offering the lost sky map quest.",
                "payload_template": {
                    "quest_id": "lost_sky_map",
                    "title": "Recover the Lost Sky Map",
                    "reward_currency": 150,
                },
            },
            {
                "template_id": "relationship_boost",
                "action_type": "change_relationship",
                "description": "Payload shape for improving Mira's trust in the player.",
                "payload_template": {"relationship_change": 1},
            },
        ],
    }


def test_create_character_request_accepts_complete_profile_data() -> None:
    request = CreateCharacterRequest(**valid_character_payload())

    assert request.name == "Captain Mira Voss"
    assert request.personality == ["sarcastic", "brave", "protective"]
    assert request.allowed_actions == ["give_quest", "trade_offer", "change_relationship"]
    assert request.action_rules[0].type == "give_quest"
    assert request.action_rules[0].enabled is True
    assert request.action_rules[1].type == "open_shop"
    assert request.action_rules[1].enabled is False
    assert request.payload_templates[0].template_id == "quest_offer"
    assert request.payload_templates[0].action_type == "give_quest"
    assert request.payload_templates[0].payload_template["quest_id"] == "lost_sky_map"


def test_action_payload_template_trims_required_strings() -> None:
    template = ActionPayloadTemplate(
        template_id="  shop_offer  ",
        action_type="open_shop",
        description="  Payload used to open a shop inventory.  ",
        payload_template={"shop_id": "skyship_supplies"},
    )

    assert template.template_id == "shop_offer"
    assert template.description == "Payload used to open a shop inventory."


def test_create_character_request_allows_profiles_without_action_rules() -> None:
    payload = valid_character_payload()
    payload.pop("action_rules")

    request = CreateCharacterRequest(**payload)

    assert request.action_rules == []


def test_create_character_request_allows_profiles_without_payload_templates() -> None:
    payload = valid_character_payload()
    payload.pop("payload_templates")

    request = CreateCharacterRequest(**payload)

    assert request.payload_templates == []


def test_create_character_request_rejects_duplicate_payload_template_ids() -> None:
    payload = valid_character_payload()
    payload["payload_templates"][1]["template_id"] = "quest_offer"

    with pytest.raises(
        ValidationError, match="payload_templates template_id values must be unique"
    ):
        CreateCharacterRequest(**payload)


def test_create_character_request_accepts_custom_payload_template_action_type() -> None:
    payload = valid_character_payload()
    payload["allowed_actions"].append("launch_missiles")
    payload["action_rules"].append(
        {
            "type": "launch_missiles",
            "enabled": True,
            "trigger_instructions": "Launch missiles when the scenario explicitly permits it.",
        }
    )
    payload["payload_templates"][0]["action_type"] = "launch_missiles"

    request = CreateCharacterRequest(**payload)

    assert request.payload_templates[0].action_type == "launch_missiles"


def test_create_character_request_rejects_blank_payload_template_action_type() -> None:
    payload = valid_character_payload()
    payload["payload_templates"][0]["action_type"] = "   "

    with pytest.raises(ValidationError):
        CreateCharacterRequest(**payload)


def test_create_character_request_rejects_blank_required_strings() -> None:
    payload = valid_character_payload()
    payload["name"] = "   "

    with pytest.raises(ValidationError):
        CreateCharacterRequest(**payload)


def test_create_character_request_requires_non_empty_lists() -> None:
    payload = valid_character_payload()
    payload["personality"] = []

    with pytest.raises(ValidationError):
        CreateCharacterRequest(**payload)


def test_create_character_request_trims_string_values_and_list_items() -> None:
    payload = valid_character_payload()
    payload["name"] = "  Captain Mira Voss  "
    payload["personality"] = [" sarcastic ", " brave "]

    request = CreateCharacterRequest(**payload)

    assert request.name == "Captain Mira Voss"
    assert request.personality == ["sarcastic", "brave"]


def test_update_character_request_allows_partial_updates() -> None:
    request = UpdateCharacterRequest(description="Updated description", goals=["secure a new ship"])

    assert request.description == "Updated description"
    assert request.goals == ["secure a new ship"]
    assert request.name is None


def test_update_character_request_allows_action_rule_updates() -> None:
    request = UpdateCharacterRequest(
        action_rules=[
            {
                "type": "open_shop",
                "enabled": True,
                "trigger_instructions": "Open the shop when the player asks to buy.",
            }
        ]
    )

    assert request.action_rules is not None
    assert request.action_rules[0].type == "open_shop"
    assert request.action_rules[0].enabled is True


def test_update_character_request_allows_payload_template_updates() -> None:
    request = UpdateCharacterRequest(
        payload_templates=[
            {
                "template_id": "shop_offer",
                "action_type": "open_shop",
                "description": "Payload used to open the skyship supplies shop.",
                "payload_template": {"shop_id": "skyship_supplies"},
            }
        ]
    )

    assert request.payload_templates is not None
    assert request.payload_templates[0].template_id == "shop_offer"
    assert request.payload_templates[0].action_type == "open_shop"


def test_update_character_request_rejects_duplicate_payload_template_ids() -> None:
    with pytest.raises(
        ValidationError, match="payload_templates template_id values must be unique"
    ):
        UpdateCharacterRequest(
            payload_templates=[
                {
                    "template_id": "quest_offer",
                    "action_type": "give_quest",
                    "description": "Offer the quest.",
                    "payload_template": {"quest_id": "lost_sky_map"},
                },
                {
                    "template_id": "quest_offer",
                    "action_type": "change_relationship",
                    "description": "Improve relationship.",
                    "payload_template": {"relationship_change": 1},
                },
            ]
        )


def test_update_character_request_rejects_invalid_action_rules() -> None:
    with pytest.raises(ValidationError):
        UpdateCharacterRequest(
            action_rules=[
                {
                    "type": "open_shop",
                    "enabled": True,
                    "trigger_instructions": "   ",
                }
            ]
        )


def test_update_character_request_rejects_empty_update_body() -> None:
    with pytest.raises(ValidationError):
        UpdateCharacterRequest()


def test_update_character_request_rejects_blank_values_when_provided() -> None:
    with pytest.raises(ValidationError):
        UpdateCharacterRequest(speaking_style="   ")


def test_character_profile_contains_identity_and_timestamps() -> None:
    now = datetime(2026, 5, 18, 20, 0, tzinfo=UTC)

    profile = CharacterProfile(
        character_id="char_mira_voss",
        created_at=now,
        updated_at=now,
        **valid_character_payload(),
    )

    assert profile.character_id == "char_mira_voss"
    assert profile.created_at == now
    assert profile.updated_at == now
    assert profile.name == "Captain Mira Voss"
    assert profile.action_rules[0].type == "give_quest"
    assert profile.action_rules[1].enabled is False
    assert profile.payload_templates[0].template_id == "quest_offer"


def test_character_profile_rejects_blank_character_id() -> None:
    now = datetime(2026, 5, 18, 20, 0, tzinfo=UTC)

    with pytest.raises(ValidationError):
        CharacterProfile(
            character_id="  ",
            created_at=now,
            updated_at=now,
            **valid_character_payload(),
        )


def test_character_summary_contains_listing_fields_only() -> None:
    now = datetime(2026, 5, 18, 20, 0, tzinfo=UTC)

    summary = CharacterSummary(
        character_id="char_mira_voss",
        name="Captain Mira Voss",
        description="A rogue airship captain with a dangerous reputation.",
        created_at=now,
        updated_at=now,
    )

    assert summary.model_dump() == {
        "character_id": "char_mira_voss",
        "name": "Captain Mira Voss",
        "description": "A rogue airship captain with a dangerous reputation.",
        "created_at": now,
        "updated_at": now,
    }


def test_character_summary_trims_and_rejects_blank_listing_strings() -> None:
    now = datetime(2026, 5, 18, 20, 0, tzinfo=UTC)

    summary = CharacterSummary(
        character_id="  char_mira_voss  ",
        name="  Captain Mira Voss  ",
        description="  A rogue airship captain.  ",
        created_at=now,
        updated_at=now,
    )

    assert summary.character_id == "char_mira_voss"
    assert summary.name == "Captain Mira Voss"
    assert summary.description == "A rogue airship captain."

    with pytest.raises(ValidationError):
        CharacterSummary(
            character_id="char_mira_voss",
            name="   ",
            description="A rogue airship captain.",
            created_at=now,
            updated_at=now,
        )
