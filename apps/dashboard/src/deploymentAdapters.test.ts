import { describe, expect, it } from "vitest";

import {
  createBrowserDryRunDeploymentAdapter,
  createRealDeploymentStartAdapter,
  createRealDeploymentEndAdapter,
  type DeploymentShellAdapter,
  type DeploymentStartRequest
} from "./deploymentAdapters";

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

  it("requires explicit confirmation before real deployment Start can execute", async () => {
    const shell = createMockDeploymentShell();
    const adapter = createRealDeploymentStartAdapter(shell);

    await expect(adapter.start(baseRequest, { confirmationText: "deploy" })).rejects.toThrow(/type START characterforge-ai-dev/i);

    expect(shell.commands).toEqual([]);
    expect(shell.savedOutputs).toEqual([]);
  });

  it("validates AWS CLI and SAM CLI before real deployment Start commands run", async () => {
    const shell = createMockDeploymentShell({ dependencyFailures: { sam: "SAM CLI missing" } });
    const adapter = createRealDeploymentStartAdapter(shell);

    const result = await adapter.start(baseRequest, { confirmationText: "START characterforge-ai-dev" });

    expect(result.status).toBe("failed");
    expect(result.finalStackStatus).toBe("DEPENDENCY_VALIDATION_FAILED");
    expect(result.logs.join("\n")).toContain("Validating local deployment dependencies before Start");
    expect(result.logs.join("\n")).toContain("SAM CLI missing");
    expect(shell.commands.map((command) => `${command.program} ${command.args.join(" ")}`)).toEqual(["aws --version", "sam --version"]);
    expect(shell.savedOutputs).toEqual([]);
  });

  it("runs the real Start command sequence with mocked commands, polls stack status, redacts logs, and saves non-secret outputs", async () => {
    const shell = createMockDeploymentShell({
      statuses: ["CREATE_IN_PROGRESS", "CREATE_COMPLETE"],
      outputs: [
        { OutputKey: "ApiUrl", OutputValue: "https://mock.execute-api.us-east-1.amazonaws.com/dev" },
        { OutputKey: "ApiKeyId", OutputValue: "abc123" },
        { OutputKey: "ApiKeyValue", OutputValue: "do-not-save-this-secret" },
        { OutputKey: "FunctionName", OutputValue: "characterforge-dev-handler" }
      ]
    });
    const adapter = createRealDeploymentStartAdapter(shell);

    const result = await adapter.start(
      {
        ...baseRequest,
        credentialMode: "temporary",
        temporaryCredentials: {
          accessKeyId: "TEMPACCESSKEY123456",
          secretAccessKey: "real-secret-value",
          sessionToken: "real-session-token"
        }
      },
      { confirmationText: "START characterforge-ai-dev" }
    );

    expect(result.status).toBe("succeeded");
    expect(result.finalStackStatus).toBe("CREATE_COMPLETE");
    expect(shell.commands.map((command) => command.program)).toEqual(["aws", "sam", "aws", "sam", "sam", "aws", "aws", "aws"]);
    expect(shell.commands[4].args).toContain("deploy");
    expect(shell.commands[4].env).toMatchObject({
      AWS_ACCESS_KEY_ID: "TEMPACCESSKEY123456",
      AWS_SECRET_ACCESS_KEY: "real-secret-value",
      AWS_SESSION_TOKEN: "real-session-token"
    });
    expect(result.logs.join("\n")).toContain("AWS_SECRET_ACCESS_KEY=<redacted>");
    expect(result.logs.join("\n")).not.toContain("real-secret-value");
    expect(result.logs.join("\n")).not.toContain("real-session-token");
    expect(result.savedOutputsPath).toMatch(/characterforge-ai-dev.*outputs\.json$/);
    expect(shell.savedOutputs).toEqual([
      {
        stackName: "characterforge-ai-dev",
        region: "us-east-1",
        outputs: {
          ApiUrl: "https://mock.execute-api.us-east-1.amazonaws.com/dev",
          ApiKeyId: "abc123",
          FunctionName: "characterforge-dev-handler"
        }
      }
    ]);
  });

  it("reports rollback stack statuses from mocked polling without saving outputs", async () => {
    const shell = createMockDeploymentShell({ statuses: ["CREATE_IN_PROGRESS", "ROLLBACK_COMPLETE"] });
    const adapter = createRealDeploymentStartAdapter(shell);

    const result = await adapter.start(baseRequest, { confirmationText: "START characterforge-ai-dev" });

    expect(result.status).toBe("failed");
    expect(result.finalStackStatus).toBe("ROLLBACK_COMPLETE");
    expect(result.logs.join("\n")).toContain("CloudFormation reported ROLLBACK_COMPLETE");
    expect(shell.savedOutputs).toEqual([]);
  });

  it("cancels deployment End before commands run when export prompt is declined", async () => {
    const shell = createMockDeploymentShell();
    const adapter = createRealDeploymentEndAdapter(shell);

    const result = await adapter.end(baseRequest, {
      confirmationText: "END characterforge-ai-dev",
      exportConfirmed: false,
      cancelled: true
    });

    expect(result.status).toBe("cancelled");
    expect(result.finalStackStatus).toBe("CANCELLED_BEFORE_DELETE");
    expect(result.logs.join("\n")).toContain("Export character packs before deleting the deployment stack");
    expect(shell.commands).toEqual([]);
  });

  it("deletes the stack through mocked commands, polls DELETE_COMPLETE, and redacts End logs", async () => {
    const shell = createMockDeploymentShell({ statuses: ["DELETE_IN_PROGRESS", "DELETE_COMPLETE"] });
    const adapter = createRealDeploymentEndAdapter(shell);

    const result = await adapter.end(
      {
        ...baseRequest,
        credentialMode: "temporary",
        temporaryCredentials: {
          accessKeyId: "TEMPACCESSKEY123456",
          secretAccessKey: "real-secret-value",
          sessionToken: "real-session-token"
        }
      },
      { confirmationText: "END characterforge-ai-dev", exportConfirmed: true }
    );

    expect(result.status).toBe("succeeded");
    expect(result.finalStackStatus).toBe("DELETE_COMPLETE");
    expect(shell.commands.map((command) => command.program)).toEqual(["aws", "aws", "aws"]);
    expect(shell.commands[0].args).toEqual([
      "cloudformation",
      "delete-stack",
      "--stack-name",
      "characterforge-ai-dev",
      "--region",
      "us-east-1"
    ]);
    expect(result.logs.join("\n")).toContain("AWS_SECRET_ACCESS_KEY=<redacted>");
    expect(result.logs.join("\n")).not.toContain("real-secret-value");
    expect(result.logs.join("\n")).not.toContain("real-session-token");
    expect(shell.savedOutputs).toEqual([]);
  });

  it("reports deployment End failure statuses, retained resources, and keeps local config", async () => {
    const shell = createMockDeploymentShell({
      statuses: ["DELETE_IN_PROGRESS", "DELETE_FAILED"],
      retainedResources: [
        {
          LogicalResourceId: "CharacterMessagesTable",
          ResourceType: "AWS::DynamoDB::Table",
          ResourceStatus: "DELETE_FAILED",
          ResourceStatusReason: "Table deletion protection is enabled; token real-session-token"
        }
      ]
    });
    const adapter = createRealDeploymentEndAdapter(shell);

    const result = await adapter.end(baseRequest, { confirmationText: "END characterforge-ai-dev", exportConfirmed: true });

    expect(result.status).toBe("failed");
    expect(result.finalStackStatus).toBe("DELETE_FAILED");
    expect(result.logs.join("\n")).toContain("CloudFormation reported DELETE_FAILED");
    expect(result.logs.join("\n")).toContain("Retained resources requiring manual cleanup");
    expect(result.logs.join("\n")).toContain("CharacterMessagesTable (AWS::DynamoDB::Table) - DELETE_FAILED");
    expect(result.logs.join("\n")).not.toContain("real-session-token");
    expect(shell.savedOutputs).toEqual([]);
    expect(shell.clearedDeploymentConfigs).toEqual([]);
  });

  it("clears local deployment config only after delete succeeds", async () => {
    const shell = createMockDeploymentShell({ statuses: ["DELETE_IN_PROGRESS", "DELETE_COMPLETE"] });
    const adapter = createRealDeploymentEndAdapter(shell);

    const result = await adapter.end(baseRequest, { confirmationText: "END characterforge-ai-dev", exportConfirmed: true });

    expect(result.status).toBe("succeeded");
    expect(result.finalStackStatus).toBe("DELETE_COMPLETE");
    expect(result.logs.join("\n")).toContain("Cleared local deployment config");
    expect(shell.clearedDeploymentConfigs).toEqual([{ stackName: "characterforge-ai-dev", region: "us-east-1" }]);
  });
});

