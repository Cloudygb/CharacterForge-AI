from __future__ import annotations

from datetime import datetime
from typing import Any

LEGACY_TENANT_ID = "legacy-local-tenant"
LEGACY_GAME_ID = "legacy-local-game"
LEGACY_ENVIRONMENT_ID = "legacy-local"
LEGACY_ACTOR_ID = "legacy-dev-data"


def backfill_legacy_ownership(data: Any, *, include_updated_at: bool = False) -> Any:
    """Backfill explicit legacy-dev ownership metadata for pre-auth local records."""
    if not isinstance(data, dict):
        return data

    data.setdefault("tenant_id", LEGACY_TENANT_ID)
    data.setdefault("game_id", LEGACY_GAME_ID)
    data.setdefault("environment_id", LEGACY_ENVIRONMENT_ID)
    data.setdefault("created_by", LEGACY_ACTOR_ID)
    data.setdefault("updated_by", data.get("created_by") or LEGACY_ACTOR_ID)
    if include_updated_at:
        data.setdefault("updated_at", data.get("created_at"))
    return data


def validate_owned_string(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("field cannot be blank")
    return value
