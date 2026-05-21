# CharacterForge AI

**CharacterForge AI** is a user-friendly game AI platform for building, testing, packaging, and deploying AI-powered game characters. It combines a serverless AWS backend API, a React/Tauri dashboard, guided AWS setup screens, portable character packs, SDK integrations, and desktop Start/End deployment controls.

Designers can author an NPC once, package it with reusable action payloads, test it in the dashboard, and hand it to a game client through a clean API. Developers can integrate the same character through curl examples, a TypeScript SDK, Unity/Unreal guides, or direct HTTP calls. The backend returns both natural-language roleplay and validated, machine-readable gameplay actions.

> **Portfolio focus:** product-minded game AI tooling, Python backend engineering, AWS Lambda/API Gateway, DynamoDB data modeling, Amazon Bedrock integration, React/Tauri dashboard UX, Pydantic validation, prompt orchestration, structured LLM responses, OpenAPI documentation, and high-coverage automated testing.

---

## Why this project exists

LLM-powered NPCs are most useful when they are not just chatbots. A game client needs responses that are:

- **In character** — grounded in personality, lore, goals, and speaking style.
- **State-aware** — informed by recent session history and optional game context.
- **Constrained** — limited by designer-authored rules and allowed action types.
- **Machine-readable** — able to trigger quests, trades, relationship changes, scene events, flags, inventory updates, and other gameplay systems.
- **Validated** — parsed and checked before anything is returned to the caller.

CharacterForge AI turns that backend pattern into a small platform: author characters locally, test them through the dashboard, package reusable content, and deploy the runtime to AWS when you are ready.

---

## Current capabilities

### Game AI platform experience

- **Dashboard-first workflow:** use the React/Vite dashboard to configure API settings, run setup checks, edit character profiles, preview JSON payloads, import/export character packs, test chat, and inspect raw responses.
- **Desktop deployment controls:** run the dashboard as a Tauri desktop app with guarded Start/End controls for local SAM/CloudFormation deployment workflows. Browser-only mode stays dry-run; real cloud commands are routed through the trusted desktop shell.
- **Guided AWS setup:** walk through region, Bedrock model, credential readiness, stack status, deployment preview, and cost warnings before touching live AWS resources.
- **Portable character packs:** share pack metadata, character documents, payload templates, and binding files as local JSON bundles.
- **Game integration paths:** use the TypeScript SDK, curl examples, static web playground, Python demo client, and Unity/Unreal guides to wire returned actions into gameplay systems.

### Backend API and infrastructure

- Create, list, retrieve, update, and delete structured character profiles.
- Configure character personality, backstory, speaking style, goals, world context, roleplay rules, and allowed actions.
- Add designer-authored action rules that describe when each enabled action should trigger.
- Chat with a character through an API Gateway/Lambda entry point.
- Build Bedrock-ready prompts from the character profile, game context, conversation history, and action rules.
- Validate LLM JSON output into typed Pydantic models before returning it.
- Persist character profiles and session messages in DynamoDB.
- Retrieve or clear saved session history.
- Run offline with in-memory stores and a deterministic mock LLM for tests and local demos.
- Deploy with AWS SAM/CloudFormation to Lambda, API Gateway, DynamoDB, Amazon Bedrock Runtime, API Gateway access logs, and a CloudWatch dashboard.
- Document the HTTP API with `openapi.yaml` and curl examples.

---

## Architecture overview


CharacterForge is organized around a local authoring/deployment experience and a cloud-hosted game AI runtime:

- **Dashboard layer:** React/Vite web UI plus optional Tauri desktop shell for setup checks, pack workflows, SDK-backed API calls, and guarded deployment controls.
- **Backend API layer:** API Gateway REST API and a Python Lambda router for character, chat, and session requests.
- **Data and AI layer:** DynamoDB stores character profiles/session history, while Amazon Bedrock Runtime generates structured in-character responses.
- **Observability layer:** CloudWatch dashboard widgets and API Gateway/Lambda log links provide a ready-made production visibility starting point.

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
| Infrastructure | `infra/template.yaml` | AWS SAM template for Lambda, REST API usage plans, DynamoDB, IAM, Bedrock permissions, access logs, and CloudWatch dashboard resources. |

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

### Python game-client demo

The Python game-client example is safe by default: it runs in mock mode, does not require AWS credentials, and does not call the network. It also shows how a deployed API client sends `x-api-key` and how returned actions are dispatched to game-side handlers.

```bash
PYTHONPATH=src python3 examples/game-client-python/demo_client.py
```

To intentionally call a deployed API Gateway URL, opt into live mode and provide an API key from your environment:

