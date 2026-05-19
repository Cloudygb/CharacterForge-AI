from unittest.mock import Mock, patch

import pytest

from characterforge.handlers.chat import LLMClient
from characterforge.services.bedrock_client import BedrockLLMClient, BedrockResponseError


def test_bedrock_client_matches_llm_client_generate_interface() -> None:
    runtime = Mock()
    runtime.converse.return_value = {
        "output": {"message": {"content": [{"text": "raw character response"}]}}
    }
    client: LLMClient = BedrockLLMClient(
        model_id="amazon.nova-micro-v1:0",
        region_name="us-east-1",
        runtime_client=runtime,
    )

    response_text = client.generate("Stay in character and greet the player.")

    assert response_text == "raw character response"


def test_bedrock_client_sends_prompt_to_configured_model_and_region() -> None:
    runtime = Mock()
    runtime.converse.return_value = {"output": {"message": {"content": [{"text": "hello"}]}}}

    with patch(
        "characterforge.services.bedrock_client.boto3.client", return_value=runtime
    ) as boto_client:
        client = BedrockLLMClient(
            model_id="anthropic.claude-haiku-4-5-20251001-v1:0",
            region_name="us-west-2",
        )
        response_text = client.generate("Prompt text")

    boto_client.assert_called_once_with("bedrock-runtime", region_name="us-west-2")
    runtime.converse.assert_called_once_with(
        modelId="anthropic.claude-haiku-4-5-20251001-v1:0",
        messages=[{"role": "user", "content": [{"text": "Prompt text"}]}],
    )
    assert response_text == "hello"


def test_bedrock_client_can_use_inference_config_without_changing_interface() -> None:
    runtime = Mock()
    runtime.converse.return_value = {
        "output": {"message": {"content": [{"text": "configured response"}]}}
    }
    client = BedrockLLMClient(
        model_id="amazon.nova-micro-v1:0",
        region_name="us-east-1",
        runtime_client=runtime,
        inference_config={"maxTokens": 512, "temperature": 0.2},
    )

    response_text = client.generate("Prompt text")

    runtime.converse.assert_called_once_with(
        modelId="amazon.nova-micro-v1:0",
        messages=[{"role": "user", "content": [{"text": "Prompt text"}]}],
        inferenceConfig={"maxTokens": 512, "temperature": 0.2},
    )
    assert response_text == "configured response"


def test_bedrock_client_concatenates_multiple_text_blocks() -> None:
    runtime = Mock()
    runtime.converse.return_value = {
        "output": {
            "message": {
                "content": [
                    {"text": "first"},
                    {"image": {"format": "png"}},
                    {"text": " second"},
                ]
            }
        }
    }
    client = BedrockLLMClient(
        model_id="amazon.nova-micro-v1:0",
        region_name="us-east-1",
        runtime_client=runtime,
    )

    assert client.generate("Prompt text") == "first second"


def test_bedrock_client_uses_environment_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = Mock()
    runtime.converse.return_value = {"output": {"message": {"content": [{"text": "hello"}]}}}
    monkeypatch.setenv("CHARACTERFORGE_BEDROCK_MODEL_ID", "amazon.nova-pro-v1:0")
    monkeypatch.setenv("AWS_REGION", "us-west-2")

    with patch(
        "characterforge.services.bedrock_client.boto3.client", return_value=runtime
    ) as boto_client:
        client = BedrockLLMClient()
        client.generate("Prompt text")

    boto_client.assert_called_once_with("bedrock-runtime", region_name="us-west-2")
    runtime.converse.assert_called_once_with(
        modelId="amazon.nova-pro-v1:0",
        messages=[{"role": "user", "content": [{"text": "Prompt text"}]}],
    )


def test_bedrock_client_raises_clear_error_when_response_has_no_text() -> None:
    runtime = Mock()
    runtime.converse.return_value = {"output": {"message": {"content": [{"image": {}}]}}}
    client = BedrockLLMClient(
        model_id="amazon.nova-micro-v1:0",
        region_name="us-east-1",
        runtime_client=runtime,
    )

    with pytest.raises(BedrockResponseError, match="text content"):
        client.generate("Prompt text")
