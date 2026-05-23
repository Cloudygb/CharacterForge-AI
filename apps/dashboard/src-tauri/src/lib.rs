// Desktop deployment shell for CharacterForgeAI.
// Preview is dry-run only. Real Start is guarded by explicit confirmation,
// redacts credentials from logs, polls CloudFormation, and stores only
// non-secret stack outputs in a local user file.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterFolderInfo {
    pub path: String,
    pub browser_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterFolderOpenResult {
    pub path: String,
    pub opened: bool,
    pub browser_mode: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCharacterSummary {
    pub id: String,
    pub name: String,
    pub archetype: String,
    pub status: String,
    pub description: String,
    pub allowed_actions: Vec<String>,
    pub source: Option<String>,
    pub sync_status: Option<String>,
    pub sync_error: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterFolderScanIssue {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterFolderScanResult {
    pub folder_path: String,
    pub characters: Vec<LocalCharacterSummary>,
    pub invalid_files: Vec<CharacterFolderScanIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterPackExportResult {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterFileSaveResult {
    pub path: String,
}

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
    #[serde(default)]
    pub confirmation_token: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentEndOptions {
    pub confirmation_text: String,
    pub export_confirmed: bool,
    pub cancelled: Option<bool>,
    #[serde(default)]
    pub confirmation_token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentConfirmationSession {
    pub confirmation_token: String,
    pub required_confirmation: String,
    pub operation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DeploymentOperation {
    Start,
    End,
}

impl DeploymentOperation {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::End => "end",
        }
    }

    fn confirmation_prefix(&self) -> &'static str {
        match self {
            Self::Start => "START",
            Self::End => "END",
        }
    }
}

#[derive(Debug, Clone)]
struct DeploymentSessionClaim {
    operation: DeploymentOperation,
    stack_name: String,
}

#[derive(Debug, Default)]
pub struct DeploymentSessionStore {
    sessions: Mutex<BTreeMap<String, DeploymentSessionClaim>>,
}

impl DeploymentSessionStore {
    fn create_session(
        &self,
        operation: DeploymentOperation,
        request: &DeploymentStartRequest,
    ) -> Result<DeploymentConfirmationSession, String> {
        let normalized = NormalizedDeploymentRequest::from(request);
        let required_confirmation = format!(
            "{} {}",
            operation.confirmation_prefix(),
            normalized.stack_name
        );
        let token = deployment_confirmation_token(operation.as_str(), &normalized.stack_name);
        self.sessions
            .lock()
            .map_err(|_| "Deployment session store is unavailable.".to_string())?
            .insert(
                token.clone(),
                DeploymentSessionClaim {
                    operation: operation.clone(),
                    stack_name: normalized.stack_name,
                },
            );
        Ok(DeploymentConfirmationSession {
            confirmation_token: token,
            required_confirmation,
            operation: operation.as_str().to_string(),
        })
    }

    fn validate_and_consume(
        &self,
        operation: DeploymentOperation,
        request: &DeploymentStartRequest,
        confirmation_token: &str,
    ) -> Result<(), String> {
        let normalized = NormalizedDeploymentRequest::from(request);
        let token = confirmation_token.trim();
        if token.is_empty() {
            return Err(
                "Deployment command requires a native confirmation session token.".to_string(),
            );
        }
        let claim = self
            .sessions
            .lock()
            .map_err(|_| "Deployment session store is unavailable.".to_string())?
            .remove(token)
            .ok_or_else(|| {
                "Deployment confirmation session is missing, expired, or already used.".to_string()
            })?;
        if claim.operation != operation || claim.stack_name != normalized.stack_name {
            return Err(
                "Deployment confirmation session does not match this operation and stack."
                    .to_string(),
            );
        }
        Ok(())
    }
}

fn deployment_confirmation_token(operation: &str, stack_name: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(
        "cfai-{operation}-{timestamp}-{}",
        stack_name
            .chars()
            .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
            .take(48)
            .collect::<String>()
    )
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
struct StackResourceSummary {
    logical_resource_id: String,
    resource_type: String,
    resource_status: String,
    resource_status_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReadinessRequest {
    pub aws_region: String,
    pub bedrock_model: String,
    pub profile_name: String,
    pub stack_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReadinessCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReadinessResult {
    pub overall_status: String,
    pub checks: Vec<SetupReadinessCheck>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsSetupStackPreview {
    pub stack_name: String,
    pub region: String,
    pub profile_name: String,
    pub bedrock_model: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsSetupWizardResult {
    pub profiles: Vec<String>,
    pub selected_profile: String,
    pub selected_region: String,
    pub selected_model: String,
    pub available_models: Vec<String>,
    pub bedrock_access_status: String,
    pub stack_preview: AwsSetupStackPreview,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SetupReadinessCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    pub channel: String,
    pub manifest_url: String,
    pub manual_check_enabled: bool,
    pub unsafe_auto_update_enabled: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            channel: "stable".to_string(),
            manifest_url: String::new(),
            manual_check_enabled: false,
            unsafe_auto_update_enabled: false,
        }
    }
}

impl UpdateSettings {
    fn sanitized(mut self) -> Self {
        self.channel = "stable".to_string();
        self.manifest_url.clear();
        self.manual_check_enabled = false;
        self.unsafe_auto_update_enabled = false;
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
}

impl Default for UpdateCheckResult {
    fn default() -> Self {
        Self {
            available: false,
            version: None,
            notes: Some("You are up to date.".to_string()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub first_run_tutorial_completed: bool,
    pub first_run_tutorial_skipped: bool,
    #[serde(default)]
    pub update_settings: UpdateSettings,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            first_run_tutorial_completed: false,
            first_run_tutorial_skipped: false,
            update_settings: UpdateSettings::default(),
        }
    }
}

fn default_character_folder_path() -> Result<PathBuf, String> {
    let base = env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| {
            env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .ok_or_else(|| {
            "Could not resolve a safe app data directory for CharacterForgeAI.".to_string()
        })?;
    Ok(base.join("CharacterForgeAI").join("characters"))
}

fn is_safe_character_folder_path(path: &Path) -> bool {
    let components: Vec<String> = path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    if components
        .iter()
        .any(|component| component == ".." || component.contains('\0'))
    {
        return false;
    }
    components
        .windows(2)
        .any(|window| window[0] == "characterforgeai" && window[1] == "characters")
}

fn ensure_character_folder() -> Result<PathBuf, String> {
    let folder = default_character_folder_path()?;
    if !is_safe_character_folder_path(&folder) {
        return Err("Character folder path must stay under CharacterForgeAI app data.".to_string());
    }
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create character folder: {error}"))?;
    Ok(folder)
}

fn json_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn json_string_array(value: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_array))
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn local_character_from_value(
    value: &Value,
    fallback_id: &str,
) -> Result<LocalCharacterSummary, String> {
    let name = json_string(value, &["name"]).ok_or_else(|| "missing name".to_string())?;
    let sync_status = json_string(value, &["syncStatus", "sync_status"]);
    Ok(LocalCharacterSummary {
        id: json_string(value, &["id", "character_id", "characterId"])
            .unwrap_or_else(|| fallback_id.to_string()),
        name,
        archetype: json_string(value, &["archetype", "titleStatus", "status_title"])
            .unwrap_or_else(|| "Local character file".to_string()),
        status: json_string(value, &["status"])
            .unwrap_or_else(|| "Loaded from local character folder".to_string()),
        description: json_string(value, &["description"]).unwrap_or_else(|| {
            "Imported from the configured CharacterForgeAI character folder.".to_string()
        }),
        allowed_actions: json_string_array(value, &["allowedActions", "allowed_actions"]),
        source: json_string(value, &["source"]).or_else(|| Some("local".to_string())),
        sync_status: sync_status.or_else(|| Some("api_pending".to_string())),
        sync_error: json_string(value, &["syncError", "sync_error"]),
        payload: value.get("payload").cloned(),
    })
}

fn safe_export_file_name(file_name: &str) -> Result<String, String> {
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err("Export file name must be a simple .json file name.".to_string());
    }
    let candidate = Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Export file name is required.".to_string())?;
    if !candidate.ends_with(".json") {
        return Err("Export file name must be a simple .json file name.".to_string());
    }
    let sanitized: String = candidate
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .collect();
    if sanitized.is_empty() || sanitized != candidate {
        return Err("Export file name contains unsupported characters.".to_string());
    }
    Ok(sanitized)
}

fn safe_character_file_name(file_name: &str) -> Result<String, String> {
    safe_export_file_name(file_name)
}

fn safe_character_file_name_from_value(character: &Value) -> Result<String, String> {
    if let Some(file_name) = json_string(character, &["fileName", "file_name"]) {
        return safe_character_file_name(&file_name);
    }
    let id = json_string(character, &["id", "characterId", "character_id"])
        .ok_or_else(|| "Character file saves require an id or fileName.".to_string())?;
    let sanitized: String = id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        return Err("Character file name could not be derived from id.".to_string());
    }
    safe_character_file_name(&format!("{trimmed}.json"))
}

fn scan_character_folder_path(folder: &Path) -> Result<CharacterFolderScanResult, String> {
    if !is_safe_character_folder_path(folder) {
        return Err("Character folder path must stay under CharacterForgeAI app data.".to_string());
    }
    let mut characters = Vec::new();
    let mut invalid_files = Vec::new();
    for entry in
        fs::read_dir(folder).map_err(|error| format!("Could not read character folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not inspect character file: {error}"))?;
        let path = entry.path();
        if !path.is_file()
            || path.extension().and_then(|extension| extension.to_str()) != Some("json")
        {
            continue;
        }
        let relative_path = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.display().to_string());
        match fs::read_to_string(&path)
            .map_err(|error| error.to_string())
            .and_then(|contents| {
                serde_json::from_str::<Value>(&contents).map_err(|error| error.to_string())
            })
            .and_then(|value| {
                local_character_from_value(
                    &value,
                    path.file_stem()
                        .and_then(|name| name.to_str())
                        .unwrap_or("local-character"),
                )
            }) {
            Ok(character) => characters.push(character),
            Err(error) => invalid_files.push(CharacterFolderScanIssue {
                path: relative_path,
                error,
            }),
        }
    }
    Ok(CharacterFolderScanResult {
        folder_path: folder.display().to_string(),
        characters,
        invalid_files,
    })
}

#[tauri::command]
fn get_character_folder() -> Result<CharacterFolderInfo, String> {
    let folder = ensure_character_folder()?;
    Ok(CharacterFolderInfo {
        path: folder.display().to_string(),
        browser_mode: false,
    })
}

#[tauri::command]
fn open_character_folder() -> Result<CharacterFolderOpenResult, String> {
    let folder = ensure_character_folder()?;
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(&folder).status();
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&folder).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(&folder).status();

    Ok(CharacterFolderOpenResult {
        path: folder.display().to_string(),
        opened: status.map(|status| status.success()).unwrap_or(false),
        browser_mode: false,
    })
}

#[tauri::command]
fn scan_character_folder() -> Result<CharacterFolderScanResult, String> {
    let folder = ensure_character_folder()?;
    scan_character_folder_path(&folder)
}

#[tauri::command]
fn save_character_pack_export(
    file_name: String,
    contents: String,
) -> Result<CharacterPackExportResult, String> {
    let folder = ensure_character_folder()?;
    let file_name = safe_export_file_name(&file_name)?;
    let export_path = folder.join(file_name);
    fs::write(&export_path, contents)
        .map_err(|error| format!("Could not write character export: {error}"))?;
    Ok(CharacterPackExportResult {
        path: export_path.display().to_string(),
    })
}

#[tauri::command]
fn save_character_file(character: Value) -> Result<CharacterFileSaveResult, String> {
    let folder = ensure_character_folder()?;
    let file_name = safe_character_file_name_from_value(&character)?;
    let file_path = folder.join(file_name);
    let contents = serde_json::to_string_pretty(&character)
        .map_err(|error| format!("Could not serialize character file: {error}"))?;
    fs::write(&file_path, contents)
        .map_err(|error| format!("Could not write character file: {error}"))?;
    Ok(CharacterFileSaveResult {
        path: file_path.display().to_string(),
    })
}

#[tauri::command]
fn delete_character_file(character_id: String, file_name: String) -> Result<(), String> {
    let folder = ensure_character_folder()?;
    let file_name = safe_character_file_name(&file_name)?;
    let file_path = folder.join(file_name);
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|error| format!("Could not delete local character file: {error}"))?;
        return Ok(());
    }

    let derived_file_name = safe_character_file_name_from_value(&serde_json::json!({
        "id": character_id
    }))?;
    let derived_path = folder.join(derived_file_name);
    if derived_path.exists() {
        fs::remove_file(&derived_path)
            .map_err(|error| format!("Could not delete local character file: {error}"))?;
    }
    Ok(())
}

fn app_config_file_from_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("CharacterForgeAI").join("config.json")
}

fn resolve_app_config_file(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    if let Some(override_dir) = std::env::var_os("CHARACTERFORGEAI_CONFIG_DIR") {
        return Ok(app_config_file_from_dir(&PathBuf::from(override_dir)));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return Ok(app_config_file_from_dir(&PathBuf::from(appdata)));
    }
    if let Some(app) = app {
        let fallback = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("failed to resolve app config directory: {error}"))?;
        return Ok(fallback.join("config.json"));
    }
    let fallback = user_home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("AppData/Roaming");
    Ok(app_config_file_from_dir(&fallback))
}

