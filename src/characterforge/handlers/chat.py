from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import ValidationError

from characterforge.models.chat import ChatRequest
from characterforge.security.principal import Principal
from characterforge.services.character_store import CharacterStore
from characterforge.services.prompt_builder import build_bedrock_prompt
from characterforge.services.response_parser import LLMResponseParseError, parse_chat_response
from characterforge.services.session_store import SessionStore

JsonDict = dict[str, Any]

_JSON_HEADERS = {"Content-Type": "application/json"}
_DEFAULT_HISTORY_LIMIT = 10


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
    del principal
    try:
        chat_request = ChatRequest.model_validate(payload)
    except ValidationError as error:
        return _validation_error_response(error)

    character = character_store.get(chat_request.character_id)
    if character is None:
        return _not_found_response(chat_request.character_id)

    recent_history = session_store.get_recent_history(
        chat_request.session_id,
        limit=history_limit,
    )
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
    )
    session_store.save_character_message(
        chat_request.session_id,
        chat_request.character_id,
        chat_request.player_id,
        chat_response.message,
        emotion=chat_response.emotion,
        actions=chat_response.actions,
    )

    return _json_response(200, chat_response.model_dump(mode="json"))


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
