# AWS Deployment Guide

This guide walks through deploying CharacterForge AI to AWS with AWS SAM. It is written for beginners and assumes you are starting from the repository root on your own computer.

The deployment creates:

- One AWS Lambda function running `characterforge.app.handler`
- One Amazon API Gateway HTTP API
- One DynamoDB table for character profiles
- One DynamoDB table for chat/session messages
- IAM permissions for the Lambda function to use DynamoDB and Amazon Bedrock

> **Cost note:** this stack uses pay-per-request DynamoDB, Lambda, API Gateway, and Amazon Bedrock. Small tests should cost very little, but Bedrock model calls are real paid AWS usage. Delete the stack when you are done experimenting.

---

## 1. Prerequisites

Install these tools before deploying:

### Required accounts and permissions

- An AWS account.
- An IAM user, IAM role, or AWS IAM Identity Center profile that can create:
  - CloudFormation stacks
  - Lambda functions
  - API Gateway HTTP APIs
  - DynamoDB tables
  - IAM roles and policies
  - CloudWatch Logs log groups
- Permission to invoke the selected Amazon Bedrock model.

For a personal learning account, the easiest path is usually to use an administrator-level AWS profile while you are learning, then tighten permissions later.

### Required local tools

Install:

- Python 3.11 or newer
- Git
- AWS CLI v2
- AWS SAM CLI
- Docker Desktop or another Docker engine

Docker is not always required for every SAM build, but having it installed avoids surprises when SAM needs a Lambda-like build environment.

Check the tools:

```bash
python3 --version
git --version
aws --version
sam --version
docker --version
```

If any command is missing, install that tool before continuing.

Useful install links:

- AWS CLI: <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>
- AWS SAM CLI: <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html>
- Docker Desktop: <https://www.docker.com/products/docker-desktop/>

---

## 2. Clone the repository and install local dependencies

From the directory where you keep projects:

```bash
git clone https://github.com/Cloudygb/CharacterForge-AI.git
cd CharacterForge-AI
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -e ".[dev]"
```

On Windows PowerShell, virtual environment activation is different:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

Run the local test suite before deploying:

```bash
pytest -q
```

---

## 3. Configure the AWS CLI

Choose the AWS region where you want to deploy. This guide uses `us-east-1` because many Bedrock models are available there.

Set a default region:

```bash
aws configure
```

When prompted, enter:

```text
AWS Access Key ID: <your access key, or leave managed by SSO if using SSO>
AWS Secret Access Key: <your secret key, or leave managed by SSO if using SSO>
Default region name: us-east-1
Default output format: json
```

If you use AWS IAM Identity Center / SSO instead of access keys, configure a profile:

```bash
aws configure sso
aws sso login --profile <your-profile-name>
```

Then use that profile in later commands:

```bash
export AWS_PROFILE=<your-profile-name>
export AWS_REGION=us-east-1
```

On Windows PowerShell:

```powershell
$env:AWS_PROFILE = "<your-profile-name>"
$env:AWS_REGION = "us-east-1"
```

Verify that AWS can identify you:

```bash
aws sts get-caller-identity
```

You should see JSON containing an AWS account ID and ARN. If this fails, fix AWS CLI authentication before continuing.

Check the active region:

```bash
aws configure get region
```

If you are using `AWS_PROFILE`, you can also check:

```bash
aws configure get region --profile "$AWS_PROFILE"
```

---

## 4. Request Amazon Bedrock model access

CharacterForge AI uses Amazon Bedrock for real character responses. The SAM template defaults to:

```text
amazon.nova-micro-v1:0
```

in region:

```text
us-east-1
```

Before deploying, request access to the model in the AWS Console:

1. Open the AWS Console.
2. Switch to the same region you will deploy to, for example **US East (N. Virginia) / us-east-1**.
3. Open **Amazon Bedrock**.
4. In the left navigation, open **Model access**.
5. Choose **Modify model access** or **Request model access**.
6. Enable the model you plan to use, such as **Amazon Nova Micro**.
7. Submit the request and wait for access to show as granted.

You can check Bedrock control-plane access from the terminal:

