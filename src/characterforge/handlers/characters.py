from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from characterforge.models.character import CreateCharacterRequest, UpdateCharacterRequest
from characterforge.security.principal import Principal
from characterforge.services.character_store import CharacterStore

JsonDict = dict[str, Any]

_JSON_HEADERS = {"Content-Type": "application/json"}


def create_character(payload: JsonDict, store: CharacterStore, *, principal: Principal | None = None) -> JsonDict:
    """Create a character profile from an API payload."""
    try:
        request = CreateCharacterRequest.model_validate(payload)
    except ValidationError as error:
        return _validation_error_response(error)

    profile = store.create(request, principal=principal)
    return _json_response(201, profile.model_dump(mode="json"))


def list_characters(store: CharacterStore, *, principal: Principal | None = None) -> JsonDict:
    """List character summaries."""
    del principal
    summaries = [summary.model_dump(mode="json") for summary in store.list()]
    return _json_response(200, {"characters": summaries})


def get_character(character_id: str, store: CharacterStore, *, principal: Principal | None = None) -> JsonDict:
    """Return one character profile by ID."""
    del principal
    profile = store.get(character_id)
    if profile is None:
        return _not_found_response(character_id)
    return _json_response(200, profile.model_dump(mode="json"))


def update_character(
    character_id: str,
    payload: JsonDict,
    store: CharacterStore,
    *,
    principal: Principal | None = None,
) -> JsonDict:
    """Update an existing character profile from an API payload."""
    try:
        request = UpdateCharacterRequest.model_validate(payload)
    except ValidationError as error:
        return _validation_error_response(error)

    profile = store.update(character_id, request, principal=principal)
    if profile is None:
        return _not_found_response(character_id)
    return _json_response(200, profile.model_dump(mode="json"))


def delete_character(character_id: str, store: CharacterStore, *, principal: Principal | None = None) -> JsonDict:
    """Delete one character profile by ID."""
    del principal
    deleted = store.delete(character_id)
    if not deleted:
        return _not_found_response(character_id)
    return {"statusCode": 204, "headers": _JSON_HEADERS, "body": ""}


def _json_response(status_code: int, body: JsonDict) -> JsonDict:
    return {
        "statusCode": status_code,
        "headers": _JSON_HEADERS,
        "body": json.dumps(body),
    }


def _not_found_response(character_id: str) -> JsonDict:
    return _json_response(
        404,
        {
            "error": {
                "code": "not_found",
                "message": f"Character '{character_id}' was not found.",
            }
        },
    )


def _validation_error_response(error: ValidationError) -> JsonDict:
    return _json_response(
        400,
        {
            "error": {
                "code": "validation_error",
                "message": str(error),
                "details": error.errors(include_context=False),
            }
        },
    )
