# Desktop Start/End Deployment Safety Guide

This document explains the local deployment engine behind the CharacterForgeAI desktop **Start** and **End** buttons for users who want to understand what cloud-changing actions are allowed to do.

The desktop app should remain a local orchestration layer around AWS SAM and CloudFormation. It must not become a credential vault, a hidden Terraform wrapper, or a background process that deploys or deletes cloud resources without explicit user intent.

---

## Goals

The Start/End engine should:

- Let a non-specialist user deploy or remove the CharacterForge AI AWS backend from the desktop app.
- Use the existing SAM/CloudFormation infrastructure path already present in this repository.
- Reuse local AWS CLI profiles instead of collecting raw access keys in the app.
- Show clear cost, credential, stack-status, rollback, and deletion warnings before cloud-changing actions.
- Poll AWS for stack state and translate raw CloudFormation statuses into understandable desktop states.
- Require an export/backup decision before destructive deletion.
- Keep tests offline by mocking shell commands and CloudFormation responses.

## Non-goals

The Start/End engine should not:

- Store AWS access keys, secret keys, session tokens, passwords, bearer tokens, or auth headers.
- Print raw credential values in app logs, Rust command output, frontend state, test fixtures, or release notes.
- Run Bedrock prompts as part of setup verification.
- Delete stacks automatically as a side effect of failed Start unless the user explicitly chooses a safe cleanup action.
- Require Terraform for the first desktop deployment release.

---

## Inputs collected by the dashboard

The dashboard should collect only deployment configuration, not secrets:

| Field | Purpose | Example |
| --- | --- | --- |
| AWS profile | Selects a local AWS CLI profile already configured on the user's machine. | `default`, `characterforge-dev`, `my-sso-profile` |
| AWS region | Selects where the stack is deployed. | `us-east-1` |
| Stack name | Gives the CloudFormation stack a deterministic name. | `characterforge-ai-dev` |
| Bedrock model ID | Passes the model choice into the SAM template. | `amazon.nova-micro-v1:0` |
| Confirmation flags | Records that the user accepted cost and deployment warnings. | checkbox state |

The app may help users discover profile names with:

```bash
aws configure list-profiles
```

It may read the selected profile's configured region with:

```bash
aws configure get region --profile <profile>
```

The app must not read or display raw values from AWS credentials files. If command output includes secret-looking strings for any reason, return `[redacted]` to the frontend.

---

## Credential handling model

CharacterForgeAI should use the AWS CLI's normal credential provider chain. The desktop app supplies a scoped environment to child processes instead of asking users for keys.

For a selected profile and region, the local command environment should include:

```text
AWS_PROFILE=<profile>
AWS_REGION=<region>
AWS_DEFAULT_REGION=<region>
```

If the user leaves the profile blank, the engine may omit `AWS_PROFILE` and allow the AWS CLI default provider chain to run. The UI should still say which mode is being used.

### Redaction requirements

Before returning shell output or errors to the frontend, redact values that look like:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`
- `aws_secret_access_key`
- `session_token`
- `password`
- `token=` query parameters or log fragments
- bearer authorization header values
- basic authorization header values

The frontend should show high-level messages and sanitized detail panes. The raw process environment should never be rendered.

---

## Packaged deployment resources

Packaged Windows builds cannot depend on a source checkout. The Start/End engine should resolve a packaged deployment root from Tauri resources and run commands from that root.

Expected packaged layout:

```text
deployment/
  infra/template.yaml
  src/characterforge/...
  src/requirements.txt
  pyproject.toml
  schemas/...
  LICENSE
```

The resource resolver should support:

- Development builds that resolve from the repository root.
- Packaged builds that resolve from the Tauri resource directory.
- A test override such as `CHARACTERFORGEAI_RESOURCE_DIR` for offline packaged-mode tests.

Before running Start or End, validate that required files exist. A missing resource should fail with a clear local error, for example:

```text
missing packaged deployment resource: deployment/infra/template.yaml
```

---

## Start button flow

The **Start** button creates or updates the CharacterForge AI AWS backend.

### 1. Preflight checks

Before any deploy command runs, the desktop app should verify:

- The user selected or accepted an AWS credential mode.
- The AWS CLI is installed.
- The SAM CLI is installed.
- The selected region is present.
- The stack name is valid for CloudFormation.
- The Bedrock model ID is non-empty.
- The packaged deployment resources are present.
- The user accepted the cost and cloud-resource warning.

Optional readiness checks may include:

```bash
aws sts get-caller-identity --profile <profile> --region <region>
aws bedrock list-foundation-models --profile <profile> --region <region>
aws cloudformation describe-stacks --stack-name <stack-name> --profile <profile> --region <region>
```

The Bedrock check should be a control-plane availability check only. It should not invoke a model or send prompt text.

### 2. Build locally with SAM

Run SAM build from the packaged deployment root:

```bash
sam build --template-file infra/template.yaml
```

The engine should stream sanitized progress such as:

```text
Building packaged backend...
```

instead of exposing noisy raw logs as the main UI state.

### 3. Deploy with SAM and CloudFormation

After a successful build, deploy the built template:

```bash
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name <stack-name> \
  --region <region> \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides BedrockModelId=<model-id>
