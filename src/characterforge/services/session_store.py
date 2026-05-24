from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from characterforge.models.action import CharacterAction
from characterforge.models.chat import MessageRecord
from characterforge.models.ownership import (
    LEGACY_ACTOR_ID,
    LEGACY_ENVIRONMENT_ID,
    LEGACY_GAME_ID,
    LEGACY_TENANT_ID,
)
from characterforge.security.principal import Principal


class SessionStore(Protocol):
    """Persistence interface for chat session message history."""

    def save_player_message(
        self,
        session_id: str,
        character_id: str,
        player_id: str,
        content: str,
        *,
        principal: Principal | None = None,
    ) -> MessageRecord:
        """Persist a player-authored message in a chat session."""

    def save_character_message(
        self,
        session_id: str,
        character_id: str,
        player_id: str,
        content: str,
        *,
        emotion: str | None = None,
        actions: Sequence[CharacterAction] | None = None,
        principal: Principal | None = None,
    ) -> MessageRecord:
        """Persist a character-authored assistant message in a chat session."""

    def get_recent_history(
        self,
        session_id: str,
        *,
        limit: int | None = None,
    ) -> list[MessageRecord]:
        """Return recent messages for a session in chronological order."""

    def clear_session(self, session_id: str) -> int:
        """Remove all messages for a session and return the number removed."""


class InMemorySessionStore:
    """Local in-memory SessionStore implementation for tests and development."""

    def __init__(self) -> None:
        self._messages_by_session: dict[str, list[MessageRecord]] = {}

    def save_player_message(
        self,
        session_id: str,
        character_id: str,
        player_id: str,
        content: str,
        *,
        principal: Principal | None = None,
    ) -> MessageRecord:
        return self._save_message(
            session_id=session_id,
            character_id=character_id,
            player_id=player_id,
            role="player",
            content=content,
            principal=principal,
        )

    def save_character_message(
        self,
        session_id: str,
        character_id: str,
        player_id: str,
        content: str,
        *,
        emotion: str | None = None,
        actions: Sequence[CharacterAction] | None = None,
        principal: Principal | None = None,
    ) -> MessageRecord:
        return self._save_message(
            session_id=session_id,
            character_id=character_id,
            player_id=player_id,
            role="assistant",
            content=content,
            emotion=emotion,
            actions=list(actions or []),
            principal=principal,
        )

    def get_recent_history(
        self,
        session_id: str,
        *,
        limit: int | None = None,
    ) -> list[MessageRecord]:
        messages = self._messages_by_session.get(session_id, [])
        if limit is not None:
            messages = messages[-limit:]
        return [_copy_message(message) for message in messages]

    def clear_session(self, session_id: str) -> int:
        messages = self._messages_by_session.pop(session_id, [])
        return len(messages)

    def _save_message(
        self,
        *,
        session_id: str,
        character_id: str,
        player_id: str,
        role: str,
        content: str,
        emotion: str | None = None,
        actions: list[CharacterAction] | None = None,
        principal: Principal | None = None,
    ) -> MessageRecord:
        created_at = _utc_now()
        message = MessageRecord(
            message_id=f"msg_{uuid4().hex}",
            session_id=session_id,
            character_id=character_id,
            player_id=player_id,
            role=role,
            content=content,
            created_at=created_at,
            updated_at=created_at,
            actions=actions or [],
            emotion=emotion,
            **_ownership_metadata(principal),
        )
        self._messages_by_session.setdefault(session_id, []).append(message)
        return _copy_message(message)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _ownership_metadata(principal: Principal | None) -> dict[str, str]:
    if principal is None:
        return {
            "tenant_id": LEGACY_TENANT_ID,
            "game_id": LEGACY_GAME_ID,
            "environment_id": LEGACY_ENVIRONMENT_ID,
            "created_by": LEGACY_ACTOR_ID,
            "updated_by": LEGACY_ACTOR_ID,
        }
    actor = principal.subject
    return {
        "tenant_id": principal.tenant_id,
        "game_id": principal.game_id,
        "environment_id": principal.environment_id,
        "created_by": actor,
        "updated_by": actor,
    }


def _copy_message(message: MessageRecord) -> MessageRecord:
    return message.model_copy(deep=True)
