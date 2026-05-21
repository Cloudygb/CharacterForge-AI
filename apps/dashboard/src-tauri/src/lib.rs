// Keep the desktop shell intentionally small: it packages the existing
// React/Vite dashboard. Deployment commands currently expose dry-run adapter
// shapes only; they do not spawn AWS, SAM, CloudFormation, or Bedrock calls.
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryDeploymentCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStartRequest {
    pub aws_region: String,
    pub bedrock_model: String,
    pub stack_name: String,
    pub environment_name: String,
    pub credential_mode: String,
    pub profile_name: String,
    pub temporary_credentials: Option<TemporaryDeploymentCredentials>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStartPreview {
    pub mode: String,
    pub aws_calls_made: bool,
    pub commands: Vec<String>,
    pub resources: Vec<String>,
    pub warnings: Vec<String>,
}

pub trait DeploymentCommandAdapter {
    fn preview_start(&self, request: DeploymentStartRequest) -> DeploymentStartPreview;
}

pub struct DryRunDeploymentCommandAdapter;

impl DeploymentCommandAdapter for DryRunDeploymentCommandAdapter {
    fn preview_start(&self, request: DeploymentStartRequest) -> DeploymentStartPreview {
        let region = if request.aws_region.trim().is_empty() {
            "us-east-1".to_string()
        } else {
            request.aws_region.trim().to_string()
        };
        let stack_name = if request.stack_name.trim().is_empty() {
            "characterforge-ai-dev".to_string()
        } else {
            request.stack_name.trim().to_string()
        };
        let environment_name = if request.environment_name.trim().is_empty() {
            "dev".to_string()
        } else {
            request.environment_name.trim().to_string()
        };
        let model = if request.bedrock_model.trim().is_empty() {
            "amazon.nova-micro-v1:0".to_string()
        } else {
            request.bedrock_model.trim().to_string()
        };
        let profile_args = if request.credential_mode == "temporary" {
            "".to_string()
        } else {
            let profile = if request.profile_name.trim().is_empty() {
                "default"
            } else {
                request.profile_name.trim()
            };
            format!(" --profile {profile}")
        };
        let credential_prefix = if request.credential_mode == "temporary" {
            "AWS_ACCESS_KEY_ID=<provided locally> AWS_SECRET_ACCESS_KEY=<redacted> AWS_SESSION_TOKEN=<redacted> "
        } else {
            ""
        };

        DeploymentStartPreview {
            mode: "dry-run".to_string(),
            aws_calls_made: false,
            commands: vec![
                format!(
                    "{credential_prefix}aws cloudformation validate-template --template-body file://infra/template.yaml{profile_args} --region {region}"
                ),
                "sam build --template-file infra/template.yaml".to_string(),
                format!(
                    "{credential_prefix}sam deploy --template-file .aws-sam/build/template.yaml --stack-name {stack_name} --region {region}{profile_args} --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides EnvironmentName={environment_name} BedrockModelId={model} BedrockRegion={region} RecentHistoryLimit=20"
                ),
            ],
            resources: vec![
                "AWS Lambda function for characterforge.app.handler".to_string(),
                "API Gateway REST API with API key usage plan protection".to_string(),
                "DynamoDB tables for character profiles and session messages".to_string(),
                "IAM role and policies scoped to project tables and Bedrock Runtime".to_string(),
                "CloudWatch Logs log group for Lambda execution".to_string(),
            ],
            warnings: vec![
                "Dry-run mode only — this desktop command does not call AWS, SAM, CloudFormation, Bedrock, or credential providers.".to_string(),
                "Temporary credential values are never echoed in command previews.".to_string(),
            ],
        }
    }
}

#[tauri::command]
pub fn preview_deployment_start(request: DeploymentStartRequest) -> DeploymentStartPreview {
    DryRunDeploymentCommandAdapter.preview_start(request)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![preview_deployment_start])
        .run(tauri::generate_context!())
        .expect("error while running CharacterForge Dashboard");
}
