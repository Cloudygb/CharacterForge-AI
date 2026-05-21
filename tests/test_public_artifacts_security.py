from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ARTIFACT_PATHS = [
    REPO_ROOT / "README.md",
    REPO_ROOT / "apps",
    REPO_ROOT / "docs",
    REPO_ROOT / "examples",
    REPO_ROOT / "sdk",
]
TEXT_SUFFIXES = {
    "",
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".py",
    ".sh",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
FORBIDDEN_PATTERNS = [
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"aws_secret_access_key\s*=\s*[^\s<]+", re.IGNORECASE),
    re.compile(r"Authorization:\s*Bearer\s+(?!\$|<)[A-Za-z0-9._~+/=-]+", re.IGNORECASE),
    re.compile(r"cf_live_[A-Za-z0-9_=-]+"),
    re.compile(r"https://[a-z0-9]{6,}\.execute-api\.[a-z0-9-]+\.amazonaws\.com", re.IGNORECASE),
    re.compile(
        r"CHARACTERFORGE_API_KEY\s*=\s*[\"'](?!<|\$|local-development-key|test-api-key)[^\"']+[\"']"
    ),
]


def _public_text_files() -> list[Path]:
    files: list[Path] = []
    for root in PUBLIC_ARTIFACT_PATHS:
        if root.is_file():
            candidates = [root]
        else:
            candidates = [path for path in root.rglob("*") if path.is_file()]
        for path in candidates:
            if any(part in {"node_modules", "dist", "coverage"} for part in path.parts):
                continue
            if path.suffix.lower() in TEXT_SUFFIXES:
                files.append(path)
    return files


def test_public_artifacts_do_not_embed_aws_secrets_or_live_api_hosts() -> None:
    failures: list[str] = []
    for path in _public_text_files():
        content = path.read_text(encoding="utf-8")
        for pattern in FORBIDDEN_PATTERNS:
            if match := pattern.search(content):
                line_number = content.count("\n", 0, match.start()) + 1
                failures.append(
                    f"{path.relative_to(REPO_ROOT)}:{line_number} matched {pattern.pattern}"
                )

    assert failures == []
