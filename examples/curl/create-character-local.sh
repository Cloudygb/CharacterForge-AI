#!/usr/bin/env bash
set -euo pipefail

# Create Captain Mira Voss against a local SAM API running with USE_MOCK_LLM=true.
# Start the local mock API from the repository root with:
#   sam local start-api --template infra/template.yaml --env-vars examples/curl/local-env.json
#
# Override LOCAL_API_BASE_URL if your local API uses a different host or port.

BASE_URL="${LOCAL_API_BASE_URL:-http://127.0.0.1:3000}"
RESPONSE_FILE="${RESPONSE_FILE:-/tmp/characterforge-create-character-local.json}"

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
    print(f"\nUse this for chat examples: export CHARACTER_ID={character_id}")
PY
