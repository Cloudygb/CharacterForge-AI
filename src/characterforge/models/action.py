from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ActionType = Literal[
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
]

SUPPORTED_ACTION_TYPES: tuple[str, ...] = ActionType.__args__


class CharacterAction(BaseModel):
    """Machine-readable action emitted by a character response."""

    model_config = ConfigDict(extra="forbid")

    type: ActionType = Field(..., description="Supported game action type.")
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="Action-specific data for the consuming game or application.",
    )


class CharacterActionRule(BaseModel):
    """Designer-authored rule describing when a character may emit an action."""

    model_config = ConfigDict(extra="forbid")

    type: ActionType = Field(..., description="Supported game action type.")
    enabled: bool = Field(..., description="Whether this character may use the action.")
    trigger_instructions: str = Field(
        ...,
        description="Natural-language conditions for when the action should happen.",
    )

    @field_validator("trigger_instructions")
    @classmethod
    def strip_trigger_instructions(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("trigger_instructions cannot be blank")
        return value
