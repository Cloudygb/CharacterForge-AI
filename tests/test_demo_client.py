import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEMO_CLIENT = REPO_ROOT / "examples" / "game-client-python" / "demo_client.py"


def test_demo_client_creates_character_chats_and_prints_structured_actions() -> None:
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT / "src")}

    result = subprocess.run(
        [sys.executable, str(DEMO_CLIENT)],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    output = result.stdout

    assert "CharacterForge AI local game-client demo" in output
    assert "Created character:" in output
    assert "Captain Mira Voss" in output
    assert "Player message:" in output
    assert "Character dialogue:" in output
    assert "Captain Mira Voss responds to the player in character." in output
    assert "Structured actions returned to the game client:" in output
    assert '"type": "give_quest"' in output
    assert '"payload"' in output
