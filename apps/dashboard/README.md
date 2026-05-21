# CharacterForge Dashboard

React/Vite/TypeScript dashboard mockup for CharacterForge AI.

This step uses mock data only. It does not call the deployed API, does not require AWS credentials, and does not store a real API key.

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
npm run build
```

Use placeholder API settings only in this app until a server-side integration is added:

```text
CHARACTERFORGE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
CHARACTERFORGE_API_KEY=<your-api-key-value>
```

Do not paste production API keys into source files, browser bundles, committed config, screenshots, or frontend tests.
