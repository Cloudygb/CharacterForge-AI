from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PLAYGROUND_DIR = REPO_ROOT / "examples" / "web-playground"


def test_web_playground_has_static_files_and_no_build_step() -> None:
    expected_files = [
        PLAYGROUND_DIR / "index.html",
        PLAYGROUND_DIR / "styles.css",
        PLAYGROUND_DIR / "app.js",
        PLAYGROUND_DIR / "README.md",
    ]

    for path in expected_files:
        assert path.exists(), f"Missing web playground file: {path}"

    html = (PLAYGROUND_DIR / "index.html").read_text(encoding="utf-8")
    assert '<script src="app.js" defer></script>' in html
    assert '<link rel="stylesheet" href="styles.css" />' in html
    assert "API URL" in html
    assert "Create Sample Character" in html
    assert "Send Chat Message" in html


def test_web_playground_javascript_covers_required_api_flow() -> None:
    js = (PLAYGROUND_DIR / "app.js").read_text(encoding="utf-8")

    required_snippets = [
        "sampleCharacter",
        "/characters",
        "/characters/${state.characterId}/chat",
        "fetch(",
        "createCharacter",
        "sendChatMessage",
        "renderActions",
        "localStorage",
        "Mock response",
    ]
    for snippet in required_snippets:
        assert snippet in js


def test_web_playground_docs_explain_local_static_server_and_api_url() -> None:
    docs = (PLAYGROUND_DIR / "README.md").read_text(encoding="utf-8")

    assert "python3 -m http.server" in docs
    assert "API URL" in docs
    assert "sam local start-api" in docs
    assert "API_BASE_URL" in docs
    assert "mock response" in docs.lower()


def test_web_playground_does_not_embed_real_api_hosts_or_credentials() -> None:
    forbidden_patterns = [
        re.compile(r"Authorization:\\s*Bearer\\s+(?!\\$|<)", re.IGNORECASE),
        re.compile(r"AKIA[0-9A-Z]{16}"),
        re.compile(
            r"https://[a-z0-9]+\\.execute-api\\.[a-z0-9-]+\\.amazonaws\\.com", re.IGNORECASE
        ),
    ]

    for path in PLAYGROUND_DIR.glob("*"):
        if path.suffix not in {".html", ".css", ".js", ".md"}:
            continue
        content = path.read_text(encoding="utf-8")
        for pattern in forbidden_patterns:
            assert not pattern.search(content), (
                f"{path} appears to contain a real credential or API host"
            )
