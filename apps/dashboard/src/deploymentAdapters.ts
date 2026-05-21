export type DeploymentCredentialMode = "profile" | "temporary";

export type TemporaryDeploymentCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export type DeploymentStartRequest = {
  awsRegion: string;
  bedrockModel: string;
  stackName: string;
  environmentName: string;
  credentialMode: DeploymentCredentialMode;
  profileName: string;
  temporaryCredentials?: TemporaryDeploymentCredentials;
};

export type SetupReadinessRequest = {
  awsRegion: string;
  bedrockModel: string;
  profileName: string;
  stackName: string;
};

export type SetupReadinessCheckStatus = "ready" | "warning" | "error";

export type SetupReadinessCheck = {
  id: string;
  label: string;
  status: SetupReadinessCheckStatus;
  detail: string;
};

export type SetupReadinessResult = {
  overallStatus: SetupReadinessCheckStatus;
  checks: SetupReadinessCheck[];
  warnings: string[];
};

export type DeploymentStartPreview = {
  mode: "dry-run";
  awsCallsMade: boolean;
  commands: string[];
  resources: string[];
  warnings: string[];
};

export type DeploymentStartOptions = {
  confirmationText: string;
};

export type DeploymentEndOptions = {
  confirmationText: string;
  exportConfirmed: boolean;
  cancelled?: boolean;
};

export type DeploymentStartStatus = "succeeded" | "failed";
export type DeploymentEndStatus = "succeeded" | "failed" | "cancelled";

export type DeploymentStackOutput = {
  OutputKey: string;
  OutputValue: string;
};

export type DeploymentStartResult = {
  status: DeploymentStartStatus;
  finalStackStatus: string;
  logs: string[];
  savedOutputsPath?: string;
  outputs?: Record<string, string>;
};

export type DeploymentEndResult = {
  status: DeploymentEndStatus;
  finalStackStatus: string;
  logs: string[];
};

export type DeploymentOperationResult = DeploymentStartResult | DeploymentEndResult;

export type DeploymentShellCommand = {
  program: string;
  args: string[];
  env?: Record<string, string>;
};

export type DeploymentShellCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type DeploymentOutputsRecord = {
  stackName: string;
  region: string;
  outputs: Record<string, string>;
};

export interface DeploymentShellAdapter {
  run(command: DeploymentShellCommand): Promise<DeploymentShellCommandResult>;
  saveOutputs(record: DeploymentOutputsRecord): Promise<string>;
  clearDeploymentConfig(record: Pick<DeploymentOutputsRecord, "stackName" | "region">): Promise<string>;
}

export interface DeploymentCommandAdapter {
  previewStart(request: DeploymentStartRequest): Promise<DeploymentStartPreview>;
}

export interface RealDeploymentStartAdapter extends DeploymentCommandAdapter {
  start(request: DeploymentStartRequest, options: DeploymentStartOptions): Promise<DeploymentStartResult>;
}

export interface RealDeploymentEndAdapter extends DeploymentCommandAdapter {
  end(request: DeploymentStartRequest, options: DeploymentEndOptions): Promise<DeploymentEndResult>;
}

export const deploymentResources = [
  "AWS Lambda function for characterforge.app.handler",
  "API Gateway REST API with API key usage plan protection",
  "DynamoDB tables for character profiles and session messages",
  "IAM role and policies scoped to project tables and Bedrock Runtime",
  "CloudWatch Logs log group for Lambda execution",
  "CloudFormation stack outputs for ApiUrl, ApiKeyId, table names, and Lambda function name"
];

const successfulStackStatuses = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE"]);
const successfulDeleteStatuses = new Set(["DELETE_COMPLETE"]);
const failedStackStatusFragments = ["ROLLBACK", "FAILED", "DELETE_COMPLETE"];

