from __future__ import annotations

from pathlib import Path

from tests.test_sam_template import load_template

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = ROOT / "infra" / "template.yaml"


def _api_cors() -> dict[str, object]:
    template = load_template()
    return template["Resources"]["CharacterForgeApi"]["Properties"]["Cors"]


def test_production_cors_origins_are_parameterized_and_not_wildcard_by_default() -> None:
    template = load_template()
    parameters = template["Parameters"]

    assert "AllowedCorsOrigins" in parameters
    allowed_origins = parameters["AllowedCorsOrigins"]
    assert allowed_origins["Type"] == "String"
    assert allowed_origins["Default"] == ""
    assert "no browser origin" in allowed_origins["Description"].lower()
    assert "production" in allowed_origins["Description"].lower()

    cors = _api_cors()
    allow_origin = cors["AllowOrigin"]
    assert allow_origin != "'*'"
    assert allow_origin == {
        "Fn::If": [
            "UseDevCorsWildcard",
            "'*'",
            {"Fn::Sub": "'${AllowedCorsOrigins}'"},
        ]
    }


def test_dev_cors_wildcard_requires_explicit_dev_mode_parameter() -> None:
    template = load_template()
    parameters = template["Parameters"]
    conditions = template["Conditions"]

    assert "DevMode" in parameters
    dev_mode = parameters["DevMode"]
    assert dev_mode["Type"] == "String"
    assert dev_mode["Default"] == "false"
    assert dev_mode["AllowedValues"] == ["true", "false"]
    assert "local development" in dev_mode["Description"].lower()
    assert "not for production" in dev_mode["Description"].lower()

    assert conditions["UseDevCorsWildcard"] == {"Fn::Equals": [{"Ref": "DevMode"}, "true"]}


def test_cors_allowed_headers_do_not_advertise_authorization_until_intentional_browser_bearer_flow() -> None:
    headers = _api_cors()["AllowHeaders"]

    assert headers == "'Content-Type,x-api-key'"
    assert "Authorization" not in headers


def test_template_does_not_contain_unconditional_wildcard_cors_origin() -> None:
    template_source = TEMPLATE_PATH.read_text(encoding="utf-8")

    forbidden_unconditional_lines = [
        line.strip()
        for line in template_source.splitlines()
        if line.strip() in {'AllowOrigin: "\'*\'"', 'AllowOrigin: "*"', "AllowOrigin: '*'"}
    ]
    assert forbidden_unconditional_lines == []
