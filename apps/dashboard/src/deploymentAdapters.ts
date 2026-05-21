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

export type DeploymentStartPreview = {
  mode: "dry-run";
  awsCallsMade: boolean;
  commands: string[];
  resources: string[];
  warnings: string[];
};

export interface DeploymentCommandAdapter {
  previewStart(request: DeploymentStartRequest): Promise<DeploymentStartPreview>;
}

export const deploymentResources = [
  "AWS Lambda function for characterforge.app.handler",
  "API Gateway REST API with API key usage plan protection",
  "DynamoDB tables for character profiles and session messages",
  "IAM role and policies scoped to project tables and Bedrock Runtime",
  "CloudWatch Logs log group for Lambda execution",
  "CloudFormation stack outputs for ApiUrl, ApiKeyId, table names, and Lambda function name"
];

function sanitize(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function credentialPrefix(request: DeploymentStartRequest): string {
  if (request.credentialMode !== "temporary") {
    return "";
  }
  return "AWS_ACCESS_KEY_ID=<provided locally> AWS_SECRET_ACCESS_KEY=<redacted> AWS_SESSION_TOKEN=<redacted> ";
}

function profileArgs(request: DeploymentStartRequest): string {
  if (request.credentialMode !== "profile") {
    return "";
  }
  const profileName = sanitize(request.profileName, "default");
  return ` --profile ${quoteIfNeeded(profileName)}`;
}

export function buildDeploymentStartPreview(request: DeploymentStartRequest): DeploymentStartPreview {
  const awsRegion = sanitize(request.awsRegion, "us-east-1");
  const bedrockModel = sanitize(request.bedrockModel, "amazon.nova-micro-v1:0");
  const stackName = sanitize(request.stackName, "characterforge-ai-dev");
  const environmentName = sanitize(request.environmentName, "dev");
  const prefix = credentialPrefix(request);
  const profile = profileArgs(request);
  const region = ` --region ${quoteIfNeeded(awsRegion)}`;

  const commands = [
    `${prefix}aws cloudformation validate-template --template-body file://infra/template.yaml${profile}${region}`,
    "sam build --template-file infra/template.yaml",
    `${prefix}sam deploy --template-file .aws-sam/build/template.yaml --stack-name ${quoteIfNeeded(stackName)}${region}${profile} --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides EnvironmentName=${quoteIfNeeded(environmentName)} BedrockModelId=${quoteIfNeeded(bedrockModel)} BedrockRegion=${quoteIfNeeded(awsRegion)} RecentHistoryLimit=20`
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

export interface DesktopShellDeploymentCommandAdapter extends DeploymentCommandAdapter {
  readonly shell: "tauri";
}

export function createDesktopShellDeploymentAdapter(invokeCommand: (command: string, payload: unknown) => Promise<DeploymentStartPreview>): DesktopShellDeploymentCommandAdapter {
  return {
    shell: "tauri",
    previewStart(request: DeploymentStartRequest) {
      return invokeCommand("preview_deployment_start", { request });
    }
  };
}
