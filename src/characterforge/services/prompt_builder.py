import json
from collections.abc import Sequence

from characterforge.models.character import CharacterProfile
from characterforge.models.chat import ChatRequest, MessageRecord


def build_bedrock_prompt(
    character: CharacterProfile,
    chat_request: ChatRequest,
    recent_messages: Sequence[MessageRecord],
) -> str:
    """Build the complete prompt sent to Amazon Bedrock for a character chat turn."""

    enabled_action_rules = [rule for rule in character.action_rules if rule.enabled]
    enabled_action_types = {rule.type for rule in enabled_action_rules}
    approved_payload_templates = [
        template
        for template in character.payload_templates
        if template.action_type in enabled_action_types
    ]
    game_context = json.dumps(chat_request.context, indent=2, sort_keys=True)
    response_schema = json.dumps(
        {
            "message": "In-character dialogue to show the player.",
            "emotion": "Optional short emotion label, or null.",
            "actions": [
                {
                    "type": "One enabled action type from the action rules, or omit actions.",
                    "template_id": (
                        "One approved template_id for this action type, or omit when no action "
                        "is triggered."
                    ),
                    "payload": "Exact payload_template object from the selected approved template.",
                }
            ],
            "relationship_delta": "Optional integer relationship change, or null.",
        },
        indent=2,
    )

    return "\n".join(
        [
            "You are the roleplay engine for CharacterForge AI.",
            "Use the character profile, game context, conversation history, and action rules ",
            "to produce one Bedrock-ready structured response for the current player message.",
            "",
            "## Character Profile",
            f"Name: {character.name}",
            f"Description: {character.description}",
            f"Personality: {_format_bullets(character.personality)}",
            f"Backstory: {character.backstory}",
            f"Speaking style: {character.speaking_style}",
            f"Goals: {_format_bullets(character.goals)}",
            f"World context: {character.world_context}",
            f"Roleplay rules: {_format_bullets(character.rules)}",
            "",
            "## Current Game Context",
            game_context,
            "",
            "## Recent Conversation",
            _format_recent_messages(character.name, recent_messages),
            "",
            "## Enabled Action Rules",
            _format_action_rules(enabled_action_rules),
            "",
            "## Approved Payload Templates",
            "Choose only from these approved payload templates when triggering an action.",
            "Return the selected template_id with the action.",
            (
                "Return the exact payload_template object as the action payload; do not invent or "
                "rename payload fields."
            ),
            _format_payload_templates(approved_payload_templates),
            "",
            "## Current Player Message",
            f"Current player message: {chat_request.message}",
            "",
            "## Required JSON Response Schema",
            "Return only valid JSON matching this schema:",
            response_schema,
            "Do not wrap the JSON in Markdown or add prose outside the JSON object.",
        ]
    )


def _format_bullets(items: Sequence[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def _format_recent_messages(character_name: str, messages: Sequence[MessageRecord]) -> str:
    if not messages:
        return "No prior messages in this session."

    lines = []
    for message in messages:
        match message.role:
            case "player":
                speaker = "Player"
            case "assistant":
                speaker = character_name
            case "system":
                speaker = "System"
        lines.append(f"{speaker}: {message.content}")
    return "\n".join(lines)


def _format_action_rules(action_rules: Sequence[object]) -> str:
    if not action_rules:
        return "No actions are enabled for this character. Return an empty actions array."

    return "\n".join(f"- {rule.type}: {rule.trigger_instructions}" for rule in action_rules)


def _format_payload_templates(payload_templates: Sequence[object]) -> str:
    if not payload_templates:
        return "No approved payload templates are available. Return an empty actions array."

    lines = []
    for template in payload_templates:
        payload_json = json.dumps(template.payload_template, indent=2, sort_keys=True)
        lines.append(
            "\n".join(
                [
                    f"- template_id: {template.template_id}",
                    f"  action_type: {template.action_type}",
                    f"  description: {template.description}",
                    "  payload_template:",
                    _indent(payload_json, spaces=4),
                ]
            )
        )
    return "\n".join(lines)


def _indent(text: str, *, spaces: int) -> str:
    prefix = " " * spaces
    return "\n".join(f"{prefix}{line}" for line in text.splitlines())
