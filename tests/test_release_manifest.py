from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "generate-release-manifest.mjs"
BUILD_SCRIPT = ROOT / "scripts" / "build-windows-installer.ps1"
README = ROOT / "README.md"


def test_release_manifest_generator_writes_checksum_signature_and_commit(tmp_path: Path) -> None:
    artifact = tmp_path / "characterforgeai-installer.exe"
    artifact.write_bytes(b"signed-final-artifact\n")
    signature_json = tmp_path / "installer-verification.json"
    signature_json.write_text(
        json.dumps(
            {
                "signature": {
                    "status": "Valid",
                    "signerCertificateSubject": "CN=CharacterForge AI, O=CharacterForge",
                    "timestampCertificateSubject": "CN=Trusted Timestamp Authority",
                }
            }
        ),
        encoding="utf-8",
    )
    output_json = tmp_path / "release-manifest.json"
    output_md = tmp_path / "release-manifest.md"

    subprocess.run(
        [
            "node",
            str(GENERATOR),
            "--artifact",
            str(artifact),
            "--version",
            "0.1.0-test",
            "--signature-json",
            str(signature_json),
            "--output",
            str(output_json),
            "--markdown-output",
            str(output_md),
        ],
        cwd=ROOT,
        check=True,
    )

    manifest = json.loads(output_json.read_text(encoding="utf-8"))
    expected_sha = hashlib.sha256(artifact.read_bytes()).hexdigest()

    assert manifest["schemaVersion"] == 1
    assert manifest["version"] == "0.1.0-test"
    assert manifest["buildCommit"]
    assert manifest["artifacts"] == [
        {
            "name": "characterforgeai-installer.exe",
            "sizeBytes": artifact.stat().st_size,
            "sha256": expected_sha,
            "signatureStatus": "Valid",
            "signer": "CN=CharacterForge AI, O=CharacterForge",
            "timestamp": "CN=Trusted Timestamp Authority",
        }
    ]

    markdown = output_md.read_text(encoding="utf-8")
    assert "Generated from final signed artifacts" in markdown
    assert "characterforgeai-installer.exe" in markdown
    assert expected_sha in markdown
    assert "CN=CharacterForge AI, O=CharacterForge" in markdown


def test_release_manifest_generator_fails_on_mismatched_expected_sha(tmp_path: Path) -> None:
    artifact = tmp_path / "characterforgeai-installer.exe"
    artifact.write_bytes(b"actual artifact bytes")

    result = subprocess.run(
        [
            "node",
            str(GENERATOR),
            "--artifact",
            str(artifact),
            "--version",
            "0.1.0-test",
            "--expected-sha256",
            "0" * 64,
            "--output",
            str(tmp_path / "release-manifest.json"),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )

    assert result.returncode != 0
    assert "SHA-256 mismatch" in result.stderr


def test_release_build_generates_manifest_after_signed_verification() -> None:
    script = BUILD_SCRIPT.read_text(encoding="utf-8").lower()
    manifest_index = script.index("generate-release-manifest.mjs")
    verifier_index = script.index("verifying signed release installer")

    assert verifier_index < manifest_index
    assert "release-manifest.json" in script
    assert "release-manifest.md" in script
    assert "-signature-json" in script


def test_public_readme_uses_generated_release_manifest_instead_of_hand_hashes() -> None:
    readme = README.read_text(encoding="utf-8")
    lower = readme.lower()

    assert "release-manifest.json" in lower
    assert "release-manifest.md" in lower
    assert "generated from the final signed release artifacts" in lower
    assert "installer sha-256" not in lower
    assert not re.search(r"`[a-f0-9]{64}`", readme, re.IGNORECASE)
