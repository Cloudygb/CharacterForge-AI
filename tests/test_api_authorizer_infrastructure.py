from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = REPO_ROOT / "infra" / "template.yaml"
OPENAPI_PATH = REPO_ROOT / "openapi.yaml"


class CloudFormationLoader(yaml.SafeLoader):
    """Minimal loader that preserves CloudFormation intrinsic functions for tests."""


def _construct_intrinsic(loader: CloudFormationLoader, node: yaml.Node) -> dict[str, object]:
    intrinsic_name = node.tag.removeprefix("!")
    if intrinsic_name == "Ref":
        intrinsic_name = "Ref"
    elif intrinsic_name == "Sub":
        intrinsic_name = "Fn::Sub"
    elif intrinsic_name == "Equals":
        intrinsic_name = "Fn::Equals"
    elif intrinsic_name == "If":
        intrinsic_name = "Fn::If"

    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node)
    else:
        value = loader.construct_mapping(node)
    return {intrinsic_name: value}


CloudFormationLoader.add_multi_constructor(
    "!",
    lambda loader, tag_suffix, node: _construct_intrinsic(loader, node),
)


def load_template() -> dict[str, object]:
    return yaml.load(TEMPLATE_PATH.read_text(encoding="utf-8"), Loader=CloudFormationLoader)


def load_openapi() -> dict[str, object]:
    return yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))


def test_sam_template_exposes_configurable_jwt_authorizer_parameters_and_dev_mode() -> None:
    template = load_template()
    parameters = template["Parameters"]

    auth_mode = parameters["AuthorizationMode"]
    assert auth_mode["Default"] == "cognito"
    assert auth_mode["AllowedValues"] == ["cognito", "local"]
    assert "local development only" in auth_mode["Description"].lower()
    assert "not for deployed environments" in auth_mode["Description"].lower()

    assert parameters["CognitoUserPoolArn"]["Type"] == "String"
    assert parameters["JwtIssuer"]["Type"] == "String"
    assert parameters["JwtAudience"]["Type"] == "String"
    assert parameters["CognitoUserPoolArn"].get("NoEcho") is not True
    assert parameters["JwtIssuer"].get("NoEcho") is not True
    assert parameters["JwtAudience"].get("NoEcho") is not True

    assert template["Conditions"]["UseCognitoAuthorizer"] == {
        "Fn::Equals": [{"Ref": "AuthorizationMode"}, "cognito"]
    }


def test_sam_template_configures_cognito_authorizer_and_keeps_api_key_metering_only() -> None:
    template = load_template()
    api_properties = template["Resources"]["CharacterForgeApi"]["Properties"]
    auth = api_properties["Auth"]
    environment = template["Resources"]["CharacterForgeFunction"]["Properties"]["Environment"]["Variables"]

    assert auth["DefaultAuthorizer"] == "CharacterForgeJwtAuthorizer"
    assert auth["Authorizers"]["CharacterForgeJwtAuthorizer"] == {
        "UserPoolArn": {"Ref": "CognitoUserPoolArn"},
        "Identity": {"Header": "Authorization"},
    }
    assert environment["CHARACTERFORGE_AUTH_LOCAL_DEV_MODE"] == {
        "Fn::If": ["UseCognitoAuthorizer", "false", "true"]
    }

    api_key = template["Resources"]["CharacterForgeApiKey"]
    usage_plan = template["Resources"]["CharacterForgeUsagePlan"]
    assert "metering" in api_key["Properties"]["Description"].lower()
    assert "authentication" not in api_key["Properties"]["Description"].lower()
    assert "metering" in usage_plan["Properties"]["Description"].lower()

    function_events = template["Resources"]["CharacterForgeFunction"]["Properties"]["Events"]
    for event in function_events.values():
        event_auth = event["Properties"]["Auth"]
        assert event_auth["ApiKeyRequired"] is True
        assert "Authorizer" not in event_auth


def test_openapi_documents_bearer_jwt_auth_as_identity_and_api_key_as_metering_only() -> None:
    spec = load_openapi()
    schemes = spec["components"]["securitySchemes"]

    assert spec["security"] == [{"BearerAuth": []}]
    assert schemes["BearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Cognito/OIDC JWT bearer token used for caller identity and authorization.",
    }
    assert schemes["ApiKeyMetering"] == {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key",
        "description": "Optional API Gateway API key for usage-plan metering, throttling, and quotas only; not caller identity or authorization.",
    }
    assert "API keys are optional usage-plan metering only" in spec["info"]["description"]
    assert "API key" not in spec["info"]["description"].split("API keys are optional usage-plan metering only", 1)[0]
