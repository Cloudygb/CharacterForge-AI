# CharacterForgeAI Desktop Quickstart

This guide covers the end-user desktop flow shown in the current app screenshots.

## 1. Open the app

Launch **CharacterForgeAI** from the Windows Start Menu or Desktop shortcut. The **Welcome** page shows whether the app is connected, whether deployment settings are present, and what to do next.

If this is your first run, use **Start Guided Setup** for safety notes about AWS costs, credentials, deployment, characters, and chat.

## 2. Set up Deployment

Open **Deployment** to connect a backend or prepare a new one.

- **API Base URL** comes from your stack outputs after Start succeeds, or from AWS CloudFormation/API Gateway if you deployed outside the app.
- **API Key** comes from the stack output or API Gateway usage-plan key value.
- Keep API keys local. The app treats them as secrets and normal status panels/logs should not show raw key values.

Before using **Start**, run readiness checks and confirm the setup/cost warning. In local preview, Start and End are disabled; they are available in the packaged desktop app.

Before using **End**, export or save any characters you want to keep, then confirm the target stack and region.

## 3. Manage Characters

Open **Characters** to create, edit, import/export, or delete character profiles.

- Starter characters are local examples for learning the workflow.
- Use **Open Character Folder** to review files in the default local CharacterForgeAI folder.
- Connected characters can be synced with your deployed service after the API connection is tested.
- Delete actions require confirmation before removing local or connected character data.

## 4. Test Chat

Open **Chat** after Deployment is connected and characters are synced. Chat uses the connected CharacterForge service and the selected character.

If the app is not connected yet, Chat shows a setup prompt with an **Open Deployment** button instead of pretending a live chat is available.

## 5. Check Settings

Open **Settings** for app-level preferences such as update checks. Deployment setup, API connection, AWS readiness, and Start/End controls stay on the Deployment page so setup remains in one place.

## Credential safety

Do not paste real API keys, AWS access keys, secret keys, session tokens, passwords, or private endpoints into screenshots, commits, issue reports, or shared logs. Use placeholders such as:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
<redacted-api-key>
```
