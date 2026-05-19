"""Local game-client demo for CharacterForge AI.

This example intentionally uses the in-process handler functions and in-memory
stores. It mirrors how a game or web client would call the future HTTP API:
create a character, send player dialogue, then read dialogue plus structured
actions from the response body.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from characterforge.handlers.characters import create_character
from characterforge.handlers.chat import chat_with_character
from characterforge.services.character_store import InMemoryCharacterStore
from characterforge.services.llm_client import MockLLMClient
from characterforge.services.session_store import InMemorySessionStore

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_CHARACTER_PATH = REPO_ROOT / "examples" / "sample-characters" / "captain-mira-voss.json"


def main() -> None:
    """Run an end-to-end local client flow using API-style handler functions."""
    character_store = InMemoryCharacterStore()
    session_store = InMemorySessionStore()
    llm_client = MockLLMClient(include_actions=True)

    character_payload = _load_sample_character()
    create_response = create_character(character_payload, character_store)
    created_character = _json_body(create_response)

    chat_payload = {
        "character_id": created_character["character_id"],
        "session_id": "demo-session-001",
        "player_id": "demo-player-001",
        "message": "I can help recover the lost sky map. What do you need me to do first?",
        "context": {
            "location": "Harbor of Kites",
            "player_reputation": "new but helpful",
            "scene_tags": ["skyship_dock", "quest_offer"],
        },
    }
    chat_response = chat_with_character(
        chat_payload,
        character_store,
        session_store,
        llm_client,
    )
    chat_body = _json_body(chat_response)

    print("CharacterForge AI local game-client demo")
    print("=" * 44)
    print(f"Created character: {created_character['name']} ({created_character['character_id']})")
    print(f"Player message: {chat_payload['message']}")
    print()
    print("Character dialogue:")
    print(chat_body["message"])
    print()
    print("Structured actions returned to the game client:")
    print(json.dumps(chat_body["actions"], indent=2, sort_keys=True))


def _load_sample_character() -> dict[str, Any]:
    return json.loads(SAMPLE_CHARACTER_PATH.read_text(encoding="utf-8"))


def _json_body(response: dict[str, Any]) -> dict[str, Any]:
    status_code = response["statusCode"]
    body = json.loads(response["body"])
    if status_code >= 400:
        raise RuntimeError(f"Handler returned {status_code}: {body}")
    return body


if __name__ == "__main__":
    main()
