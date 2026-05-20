#!/usr/bin/env bash
set -euo pipefail

# Chat with a character through a deployed CharacterForge API Gateway endpoint.
# Run examples/curl/create-character-deployed.sh first, then export the returned ID:
#   export CHARACTER_ID=char_...
#
# Required:
#   API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev
# Optional:
#   SESSION_ID=session-demo-1
#   PLAYER_ID=player-demo-1
#   PLAYER_MESSAGE="I can help recover the sky map."

: "${API_BASE_URL:?Set API_BASE_URL to your deployed CharacterForge API base URL}"
: "${CHARACTER_ID:?Set CHARACTER_ID to a character_id returned by create-character-deployed.sh}"

BASE_URL="${API_BASE_URL%/}"
SESSION_ID="${SESSION_ID:-session-demo-deployed-1}"
PLAYER_ID="${PLAYER_ID:-player-demo-1}"
PLAYER_MESSAGE="${PLAYER_MESSAGE:-I can help recover the sky map. What needs doing first?}"
RESPONSE_FILE="${RESPONSE_FILE:-/tmp/characterforge-chat-deployed.json}"
REQUEST_FILE="$(mktemp)"
trap 'rm -f "${REQUEST_FILE}"' EXIT

python3 - <<'PY' "${REQUEST_FILE}" "${SESSION_ID}" "${PLAYER_ID}" "${PLAYER_MESSAGE}"
import json
import sys
from pathlib import Path

request_path, session_id, player_id, message = sys.argv[1:]
Path(request_path).write_text(
    json.dumps(
        {
            "session_id": session_id,
            "player_id": player_id,
            "message": message,
            "context": {
                "location": "Harbor of Kites",
                "player_reputation": "trusted",
                "current_quest": "lost_sky_map",
            },
        },
        indent=2,
    ),
    encoding="utf-8",
)
PY

curl --fail --silent --show-error \
  --request POST \
  --url "${BASE_URL}/characters/${CHARACTER_ID}/chat" \
  --header "Content-Type: application/json" \
  --data-binary "@${REQUEST_FILE}" \
  --output "${RESPONSE_FILE}"

python3 - <<'PY' "${RESPONSE_FILE}"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(json.dumps(payload, indent=2))
PY
