# CharacterForge AI Web Playground

This is a tiny static browser playground for the CharacterForge AI backend. It is intentionally dependency-free: no npm install, no build step, and no framework.

The playground lets you:

1. Paste an API URL.
2. Choose one of the sample characters.
3. Create that character with `POST /characters` or select it locally in mock mode.
4. Send a chat message with `POST /characters/{character_id}/chat`.
5. View the response message, emotion, relationship delta, raw JSON, and structured actions.

## Run it locally

From the repository root:

```bash
python3 -m http.server 8080 --directory examples/web-playground
```

Then open:

```text
http://127.0.0.1:8080
```

You can also open `index.html` directly in a browser, but a local static server is closer to how it would be hosted.

## Use mock mode

Leave the **API URL** field blank and click **Select Without API** or **Send Chat Message**. The playground will render a local mock response. This is useful for portfolio review because it does not require AWS credentials, a deployed stack, DynamoDB, or Amazon Bedrock.

## Use the local SAM API

Start the backend with mock Lambda dependencies:

```bash
sam local start-api \
  --template infra/template.yaml \
  --env-vars examples/curl/local-env.json
```

Then paste this API URL into the playground:

```text
http://127.0.0.1:3000
```

The local SAM environment file sets `USE_MOCK_LLM=true`, so the API uses in-memory stores and a deterministic mock LLM instead of real AWS services.

## Use a deployed API

After deploying with SAM, copy the `ApiUrl` output and paste it into the playground as the API URL. It should look like:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/dev
```

If you are using shell scripts, this is the same value you would normally place in `API_BASE_URL`:

```bash
export API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
```

A deployed API can call Amazon Bedrock and write session history to DynamoDB, depending on your stack configuration.

## Notes

- This playground is a portfolio/demo aid, not a production frontend.
- It does not handle authentication because the MVP API does not include auth yet.
- Browser calls to a deployed API require API Gateway CORS to allow the playground origin.
- No credentials or real API Gateway hosts are embedded in these files.
