from pathlib import Path

import yaml

TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "infra" / "template.yaml"


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

    assert resources["CharacterForgeApi"]["Type"] == "AWS::Serverless::HttpApi"
    assert resources["CharacterForgeFunction"]["Type"] == "AWS::Serverless::Function"
    assert resources["CharactersTable"]["Type"] == "AWS::DynamoDB::Table"
    assert resources["MessagesTable"]["Type"] == "AWS::DynamoDB::Table"


def test_sam_template_configures_lambda_environment_and_routes() -> None:
    template = load_template()
    resources = template["Resources"]
    function_properties = resources["CharacterForgeFunction"]["Properties"]

    assert template["Globals"]["Function"]["Runtime"] == "python3.12"
    assert function_properties["Handler"] == "characterforge.api.lambda_handler.handler"

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