fn read_app_config_from_path(path: &Path) -> Result<AppConfig, String> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read CharacterForgeAI config: {error}"))?;
    let mut config: AppConfig = serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse CharacterForgeAI config: {error}"))?;
    config.update_settings = config.update_settings.sanitized();
    Ok(config)
}

fn write_app_config_to_path(path: &Path, mut config: AppConfig) -> Result<AppConfig, String> {
    config.update_settings = config.update_settings.sanitized();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("failed to create CharacterForgeAI config directory: {error}")
        })?;
    }
    let raw = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("failed to serialize CharacterForgeAI config: {error}"))?;
    fs::write(path, raw)
        .map_err(|error| format!("failed to write CharacterForgeAI config: {error}"))?;
    Ok(config)
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
    fn clear_deployment_config(&self, stack_name: &str, region: &str) -> Result<String, String>;
}

pub trait SetupReadinessShell {
    fn run(&self, program: &str, args: &[&str]) -> SetupReadinessCommandResult;
}

pub struct LocalSetupReadinessShell;

impl SetupReadinessShell for LocalSetupReadinessShell {
    fn run(&self, program: &str, args: &[&str]) -> SetupReadinessCommandResult {
        match Command::new(program).args(args).output() {
            Ok(output) => SetupReadinessCommandResult {
                exit_code: output.status.code().unwrap_or(1),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            },
            Err(error) => SetupReadinessCommandResult {
                exit_code: 127,
                stdout: String::new(),
                stderr: error.to_string(),
            },
        }
    }
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
        let path = base_dir.join(deployment_output_file_name(stack_name, region)?);
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

    fn clear_deployment_config(&self, stack_name: &str, region: &str) -> Result<String, String> {
        let path = user_home_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join(".characterforge")
            .join("deployments")
            .join(deployment_output_file_name(stack_name, region)?);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("failed to clear local deployment config: {error}"))?;
        }
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

