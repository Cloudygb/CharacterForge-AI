from __future__ import annotations

import base64
import hmac
import json
import os
import uuid
from collections.abc import Callable, Mapping
from typing import Any

from characterforge.handlers.characters import (
    create_character,
    delete_character,
    get_character,
    list_characters,
    update_character,
)
from characterforge.handlers.chat import chat_with_character
from characterforge.handlers.sessions import clear_session_history, get_session_history
from characterforge.security.principal import Principal, PrincipalError, principal_from_event
from characterforge.services.bedrock_client import BedrockLLMClient
from characterforge.services.character_store import CharacterStore, InMemoryCharacterStore
from characterforge.services.dynamodb_store import DynamoDBCharacterStore, DynamoDBSessionStore
from characterforge.services.llm_client import MockLLMClient
from characterforge.services.session_store import InMemorySessionStore, SessionStore

JsonDict = dict[str, Any]

_DEFAULT_HISTORY_LIMIT = 10
_JSON_HEADERS = {"Content-Type": "application/json"}

_CHARACTER_STORE: CharacterStore | None = None
_SESSION_STORE: SessionStore | None = None
_LLM_CLIENT: Any | None = None


def handler(event: Mapping[str, Any], context: Any) -> JsonDict:
    """Route an API Gateway HTTP API event to the local CharacterForge handlers."""
    del context

    request_id = _request_id(event)

    try:
        method = _event_method(event)
        path = _event_path(event)
        if not _local_api_key_authorized(event):
            return _finalize_response(
                _error_response(
                    401,
                    "unauthorized",
                    "Missing or invalid x-api-key header.",
                ),
                request_id,
            )
        principal = principal_from_event(event)
        path_parameters = event.get("pathParameters") or {}
        return _finalize_response(_dispatch(method, path, path_parameters, event, principal), request_id)
    except PrincipalError:
        return _finalize_response(_error_response(401, "unauthorized", "Authentication is required."), request_id)
    except json.JSONDecodeError:
        return _finalize_response(_error_response(400, "invalid_json", "Request body is not valid JSON."), request_id)
    except ValueError as error:
        return _finalize_response(_error_response(400, "bad_request", str(error)), request_id)
    except Exception:
        return _finalize_response(
            _error_response(500, "internal_server_error", "An unexpected server error occurred."),
            request_id,
        )


def _dispatch(
    method: str,
    path: str,
    path_parameters: Mapping[str, Any],
    event: Mapping[str, Any],
    principal: Principal,
) -> JsonDict:
    if method == "POST" and path == "/characters":
        return create_character(_json_body(event), _character_store(), principal=principal)

    if method == "GET" and path == "/characters":
        return list_characters(_character_store(), principal=principal)

    if method == "GET" and _matches(path, "/characters/{character_id}"):
        character_id = _path_value(path, path_parameters, "character_id", index=1)
        return get_character(character_id, _character_store(), principal=principal)

    if method == "PUT" and _matches(path, "/characters/{character_id}"):
        character_id = _path_value(path, path_parameters, "character_id", index=1)
        return update_character(character_id, _json_body(event), _character_store(), principal=principal)

    if method == "DELETE" and _matches(path, "/characters/{character_id}"):
        character_id = _path_value(path, path_parameters, "character_id", index=1)
        return delete_character(character_id, _character_store(), principal=principal)

    if method == "POST" and _matches(path, "/characters/{character_id}/chat"):
        character_id = _path_value(path, path_parameters, "character_id", index=1)
        payload = {**_json_body(event), "character_id": character_id}
        return chat_with_character(
            payload,
            _character_store(),
            _session_store(),
            _llm_client(),
            history_limit=_history_limit(),
            principal=principal,
        )

    if method == "GET" and _matches(path, "/sessions/{session_id}"):
        session_id = _path_value(path, path_parameters, "session_id", index=1)
        return get_session_history(session_id, _session_store(), limit=_optional_limit(event), principal=principal)

    if method == "DELETE" and _matches(path, "/sessions/{session_id}"):
        session_id = _path_value(path, path_parameters, "session_id", index=1)
        return clear_session_history(session_id, _session_store(), principal=principal)

    return _error_response(404, "not_found", f"No route for {method} {path}.")


def _request_id(event: Mapping[str, Any]) -> str:
    supplied = _header_value(event, "x-request-id")
    if supplied and _valid_request_id(supplied):
        return supplied.strip()
    request_context = event.get("requestContext") or {}
    gateway_request_id = request_context.get("requestId") if isinstance(request_context, Mapping) else None
    if isinstance(gateway_request_id, str) and _valid_request_id(gateway_request_id):
        return gateway_request_id.strip()
    return uuid.uuid4().hex