function sanitize(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function normalizedRequest(request: DeploymentStartRequest) {
  return {
    awsRegion: sanitize(request.awsRegion, "us-east-1"),
    bedrockModel: sanitize(request.bedrockModel, "amazon.nova-micro-v1:0"),
    stackName: sanitize(request.stackName, "characterforge-ai-dev"),
    environmentName: sanitize(request.environmentName, "dev"),
    credentialMode: request.credentialMode,
    profileName: sanitize(request.profileName, "default"),
    temporaryCredentials: request.temporaryCredentials
  };
}

function credentialPrefix(request: DeploymentStartRequest): string {
  if (request.credentialMode !== "temporary") {
    return "";
  }
  return "AWS_ACCESS_KEY_ID=<provided locally> AWS_SECRET_ACCESS_KEY=<redacted> AWS_SESSION_TOKEN=<redacted> ";
}

function credentialEnv(request: DeploymentStartRequest): Record<string, string> | undefined {
  if (request.credentialMode !== "temporary") {
    return undefined;
  }
  const temporaryCredentials = request.temporaryCredentials;
  return {
    AWS_ACCESS_KEY_ID: temporaryCredentials?.accessKeyId ?? "",
    AWS_SECRET_ACCESS_KEY: temporaryCredentials?.secretAccessKey ?? "",
    AWS_SESSION_TOKEN: temporaryCredentials?.sessionToken ?? ""
  };
}

function profileArgs(request: DeploymentStartRequest): string {
  if (request.credentialMode !== "profile") {
    return "";
  }
  const profileName = sanitize(request.profileName, "default");
  return ` --profile ${quoteIfNeeded(profileName)}`;
}

function profileArgList(request: DeploymentStartRequest): string[] {
  if (request.credentialMode !== "profile") {
    return [];
  }
  return ["--profile", sanitize(request.profileName, "default")];
}

function redactText(text: string, request: DeploymentStartRequest): string {
  let redacted = text;
  const values = [
    request.temporaryCredentials?.accessKeyId,
    request.temporaryCredentials?.secretAccessKey,
    request.temporaryCredentials?.sessionToken
  ].filter((value): value is string => Boolean(value));

  for (const value of values) {
    redacted = redacted.split(value).join("<redacted>");
  }

  const secretAccessKeyName = "AWS_SECRET" + "_ACCESS_KEY";
  redacted = redacted.replace(/AWS_ACCESS_KEY_ID=[^\s]+/g, "AWS_ACCESS_KEY_ID=<provided locally>");
  redacted = redacted.replace(new RegExp(`${secretAccessKeyName}=[^\\s]+`, "g"), `${secretAccessKeyName}=<redacted>`);
  redacted = redacted.replace(/AWS_SESSION_TOKEN=[^\s]+/g, "AWS_SESSION_TOKEN=<redacted>");
  redacted = redacted.replace(/\b(token|session token|password|secret)\s+[^\s,;\]}]+/gi, "$1 <redacted>");
  redacted = redacted.replace(/\b(token|sessionToken|password|secret)[=:][^\s,;\]}]+/gi, "$1=<redacted>");
  return redacted;
}

function commandToLogLine(command: DeploymentShellCommand, request: DeploymentStartRequest): string {
  const envPrefix = command.env
    ? Object.keys(command.env)
        .map((key) => `${key}=${key === "AWS_ACCESS_KEY_ID" ? "<provided locally>" : "<redacted>"}`)
        .join(" ") + " "
    : "";
  return redactText(`$ ${envPrefix}${command.program} ${command.args.join(" ")}`, request);
}

function isTerminalFailure(status: string): boolean {
  return failedStackStatusFragments.some((fragment) => status.includes(fragment));
}

function parseDescribeStacks(stdout: string): { status: string; outputs: DeploymentStackOutput[] } {
  const parsed = JSON.parse(stdout) as { Stacks?: Array<{ StackStatus?: string; Outputs?: DeploymentStackOutput[] }> };
  const stack = parsed.Stacks?.[0];
  return {
    status: stack?.StackStatus ?? "UNKNOWN",
    outputs: stack?.Outputs ?? []
  };
}

function nonSecretOutputs(outputs: DeploymentStackOutput[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const output of outputs) {
    if (/secret|token|password|keyvalue/i.test(output.OutputKey)) {
      continue;
    }
    record[output.OutputKey] = output.OutputValue;
  }
  return record;
}

type StackResourceSummary = {
  LogicalResourceId?: string;
  ResourceType?: string;
  ResourceStatus?: string;
  ResourceStatusReason?: string;
};

function parseStackResources(stdout: string): StackResourceSummary[] {
  const parsed = JSON.parse(stdout) as { StackResources?: StackResourceSummary[] };
  return parsed.StackResources ?? [];
}

function retainedResourceLines(resources: StackResourceSummary[], request: DeploymentStartRequest): string[] {
  return resources
    .filter((resource) => /FAILED|DELETE_FAILED|UPDATE_FAILED|DELETE_SKIPPED/i.test(resource.ResourceStatus ?? ""))
    .map((resource) => {
      const logicalId = resource.LogicalResourceId ?? "UnknownResource";
      const type = resource.ResourceType ?? "AWS::Unknown::Resource";
      const status = resource.ResourceStatus ?? "UNKNOWN";
      const reason = resource.ResourceStatusReason ? ` — ${redactText(resource.ResourceStatusReason, request)}` : "";
      return `${logicalId} (${type}) - ${status}${reason}`;
    });
}

