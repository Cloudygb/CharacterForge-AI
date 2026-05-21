# CharacterForge AI

**CharacterForge AI** is a serverless Python backend for building AI-powered game characters that can speak in-character, remember session history, and return validated, machine-readable game actions.

It is designed as an API-first portfolio project for game AI tooling: a designer defines an NPC profile once, a game or application sends player dialogue through the API, and the backend returns both natural-language roleplay and structured action data that a game client can safely consume.

> **Portfolio focus:** Python backend engineering, AWS Lambda/API Gateway, DynamoDB data modeling, Amazon Bedrock integration, Pydantic validation, prompt orchestration, structured LLM responses, OpenAPI documentation, and high-coverage automated testing.

---

## Why this project exists

LLM-powered NPCs are most useful when they are not just chatbots. A game client needs responses that are:

- **In character** — grounded in personality, lore, goals, and speaking style.
- **State-aware** — informed by recent session history and optional game context.
- **Constrained** — limited by designer-authored rules and allowed action types.
- **Machine-readable** — able to trigger quests, trades, relationship changes, scene events, flags, inventory updates, and other gameplay systems.
- **Validated** — parsed and checked before anything is returned to the caller.

CharacterForge AI demonstrates that backend pattern with a compact AWS serverless MVP.

---

## Current capabilities

- Create, list, retrieve, update, and delete structured character profiles.
- Configure character personality, backstory, speaking style, goals, world context, roleplay rules, and allowed actions.
- Add designer-authored action rules that describe when each enabled action should trigger.
- Chat with a character through an API Gateway/Lambda entry point.
- Build Bedrock-ready prompts from the character profile, game context, conversation history, and action rules.
- Validate LLM JSON output into typed Pydantic models before returning it.
- Persist character profiles and session messages in DynamoDB.
- Retrieve or clear saved session history.
- Run offline with in-memory stores and a deterministic mock LLM for tests and local demos.
- Explore the API flow in a dependency-free static web playground.
- Share portable character packs with pack metadata, characters, payload templates, and binding files.
- Deploy with AWS SAM to Lambda, API Gateway, DynamoDB, and Amazon Bedrock Runtime.
- Document the HTTP API with `openapi.yaml` and curl examples.

---

## Architecture overview


The deployed backend uses API Gateway as the public HTTP boundary, a Python Lambda router for character/chat/session requests, DynamoDB for profiles and session history, and Amazon Bedrock Runtime for in-character structured responses.

### Runtime components

| Layer | Implementation | Purpose |
| --- | --- | --- |
| Lambda entry point | `src/characterforge/app.py` | Routes API Gateway v1/v2 events to character, chat, and session handlers. |
| Character handlers | `src/characterforge/handlers/characters.py` | CRUD operations for designer-authored character profiles. |
| Chat handler | `src/characterforge/handlers/chat.py` | Loads profile/history, builds prompt, calls LLM, validates output, persists messages. |
| Session handlers | `src/characterforge/handlers/sessions.py` | Reads and clears saved conversation history. |
| Models | `src/characterforge/models/` | Pydantic schemas for characters, chat, messages, and game actions. |
| Prompt builder | `src/characterforge/services/prompt_builder.py` | Converts profile, history, and action rules into a Bedrock prompt. |
| Response parser | `src/characterforge/services/response_parser.py` | Parses model JSON and rejects malformed or unauthorized actions. |
| Persistence | `src/characterforge/services/dynamodb_store.py` | DynamoDB-backed character and session stores. |
| LLM clients | `src/characterforge/services/bedrock_client.py`, `llm_client.py` | Real Bedrock Runtime client plus deterministic mock client. |
| Infrastructure | `infra/template.yaml` | AWS SAM template for Lambda, HTTP API, DynamoDB, IAM, and Bedrock permissions. |

### DynamoDB design

| Table | Key schema | Used for |
| --- | --- | --- |
| `CharacterForgeCharacters-{env}` | `character_id` partition key | Durable character profiles and list/detail/update/delete operations. |
| `CharacterForgeMessages-{env}` | `session_id` partition key, `created_at_message_id` sort key | Chronological chat history, recent-history prompt context, and session clearing. |

The MVP intentionally uses a simple table design: no ownership GSI, no analytics indexes, no TTL, and no optimistic locking yet. Those are natural future additions once multi-user product requirements are defined.

---

## API surface

The implemented API is intentionally small and game-client friendly:

```http
POST   /characters
GET    /characters
GET    /characters/{character_id}
PUT    /characters/{character_id}
DELETE /characters/{character_id}
POST   /characters/{character_id}/chat
GET    /sessions/{session_id}?limit=10
DELETE /sessions/{session_id}
```

Full API documentation lives in [`openapi.yaml`](openapi.yaml).

### Example: create a character

