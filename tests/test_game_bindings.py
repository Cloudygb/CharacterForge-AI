import json
from pathlib import Path

from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "schemas" / "game-binding.schema.json"
SAMPLE_PATH = REPO_ROOT / "examples" / "game-bindings" / "rpg-binding.json"
GUIDE_PATH = REPO_ROOT / "docs" / "game-bindings.md"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_game_binding_schema_is_valid_json_schema() -> None:
    schema = load_json(SCHEMA_PATH)

    Draft202012Validator.check_schema(schema)
    assert schema["$id"].endswith("game-binding.schema.json")
    assert schema["title"] == "CharacterForge Game Binding"


def test_sample_game_binding_validates_against_schema() -> None:
    schema = load_json(SCHEMA_PATH)
    sample = load_json(SAMPLE_PATH)

    Draft202012Validator(schema).validate(sample)


def test_sample_game_binding_maps_characterforge_actions_to_game_systems() -> None:
    sample = load_json(SAMPLE_PATH)
    bindings = sample["bindings"]

    expected_targets = {
        "give_quest": ("QuestManager", "StartQuest"),
        "start_combat": ("CombatManager", "StartEncounter"),
        "give_item": ("Inventory", "AddItem"),
        "start_dialogue": ("Dialogue", "StartBranch"),
        "set_flag": ("Flags", "Set"),
    }

    for action_type, (system, method) in expected_targets.items():
        target = bindings[action_type]["target"]
        assert target == {"system": system, "method": method}
        assert bindings[action_type]["payload_map"]


def test_game_binding_guide_documents_schema_sample_and_runtime_mapping() -> None:
    guide = GUIDE_PATH.read_text(encoding="utf-8")

    assert "Game Binding Guide" in guide
    assert "schemas/game-binding.schema.json" in guide
    assert "examples/game-bindings/rpg-binding.json" in guide
    for phrase in [
        "QuestManager.StartQuest",
        "CombatManager.StartEncounter",
        "Inventory.AddItem",
        "Dialogue.StartBranch",
        "Flags.Set",
    ]:
        assert phrase in guide
