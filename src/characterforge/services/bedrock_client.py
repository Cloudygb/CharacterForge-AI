from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

import boto3

_DEFAULT_REGION = "us-east-1"
_DEFAULT_MODEL_ID = "amazon.nova-micro-v1:0"


class BedrockResponseError(RuntimeError):
    """Raised when Bedrock returns a response without model text."""


class BedrockLLMClient:
    """AWS Bedrock Runtime implementation of the local LLM client interface."""

    def __init__(
        self,
        *,
        model_id: str | None = None,
        region_name: str | None = None,
        runtime_client: Any | None = None,
        inference_config: Mapping[str, Any] | None = None,
    ) -> None:
        self.model_id = model_id or os.getenv("CHARACTERFORGE_BEDROCK_MODEL_ID", _DEFAULT_MODEL_ID)
        self.region_name = region_name or _default_region_name()
        self.inference_config = dict(inference_config) if inference_config is not None else None
        self._runtime_client = runtime_client or boto3.client(
            "bedrock-runtime",
            region_name=self.region_name,
        )

    def generate(self, prompt: str) -> str:
        """Send a prompt to Bedrock Runtime and return the raw model text."""
        request: dict[str, Any] = {
            "modelId": self.model_id,
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
        }
        if self.inference_config is not None:
            request["inferenceConfig"] = self.inference_config

        response = self._runtime_client.converse(**request)
        return _extract_text(response)


def _default_region_name() -> str:
    return os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or _DEFAULT_REGION


def _extract_text(response: Mapping[str, Any]) -> str:
    content_blocks = response.get("output", {}).get("message", {}).get("content", [])
    text = "".join(
        block["text"]
        for block in content_blocks
        if isinstance(block, Mapping) and isinstance(block.get("text"), str)
    )
    if not text:
        raise BedrockResponseError("Bedrock response did not include any text content.")
    return text
