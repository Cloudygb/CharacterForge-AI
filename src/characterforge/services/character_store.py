from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from characterforge.models.character import (
    CharacterProfile,
    CharacterSummary,
    CreateCharacterRequest,
    UpdateCharacterRequest,
)
from characterforge.models.ownership import (
    LEGACY_ACTOR_ID,
    LEGACY_ENVIRONMENT_ID,
    LEGACY_GAME_ID,
    LEGACY_TENANT_ID,
)
from characterforge.security.principal import Principal


class CharacterStore(Protocol):
    """Persistence interface for CharacterForge character profiles."""

    def create(self, request: CreateCharacterRequest, *, principal: Principal | None = None) -> CharacterProfile:
        """Create and return a persisted character profile."""

    def get(self, character_id: str) -> CharacterProfile | None:
        """Return a character profile by ID, or None when it does not exist."""

    def list(self) -> list[CharacterSummary]:
        """Return compact summaries for all stored characters."""

    def update(
        self,
        character_id: str,
        request: UpdateCharacterRequest,
        *,
        principal: Principal | None = None,
    ) -> CharacterProfile | None:
        """Update an existing character profile, or return None when missing."""

    def delete(self, character_id: str) -> bool:
        """Delete a character profile and return whether anything was deleted."""


class InMemoryCharacterStore:
    """Local in-memory CharacterStore implementation for tests and development."""

    def __init__(self) -> None:
        self._characters: dict[str, CharacterProfile] = {}

    def create(self, request: CreateCharacterRequest, *, principal: Principal | None = None) -> CharacterProfile:
        now = _utc_now()
        character_id = f"char_{uuid4().hex}"
        profile = CharacterProfile(
            character_id=character_id,
            created_at=now,
            updated_at=now,
            **_ownership_metadata(principal),
            **request.model_dump(),
        )
        self._characters[character_id] = profile
        return _copy_profile(profile)

    def get(self, character_id: str) -> CharacterProfile | None:
        profile = self._characters.get(character_id)
        if profile is None:
            return None
        return _copy_profile(profile)

    def list(self) -> list[CharacterSummary]:
        return [
            CharacterSummary(
                character_id=profile.character_id,
                tenant_id=profile.tenant_id,
                game_id=profile.game_id,
                environment_id=profile.environment_id,
                created_by=profile.created_by,
                updated_by=profile.updated_by,
                name=profile.name,
                description=profile.description,
                created_at=profile.created_at,
                updated_at=profile.updated_at,
            )
            for profile in self._characters.values()
        ]

    def update(
        self,
        character_id: str,
        request: UpdateCharacterRequest,
        *,
        principal: Principal | None = None,
    ) -> CharacterProfile | None:
        existing = self._characters.get(character_id)
        if existing is None:
            return None

        update_data = request.model_dump(exclude_none=True)
        updated = existing.model_copy(
            update={**update_data, "updated_at": _utc_now(), "updated_by": _audit_actor(principal)},
            deep=True,
        )
        self._characters[character_id] = updated
        return _copy_profile(updated)

    def delete(self, character_id: str) -> bool:
        if character_id not in self._characters:
            return False
        del self._characters[character_id]
        return True


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


def _audit_actor(principal: Principal | None) -> str:
    return principal.subject if principal is not None else LEGACY_ACTOR_ID


def _copy_profile(profile: CharacterProfile) -> CharacterProfile:
    return profile.model_copy(deep=True)
