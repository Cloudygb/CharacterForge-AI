import json
from pathlib import Path

from jsonschema import Draft202012Validator

from characterforge.models.character import CreateCharacterRequest

REPO_ROOT = Path(__file__).resolve().parents[1]
PACK_SCHEMA_PATH = REPO_ROOT / "schemas" / "character-pack.schema.json"
GAME_BINDING_SCHEMA_PATH = REPO_ROOT / "schemas" / "game-binding.schema.json"
PACK_DIR = REPO_ROOT / "examples" / "character-packs" / "aether-skies-starter"
PACK_MANIFEST_PATH = PACK_DIR / "character-pack.json"
GUIDE_PATH = REPO_ROOT / "docs" / "character-packs.md"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_character_pack_schema_is_valid_json_schema() -> None:
    schema = load_json(PACK_SCHEMA_PATH)

    Draft202012Validator.check_schema(schema)
    assert schema["$id"].endswith("character-pack.schema.json")
    assert schema["title"] == "CharacterForge Character Pack"


def test_aether_skies_pack_manifest_validates_against_schema() -> None:
    schema = load_json(PACK_SCHEMA_PATH)
    manifest = load_json(PACK_MANIFEST_PATH)

    Draft202012Validator(schema).validate(manifest)
    assert manifest["slug"] == "aether-skies-starter"
    assert manifest["schema_version"] == "1.0"
    assert manifest["characters"]
    assert manifest["bindings"]


def test_aether_skies_pack_characters_are_valid_create_payloads() -> None:
    manifest = load_json(PACK_MANIFEST_PATH)

    for entry in manifest["characters"]:
        character_path = PACK_DIR / entry["path"]
        character_payload = load_json(character_path)
        character = CreateCharacterRequest.model_validate(character_payload)

        allowed_actions = set(character.allowed_actions)
        rule_types = {rule.type for rule in character.action_rules}
        template_types = {template.action_type for template in character.payload_templates}
        enabled_action_types = {rule.type for rule in character.action_rules if rule.enabled}

        assert character.payload_templates, f"{character_path} must include payload templates"
        assert rule_types <= allowed_actions
        assert template_types <= allowed_actions
        assert template_types <= enabled_action_types


def test_aether_skies_pack_binding_file_validates_and_maps_payload_templates() -> None:
    manifest = load_json(PACK_MANIFEST_PATH)
    binding_schema = load_json(GAME_BINDING_SCHEMA_PATH)
    template_action_types: set[str] = set()

    for entry in manifest["characters"]:
        character = CreateCharacterRequest.model_validate(load_json(PACK_DIR / entry["path"]))
        template_action_types.update(
            template.action_type for template in character.payload_templates
        )

    for binding_entry in manifest["bindings"]:
        binding = load_json(PACK_DIR / binding_entry["path"])
        Draft202012Validator(binding_schema).validate(binding)

        bindings = binding["bindings"]
        for action_type in template_action_types:
            assert action_type in bindings
            assert bindings[action_type]["target"]
            assert bindings[action_type]["payload_map"]


def test_character_pack_guide_documents_end_user_pack_workflow() -> None:
    guide = GUIDE_PATH.read_text(encoding="utf-8")

    assert "Character Pack Guide" in guide
    assert "schemas/character-pack.schema.json" in guide
    assert "examples/character-packs/aether-skies-starter/character-pack.json" in guide
    assert "characters/captain-mira-voss.json" in guide
    assert "bindings/rpg-binding.json" in guide
    for phrase in [
        "pack metadata",
        "payload templates",
        "binding file",
        "Import flow",
    ]:
        assert phrase in guide