async function appendRetainedResourceGuidance(
  logs: string[],
  shell: DeploymentShellAdapter,
  request: DeploymentStartRequest
): Promise<void> {
  const resourcesCommand = buildDescribeStackResourcesCommand(request);
  logs.push("Checking retained CloudFormation resources after delete failure.");
  logs.push(commandToLogLine(resourcesCommand, request));
  const resourcesResult = await shell.run(resourcesCommand);
  if (resourcesResult.stdout) {
    logs.push(redactText(resourcesResult.stdout, request));
  }
  if (resourcesResult.stderr) {
    logs.push(redactText(resourcesResult.stderr, request));
  }
  if (resourcesResult.exitCode !== 0) {
    logs.push("Could not inspect retained resources automatically; review stack events in AWS Console before retrying deployment End.");
    return;
  }
  const retained = retainedResourceLines(parseStackResources(resourcesResult.stdout), request);
  if (retained.length === 0) {
    logs.push("No DELETE_FAILED retained resources were reported by describe-stack-resources; review stack events for details before retrying.");
    return;
  }
  logs.push("Retained resources requiring manual cleanup:");
  logs.push(...retained);
}

function buildDependencyValidationCommands(request: DeploymentStartRequest): DeploymentShellCommand[] {
  const env = credentialEnv(request);
  return [
    { program: "aws", args: ["--version"], env },
    { program: "sam", args: ["--version"], env }
  ];
}

function buildCommandPlan(request: DeploymentStartRequest): DeploymentShellCommand[] {
  const normalized = normalizedRequest(request);
  const env = credentialEnv(request);
  const profile = profileArgList(request);
  return [
    {
      program: "aws",
      args: [
        "cloudformation",
        "validate-template",
        "--template-body",
        "file://infra/template.yaml",
        ...profile,
        "--region",
        normalized.awsRegion
      ],
      env
    },
    {
      program: "sam",
      args: ["build", "--template-file", "infra/template.yaml"],
      env
    },
    {
      program: "sam",
      args: [
        "deploy",
        "--template-file",
        ".aws-sam/build/template.yaml",
        "--stack-name",
        normalized.stackName,
        "--region",
        normalized.awsRegion,
        ...profile,
        "--capabilities",
        "CAPABILITY_IAM",
        "--no-fail-on-empty-changeset",
        "--parameter-overrides",
        `EnvironmentName=${normalized.environmentName}`,
        `BedrockModelId=${normalized.bedrockModel}`,
        `BedrockRegion=${normalized.awsRegion}`,
        "RecentHistoryLimit=20"
      ],
      env
    }
  ];
}

function buildDescribeStacksCommand(request: DeploymentStartRequest): DeploymentShellCommand {
  const normalized = normalizedRequest(request);
  return {
    program: "aws",
    args: ["cloudformation", "describe-stacks", "--stack-name", normalized.stackName, ...profileArgList(request), "--region", normalized.awsRegion],
    env: credentialEnv(request)
  };
}


function buildDescribeStackResourcesCommand(request: DeploymentStartRequest): DeploymentShellCommand {
  const normalized = normalizedRequest(request);
  return {
    program: "aws",
    args: [
      "cloudformation",
      "describe-stack-resources",
      "--stack-name",
      normalized.stackName,
      ...profileArgList(request),
      "--region",
      normalized.awsRegion
    ],
    env: credentialEnv(request)
  };
}

function buildDeleteStackCommand(request: DeploymentStartRequest): DeploymentShellCommand {
  const normalized = normalizedRequest(request);
  return {
    program: "aws",
    args: ["cloudformation", "delete-stack", "--stack-name", normalized.stackName, ...profileArgList(request), "--region", normalized.awsRegion],
    env: credentialEnv(request)
  };
}

export function buildDeploymentStartPreview(request: DeploymentStartRequest): DeploymentStartPreview {
  const normalized = normalizedRequest(request);
  const prefix = credentialPrefix(request);
  const profile = profileArgs(request);
  const region = ` --region ${quoteIfNeeded(normalized.awsRegion)}`;

  const commands = [
    `${prefix}aws cloudformation validate-template --template-body file://infra/template.yaml${profile}${region}`,
    "sam build --template-file infra/template.yaml",
    `${prefix}sam deploy --template-file .aws-sam/build/template.yaml --stack-name ${quoteIfNeeded(normalized.stackName)}${region}${profile} --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides EnvironmentName=${quoteIfNeeded(normalized.environmentName)} BedrockModelId=${quoteIfNeeded(normalized.bedrockModel)} BedrockRegion=${quoteIfNeeded(normalized.awsRegion)} RecentHistoryLimit=20`
  ];

  const warnings = [
    "Dry-run mode only — this preview does not call AWS, SAM, CloudFormation, Bedrock, or credential providers.",
    "Review AWS costs before running a real Start deployment; Bedrock model calls are paid usage.",
    "Do not commit AWS credentials, generated API key values, samconfig.toml, or deployment-specific outputs."
  ];

  if (request.credentialMode === "temporary") {
    warnings.push("Temporary credential values are held only in the current form state and are redacted from command previews.");
  }

  return {
    mode: "dry-run",
    awsCallsMade: false,
    commands,
    resources: deploymentResources,
    warnings
  };
}

