# Character Pack Guide

Character packs are portable folders that let designers share complete CharacterForge content: pack metadata, one or more character JSON files, designer-approved payload templates, and optional binding files that show how a game can consume the character's actions.

Use a character pack when you want to:

- Ship starter NPCs with a game integration demo.
- Move characters between local development, staging, and deployed CharacterForge APIs.
- Give another designer a folder they can inspect, validate, and import.
- Keep payload templates and game binding examples next to the characters that use them.

This is an end-user guide, so it belongs in the public repo alongside the schema and example pack.

---

## Folder layout

A pack is a directory under `examples/character-packs/` or any folder your own tools scan. The starter example lives at:

```text
examples/character-packs/aether-skies-starter/
├── character-pack.json
├── bindings/
│   └── rpg-binding.json
└── characters/
    └── captain-mira-voss.json
```

The manifest file, `character-pack.json`, contains the pack metadata and file list. Character files contain normal CharacterForge create-character payloads, including any `payload_templates`. Binding files use the existing game binding format from `schemas/game-binding.schema.json`.

---

## Manifest format

Validate pack manifests with:

```text
schemas/character-pack.schema.json
```

Minimum manifest shape:

```json
{
  "$schema": "../../../schemas/character-pack.schema.json",
  "schema_version": "1.0",
  "slug": "aether-skies-starter",
  "name": "Aether Skies Starter Pack",
  "description": "A beginner-friendly skyship adventure pack.",
  "version": "1.0.0",
  "authors": [{ "name": "CharacterForge AI" }],
  "license": "PolyForm Noncommercial License 1.0.0",
  "tags": ["starter", "skyship", "adventure"],
  "characters": [
    {
      "id": "captain-mira-voss",
      "path": "characters/captain-mira-voss.json",
      "name": "Captain Mira Voss"
    }
  ],
  "bindings": [
    {
      "id": "rpg-binding",
      "path": "bindings/rpg-binding.json",
      "name": "Generic RPG Runtime Binding"
    }
  ]
}
```

Important fields:

| Field | Purpose |
| --- | --- |
| `schema_version` | Character pack manifest format version. Use `1.0` for this format. |
| `slug` | Stable lowercase pack ID for imports, exports, and filenames. |
| `version` | Pack version so designers can update packs safely. |
| `authors` | Human-readable creator credits. |
| `characters` | Relative paths to CharacterForge character create payloads. |
| `bindings` | Relative paths to game binding files that map action payloads into game systems. |
| `content_warnings` | Optional player/designer-facing notes about sensitive content. |

Manifest paths are relative to the pack folder. Do not use absolute paths or `..` parent directory references.

---

## Character files and payload templates

Each character file should be valid input for `POST /characters`. That means it can include the same fields shown in the README API examples:

- `name`
- `description`
- `personality`
- `backstory`
- `speaking_style`
- `goals`
- `world_context`
- `rules`
- `allowed_actions`
- `action_rules`
- `payload_templates`

Payload templates are the designer-approved action payloads that the character is allowed to return. Keeping them in the character file makes the pack self-contained.

Example payload template:

```json
{
  "template_id": "mira-give-storm-compass-quest",
  "action_type": "give_quest",
  "description": "Starts Mira's starter quest to recover an imperial storm compass.",
  "payload_template": {
    "quest_id": "aether_skies_storm_compass",
    "title": "Recover the Storm Compass",
    "objective": "Find the imperial storm compass hidden in Dock Seven before Admiralty agents seize it.",
    "giver": "captain_mira_voss"
  }
}
```

Recommended rules for pack authors:

1. Every `payload_templates[].action_type` should appear in `allowed_actions`.
2. Every template action type should have an enabled `action_rules[]` entry.
3. Template IDs should be stable and unique inside one character.
4. Payload field names should be practical for a game client to bind, such as `quest_id`, `item_id`, `flag`, or `encounter_id`.

---

## Binding file

A binding file shows how a game adapter can turn CharacterForge actions into runtime method calls. The starter pack includes:

```text
examples/character-packs/aether-skies-starter/bindings/rpg-binding.json
```

It follows the existing schema:

```text
schemas/game-binding.schema.json
```

For example, Mira's `give_quest` template maps to a generic quest system:

```json
{
  "give_quest": {
    "target": {
      "system": "QuestManager",
      "method": "StartQuest"
    },
    "payload_map": {
      "questId": "payload.quest_id",
      "title": "payload.title",
      "objective": "payload.objective"
    }
  }
}
```

A real game can translate `QuestManager.StartQuest` into a Blueprint event, C# method, C++ function, scripting callback, or message-bus event.

---

## Import flow

A simple importer can follow this Import flow:

1. Read `character-pack.json`.
2. Validate it with `schemas/character-pack.schema.json`.
3. For each entry in `characters`, read the referenced JSON file.
4. Validate the character with the same model/API contract used by `POST /characters`.
5. Optionally read and validate each `bindings` file with `schemas/game-binding.schema.json`.
6. Send each character JSON document to the CharacterForge API.
7. Store the imported character IDs alongside the pack `slug`, pack `version`, and character entry `id` in your own game/editor data.

Example validation command from the repo root:

```bash
python - <<'PY'
import json
from pathlib import Path
from jsonschema import Draft202012Validator
from characterforge.models.character import CreateCharacterRequest

pack_dir = Path("examples/character-packs/aether-skies-starter")
manifest = json.loads((pack_dir / "character-pack.json").read_text())
schema = json.loads(Path("schemas/character-pack.schema.json").read_text())
Draft202012Validator(schema).validate(manifest)

for entry in manifest["characters"]:
    payload = json.loads((pack_dir / entry["path"]).read_text())
    CreateCharacterRequest.model_validate(payload)
    print(f"valid character: {entry['id']}")
PY
```

If the package is not installed in your shell, run the command with `PYTHONPATH=src`.

---

## Starter pack

The first example pack is:

```text
examples/character-packs/aether-skies-starter/character-pack.json
```

It includes `characters/captain-mira-voss.json`, which defines Captain Mira Voss, her allowed action rules, and payload templates for quests, shops, items, flags, reputation, map locations, combat, and cinematic scenes. It also includes `bindings/rpg-binding.json`, which maps those payload templates to a generic RPG runtime.

You can copy the folder to start a new pack, then change the manifest `slug`, pack metadata, character files, payload templates, and binding file targets for your own game.

---

## Local import/export scripts

CharacterForge includes local-first scripts for validating and creating packs from JSON files. They do not require AWS by default.

Dry-run validate an existing pack:

```bash
PYTHONPATH=src python scripts/character_pack_import.py \
  examples/character-packs/aether-skies-starter \
  --dry-run
```

Export a new pack from local character and binding JSON files:

```bash
PYTHONPATH=src python scripts/character_pack_export.py \
  /tmp/my-character-pack \
  --slug my-character-pack \
  --name "My Character Pack" \
  --description "A local JSON character pack." \
  --author "Your Name" \
  --character examples/character-packs/aether-skies-starter/characters/captain-mira-voss.json \
  --binding examples/character-packs/aether-skies-starter/bindings/rpg-binding.json \
  --dry-run
```

Both scripts validate the manifest, character payloads, duplicate IDs, binding file paths, and binding coverage before reporting success.
