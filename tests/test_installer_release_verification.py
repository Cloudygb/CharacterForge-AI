from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "scripts" / "build-windows-installer.ps1"
VERIFY_SCRIPT = ROOT / "scripts" / "verify-windows-installer.ps1"
SIGNING_TEMPLATE = ROOT / "scripts" / "code-signing.example.psd1"
PACKAGE_JSON = ROOT / "apps" / "dashboard" / "package.json"
README = ROOT / "README.md"


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _normalized(path: Path) -> str:
    return _text(path).lower()


def test_release_build_requires_signing_certificate_timestamp_publisher_and_verification() -> None:
    script = _normalized(BUILD_SCRIPT)
    package_json = _normalized(PACKAGE_JSON)

    assert "desktop:release-installer" in package_json
    assert "build-windows-installer.ps1" in package_json
    assert "-releasemode" in package_json
    assert "-signartifacts" in package_json

    assert "releasemode" in script
    assert "release mode requires -signartifacts" in script
    assert "release mode requires a signing configuration path" in script
    assert "certificatethumbprint" in script
    assert "certificatesubject" in script
    assert "timestampurl" in script
    assert "expectedpublisher" in script
    assert "signature verification failed" in script
    assert "timestamp signature is required" in script
    assert "signer publisher mismatch" in script
    assert "verify-windows-installer.ps1" in script
    assert "-releasemode" in script
    assert "-expectedpublisher" in script


def test_release_verifier_fails_unsigned_unknown_or_untrusted_signatures() -> None:
    script = _normalized(VERIFY_SCRIPT)

    assert "releasemode" in script
    assert "expectedpublisher" in script
    assert "release mode requires -expectedpublisher" in script
    assert "release mode requires get-authenticodesignature" in script
    assert "@('valid')" in script
    assert "release signature status" in script
    assert "signature status must be valid in release mode" in script
    assert "signer publisher" in script
    assert "does not match expected publisher" in script
    assert "timestamp signature" in script
    assert "release installers must include a trusted timestamp" in script

    release_guard_index = script.index("if ($releasemode)")
    release_guard = script[release_guard_index:]
    assert "notsigned" in release_guard
    assert "unknown" in release_guard


def test_signing_template_documents_expected_publisher_without_secrets() -> None:
    template = _normalized(SIGNING_TEMPLATE)

    assert "expectedpublisher" in template
    assert "<expected-publisher-subject-fragment>" in template
    assert "timestampurl" in template
    assert "certificatethumbprint" in template
    assert "certificatesubject" in template

    forbidden = [
        ".pfx",
        "password",
        "token",
        "privatekey",
        "private key",
        "client_secret",
        "access_key",
        "session_token",
    ]
    for term in forbidden:
        assert term not in template


def test_public_readme_does_not_normalize_smartscreen_bypass_for_release_builds() -> None:
    readme = _normalized(README)

    assert "run anyway" not in readme
    assert "unknown publisher" not in readme
    assert "current release candidate is unsigned" not in readme
    assert "signed windows installer" in readme
    assert "expected publisher" in readme
