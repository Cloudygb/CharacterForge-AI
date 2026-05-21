import copy
import json
from typing import Any

from pydantic import ValidationError

from characterforge.models.action import SUPPORTED_ACTION_TYPES
from characterforge.models.character import CharacterProfile
from characterforge.models.chat import ChatResponse


class LLMResponseParseError(ValueError):
    """Raised when raw LLM output cannot be converted into a valid ChatResponse."""


def parse_chat_response(raw_text: str, character: CharacterProfile) -> ChatResponse:
    """Parse and validate raw model text as a ChatResponse for a specific character."""
    response_data = _load_json_object(raw_text)
    _validate_action_types(response_data, character)
    _apply_payload_templates(response_data, character)

    try:
        return ChatResponse.model_validate(response_data)
    except ValidationError as error:
        raise LLMResponseParseError(
            f"LLM response does not match the required ChatResponse schema: {error}"
        ) from error


def _load_json_object(raw_text: str) -> dict[str, Any]:
    try:
        response_data = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise LLMResponseParseError(
            "LLM response must be valid JSON; "
            f"failed at line {error.lineno}, column {error.colno}: {error.msg}"
        ) from error

    if not isinstance(response_data, dict):
        raise LLMResponseParseError("LLM response JSON must be an object.")
    return response_data


def _validate_action_types(response_data: dict[str, Any], character: CharacterProfile) -> None:
    actions = response_data.get("actions", [])
    if actions is None:
        return
    if not isinstance(actions, list):
        return

    enabled_actions = {rule.type for rule in character.action_rules if rule.enabled}
    for action in actions:
        if not isinstance(action, dict):
            continue
        action_type = action.get("type")
        if action_type not in SUPPORTED_ACTION_TYPES:
            raise LLMResponseParseError(
                f"LLM response contains unsupported action: {action_type!r}."
            )
        if action_type not in enabled_actions:
            raise LLMResponseParseError(
                f"Action {action_type!r} is not enabled for character {character.name}."
            )


def _apply_payload_templates(response_data: dict[str, Any], character: CharacterProfile) -> None:
    actions = response_data.get("actions", [])
    if not isinstance(actions, list):
        return

    templates_by_id = {template.template_id: template for template in character.payload_templates}
    for action in actions:
        if not isinstance(action, dict):
            continue

        template_id = action.get("template_id")
        if template_id is None:
            continue
        if not isinstance(template_id, str):
            continue

        template = templates_by_id.get(template_id)
        if template is None:
            raise LLMResponseParseError(
                f"LLM response contains unknown template_id {template_id!r}."
            )

        action_type = action.get("type")
        if template.action_type != action_type:
            raise LLMResponseParseError(
                f"Template {template_id!r} action type {template.action_type!r} "
                f"does not match action type {action_type!r}."
            )

        action["payload"] = copy.deepcopy(template.payload_template)
        del action["template_id"]
