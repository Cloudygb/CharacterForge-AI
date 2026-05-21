from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from characterforge.models.action import ActionPayloadTemplate, CharacterActionRule


class CharacterBase(BaseModel):
    """Shared editable fields for a CharacterForge AI character."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="Display name for the character.")
    description: str = Field(..., description="Short summary of who the character is.")
    personality: list[str] = Field(..., description="Personality traits that shape behavior.")
    backstory: str = Field(..., description="Relevant character history and lore.")
    speaking_style: str = Field(..., description="How the character should sound in dialogue.")
    goals: list[str] = Field(..., description="Current motivations and objectives.")
    world_context: str = Field(..., description="Game-world context the character knows.")
    rules: list[str] = Field(..., description="Roleplay and safety constraints for the character.")
    allowed_actions: list[str] = Field(
        ..., description="Machine-readable game actions this character may emit."
    )
    action_rules: list[CharacterActionRule] = Field(
        default_factory=list,
        description="Designer-authored rules for when enabled actions should trigger.",
    )
    payload_templates: list[ActionPayloadTemplate] = Field(
        default_factory=list,
        description="Designer-authored payload templates available to game clients.",
    )

    @field_validator("name", "description", "backstory", "speaking_style", "world_context")
    @classmethod
    def strip_required_string(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field cannot be blank")
        return value

    @field_validator("personality", "goals", "rules", "allowed_actions")
    @classmethod
    def strip_required_string_list(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        if not cleaned:
            raise ValueError("list must contain at least one non-blank item")
        return cleaned

    @model_validator(mode="after")
    def require_unique_payload_template_ids(self) -> Self:
        seen: set[str] = set()
        for template in self.payload_templates:
            if template.template_id in seen:
                raise ValueError("payload_templates template_id values must be unique")
            seen.add(template.template_id)
        return self


class CreateCharacterRequest(CharacterBase):
    """Request body for creating a new character profile."""


class UpdateCharacterRequest(BaseModel):
    """Request body for partially updating an existing character profile."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    personality: list[str] | None = None
    backstory: str | None = None
    speaking_style: str | None = None
    goals: list[str] | None = None
    world_context: str | None = None
    rules: list[str] | None = None
    allowed_actions: list[str] | None = None
    action_rules: list[CharacterActionRule] | None = None
    payload_templates: list[ActionPayloadTemplate] | None = None

    @field_validator("name", "description", "backstory", "speaking_style", "world_context")
    @classmethod
    def strip_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("field cannot be blank")
        return value

    @field_validator("personality", "goals", "rules", "allowed_actions")
    @classmethod
    def strip_optional_string_list(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [item.strip() for item in value if item.strip()]
        if not cleaned:
            raise ValueError("list must contain at least one non-blank item")
        return cleaned

    @model_validator(mode="after")
    def require_at_least_one_update_field(self) -> Self:
        if all(value is None for value in self.model_dump().values()):
            raise ValueError("at least one field must be provided")
        return self

    @model_validator(mode="after")
    def require_unique_payload_template_ids(self) -> Self:
        if self.payload_templates is None:
            return self
        seen: set[str] = set()
        for template in self.payload_templates:
            if template.template_id in seen:
                raise ValueError("payload_templates template_id values must be unique")
            seen.add(template.template_id)
        return self


class CharacterProfile(CharacterBase):
    """Complete persisted character profile."""

    character_id: str = Field(..., description="Stable unique character identifier.")
    created_at: datetime = Field(..., description="When the character was created.")
    updated_at: datetime = Field(..., description="When the character was last updated.")

    @field_validator("character_id")
    @classmethod
    def strip_character_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("character_id cannot be blank")
        return value


class CharacterSummary(BaseModel):
    """Compact character representation for list responses."""

    model_config = ConfigDict(extra="forbid")

    character_id: str
    name: str
    description: str
    created_at: datetime
    updated_at: datetime

    @field_validator("character_id", "name", "description")
    @classmethod
    def strip_summary_string(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field cannot be blank")
        return value
