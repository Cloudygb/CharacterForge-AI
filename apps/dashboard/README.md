# CharacterForge Dashboard

React/Vite/TypeScript dashboard for CharacterForge AI.

The dashboard starts in mock mode when no API base URL is set. When a local base URL and API key are entered in the API Settings screen, the app uses the CharacterForge TypeScript SDK client to test the connection and list characters from the API.

## Screens

- Welcome
- API Settings
- Characters
- Character Editor
- Chat Test
- Raw JSON Preview

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
