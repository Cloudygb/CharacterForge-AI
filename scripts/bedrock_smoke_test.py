#!/usr/bin/env python3
"""Explicit AWS Bedrock smoke test for CharacterForge AI.

This script is intentionally outside the normal pytest flow. Run it manually when
checking real AWS Bedrock credentials and model access.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Protocol

from characterforge.services.bedrock_client import BedrockLLMClient

_DEFAULT_MODEL_ID = "amazon.nova-micro-v1:0"
_DEFAULT_REGION = "us-east-1"
_DEFAULT_PROMPT = "Reply with exactly: ok"
_MAX_RESULT_CHARS = 300


class SmokeLLMClient(Protocol):
    def generate(self, prompt: str) -> str:
        """Generate raw model text from a prompt."""


ClientFactory = Callable[..., SmokeLLMClient]


def run_smoke_test(*, client_factory: ClientFactory = BedrockLLMClient) -> int:
    """Call Bedrock with a tiny prompt and print a short result."""
    model_id = os.getenv("CHARACTERFORGE_BEDROCK_MODEL_ID", _DEFAULT_MODEL_ID)
    region_name = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or _DEFAULT_REGION
    prompt = os.getenv("CHARACTERFORGE_BEDROCK_SMOKE_PROMPT", _DEFAULT_PROMPT)

    client = client_factory(model_id=model_id, region_name=region_name)
    response_text = client.generate(prompt).strip()
    short_response = response_text[:_MAX_RESULT_CHARS]

    print("Bedrock smoke test succeeded")
    print(f"model={model_id}")
    print(f"region={region_name}")
    print(f"result={short_response}")
    return 0


def main() -> int:
    return run_smoke_test()


if __name__ == "__main__":
    raise SystemExit(main())
