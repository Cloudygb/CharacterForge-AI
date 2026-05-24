from __future__ import annotations

import json
from typing import Any

from characterforge.models.chat import MessageRecord
from characterforge.security.principal import Principal
from characterforge.services.session_store import SessionStore

JsonDict = dict[str, Any]

_JSON_HEADERS = {"Content-Type": "application/json"}
_SESSION_READ_SCOPE = "sessions:read"
_SESSION_WRITE_SCOPE = "sessions:write"


def get_session_history(
    session_id: str,
    store: SessionStore,
    *,
    limit: int | None = None,
    principal: Principal | None = None,
) -> JsonDict:
    """Return serialized chat history for a session."""
    if not _has_scope(principal, _SESSION_READ_SCOPE):
        return _forbidden_response()

    messages = store.get_recent_history(session_id, limit=limit)
    if principal is not None and not _session_visible_to_principal(messages, principal):
        return _not_found_response(session_id)

    return _json_response(200, {"messages": [message.model_dump(mode="json") for message in messages]})


def clear_session_history(
    session_id: str,
    store: SessionStore,
    *,
    principal: Principal | None = None,
) -> JsonDict:
    """Clear all stored chat history for a session."""
    if not _has_scope(principal, _SESSION_WRITE_SCOPE):
        return _forbidden_response()

    existing_messages = store.get_recent_history(session_id)
    if principal is not None and not _session_visible_to_principal(existing_messages, principal):
        return _not_found_response(session_id)

    cleared_count = store.clear_session(session_id)
    return _json_response(200, {"cleared_count": cleared_count})


def _has_scope(principal: Principal | None, scope: str) -> bool:
    return principal is None or scope in principal.scopes


def _session_visible_to_principal(messages: list[MessageRecord], principal: Principal) -> bool:
    if not messages:
        return False
    return all(_message_visible_to_principal(message, principal) for message in messages)


def _message_visible_to_principal(message: MessageRecord, principal: Principal) -> bool:
    if (
        message.tenant_id != principal.tenant_id
        or message.game_id != principal.game_id
        or message.environment_id != principal.environment_id
    ):
        return False
    if principal.user_id is not None and not principal.is_local_dev and message.player_id != principal.user_id:
        return False
    return True


def _json_response(status_code: int, body: JsonDict) -> JsonDict:
    return {
        "statusCode": status_code,
        "headers": _JSON_HEADERS,
        "body": json.dumps(body),
    }


def _forbidden_response() -> JsonDict:
    return _json_response(
        403,
        {
            "error": {
                "code": "forbidden",
                "message": "The caller is not authorized to access this session.",
            }
        },
    )


def _not_found_response(session_id: str) -> JsonDict:
    return _json_response(
        404,
        {
            "error": {
                "code": "not_found",
                "message": f"Session '{session_id}' was not found.",
            }
        },
    )