def _valid_request_id(value: str) -> bool:
    stripped = value.strip()
    return bool(stripped) and len(stripped) <= 128 and "\n" not in stripped and "\r" not in stripped


def _finalize_response(response: JsonDict, request_id: str) -> JsonDict:
    finalized = dict(response)
    headers = dict(finalized.get("headers") or {})
    headers["x-request-id"] = request_id
    finalized["headers"] = headers

    body_text = finalized.get("body")
    if not isinstance(body_text, str) or not body_text:
        return finalized
    try:
        body = json.loads(body_text)
    except json.JSONDecodeError:
        return finalized
    if not isinstance(body, dict) or not isinstance(body.get("error"), dict):
        return finalized

    finalized["body"] = json.dumps(_standard_error_body(body["error"], finalized.get("statusCode"), request_id))
    return finalized


def _standard_error_body(error: Mapping[str, Any], status_code: Any, request_id: str) -> JsonDict:
    code = str(error.get("code") or "internal_server_error")
    retryable, retry_after_ms = _retry_metadata(code, status_code)
    body: JsonDict = {
        "error": {
            "code": code,
            "message": _safe_error_message(code, error.get("message")),
            "request_id": request_id,
            "retryable": retryable,
            "retry_after_ms": retry_after_ms,
        }
    }
    if code == "validation_error":
        details = _safe_validation_details(error.get("details"))
        if details:
            body["error"]["details"] = details
    return body


def _safe_error_message(code: str, fallback: Any) -> str:
    messages = {
        "validation_error": "Request validation failed.",
        "llm_response_error": "Model response could not be processed.",
        "internal_server_error": "An unexpected server error occurred.",
        "unauthorized": "Authentication is required.",
    }
    if code in messages:
        return messages[code]
    return str(fallback) if isinstance(fallback, str) and fallback.strip() else "Request failed."


def _safe_validation_details(details: Any) -> list[JsonDict]:
    if not isinstance(details, list):
        return []
    safe_details: list[JsonDict] = []
    for detail in details:
        if not isinstance(detail, Mapping):
            continue
        safe_detail: JsonDict = {}
        for key in ("type", "loc", "msg"):
            if key in detail:
                safe_detail[key] = detail[key]
        if safe_detail:
            safe_details.append(safe_detail)
    return safe_details


def _retry_metadata(code: str, status_code: Any) -> tuple[bool, int | None]:
    try:
        status = int(status_code)
    except (TypeError, ValueError):
        status = 500
    if code == "llm_response_error" or status in {429, 500, 502, 503}:
        return True, 1000
    return False, None


def _event_method(event: Mapping[str, Any]) -> str:
    request_context = event.get("requestContext") or {}
    http_context = request_context.get("http") or {}
    method = http_context.get("method") or event.get("httpMethod")
    if not isinstance(method, str) or not method.strip():
        raise ValueError("API Gateway event is missing an HTTP method.")
    return method.upper()


def _event_path(event: Mapping[str, Any]) -> str:
    path = event.get("rawPath") or event.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("API Gateway event is missing a path.")
    normalized_path = path.rstrip("/") or "/"
    request_context = event.get("requestContext") or {}
    stage = request_context.get("stage") if isinstance(request_context, Mapping) else None
    if isinstance(stage, str) and stage.strip():
        stage_prefix = f"/{stage.strip()}"
        if normalized_path == stage_prefix:
            return "/"
        if normalized_path.startswith(f"{stage_prefix}/"):
            return normalized_path[len(stage_prefix) :]
    return normalized_path


def _json_body(event: Mapping[str, Any]) -> JsonDict:
    body = event.get("body")
    if body in (None, ""):
        return {}
    if not isinstance(body, str):
        raise ValueError("Request body must be a JSON string.")
    if event.get("isBase64Encoded") is True:
        body = base64.b64decode(body).decode("utf-8")
    decoded = json.loads(body)
    if not isinstance(decoded, dict):
        raise ValueError("Request body JSON must be an object.")
    return decoded


def _matches(path: str, pattern: str) -> bool:
    path_parts = path.strip("/").split("/")
    pattern_parts = pattern.strip("/").split("/")
    if len(path_parts) != len(pattern_parts):
        return False
    return all(
        pattern_part.startswith("{") and pattern_part.endswith("}") or pattern_part == path_part
        for path_part, pattern_part in zip(path_parts, pattern_parts, strict=True)
    )


