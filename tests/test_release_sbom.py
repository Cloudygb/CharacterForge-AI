from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "generate-sbom.mjs"
BUILD_SCRIPT = ROOT / "scripts" / "build-windows-installer.ps1"
DASHBOARD_PACKAGE = ROOT / "apps" / "dashboard" / "package.json"
SDK_PACKAGE = ROOT / "sdk" / "typescript" / "package.json"
CARGO_MANIFEST = ROOT / "apps" / "dashboard" / "src-tauri" / "Cargo.toml"
PYPROJECT = ROOT / "pyproject.toml"


def test_sbom_generator_writes_cyclonedx_for_npm_rust_and_python_components(tmp_path: Path) -> None:
    output_dir = tmp_path / "sbom"

    subprocess.run(
        [
            "node",
            str(GENERATOR),
            "--output-dir",
            str(output_dir),
            "--build-commit",
            "test-commit",
        ],
        cwd=ROOT,
        check=True,
    )

    expected_files = {
        "npm": output_dir / "characterforgeai-npm.cdx.json",
        "rust": output_dir / "characterforgeai-rust.cdx.json",
        "python": output_dir / "characterforgeai-python.cdx.json",
        "provenance": output_dir / "release-provenance.json",
    }
    for path in expected_files.values():
        assert path.exists(), f"missing generated artifact {path.name}"

    npm_sbom = json.loads(expected_files["npm"].read_text(encoding="utf-8"))
    rust_sbom = json.loads(expected_files["rust"].read_text(encoding="utf-8"))
    python_sbom = json.loads(expected_files["python"].read_text(encoding="utf-8"))
    provenance = json.loads(expected_files["provenance"].read_text(encoding="utf-8"))

    assert npm_sbom["bomFormat"] == "CycloneDX"
    assert rust_sbom["bomFormat"] == "CycloneDX"
    assert python_sbom["bomFormat"] == "CycloneDX"
    assert npm_sbom["metadata"]["component"]["name"] == "characterforge-ai npm workspace"
    assert rust_sbom["metadata"]["component"]["name"] == "characterforgeai"
    assert python_sbom["metadata"]["component"]["name"] == "characterforge-ai"

    npm_components = {component["name"] for component in npm_sbom["components"]}
    rust_components = {component["name"] for component in rust_sbom["components"]}
    python_components = {component["name"] for component in python_sbom["components"]}

    assert {"react", "vite", "vitest", "typescript"}.issubset(npm_components)
    assert {"tauri", "serde", "serde_json"}.issubset(rust_components)
    assert {"boto3", "pydantic", "pytest", "fastapi"}.issubset(python_components)
    assert "Programming Language :: Python :: 3" not in python_components
    assert "aws" not in python_components

    assert provenance["buildCommit"] == "test-commit"
    assert provenance["sboms"] == [
        "characterforgeai-npm.cdx.json",
        "characterforgeai-rust.cdx.json",
        "characterforgeai-python.cdx.json",
    ]
    assert provenance["sourceManifests"] == [
        str(DASHBOARD_PACKAGE.relative_to(ROOT)),
        str(SDK_PACKAGE.relative_to(ROOT)),
        str(CARGO_MANIFEST.relative_to(ROOT)),
        str(PYPROJECT.relative_to(ROOT)),
    ]


def test_release_build_attaches_sbom_and_provenance_after_manifest_generation() -> None:
    script = BUILD_SCRIPT.read_text(encoding="utf-8").lower()
    manifest_index = script.index("generate-release-manifest.mjs")
    sbom_index = script.index("generate-sbom.mjs")

    assert manifest_index < sbom_index
    assert "release-sbom" in script
    assert "characterforgeai-npm.cdx.json" in script
    assert "characterforgeai-rust.cdx.json" in script
    assert "characterforgeai-python.cdx.json" in script
    assert "release-provenance.json" in script


def test_release_build_fails_if_sbom_or_provenance_artifacts_are_missing() -> None:
    script = BUILD_SCRIPT.read_text(encoding="utf-8")

    assert "Assert-ReleaseArtifact" in script
    for artifact in [
        "characterforgeai-npm.cdx.json",
        "characterforgeai-rust.cdx.json",
        "characterforgeai-python.cdx.json",
        "release-provenance.json",
    ]:
        assert artifact in script
    assert "Missing release artifact" in script
