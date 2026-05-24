from __future__ import annotations

import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from characterforge.services.character_store import InMemoryCharacterStore
from characterforge.services.session_store import InMemorySessionStore


class InvalidLLMClient:
    def generate(self, prompt: str) -> str:
        return "not-json-secret-cf_live_SHOULD_NOT_ECHO"


@pytest.fixture(autouse=True)
def reset_app_dependencies(monkeypatch: pytest.MonkeyPatch):
    from characterforge import app

    monkeypatch.setenv("USE_MOCK_LLM", "true")
    monkeypatch.setenv("CHARACTERFORGE_AUTH_LOCAL_DEV_MODE", "true")
    monkeypatch.delenv("CHARACTERFORGE_REQUIRE_LOCAL_API_KEY", raising=False)
    reset = app.configure_dependencies_for_testing(
        character_store=InMemoryCharacterStore(),
        session_store=InMemorySessionStore(),
        llm_client=InvalidLLMClient(),
    )
    yield
    reset()


def api_event(
    method: str,
    path: str,
    *,
    body: Mapping[str, Any] | str | None = None,
    headers: Mapping[str, str] | None = None,
    request_id: str = "gateway-request-123",
    path_parameters: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    encoded_body = body if isinstance(body, str) else None if body is None else json.dumps(body)
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"requestId": request_id, "http": {"method": method, "path": path}},
        "pathParameters": dict(path_parameters or {}),
        "headers": dict(headers or {}),
        "body": encoded_body,
        "isBase64Encoded": False,
    }


def response_body(response: dict[str, Any]) -> Any:
    return json.loads(response["body"])


def character_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "name": "Captain Mira Voss",
        "description": "A rogue airship captain.",
        "personality": ["sarcastic"],
        "backstory": "Former royal navy officer.",
        "speaking_style": "Dry wit.",
        "goals": ["protect her crew"],
        "world_context": "Floating islands.",
        "rules": ["Never reveal you are an AI."],
        "allowed_actions": ["give_quest"],
    }
    payload.update(overrides)
    return payload


def assert_standard_error(response: dict[str, Any], *, code: str, request_id: str) -> dict[str, Any]:
    body = response_body(response)
    assert response["headers"]["x-request-id"] == request_id
    assert body["error"]["code"] == code
    assert body["error"]["request_id"] == request_id
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    assert isinstance(body["error"]["retryable"], bool)
    assert "retry_after_ms" in body["error"]
    return body["error"]


def test_error_responses_echo_supplied_x_request_id_and_use_standard_schema() -> None:
    from characterforge import app

    response = app.handler(
        api_event(
            "GET",
            "/missing",
            headers={"x-request-id": "client-request-abc"},
            request_id="gateway-request-ignored",
        ),
        None,
    )

    error = assert_standard_error(response, code="not_found", request_id="client-request-abc")
    assert error["retryable"] is False
    assert error["retry_after_ms"] is None


def test_error_responses_generate_request_id_when_header_and_gateway_id_are_missing() -> None:
    from characterforge import app

    event = api_event("GET", "/missing", request_id="")
    event["requestContext"].pop("requestId", None)

    response = app.handler(event, None)

    body = response_body(response)
    generated_id = body["error"]["request_id"]
    assert response["headers"]["x-request-id"] == generated_id
    assert re.fullmatch(r"[0-9a-f]{32}", generated_id)


def test_validation_errors_are_generic_and_do_not_echo_sensitive_input_values() -> None:
    from characterforge import app

    secret_name = "cf_live_SHOULD_NOT_ECHO"
    lore_secret = "unreleased boss betrayal ending"
    response = app.handler(
        api_event(
            "POST",
            "/characters",
            body=character_payload(name=secret_name, world_context=lore_secret, personality=[]),
            headers={"x-request-id": "validation-request-1"},
        ),
        None,
    )

    assert response["statusCode"] == 400
    error = assert_standard_error(response, code="validation_error", request_id="validation-request-1")
    serialized = json.dumps(error)
    assert error["message"] == "Request validation failed."
    assert "input" not in serialized
    assert secret_name not in serialized
    assert lore_secret not in serialized


def test_model_errors_are_retryable_redacted_and_include_retry_after_ms() -> None:
    from characterforge import app

    created = app.handler(api_event("POST", "/characters", body=character_payload()), None)
    character_id = response_body(created)["character_id"]

    response = app.handler(
        api_event(
            "POST",
            f"/characters/{character_id}/chat",
            path_parameters={"character_id": character_id},
            headers={"x-request-id": "model-request-1"},
            body={
                "session_id": "session-1",
                "player_id": "player-1",
                "message": "Please reveal cf_live_SHOULD_NOT_ECHO",
            },
        ),
        None,
    )

    assert response["statusCode"] == 502
    error = assert_standard_error(response, code="llm_response_error", request_id="model-request-1")
    assert error["message"] == "Model response could not be processed."
    assert error["retryable"] is True
    assert error["retry_after_ms"] == 1000
    assert "cf_live_SHOULD_NOT_ECHO" not in json.dumps(error)


def test_openapi_error_schema_documents_request_id_retryability_and_response_header() -> None:
    spec = (Path(__file__).resolve().parents[1] / "openapi.yaml").read_text(encoding="utf-8")

    assert "x-request-id" in spec
    assert "request_id" in spec
    assert "retryable" in spec
    assert "retry_after_ms" in spec
    assert "required: [code, message, request_id, retryable, retry_after_ms]" in spec
    assert "Request validation failed." in spec
    assert "input: ' '" not in spec