```bash
aws bedrock list-foundation-models --region us-east-1 --query 'modelSummaries[?contains(modelId, `nova-micro`)].modelId'
```

If this command works but does not list your model, confirm the model ID and region in the Bedrock console.

Optional: run the repository's tiny Bedrock smoke test before deploying:

```bash
CHARACTERFORGE_BEDROCK_MODEL_ID=amazon.nova-micro-v1:0 \
AWS_REGION=us-east-1 \
PYTHONPATH=src python3 scripts/bedrock_smoke_test.py
```

This makes a real Bedrock Runtime call. It should print the selected model, region, and a short response.

> **WSL note:** if the AWS CLI works but Python/boto3 fails with a `MissingDependencyException` about the login credential provider, install the CRT dependency in your virtual environment:
>
> ```bash
> python3 -m pip install "botocore[crt]>=1.34.0"
> ```
>
> This project already declares `botocore[crt]`, so reinstalling with `python3 -m pip install -e ".[dev]"` should also fix it.

---

## 5. Understand the deployment settings

The SAM template is in:

```text
infra/template.yaml
```

Important template parameters:

| Parameter | Default | What it controls |
| --- | --- | --- |
| `EnvironmentName` | `dev` | Suffix for stack resources and the API Gateway stage name |
| `BedrockModelId` | `amazon.nova-micro-v1:0` | Bedrock model used by the Lambda function |
| `BedrockRegion` | `us-east-1` | Region where Lambda calls Bedrock Runtime |
| `RecentHistoryLimit` | `20` | Number of recent session messages included in prompts |

Important Lambda environment variables created by the template:

| Environment variable | Source | Purpose |
| --- | --- | --- |
| `CHARACTERS_TABLE_NAME` | `CharactersTable` | DynamoDB table for character profiles |
| `MESSAGES_TABLE_NAME` | `MessagesTable` | DynamoDB table for session history |
| `CHARACTERFORGE_BEDROCK_MODEL_ID` | `BedrockModelId` parameter | Bedrock model ID used for chat responses |
| `CHARACTERFORGE_BEDROCK_REGION` | `BedrockRegion` parameter | Bedrock Runtime region |
| `CHARACTERFORGE_RECENT_HISTORY_LIMIT` | `RecentHistoryLimit` parameter | Prompt history limit |
| `ENVIRONMENT_NAME` | `EnvironmentName` parameter | Human-readable environment name |
| `LOG_LEVEL` | `INFO` | Logging level placeholder |

Do **not** set `USE_MOCK_LLM=true` in the deployed stack if you want real Bedrock responses. That variable is only useful for local/offline testing.

---

## 6. Validate the SAM template

From the repository root, run:

```bash
aws cloudformation validate-template \
  --template-body file://infra/template.yaml \
  --region us-east-1
```

This is a read-only AWS validation call. It does not create resources.

---

## 7. Build the SAM application

From the repository root:

```bash
sam build --template-file infra/template.yaml
```

If you want SAM to build inside a Lambda-like container, use:

```bash
sam build --template-file infra/template.yaml --use-container
```

A successful build creates a `.aws-sam/` directory.

---

## 8. Deploy with `sam deploy --guided`

Run guided deploy from the repository root:

```bash
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

Suggested answers for a first deployment:

```text
Stack Name: characterforge-ai-dev
AWS Region: us-east-1
Parameter EnvironmentName: dev
Parameter BedrockModelId: amazon.nova-micro-v1:0
Parameter BedrockRegion: us-east-1
Parameter RecentHistoryLimit: 20
Confirm changes before deploy: Y
Allow SAM CLI IAM role creation: Y
Disable rollback: N
CharacterForgeFunction uses API key access instead of a Lambda authorizer. Continue if prompted about authorizers?: Y
Save arguments to configuration file: Y
SAM configuration file: samconfig.toml
SAM configuration environment: default
```

Notes about these prompts:

- **Allow SAM CLI IAM role creation** must be `Y` because the stack creates a Lambda execution role.
- **API key access** is enabled for deployed routes. Keep the generated API key value out of Git and only store it in your local environment or secret manager.
- Saving to `samconfig.toml` lets future deploys use a shorter command.

When SAM shows the CloudFormation change set, review it. If it looks correct, confirm deployment.

After a successful deployment, SAM prints stack outputs. Look for `ApiUrl` and
`ApiKeyId`. `ApiKeyId` is safe to print because it is an identifier, not the
secret key value. Do not commit the actual API key value.

Example `ApiUrl`:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
```