type MockShellOptions = {
  statuses?: string[];
  outputs?: Array<{ OutputKey: string; OutputValue: string }>;
  dependencyFailures?: Partial<Record<"aws" | "sam", string>>;
  retainedResources?: Array<{
    LogicalResourceId: string;
    ResourceType: string;
    ResourceStatus: string;
    ResourceStatusReason?: string;
  }>;
};

function createMockDeploymentShell(options: MockShellOptions = {}) {
  const statuses = [...(options.statuses ?? ["CREATE_COMPLETE"])] as string[];
  const outputs = options.outputs ?? [];
  const shell: DeploymentShellAdapter & {
    commands: Array<{ program: string; args: string[]; env?: Record<string, string> }>;
    savedOutputs: unknown[];
    clearedDeploymentConfigs: unknown[];
  } = {
    commands: [],
    savedOutputs: [],
    clearedDeploymentConfigs: [],
    async run(command) {
      shell.commands.push(command);
      if (command.program === "aws" && command.args.join(" ") === "--version") {
        const message = options.dependencyFailures?.aws;
        return message ? { exitCode: 127, stdout: "", stderr: message } : { exitCode: 0, stdout: "aws-cli/2.15.0", stderr: "" };
      }
      if (command.program === "sam" && command.args.join(" ") === "--version") {
        const message = options.dependencyFailures?.sam;
        return message ? { exitCode: 127, stdout: "", stderr: message } : { exitCode: 0, stdout: "SAM CLI, version 1.110.0", stderr: "" };
      }
      if (command.program === "aws" && command.args.includes("describe-stack-resources")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ StackResources: options.retainedResources ?? [] }),
          stderr: ""
        };
      }
      if (command.program === "aws" && command.args.includes("describe-stacks")) {
        const status = statuses.shift() ?? statuses.at(-1) ?? "CREATE_COMPLETE";
        return {
          exitCode: 0,
          stdout: JSON.stringify({ Stacks: [{ StackStatus: status, Outputs: status.endsWith("COMPLETE") ? outputs : [] }] }),
          stderr: ""
        };
      }
      return { exitCode: 0, stdout: `${command.program} ${command.args.join(" ")} ok`, stderr: "" };
    },
    async saveOutputs(record) {
      shell.savedOutputs.push(record);
      return `/tmp/${record.stackName}-outputs.json`;
    },
    async clearDeploymentConfig(record) {
      shell.clearedDeploymentConfigs.push(record);
      return `/tmp/${record.stackName}-outputs.json`;
    }
  };
  return shell;
}
