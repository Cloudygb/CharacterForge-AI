#!/usr/bin/env bash
set -euo pipefail

# Create Captain Mira Voss against a deployed CharacterForge API Gateway endpoint.
# Set API_BASE_URL to the deployed ApiUrl output, for example:
#   export API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev

: "${API_BASE_URL:?Set API_BASE_URL to your deployed CharacterForge API base URL}"

BASE_URL="${API_BASE_URL%/}"
RESPONSE_FILE="${RESPONSE_FILE:-/tmp/characterforge-create-character-deployed.json}"

curl --fail --silent --show-error \
  --request POST \
  --url "${BASE_URL}/characters" \
  --header "Content-Type: application/json" \
  --data-binary @examples/sample-characters/captain-mira-voss.json \
  --output "${RESPONSE_FILE}"

python3 - <<'PY' "${RESPONSE_FILE}"
import json
import sys
from pathlib import Path

response_path = Path(sys.argv[1])
payload = json.loads(response_path.read_text(encoding="utf-8"))
print(json.dumps(payload, indent=2))
character_id = payload.get("character_id")
if character_id:
    print(f"\nUse this for deployed chat: export CHARACTER_ID={character_id}")
PY
