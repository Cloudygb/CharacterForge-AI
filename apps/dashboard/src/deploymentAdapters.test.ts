import { describe, expect, it } from "vitest";

import { createBrowserDryRunDeploymentAdapter, type DeploymentStartRequest } from "./deploymentAdapters";

const baseRequest: DeploymentStartRequest = {
  awsRegion: "us-east-1",
  bedrockModel: "amazon.nova-micro-v1:0",
  stackName: "characterforge-ai-dev",
  environmentName: "dev",
  credentialMode: "profile",
  profileName: "default"
};

describe("deployment adapters", () => {
  it("builds a dry-run SAM deploy preview without requiring AWS", async () => {
    const adapter = createBrowserDryRunDeploymentAdapter();

    const preview = await adapter.previewStart(baseRequest);

    expect(preview.mode).toBe("dry-run");
    expect(preview.awsCallsMade).toBe(false);
    expect(preview.commands).toEqual([
      "aws cloudformation validate-template --template-body file://infra/template.yaml --profile default --region us-east-1",
      "sam build --template-file infra/template.yaml",
      "sam deploy --template-file .aws-sam/build/template.yaml --stack-name characterforge-ai-dev --region us-east-1 --profile default --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides EnvironmentName=dev BedrockModelId=amazon.nova-micro-v1:0 BedrockRegion=us-east-1 RecentHistoryLimit=20"
    ]);
    expect(preview.resources).toContain("AWS Lambda function for characterforge.app.handler");
    expect(preview.resources).toContain("API Gateway REST API with API key usage plan protection");
    expect(preview.resources).toContain("DynamoDB tables for character profiles and session messages");
  });

  it("redacts temporary credential values from command previews", async () => {
    const adapter = createBrowserDryRunDeploymentAdapter();

    const preview = await adapter.previewStart({
      ...baseRequest,
      credentialMode: "temporary",
      profileName: "",
      temporaryCredentials: {
        accessKeyId: "TEMPACCESSKEY123456",
        secretAccessKey: "real-secret-value",
        sessionToken: "real-session-token"
      }
    });

    const joinedCommands = preview.commands.join("\n");
    expect(joinedCommands).toContain("AWS_ACCESS_KEY_ID=<provided locally>");
    expect(joinedCommands).toContain("AWS_SECRET_ACCESS_KEY=<redacted>");
    expect(joinedCommands).toContain("AWS_SESSION_TOKEN=<redacted>");
    expect(joinedCommands).not.toContain("TEMPACCESSKEY123456");
    expect(joinedCommands).not.toContain("real-secret-value");
    expect(joinedCommands).not.toContain("real-session-token");
  });
});
