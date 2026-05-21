# CharacterForge Dashboard

React/Vite/TypeScript dashboard for CharacterForge AI.

The dashboard starts in mock mode when no API base URL is set. When a local base URL and API key are entered in the API Settings screen, the app uses the CharacterForge TypeScript SDK client to test the connection, list characters, and submit character profile create/update payloads to the API.

## Screens

- Welcome
- API Settings
- Setup Check
- Characters
- Character Editor
- Character Packs
- Chat Test
- Raw JSON Preview

## Setup Check

The Setup Check screen uses a mocked setup-check adapter first so dashboard tests and local demos never call AWS directly. It shows:

- AWS region.
- Selected Bedrock model.
- Credential status.
- Bedrock access status.
- Existing stack status.
- Warnings about mock-only results, Bedrock access confirmation, non-default regions, and higher-cost model choices.

This readiness panel is intentionally browser-local for now. Treat its results as guidance only until a future server-side setup-check endpoint performs real AWS, Bedrock, and CloudFormation checks with credentials stored outside the browser.

## Character Editor

The Character Editor builds the exact JSON body that the API receives for character create and update requests. Use it to:

- Write the core profile fields: name, description, personality, backstory, speaking style, goals, world context, and roleplay rules.
- Select allowed action groups for quests, fights, items, dialogue, and flags.
- Add trigger instructions for each selected action type.
- Edit payload template JSON for each selected action group.
- Preview the final `allowed_actions`, `action_rules`, and `payload_templates` payload before submitting.
- Leave the existing character ID blank to create a new profile, or enter a character ID to update that profile.

The editor validates required fields, list fields, selected actions, trigger instructions, and template JSON before making an SDK call.

## Character Packs

The Character Packs screen keeps pack file handling local in the browser wherever possible. Use it to:

- Load a `character-pack.json` bundle, extracted pack folder, or `.zip` archive from your computer.
- Validate pack metadata, referenced character payloads, optional binding files, and payload template structure before import.
- Preview pack metadata, characters, payload templates, and bindings as JSON before sending anything to the API.
- Select which characters to import, then create those characters through the configured TypeScript SDK client.
- Export selected characters as a browser-generated JSON bundle that includes `character_documents`, `payload_templates`, and `binding_documents`.

Only the explicit import action calls the CharacterForge API. Loading, validating, previewing, and export preparation happen in the browser using local file APIs.

## Local commands

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Use placeholder API settings in examples and docs:

```text
CHARACTERFORGE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
CHARACTERFORGE_API_KEY=<your-api-key-value>
```

Do not paste production API keys into source files, browser bundles, committed config, screenshots, or frontend tests. The dashboard keeps the typed API key in component state for the current browser session and does not persist it to localStorage. Public deployments should use a trusted backend/proxy for secret storage instead of exposing keys to browser clients.