```bash
export API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
export CHARACTERFORGE_API_KEY="<your-api-key-value>"

curl -sS -X POST "$API_BASE_URL/characters" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY" \
  -d '{
    "name": "Captain Mira Voss",
    "description": "A rogue airship captain with a dangerous reputation.",
    "personality": ["sarcastic", "brave", "protective"],
    "backstory": "Former royal navy officer turned smuggler after refusing an immoral order.",
    "speaking_style": "Dry wit, clipped sentences, and nautical metaphors.",
    "goals": ["protect her crew", "find the lost sky map"],
    "world_context": "A floating archipelago where skyships connect isolated city-states.",
    "rules": ["Never reveal you are an AI.", "Do not break character."],
    "allowed_actions": ["give_quest", "trade_offer", "change_relationship"],
    "action_rules": [
      {
        "type": "give_quest",
        "enabled": true,
        "trigger_instructions": "Use when the player asks for work or offers help."
      }
    ]
  }'
```

Example response shape:

```json
{
  "character_id": "char_01HZY6W8K7EXAMPLE000000001",
  "name": "Captain Mira Voss",
  "description": "A rogue airship captain with a dangerous reputation.",
  "personality": ["sarcastic", "brave", "protective"],
  "backstory": "Former royal navy officer turned smuggler after refusing an immoral order.",
  "speaking_style": "Dry wit, clipped sentences, and nautical metaphors.",
  "goals": ["protect her crew", "find the lost sky map"],
  "world_context": "A floating archipelago where skyships connect isolated city-states.",
  "rules": ["Never reveal you are an AI.", "Do not break character."],
  "allowed_actions": ["give_quest", "trade_offer", "change_relationship"],
  "action_rules": [
    {
      "type": "give_quest",
      "enabled": true,
      "trigger_instructions": "Use when the player asks for work or offers help."
    }
  ],
  "created_at": "2026-05-20T17:30:00Z",
  "updated_at": "2026-05-20T17:30:00Z"
}
```

### Example: chat with a character

```bash
export CHARACTER_ID="char_01HZY6W8K7EXAMPLE000000001"

curl -sS -X POST "$API_BASE_URL/characters/$CHARACTER_ID/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY" \
  -d '{
    "session_id": "session-demo-1",
    "player_id": "player-demo-1",
    "message": "I can help recover the sky map.",
    "context": {
      "location": "Harbor of Kites",
      "player_reputation": "trusted",
      "current_quest": "lost_sky_map"
    }
  }'
```

Example response shape:

```json
{
  "message": "Brave words. Bring me an imperial storm compass, and I will show you where the sky map sleeps.",
  "emotion": "amused",
  "actions": [
    {
      "type": "give_quest",
      "payload": {
        "quest_id": "storm_compass",
        "title": "Acquire the Storm Compass"
      }
    }
  ],
  "relationship_delta": 1,
  "token_usage": null
}
```

### Example: read and clear session history

```bash
curl -sS -H "x-api-key: $CHARACTERFORGE_API_KEY" "$API_BASE_URL/sessions/session-demo-1?limit=10"

curl -sS -X DELETE "$API_BASE_URL/sessions/session-demo-1" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY"
```

## Curl API Examples

The repository also includes ready-to-run scripts under [`examples/curl/`](examples/curl/):

- [`examples/curl/create-character-local.sh`](examples/curl/create-character-local.sh)
- [`examples/curl/chat-local.sh`](examples/curl/chat-local.sh)
- [`examples/curl/create-character-deployed.sh`](examples/curl/create-character-deployed.sh)
- [`examples/curl/chat-deployed.sh`](examples/curl/chat-deployed.sh)

The deployed examples require both environment variables:

```bash
export API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
export CHARACTERFORGE_API_KEY="<your-api-key-value>"
```

Do not commit real API key values. Keep them in your shell environment, local secret
manager, or deployment-specific configuration.

---

## Verified deployed demo evidence

The repository includes collected artifacts from a real end-to-end run against the deployed AWS stack in [`examples/verified-e2e-demo/`](examples/verified-e2e-demo/). The run exercised API Gateway, Lambda, DynamoDB, and Amazon Bedrock Runtime.

