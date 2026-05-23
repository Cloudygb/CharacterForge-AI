import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAURI_CONFIG = ROOT / "apps" / "dashboard" / "src-tauri" / "tauri.conf.json"


def load_tauri_config() -> dict:
    return json.loads(TAURI_CONFIG.read_text(encoding="utf-8"))


def parse_csp(csp: str) -> dict[str, list[str]]:
    directives: dict[str, list[str]] = {}
    for raw_directive in csp.split(";"):
        parts = raw_directive.strip().split()
        if not parts:
            continue
        directives[parts[0]] = parts[1:]
    return directives


def test_production_tauri_csp_is_strict_and_not_null() -> None:
    config = load_tauri_config()
    csp = config["app"]["security"].get("csp")

    assert isinstance(csp, str), "production Tauri CSP must be an explicit policy string, not null"
    assert csp.strip(), "production Tauri CSP must not be empty"

    directives = parse_csp(csp)
    assert directives["default-src"] == ["'self'"]
    assert directives["object-src"] == ["'none'"]
    assert directives["base-uri"] == ["'none'"]
    assert directives["frame-ancestors"] == ["'none'"]
    assert directives["form-action"] == ["'none'"]

    for directive in ["script-src", "style-src"]:
        assert "'self'" in directives[directive]
        assert "'unsafe-inline'" not in directives[directive]
        assert "'unsafe-eval'" not in directives[directive]


def test_production_tauri_csp_does_not_allow_broad_remote_origins() -> None:
    csp = load_tauri_config()["app"]["security"].get("csp")
    assert isinstance(csp, str)
    directives = parse_csp(csp)

    forbidden_sources = {
        "*",
        "http:",
        "https:",
        "ws:",
        "wss:",
        "http://*",
        "https://*",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "https://*.amazonaws.com",
        "https://*.execute-api.*.amazonaws.com",
    }
    for directive, sources in directives.items():
        unexpected = forbidden_sources.intersection(sources)
        assert unexpected == set(), f"{directive} contains broad remote CSP sources: {sorted(unexpected)}"
        for source in sources:
            assert not source.startswith("https://*"), f"{directive} allows a wildcard HTTPS origin: {source}"
            assert not source.startswith("http://*"), f"{directive} allows a wildcard HTTP origin: {source}"


def test_production_tauri_csp_does_not_embed_live_endpoints_or_credentials() -> None:
    csp = load_tauri_config()["app"]["security"].get("csp")
    assert isinstance(csp, str)

    forbidden_patterns = [
        re.compile(r"https://[a-z0-9]{6,}\.execute-api\.[a-z0-9-]+\.amazonaws\.com", re.IGNORECASE),
        re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
        re.compile(r"(?i)(api[_-]?key|x-api-key|secret|token|password)[:=][A-Za-z0-9_./+=-]{20,}"),
    ]
    matches = [pattern.pattern for pattern in forbidden_patterns if pattern.search(csp)]
    assert matches == []
