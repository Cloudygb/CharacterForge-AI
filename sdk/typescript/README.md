# CharacterForge TypeScript SDK

Minimal TypeScript client for the CharacterForge AI HTTP API.

## Install dependencies

```bash
cd sdk/typescript
npm install
```

## Use the client

```ts
import { ActionDispatcher, CharacterForgeClient } from "@characterforge/characterforge-ai";

const client = new CharacterForgeClient({
  baseUrl: "https://<api-id>.execute-api.<region>.amazonaws.com/dev",
  apiKey: process.env.CHARACTERFORGE_API_KEY,
});

const character = await client.createCharacter({
  name: "Captain Mira Voss",
  description: "A rogue airship captain.",
  personality: ["sarcastic", "brave"],
  backstory: "Former royal navy officer turned smuggler.",
  speaking_style: "Dry wit and nautical metaphors.",
  goals: ["protect her crew"],
  world_context: "A floating archipelago.",
  rules: ["Never break character."],
  allowed_actions: ["give_quest"],
});

const reply = await client.chat(String(character.character_id), {
  session_id: "session-demo-1",
  player_id: "player-demo-1",
  message: "Need any help?",
});
```

## Dispatch returned actions

```ts
const dispatcher = new ActionDispatcher({
  give_quest: async (payload) => {
    console.log("Start quest", payload);
  },
});

await dispatcher.dispatch(reply.actions);
```

Unhandled actions are returned from `dispatch(...)` so a game client can log or ignore action types it has not wired yet.

## Client methods

- `createCharacter(payload)` / `create(payload)`
- `listCharacters()` / `list()`
- `getCharacter(characterId)` / `get(characterId)`
- `updateCharacter(characterId, payload)` / `update(characterId, payload)`
- `deleteCharacter(characterId)` / `delete(characterId)`
- `chat(characterId, payload)`
- `getSession(sessionId, { limit })` / `session(sessionId, { limit })`
- `clearSession(sessionId)`
- `getSessionHistory(sessionId, { limit })`
- `clearSessionHistory(sessionId)`

## Verify locally

```bash
npm run typecheck
npm run build
npm test
```