def _path_value(
    path: str,
    path_parameters: Mapping[str, Any],
    name: str,
    *,
    index: int,
) -> str:
    value = path_parameters.get(name)
    if isinstance(value, str) and value.strip():
        return value.strip()
    parts = path.strip("/").split("/")
    if len(parts) <= index or not parts[index].strip():
        raise ValueError(f"Path parameter {name!r} is missing.")
    return parts[index].strip()


def _optional_limit(event: Mapping[str, Any]) -> int | None:
    query = event.get("queryStringParameters") or {}
    raw_limit = query.get("limit") if isinstance(query, Mapping) else None
    if raw_limit in (None, ""):
        return None
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError) as error:
        raise ValueError("Query parameter 'limit' must be an integer.") from error
    if limit < 1:
        raise ValueError("Query parameter 'limit' must be greater than zero.")
    return limit


def _local_api_key_authorized(event: Mapping[str, Any]) -> bool:
    if not _truthy_env("CHARACTERFORGE_REQUIRE_LOCAL_API_KEY"):
        return True

    expected_key = os.getenv("CHARACTERFORGE_API_KEY", "").strip()
    supplied_key = _header_value(event, "x-api-key")
    if not expected_key or not supplied_key:
        return False
    return hmac.compare_digest(supplied_key, expected_key)


def _header_value(event: Mapping[str, Any], name: str) -> str | None:
    headers = event.get("headers") or {}
    if not isinstance(headers, Mapping):
        return None
    target = name.lower()
    for header_name, header_value in headers.items():
        if isinstance(header_name, str) and header_name.lower() == target:
            return str(header_value).strip() if header_value is not None else None
    return None


def _truthy_env(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes", "on"}


def _character_store() -> CharacterStore:
    global _CHARACTER_STORE
    if _CHARACTER_STORE is None:
        if _use_mock_llm():
            _CHARACTER_STORE = InMemoryCharacterStore()
        else:
            _CHARACTER_STORE = DynamoDBCharacterStore(_required_env("CHARACTERS_TABLE_NAME"))
    return _CHARACTER_STORE


def _session_store() -> SessionStore:
    global _SESSION_STORE
    if _SESSION_STORE is None:
        if _use_mock_llm():
            _SESSION_STORE = InMemorySessionStore()
        else:
            _SESSION_STORE = DynamoDBSessionStore(_required_env("MESSAGES_TABLE_NAME"))
    return _SESSION_STORE


def _llm_client() -> Any:
    global _LLM_CLIENT
    if _LLM_CLIENT is None:
        if _use_mock_llm():
            _LLM_CLIENT = MockLLMClient(include_actions=True)
        else:
            _LLM_CLIENT = BedrockLLMClient(
                model_id=os.getenv("CHARACTERFORGE_BEDROCK_MODEL_ID"),
                region_name=os.getenv("CHARACTERFORGE_BEDROCK_REGION"),
            )
    return _LLM_CLIENT


def _use_mock_llm() -> bool:
    return _truthy_env("USE_MOCK_LLM")


def _history_limit() -> int:
    raw_limit = os.getenv("CHARACTERFORGE_RECENT_HISTORY_LIMIT")
    if raw_limit is None:
        return _DEFAULT_HISTORY_LIMIT
    try:
        limit = int(raw_limit)
    except ValueError:
        return _DEFAULT_HISTORY_LIMIT
    return max(limit, 1)


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ValueError(f"Environment variable {name} is required.")
    return value.strip()


def _error_response(status_code: int, code: str, message: str) -> JsonDict:
    return {
        "statusCode": status_code,
        "headers": _JSON_HEADERS,
        "body": json.dumps({"error": {"code": code, "message": message}}),
    }


def configure_dependencies_for_testing(
    *,
    character_store: CharacterStore | None = None,
    session_store: SessionStore | None = None,
    llm_client: Any | None = None,
) -> Callable[[], None]:
    """Override cached dependencies for Lambda adapter tests and return a reset callback."""
    global _CHARACTER_STORE, _SESSION_STORE, _LLM_CLIENT
    previous = (_CHARACTER_STORE, _SESSION_STORE, _LLM_CLIENT)
    _CHARACTER_STORE = character_store
    _SESSION_STORE = session_store
    _LLM_CLIENT = llm_client

    def reset() -> None:
        global _CHARACTER_STORE, _SESSION_STORE, _LLM_CLIENT
        _CHARACTER_STORE, _SESSION_STORE, _LLM_CLIENT = previous

    return reset
