import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from scripts.character_pack_export import export_pack
from scripts.character_pack_import import CharacterPackValidationError, validate_pack

REPO_ROOT = Path(__file__).resolve().parents[1]

PACK_DIR = REPO_ROOT / "examples" / "character-packs" / "aether-skies-starter"
CHARACTER_PATH = PACK_DIR / "characters" / "captain-mira-voss.json"
BINDING_PATH = PACK_DIR / "bindings" / "rpg-binding.json"
IMPORT_SCRIPT = REPO_ROOT / "scripts" / "character_pack_import.py"
EXPORT_SCRIPT = REPO_ROOT / "scripts" / "character_pack_export.py"


def copy_pack(tmp_path: Path) -> Path:
    destination = tmp_path / "aether-skies-starter"
    shutil.copytree(PACK_DIR, destination)
    return destination


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def test_import_script_dry_run_validates_valid_pack_without_aws() -> None:
    result = validate_pack(PACK_DIR, dry_run=True)

    assert result["status"] == "valid"
    assert result["dry_run"] is True
    assert result["aws_required"] is False
    assert result["characters"] == ["captain-mira-voss"]
    assert result["bindings"] == ["rpg-binding"]


def test_import_script_cli_dry_run_outputs_local_validation_summary() -> None:
    completed = subprocess.run(
        [sys.executable, str(IMPORT_SCRIPT), str(PACK_DIR), "--dry-run"],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    assert "valid: aether-skies-starter" in completed.stdout
    assert "dry_run=True" in completed.stdout
    assert "aws_required=False" in completed.stdout


def test_import_script_rejects_invalid_pack_schema(tmp_path: Path) -> None:
    pack_dir = copy_pack(tmp_path)
    manifest_path = pack_dir / "character-pack.json"
    manifest = load_json(manifest_path)
    del manifest["schema_version"]
    write_json(manifest_path, manifest)

    with pytest.raises(CharacterPackValidationError, match="manifest schema"):
        validate_pack(pack_dir, dry_run=True)


def test_import_script_rejects_duplicate_manifest_ids(tmp_path: Path) -> None:
    pack_dir = copy_pack(tmp_path)
    manifest_path = pack_dir / "character-pack.json"
    manifest = load_json(manifest_path)
    manifest["characters"].append(
        {
            "id": "captain-mira-voss",
            "path": "characters/captain-mira-voss.json",
            "name": "Duplicate Captain Mira Voss",
        }
    )
    write_json(manifest_path, manifest)

    with pytest.raises(CharacterPackValidationError, match="duplicate character id"):
        validate_pack(pack_dir, dry_run=True)


def test_import_script_rejects_missing_binding_reference(tmp_path: Path) -> None:
    pack_dir = copy_pack(tmp_path)
    manifest_path = pack_dir / "character-pack.json"
    manifest = load_json(manifest_path)
    manifest["bindings"][0]["path"] = "bindings/missing-binding.json"
    write_json(manifest_path, manifest)

    with pytest.raises(CharacterPackValidationError, match="missing binding file"):
        validate_pack(pack_dir, dry_run=True)


def test_export_script_creates_local_pack_and_validates_dry_run(tmp_path: Path) -> None:
    output_dir = tmp_path / "exported-pack"

    result = export_pack(
        output_dir,
        slug="exported-aether-skies",
        name="Exported Aether Skies",
        description="Local JSON export of the starter character pack.",
        version="1.0.0",
        author="CharacterForge AI",
        character_paths=[CHARACTER_PATH],
        binding_paths=[BINDING_PATH],
        dry_run=True,
    )

    assert result["status"] == "valid"
    assert result["dry_run"] is True
    assert result["aws_required"] is False
    assert (output_dir / "character-pack.json").exists()
    assert (output_dir / "characters" / "captain-mira-voss.json").exists()
    assert (output_dir / "bindings" / "rpg-binding.json").exists()
    assert validate_pack(output_dir, dry_run=True)["status"] == "valid"


def test_export_script_cli_dry_run_never_requires_aws(tmp_path: Path) -> None:
    output_dir = tmp_path / "cli-exported-pack"

    completed = subprocess.run(
        [
            sys.executable,
            str(EXPORT_SCRIPT),
            str(output_dir),
            "--slug",
            "cli-exported-pack",
            "--name",
            "CLI Exported Pack",
            "--description",
            "Character pack exported from local JSON files.",
            "--author",
            "CharacterForge AI",
            "--character",
            str(CHARACTER_PATH),
            "--binding",
            str(BINDING_PATH),
            "--dry-run",
        ],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    assert "exported: cli-exported-pack" in completed.stdout
    assert "dry_run=True" in completed.stdout
    assert "aws_required=False" in completed.stdout