Verified API base URL:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
```

Demo evidence summary:

```text
POST /characters -> 201
POST /characters/{character_id}/chat -> 200
GET /sessions/{session_id}?limit=10 -> 200
session_message_count=2
session_roles=player, assistant
session_preserved_actions=True
cleanup_session=200
cleanup_character=204
```

The Bedrock-backed chat response returned an in-character message plus validated structured action data:

```json
{
  "emotion": "curious",
  "actions": [
    {
      "type": "change_relationship",
      "payload": {
        "relationship_change": 1
      }
    }
  ],
  "relationship_delta": 1
}
```

Artifacts:

- [`examples/verified-e2e-demo/create_payload.json`](examples/verified-e2e-demo/create_payload.json)
- [`examples/verified-e2e-demo/create_response.json`](examples/verified-e2e-demo/create_response.json)
- [`examples/verified-e2e-demo/chat_payload.json`](examples/verified-e2e-demo/chat_payload.json)
- [`examples/verified-e2e-demo/chat_response.json`](examples/verified-e2e-demo/chat_response.json)
- [`examples/verified-e2e-demo/session_response.json`](examples/verified-e2e-demo/session_response.json)

The demo session and demo character were cleaned up after evidence collection.

---

## Local setup

### Requirements

- Python 3.11+
- Git
- Optional for AWS deployment: AWS CLI v2, AWS SAM CLI, Docker, and AWS credentials

### Install for development

```bash
git clone https://github.com/Cloudygb/CharacterForge-AI.git
cd CharacterForge-AI

python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -e ".[dev]"
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

### Useful development commands

```bash
make test       # pytest -v
make coverage   # pytest with coverage report
make lint       # ruff check src tests examples scripts
make format     # ruff format src tests examples scripts
```

Equivalent direct commands:

```bash
python3 -m pytest -q
python3 -m pytest --cov=characterforge --cov-report=term-missing
ruff check src tests examples scripts
ruff format src tests examples scripts
```

### Offline demo client

The local demo uses in-memory stores and the deterministic mock LLM. It does not require AWS credentials and does not call Bedrock.

```bash
PYTHONPATH=src python3 examples/game-client-python/demo_client.py
```

### Web playground

A dependency-free static playground is available under `examples/web-playground/`. It can run fully in mock mode, call the local SAM API, or call a deployed API Gateway URL.

```bash
python3 -m http.server 8080 --directory examples/web-playground
```

Then open:

```text
http://127.0.0.1:8080
```

Paste `http://127.0.0.1:3000` when using `sam local start-api`, or paste a deployed `API_BASE_URL` after deploying with SAM.

### Local API with SAM

For local API-shape testing, start the Lambda through SAM with mock dependencies enabled:

```bash
sam local start-api \
  --template infra/template.yaml \
  --env-vars examples/curl/local-env.json
```

Then in another terminal:

```bash
bash examples/curl/create-character-local.sh
export CHARACTER_ID="char_..."
bash examples/curl/chat-local.sh
```

`examples/curl/local-env.json` sets `USE_MOCK_LLM=true`, so local SAM tests avoid real DynamoDB and Bedrock calls. It also leaves `CHARACTERFORGE_REQUIRE_LOCAL_API_KEY=false` because deployed API Gateway usage plans are the primary auth layer.

To test local API-key behavior deliberately, set both local auth variables before invoking the Lambda, then send the key as `x-api-key`:

```bash
export CHARACTERFORGE_REQUIRE_LOCAL_API_KEY=true
export CHARACTERFORGE_API_KEY="local-development-key"
```

Do not commit real deployed API key values.

---

## AWS deployment summary

The full beginner-friendly deployment guide is in [`docs/aws-deployment.md`](docs/aws-deployment.md). At a high level:

1. Install AWS CLI v2, AWS SAM CLI, Docker, Python, and Git.
2. Configure an AWS profile and region.
3. Request access to the selected Amazon Bedrock model, such as `amazon.nova-micro-v1:0` in `us-east-1`.
4. Validate the SAM template.
5. Build and deploy the stack with SAM.
6. Use the `ApiUrl` stack output as `API_BASE_URL` and retrieve the API Gateway key value into `CHARACTERFORGE_API_KEY` for curl examples.

