# CharacterForge AI

**CharacterForge AI** is an AWS-hosted, API-first platform for creating AI-powered game characters from structured character profiles.

Game designers and developers can define reusable NPCs with personality, backstory, goals, world context, speaking style, and allowed actions. External applications can then prompt those characters through an API and receive both in-character dialogue and machine-readable game actions.

> Portfolio goal: demonstrate Python backend development, AWS serverless architecture, Amazon Bedrock integration, DynamoDB data modeling, prompt orchestration, structured LLM outputs, testing, and API documentation.

---

## MVP Vision

CharacterForge AI will allow a client application to:

1. Create a structured character profile.
2. Persist that profile.
3. Send player dialogue and game context to the character.
4. Generate an in-character response with AWS Bedrock.
5. Return validated structured actions such as quests, trades, relationship changes, scene triggers, or world flags.
6. Store session history so conversations have continuity.

---

## Planned Tech Stack

- **Language:** Python 3.11+
- **Cloud:** AWS
- **LLM Provider:** Amazon Bedrock, configurable via `CHARACTERFORGE_BEDROCK_MODEL_ID`
- **Compute:** AWS Lambda
- **API:** Amazon API Gateway
- **Database:** Amazon DynamoDB
- **Infrastructure as Code:** AWS SAM
- **Validation:** Pydantic
- **AWS SDK:** boto3
- **Testing:** pytest, pytest-cov, moto
- **Linting / Formatting:** Ruff

---

## Planned API Surface

```http
POST /characters
GET /characters
GET /characters/{character_id}
PUT /characters/{character_id}
DELETE /characters/{character_id}
POST /characters/{character_id}/chat
GET /sessions/{session_id}
DELETE /sessions/{session_id}
```

---

## Example Character Profile

```json
{
  "name": "Captain Mira Voss",
  "description": "A rogue airship captain.",
  "personality": ["sarcastic", "brave", "protective"],
  "backstory": "Former royal navy officer turned smuggler.",
  "speaking_style": "Dry wit, clipped sentences, nautical metaphors.",
  "goals": ["protect her crew", "find the lost sky map"],
  "world_context": "A floating archipelago world.",
  "rules": ["Never reveal you are an AI.", "Do not break character."],
  "allowed_actions": ["give_quest", "trade_offer", "change_relationship"]
}
```

---

## Example Chat Response

```json
{
  "message": "Cross the storm wall? Brave. Maybe foolish. I can get you through, but I need an imperial storm compass first.",
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
  "relationship_delta": 1
}
```

---

## Project Status

This repository is currently being built step-by-step as a polished proof-of-concept portfolio project.

Initial focus:

- Local Python project structure
- Pydantic models
- Prompt builder
- Mock LLM client
- Structured action validation
- DynamoDB persistence layer
- AWS Bedrock integration
- AWS SAM deployment template
- OpenAPI documentation

---

## Local Development

Create and activate a local virtual environment, then install the project with development dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e ".[dev]"
```

On Ubuntu/WSL, if virtual environment creation fails because `ensurepip` is missing, install the venv package first:

```bash
sudo apt update
sudo apt install python3.12-venv
```

Common development commands are available through the `Makefile`:

```bash
make install
make test
make coverage
make lint
make format
```

---

## Local Game Client Demo

A local Python demo client is available at:

```text
examples/game-client-python/demo_client.py
```

It demonstrates the current API-style flow without requiring AWS or a running web server:

1. Load a sample character profile.
2. Create the character through the local character handler.
3. Send a player chat message through the local chat handler.
4. Print the returned in-character dialogue.
5. Print the structured actions a game client could consume.

Run it from the repository root with `src` on `PYTHONPATH`:

```bash
PYTHONPATH=src python3 examples/game-client-python/demo_client.py
```

The demo uses the deterministic `MockLLMClient`, so it is safe to run offline and does not call Amazon Bedrock.

---

## Curl API Examples

Shell-based curl examples are available under:

```text
examples/curl/
```

They demonstrate the two most common API flows:

1. Create a character with the Captain Mira Voss sample profile.
2. Chat with the newly created character using a session ID and player message.

### Local/mock API examples

Use the local examples when running API Gateway locally through AWS SAM with the deterministic mock LLM enabled. This avoids DynamoDB and Bedrock calls, making the examples safe for offline API-shape testing.

Start the local API from the repository root:

```bash
sam local start-api --template infra/template.yaml --env-vars examples/curl/local-env.json
```

In another terminal, create a character:

```bash
bash examples/curl/create-character-local.sh
```

The script prints the created profile and an `export CHARACTER_ID=...` line. Use that ID for chat:

```bash
export CHARACTER_ID=char_...
bash examples/curl/chat-local.sh
```

Optional local overrides:

```bash
LOCAL_API_BASE_URL=http://127.0.0.1:3000 \
SESSION_ID=session-demo-local-1 \
PLAYER_MESSAGE="I can help recover the sky map." \
bash examples/curl/chat-local.sh
```

The local SAM environment file is `examples/curl/local-env.json`; it sets `USE_MOCK_LLM=true` so the Lambda uses in-memory stores and `MockLLMClient`.

### Deployed API examples

After deploying with SAM, set `API_BASE_URL` to the `ApiUrl` stack output. The deployment guide in `docs/aws-deployment.md` shows how to retrieve that value.

```bash
export API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev
bash examples/curl/create-character-deployed.sh
```

The create script prints the returned character ID. Use it to chat with the deployed API:

```bash
export CHARACTER_ID=char_...
bash examples/curl/chat-deployed.sh
```

Optional deployed chat overrides:

```bash
SESSION_ID=session-demo-deployed-1 \
PLAYER_ID=player-demo-1 \
PLAYER_MESSAGE="What is the first step through the Stormwall?" \
bash examples/curl/chat-deployed.sh
```

The deployed examples call the real deployed backend. If the stack is configured with Bedrock and DynamoDB, chat requests can invoke Amazon Bedrock and write session history to DynamoDB.

---

## Bedrock Smoke Test

A manual Bedrock smoke test is available at:

```text
scripts/bedrock_smoke_test.py
```

It is intentionally not part of the normal test suite. Run it only when you explicitly want to make a tiny real AWS Bedrock call using your configured AWS credentials:

```bash
CHARACTERFORGE_BEDROCK_MODEL_ID=amazon.nova-micro-v1:0 \
AWS_REGION=us-east-1 \
PYTHONPATH=src python3 scripts/bedrock_smoke_test.py
```

Optional environment variables:

- `CHARACTERFORGE_BEDROCK_MODEL_ID` defaults to `amazon.nova-micro-v1:0`
- `AWS_REGION` or `AWS_DEFAULT_REGION` defaults to `us-east-1`
- `CHARACTERFORGE_BEDROCK_SMOKE_PROMPT` defaults to `Reply with exactly: ok`

The script prints the model, region, and a short result. It should not be run from automated tests because it calls the real Bedrock Runtime API.

---

## License

CharacterForge AI is licensed under the **PolyForm Noncommercial License 1.0.0**. See `LICENSE` for the full license text.

This allows noncommercial use, including:

- Personal study
- Hobby projects
- Research
- Educational institution use

Business or commercial use is not permitted unless a separate commercial license is granted.

For commercial licensing inquiries, contact:

```text
evan.computerloft@gmail.com
```

Website:

```text

```