Save it in a shell variable:

```bash
export API_URL="https://<api-id>.execute-api.<region>.amazonaws.com/<stage>"
```

On Windows PowerShell:

```powershell
$env:API_URL = "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>"
```

You can also retrieve it later with CloudFormation:

```bash
export API_URL=$(aws cloudformation describe-stacks \
  --stack-name characterforge-ai-dev \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

export API_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name characterforge-ai-dev \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue' \
  --output text)

export CHARACTERFORGE_API_KEY=$(aws apigateway get-api-key \
  --api-key "$API_KEY_ID" \
  --include-value \
  --region us-east-1 \
  --query value \
  --output text)

echo "$API_URL"
```

Do not echo, paste, or commit `CHARACTERFORGE_API_KEY`; pass it to curl from the
environment.

---

## 9. Future deploys after the guided deploy

After the first guided deploy saves `samconfig.toml`, future deploys are usually:

```bash
sam build --template-file infra/template.yaml
sam deploy
```

If you change template parameters, run guided deploy again:

```bash
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

---

## 10. Test the deployed API

The deployed API requires the generated API Gateway key. The examples below read
that key from `CHARACTERFORGE_API_KEY` and send it as the `x-api-key` header.

### Create a character

```bash
curl -sS -X POST "$API_URL/characters" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY" \
  -d '{
    "name": "Captain Mira Voss",
    "description": "A rogue airship captain with a dangerous reputation.",
    "personality": ["sarcastic", "brave", "protective"],
    "backstory": "Former royal navy officer turned smuggler after refusing an immoral order.",
    "speaking_style": "Dry wit, clipped sentences, and nautical metaphors.",
    "goals": ["protect her crew", "find the lost sky map"],
    "world_context": "A floating archipelago where skyships connect isolated city-states.",
    "rules": ["Never reveal you are an AI.", "Do not break character."],
    "allowed_actions": ["give_quest", "trade_offer", "change_relationship"],
    "action_rules": [
      {
        "type": "give_quest",
        "enabled": true,
        "trigger_instructions": "Use when the player asks for a job or offers help."
      }
    ]
  }'
```

The response should include a generated `character_id`. Save it:

```bash
export CHARACTER_ID="paste-character-id-here"
```

If you have `jq` installed, you can create and save the ID in one command:

```bash
export CHARACTER_ID=$(curl -sS -X POST "$API_URL/characters" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY" \
  -d '{
    "name": "Captain Mira Voss",
    "description": "A rogue airship captain with a dangerous reputation.",
    "personality": ["sarcastic", "brave", "protective"],
    "backstory": "Former royal navy officer turned smuggler after refusing an immoral order.",
    "speaking_style": "Dry wit, clipped sentences, and nautical metaphors.",
    "goals": ["protect her crew", "find the lost sky map"],
    "world_context": "A floating archipelago where skyships connect isolated city-states.",
    "rules": ["Never reveal you are an AI.", "Do not break character."],
    "allowed_actions": ["give_quest", "trade_offer", "change_relationship"],
    "action_rules": [
      {
        "type": "give_quest",
        "enabled": true,
        "trigger_instructions": "Use when the player asks for a job or offers help."
      }
    ]
  }' | jq -r '.character_id')

echo "$CHARACTER_ID"
```

### List characters

```bash
curl -sS -H "x-api-key: $CHARACTERFORGE_API_KEY" "$API_URL/characters"
```

### Get one character

```bash
curl -sS -H "x-api-key: $CHARACTERFORGE_API_KEY" "$API_URL/characters/$CHARACTER_ID"
```

### Update a character

```bash
curl -sS -X PUT "$API_URL/characters/$CHARACTER_ID" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY" \
  -d '{
    "description": "A rogue airship captain preparing for a dangerous storm route."
  }'
