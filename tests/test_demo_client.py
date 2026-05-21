import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from urllib.error import HTTPError

REPO_ROOT = Path(__file__).resolve().parents[1]
DEMO_CLIENT = REPO_ROOT / "examples" / "game-client-python" / "demo_client.py"


def load_demo_client() -> ModuleType:
    spec = importlib.util.spec_from_file_location("characterforge_demo_client", DEMO_CLIENT)
    if spec is None or spec.loader is None:
        raise AssertionError("Could not load demo_client.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_demo_client_defaults_to_mock_mode_and_dispatches_actions() -> None:
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {"CHARACTERFORGE_API_BASE_URL", "CHARACTERFORGE_API_KEY", "CHARACTERFORGE_DEMO_MODE"}
    }
    env["PYTHONPATH"] = str(REPO_ROOT / "src")

    result = subprocess.run(
        [sys.executable, str(DEMO_CLIENT)],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    output = result.stdout

    assert "CharacterForge AI Python SDK deployed API demo" in output
    assert "Mode: mock" in output
    assert "No network calls were made." in output
    assert "x-api-key" in output
    assert "Quest started:" in output
    assert "Combat encounter started:" in output
    assert "Item granted:" in output
    assert "Flag set:" in output
    assert "Relationship changed:" in output


def test_action_dispatcher_routes_required_action_types() -> None:
    demo_client = load_demo_client()
    game_state = demo_client.GameState()
    dispatcher = demo_client.default_action_dispatcher(game_state)

    actions = [
        {"type": "give_quest", "payload": {"quest_id": "lost_sky_map", "title": "Recover Map"}},
        {"type": "start_combat", "payload": {"encounter_id": "ambush", "enemy": "Sky Raider"}},
        {"type": "give_item", "payload": {"item_id": "storm_compass", "quantity": 1}},
        {"type": "set_flag", "payload": {"flag": "mira_trusts_player", "value": True}},
        {"type": "change_relationship", "payload": {"target": "mira", "delta": 2}},
    ]

    result = dispatcher.dispatch(actions)

    assert result.unhandled == []
    assert [entry.action["type"] for entry in result.handled] == [
        "give_quest",
        "start_combat",
        "give_item",
        "set_flag",
        "change_relationship",
    ]
    assert game_state.quests["lost_sky_map"] == "Recover Map"
    assert game_state.combat_encounters == ["ambush"]
    assert game_state.inventory["storm_compass"] == 1
    assert game_state.flags["mira_trusts_player"] is True
    assert game_state.relationships["mira"] == 2


def test_deployed_api_client_adds_api_key_header_and_posts_chat() -> None:
    demo_client = load_demo_client()

    class FakeResponse:
        status = 200
        reason = "OK"

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self) -> bytes:
            return json.dumps({"message": "Aye.", "actions": []}).encode("utf-8")

    class FakeOpener:
        def __init__(self) -> None:
            self.requests = []

        def open(self, request, timeout=None):
            self.requests.append((request, timeout))
            return FakeResponse()

    opener = FakeOpener()
    client = demo_client.CharacterForgeApiClient(
        "https://api.example.com/dev/",
        api_key="test-api-key",
        opener=opener,
    )

    response = client.chat(
        "char_1",
        {"session_id": "session_1", "player_id": "player_1", "message": "Hello"},
    )

    assert response == {"message": "Aye.", "actions": []}
    request, timeout = opener.requests[0]
    assert timeout == 20
    assert request.full_url == "https://api.example.com/dev/characters/char_1/chat"
    assert request.get_method() == "POST"
    assert request.headers["X-api-key"] == "test-api-key"
    assert request.headers["Content-type"] == "application/json"
    assert json.loads(request.data.decode("utf-8")) == {
        "session_id": "session_1",
        "player_id": "player_1",
        "message": "Hello",
    }


def test_live_mode_requires_base_url_and_api_key_without_calling_network() -> None:
    demo_client = load_demo_client()

    try:
        demo_client.config_from_env({"CHARACTERFORGE_DEMO_MODE": "live"})
    except SystemExit as error:
        assert "CHARACTERFORGE_API_BASE_URL" in str(error)
        assert "CHARACTERFORGE_API_KEY" in str(error)
    else:
        raise AssertionError("live mode should require deployed API settings")


def test_api_client_reports_http_error_without_secret_values() -> None:
    demo_client = load_demo_client()

    class FakeOpener:
        def open(self, request, timeout=None):
            del request, timeout
            raise HTTPError(
                "https://api.example.com/dev/characters/char_1/chat",
                401,
                "Unauthorized",
                {},
                None,
            )

    client = demo_client.CharacterForgeApiClient(
        "https://api.example.com/dev",
        api_key="super-secret-test-key",
        opener=FakeOpener(),
    )

    try:
        client.chat("char_1", {"session_id": "s", "player_id": "p", "message": "Hi"})
    except RuntimeError as error:
        message = str(error)
        assert "401" in message
        assert "super-secret-test-key" not in message
    else:
        raise AssertionError("HTTP errors should raise RuntimeError")
