from __future__ import annotations

import json
from typing import Any

from characterforge.security.principal import Principal
from characterforge.services.session_store import SessionStore

JsonDict = dict[str, Any]

_JSON_HEADERS = {"Content-Type": "application/json"}


def get_session_history(
    session_id: str,
    store: SessionStore,
    *,
    limit: int | None = None,
    principal: Principal | None = None,
) -> JsonDict:
    """Return serialized chat history for a session."""
    del principal
    messages = [
        message.model_dump(mode="json")
        for message in store.get_recent_history(session_id, limit=limit)
    ]
    return _json_response(200, {"messages": messages})


def clear_session_history(
    session_id: str,
    store: SessionStore,
    *,
    principal: Principal | None = None,
) -> JsonDict:
    """Clear all stored chat history for a session."""
    del principal
    cleared_count = store.clear_session(session_id)
    return _json_response(200, {"cleared_count": cleared_count})


def _json_response(status_code: int, body: JsonDict) -> JsonDict:
    return {
        "statusCode": status_code,
        "headers": _JSON_HEADERS,
        "body": json.dumps(body),
    }
