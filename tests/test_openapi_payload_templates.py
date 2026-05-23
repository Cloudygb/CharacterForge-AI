from pathlib import Path

import yaml

OPENAPI_PATH = Path(__file__).resolve().parents[1] / "openapi.yaml"


def load_openapi() -> dict:
    return yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))


def test_openapi_documents_action_payload_template_schema() -> None:
    spec = load_openapi()
    schemas = spec["components"]["schemas"]

    template_schema = schemas["ActionPayloadTemplate"]

    assert template_schema["required"] == [
        "template_id",
        "action_type",
        "description",
        "payload_template",
    ]
    assert template_schema["properties"]["action_type"] == {
        "$ref": "#/components/schemas/ActionType"
    }
    action_type_schema = schemas["ActionType"]
    assert "enum" not in action_type_schema
    assert action_type_schema["minLength"] == 1
    assert "custom action names" in action_type_schema["description"]
    assert template_schema["properties"]["payload_template"]["additionalProperties"] is True


def test_openapi_attaches_payload_templates_to_character_schemas_and_examples() -> None:
    spec = load_openapi()
    schemas = spec["components"]["schemas"]
    editable_fields = schemas["CharacterEditableFields"]["properties"]
    profile_fields = schemas["CharacterProfile"]["properties"]

    assert editable_fields["payload_templates"]["items"] == {
        "$ref": "#/components/schemas/ActionPayloadTemplate"
    }
    assert profile_fields["payload_templates"]["items"] == {
        "$ref": "#/components/schemas/ActionPayloadTemplate"
    }
    assert "payload_templates" in schemas["CharacterProfile"]["required"]

    create_example = spec["components"]["examples"]["CreateCharacterRequest"]["value"]
    profile_example = spec["components"]["examples"]["CharacterProfile"]["value"]

    assert create_example["payload_templates"][0] == {
        "template_id": "quest_offer",
        "action_type": "give_quest",
        "description": "Payload shape for offering the lost sky map quest.",
        "payload_template": {
            "quest_id": "lost_sky_map",
            "title": "Recover the Lost Sky Map",
            "reward_currency": 150,
        },
    }
    assert profile_example["payload_templates"] == create_example["payload_templates"]
