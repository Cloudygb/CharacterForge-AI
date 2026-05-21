// Desktop deployment shell for CharacterForgeAI.
// Preview is dry-run only. Real Start is guarded by explicit confirmation,
// redacts credentials from logs, polls CloudFormation, and stores only
// non-secret stack outputs in a local user file.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(test)]
const REQUIRED_DEPLOYMENT_RESOURCE_RELATIVE_PATHS: &[&str] = &[
    "deployment/infra/template.yaml",
    "deployment/src/characterforge/app.py",
    "deployment/src/requirements.txt",
    "deployment/pyproject.toml",
    "deployment/schemas/character-pack.schema.json",
    "deployment/schemas/game-binding.schema.json",
    "deployment/LICENSE",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryDeploymentCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStartOptions {
    pub confirmation_text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentEndOptions {
    pub confirmation_text: String,
    pub export_confirmed: bool,
    pub cancelled: Option<bool>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStartResult {
    pub status: String,
    pub final_stack_status: String,
    pub logs: Vec<String>,
    pub saved_outputs_path: Option<String>,
    pub outputs: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentEndResult {
    pub status: String,
    pub final_stack_status: String,
    pub logs: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ShellCommand {
    pub program: String,
    pub args: Vec<String>,
    pub current_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct DeploymentResourcePaths {
    pub root: PathBuf,
    pub template: PathBuf,
    pub backend_source: PathBuf,
    pub requirements: PathBuf,
    pub pyproject: PathBuf,
    pub character_pack_schema: PathBuf,
    pub game_binding_schema: PathBuf,
    pub license: PathBuf,
}

impl DeploymentResourcePaths {
    fn from_resource_root(resource_root: PathBuf) -> Result<Self, String> {
        let root = resource_root.join("deployment");
        let paths = Self {
            template: root.join("infra/template.yaml"),
            backend_source: root.join("src/characterforge"),
            requirements: root.join("src/requirements.txt"),
            pyproject: root.join("pyproject.toml"),
            character_pack_schema: root.join("schemas/character-pack.schema.json"),
            game_binding_schema: root.join("schemas/game-binding.schema.json"),
            license: root.join("LICENSE"),
            root,
        };
        paths.verify_required_resources()?;
        Ok(paths)
    }

    fn for_dev_build() -> Result<Self, String> {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .map_err(|error| format!("failed to resolve development resource root: {error}"))?;
        let paths = Self {
            template: repo_root.join("infra/template.yaml"),
            backend_source: repo_root.join("src/characterforge"),
            requirements: repo_root.join("src/requirements.txt"),
            pyproject: repo_root.join("pyproject.toml"),
            character_pack_schema: repo_root.join("schemas/character-pack.schema.json"),
            game_binding_schema: repo_root.join("schemas/game-binding.schema.json"),
            license: repo_root.join("LICENSE"),
            root: repo_root,
        };
        paths.verify_required_resources()?;
        Ok(paths)
    }

    fn verify_required_resources(&self) -> Result<(), String> {
        for path in [
            &self.template,
            &self.backend_source,
            &self.requirements,
            &self.pyproject,
            &self.character_pack_schema,
            &self.game_binding_schema,
            &self.license,
        ] {
            if !path.exists() {
                return Err(format!(
                    "missing packaged deployment resource: {}",
                    path.display()
                ));
            }
        }
        Ok(())
    }
}

fn resolve_deployment_resources(
    app: Option<&AppHandle>,
) -> Result<DeploymentResourcePaths, String> {
    if let Some(override_dir) = std::env::var_os("CHARACTERFORGEAI_RESOURCE_DIR") {
        return DeploymentResourcePaths::from_resource_root(PathBuf::from(override_dir));
    }

    if cfg!(debug_assertions) {
        return DeploymentResourcePaths::for_dev_build();
    }

    if let Some(app) = app {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("failed to resolve packaged resource directory: {error}"))?;
        return DeploymentResourcePaths::from_resource_root(resource_dir);
    }

    DeploymentResourcePaths::for_dev_build()
}

#[derive(Debug)]
pub struct ShellCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub trait DeploymentCommandAdapter {
    fn preview_start(&self, request: DeploymentStartRequest) -> DeploymentStartPreview;
    fn start(
        &self,
        request: DeploymentStartRequest,
        options: DeploymentStartOptions,
    ) -> Result<DeploymentStartResult, String>;
    fn end(
        &self,
        request: DeploymentStartRequest,
        options: DeploymentEndOptions,
    ) -> Result<DeploymentEndResult, String>;
}

pub trait DeploymentShellAdapter {
    fn run(
        &self,
        request: &DeploymentStartRequest,
        command: &ShellCommand,
    ) -> Result<ShellCommandResult, String>;
    fn save_outputs(
        &self,
        stack_name: &str,
        region: &str,
        outputs: &BTreeMap<String, String>,
    ) -> Result<String, String>;
}

pub struct DryRunDeploymentCommandAdapter;
pub struct RealDeploymentCommandAdapter<S: DeploymentShellAdapter> {
    shell: S,
}

impl<S: DeploymentShellAdapter> RealDeploymentCommandAdapter<S> {
    pub fn new(shell: S) -> Self {
        Self { shell }
    }
}

pub struct LocalProcessDeploymentShell {
    resource_paths: DeploymentResourcePaths,
}

impl LocalProcessDeploymentShell {
    pub fn new(resource_paths: DeploymentResourcePaths) -> Self {
        Self { resource_paths }
    }
}

impl DeploymentShellAdapter for LocalProcessDeploymentShell {
    fn run(
        &self,
        request: &DeploymentStartRequest,
        command: &ShellCommand,
    ) -> Result<ShellCommandResult, String> {
        let mut child = Command::new(&command.program);
        child.args(&command.args);
        child.current_dir(
            command
                .current_dir
                .as_ref()
                .unwrap_or(&self.resource_paths.root),
        );
        if request.credential_mode == "temporary" {
            if let Some(credentials) = &request.temporary_credentials {
                child.env("AWS_ACCESS_KEY_ID", &credentials.access_key_id);
                child.env("AWS_SECRET_ACCESS_KEY", &credentials.secret_access_key);
                child.env("AWS_SESSION_TOKEN", &credentials.session_token);
            }
        }
        let output = child
            .output()
            .map_err(|error| format!("failed to run {}: {error}", command.program))?;
        Ok(ShellCommandResult {
            exit_code: output.status.code().unwrap_or(1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }

    fn save_outputs(
        &self,
        stack_name: &str,
        region: &str,
        outputs: &BTreeMap<String, String>,
    ) -> Result<String, String> {
        let base_dir = user_home_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join(".characterforge")
            .join("deployments");
        fs::create_dir_all(&base_dir)
            .map_err(|error| format!("failed to create output directory: {error}"))?;
        let path = base_dir.join(format!("{stack_name}-{region}-outputs.json"));
        let document = serde_json::json!({
            "stackName": stack_name,
            "region": region,
            "outputs": outputs,
        });
        fs::write(
            &path,
            serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to save outputs: {error}"))?;
        Ok(path.to_string_lossy().to_string())
    }
}

impl DeploymentCommandAdapter for DryRunDeploymentCommandAdapter {
    fn preview_start(&self, request: DeploymentStartRequest) -> DeploymentStartPreview {
        build_preview(request)
    }

    fn start(
        &self,
        _request: DeploymentStartRequest,
        _options: DeploymentStartOptions,
    ) -> Result<DeploymentStartResult, String> {
        Err("real deployment Start is not available from the dry-run adapter".to_string())
    }

    fn end(
        &self,
        _request: DeploymentStartRequest,
        _options: DeploymentEndOptions,
    ) -> Result<DeploymentEndResult, String> {
        Err("deployment End is not available from the dry-run adapter".to_string())
    }
}

impl<S: DeploymentShellAdapter> DeploymentCommandAdapter for RealDeploymentCommandAdapter<S> {
    fn preview_start(&self, request: DeploymentStartRequest) -> DeploymentStartPreview {
        build_preview(request)
    }

    fn start(
        &self,
        request: DeploymentStartRequest,
        options: DeploymentStartOptions,
    ) -> Result<DeploymentStartResult, String> {
        let normalized = NormalizedDeploymentRequest::from(&request);
        let required_confirmation = format!("START {}", normalized.stack_name);
        if options.confirmation_text.trim() != required_confirmation {
            return Err(format!(
                "To run real deployment Start, type {required_confirmation}."
            ));
        }

        let mut logs = vec![format!(
            "Confirmed real deployment Start for {} in {}.",
            normalized.stack_name, normalized.aws_region
        )];

        for command in build_command_plan(&request) {
            logs.push(command_to_log_line(&request, &command));
            let result = self.shell.run(&request, &command)?;
            push_redacted_output(&mut logs, &request, &result.stdout);
            push_redacted_output(&mut logs, &request, &result.stderr);
            if result.exit_code != 0 {
                logs.push(format!(
                    "Command failed with exit code {}.",
                    result.exit_code
                ));
                return Ok(DeploymentStartResult {
                    status: "failed".to_string(),
                    final_stack_status: "COMMAND_FAILED".to_string(),
                    logs,
                    saved_outputs_path: None,
                    outputs: None,
                });
            }
        }

        let describe_command = describe_stacks_command(&request);
        let mut final_stack_status = "UNKNOWN".to_string();
        for attempt in 1..=30 {
            logs.push(format!(
                "Polling CloudFormation stack status ({attempt}/30)."
            ));
            logs.push(command_to_log_line(&request, &describe_command));
            let result = self.shell.run(&request, &describe_command)?;
            if result.exit_code != 0 {
                push_redacted_output(&mut logs, &request, &result.stderr);
                return Ok(DeploymentStartResult {
                    status: "failed".to_string(),
                    final_stack_status: "DESCRIBE_STACKS_FAILED".to_string(),
                    logs,
                    saved_outputs_path: None,
                    outputs: None,
                });
            }

            let (stack_status, _outputs) = parse_describe_stacks(&result.stdout)?;
            final_stack_status = stack_status;
            logs.push(format!(
                "CloudFormation stack status: {final_stack_status}."
            ));

            if final_stack_status == "CREATE_COMPLETE" || final_stack_status == "UPDATE_COMPLETE" {
                let output_result = self.shell.run(&request, &describe_command)?;
                let (_status, raw_outputs) = parse_describe_stacks(&output_result.stdout)?;
                let outputs = non_secret_outputs(raw_outputs);
                let saved_outputs_path = self.shell.save_outputs(
                    &normalized.stack_name,
                    &normalized.aws_region,
                    &outputs,
                )?;
                logs.push(format!(
                    "Saved non-secret stack outputs to {saved_outputs_path}."
                ));
                return Ok(DeploymentStartResult {
                    status: "succeeded".to_string(),
                    final_stack_status,
                    logs,
                    saved_outputs_path: Some(saved_outputs_path),
                    outputs: Some(outputs),
                });
            }

            if is_failure_status(&final_stack_status) {
                logs.push(format!(
                    "CloudFormation reported {final_stack_status}; review stack events in AWS Console or with aws cloudformation describe-stack-events."
                ));
                return Ok(DeploymentStartResult {
                    status: "failed".to_string(),
                    final_stack_status,
                    logs,
                    saved_outputs_path: None,
                    outputs: None,
                });
            }

            thread::sleep(Duration::from_secs(5));
        }

        logs.push(
            "Timed out waiting for CloudFormation stack to reach a terminal status.".to_string(),
        );
        Ok(DeploymentStartResult {
            status: "failed".to_string(),
            final_stack_status,
            logs,
            saved_outputs_path: None,
            outputs: None,
        })
    }

    fn end(
        &self,
        request: DeploymentStartRequest,
        options: DeploymentEndOptions,
    ) -> Result<DeploymentEndResult, String> {
        let normalized = NormalizedDeploymentRequest::from(&request);
        let required_confirmation = format!("END {}", normalized.stack_name);
        if options.cancelled.unwrap_or(false) || !options.export_confirmed {
            return Ok(DeploymentEndResult {
                status: "cancelled".to_string(),
                final_stack_status: "CANCELLED_BEFORE_DELETE".to_string(),
                logs: vec![
                    "Deployment End cancelled before commands ran.".to_string(),
                    "Export character packs before deleting the deployment stack so local characters can be restored later.".to_string(),
                ],
            });
        }
        if options.confirmation_text.trim() != required_confirmation {
            return Err(format!(
                "To run deployment End, type {required_confirmation}."
            ));
        }

        let mut logs = vec![format!(
            "Confirmed deployment End for {} in {}.",
            normalized.stack_name, normalized.aws_region
        )];
        let delete_command = delete_stack_command(&request);
        logs.push(command_to_log_line(&request, &delete_command));
        let delete_result = self.shell.run(&request, &delete_command)?;
        push_redacted_output(&mut logs, &request, &delete_result.stdout);
        push_redacted_output(&mut logs, &request, &delete_result.stderr);
        if delete_result.exit_code != 0 {
            logs.push(format!(
                "Delete command failed with exit code {}.",
                delete_result.exit_code
            ));
            return Ok(DeploymentEndResult {
                status: "failed".to_string(),
                final_stack_status: "DELETE_STACK_FAILED".to_string(),
                logs,
            });
        }

        let describe_command = describe_stacks_command(&request);
        let mut final_stack_status = "DELETE_IN_PROGRESS".to_string();
        for attempt in 1..=30 {
            logs.push(format!(
                "Polling CloudFormation delete status ({attempt}/30)."
            ));
            logs.push(command_to_log_line(&request, &describe_command));
            let result = self.shell.run(&request, &describe_command)?;
            if result.exit_code != 0 {
                let combined = format!("{}\n{}", result.stderr, result.stdout);
                push_redacted_output(&mut logs, &request, &combined);
                let lower = combined.to_lowercase();
                if lower.contains("does not exist") || lower.contains("validationerror") {
                    return Ok(DeploymentEndResult {
                        status: "succeeded".to_string(),
                        final_stack_status: "DELETE_COMPLETE".to_string(),
                        logs,
                    });
                }
                return Ok(DeploymentEndResult {
                    status: "failed".to_string(),
                    final_stack_status: "DESCRIBE_STACKS_FAILED".to_string(),
                    logs,
                });
            }

            let (stack_status, _outputs) = parse_describe_stacks(&result.stdout)?;
            final_stack_status = stack_status;
            logs.push(format!(
                "CloudFormation stack status: {final_stack_status}."
            ));
            if final_stack_status == "DELETE_COMPLETE" {
                return Ok(DeploymentEndResult {
                    status: "succeeded".to_string(),
                    final_stack_status,
                    logs,
                });
            }
            if final_stack_status == "DELETE_FAILED" || is_failure_status(&final_stack_status) {
                logs.push(format!(
                    "CloudFormation reported {final_stack_status}; review stack events before retrying deployment End."
                ));
                return Ok(DeploymentEndResult {
                    status: "failed".to_string(),
                    final_stack_status,
                    logs,
                });
            }
            thread::sleep(Duration::from_secs(5));
        }

        logs.push("Timed out waiting for CloudFormation stack deletion to finish.".to_string());
        Ok(DeploymentEndResult {
            status: "failed".to_string(),
            final_stack_status,
            logs,
        })
    }
}

struct NormalizedDeploymentRequest {
    aws_region: String,
    bedrock_model: String,
    stack_name: String,
    environment_name: String,
    profile_name: String,
}

impl From<&DeploymentStartRequest> for NormalizedDeploymentRequest {
    fn from(request: &DeploymentStartRequest) -> Self {
        Self {
            aws_region: sanitize(&request.aws_region, "us-east-1"),
            bedrock_model: sanitize(&request.bedrock_model, "amazon.nova-micro-v1:0"),
            stack_name: sanitize(&request.stack_name, "characterforge-ai-dev"),
            environment_name: sanitize(&request.environment_name, "dev"),
            profile_name: sanitize(&request.profile_name, "default"),
        }
    }
}

fn sanitize(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_preview(request: DeploymentStartRequest) -> DeploymentStartPreview {
    let normalized = NormalizedDeploymentRequest::from(&request);
    let profile_args = if request.credential_mode == "temporary" {
        "".to_string()
    } else {
        format!(" --profile {}", normalized.profile_name)
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
                "{credential_prefix}aws cloudformation validate-template --template-body file://infra/template.yaml{profile_args} --region {}",
                normalized.aws_region
            ),
            "sam build --template-file infra/template.yaml".to_string(),
            format!(
                "{credential_prefix}sam deploy --template-file .aws-sam/build/template.yaml --stack-name {} --region {}{profile_args} --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides EnvironmentName={} BedrockModelId={} BedrockRegion={} RecentHistoryLimit=20",
                normalized.stack_name, normalized.aws_region, normalized.environment_name, normalized.bedrock_model, normalized.aws_region
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

fn build_command_plan(request: &DeploymentStartRequest) -> Vec<ShellCommand> {
    let normalized = NormalizedDeploymentRequest::from(request);
    let mut profile_args = Vec::new();
    if request.credential_mode != "temporary" {
        profile_args = vec!["--profile".to_string(), normalized.profile_name.clone()];
    }

    vec![
        ShellCommand {
            program: "aws".to_string(),
            args: [
                vec![
                    "cloudformation".to_string(),
                    "validate-template".to_string(),
                    "--template-body".to_string(),
                    "file://infra/template.yaml".to_string(),
                ],
                profile_args.clone(),
                vec!["--region".to_string(), normalized.aws_region.clone()],
            ]
            .concat(),
            current_dir: None,
        },
        ShellCommand {
            program: "sam".to_string(),
            args: vec![
                "build".to_string(),
                "--template-file".to_string(),
                "infra/template.yaml".to_string(),
            ],
            current_dir: None,
        },
        ShellCommand {
            program: "sam".to_string(),
            args: [
                vec![
                    "deploy".to_string(),
                    "--template-file".to_string(),
                    ".aws-sam/build/template.yaml".to_string(),
                    "--stack-name".to_string(),
                    normalized.stack_name,
                    "--region".to_string(),
                    normalized.aws_region.clone(),
                ],
                profile_args,
                vec![
                    "--capabilities".to_string(),
                    "CAPABILITY_IAM".to_string(),
                    "--no-fail-on-empty-changeset".to_string(),
                    "--parameter-overrides".to_string(),
                    format!("EnvironmentName={}", normalized.environment_name),
                    format!("BedrockModelId={}", normalized.bedrock_model),
                    format!("BedrockRegion={}", normalized.aws_region),
                    "RecentHistoryLimit=20".to_string(),
                ],
            ]
            .concat(),
            current_dir: None,
        },
    ]
}

fn describe_stacks_command(request: &DeploymentStartRequest) -> ShellCommand {
    let normalized = NormalizedDeploymentRequest::from(request);
    let mut args = vec![
        "cloudformation".to_string(),
        "describe-stacks".to_string(),
        "--stack-name".to_string(),
        normalized.stack_name,
    ];
    if request.credential_mode != "temporary" {
        args.extend(["--profile".to_string(), normalized.profile_name]);
    }
    args.extend(["--region".to_string(), normalized.aws_region]);
    ShellCommand {
        program: "aws".to_string(),
        args,
        current_dir: None,
    }
}

fn delete_stack_command(request: &DeploymentStartRequest) -> ShellCommand {
    let normalized = NormalizedDeploymentRequest::from(request);
    let mut args = vec![
        "cloudformation".to_string(),
        "delete-stack".to_string(),
        "--stack-name".to_string(),
        normalized.stack_name,
    ];
    if request.credential_mode != "temporary" {
        args.extend(["--profile".to_string(), normalized.profile_name]);
    }
    args.extend(["--region".to_string(), normalized.aws_region]);
    ShellCommand {
        program: "aws".to_string(),
        args,
        current_dir: None,
    }
}

fn command_to_log_line(request: &DeploymentStartRequest, command: &ShellCommand) -> String {
    let env_prefix = if request.credential_mode == "temporary" {
        "AWS_ACCESS_KEY_ID=<provided locally> AWS_SECRET_ACCESS_KEY=<redacted> AWS_SESSION_TOKEN=<redacted> "
    } else {
        ""
    };
    redact_text(
        request,
        &format!(
            "$ {env_prefix}{} {}",
            command.program,
            command.args.join(" ")
        ),
    )
}

fn push_redacted_output(logs: &mut Vec<String>, request: &DeploymentStartRequest, text: &str) {
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        logs.push(redact_text(request, trimmed));
    }
}

fn redact_text(request: &DeploymentStartRequest, text: &str) -> String {
    let mut redacted = text.to_string();
    if let Some(credentials) = &request.temporary_credentials {
        for value in [
            &credentials.access_key_id,
            &credentials.secret_access_key,
            &credentials.session_token,
        ] {
            if !value.is_empty() {
                redacted = redacted.replace(value, "<redacted>");
            }
        }
    }
    redacted
}

fn parse_describe_stacks(stdout: &str) -> Result<(String, Vec<(String, String)>), String> {
    let value: Value = serde_json::from_str(stdout)
        .map_err(|error| format!("invalid describe-stacks JSON: {error}"))?;
    let stack = value
        .get("Stacks")
        .and_then(Value::as_array)
        .and_then(|stacks| stacks.first())
        .ok_or_else(|| "describe-stacks returned no stack".to_string())?;
    let status = stack
        .get("StackStatus")
        .and_then(Value::as_str)
        .unwrap_or("UNKNOWN")
        .to_string();
    let outputs = match stack.get("Outputs").and_then(Value::as_array) {
        Some(values) => values
            .iter()
            .filter_map(|output| {
                Some((
                    output.get("OutputKey")?.as_str()?.to_string(),
                    output.get("OutputValue")?.as_str()?.to_string(),
                ))
            })
            .collect(),
        None => Vec::new(),
    };
    Ok((status, outputs))
}

fn non_secret_outputs(outputs: Vec<(String, String)>) -> BTreeMap<String, String> {
    outputs
        .into_iter()
        .filter(|(key, _value)| {
            let lower = key.to_lowercase();
            !(lower.contains("secret")
                || lower.contains("token")
                || lower.contains("password")
                || lower.contains("keyvalue"))
        })
        .collect()
}

fn is_failure_status(status: &str) -> bool {
    status.contains("ROLLBACK") || status.contains("FAILED") || status == "DELETE_COMPLETE"
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

#[tauri::command]
fn preview_deployment_start(request: DeploymentStartRequest) -> DeploymentStartPreview {
    DryRunDeploymentCommandAdapter.preview_start(request)
}

#[tauri::command]
fn start_deployment(
    app: AppHandle,
    request: DeploymentStartRequest,
    options: DeploymentStartOptions,
) -> Result<DeploymentStartResult, String> {
    let resource_paths = resolve_deployment_resources(Some(&app))?;
    RealDeploymentCommandAdapter::new(LocalProcessDeploymentShell::new(resource_paths))
        .start(request, options)
}

#[tauri::command]
fn end_deployment(
    app: AppHandle,
    request: DeploymentStartRequest,
    options: DeploymentEndOptions,
) -> Result<DeploymentEndResult, String> {
    let resource_paths = resolve_deployment_resources(Some(&app))?;
    RealDeploymentCommandAdapter::new(LocalProcessDeploymentShell::new(resource_paths))
        .end(request, options)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create test resource parent");
        }
        fs::write(path, content).expect("write test resource");
    }

    fn packaged_resource_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "characterforgeai-packaged-resources-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        write_file(
            &root.join("deployment/infra/template.yaml"),
            "Transform: AWS::Serverless-2016-10-31",
        );
        write_file(
            &root.join("deployment/src/characterforge/app.py"),
            "def handler(event, context): pass",
        );
        write_file(
            &root.join("deployment/src/requirements.txt"),
            "boto3>=1.34.0",
        );
        write_file(
            &root.join("deployment/pyproject.toml"),
            "[project]\nname = 'characterforge-ai'",
        );
        write_file(
            &root.join("deployment/schemas/character-pack.schema.json"),
            "{}",
        );
        write_file(
            &root.join("deployment/schemas/game-binding.schema.json"),
            "{}",
        );
        write_file(&root.join("deployment/LICENSE"), "Required Notice: test");
        root
    }

    #[test]
    fn resolves_required_deployment_resources_in_packaged_mode_without_aws_calls() {
        let root = packaged_resource_root();
        let paths =
            DeploymentResourcePaths::from_resource_root(root.clone()).expect("resources resolve");

        assert_eq!(REQUIRED_DEPLOYMENT_RESOURCE_RELATIVE_PATHS.len(), 7);
        assert_eq!(paths.root, root.join("deployment"));
        assert_eq!(paths.template, root.join("deployment/infra/template.yaml"));
        assert_eq!(
            paths.backend_source,
            root.join("deployment/src/characterforge")
        );
        assert_eq!(
            paths.requirements,
            root.join("deployment/src/requirements.txt")
        );
        assert_eq!(paths.pyproject, root.join("deployment/pyproject.toml"));
        assert_eq!(
            paths.character_pack_schema,
            root.join("deployment/schemas/character-pack.schema.json")
        );
        assert_eq!(
            paths.game_binding_schema,
            root.join("deployment/schemas/game-binding.schema.json")
        );
        assert_eq!(paths.license, root.join("deployment/LICENSE"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_packaged_mode_when_a_required_resource_is_missing() {
        let root = packaged_resource_root();
        fs::remove_file(root.join("deployment/infra/template.yaml")).expect("remove template");

        let error = DeploymentResourcePaths::from_resource_root(root.clone())
            .expect_err("missing template fails");
        assert!(error.contains("template.yaml"));

        let _ = fs::remove_dir_all(root);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            preview_deployment_start,
            start_deployment,
            end_deployment
        ])
        .run(tauri::generate_context!())
        .expect("error while running CharacterForgeAI");
}