```bash
export CHARACTERFORGE_DEMO_MODE=live
export CHARACTERFORGE_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
export CHARACTERFORGE_API_KEY="<your-api-key-value>"
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

## Guided AWS setup and deployment summary

The full beginner-friendly deployment guide is in [`docs/aws-deployment.md`](docs/aws-deployment.md). CharacterForge uses SAM/CloudFormation directly for the current deployment MVP; no Terraform architecture is required or included.

At a high level:

1. Install AWS CLI v2, AWS SAM CLI, Docker, Python, and Git.
2. Configure an AWS profile and region without committing credential files or key values.
3. Request access to the selected Amazon Bedrock model, such as `amazon.nova-micro-v1:0` in `us-east-1`.
4. Use the dashboard setup screen to review region, model, credential readiness, stack status, and cost warnings.
5. Validate the SAM template.
6. Build and deploy the stack with SAM, either manually or through the guarded desktop Start flow.
7. Use the `ApiUrl` stack output as `API_BASE_URL` and retrieve the API Gateway key value into `CHARACTERFORGE_API_KEY` for curl examples.
8. Use the desktop End flow when you want to tear down the stack; export or back up needed data before deletion.

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
- API Gateway access log group with bounded retention.
- CloudWatch dashboard widgets for Lambda, API Gateway, DynamoDB throttles, and log links.
- IAM permissions scoped to the project tables and Bedrock Runtime invocation.
- CloudFormation outputs for the API URL, API key ID, Lambda function name, table names, access log group, and dashboard name.

Important deployment parameters:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `EnvironmentName` | `dev` | Resource suffix and API stage name. |
| `BedrockModelId` | `amazon.nova-micro-v1:0` | Bedrock model used for chat responses. |
| `BedrockRegion` | `us-east-1` | Region where Bedrock Runtime is called. |
| `RecentHistoryLimit` | `20` | Number of recent messages included in prompt context. |

> **Cost note:** Lambda, API Gateway, DynamoDB, CloudWatch logs/dashboards, and Bedrock can incur AWS charges. The template uses pay-per-request DynamoDB for MVP simplicity, but Bedrock chat calls are real paid model invocations. Use the End flow or manual CloudFormation deletion when you no longer need the stack.

### Desktop Start/End controls

The dashboard's desktop deployment flow is intentionally conservative:

- **Start** previews the exact SAM/CloudFormation intent, checks local AWS inputs, redacts temporary credential values, and polls CloudFormation stack status after deployment starts.
- **End** requires typed confirmation for the target stack, prompts for export/backup before deletion, redacts logs, and surfaces rollback or `DELETE_FAILED` guidance instead of hiding partial failures.
- Browser-only dashboard mode does not run real AWS commands. Real deployment actions are only available through the local desktop shell adapter.
- No Terraform layer is needed for this platform step; the documented local deployment engine uses SAM and CloudFormation directly.

---

## Testing and quality

The project is covered by unit tests for models, handlers, stores, prompt construction, response validation, Lambda routing, OpenAPI docs, curl examples, and the SAM template.

Current local verification command:

```bash
ruff format src tests examples scripts
ruff check src tests examples scripts
pytest --cov=characterforge --cov-report=term-missing -q
```

Latest verified local result:

```text
pytest -q -> 228 passed in 68.56s
pytest tests/test_public_artifacts_security.py -q -> 1 passed
Dashboard JSON validation -> dashboard json valid; resources 9
git diff --check -> passed
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

- **Product-oriented platform UX:** Connects backend API work to a dashboard, guided setup flow, character packs, SDK examples, and desktop deployment lifecycle controls.
- **Serverless API design:** Built a Lambda/API Gateway backend with explicit route handling and API Gateway event adaptation.
- **AWS infrastructure:** Modeled Lambda, REST API usage plans, DynamoDB tables, IAM policies, Bedrock Runtime access, API Gateway logs, and CloudWatch dashboard resources in AWS SAM.
- **DynamoDB modeling:** Designed separate profile and append-only session-history tables around concrete access patterns.
- **LLM integration:** Wrapped Amazon Bedrock Runtime behind a testable interface with model/region configuration.
- **Prompt engineering:** Constructed deterministic prompts from structured character data, game context, conversation history, and designer-authored action rules.
- **Structured output validation:** Parsed model JSON into typed schemas and rejected malformed or unauthorized game actions before returning them to clients.
- **Testability:** Kept AWS, persistence, deployment adapters, and LLM dependencies injectable so unit tests run offline and deterministically.
- **Quality gates:** Uses Ruff formatting/linting and pytest coverage across source, examples, scripts, infrastructure tests, and docs checks.
- **API documentation:** Maintains OpenAPI documentation and curl examples for local and deployed workflows.

---

## Repository layout

```text
.
├── apps/
│   └── dashboard/               # React/Vite API dashboard, Tauri shell, setup checks, character editor, and pack import/export
├── docs/
│   ├── assets/                  # Architecture image and demo assets
│   ├── game-engines/            # Unity and Unreal integration guides
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
│   ├── bedrock_smoke_test.py    # Optional real Bedrock Runtime smoke test
│   ├── character_pack_export.py # Local JSON character pack exporter
│   └── character_pack_import.py # Local JSON character pack validator/import dry run
├── sdk/
│   └── typescript/              # Minimal TypeScript SDK package
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
- Richer admin workflows for bulk editing, approvals, and action-rule review.
- Sanitized dashboard screenshots/GIFs that replace the current README placeholders.
- CloudWatch alarms and deeper cost/token usage reporting.
- Broader game-engine integration examples.

---

## License

CharacterForge AI is licensed under the **PolyForm Noncommercial License 1.0.0**. See [`LICENSE`](LICENSE) for the full license text.

Noncommercial use is allowed, including personal study, hobby projects, research, and educational use. Business or commercial use requires a separate commercial license.

For commercial licensing inquiries, contact:

```text
evan.computerloft@gmail.com
```
