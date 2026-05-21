#!/usr/bin/env python3
"""Export local CharacterForge JSON files into a character pack folder.

The exporter copies local character and binding JSON files into a portable pack and
validates the result. It does not contact AWS by default.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from characterforge.models.character import CreateCharacterRequest

try:  # pragma: no cover - exercised through import and direct CLI execution
    from scripts.character_pack_import import CharacterPackValidationError, validate_pack
except ModuleNotFoundError:  # pragma: no cover
    from character_pack_import import CharacterPackValidationError, validate_pack


def _slug_from_path(path: Path) -> str:
    return path.stem.lower().replace("_", "-")


def _load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise CharacterPackValidationError(f"missing source file: {path}") from error
    except json.JSONDecodeError as error:
        raise CharacterPackValidationError(
            f"invalid JSON in {path}: line {error.lineno}, column {error.colno}"
        ) from error
    if not isinstance(data, dict):
        raise CharacterPackValidationError(f"JSON source must be an object: {path}")
    return data


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _copy_character(source: Path, destination_dir: Path) -> dict[str, str]:
    payload = _load_json(source)
    try:
        character = CreateCharacterRequest.model_validate(payload)
    except ValueError as error:
        raise CharacterPackValidationError(f"invalid character source {source}: {error}") from error

    file_name = f"{_slug_from_path(source)}.json"
    relative_path = f"characters/{file_name}"
    _write_json(destination_dir / relative_path, payload)
    return {
        "id": _slug_from_path(source),
        "path": relative_path,
        "name": character.name,
        "description": character.description,
    }


def _copy_binding(source: Path, destination_dir: Path) -> dict[str, str]:
    payload = _load_json(source)
    file_name = f"{_slug_from_path(source)}.json"
    relative_path = f"bindings/{file_name}"
    _write_json(destination_dir / relative_path, payload)
    return {
        "id": _slug_from_path(source),
        "path": relative_path,
        "name": source.stem.replace("-", " ").replace("_", " ").title(),
        "description": "Game binding file exported from local JSON.",
    }


def export_pack(
    output_dir: str | Path,
    *,
    slug: str,
    name: str,
    description: str,
    version: str = "1.0.0",
    author: str = "CharacterForge AI",
    character_paths: list[str | Path],
    binding_paths: list[str | Path] | None = None,
    dry_run: bool = True,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Create and validate a local character pack folder.

    The function writes only local JSON files. `dry_run` means the result is validated
    locally and no AWS/API import is attempted.
    """

    if not character_paths:
        raise CharacterPackValidationError("at least one character source is required")

    pack_dir = Path(output_dir).resolve()
    if pack_dir.exists() and any(pack_dir.iterdir()):
        if not overwrite:
            raise CharacterPackValidationError(f"output directory is not empty: {pack_dir}")
        shutil.rmtree(pack_dir)
    pack_dir.mkdir(parents=True, exist_ok=True)

    character_entries = [
        _copy_character(Path(source).resolve(), pack_dir) for source in character_paths
    ]
    binding_entries = [
        _copy_binding(Path(source).resolve(), pack_dir) for source in (binding_paths or [])
    ]

    manifest: dict[str, Any] = {
        "$schema": "../../schemas/character-pack.schema.json",
        "schema_version": "1.0",
        "slug": slug,
        "name": name,
        "description": description,
        "version": version,
        "authors": [{"name": author}],
        "license": "PolyForm Noncommercial License 1.0.0",
        "tags": ["exported", "local-json"],
        "content_warnings": [],
        "minimum_characterforge_version": "0.1.0",
        "characters": character_entries,
        "bindings": binding_entries,
        "assets": [],
    }
    _write_json(pack_dir / "character-pack.json", manifest)

    result = validate_pack(pack_dir, dry_run=dry_run)
    result["output_dir"] = str(pack_dir)
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export local CharacterForge JSON files into a character pack."
    )
    parser.add_argument("output_dir", type=Path, help="Destination pack folder")
    parser.add_argument("--slug", required=True, help="Stable lowercase pack slug")
    parser.add_argument("--name", required=True, help="Human-readable pack name")
    parser.add_argument("--description", required=True, help="Human-readable pack summary")
    parser.add_argument("--version", default="1.0.0", help="Pack version, default: 1.0.0")
    parser.add_argument("--author", default="CharacterForge AI", help="Pack author name")
    parser.add_argument(
        "--character",
        action="append",
        dest="characters",
        required=True,
        help="Local character JSON file to include. Repeat for multiple characters.",
    )
    parser.add_argument(
        "--binding",
        action="append",
        dest="bindings",
        default=[],
        help="Local game binding JSON file to include. Repeat for multiple bindings.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Validate local export only. This is the default and never requires AWS.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace the output folder if it already contains files.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = export_pack(
            args.output_dir,
            slug=args.slug,
            name=args.name,
            description=args.description,
            version=args.version,
            author=args.author,
            character_paths=[Path(path) for path in args.characters],
            binding_paths=[Path(path) for path in args.bindings],
            dry_run=args.dry_run,
            overwrite=args.overwrite,
        )
    except CharacterPackValidationError as error:
        print(f"invalid: {error}")
        return 1

    print(f"exported: {result['slug']}")
    print(f"dry_run={result['dry_run']}")
    print(f"aws_required={result['aws_required']}")
    print(f"output_dir={result['output_dir']}")
    print(f"characters={','.join(result['characters'])}")
    print(f"bindings={','.join(result['bindings'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