```

When a profile is selected, pass it through the environment with `AWS_PROFILE=<profile>` rather than appending raw keys to the command line.

### 4. Poll stack status

The engine should poll CloudFormation during and after deployment:

```bash
aws cloudformation describe-stacks --stack-name <stack-name> --region <region>
```

The internal poller can read `Stacks[0].StackStatus` and `Stacks[0].StackStatusReason`, then translate those into product states:

| CloudFormation status | Desktop state | User-facing meaning |
| --- | --- | --- |
| `CREATE_IN_PROGRESS` | `deploying` | Creating cloud resources. |
| `UPDATE_IN_PROGRESS` | `deploying` | Updating existing cloud resources. |
| `CREATE_COMPLETE` | `ready` | Backend is deployed. |
| `UPDATE_COMPLETE` | `ready` | Backend is updated and ready. |
| `UPDATE_COMPLETE_CLEANUP_IN_PROGRESS` | `deploying` | AWS is cleaning up old resources after an update. |
| `REVIEW_IN_PROGRESS` | `starting` | Change set or stack review is being prepared. |
| `CREATE_FAILED` | `failed` | Creation failed; show sanitized reason and next steps. |
| `UPDATE_FAILED` | `failed` | Update failed; show sanitized reason and next steps. |
| `ROLLBACK_IN_PROGRESS` | `rollback` | AWS is undoing a failed create. |
| `ROLLBACK_COMPLETE` | `rollback` | Create failed and rollback finished; delete/recreate is usually required. |
| `UPDATE_ROLLBACK_IN_PROGRESS` | `rollback` | AWS is undoing a failed update. |
| `UPDATE_ROLLBACK_COMPLETE` | `rollback` | Existing stack was restored after a failed update. |
| `DELETE_IN_PROGRESS` | `ending` | Stack deletion is already underway. |
| `DELETE_FAILED` | `failed` | Deletion failed; show remediation guidance. |

Polling should use a bounded interval and clear timeout messaging. The UI should remain responsive and cancellable where possible, but canceling the desktop wait must not imply AWS canceled the CloudFormation operation.

---

## Rollback and failure handling

Rollback is not just a generic failure. It means CloudFormation attempted changes and then reverted some or all resources.

When the poller sees rollback states, the UI should:

1. Stop presenting the backend as ready.
2. Show the sanitized stack status reason.
3. Offer safe next actions:
   - view sanitized stack events,
   - retry Start after fixing the root cause,
   - delete/recreate when the stack is in `ROLLBACK_COMPLETE`,
   - leave the stack alone and open AWS Console guidance.
4. Avoid automatically deleting the stack.

A stack in `ROLLBACK_COMPLETE` usually cannot be updated directly. The recommended desktop path is to guide the user through **End** or a specific cleanup action, then Start again.

The app can retrieve sanitized events with:

```bash
aws cloudformation describe-stack-events --stack-name <stack-name> --region <region>
```

Events should be filtered/redacted before display.

---

## End button flow

The **End** button removes the deployed AWS backend. It is destructive and must require explicit confirmation.

### 1. Confirm export or backup choice

Before deletion, the dashboard should ask whether the user wants to export or back up data.

Recommended choices:

1. **Export first, then delete** — runs the export workflow and verifies completion before stack deletion.
2. **Delete without export** — allowed only after a clear warning and an explicit typed or checkbox confirmation.
3. **Cancel** — returns to the dashboard without cloud changes.

If export is not implemented yet, the safest design is to block the default delete path until the user explicitly chooses **delete without export**. The UI should not imply data was backed up when no export occurred.

### 2. Delete the CloudFormation stack

After confirmation, delete the stack with CloudFormation:

```bash
aws cloudformation delete-stack --stack-name <stack-name> --region <region>
```

Use the same selected profile, region, and stack name shown in the UI.

### 3. Poll until deletion is complete

Continue polling:

```bash
aws cloudformation describe-stacks --stack-name <stack-name> --region <region>
```

Deletion is complete when either:

- the stack status reaches `DELETE_COMPLETE`, or
- `describe-stacks` returns the expected stack-not-found error after deletion.

If the status becomes `DELETE_FAILED`, do not claim cleanup succeeded. Show the sanitized failure reason and suggest checking retained resources, IAM permissions, non-empty buckets if they are added later, or AWS Console stack events.

---

## Command execution boundaries

The Rust/Tauri backend should own command execution. The React frontend should invoke narrow commands such as:

- `preview_deployment_start`
- `start_deployment`
- `preview_deployment_end`
- `end_deployment`
- `get_deployment_status`

The frontend should not assemble arbitrary shell strings.

The command runner should:

- use argument arrays instead of shell-interpolated strings,
- set `current_dir` to the resolved deployment root,
- pass profile and region through scoped environment variables,
- redact stdout/stderr before returning it,
- expose structured status objects to the frontend,
- include stable internal error codes for tests and troubleshooting.

---

## User experience states

Suggested desktop states:

| State | Meaning | Primary action |
| --- | --- | --- |
| `not_configured` | Required profile/region/model fields are missing. | Complete setup. |
| `checking` | Local tools, profile, region, model, or stack status are being checked. | Wait. |
| `ready_to_start` | Preflight passed and no active stack is ready. | Start. |
| `starting` | Start was accepted and commands are being prepared. | Watch progress. |
| `building` | `sam build` is running. | Watch progress. |
| `deploying` | CloudFormation create/update is in progress. | Watch progress. |
| `ready` | Stack is deployed. | Use backend or End. |
| `rollback` | CloudFormation rollback is active or complete. | View reason, retry, or cleanup. |
| `ending` | Stack deletion is in progress. | Watch progress. |
| `deleted` | Stack was removed or is no longer found. | Start again if needed. |
| `failed` | A command or stack operation failed. | Review sanitized details and next safe action. |

---

## Testing strategy

Tests should not call real AWS, SAM, CloudFormation, Bedrock, Docker, or deployment endpoints.

Recommended test coverage:

- Start preflight blocks missing profile/region/stack/model confirmation.
- Start builds before deploy.
- Start passes profile and region through environment variables.
- Start uses `sam build` and `sam deploy` with expected argument arrays.
- Poller maps success statuses to `ready`.
- Poller maps rollback statuses to `rollback` with a sanitized reason.
- End prompts for export/backup choice before deletion.
- End blocks deletion when export is requested but export fails or is unavailable.
- End treats stack-not-found after delete as successful cleanup.
- End surfaces `DELETE_FAILED` as a failure, not success.
- Redaction removes credential-looking values from stdout, stderr, stack reasons, and event messages.
- Packaged-resource tests prove the deployment root can be resolved without the source checkout.

Fixture outputs should use placeholders, not real account IDs, access keys, API keys, endpoint IDs, or tokens.

---

## Why Terraform is optional later

Terraform can be useful later, but it is not required for the current desktop Start/End engine.

SAM/CloudFormation is the right first backend because:

- The repository already has a SAM template for Lambda, API Gateway, DynamoDB, IAM, Bedrock permissions, logs, and dashboard resources.
- SAM directly understands Lambda packaging and `sam build` output.
- CloudFormation is the deployment engine SAM already uses, so stack status polling and rollback handling are available without another state system.
- The desktop app can ship one deployment path first and keep support/debugging focused.
- Adding Terraform now would introduce provider installation, state-location UX, backend configuration, lock handling, drift behavior, and migration questions before the local desktop flow is proven.

If Terraform is introduced later, it should be an advanced alternate deployment backend. The product would need explicit UX for where state lives, how users migrate from a SAM-created stack, how credentials are scoped, and how rollback/delete behavior differs from CloudFormation. Terraform should not be a prerequisite for the first Start/End desktop release.

---

## Security checklist

Before shipping this flow, verify that:

- No raw AWS credentials are accepted in the dashboard.
- No raw AWS credentials are persisted in app config.
- No raw AWS credentials appear in frontend state snapshots, logs, test fixtures, or release notes.
- All command output shown to users is redacted.
- Start requires an explicit cost/resource confirmation.
- End requires an explicit destructive-action confirmation.
- End asks for an export/backup decision before deletion.
- Tests mock all AWS/SAM/CloudFormation command execution.
- Packaged builds run from bundled resources rather than the developer's source checkout.
