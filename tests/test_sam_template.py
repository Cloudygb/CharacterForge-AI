from importlib import import_module
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = REPO_ROOT / "infra" / "template.yaml"


class CloudFormationLoader(yaml.SafeLoader):
    """Minimal loader that preserves CloudFormation intrinsic functions for tests."""


def _construct_intrinsic(loader: CloudFormationLoader, node: yaml.Node) -> dict[str, object]:
    tag_name = node.tag.removeprefix("!")
    intrinsic_name = {
        "Ref": "Ref",
        "Sub": "Fn::Sub",
    }.get(tag_name, tag_name)

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


def test_sam_template_defines_api_lambda_and_tables() -> None:
    template = load_template()

    assert template["Transform"] == "AWS::Serverless-2016-10-31"
    resources = template["Resources"]

    assert resources["CharacterForgeApi"]["Type"] == "AWS::Serverless::Api"
    assert resources["CharacterForgeFunction"]["Type"] == "AWS::Serverless::Function"
    assert resources["CharactersTable"]["Type"] == "AWS::DynamoDB::Table"
    assert resources["MessagesTable"]["Type"] == "AWS::DynamoDB::Table"


def test_sam_template_configures_lambda_environment_and_routes() -> None:
    template = load_template()
    resources = template["Resources"]
    function_properties = resources["CharacterForgeFunction"]["Properties"]

    assert template["Globals"]["Function"]["Runtime"] == "python3.12"
    assert function_properties["CodeUri"] == "../src"
    assert (REPO_ROOT / "src" / "requirements.txt").is_file()

    assert function_properties["Handler"] == "characterforge.app.handler"
    handler_module_name, handler_function_name = function_properties["Handler"].rsplit(".", 1)
    handler_module = import_module(handler_module_name)
    assert callable(getattr(handler_module, handler_function_name))

    environment = function_properties["Environment"]["Variables"]
    assert environment["CHARACTERS_TABLE_NAME"] == {"Ref": "CharactersTable"}
    assert environment["MESSAGES_TABLE_NAME"] == {"Ref": "MessagesTable"}
    assert environment["CHARACTERFORGE_BEDROCK_MODEL_ID"] == {"Ref": "BedrockModelId"}
    assert environment["CHARACTERFORGE_BEDROCK_REGION"] == {"Ref": "BedrockRegion"}

    routes = {
        (event["Properties"]["Method"], event["Properties"]["Path"])
        for event in function_properties["Events"].values()
    }
    assert routes == {
        ("POST", "/characters"),
        ("GET", "/characters"),
        ("GET", "/characters/{character_id}"),
        ("PUT", "/characters/{character_id}"),
        ("DELETE", "/characters/{character_id}"),
        ("POST", "/characters/{character_id}/chat"),
        ("GET", "/sessions/{session_id}"),
        ("DELETE", "/sessions/{session_id}"),
    }

    for event in function_properties["Events"].values():
        event_properties = event["Properties"]
        assert event["Type"] == "Api"
        assert event_properties["RestApiId"] == {"Ref": "CharacterForgeApi"}
        assert event_properties["Auth"] == {"ApiKeyRequired": True}


def test_sam_template_defines_api_key_usage_plan_and_safe_output() -> None:
    template = load_template()
    resources = template["Resources"]

    api_key = resources["CharacterForgeApiKey"]
    assert api_key["Type"] == "AWS::ApiGateway::ApiKey"
    assert api_key["Properties"]["Enabled"] is True
    assert api_key["Properties"]["Name"] == {"Fn::Sub": "CharacterForge-${EnvironmentName}-api-key"}

    usage_plan = resources["CharacterForgeUsagePlan"]
    assert usage_plan["Type"] == "AWS::ApiGateway::UsagePlan"
    assert usage_plan["Properties"]["ApiStages"] == [
        {"ApiId": {"Ref": "CharacterForgeApi"}, "Stage": {"Ref": "EnvironmentName"}}
    ]
    assert "Throttle" in usage_plan["Properties"]
    assert "Quota" in usage_plan["Properties"]

    usage_plan_key = resources["CharacterForgeUsagePlanKey"]
    assert usage_plan_key["Type"] == "AWS::ApiGateway::UsagePlanKey"
    assert usage_plan_key["Properties"] == {
        "KeyId": {"Ref": "CharacterForgeApiKey"},
        "KeyType": "API_KEY",
        "UsagePlanId": {"Ref": "CharacterForgeUsagePlan"},
    }

    outputs = template["Outputs"]
    assert outputs["ApiKeyId"]["Value"] == {"Ref": "CharacterForgeApiKey"}
    assert "Value" not in outputs.get("ApiKeyValue", {})


def test_sam_template_defines_dynamodb_keys_and_permissions() -> None:
    resources = load_template()["Resources"]

    characters_table = resources["CharactersTable"]["Properties"]
    assert characters_table["BillingMode"] == "PAY_PER_REQUEST"
    assert characters_table["KeySchema"] == [
        {"AttributeName": "character_id", "KeyType": "HASH"},
    ]

    messages_table = resources["MessagesTable"]["Properties"]
    assert messages_table["BillingMode"] == "PAY_PER_REQUEST"
    assert messages_table["KeySchema"] == [
        {"AttributeName": "session_id", "KeyType": "HASH"},
        {"AttributeName": "created_at_message_id", "KeyType": "RANGE"},
    ]

    policies = resources["CharacterForgeFunction"]["Properties"]["Policies"]
    assert {"DynamoDBCrudPolicy": {"TableName": {"Ref": "CharactersTable"}}} in policies
    assert {"DynamoDBCrudPolicy": {"TableName": {"Ref": "MessagesTable"}}} in policies

    bedrock_policy = next(policy for policy in policies if policy.get("Version") == "2012-10-17")
    statement = bedrock_policy["Statement"][0]
    assert statement["Action"] == [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
    ]
