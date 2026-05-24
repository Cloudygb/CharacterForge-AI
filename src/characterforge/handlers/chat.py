from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import ValidationError

from characterforge.models.character import CharacterProfile
from characterforge.models.chat import ChatRequest, MessageRecord
from characterforge.security.principal import Principal
from characterforge.services.character_store import CharacterStore
from characterforge.services.prompt_builder import build_bedrock_prompt
from characterforge.services.response_parser import LLMResponseParseError, parse_chat_response
from characterforge.services.session_store import SessionStore

JsonDict = dict[str, Any]

_JSON_HEADERS = {"Content-Type": "application/json"}
_DEFAULT_HISTORY_LIMIT = 10
_CHARACTER_READ_SCOPE = "characters:read"
_SESSION_READ_SCOPE = "sessions:read"
_SESSION_WRITE_SCOPE = "sessions:write"


class LLMClient(Protocol):
    """Minimal text-generation interface used by chat handlers."""

    def generate(self, prompt: str) -> str:
        """Generate raw model text from a prompt."""


def chat_with_character(
    payload: JsonDict,
    character_store: CharacterStore,
    session_store: SessionStore,
    llm_client: LLMClient,
    *,
    history_limit: int = _DEFAULT_HISTORY_LIMIT,
    principal: Principal | None = None,
) -> JsonDict:
    """Run one character chat turn and persist the resulting conversation."""
    try:
        chat_request = ChatRequest.model_validate(payload)
    except ValidationError as error:
        return _validation_error_response(error)

    if not _has_scope(principal, _CHARACTER_READ_SCOPE) or not _has_scope(principal, _SESSION_READ_SCOPE):
        return _forbidden_response()
    if not _has_scope(principal, _SESSION_WRITE_SCOPE):
        return _forbidden_response()
    if principal is not None and not _player_matches_principal(chat_request, principal):
        return _forbidden_response()

    character = character_store.get(chat_request.character_id)
    if character is None or not _character_visible_to_principal(character, principal):
        return _not_found_response(chat_request.character_id)

    recent_history = session_store.get_recent_history(
        chat_request.session_id,
        limit=history_limit,
    )
    if not _session_usable_for_chat(recent_history, chat_request, principal):
        return _session_not_found_response(chat_request.session_id)

    prompt = build_bedrock_prompt(character, chat_request, recent_history)
    raw_response = llm_client.generate(prompt)

    try:
        chat_response = parse_chat_response(raw_response, character)
    except LLMResponseParseError as error:
        return _llm_error_response(error)

    session_store.save_player_message(
        chat_request.session_id,
        chat_request.character_id,
        chat_request.player_id,
        chat_request.message,
        principal=principal,
    )
    session_store.save_character_message(
        chat_request.session_id,
        chat_request.character_id,
        chat_request.player_id,
        chat_response.message,
        emotion=chat_response.emotion,
        actions=chat_response.actions,
        principal=principal,
    )

    return _json_response(200, chat_response.model_dump(mode="json"))


def _has_scope(principal: Principal | None, scope: str) -> bool:
    return principal is None or scope in principal.scopes


def _player_matches_principal(chat_request: ChatRequest, principal: Principal) -> bool:
    return principal.is_local_dev or principal.user_id is None or chat_request.player_id == principal.user_id


def _character_visible_to_principal(character: CharacterProfile, principal: Principal | None) -> bool:
    if principal is None:
        return True
    return (
        character.tenant_id == principal.tenant_id
        and character.game_id == principal.game_id
        and character.environment_id == principal.environment_id
    )


def _session_usable_for_chat(
    recent_history: list[MessageRecord], chat_request: ChatRequest, principal: Principal | None
) -> bool:
    if principal is None:
        return True
    return all(_message_matches_chat_request(message, chat_request, principal) for message in recent_history)


def _message_matches_chat_request(message: MessageRecord, chat_request: ChatRequest, principal: Principal) -> bool:
    if (
        message.tenant_id != principal.tenant_id
        or message.game_id != principal.game_id
        or message.environment_id != principal.environment_id
    ):
        return False
    if message.character_id != chat_request.character_id or message.player_id != chat_request.player_id:
        return False
    return True


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


def _session_not_found_response(session_id: str) -> JsonDict:
    return _json_response(
        404,
        {
            "error": {
                "code": "not_found",
                "message": f"Session '{session_id}' was not found.",
            }
        },
    )


def _forbidden_response() -> JsonDict:
    return _json_response(
        403,
        {
            "error": {
                "code": "forbidden",
                "message": "The caller is not authorized to chat with this character or session.",
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


def _llm_error_response(error: LLMResponseParseError) -> JsonDict:
    return _json_response(
        502,
        {
            "error": {
                "code": "llm_response_error",
                "message": str(error),
            }
        },
    )
