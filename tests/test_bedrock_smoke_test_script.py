import importlib.util
from pathlib import Path

SCRIPT_PATH = Path("scripts/bedrock_smoke_test.py")


def load_smoke_module():
    spec = importlib.util.spec_from_file_location("bedrock_smoke_test", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RecordingClient:
    def __init__(self, *, model_id: str, region_name: str) -> None:
        self.model_id = model_id
        self.region_name = region_name
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return "ok from mocked bedrock runtime"


def test_bedrock_smoke_script_is_not_run_on_import() -> None:
    module = load_smoke_module()

    assert hasattr(module, "main")
    assert hasattr(module, "run_smoke_test")


def test_bedrock_smoke_test_reads_environment_and_prints_short_result(
    monkeypatch,
    capsys,
) -> None:
    module = load_smoke_module()
    created_clients: list[RecordingClient] = []

    def client_factory(*, model_id: str, region_name: str) -> RecordingClient:
        client = RecordingClient(model_id=model_id, region_name=region_name)
        created_clients.append(client)
        return client

    monkeypatch.setenv("CHARACTERFORGE_BEDROCK_MODEL_ID", "amazon.nova-micro-v1:0")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("CHARACTERFORGE_BEDROCK_SMOKE_PROMPT", "Reply with only: ok")

    exit_code = module.run_smoke_test(client_factory=client_factory)

    captured = capsys.readouterr().out
    assert exit_code == 0
    assert created_clients[0].model_id == "amazon.nova-micro-v1:0"
    assert created_clients[0].region_name == "us-east-1"
    assert created_clients[0].prompts == ["Reply with only: ok"]
    assert "Bedrock smoke test succeeded" in captured
    assert "model=amazon.nova-micro-v1:0" in captured
    assert "region=us-east-1" in captured
    assert "ok from mocked bedrock runtime" in captured


def test_bedrock_smoke_script_uses_safe_defaults(monkeypatch) -> None:
    module = load_smoke_module()
    created_clients: list[RecordingClient] = []

    def client_factory(*, model_id: str, region_name: str) -> RecordingClient:
        client = RecordingClient(model_id=model_id, region_name=region_name)
        created_clients.append(client)
        return client

    monkeypatch.delenv("CHARACTERFORGE_BEDROCK_MODEL_ID", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)
    monkeypatch.delenv("CHARACTERFORGE_BEDROCK_SMOKE_PROMPT", raising=False)

    exit_code = module.run_smoke_test(client_factory=client_factory)

    assert exit_code == 0
    assert created_clients[0].model_id == "amazon.nova-micro-v1:0"
    assert created_clients[0].region_name == "us-east-1"
    assert created_clients[0].prompts == ["Reply with exactly: ok"]
