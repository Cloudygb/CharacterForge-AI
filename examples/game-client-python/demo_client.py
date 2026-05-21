"""Safe Python game-client example for the deployed CharacterForge AI API.

The example is written like a tiny SDK-backed game integration:

- ``CharacterForgeApiClient`` calls the deployed HTTP API with optional ``x-api-key`` support.
- ``ActionDispatcher`` maps returned CharacterForge action types to game-side handlers.
- Mock mode is the default, so running this file never calls the network unless explicitly enabled.

Run safely from the repository root:

    PYTHONPATH=src python examples/game-client-python/demo_client.py

Run against a deployed API only when you intentionally opt in:

    CHARACTERFORGE_DEMO_MODE=live \
    CHARACTERFORGE_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev" \
    CHARACTERFORGE_API_KEY="<your-api-key-value>" \
    PYTHONPATH=src python examples/game-client-python/demo_client.py
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping, MutableMapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, build_opener

JsonDict = dict[str, Any]
ActionHandler = Callable[[Mapping[str, Any]], str]


@dataclass(frozen=True)
class DemoConfig:
    """Runtime settings for the demo client."""

    mode: str = "mock"
    api_base_url: str | None = None
    api_key: str | None = None
    character_id: str = "char_demo_captain_mira_voss"
    session_id: str = "demo-session-001"
    player_id: str = "demo-player-001"
    message: str = "I can help recover the lost sky map. What should I do first?"


@dataclass
class GameState:
    """Small in-memory game state mutated by action handlers."""

    quests: MutableMapping[str, str] = field(default_factory=dict)
    combat_encounters: list[str] = field(default_factory=list)
    inventory: MutableMapping[str, int] = field(default_factory=dict)
    flags: MutableMapping[str, Any] = field(default_factory=dict)
    relationships: MutableMapping[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class HandledAction:
    action: Mapping[str, Any]
    result: str


@dataclass(frozen=True)
class DispatchResult:
    handled: list[HandledAction]
    unhandled: list[Mapping[str, Any]]


class UrlOpener(Protocol):
    """Protocol for urllib opener injection in tests."""

    def open(self, request: Request, timeout: int | None = None) -> Any:
        """Open a urllib request."""


class CharacterForgeApiClient:
    """Minimal deployed CharacterForge HTTP API client using the Python standard library."""

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        opener: UrlOpener | None = None,
        timeout: int = 20,
    ) -> None:
        if not base_url.strip():
            raise ValueError("base_url must be a non-empty deployed API URL")
        self.base_url = base_url.rstrip("/") + "/"
        self.api_key = api_key.strip() if api_key else None
        self.opener = opener or build_opener()
        self.timeout = timeout

    def chat(self, character_id: str, payload: Mapping[str, Any]) -> JsonDict:
        """Send one chat turn to POST /characters/{character_id}/chat."""
        path = f"characters/{quote(character_id, safe='')}/chat"
        return self._request("POST", path, payload)

    def _request(
        self, method: str, path: str, payload: Mapping[str, Any] | None = None
    ) -> JsonDict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["x-api-key"] = self.api_key

        request = Request(
            urljoin(self.base_url, path),
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                return _decode_json_response(response.read())
        except HTTPError as error:
            raise RuntimeError(
                f"CharacterForge API returned HTTP {error.code}: {error.reason}"
            ) from error
        except URLError as error:
            raise RuntimeError(f"Could not reach CharacterForge API: {error.reason}") from error


class ActionDispatcher:
    """Map returned action types to user-provided game handlers."""

    def __init__(self, handlers: Mapping[str, ActionHandler] | None = None) -> None:
        self._handlers: dict[str, ActionHandler] = dict(handlers or {})

    def register(self, action_type: str, handler: ActionHandler) -> None:
        self._handlers[action_type] = handler

    def dispatch(self, actions: Sequence[Mapping[str, Any]] | None) -> DispatchResult:
        handled: list[HandledAction] = []
        unhandled: list[Mapping[str, Any]] = []
        for action in actions or []:
            action_type = str(action.get("type", ""))
            handler = self._handlers.get(action_type)
            if handler is None:
                unhandled.append(action)
                continue
            payload = _payload(action)
            handled.append(HandledAction(action=action, result=handler(payload)))
        return DispatchResult(handled=handled, unhandled=unhandled)


def config_from_env(env: Mapping[str, str] | None = None) -> DemoConfig:
    """Create config from environment variables; mock mode is safe default."""
    source = env or os.environ
    mode = source.get("CHARACTERFORGE_DEMO_MODE", "mock").strip().lower() or "mock"
    if mode not in {"mock", "live"}:
        raise SystemExit("CHARACTERFORGE_DEMO_MODE must be 'mock' or 'live'.")

    api_base_url = _optional_env(source, "CHARACTERFORGE_API_BASE_URL")
    api_key = _optional_env(source, "CHARACTERFORGE_API_KEY")
    if mode == "live" and (api_base_url is None or api_key is None):
        raise SystemExit(
            "Live mode requires CHARACTERFORGE_API_BASE_URL and CHARACTERFORGE_API_KEY. "
            "Mock mode is the default and does not call the network."
        )

    return DemoConfig(
        mode=mode,
        api_base_url=api_base_url,
        api_key=api_key,
        character_id=source.get("CHARACTERFORGE_DEMO_CHARACTER_ID", "char_demo_captain_mira_voss"),
        session_id=source.get("CHARACTERFORGE_DEMO_SESSION_ID", "demo-session-001"),
        player_id=source.get("CHARACTERFORGE_DEMO_PLAYER_ID", "demo-player-001"),
        message=source.get(
            "CHARACTERFORGE_DEMO_MESSAGE",
            "I can help recover the lost sky map. What should I do first?",
        ),
    )


def default_action_dispatcher(game_state: GameState) -> ActionDispatcher:
    """Build dispatcher with common game action handlers wired in."""

    def give_quest(payload: Mapping[str, Any]) -> str:
        quest_id = str(payload.get("quest_id") or payload.get("id") or "unknown_quest")
        title = str(payload.get("title") or quest_id)
        game_state.quests[quest_id] = title
        return f"Quest started: {title} ({quest_id})"

    def start_combat(payload: Mapping[str, Any]) -> str:
        encounter_id = str(
            payload.get("encounter_id") or payload.get("enemy") or "unknown_encounter"
        )
        game_state.combat_encounters.append(encounter_id)
        enemy = payload.get("enemy", "unknown enemy")
        return f"Combat encounter started: {encounter_id} vs {enemy}"

    def give_item(payload: Mapping[str, Any]) -> str:
        item_id = str(payload.get("item_id") or payload.get("id") or "unknown_item")
        quantity = int(payload.get("quantity", 1))
        game_state.inventory[item_id] = game_state.inventory.get(item_id, 0) + quantity
        return f"Item granted: {quantity}x {item_id}"

    def set_flag(payload: Mapping[str, Any]) -> str:
        flag = str(payload.get("flag") or payload.get("flag_id") or "unknown_flag")
        value = payload.get("value", True)
        game_state.flags[flag] = value
        return f"Flag set: {flag}={value}"

    def change_relationship(payload: Mapping[str, Any]) -> str:
        target = str(payload.get("target") or payload.get("npc_id") or "character")
        delta = int(payload.get("delta", payload.get("amount", 0)))
        game_state.relationships[target] = game_state.relationships.get(target, 0) + delta
        return f"Relationship changed: {target} {delta:+d}"

    return ActionDispatcher(
        {
            "give_quest": give_quest,
            "start_combat": start_combat,
            "give_item": give_item,
            "set_flag": set_flag,
            "change_relationship": change_relationship,
        }
    )


def run_demo(config: DemoConfig) -> None:
    """Run one safe mock or opt-in live deployed API chat turn and dispatch actions."""
    chat_payload = {
        "session_id": config.session_id,
        "player_id": config.player_id,
        "message": config.message,
        "context": {
            "location": "Harbor of Kites",
            "scene_tags": ["sdk_example", "action_dispatch"],
        },
    }

    if config.mode == "live":
        assert config.api_base_url is not None
        client = CharacterForgeApiClient(config.api_base_url, api_key=config.api_key)
        chat_body = client.chat(config.character_id, chat_payload)
        safety_note = "Live deployed API request sent with x-api-key support."
    else:
        chat_body = mock_chat_response()
        safety_note = "No network calls were made. Set CHARACTERFORGE_DEMO_MODE=live to opt in."

    game_state = GameState()
    dispatcher = default_action_dispatcher(game_state)
    dispatch_result = dispatcher.dispatch(chat_body.get("actions", []))

    print("CharacterForge AI Python SDK deployed API demo")
    print("=" * 52)
    print(f"Mode: {config.mode}")
    print(safety_note)
    print("The deployed API client sends x-api-key when CHARACTERFORGE_API_KEY is configured.")
    print(f"Character ID: {config.character_id}")
    print(f"Player message: {chat_payload['message']}")
    print()
    print("Character dialogue:")
    print(chat_body.get("message", ""))
    print()
    print("Dispatched game actions:")
    for entry in dispatch_result.handled:
        print(f"- {entry.result}")
    for action in dispatch_result.unhandled:
        print(f"- Unhandled action: {action.get('type')}")


def mock_chat_response() -> JsonDict:
    """Return a deterministic deployed-API-shaped chat response for safe demo runs."""
    return {
        "message": "Brave offer. Take the storm compass, mark my trust, and brace for raiders.",
        "emotion": "focused",
        "actions": [
            {
                "type": "give_quest",
                "payload": {"quest_id": "lost_sky_map", "title": "Recover the Lost Sky Map"},
            },
            {
                "type": "start_combat",
                "payload": {"encounter_id": "dock_raiders", "enemy": "Sky Raider"},
            },
            {"type": "give_item", "payload": {"item_id": "storm_compass", "quantity": 1}},
            {"type": "set_flag", "payload": {"flag": "mira_trusts_player", "value": True}},
            {"type": "change_relationship", "payload": {"target": "mira", "delta": 2}},
        ],
        "relationship_delta": 2,
        "token_usage": None,
    }


def _decode_json_response(raw_body: bytes) -> JsonDict:
    if not raw_body:
        return {}
    decoded = json.loads(raw_body.decode("utf-8"))
    if not isinstance(decoded, dict):
        raise RuntimeError("CharacterForge API returned a non-object JSON response.")
    return decoded


def _payload(action: Mapping[str, Any]) -> Mapping[str, Any]:
    payload = action.get("payload", {})
    if isinstance(payload, Mapping):
        return payload
    return {}


def _optional_env(source: Mapping[str, str], name: str) -> str | None:
    value = source.get(name)
    if value is None or not value.strip():
        return None
    return value.strip()


def main() -> None:
    run_demo(config_from_env())


if __name__ == "__main__":
    main()