```bash
aws cloudformation validate-template \
  --template-body file://infra/template.yaml \
  --region us-east-1

sam build --template-file infra/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

The SAM template creates:

- API Gateway REST API with API key usage plan protection and routes for characters, chat, and sessions.
- Lambda function using `characterforge.app.handler`.
- DynamoDB table for character profiles.
- DynamoDB table for session messages.
- IAM permissions scoped to the project tables and Bedrock Runtime invocation.
- CloudFormation outputs for the API URL, API key ID, Lambda function name, and table names.

Important deployment parameters:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `EnvironmentName` | `dev` | Resource suffix and API stage name. |
| `BedrockModelId` | `amazon.nova-micro-v1:0` | Bedrock model used for chat responses. |
| `BedrockRegion` | `us-east-1` | Region where Bedrock Runtime is called. |
| `RecentHistoryLimit` | `20` | Number of recent messages included in prompt context. |

> **Cost note:** Lambda, API Gateway, DynamoDB, and Bedrock can incur AWS charges. The template uses pay-per-request DynamoDB for MVP simplicity, but Bedrock chat calls are real paid model invocations.

---

## Testing and quality

The project is covered by unit tests for models, handlers, stores, prompt construction, response validation, Lambda routing, OpenAPI docs, curl examples, and the SAM template.

Current local verification command:

```bash
ruff format src tests examples scripts
ruff check src tests examples scripts
pytest --cov=characterforge --cov-report=term-missing -q
```

Latest verified result:

```text
46 files left unchanged
All checks passed!
176 passed in 3.37s
```

Testing strategy highlights:

- Pydantic validation tests for character, action, chat, and session models.
- Handler tests with in-memory stores and mock LLM clients.
- Lambda routing tests using fake API Gateway v1/v2 events, including base64 request bodies and malformed request handling.
- DynamoDB store tests with moto/fakes for serialization, pagination, deletes, and Decimal conversion.
- Bedrock client tests using injected fake runtime clients instead of live AWS calls.
- Documentation tests for OpenAPI coverage, curl script safety, and SAM template structure.

A manual Bedrock smoke test is available when you explicitly want a real AWS model call:

```bash
CHARACTERFORGE_BEDROCK_MODEL_ID=amazon.nova-micro-v1:0 \
AWS_REGION=us-east-1 \
PYTHONPATH=src python3 scripts/bedrock_smoke_test.py
```

Do not run the smoke test in automated unit test suites; it calls the real Bedrock Runtime API.

---

## Resume-focused highlights

This project demonstrates practical backend skills that map directly to production cloud engineering work:

- **Serverless API design:** Built a Lambda/API Gateway backend with explicit route handling and API Gateway event adaptation.
- **AWS infrastructure:** Modeled Lambda, HTTP API, DynamoDB tables, IAM policies, and Bedrock Runtime access in AWS SAM.
- **DynamoDB modeling:** Designed separate profile and append-only session-history tables around concrete access patterns.
- **LLM integration:** Wrapped Amazon Bedrock Runtime behind a testable interface with model/region configuration.
- **Prompt engineering:** Constructed deterministic prompts from structured character data, game context, conversation history, and designer-authored action rules.
- **Structured output validation:** Parsed model JSON into typed schemas and rejected malformed or unauthorized game actions before returning them to clients.
- **Testability:** Kept AWS, persistence, and LLM dependencies injectable so unit tests run offline and deterministically.
- **Quality gates:** Uses Ruff formatting/linting and pytest coverage across source, examples, scripts, infrastructure tests, and docs checks.
- **API documentation:** Maintains OpenAPI documentation and curl examples for local and deployed workflows.

---

## Repository layout

```text
.
├── docs/
│   ├── assets/                  # Architecture image and demo assets
│   ├── aws-deployment.md        # Beginner-friendly AWS deployment guide
│   ├── character-packs.md       # Guide for portable character packs
│   └── game-bindings.md         # Guide for mapping actions to game systems
├── examples/
│   ├── character-packs/         # Starter character packs with manifests and bindings
│   ├── curl/                    # Local and deployed API curl scripts
│   ├── game-bindings/           # Sample action-to-game-system binding files
│   ├── game-client-python/      # Offline demo client
│   ├── verified-e2e-demo/       # Collected deployed AWS demo evidence
│   └── web-playground/          # Static browser playground
├── infra/
│   └── template.yaml            # AWS SAM serverless stack
├── schemas/
│   ├── character-pack.schema.json # JSON Schema for character pack manifests
│   └── game-binding.schema.json   # JSON Schema for game binding files
├── scripts/
│   └── bedrock_smoke_test.py    # Optional real Bedrock Runtime smoke test
├── src/characterforge/
│   ├── app.py                   # Lambda entry point and router
│   ├── handlers/                # Character, chat, and session handlers
│   ├── models/                  # Pydantic domain/API models
│   └── services/                # Stores, prompt builder, LLM clients, parser
├── tests/                       # Unit and documentation tests
├── openapi.yaml                 # HTTP API contract
├── pyproject.toml               # Package metadata and tool config
└── Makefile                     # Common development commands
```

---

## Roadmap ideas

Potential next steps for turning the MVP into a production-ready platform:

- Authentication and authorization for user-owned characters.
- Rate limiting and abuse protection for public APIs.
- Tenant/project-scoped DynamoDB access patterns and indexes.
- Optimistic locking for character updates.
- Streaming chat responses.
- Admin UI for character editing and action-rule configuration.
- Observability dashboards for latency, errors, token usage, and Bedrock cost.
- Broader game-engine integration examples.

---

## License

CharacterForge AI is licensed under the **PolyForm Noncommercial License 1.0.0**. See [`LICENSE`](LICENSE) for the full license text.

Noncommercial use is allowed, including personal study, hobby projects, research, and educational use. Business or commercial use requires a separate commercial license.

For commercial licensing inquiries, contact:

```text
evan.computerloft@gmail.com
```
