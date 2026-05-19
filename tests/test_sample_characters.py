import json
from pathlib import Path

from characterforge.models.character import CreateCharacterRequest

SAMPLES_DIR = Path(__file__).resolve().parents[1] / "examples" / "sample-characters"


def test_sample_character_profiles_are_valid_create_payloads() -> None:
    sample_paths = sorted(SAMPLES_DIR.glob("*.json"))

    assert sample_paths, "Expected at least one sample character profile."
    for path in sample_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        profile = CreateCharacterRequest.model_validate(payload)
        assert profile.name
        assert profile.action_rules