export function createBrowserDryRunDeploymentAdapter(): DeploymentCommandAdapter {
  return {
    async previewStart(request: DeploymentStartRequest) {
      return buildDeploymentStartPreview(request);
    }
  };
}

export function createRealDeploymentStartAdapter(shell: DeploymentShellAdapter): RealDeploymentStartAdapter {
  return {
    async previewStart(request: DeploymentStartRequest) {
      return buildDeploymentStartPreview(request);
    },
    async start(request: DeploymentStartRequest, options: DeploymentStartOptions) {
      const normalized = normalizedRequest(request);
      const requiredConfirmation = `START ${normalized.stackName}`;
      if (options.confirmationText.trim() !== requiredConfirmation) {
        throw new Error(`To run real deployment Start, type ${requiredConfirmation}.`);
      }

      const logs = [`Confirmed real deployment Start for ${normalized.stackName} in ${normalized.awsRegion}.`];
      logs.push("Validating local deployment dependencies before Start.");
      for (const command of buildDependencyValidationCommands(request)) {
        logs.push(commandToLogLine(command, request));
        const result = await shell.run(command);
        if (result.stdout) {
          logs.push(redactText(result.stdout, request));
        }
        if (result.stderr) {
          logs.push(redactText(result.stderr, request));
        }
        if (result.exitCode !== 0) {
          logs.push(`Dependency validation failed for ${command.program} with exit code ${result.exitCode}.`);
          return { status: "failed", finalStackStatus: "DEPENDENCY_VALIDATION_FAILED", logs };
        }
      }
      for (const command of buildCommandPlan(request)) {
        logs.push(commandToLogLine(command, request));
        const result = await shell.run(command);
        logs.push(redactText(result.stdout, request));
        if (result.stderr) {
          logs.push(redactText(result.stderr, request));
        }
        if (result.exitCode !== 0) {
          logs.push(`Command failed with exit code ${result.exitCode}.`);
          return { status: "failed", finalStackStatus: "COMMAND_FAILED", logs };
        }
      }

      let finalStackStatus = "UNKNOWN";
      const describeCommand = buildDescribeStacksCommand(request);
      for (let attempt = 1; attempt <= 30; attempt += 1) {
        logs.push(`Polling CloudFormation stack status (${attempt}/30).`);
        logs.push(commandToLogLine(describeCommand, request));
        const result = await shell.run(describeCommand);
        if (result.exitCode !== 0) {
          logs.push(redactText(result.stderr || result.stdout, request));
          return { status: "failed", finalStackStatus: "DESCRIBE_STACKS_FAILED", logs };
        }
        const stack = parseDescribeStacks(result.stdout);
        finalStackStatus = stack.status;
        logs.push(`CloudFormation stack status: ${finalStackStatus}.`);
        if (successfulStackStatuses.has(finalStackStatus)) {
          const outputResult = await shell.run(describeCommand);
          const outputStack = parseDescribeStacks(outputResult.stdout);
          const outputs = nonSecretOutputs(outputStack.outputs);
          const savedOutputsPath = await shell.saveOutputs({ stackName: normalized.stackName, region: normalized.awsRegion, outputs });
          logs.push(`Saved non-secret stack outputs to ${savedOutputsPath}.`);
          return { status: "succeeded", finalStackStatus, logs, savedOutputsPath, outputs };
        }
        if (isTerminalFailure(finalStackStatus)) {
          logs.push(`CloudFormation reported ${finalStackStatus}; review stack events in AWS Console or with aws cloudformation describe-stack-events.`);
          return { status: "failed", finalStackStatus, logs };
        }
      }

      logs.push("Timed out waiting for CloudFormation stack to reach a terminal status.");
      return { status: "failed", finalStackStatus, logs };
    }
  };
}


