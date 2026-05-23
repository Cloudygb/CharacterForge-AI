import pytest
from pydantic import ValidationError

from characterforge.models.action import CharacterActionRule


def test_character_action_rule_accepts_enabled_action_with_trigger_instructions() -> None:
    rule = CharacterActionRule(
        type="open_shop",
        enabled=True,
        trigger_instructions=(
            "Only open the shop if the player asks what is for sale "
            "or says they want to buy something."
        ),
    )

    assert rule.type == "open_shop"
    assert rule.enabled is True
    assert rule.trigger_instructions == (
        "Only open the shop if the player asks what is for sale or says they want to buy something."
    )


def test_character_action_rule_accepts_disabled_action() -> None:
    rule = CharacterActionRule(
        type="give_quest",
        enabled=False,
        trigger_instructions="Do not offer this quest until the designer enables it.",
    )

    assert rule.enabled is False


def test_character_action_rule_accepts_custom_action_type() -> None:
    rule = CharacterActionRule(
        type="cast_spell",
        enabled=True,
        trigger_instructions="Cast a spell when the player invokes a spell name.",
    )

    assert rule.type == "cast_spell"


def test_character_action_rule_rejects_blank_action_type() -> None:
    with pytest.raises(ValidationError):
        CharacterActionRule(
            type="   ",
            enabled=True,
            trigger_instructions="This action name is blank.",
        )


def test_character_action_rule_rejects_blank_trigger_instructions() -> None:
    with pytest.raises(ValidationError):
        CharacterActionRule(
            type="open_shop",
            enabled=True,
            trigger_instructions="   ",
        )


def test_character_action_rule_trims_trigger_instructions() -> None:
    rule = CharacterActionRule(
        type="open_shop",
        enabled=True,
        trigger_instructions="  Open the shop only when the player asks to buy.  ",
    )

    assert rule.trigger_instructions == "Open the shop only when the player asks to buy."


def test_character_action_rule_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        CharacterActionRule(
            type="open_shop",
            enabled=True,
            trigger_instructions="Open the shop when the player asks to buy.",
            unexpected="value",
        )


def test_character_action_rule_serializes_for_character_profiles() -> None:
    rule = CharacterActionRule(
        type="open_shop",
        enabled=True,
        trigger_instructions="Open the shop when the player asks what is for sale.",
    )

    assert rule.model_dump() == {
        "type": "open_shop",
        "enabled": True,
        "trigger_instructions": "Open the shop when the player asks what is for sale.",
    }
