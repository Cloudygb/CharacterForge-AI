import json
import re


class MockLLMClient:
    """Deterministic local LLM stand-in for tests and offline chat flow development."""

    def __init__(self, *, include_actions: bool = False) -> None:
        self.include_actions = include_actions

    def generate(self, prompt: str) -> str:
        """Return ChatResponse-compatible JSON without calling AWS Bedrock."""
        character_name = _extract_character_name(prompt)
        actions = []
        if self.include_actions:
            action_type = _extract_first_enabled_action_type(prompt)
            if action_type is not None:
                actions.append({"type": action_type, "payload": {"mock": True}})

        return json.dumps(
            {
                "message": f"{character_name} responds to the player in character.",
                "emotion": "calm",
                "actions": actions,
                "relationship_delta": 0,
            },
            sort_keys=True,
        )


def _extract_character_name(prompt: str) -> str:
    match = re.search(r"^Name: (?P<name>.+)$", prompt, flags=re.MULTILINE)
    if match is None:
        return "The character"
    return match.group("name").strip()


def _extract_first_enabled_action_type(prompt: str) -> str | None:
    match = re.search(r"^- (?P<action_type>[a-z_]+): .+$", prompt, flags=re.MULTILINE)
    if match is None:
        return None
    return match.group("action_type")
