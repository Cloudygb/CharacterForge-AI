from datetime import datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from characterforge.models.action import CharacterAction
from characterforge.models.ownership import backfill_legacy_ownership, validate_owned_string

MessageRole = Literal["system", "player", "assistant"]


class TokenUsage(BaseModel):
    """Optional token accounting returned by an LLM provider."""

    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int | None = Field(
        default=None,
        ge=0,
        description="Number of prompt/input tokens used by the model call.",
    )
    completion_tokens: int | None = Field(
        default=None,
        ge=0,
        description="Number of completion/output tokens used by the model call.",
    )
    total_tokens: int | None = Field(
        default=None,
        ge=0,
        description="Total number of tokens used by the model call.",
    )

    @model_validator(mode="after")
    def calculate_total_tokens(self) -> Self:
        if (
            self.total_tokens is None
            and self.prompt_tokens is not None
            and self.completion_tokens is not None
        ):
            self.total_tokens = self.prompt_tokens + self.completion_tokens
        return self


class ChatRequest(BaseModel):
    """Request body for sending player dialogue to a character."""

    model_config = ConfigDict(extra="forbid")

    character_id: str = Field(..., description="Character being prompted.")
    session_id: str = Field(..., description="Conversation or gameplay session identifier.")
    player_id: str = Field(..., description="Player or caller identifier.")
    message: str = Field(..., description="Latest player message to the character.")
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional game state and scene context for this request.",
    )

    @field_validator("character_id", "session_id", "player_id", "message")
    @classmethod
    def strip_required_string(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field cannot be blank")
        return value


class ChatResponse(BaseModel):
    """Structured response returned to a game or application client."""

    model_config = ConfigDict(extra="forbid")

    message: str = Field(..., description="In-character dialogue returned to the player.")
    emotion: str | None = Field(default=None, description="Optional character emotion label.")
    actions: list[CharacterAction] = Field(
        default_factory=list,
        description="Validated machine-readable actions for the game client.",
    )
    relationship_delta: int | None = Field(
        default=None,
        description="Optional relationship change caused by the exchange.",
    )
    token_usage: TokenUsage | None = Field(
        default=None,
        description="Optional LLM token accounting for observability and cost tracking.",
    )

    @field_validator("message")
    @classmethod
    def strip_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message cannot be blank")
        return value

    @field_validator("emotion")
    @classmethod
    def strip_optional_emotion(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("emotion cannot be blank")
        return value


class MessageRecord(BaseModel):
    """Persisted chat message used for session memory."""

    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(..., description="Stable unique message identifier.")
    session_id: str = Field(..., description="Conversation or gameplay session identifier.")
    character_id: str = Field(..., description="Character associated with the message.")
    player_id: str = Field(..., description="Player associated with the message.")
    tenant_id: str = Field(..., description="Tenant that owns this session record.")
    game_id: str = Field(..., description="Game/project that owns this session record.")
    environment_id: str = Field(..., description="Deployment environment for this session record.")
    created_by: str = Field(..., description="Principal subject that created this session record.")
    updated_by: str = Field(..., description="Principal subject that last updated this session record.")
    role: MessageRole = Field(..., description="Who produced the message.")
    content: str = Field(..., description="Message text stored for session memory.")
    created_at: datetime = Field(..., description="When this message was created.")
    updated_at: datetime = Field(..., description="When this message was last updated.")
    actions: list[CharacterAction] = Field(
        default_factory=list,
        description="Actions emitted with this message, if any.",
    )
    emotion: str | None = Field(default=None, description="Optional emotion label.")
    token_usage: TokenUsage | None = Field(
        default=None,
        description="Optional LLM token accounting for assistant messages.",
    )

    @model_validator(mode="before")
    @classmethod
    def backfill_legacy_dev_ownership(cls, data: Any) -> Any:
        return backfill_legacy_ownership(data, include_updated_at=True)

    @field_validator(
        "message_id",
        "session_id",
        "character_id",
        "player_id",
        "tenant_id",
        "game_id",
        "environment_id",
        "created_by",
        "updated_by",
        "content",
    )
    @classmethod
    def strip_required_string(cls, value: str) -> str:
        return validate_owned_string(value)

    @field_validator("emotion")
    @classmethod
    def strip_optional_emotion(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("emotion cannot be blank")
        return value