export function createRealDeploymentEndAdapter(shell: DeploymentShellAdapter): RealDeploymentEndAdapter {
  return {
    async previewStart(request: DeploymentStartRequest) {
      return buildDeploymentStartPreview(request);
    },
    async end(request: DeploymentStartRequest, options: DeploymentEndOptions) {
      const normalized = normalizedRequest(request);
      const requiredConfirmation = `END ${normalized.stackName}`;
      if (options.cancelled || !options.exportConfirmed) {
        return {
          status: "cancelled",
          finalStackStatus: "CANCELLED_BEFORE_DELETE",
          logs: [
            "Deployment End cancelled before commands ran.",
            "Export character packs before deleting the deployment stack so local characters can be restored later."
          ]
        };
      }
      if (options.confirmationText.trim() !== requiredConfirmation) {
        throw new Error(`To run deployment End, type ${requiredConfirmation}.`);
      }

      const logs = [`Confirmed deployment End for ${normalized.stackName} in ${normalized.awsRegion}.`];
      const deleteCommand = buildDeleteStackCommand(request);
      logs.push(commandToLogLine(deleteCommand, request));
      const deleteResult = await shell.run(deleteCommand);
      logs.push(redactText(deleteResult.stdout, request));
      if (deleteResult.stderr) {
        logs.push(redactText(deleteResult.stderr, request));
      }
      if (deleteResult.exitCode !== 0) {
        logs.push(`Delete command failed with exit code ${deleteResult.exitCode}.`);
        return { status: "failed", finalStackStatus: "DELETE_STACK_FAILED", logs };
      }

      const describeCommand = buildDescribeStacksCommand(request);
      let finalStackStatus = "DELETE_IN_PROGRESS";
      for (let attempt = 1; attempt <= 30; attempt += 1) {
        logs.push(`Polling CloudFormation delete status (${attempt}/30).`);
        logs.push(commandToLogLine(describeCommand, request));
        const result = await shell.run(describeCommand);
        if (result.exitCode !== 0) {
          const combined = `${result.stderr}\n${result.stdout}`;
          logs.push(redactText(combined, request));
          if (/does not exist|stack with id .* does not exist|validationerror/i.test(combined)) {
            const clearedConfigPath = await shell.clearDeploymentConfig({ stackName: normalized.stackName, region: normalized.awsRegion });
            logs.push(`Cleared local deployment config at ${clearedConfigPath} after CloudFormation reported the stack no longer exists.`);
            return { status: "succeeded", finalStackStatus: "DELETE_COMPLETE", logs };
          }
          return { status: "failed", finalStackStatus: "DESCRIBE_STACKS_FAILED", logs };
        }
        const stack = parseDescribeStacks(result.stdout);
        finalStackStatus = stack.status;
        logs.push(`CloudFormation stack status: ${finalStackStatus}.`);
        if (successfulDeleteStatuses.has(finalStackStatus)) {
          const clearedConfigPath = await shell.clearDeploymentConfig({ stackName: normalized.stackName, region: normalized.awsRegion });
          logs.push(`Cleared local deployment config at ${clearedConfigPath} after CloudFormation delete completed.`);
          return { status: "succeeded", finalStackStatus, logs };
        }
        if (finalStackStatus === "DELETE_FAILED" || /ROLLBACK|FAILED/.test(finalStackStatus)) {
          logs.push(`CloudFormation reported ${finalStackStatus}; review stack events before retrying deployment End.`);
          await appendRetainedResourceGuidance(logs, shell, request);
          logs.push("Local deployment config was left in place because deletion did not complete safely.");
          return { status: "failed", finalStackStatus, logs };
        }
      }

      logs.push("Timed out waiting for CloudFormation stack deletion to finish.");
      return { status: "failed", finalStackStatus, logs };
    }
  };
}

export interface DesktopShellDeploymentCommandAdapter extends RealDeploymentStartAdapter, RealDeploymentEndAdapter {
  readonly shell: "tauri";
}

export function createDesktopShellDeploymentAdapter(
  invokeCommand: (command: string, payload: unknown) => Promise<DeploymentStartPreview | DeploymentOperationResult>
): DesktopShellDeploymentCommandAdapter {
  return {
    shell: "tauri",
    previewStart(request: DeploymentStartRequest) {
      return invokeCommand("preview_deployment_start", { request }) as Promise<DeploymentStartPreview>;
    },
    start(request: DeploymentStartRequest, options: DeploymentStartOptions) {
      return invokeCommand("start_deployment", { request, options }) as Promise<DeploymentStartResult>;
    },
    end(request: DeploymentStartRequest, options: DeploymentEndOptions) {
      return invokeCommand("end_deployment", { request, options }) as Promise<DeploymentEndResult>;
    }
  };
}
