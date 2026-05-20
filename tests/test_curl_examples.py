from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CURL_DIR = REPO_ROOT / "examples" / "curl"

EXPECTED_SCRIPTS = {
    "create-character-local.sh": ["http://127.0.0.1:3000", "POST", "/characters"],
    "chat-local.sh": ["http://127.0.0.1:3000", "POST", "/characters/${CHARACTER_ID}/chat"],
    "create-character-deployed.sh": ["API_BASE_URL", "POST", "/characters"],
    "chat-deployed.sh": ["API_BASE_URL", "POST", "/characters/${CHARACTER_ID}/chat"],
}


def test_expected_curl_examples_exist_and_cover_required_routes() -> None:
    for script_name, required_snippets in EXPECTED_SCRIPTS.items():
        script = CURL_DIR / script_name

        assert script.exists(), f"Missing curl example: {script}"

        content = script.read_text(encoding="utf-8")
        assert content.startswith("#!/usr/bin/env bash\n")
        assert "set -euo pipefail" in content
        assert "curl" in content
        assert "Content-Type: application/json" in content
        assert (
            "examples/sample-characters/captain-mira-voss.json" in content or "message" in content
        )
        for snippet in required_snippets:
            assert snippet in content


def test_local_curl_env_file_enables_mock_llm_without_real_aws_services() -> None:
    env_file = CURL_DIR / "local-env.json"

    assert env_file.exists(), "Missing SAM local env file for mock/local curl examples"

    config = json.loads(env_file.read_text(encoding="utf-8"))
    function_env = config["CharacterForgeFunction"]
    variables = (
        function_env["USE_MOCK_LLM"]
        if "USE_MOCK_LLM" in function_env
        else function_env["Variables"]
    )
    if isinstance(variables, dict):
        assert variables["USE_MOCK_LLM"] == "true"
    else:
        assert variables == "true"


def test_readme_documents_curl_examples_for_local_and_deployed_usage() -> None:
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "## Curl API Examples" in readme
    for script_name in EXPECTED_SCRIPTS:
        assert f"examples/curl/{script_name}" in readme
    assert "sam local start-api" in readme
    assert "USE_MOCK_LLM" in readme
    assert "API_BASE_URL" in readme


def test_curl_examples_do_not_embed_real_hosts_or_credentials() -> None:
    forbidden_patterns = [
        re.compile(r"Authorization:\\s*Bearer\\s+(?!\\$|<)", re.IGNORECASE),
        re.compile(r"AKIA[0-9A-Z]{16}"),
        re.compile(
            r"https://[a-z0-9]+\\.execute-api\\.[a-z0-9-]+\\.amazonaws\\.com", re.IGNORECASE
        ),
    ]

    for script in CURL_DIR.glob("*.sh"):
        content = script.read_text(encoding="utf-8")
        for pattern in forbidden_patterns:
            assert not pattern.search(content), (
                f"{script} appears to contain a real credential or API host"
            )
