# CharacterForgeAI Desktop Dashboard

React/Vite/TypeScript dashboard packaged by Tauri for the CharacterForgeAI desktop app.

The polished app is organized around five normal user screens:

- **Welcome** — status, quick orientation, and the first-run guided setup.
- **Deployment** — AWS profile/region/model setup, readiness checks, guarded Start/End controls, and API Base URL/API Key connection help.
- **Characters** — create/edit/delete characters, open the safe local character folder, import/export character packs, and configure custom actions.
- **Chat** — chat only with synced API characters and inspect returned structured actions when connected.
- **Settings** — simple update checking and app-level preferences.

Developer/raw diagnostic views are hidden behind the in-app advanced disclosure and are not part of the normal navigation.

## Deployment and API connection

Deployment owns both cloud setup and API connection details. The app can discover the API Base URL and non-secret stack outputs after it launches the stack, then helps users test the connection with an API key from their own deployment.

Use placeholders in examples and docs:

```text
CHARACTERFORGE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
CHARACTERFORGE_API_KEY=<your-api-key-value>
```

Do not paste production API keys into source files, browser bundles, committed config, screenshots, or frontend tests. The dashboard keeps the typed API key in component state for the current browser session and does not persist it to localStorage.

## Characters and local files

The Characters page is the single home for character authoring and local file workflows:

- Create and edit character profiles in dialogs; internal character IDs stay hidden from normal users.
- Add any number of designer-authored custom actions with trigger instructions and JSON object payload templates.
- Open the app-managed CharacterForgeAI character folder instead of asking users to browse arbitrary filesystem paths.
- Import/export character packs locally and sync with the API only when a connection has been tested successfully.
- Confirm destructive deletes before local/API records are removed.

## Chat

Chat does not show fake live conversations when disconnected. Users must connect to a deployed or local API and select a synced character before live requests are sent. Returned action payloads remain inspectable for game integration work.

## Desktop app

CharacterForgeAI runs as a local Tauri desktop app. Installing the app does not deploy AWS resources, run SAM, create CloudFormation stacks, or request Bedrock access. Cloud-changing actions happen only from explicit Deployment Start/End controls after the required warnings and confirmations.

Local desktop commands:

```bash
npm install
npm run desktop:dev
npm run desktop:build
```

The existing web commands are unchanged:

```bash
npm run dev
npm run build
```

### Windows installer

To produce a Windows installer for release, run the build from a Windows environment with Rust, Node.js, npm, and the Tauri Windows prerequisites installed:

```powershell
cd apps/dashboard
npm install
npm run desktop:build
```

Tauri writes Windows installer artifacts under:

```text
apps/dashboard/src-tauri/target/release/bundle/
```

The Tauri config enables the NSIS bundle target as the supported Windows release installer. The NSIS installer is staged as `characterforgeai-installer.exe`; staging it does not deploy AWS resources or create cloud infrastructure.

## Local commands

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

### Release artifact staging

After `npm run desktop:build` creates the NSIS installer, stage the public download name with:

```bash
npm run desktop:stage-installer
```

This copies the newest NSIS `.exe` to the repository root as:

```text
dist/characterforgeai-installer.exe
```

The installed desktop executable is configured as `CharacterForgeAI.exe`.