fn deployment_output_file_name(stack_name: &str, region: &str) -> Result<String, String> {
    fn safe_segment(value: &str, label: &str) -> Result<String, String> {
        let trimmed = value.trim();
        if trimmed.is_empty()
            || trimmed == "."
            || trimmed == ".."
            || trimmed.contains("..")
            || trimmed.contains('/')
            || trimmed.contains('\\')
            || !trimmed.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
        {
            return Err(format!(
                "Deployment {label} must be a safe file-name segment."
            ));
        }
        Ok(trimmed.to_string())
    }

    Ok(format!(
        "{}-{}-outputs.json",
        safe_segment(stack_name, "stack name")?,
        safe_segment(region, "region")?
    ))
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

        logs.push("Validating local deployment dependencies before Start.".to_string());
        for command in dependency_validation_commands() {
            logs.push(command_to_log_line(&request, &command));
            let result = self.shell.run(&request, &command)?;
            push_redacted_output(&mut logs, &request, &result.stdout);
            push_redacted_output(&mut logs, &request, &result.stderr);
            if result.exit_code != 0 {
                logs.push(format!(
                    "Dependency validation failed for {} with exit code {}.",
                    command.program, result.exit_code
                ));
                return Ok(DeploymentStartResult {
                    status: "failed".to_string(),
                    final_stack_status: "DEPENDENCY_VALIDATION_FAILED".to_string(),
                    logs,
                    saved_outputs_path: None,
                    outputs: None,
                });
            }
        }

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
                    let cleared_config_path = self
                        .shell
                        .clear_deployment_config(&normalized.stack_name, &normalized.aws_region)?;
                    logs.push(format!(
                        "Cleared local deployment config at {cleared_config_path} after CloudFormation reported the stack no longer exists."
                    ));
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
                let cleared_config_path = self
                    .shell
                    .clear_deployment_config(&normalized.stack_name, &normalized.aws_region)?;
                logs.push(format!(
                    "Cleared local deployment config at {cleared_config_path} after CloudFormation delete completed."
                ));
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
                append_retained_resource_guidance(&self.shell, &request, &mut logs)?;
                logs.push("Local deployment config was left in place because deletion did not complete safely.".to_string());
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

fn dependency_validation_commands() -> Vec<ShellCommand> {
    vec![
        ShellCommand {
            program: "aws".to_string(),
            args: vec!["--version".to_string()],
            current_dir: None,
        },
        ShellCommand {
            program: "sam".to_string(),
            args: vec!["--version".to_string()],
            current_dir: None,
        },
    ]
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

fn describe_stack_resources_command(request: &DeploymentStartRequest) -> ShellCommand {
    let normalized = NormalizedDeploymentRequest::from(request);
    let mut args = vec![
        "cloudformation".to_string(),
        "describe-stack-resources".to_string(),
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
    for marker in ["AWS_SECRET_ACCESS_KEY=", "AWS_SESSION_TOKEN="] {
        let mut search_start = 0;
        while let Some(relative_index) = redacted[search_start..].find(marker) {
            let index = search_start + relative_index;
            let value_start = index + marker.len();
            let value_end = redacted[value_start..]
                .find(|character: char| {
                    character.is_whitespace() || [',', ';', ']', '}'].contains(&character)
                })
                .map(|offset| value_start + offset)
                .unwrap_or(redacted.len());
            redacted.replace_range(value_start..value_end, "<redacted>");
            search_start = value_start + "<redacted>".len();
            if search_start >= redacted.len() {
                break;
            }
        }
    }
    if let Some(index) = redacted.to_lowercase().find("token ") {
        let end = redacted[index + 6..]
            .find(|character: char| {
                character.is_whitespace() || [',', ';', ']', '}'].contains(&character)
            })
            .map(|offset| index + 6 + offset)
            .unwrap_or(redacted.len());
        redacted.replace_range(index + 6..end, "<redacted>");
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

fn parse_stack_resources(stdout: &str) -> Result<Vec<StackResourceSummary>, String> {
    let value: Value = serde_json::from_str(stdout)
        .map_err(|error| format!("invalid describe-stack-resources JSON: {error}"))?;
    let resources = value
        .get("StackResources")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| StackResourceSummary {
                    logical_resource_id: item
                        .get("LogicalResourceId")
                        .and_then(Value::as_str)
                        .unwrap_or("UnknownResource")
                        .to_string(),
                    resource_type: item
                        .get("ResourceType")
                        .and_then(Value::as_str)
                        .unwrap_or("AWS::Unknown::Resource")
                        .to_string(),
                    resource_status: item
                        .get("ResourceStatus")
                        .and_then(Value::as_str)
                        .unwrap_or("UNKNOWN")
                        .to_string(),
                    resource_status_reason: item
                        .get("ResourceStatusReason")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(resources)
}

fn append_retained_resource_guidance<S: DeploymentShellAdapter>(
    shell: &S,
    request: &DeploymentStartRequest,
    logs: &mut Vec<String>,
) -> Result<(), String> {
    let resources_command = describe_stack_resources_command(request);
    logs.push("Checking retained CloudFormation resources after delete failure.".to_string());
    logs.push(command_to_log_line(request, &resources_command));
    let resources_result = shell.run(request, &resources_command)?;
    push_redacted_output(logs, request, &resources_result.stdout);
    push_redacted_output(logs, request, &resources_result.stderr);
    if resources_result.exit_code != 0 {
        logs.push("Could not inspect retained resources automatically; review stack events in AWS Console before retrying deployment End.".to_string());
        return Ok(());
    }
    let retained: Vec<String> = parse_stack_resources(&resources_result.stdout)?
        .into_iter()
        .filter(|resource| {
            resource.resource_status.contains("FAILED")
                || resource.resource_status == "DELETE_SKIPPED"
        })
        .map(|resource| {
            let reason = resource
                .resource_status_reason
                .as_ref()
                .map(|value| format!(" — {}", redact_text(request, value)))
                .unwrap_or_default();
            format!(
                "{} ({}) - {}{}",
                resource.logical_resource_id,
                resource.resource_type,
                resource.resource_status,
                reason
            )
        })
        .collect();
    if retained.is_empty() {
        logs.push("No DELETE_FAILED retained resources were reported by describe-stack-resources; review stack events for details before retrying.".to_string());
    } else {
        logs.push("Retained resources requiring manual cleanup:".to_string());
        logs.extend(retained);
    }
    Ok(())
}

fn setup_check(
    id: &str,
    label: &str,
    status: &str,
    detail: impl Into<String>,
) -> SetupReadinessCheck {
    SetupReadinessCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: status.to_string(),
        detail: sanitize_setup_detail(&detail.into()),
    }
}

fn sanitize_setup_detail(detail: &str) -> String {
    let secret_access_key = "AWS_SECRET".to_string() + "_ACCESS_KEY";
    let forbidden = [
        secret_access_key.as_str(),
        "AWS_SESSION_TOKEN",
        "secret_access_key",
        "session_token",
        "password",
        "token=",
    ];
    let mut sanitized = detail.to_string();
    for term in forbidden {
        sanitized = sanitized.replace(term, "<redacted>");
    }
    sanitized
}

fn check_aws_setup_wizard_with_shell<S: SetupReadinessShell>(
    shell: &S,
    request: SetupReadinessRequest,
) -> AwsSetupWizardResult {
    let region = if request.aws_region.trim().is_empty() {
        "us-east-1"
    } else {
        request.aws_region.trim()
    };
    let profile = if request.profile_name.trim().is_empty() {
        "default"
    } else {
        request.profile_name.trim()
    };
    let stack_name = if request.stack_name.trim().is_empty() {
        "characterforge-ai-dev"
    } else {
        request.stack_name.trim()
    };

    let profiles_output = shell.run("aws", &["configure", "list-profiles"]);
    let mut profiles: Vec<String> = if profiles_output.exit_code == 0 {
        profiles_output
            .stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !looks_like_secret(line))
            .map(sanitize_setup_detail)
            .collect()
    } else {
        Vec::new()
    };
    profiles.sort();
    profiles.dedup();

    let profile_region = shell.run("aws", &["configure", "get", "region", "--profile", profile]);
    let selected_region = if region.is_empty()
        && profile_region.exit_code == 0
        && !profile_region.stdout.trim().is_empty()
    {
        profile_region.stdout.trim().to_string()
    } else {
        region.to_string()
    };

    let models = shell.run(
        "aws",
        &[
            "bedrock",
            "list-foundation-models",
            "--region",
            &selected_region,
            "--profile",
            profile,
        ],
    );
    let available_models = parse_model_ids(&models.stdout);
    let bedrock_access_status = if models.exit_code == 0
        && available_models.contains(&request.bedrock_model)
    {
        "ready: model access confirmed by Bedrock control-plane list call".to_string()
    } else if models.exit_code == 0 {
        "warning: Bedrock list call succeeded, but the selected model was not listed".to_string()
    } else {
        format!(
            "warning: Bedrock model list could not be read ({})",
            sanitize_setup_detail(first_non_empty(&models.stdout, &models.stderr).as_str())
        )
    };

    let stack = shell.run(
        "aws",
        &[
            "cloudformation",
            "describe-stacks",
            "--stack-name",
            stack_name,
            "--profile",
            profile,
            "--region",
            &selected_region,
        ],
    );
    let stack_status = if stack.exit_code == 0 {
        parse_stack_status(&stack.stdout).unwrap_or_else(|| "UNKNOWN".to_string())
    } else if format!("{}\n{}", stack.stderr, stack.stdout)
        .to_lowercase()
        .contains("does not exist")
    {
        "NOT_CREATED_YET".to_string()
    } else {
        "UNREADABLE".to_string()
    };

    AwsSetupWizardResult {
        profiles,
        selected_profile: sanitize_setup_detail(profile),
        selected_region: sanitize_setup_detail(&selected_region),
        selected_model: sanitize_setup_detail(&request.bedrock_model),
        available_models: available_models
            .into_iter()
            .map(|model| sanitize_setup_detail(&model))
            .collect(),
        bedrock_access_status: sanitize_setup_detail(&bedrock_access_status),
        stack_preview: AwsSetupStackPreview {
            stack_name: sanitize_setup_detail(stack_name),
            region: sanitize_setup_detail(&selected_region),
            profile_name: sanitize_setup_detail(profile),
            bedrock_model: sanitize_setup_detail(&request.bedrock_model),
            status: sanitize_setup_detail(&stack_status),
        },
        warnings: vec![
            "Credential values are never stored, logged, or returned by this wizard.".to_string(),
            "Bedrock usage and deployed AWS resources may create account charges.".to_string(),
            "The Bedrock check lists available models only; it does not invoke a model prompt."
                .to_string(),
        ],
    }
}

fn parse_model_ids(stdout: &str) -> Vec<String> {
    let parsed: Value = match serde_json::from_str(stdout) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    parsed
        .get("modelSummaries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("modelId").and_then(Value::as_str))
        .filter(|model| !looks_like_secret(model))
        .map(str::to_string)
        .collect()
}

fn looks_like_secret(value: &str) -> bool {
    let lower = value.to_lowercase();
    value.starts_with("AKIA")
        || value.starts_with("ASIA")
        || lower.contains("accesskey")
        || lower.contains("secret")
        || lower.contains("session_token")
        || lower.contains("password")
        || lower.contains("authorization")
        || lower.contains("bearer ")
}

fn check_setup_readiness_with_shell<S: SetupReadinessShell>(
    shell: &S,
    resource_paths: DeploymentResourcePaths,
    request: SetupReadinessRequest,
) -> SetupReadinessResult {
    let region = if request.aws_region.trim().is_empty() {
        "us-east-1"
    } else {
        request.aws_region.trim()
    };
    let profile = if request.profile_name.trim().is_empty() {
        "default"
    } else {
        request.profile_name.trim()
    };
    let stack_name = if request.stack_name.trim().is_empty() {
        "characterforge-ai-dev"
    } else {
        request.stack_name.trim()
    };
    let mut checks = Vec::new();
    let mut warnings = vec![
        "Setup checks return readiness labels only; credential values are never displayed."
            .to_string(),
    ];

    let webview = shell.run("where", &["msedgewebview2.exe"]);
    checks.push(if webview.exit_code == 0 {
        setup_check("webview2", "WebView2 Runtime", "ready", "WebView2 runtime is available.")
    } else {
        setup_check("webview2", "WebView2 Runtime", "warning", "WebView2 runtime was not found on PATH; installer validation may still find it in Windows registry.")
    });

    let aws_version = shell.run("aws", &["--version"]);
    checks.push(if aws_version.exit_code == 0 {
        setup_check(
            "awsCli",
            "AWS CLI",
            "ready",
            first_non_empty(&aws_version.stdout, &aws_version.stderr),
        )
    } else {
        setup_check(
            "awsCli",
            "AWS CLI",
            "error",
            "AWS CLI is not available on PATH.",
        )
    });

    let sam_version = shell.run("sam", &["--version"]);
    checks.push(if sam_version.exit_code == 0 {
        setup_check(
            "samCli",
            "AWS SAM CLI",
            "ready",
            first_non_empty(&sam_version.stdout, &sam_version.stderr),
        )
    } else {
        setup_check(
            "samCli",
            "AWS SAM CLI",
            "error",
            "AWS SAM CLI is not available on PATH.",
        )
    });

    let docker_version = shell.run("docker", &["--version"]);
    let docker_info = shell.run("docker", &["info"]);
    checks.push(if docker_version.exit_code != 0 {
        setup_check("docker", "Docker", "warning", "Docker CLI is not available; SAM builds can still work without containers for this template.")
    } else if docker_info.exit_code == 0 {
        setup_check("docker", "Docker", "ready", "Docker CLI and engine are running.")
    } else {
        setup_check("docker", "Docker", "warning", "Docker CLI is installed, but the Docker engine is not running.")
    });

    checks.push(setup_check(
        "resources",
        "Deployment resources",
        "ready",
        format!(
            "Packaged deployment resources found at {}.",
            resource_paths.root.display()
        ),
    ));

    let profiles = shell.run("aws", &["configure", "list-profiles"]);
    let profile_lines: Vec<&str> = profiles.stdout.lines().map(str::trim).collect();
    checks.push(
        if profiles.exit_code == 0 && profile_lines.iter().any(|line| *line == profile) {
            setup_check(
                "awsProfile",
                "AWS profile",
                "ready",
                format!("Profile {profile} is configured."),
            )
        } else if profiles.exit_code == 0 {
            setup_check(
                "awsProfile",
                "AWS profile",
                "error",
                format!("Profile {profile} was not found."),
            )
        } else {
            setup_check(
                "awsProfile",
                "AWS profile",
                "error",
                "AWS profiles could not be listed.",
            )
        },
    );

    let profile_region = shell.run("aws", &["configure", "get", "region", "--profile", profile]);
    checks.push(
        if profile_region.exit_code == 0 && profile_region.stdout.trim() == region {
            setup_check(
                "awsRegion",
                "AWS region",
                "ready",
                format!("Region {region} selected and matches profile {profile}."),
            )
        } else if profile_region.exit_code == 0 && !profile_region.stdout.trim().is_empty() {
            setup_check(
                "awsRegion",
                "AWS region",
                "warning",
                format!(
                    "Selected region {region}; profile {profile} defaults to {}.",
                    profile_region.stdout.trim()
                ),
            )
        } else {
            setup_check(
                "awsRegion",
                "AWS region",
                "warning",
                format!("Selected region {region}; no default region found for profile {profile}."),
            )
        },
    );

    let stack = shell.run(
        "aws",
        &[
            "cloudformation",
            "describe-stacks",
            "--stack-name",
            stack_name,
            "--profile",
            profile,
            "--region",
            region,
        ],
    );
    checks.push(if stack.exit_code == 0 {
        let status = parse_stack_status(&stack.stdout).unwrap_or_else(|| "UNKNOWN".to_string());
        setup_check(
            "stack",
            "CloudFormation stack",
            "ready",
            format!("Stack {stack_name} exists with status {status}."),
        )
    } else if format!("{}\n{}", stack.stderr, stack.stdout)
        .to_lowercase()
        .contains("does not exist")
    {
        setup_check(
            "stack",
            "CloudFormation stack",
            "warning",
            format!("Stack {stack_name} does not exist yet; Start can create it."),
        )
    } else {
        setup_check(
            "stack",
            "CloudFormation stack",
            "warning",
            "Stack status could not be read with the selected profile and region.",
        )
    });

    let models = shell.run(
        "aws",
        &[
            "bedrock",
            "list-foundation-models",
            "--region",
            region,
            "--profile",
            profile,
        ],
    );
    checks.push(if models.exit_code == 0 && models.stdout.contains(&request.bedrock_model) {
        setup_check("model", "Bedrock model", "ready", "Model appears in Bedrock foundation model list.")
    } else if models.exit_code == 0 {
        setup_check("model", "Bedrock model", "warning", "Model was not listed for the selected Bedrock region/profile; verify model access before Start.")
    } else {
        setup_check("model", "Bedrock model", "warning", "Bedrock model list could not be read; verify model access before Start.")
    });

    if checks.iter().any(|check| check.status == "error") {
        warnings.push("Fix error checks before running deployment Start.".to_string());
    }
    if checks.iter().any(|check| check.status == "warning") {
        warnings.push("Review warning checks before deployment; warnings may still be acceptable for first-time Start.".to_string());
    }
    let overall_status = if checks.iter().any(|check| check.status == "error") {
        "error"
    } else if checks.iter().any(|check| check.status == "warning") {
        "warning"
    } else {
        "ready"
    };

    SetupReadinessResult {
        overall_status: overall_status.to_string(),
        checks,
        warnings,
    }
}

fn first_non_empty(stdout: &str, stderr: &str) -> String {
    let value = if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    value
        .lines()
        .next()
        .unwrap_or("available")
        .trim()
        .to_string()
}

fn parse_stack_status(stdout: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(stdout).ok()?;
    parsed
        .get("Stacks")?
        .as_array()?
        .first()?
        .get("StackStatus")?
        .as_str()
        .map(str::to_string)
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
fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    let config_path = resolve_app_config_file(Some(&app))?;
    read_app_config_from_path(&config_path)
}

#[tauri::command]
fn save_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let config_path = resolve_app_config_file(Some(&app))?;
    write_app_config_to_path(&config_path, config)
}

#[tauri::command]
fn check_for_updates() -> UpdateCheckResult {
    UpdateCheckResult::default()
}

#[tauri::command]
fn install_update() -> Result<(), String> {
    Err("Signed updater plumbing is not configured yet.".to_string())
}

#[tauri::command]
fn check_setup_readiness(
    app: AppHandle,
    request: SetupReadinessRequest,
) -> Result<SetupReadinessResult, String> {
    let resource_paths = resolve_deployment_resources(Some(&app))?;
    Ok(check_setup_readiness_with_shell(
        &LocalSetupReadinessShell,
        resource_paths,
        request,
    ))
}

#[tauri::command]
fn check_aws_setup_wizard(request: SetupReadinessRequest) -> AwsSetupWizardResult {
    check_aws_setup_wizard_with_shell(&LocalSetupReadinessShell, request)
}

#[tauri::command]
fn preview_deployment_start(request: DeploymentStartRequest) -> DeploymentStartPreview {
    DryRunDeploymentCommandAdapter.preview_start(request)
}

#[tauri::command]
fn create_deployment_start_session(
    state: State<'_, DeploymentSessionStore>,
    request: DeploymentStartRequest,
) -> Result<DeploymentConfirmationSession, String> {
    state.create_session(DeploymentOperation::Start, &request)
}

#[tauri::command]
fn create_deployment_end_session(
    state: State<'_, DeploymentSessionStore>,
    request: DeploymentStartRequest,
) -> Result<DeploymentConfirmationSession, String> {
    state.create_session(DeploymentOperation::End, &request)
}

#[tauri::command]
fn start_deployment(
    app: AppHandle,
    state: State<'_, DeploymentSessionStore>,
    request: DeploymentStartRequest,
    options: DeploymentStartOptions,
) -> Result<DeploymentStartResult, String> {
    state.validate_and_consume(
        DeploymentOperation::Start,
        &request,
        &options.confirmation_token,
    )?;
    let resource_paths = resolve_deployment_resources(Some(&app))?;
    RealDeploymentCommandAdapter::new(LocalProcessDeploymentShell::new(resource_paths))
        .start(request, options)
}

#[tauri::command]
fn end_deployment(
    app: AppHandle,
    state: State<'_, DeploymentSessionStore>,
    request: DeploymentStartRequest,
    options: DeploymentEndOptions,
) -> Result<DeploymentEndResult, String> {
    state.validate_and_consume(
        DeploymentOperation::End,
        &request,
        &options.confirmation_token,
    )?;
    let resource_paths = resolve_deployment_resources(Some(&app))?;
    RealDeploymentCommandAdapter::new(LocalProcessDeploymentShell::new(resource_paths))
        .end(request, options)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::path::Path;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    type MockSetupCommand = (
        &'static str,
        Vec<&'static str>,
        i32,
        &'static str,
        &'static str,
    );

    struct MockSetupReadinessShell {
        responses: RefCell<VecDeque<MockSetupCommand>>,
        commands: RefCell<Vec<(String, Vec<String>)>>,
    }

    impl MockSetupReadinessShell {
        fn new(responses: Vec<MockSetupCommand>) -> Self {
            Self {
                responses: RefCell::new(responses.into()),
                commands: RefCell::new(Vec::new()),
            }
        }
    }

    impl SetupReadinessShell for MockSetupReadinessShell {
        fn run(&self, program: &str, args: &[&str]) -> SetupReadinessCommandResult {
            self.commands.borrow_mut().push((
                program.to_string(),
                args.iter().map(|arg| (*arg).to_string()).collect(),
            ));
            let (expected_program, expected_args, exit_code, stdout, stderr) = self
                .responses
                .borrow_mut()
                .pop_front()
                .expect("mock setup command response");
            assert_eq!(program, expected_program);
            assert_eq!(args, expected_args.as_slice());
            SetupReadinessCommandResult {
                exit_code,
                stdout: stdout.to_string(),
                stderr: stderr.to_string(),
            }
        }
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create test resource parent");
        }
        fs::write(path, content).expect("write test resource");
    }

    fn packaged_resource_root() -> PathBuf {
        static NEXT_RESOURCE_ROOT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "characterforgeai-packaged-resources-{}-{}",
            std::process::id(),
            NEXT_RESOURCE_ROOT.fetch_add(1, Ordering::SeqCst)
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

    fn temp_config_dir() -> PathBuf {
        static NEXT_CONFIG_DIR: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "characterforgeai-config-{}-{}",
            std::process::id(),
            NEXT_CONFIG_DIR.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&root);
        root
    }

    struct MockDeploymentShell {
        commands: Rc<RefCell<Vec<(String, Vec<String>)>>>,
        saved_outputs: Rc<RefCell<Vec<BTreeMap<String, String>>>>,
        cleared_configs: Rc<RefCell<Vec<(String, String)>>>,
        statuses: RefCell<VecDeque<String>>,
        outputs: Vec<(String, String)>,
        retained_resources: Vec<(String, String, String, String)>,
        dependency_failure: Option<(String, String)>,
    }

    impl MockDeploymentShell {
        fn new(statuses: Vec<&str>, outputs: Vec<(&str, &str)>) -> Self {
            Self {
                commands: Rc::new(RefCell::new(Vec::new())),
                saved_outputs: Rc::new(RefCell::new(Vec::new())),
                cleared_configs: Rc::new(RefCell::new(Vec::new())),
                statuses: RefCell::new(statuses.into_iter().map(String::from).collect()),
                outputs: outputs
                    .into_iter()
                    .map(|(key, value)| (key.to_string(), value.to_string()))
                    .collect(),
                retained_resources: Vec::new(),
                dependency_failure: None,
            }
        }

        fn with_retained_resources(mut self, resources: Vec<(&str, &str, &str, &str)>) -> Self {
            self.retained_resources = resources
                .into_iter()
                .map(|(logical_id, resource_type, status, reason)| {
                    (
                        logical_id.to_string(),
                        resource_type.to_string(),
                        status.to_string(),
                        reason.to_string(),
                    )
                })
                .collect();
            self
        }

        fn with_dependency_failure(program: &str, message: &str) -> Self {
            Self {
                dependency_failure: Some((program.to_string(), message.to_string())),
                ..Self::new(vec!["CREATE_COMPLETE"], Vec::new())
            }
        }
    }

    impl DeploymentShellAdapter for MockDeploymentShell {
        fn run(
            &self,
            _request: &DeploymentStartRequest,
            command: &ShellCommand,
        ) -> Result<ShellCommandResult, String> {
            self.commands
                .borrow_mut()
                .push((command.program.clone(), command.args.clone()));
            if command.args == ["--version"] {
                if self
                    .dependency_failure
                    .as_ref()
                    .is_some_and(|(program, _)| program == &command.program)
                {
                    let message = self.dependency_failure.as_ref().unwrap().1.clone();
                    return Ok(ShellCommandResult {
                        exit_code: 127,
                        stdout: String::new(),
                        stderr: message,
                    });
                }
                return Ok(ShellCommandResult {
                    exit_code: 0,
                    stdout: format!("{} test version", command.program),
                    stderr: String::new(),
                });
            }
            if command.program == "aws"
                && command
                    .args
                    .iter()
                    .any(|arg| arg == "describe-stack-resources")
            {
                let resources: Vec<Value> = self
                    .retained_resources
                    .iter()
                    .map(|(logical_id, resource_type, status, reason)| {
                        serde_json::json!({
                            "LogicalResourceId": logical_id,
                            "ResourceType": resource_type,
                            "ResourceStatus": status,
                            "ResourceStatusReason": reason,
                        })
                    })
                    .collect();
                return Ok(ShellCommandResult {
                    exit_code: 0,
                    stdout: serde_json::json!({"StackResources": resources}).to_string(),
                    stderr: String::new(),
                });
            }
            if command.program == "aws" && command.args.iter().any(|arg| arg == "describe-stacks") {
                let status = self
                    .statuses
                    .borrow_mut()
                    .pop_front()
                    .unwrap_or_else(|| "CREATE_COMPLETE".to_string());
                let outputs: Vec<Value> = if status.ends_with("COMPLETE") {
                    self.outputs
                        .iter()
                        .map(|(key, value)| serde_json::json!({"OutputKey": key, "OutputValue": value}))
                        .collect()
                } else {
                    Vec::new()
                };
                return Ok(ShellCommandResult {
                    exit_code: 0,
                    stdout:
                        serde_json::json!({"Stacks":[{"StackStatus": status, "Outputs": outputs}]})
                            .to_string(),
                    stderr: String::new(),
                });
            }
            Ok(ShellCommandResult {
                exit_code: 0,
                stdout: format!("{} ok", command.program),
                stderr: String::new(),
            })
        }

        fn save_outputs(
            &self,
            _stack_name: &str,
            _region: &str,
            outputs: &BTreeMap<String, String>,
        ) -> Result<String, String> {
            self.saved_outputs.borrow_mut().push(outputs.clone());
            Ok("/tmp/characterforge-ai-dev-outputs.json".to_string())
        }

        fn clear_deployment_config(
            &self,
            stack_name: &str,
            region: &str,
        ) -> Result<String, String> {
            self.cleared_configs
                .borrow_mut()
                .push((stack_name.to_string(), region.to_string()));
            Ok(format!("/tmp/{stack_name}-{region}-outputs.json"))
        }
    }

    fn base_deployment_request() -> DeploymentStartRequest {
        DeploymentStartRequest {
            aws_region: "us-east-1".to_string(),
            bedrock_model: "amazon.nova-micro-v1:0".to_string(),
            stack_name: "characterforge-ai-dev".to_string(),
            environment_name: "dev".to_string(),
            credential_mode: "profile".to_string(),
            profile_name: "default".to_string(),
            temporary_credentials: None,
        }
    }

    #[test]
    fn deployment_session_tokens_are_operation_specific_and_one_time() {
        let store = DeploymentSessionStore::default();
        let request = base_deployment_request();
        let session = store
            .create_session(DeploymentOperation::Start, &request)
            .expect("create start session");

        assert_eq!(session.required_confirmation, "START characterforge-ai-dev");
        assert_eq!(session.operation, "start");
        assert!(store
            .validate_and_consume(
                DeploymentOperation::End,
                &request,
                &session.confirmation_token,
            )
            .is_err());
        assert!(store
            .validate_and_consume(
                DeploymentOperation::Start,
                &request,
                &session.confirmation_token,
            )
            .is_err());

        let session = store
            .create_session(DeploymentOperation::Start, &request)
            .expect("create second start session");
        store
            .validate_and_consume(
                DeploymentOperation::Start,
                &request,
                &session.confirmation_token,
            )
            .expect("valid start token");
        assert!(store
            .validate_and_consume(
                DeploymentOperation::Start,
                &request,
                &session.confirmation_token,
            )
            .is_err());
    }

    #[test]
    fn deployment_session_token_must_match_stack_name() {
        let store = DeploymentSessionStore::default();
        let request = base_deployment_request();
        let session = store
            .create_session(DeploymentOperation::End, &request)
            .expect("create end session");
        let mut other_stack = request.clone();
        other_stack.stack_name = "characterforge-other".to_string();

        assert!(store
            .validate_and_consume(
                DeploymentOperation::End,
                &other_stack,
                &session.confirmation_token,
            )
            .is_err());
    }

    #[test]
    fn start_deployment_validates_dependencies_before_sam_commands() {
        let shell = MockDeploymentShell::with_dependency_failure("sam", "SAM CLI missing");
        let commands = Rc::clone(&shell.commands);
        let saved_outputs = Rc::clone(&shell.saved_outputs);
        let adapter = RealDeploymentCommandAdapter::new(shell);

        let result = adapter
            .start(
                base_deployment_request(),
                DeploymentStartOptions {
                    confirmation_text: "START characterforge-ai-dev".to_string(),
                    confirmation_token: "unit-test-token".to_string(),
                },
            )
            .expect("start result");

        assert_eq!(result.status, "failed");
        assert_eq!(result.final_stack_status, "DEPENDENCY_VALIDATION_FAILED");
        assert!(result
            .logs
            .join("\n")
            .contains("Validating local deployment dependencies before Start"));
        assert!(result.logs.join("\n").contains("SAM CLI missing"));
        assert_eq!(
            *commands.borrow(),
            vec![
                ("aws".to_string(), vec!["--version".to_string()]),
                ("sam".to_string(), vec!["--version".to_string()]),
            ]
        );
        assert!(saved_outputs.borrow().is_empty());
    }

    #[test]
    fn start_deployment_polls_stack_redacts_logs_and_saves_non_secret_outputs() {
        let shell = MockDeploymentShell::new(
            vec!["CREATE_COMPLETE"],
            vec![
                (
                    "ApiUrl",
                    "https://mock.execute-api.us-east-1.amazonaws.com/dev",
                ),
                ("ApiKeyValue", "do-not-save-this-secret"),
                ("FunctionName", "characterforge-dev-handler"),
            ],
        );
        let commands = Rc::clone(&shell.commands);
        let saved_outputs = Rc::clone(&shell.saved_outputs);
        let adapter = RealDeploymentCommandAdapter::new(shell);
        let mut request = base_deployment_request();
        request.credential_mode = "temporary".to_string();
        request.profile_name = String::new();
        request.temporary_credentials = Some(TemporaryDeploymentCredentials {
            access_key_id: "TEMPACCESSKEY123456".to_string(),
            secret_access_key: "real-secret-value".to_string(),
            session_token: "real-session-token".to_string(),
        });

        let result = adapter
            .start(
                request,
                DeploymentStartOptions {
                    confirmation_text: "START characterforge-ai-dev".to_string(),
                    confirmation_token: "unit-test-token".to_string(),
                },
            )
            .expect("start result");

        assert_eq!(result.status, "succeeded");
        assert_eq!(result.final_stack_status, "CREATE_COMPLETE");
        assert!(result
            .logs
            .join("\n")
            .contains("AWS_SECRET_ACCESS_KEY=<redacted>"));
        assert!(!result.logs.join("\n").contains("real-secret-value"));
        assert!(!result.logs.join("\n").contains("real-session-token"));
        assert_eq!(commands.borrow()[0].0, "aws");
        assert_eq!(commands.borrow()[0].1, vec!["--version".to_string()]);
        assert_eq!(commands.borrow()[1].0, "sam");
        assert_eq!(commands.borrow()[4].1[0], "deploy");
        assert_eq!(saved_outputs.borrow().len(), 1);
        assert!(saved_outputs.borrow()[0].contains_key("ApiUrl"));
        assert!(saved_outputs.borrow()[0].contains_key("FunctionName"));
        assert!(!saved_outputs.borrow()[0].contains_key("ApiKeyValue"));
    }

    #[test]
    fn end_deployment_reports_retained_resources_and_keeps_config_on_delete_failed() {
        let shell =
            MockDeploymentShell::new(vec!["DELETE_IN_PROGRESS", "DELETE_FAILED"], Vec::new())
                .with_retained_resources(vec![(
                    "CharacterMessagesTable",
                    "AWS::DynamoDB::Table",
                    "DELETE_FAILED",
                    "Table deletion protection is enabled; token real-session-token",
                )]);
        let cleared_configs = Rc::clone(&shell.cleared_configs);
        let saved_outputs = Rc::clone(&shell.saved_outputs);
        let adapter = RealDeploymentCommandAdapter::new(shell);

        let result = adapter
            .end(
                base_deployment_request(),
                DeploymentEndOptions {
                    confirmation_text: "END characterforge-ai-dev".to_string(),
                    export_confirmed: true,
                    cancelled: None,
                    confirmation_token: "unit-test-token".to_string(),
                },
            )
            .expect("end result");

        assert_eq!(result.status, "failed");
        assert_eq!(result.final_stack_status, "DELETE_FAILED");
        let logs = result.logs.join("\n");
        assert!(logs.contains("Retained resources requiring manual cleanup"));
        assert!(logs.contains("CharacterMessagesTable (AWS::DynamoDB::Table) - DELETE_FAILED"));
        assert!(!logs.contains("real-session-token"));
        assert!(logs.contains("Local deployment config was left in place"));
        assert!(cleared_configs.borrow().is_empty());
        assert!(saved_outputs.borrow().is_empty());
    }

    #[test]
    fn end_deployment_clears_local_config_only_after_delete_complete() {
        let shell =
            MockDeploymentShell::new(vec!["DELETE_IN_PROGRESS", "DELETE_COMPLETE"], Vec::new());
        let cleared_configs = Rc::clone(&shell.cleared_configs);
        let adapter = RealDeploymentCommandAdapter::new(shell);

        let result = adapter
            .end(
                base_deployment_request(),
                DeploymentEndOptions {
                    confirmation_text: "END characterforge-ai-dev".to_string(),
                    export_confirmed: true,
                    cancelled: None,
                    confirmation_token: "unit-test-token".to_string(),
                },
            )
            .expect("end result");

        assert_eq!(result.status, "succeeded");
        assert_eq!(result.final_stack_status, "DELETE_COMPLETE");
        assert!(result
            .logs
            .join("\n")
            .contains("Cleared local deployment config"));
        assert_eq!(
            *cleared_configs.borrow(),
            vec![("characterforge-ai-dev".to_string(), "us-east-1".to_string())]
        );
    }

    #[test]
    fn deployment_output_filename_rejects_path_traversal() {
        assert_eq!(
            deployment_output_file_name("characterforge-ai-dev", "us-east-1")
                .expect("safe file name"),
            "characterforge-ai-dev-us-east-1-outputs.json"
        );
        assert!(deployment_output_file_name("../outside", "us-east-1").is_err());
        assert!(deployment_output_file_name("characterforge-ai-dev", "us/east/1").is_err());
        assert!(deployment_output_file_name("characterforge-ai-dev", "..\\evil").is_err());
    }

    #[test]
    fn app_config_defaults_and_persists_to_temp_config_directory() {
        let config_dir = temp_config_dir();
        let config_path = app_config_file_from_dir(&config_dir);

        let default_config = read_app_config_from_path(&config_path).expect("read default config");
        assert!(!default_config.first_run_tutorial_completed);
        assert!(!default_config.first_run_tutorial_skipped);
        assert_eq!(default_config.update_settings.channel, "stable");
        assert_eq!(default_config.update_settings.manifest_url, "");
        assert!(!default_config.update_settings.manual_check_enabled);
        assert!(!default_config.update_settings.unsafe_auto_update_enabled);
        assert_eq!(config_path, config_dir.join("CharacterForgeAI/config.json"));

        let saved_config = AppConfig {
            first_run_tutorial_completed: true,
            first_run_tutorial_skipped: true,
            update_settings: UpdateSettings {
                channel: "beta".to_string(),
                manifest_url: "https://updates.example.test/characterforge/stable.json".to_string(),
                manual_check_enabled: false,
                unsafe_auto_update_enabled: true,
            },
        };
        write_app_config_to_path(&config_path, saved_config.clone()).expect("write config");

        let persisted = read_app_config_from_path(&config_path).expect("read persisted config");
        assert!(persisted.first_run_tutorial_completed);
        assert!(persisted.first_run_tutorial_skipped);
        assert_eq!(persisted.update_settings.channel, "stable");
        assert_eq!(persisted.update_settings.manifest_url, "");
        assert!(!persisted.update_settings.manual_check_enabled);
        assert!(!persisted.update_settings.unsafe_auto_update_enabled);
        let raw = fs::read_to_string(&config_path).expect("read config json");
        assert!(raw.contains("firstRunTutorialCompleted"));
        assert!(raw.contains("firstRunTutorialSkipped"));
        assert!(raw.contains("updateSettings"));
        assert!(raw.contains("unsafeAutoUpdateEnabled"));

        let _ = fs::remove_dir_all(config_dir);
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
    #[test]
    fn aws_setup_wizard_detects_profiles_models_stack_and_redacts_secret_output() {
        let shell = MockSetupReadinessShell::new(vec![
            (
                "aws",
                vec!["configure", "list-profiles"],
                0,
                "default\ngame-dev\nEXAMPLEACCESSKEY123\n",
                "",
            ),
            (
                "aws",
                vec!["configure", "get", "region", "--profile", "game-dev"],
                0,
                "us-west-2\n",
                "",
            ),
            (
                "aws",
                vec![
                    "bedrock",
                    "list-foundation-models",
                    "--region",
                    "us-west-2",
                    "--profile",
                    "game-dev",
                ],
                0,
                r#"{"modelSummaries":[{"modelId":"anthropic.claude-3-haiku-20240307-v1:0"},{"modelId":"amazon.nova-micro-v1:0"}],"AWS_SECRET_ACCESS_KEY":"do-not-leak"}"#,
                "",
            ),
            (
                "aws",
                vec![
                    "cloudformation",
                    "describe-stacks",
                    "--stack-name",
                    "characterforge-demo",
                    "--profile",
                    "game-dev",
                    "--region",
                    "us-west-2",
                ],
                0,
                r#"{"Stacks":[{"StackStatus":"CREATE_COMPLETE"}]}"#,
                "session_token=do-not-leak",
            ),
        ]);

        let result = check_aws_setup_wizard_with_shell(
            &shell,
            SetupReadinessRequest {
                aws_region: "us-west-2".to_string(),
                bedrock_model: "anthropic.claude-3-haiku-20240307-v1:0".to_string(),
                profile_name: "game-dev".to_string(),
                stack_name: "characterforge-demo".to_string(),
            },
        );

        assert_eq!(
            result.profiles,
            vec!["default".to_string(), "game-dev".to_string()]
        );
        assert!(result
            .available_models
            .contains(&"anthropic.claude-3-haiku-20240307-v1:0".to_string()));
        assert!(result.bedrock_access_status.contains("ready"));
        assert_eq!(result.stack_preview.status, "CREATE_COMPLETE");
        let rendered = serde_json::to_string(&result).expect("serialize wizard result");
        assert!(!rendered.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!rendered.contains("do-not-leak"));
        assert!(!rendered.to_lowercase().contains("session_token"));
        assert_eq!(shell.commands.borrow().len(), 4);
    }

    #[test]
    fn setup_readiness_uses_mocked_commands_and_redacts_credential_output() {
        let root = packaged_resource_root();
        let shell = MockSetupReadinessShell::new(vec![
            (
                "where",
                vec!["msedgewebview2.exe"],
                0,
                "C:\\Program Files\\WebView2\\msedgewebview2.exe",
                "",
            ),
            (
                "aws",
                vec!["--version"],
                0,
                "aws-cli/2.15.0 Python/3.11",
                "",
            ),
            ("sam", vec!["--version"], 0, "SAM CLI, version 1.110.0", ""),
            ("docker", vec!["--version"], 0, "Docker version 25.0.0", ""),
            ("docker", vec!["info"], 1, "", "engine stopped"),
            (
                "aws",
                vec!["configure", "list-profiles"],
                0,
                "default\ngame-dev\n",
                "",
            ),
            (
                "aws",
                vec!["configure", "get", "region", "--profile", "game-dev"],
                0,
                "us-west-2\n",
                "",
            ),
            (
                "aws",
                vec![
                    "cloudformation",
                    "describe-stacks",
                    "--stack-name",
                    "characterforge-demo",
                    "--profile",
                    "game-dev",
                    "--region",
                    "us-west-2",
                ],
                255,
                "",
                "ValidationError: Stack with id characterforge-demo does not exist",
            ),
            (
                "aws",
                vec![
                    "bedrock",
                    "list-foundation-models",
                    "--region",
                    "us-west-2",
                    "--profile",
                    "game-dev",
                ],
                0,
                r#"{"modelSummaries":[{"modelId":"anthropic.claude-3-haiku-20240307-v1:0"}]}"#,
                "",
            ),
        ]);
        let result = check_setup_readiness_with_shell(
            &shell,
            DeploymentResourcePaths::from_resource_root(root.clone()).expect("resources"),
            SetupReadinessRequest {
                aws_region: "us-west-2".to_string(),
                bedrock_model: "anthropic.claude-3-haiku-20240307-v1:0".to_string(),
                profile_name: "game-dev".to_string(),
                stack_name: "characterforge-demo".to_string(),
            },
        );

        assert_eq!(result.overall_status, "warning");
        assert!(result
            .checks
            .iter()
            .any(|check| check.label == "WebView2 Runtime" && check.status == "ready"));
        assert!(result
            .checks
            .iter()
            .any(|check| check.label == "Docker" && check.status == "warning"));
        assert!(result
            .checks
            .iter()
            .any(|check| check.label == "Deployment resources" && check.status == "ready"));
        assert!(result
            .checks
            .iter()
            .any(|check| check.label == "AWS profile" && check.detail.contains("game-dev")));
        assert!(result
            .checks
            .iter()
            .any(|check| check.label == "AWS region" && check.detail.contains("us-west-2")));
        assert!(result
            .checks
            .iter()
            .any(|check| check.label == "CloudFormation stack"
                && check.detail.contains("does not exist yet")));
        assert!(result
            .checks
            .iter()
            .any(|check| check.label == "Bedrock model" && check.status == "ready"));
        let rendered = serde_json::to_string(&result).expect("serialize result");
        assert!(!rendered.to_lowercase().contains("secret_access_key"));
        assert!(!rendered.to_lowercase().contains("session_token"));
        assert_eq!(shell.commands.borrow().len(), 9);

        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn character_folder_safety_requires_characterforge_app_data() {
        let safe = PathBuf::from("/tmp/AppData/Roaming/CharacterForgeAI/characters");
        let unsafe_parent = PathBuf::from("/tmp/AppData/Roaming/CharacterForgeAI/../Secrets");
        let unsafe_desktop = PathBuf::from("/tmp/Desktop/characters");

        assert!(is_safe_character_folder_path(&safe));
        assert!(!is_safe_character_folder_path(&unsafe_parent));
        assert!(!is_safe_character_folder_path(&unsafe_desktop));
    }

    #[test]
    fn safe_export_file_names_stay_inside_character_folder() {
        assert_eq!(
            safe_export_file_name("export-pack.json").unwrap(),
            "export-pack.json"
        );
        assert!(safe_export_file_name("../secret.json").is_err());
        assert!(safe_export_file_name("nested/export.json").is_err());
        assert!(safe_export_file_name("export.txt").is_err());
    }

    #[test]
    fn scans_only_valid_local_character_json_files() {
        let root =
            env::temp_dir().join(format!("characterforge-folder-test-{}", std::process::id()));
        let folder = root.join("CharacterForgeAI").join("characters");
        fs::create_dir_all(&folder).unwrap();
        fs::write(
            folder.join("sera.json"),
            r#"{"id":"sera","name":"Sera Folderborn","description":"From disk.","allowed_actions":["wave"],"source":"local","syncStatus":"api_pending","syncError":"queued offline"}"#,
        )
        .unwrap();
        fs::write(folder.join("broken.json"), r#"{"description":"No name"}"#).unwrap();
        fs::write(folder.join("notes.txt"), "ignore me").unwrap();

        let scan = scan_character_folder_path(&folder).unwrap();

        assert_eq!(scan.characters.len(), 1);
        assert_eq!(scan.characters[0].name, "Sera Folderborn");
        assert_eq!(
            scan.characters[0].status,
            "Loaded from local character folder"
        );
        assert_eq!(scan.characters[0].source.as_deref(), Some("local"));
        assert_eq!(
            scan.characters[0].sync_status.as_deref(),
            Some("api_pending")
        );
        assert_eq!(
            scan.characters[0].sync_error.as_deref(),
            Some("queued offline")
        );
        assert_eq!(scan.characters[0].allowed_actions, vec!["wave".to_string()]);
        assert_eq!(scan.invalid_files.len(), 1);
        assert_eq!(scan.invalid_files[0].path, "broken.json");
        assert!(scan.invalid_files[0].error.contains("missing name"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn character_file_names_are_safe_for_sync_writes() {
        let character = serde_json::json!({
            "id": "Local Pending Sora",
            "name": "Pending Sora"
        });
        assert_eq!(
            safe_character_file_name_from_value(&character).unwrap(),
            "local-pending-sora.json"
        );

        let explicit = serde_json::json!({
            "id": "safe",
            "fileName": "safe-character.json"
        });
        assert_eq!(
            safe_character_file_name_from_value(&explicit).unwrap(),
            "safe-character.json"
        );

        let traversal = serde_json::json!({
            "id": "safe",
            "fileName": "../safe-character.json"
        });
        assert!(safe_character_file_name_from_value(&traversal).is_err());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DeploymentSessionStore::default())
        .invoke_handler(tauri::generate_handler![
            get_app_config,
            save_app_config,
            get_character_folder,
            open_character_folder,
            scan_character_folder,
            save_character_pack_export,
            save_character_file,
            delete_character_file,
            check_for_updates,
            install_update,
            check_setup_readiness,
            check_aws_setup_wizard,
            preview_deployment_start,
            create_deployment_start_session,
            start_deployment,
            create_deployment_end_session,
            end_deployment
        ])
        .run(tauri::generate_context!())
        .expect("error while running CharacterForgeAI");
}
