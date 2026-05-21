# Verified end-to-end AWS demo evidence

This directory contains request and response artifacts from a real deployed CharacterForge AI run against AWS API Gateway, Lambda, DynamoDB, and Amazon Bedrock Runtime.

## Run metadata

| Field | Value |
| --- | --- |
| Run ID | `readme-demo-20260521T003735Z` |
| Stack | `characterforge-ai-dev` |
| Region | `us-east-1` |
| API base URL | Omitted from the public repo; keep stack-specific endpoints in local notes or a secret manager. |
| Model | `amazon.nova-micro-v1:0` |
| Demo character | `Captain Mira Voss` |
| Demo character ID | `char_f9d35b183bca42c6859f7300e1f67e75` |
| Demo session ID | `session-readme-demo-20260521T003735Z` |

The demo character and session were deleted after evidence collection:

```text
DELETE /sessions/session-readme-demo-20260521T003735Z -> 200 {"cleared_count": 2}
DELETE /characters/char_f9d35b183bca42c6859f7300e1f67e75 -> 204
```

## Files

| File | Purpose |
| --- | --- |
| [`create_payload.json`](create_payload.json) | Request body for `POST /characters`. |
| [`create_response.json`](create_response.json) | Verified `201` response from `POST /characters`. |
| [`chat_payload.json`](chat_payload.json) | Request body for `POST /characters/{character_id}/chat`. |
| [`chat_response.json`](chat_response.json) | Verified `200` response from the Bedrock-backed chat endpoint. |
| [`session_response.json`](session_response.json) | Verified `200` response from `GET /sessions/{session_id}?limit=10`. |

## Verified behavior

- `POST /characters` returned `201` and created `Captain Mira Voss`.
- `POST /characters/{character_id}/chat` returned `200` with an in-character response.
- The chat response included the structured action:

```json
{
  "type": "change_relationship",
  "payload": {
    "relationship_change": 1
  }
}
```

- The chat response included `emotion: "curious"` and `relationship_delta: 1`.
- `GET /sessions/{session_id}?limit=10` returned `200` with two persisted messages: `player`, then `assistant`.
- The assistant session record preserved the structured `change_relationship` action payload.

## README-ready summary

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
