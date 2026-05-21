from pathlib import Path

import yaml

OPENAPI_PATH = Path(__file__).resolve().parents[1] / "openapi.yaml"


def load_openapi() -> dict:
    return yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))


def iter_operations(spec: dict):
    for path_item in spec["paths"].values():
        for method, operation in path_item.items():
            if method.lower() in {"get", "post", "put", "delete", "patch"}:
                yield operation


def test_openapi_defines_x_api_key_security_scheme() -> None:
    spec = load_openapi()

    security_schemes = spec["components"]["securitySchemes"]
    assert security_schemes["ApiKeyAuth"] == {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key",
        "description": "API Gateway API key for deployed CharacterForge API requests.",
    }


def test_openapi_requires_api_key_for_all_documented_operations() -> None:
    spec = load_openapi()

    assert spec["security"] == [{"ApiKeyAuth": []}]
    for operation in iter_operations(spec):
        assert operation.get("security", spec["security"]) == [{"ApiKeyAuth": []}]