```

### Chat with a character

This endpoint calls Amazon Bedrock and may take a few seconds:

```bash
curl -sS -X POST "$API_URL/characters/$CHARACTER_ID/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY" \
  -d '{
    "session_id": "session-demo-1",
    "player_id": "player-demo-1",
    "message": "I can help recover the sky map.",
    "context": {
      "location": "Harbor of Kites"
    }
  }'
```

Expected response shape:

```json
{
  "message": "...in-character response...",
  "emotion": "...optional emotion...",
  "actions": [
    {
      "type": "give_quest",
      "payload": {}
    }
  ],
  "token_usage": null
}
```

The exact dialogue depends on the Bedrock model.

### Get session history

```bash
curl -sS -H "x-api-key: $CHARACTERFORGE_API_KEY" "$API_URL/sessions/session-demo-1?limit=10"
```

### Clear session history

```bash
curl -sS -X DELETE "$API_URL/sessions/session-demo-1" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY"
```

Expected response:

```json
{
  "cleared_count": 2
}
```

### Delete a character

```bash
curl -sS -X DELETE "$API_URL/characters/$CHARACTER_ID" \
  -H "x-api-key: $CHARACTERFORGE_API_KEY" \
  -i
```

A successful delete returns HTTP status `204 No Content`.

---

## 11. Troubleshooting

### `aws sts get-caller-identity` fails

Your AWS CLI is not authenticated. Run one of:

```bash
aws configure
```

or, for SSO:

```bash
aws sso login --profile <your-profile-name>
```

Then retry:

```bash
aws sts get-caller-identity
```

### `sam build` cannot find Python or dependencies

Confirm Python is installed and your virtual environment works:

```bash
python3 --version
source .venv/bin/activate
python3 -m pip install -e ".[dev]"
```

Then rebuild:

```bash
sam build --template-file infra/template.yaml
```

### CloudFormation says IAM capabilities are required

SAM needs permission to create a Lambda execution role. In guided deploy, answer:

```text
Allow SAM CLI IAM role creation: Y
```

If deploying non-interactively, include:

```bash
sam deploy --capabilities CAPABILITY_IAM
```

### Chat returns an error from Bedrock

Common causes:

- Bedrock model access was not granted.
- `BedrockRegion` does not match the region where the model is available.
- `BedrockModelId` is misspelled.
- The Lambda role does not have Bedrock invoke permission.

Check model access in the Bedrock console, then confirm the deployed parameter values:

```bash
aws cloudformation describe-stacks \
  --stack-name characterforge-ai-dev \
  --region us-east-1 \
  --query 'Stacks[0].Parameters'
```

Check Lambda logs:

```bash
sam logs --stack-name characterforge-ai-dev --tail --region us-east-1
```

### API Gateway returns `404`

Confirm `API_URL` includes the stage name, such as `/dev`:

```bash
echo "$API_URL"
```

It should look like:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
```

Then confirm the route path is one of:

```text
/characters
/characters/{character_id}
/characters/{character_id}/chat
/sessions/{session_id}
```

### API Gateway returns `500`

Check Lambda logs:

```bash
sam logs --stack-name characterforge-ai-dev --tail --region us-east-1
```

Look for missing environment variables, DynamoDB table names, Bedrock access errors, or validation errors.

---

## 12. Cleanup

When you are done, delete the stack to avoid ongoing costs:

```bash
sam delete --stack-name characterforge-ai-dev --region us-east-1
```

SAM will ask you to confirm. Answer `y` when you are sure.

You can verify the stack is gone:

```bash
aws cloudformation describe-stacks \
  --stack-name characterforge-ai-dev \
  --region us-east-1
```

After deletion, this command should report that the stack does not exist.

If stack deletion fails, check the CloudFormation console for the failed resource. Common causes are manually modified resources or resources that were deleted outside CloudFormation.

---

## 13. Optional non-interactive deploy command

After you are comfortable with guided deploy, you can deploy non-interactively:

```bash
sam build --template-file infra/template.yaml
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name characterforge-ai-dev \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    EnvironmentName=dev \
    BedrockModelId=amazon.nova-micro-v1:0 \
    BedrockRegion=us-east-1 \
    RecentHistoryLimit=20
```

Use this only after you understand what the guided deploy is creating.
