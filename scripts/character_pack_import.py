#!/usr/bin/env python3
"""Validate CharacterForge character packs from local JSON files.

The importer is intentionally local-first: it validates pack JSON, characters, and
bindings without contacting AWS. Future API/AWS import steps should stay opt-in.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, ValidationError

from characterforge.models.character import CreateCharacterRequest

REPO_ROOT = Path(__file__).resolve().parents[1]
PACK_SCHEMA_PATH = REPO_ROOT / "schemas" / "character-pack.schema.json"
GAME_BINDING_SCHEMA_PATH = REPO_ROOT / "schemas" / "game-binding.schema.json"
MANIFEST_NAME = "character-pack.json"


class CharacterPackValidationError(ValueError):
    """Raised when a local character pack fails validation."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise CharacterPackValidationError(f"missing JSON file: {path}") from error
    except json.JSONDecodeError as error:
        raise CharacterPackValidationError(
            f"invalid JSON in {path}: line {error.lineno}, column {error.colno}"
        ) from error
    if not isinstance(data, dict):
        raise CharacterPackValidationError(f"JSON document must be an object: {path}")
    return data


def _relative_file(pack_dir: Path, relative_path: str, *, label: str) -> Path:
    candidate = (pack_dir / relative_path).resolve()
    pack_root = pack_dir.resolve()
    if pack_root not in candidate.parents and candidate != pack_root:
        raise CharacterPackValidationError(f"{label} path escapes pack directory: {relative_path}")
    if not candidate.exists():
        raise CharacterPackValidationError(f"missing {label} file: {relative_path}")
    if not candidate.is_file():
        raise CharacterPackValidationError(f"{label} path is not a file: {relative_path}")
    return candidate


def _validate_schema(schema_path: Path, document: dict[str, Any], *, label: str) -> None:
    schema = load_json(schema_path)
    try:
        Draft202012Validator(schema).validate(document)
    except ValidationError as error:
        path = ".".join(str(part) for part in error.absolute_path) or "<root>"
        raise CharacterPackValidationError(
            f"{label} schema validation failed at {path}: {error.message}"
        ) from error


def _ensure_unique_ids(entries: list[dict[str, Any]], *, label: str) -> list[str]:
    seen: set[str] = set()
    ids: list[str] = []
    for entry in entries:
        entry_id = str(entry.get("id", ""))
        if entry_id in seen:
            raise CharacterPackValidationError(f"duplicate {label} id: {entry_id}")
        seen.add(entry_id)
        ids.append(entry_id)
    return ids


def validate_pack(pack_dir: str | Path, *, dry_run: bool = True) -> dict[str, Any]:
    """Validate a character pack folder without requiring AWS.

    Returns a small summary suitable for CLI output or tests. The function only reads
    local JSON files and validates them against the pack schema, character model, and
    game binding schema.
    """

    pack_root = Path(pack_dir).resolve()
    manifest_path = pack_root / MANIFEST_NAME
    manifest = load_json(manifest_path)
    _validate_schema(PACK_SCHEMA_PATH, manifest, label="manifest")

    character_entries = manifest.get("characters", [])
    binding_entries = manifest.get("bindings", [])
    character_ids = _ensure_unique_ids(character_entries, label="character")
    binding_ids = _ensure_unique_ids(binding_entries, label="binding")

    template_action_types: set[str] = set()
    for entry in character_entries:
        character_path = _relative_file(pack_root, entry["path"], label="character")
        character_payload = load_json(character_path)
        try:
            character = CreateCharacterRequest.model_validate(character_payload)
        except ValueError as error:
            raise CharacterPackValidationError(
                f"invalid character file {entry['path']}: {error}"
            ) from error

        allowed_actions = set(character.allowed_actions)
        rule_types = {rule.type for rule in character.action_rules}
        enabled_rule_types = {rule.type for rule in character.action_rules if rule.enabled}
        for template in character.payload_templates:
            if template.action_type not in allowed_actions:
                raise CharacterPackValidationError(
                    f"payload template action not allowed in {entry['path']}: "
                    f"{template.action_type}"
                )
            if template.action_type not in enabled_rule_types:
                raise CharacterPackValidationError(
                    f"payload template action has no enabled rule in {entry['path']}: "
                    f"{template.action_type}"
                )
            template_action_types.add(template.action_type)
        missing_rules = rule_types - allowed_actions
        if missing_rules:
            raise CharacterPackValidationError(
                f"action rule not allowed in {entry['path']}: {sorted(missing_rules)}"
            )

    mapped_action_types: set[str] = set()
    for entry in binding_entries:
        binding_path = _relative_file(pack_root, entry["path"], label="binding")
        binding = load_json(binding_path)
        _validate_schema(GAME_BINDING_SCHEMA_PATH, binding, label="binding")
        mapped_action_types.update(binding["bindings"].keys())

    missing_bindings = template_action_types - mapped_action_types
    if binding_entries and missing_bindings:
        raise CharacterPackValidationError(
            f"missing binding references for action types: {sorted(missing_bindings)}"
        )

    return {
        "status": "valid",
        "dry_run": dry_run,
        "aws_required": False,
        "slug": manifest["slug"],
        "characters": character_ids,
        "bindings": binding_ids,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a local CharacterForge character pack without AWS."
    )
    parser.add_argument("pack_dir", type=Path, help="Folder containing character-pack.json")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Validate local files only. This is the default and never requires AWS.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = validate_pack(args.pack_dir, dry_run=args.dry_run)
    except CharacterPackValidationError as error:
        print(f"invalid: {error}")
        return 1

    print(f"valid: {result['slug']}")
    print(f"dry_run={result['dry_run']}")
    print(f"aws_required={result['aws_required']}")
    print(f"characters={','.join(result['characters'])}")
    print(f"bindings={','.join(result['bindings'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
