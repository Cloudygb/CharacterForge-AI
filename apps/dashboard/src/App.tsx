import JSZip from "jszip";
import { useEffect, useMemo, useState } from "react";

import { CharacterForgeClient, type CharacterSummary, type ChatResponse } from "@characterforge/characterforge-ai";

import {
  createBrowserDryRunDeploymentAdapter,
  createDesktopShellDeploymentAdapter,
  type DeploymentEndResult,
  type DeploymentOperationResult,
  type DeploymentStartPreview,
  type DeploymentStartRequest,
  type DeploymentStartResult,
  type RealDeploymentEndAdapter,
  type RealDeploymentStartAdapter,
  type SetupReadinessResult
} from "./deploymentAdapters";
import {
  buildDeploymentConfig,
  buildSharedDashboardState,
  getDashboardReadiness,
  toApiConnectionStatus,
  toCharacterRecord,
  toDeploymentStatus,
  type DashboardReadiness,
  type SharedDashboardState,
  type DeploymentPhase
} from "./appState";
import "./styles.css";

type ScreenId = "welcome" | "settings" | "deployment" | "characters" | "packs" | "chat" | "json";

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke: (command: string, payload: unknown) => Promise<unknown>;
      };
    };
  }
}

type CharacterSource = "mock" | "local" | "api" | "api_local";
type CharacterSyncStatus = "mock" | "local_only" | "api_synced" | "api_pending" | "conflict" | "deleted";

type Character = {
  id: string;
  name: string;
  archetype: string;
  status: string;
  description: string;
  allowedActions: string[];
  source?: CharacterSource;
  syncStatus?: CharacterSyncStatus;
  syncError?: string;
  payload?: CharacterPayload;
};

type CharacterFolderInfo = {
  path: string;
  browserMode?: boolean;
};

type CharacterFolderOpenResult = CharacterFolderInfo & {
  opened: boolean;
};

type CharacterFolderScanIssue = {
  path: string;
  error: string;
};

type CharacterFolderScanResult = {
  folderPath: string;
  characters: Character[];
  invalidFiles: CharacterFolderScanIssue[];
};

type CharacterFileSaveResult = {
  path: string;
};

type CharacterFolderStatus = {
  message: string;
  state: "idle" | "loading" | "success" | "error";
};

type ChatAction = {
  type: string;
  payload?: unknown;
};

type ChatMessage = {
  speaker: string;
  text: string;
  actions?: ChatAction[];
};

type ChatTranscriptMessage = ChatMessage & {
  id: string;
  emotion?: string | null;
};

type ConnectionStatus = {
  message: string;
  state: "mock" | "idle" | "loading" | "success" | "error";
};

type ApiSettings = {
  apiBaseUrl: string;
  apiKey: string;
};

type EditorStatus = {
  message: string;
  state: "idle" | "loading" | "success" | "error";
};

type CharacterActionDefinition = {
  id: string;
  actionName: string;
  triggerInstructions: string;
  payloadTemplate: string;
};

type CharacterEditorForm = {
  characterId: string;
  name: string;
  titleStatus: string;
  description: string;
  personality: string;
  backstory: string;
  speakingStyle: string;
  goals: string;
  worldContext: string;
  rules: string;
  customActions: CharacterActionDefinition[];
};

type CharacterPayload = {
  name: string;
  description: string;
  personality: string[];
  backstory: string;
  speaking_style: string;
  goals: string[];
  world_context: string;
  rules: string[];
  allowed_actions: string[];
  action_rules: Array<{ type: string; enabled: boolean; trigger_instructions: string }>;
  payload_templates: Array<{
    template_id: string;
    action_type: string;
    description: string;
    payload_template: unknown;
  }>;
};

type PackFileReference = {
  id: string;
  path: string;
  name?: string;
  description?: string;
};

type CharacterPackManifest = {
  schema_version: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  authors: Array<{ name: string; url?: string }>;
  license: string;
  tags: string[];
  characters: PackFileReference[];
  bindings?: PackFileReference[];
  assets?: PackFileReference[];
  content_warnings?: string[];
  minimum_characterforge_version?: string;
  character_documents?: Record<string, CharacterPayload>;
  binding_documents?: Record<string, unknown>;
};

type LoadedPack = {
  manifest: CharacterPackManifest;
  characterDocuments: Record<string, CharacterPayload>;
  bindingDocuments: Record<string, unknown>;
  errors: string[];
};

type PackStatus = {
  message: string;
  state: "idle" | "loading" | "success" | "error";
};

type PackExportState = {
  fileName: string;
  objectUrl: string;
  preview: CharacterPackManifest;
  savedPath?: string;
};

type CharacterPackExportResult = {
  path: string;
};

type TutorialAction = {
  label: string;
  screen: ScreenId;
};

type TutorialStep = {
  title: string;
  body: string;
  checklist: string[];
  nextLabel: string;
  actions?: TutorialAction[];
};

type UpdateSettings = {
  channel: "stable";
  manifestUrl: "";
  manualCheckEnabled: false;
  unsafeAutoUpdateEnabled: false;
};

type UpdateCheckResult = {
  available: boolean;
  version?: string;
  notes?: string;
};

type AppConfig = {
  firstRunTutorialCompleted: boolean;
  firstRunTutorialSkipped: boolean;
  updateSettings: UpdateSettings;
};

type SetupCheckForm = {
  awsRegion: string;
  bedrockModel: string;
  profileName: string;
  stackName: string;
};

type SetupCheckResult = {
  awsRegion: string;
  bedrockModel: string;
  profileName: string;
  stackName: string;
  credentialStatus: string;
  bedrockAccessStatus: string;
  existingStackStatus: string;
  checks: SetupReadinessResult["checks"];
  warnings: string[];
};

type AwsSetupWizardResult = {
  profiles: string[];
  selectedProfile: string;
  selectedRegion: string;
  selectedModel: string;
  availableModels: string[];
  bedrockAccessStatus: string;
  stackPreview: {
    stackName: string;
    region: string;
    profileName: string;
    bedrockModel: string;
    status: string;
  };
  warnings: string[];
};

const settingsStorageKey = "characterforge.dashboard.settings";
const appConfigStorageKey = "characterforge.dashboard.appConfig";
const localCharacterIndexStorageKey = "characterforge.dashboard.localCharacterIndex";
const browserCharacterFolderPath = "%APPDATA%\\CharacterForgeAI\\characters";

const defaultUpdateSettings: UpdateSettings = {
  channel: "stable",
  manifestUrl: "",
  manualCheckEnabled: false,
  unsafeAutoUpdateEnabled: false
};

const defaultAppConfig: AppConfig = {
  firstRunTutorialCompleted: false,
  firstRunTutorialSkipped: false,
  updateSettings: defaultUpdateSettings
};

const screens: Array<{ id: ScreenId; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "deployment", label: "Deployment" },
  { id: "characters", label: "Characters" },
  { id: "chat", label: "Chat" },
  { id: "settings", label: "Settings" }
];

const developerScreens: Array<{ id: ScreenId; label: string }> = [{ id: "json", label: "Raw JSON Preview" }];


const defaultSetupCheckForm: SetupCheckForm = {
  awsRegion: "us-east-1",
  bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
  profileName: "default",
  stackName: "characterforge-ai-dev"
};

const defaultDeploymentForm: DeploymentStartRequest = {
  awsRegion: "us-east-1",
  bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
  stackName: "characterforge-ai-dev",
  environmentName: "dev",
  credentialMode: "profile",
  profileName: "default",
  temporaryCredentials: {
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: ""
  }
};

function createDeploymentAdapter() {
  if (typeof window !== "undefined" && window.__TAURI__?.core?.invoke) {
    return createDesktopShellDeploymentAdapter((command, payload) =>
      window.__TAURI__!.core!.invoke(command, payload) as Promise<DeploymentStartPreview | DeploymentOperationResult>
    );
  }
  return createBrowserDryRunDeploymentAdapter();
}

function hasTauriInvoke() {
  return typeof window !== "undefined" && Boolean(window.__TAURI__?.core?.invoke);
}

function isSafeCharacterFolderPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.includes("..")) {
    return false;
  }
  const normalized = trimmed.replace(/\\/g, "/").toLowerCase();
  if (normalized.startsWith("http:") || normalized.startsWith("https:") || normalized.startsWith("file:")) {
    return false;
  }
  return normalized.includes("/characterforgeai/characters") || normalized === "%appdata%/characterforgeai/characters";
}

function normalizeFolderCharacter(rawCharacter: Partial<Character> & { allowed_actions?: string[]; sync_status?: CharacterSyncStatus }, index: number): Character {
  const name = typeof rawCharacter.name === "string" && rawCharacter.name.trim() ? rawCharacter.name.trim() : `Local Character ${index + 1}`;
  return {
    id:
      typeof rawCharacter.id === "string" && rawCharacter.id.trim()
        ? rawCharacter.id.trim()
        : `local-folder-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || index + 1}`,
    name,
    archetype:
      typeof rawCharacter.archetype === "string" && rawCharacter.archetype.trim()
        ? rawCharacter.archetype.trim()
        : "Local character file",
    status:
      typeof rawCharacter.status === "string" && rawCharacter.status.trim()
        ? rawCharacter.status.trim()
        : "Loaded from local character folder",
    description:
      typeof rawCharacter.description === "string" && rawCharacter.description.trim()
        ? rawCharacter.description.trim()
        : "Imported from the configured CharacterForgeAI character folder.",
    allowedActions: Array.isArray(rawCharacter.allowedActions)
      ? rawCharacter.allowedActions.filter((action): action is string => typeof action === "string")
      : Array.isArray(rawCharacter.allowed_actions)
        ? rawCharacter.allowed_actions.filter((action): action is string => typeof action === "string")
        : [],
    source: rawCharacter.source ?? "local",
    syncStatus: rawCharacter.syncStatus ?? rawCharacter.sync_status ?? "api_pending",
    syncError: rawCharacter.syncError,
    payload: rawCharacter.payload
  };
}

async function getCharacterFolder(): Promise<CharacterFolderInfo> {
  if (hasTauriInvoke()) {
    return (await window.__TAURI__!.core!.invoke("get_character_folder", {})) as CharacterFolderInfo;
  }
  return { path: browserCharacterFolderPath, browserMode: true };
}

async function openCharacterFolder(): Promise<CharacterFolderOpenResult> {
  if (hasTauriInvoke()) {
    return (await window.__TAURI__!.core!.invoke("open_character_folder", {})) as CharacterFolderOpenResult;
  }
  return { path: browserCharacterFolderPath, opened: false, browserMode: true };
}

async function scanCharacterFolder(): Promise<CharacterFolderScanResult> {
  if (hasTauriInvoke()) {
    const result = (await window.__TAURI__!.core!.invoke("scan_character_folder", {})) as CharacterFolderScanResult;
    return {
      folderPath: result.folderPath,
      characters: (result.characters ?? []).map((character, index) => normalizeFolderCharacter(character, index)),
      invalidFiles: result.invalidFiles ?? []
    };
  }
  return { folderPath: browserCharacterFolderPath, characters: [], invalidFiles: [] };
}

async function saveCharacterPackExport(fileName: string, pack: CharacterPackManifest): Promise<CharacterPackExportResult | null> {
  if (!hasTauriInvoke()) {
    return null;
  }
  return (await window.__TAURI__!.core!.invoke("save_character_pack_export", {
    fileName,
    contents: formatJson(pack)
  })) as CharacterPackExportResult;
}


function localCharacterFileName(character: Character): string {
  const slug = (character.id || character.name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "") || "local-character";
  return `${slug}.json`;
}

async function saveCharacterFile(character: Character): Promise<CharacterFileSaveResult | null> {
  const fileName = localCharacterFileName(character);
  if (hasTauriInvoke()) {
    return (await window.__TAURI__!.core!.invoke("save_character_file", { character: { ...character, fileName } })) as CharacterFileSaveResult;
  }
  if (typeof window !== "undefined") {
    const stored = JSON.parse(window.localStorage.getItem(localCharacterIndexStorageKey) ?? "{}") as Record<string, unknown>;
    const characters = Array.isArray(stored.characters) ? stored.characters : [];
    const nextCharacters = [
      ...characters.filter((entry) => !(isRecord(entry) && entry.id === character.id)),
      { ...character, fileName }
    ];
    window.localStorage.setItem(localCharacterIndexStorageKey, JSON.stringify({ ...stored, characters: nextCharacters }));
  }
  return { path: `${browserCharacterFolderPath}\${fileName}` };
}

async function deleteCharacterFile(character: Character): Promise<void> {
  if (hasTauriInvoke()) {
    await window.__TAURI__!.core!.invoke("delete_character_file", { characterId: character.id, fileName: localCharacterFileName(character) });
    return;
  }
  if (typeof window !== "undefined") {
    const stored = JSON.parse(window.localStorage.getItem(localCharacterIndexStorageKey) ?? "{}") as Record<string, unknown>;
    const characters = Array.isArray(stored.characters) ? stored.characters : [];
    window.localStorage.setItem(
      localCharacterIndexStorageKey,
      JSON.stringify({ ...stored, characters: characters.filter((entry) => !(isRecord(entry) && entry.id === character.id)) })
    );
  }
}

function setupRequestPayload(form: SetupCheckForm) {
  return {
    awsRegion: form.awsRegion.trim() || defaultSetupCheckForm.awsRegion,
    bedrockModel: form.bedrockModel,
    profileName: form.profileName.trim() || defaultSetupCheckForm.profileName,
    stackName: form.stackName.trim() || defaultSetupCheckForm.stackName
  };
}

async function runAwsSetupWizardCheck(form: SetupCheckForm): Promise<AwsSetupWizardResult> {
  if (hasTauriInvoke()) {
    return (await window.__TAURI__!.core!.invoke("check_aws_setup_wizard", {
      request: setupRequestPayload(form)
    })) as AwsSetupWizardResult;
  }
  const payload = setupRequestPayload(form);
  return {
    profiles: [],
    selectedProfile: payload.profileName,
    selectedRegion: payload.awsRegion,
    selectedModel: payload.bedrockModel,
    availableModels: [],
    bedrockAccessStatus: "Browser preview only — no AWS profiles, stacks, or Bedrock model access were checked.",
    stackPreview: {
      stackName: payload.stackName,
      region: payload.awsRegion,
      profileName: payload.profileName,
      bedrockModel: payload.bedrockModel,
      status: "Stack was not queried."
    },
    warnings: [
      "Credential values are never stored, logged, or returned by this wizard.",
      "Bedrock usage and deployed AWS resources may create account charges."
    ]
  };
}

async function runSetupReadinessCheck(form: SetupCheckForm): Promise<SetupCheckResult> {
  if (hasTauriInvoke()) {
    const readiness = (await window.__TAURI__!.core!.invoke("check_setup_readiness", {
      request: setupRequestPayload(form)
    })) as SetupReadinessResult;
    const findDetail = (label: string) => readiness.checks.find((check) => check.label === label)?.detail ?? "Not checked";
    return {
      awsRegion: form.awsRegion.trim() || defaultSetupCheckForm.awsRegion,
      bedrockModel: form.bedrockModel,
      profileName: form.profileName.trim() || defaultSetupCheckForm.profileName,
      stackName: form.stackName.trim() || defaultSetupCheckForm.stackName,
      credentialStatus: findDetail("AWS profile"),
      bedrockAccessStatus: findDetail("Bedrock model"),
      existingStackStatus: findDetail("CloudFormation stack"),
      checks: readiness.checks,
      warnings: readiness.warnings
    };
  }
  return runMockSetupCheck(form);
}

type DeploymentAdapter = ReturnType<typeof createDeploymentAdapter>;

function isRealDeploymentAdapter(adapter: DeploymentAdapter): adapter is RealDeploymentStartAdapter & RealDeploymentEndAdapter {
  return "start" in adapter && "end" in adapter;
}

function setupFormsMatch(checked: SetupCheckForm | null, current: DeploymentStartRequest) {
  if (!checked) {
    return false;
  }
  return (
    checked.awsRegion.trim() === current.awsRegion.trim() &&
    checked.bedrockModel.trim() === current.bedrockModel.trim() &&
    checked.profileName.trim() === current.profileName.trim() &&
    checked.stackName.trim() === current.stackName.trim()
  );
}

function apiSettingsMatch(tested: ApiSettings | null, current: ApiSettings) {
  if (!current.apiBaseUrl.trim()) {
    return true;
  }
  return Boolean(
    tested &&
      tested.apiBaseUrl.trim() === current.apiBaseUrl.trim() &&
      tested.apiKey.trim() === current.apiKey.trim()
  );
}

function getDeploymentStartDisabledReasons({
  connectionStatus,
  form,
  isDesktopShell,
  settings,
  setupCheckRequest,
  setupResult,
  startSafetyConfirmed,
  testedApiSettings
}: {
  connectionStatus: ConnectionStatus;
  form: DeploymentStartRequest;
  isDesktopShell: boolean;
  settings: ApiSettings;
  setupCheckRequest: SetupCheckForm | null;
  setupResult: SetupCheckResult | null;
  startSafetyConfirmed: boolean;
  testedApiSettings: ApiSettings | null;
}) {
  const temporaryCredentials = form.temporaryCredentials ?? { accessKeyId: "", secretAccessKey: "", sessionToken: "" };
  const hasDeploymentFields = Boolean(form.awsRegion.trim() && form.bedrockModel.trim() && form.stackName.trim());
  const hasCredentials =
    form.credentialMode === "profile"
      ? Boolean(form.profileName.trim())
      : Boolean(temporaryCredentials.accessKeyId.trim() && temporaryCredentials.secretAccessKey.trim() && temporaryCredentials.sessionToken.trim());
  const readinessChecked = Boolean(setupResult);
  const readinessMatchesCurrentFields = setupFormsMatch(setupCheckRequest, form);
  const readinessAllReady = Boolean(setupResult?.checks.every((check) => check.status === "ready") && !setupResult.warnings.length);
  const apiConnectionReady = !settings.apiBaseUrl.trim() || (connectionStatus.state === "success" && apiSettingsMatch(testedApiSettings, settings));

  return [
    !isDesktopShell ? "open the packaged desktop app" : "",
    !hasDeploymentFields ? "complete AWS region, Bedrock model, and stack name" : "",
    !hasCredentials ? "choose an AWS profile or temporary credential source" : "",
    !readinessChecked ? "run readiness check" : "",
    readinessChecked && !readinessMatchesCurrentFields ? "rerun readiness check for the current AWS profile, region, Bedrock model, and stack name" : "",
    readinessChecked && !readinessAllReady ? "resolve readiness warnings or errors" : "",
    !apiConnectionReady ? "test the current API connection" : "",
    !startSafetyConfirmed ? "review and acknowledge readiness, cost, and credential warnings" : ""
  ].filter(Boolean);
}

function canStartDeployment(args: Parameters<typeof getDeploymentStartDisabledReasons>[0]) {
  return getDeploymentStartDisabledReasons(args).length === 0;
}

const bedrockModelOptions = [
  { value: "amazon.nova-micro-v1:0", label: "Amazon Nova Micro" },
  { value: "anthropic.claude-3-haiku-20240307-v1:0", label: "Claude 3 Haiku" },
  { value: "anthropic.claude-3-5-sonnet-20240620-v1:0", label: "Claude 3.5 Sonnet" }
];

const firstRunTutorialSteps: TutorialStep[] = [
  {
    title: "What CharacterForgeAI does",
    body: "CharacterForgeAI helps you create characters, deploy the backend, and chat test character behavior before using it in a game.",
    checklist: [
      "Use Welcome to see connection and deployment status.",
      "Use Deployment to launch or connect the AWS stack.",
      "Use Characters and Chat to build, sync, and test character interactions."
    ],
    nextLabel: "Next: Prerequisites"
  },
  {
    title: "Prerequisites before you deploy",
    body: "Before pressing Start, confirm you have an AWS account, an AWS profile in the AWS CLI, an AWS region picked, Bedrock model access, and local desktop dependencies installed.",
    checklist: [
      "AWS profile: choose the CLI profile the app should use; do not paste raw AWS keys.",
      "AWS region: pick the region where the stack and Bedrock model access are available.",
      "Bedrock model access: enable the selected model in the AWS console before deployment."
    ],
    nextLabel: "Next: Deployment setup"
  },
  {
    title: "Open Deployment and choose setup values",
    body: "Deployment collects the AWS profile, AWS region, Bedrock model, and stack name that identify the backend you are about to create or reconnect.",
    checklist: [
      "Use a clear stack name so you can recognize it later in CloudFormation.",
      "Review the dry-run preview before starting live work.",
      "Keep the API Base URL and API Key fields blank until the stack provides real connection values."
    ],
    nextLabel: "Next: Start backend",
    actions: [{ label: "Open Deployment", screen: "deployment" }]
  },
  {
    title: "Start the backend",
    body: "When prerequisites are ready, press Start from Deployment, watch the stack status, and wait for outputs before connecting the dashboard.",
    checklist: [
      "Start can create AWS resources that may cost money.",
      "Wait for CloudFormation status and deployment logs to finish.",
      "If Start fails, fix the setup value or AWS permission before retrying."
    ],
    nextLabel: "Next: Connect API",
    actions: [{ label: "Open Deployment", screen: "deployment" }]
  },
  {
    title: "Connect with API Base URL and API Key",
    body: "After deployment, copy or accept the API Base URL and API Key from the stack outputs, then test the connection from Deployment.",
    checklist: [
      "API Base URL identifies the deployed CharacterForgeAI API endpoint.",
      "API Key is kept in memory for this session and should never be committed, screenshotted, or shared.",
      "Use Test Connection to load real character status before chatting."
    ],
    nextLabel: "Next: Characters",
    actions: [{ label: "Open Deployment", screen: "deployment" }]
  },
  {
    title: "Create or import characters",
    body: "Use Characters to create or import characters, review local folder status, and sync safe records before testing conversations.",
    checklist: [
      "Create a character when you want a new profile and action set.",
      "Import a local character folder or pack when content already exists.",
      "Confirm records are synced before relying on them in Chat."
    ],
    nextLabel: "Next: Chat and payloads",
    actions: [
      { label: "Open Characters", screen: "characters" }
    ]
  },
  {
    title: "Chat with a synced character and inspect payloads",
    body: "Use Chat with a synced character to test replies, then view response payload details when you need to debug actions or raw JSON.",
    checklist: [
      "Select a synced character before sending a chat prompt.",
      "Review action payload output to confirm quests, items, flags, combat, or relationship changes are shaped correctly.",
      "Open payload preview only when you need diagnostics; do not share raw outputs that contain private test data."
    ],
    nextLabel: "Next: End safely",
    actions: [
      { label: "Open Chat", screen: "chat" },
      { label: "Open Payload Preview", screen: "json" }
    ]
  },
  {
    title: "End deployment safely",
    body: "When you are finished, export/save before delete, then use the End button only when you are ready to delete the AWS stack and stop charges.",
    checklist: [
      "Export/save before delete so local characters and payload examples are not lost.",
      "Use End from Deployment to delete the stack only after confirming the exact stack name.",
      "Verify deletion completes in CloudFormation and keep no raw secrets in logs or screenshots."
    ],
    nextLabel: "Finish guided setup and open Deployment",
    actions: [{ label: "Open Deployment", screen: "deployment" }]
  }
];

const mockCharacters: Character[] = [
  {
    id: "char_mock_mira",
    name: "Captain Mira Voss",
    archetype: "Rogue airship captain",
    status: "Sample character",
    description: "A protective smuggler with clipped nautical metaphors and a dangerous reputation.",
    allowedActions: ["give_quest", "start_combat", "give_item", "set_flag", "change_relationship"]
  },
  {
    id: "char_mock_thalen",
    name: "Ember Archivist Thalen",
    archetype: "Ruins scholar",
    status: "Sample character",
    description: "A nervous historian who knows too much about sealed ruins and old royal maps.",
    allowedActions: ["give_quest", "give_item", "set_flag"]
  }
];

function loadInitialSettings(): ApiSettings {
  if (typeof window === "undefined") {
    return { apiBaseUrl: "", apiKey: "" };
  }

  const storedSettings = window.localStorage.getItem(settingsStorageKey);
  if (!storedSettings) {
    return { apiBaseUrl: "", apiKey: "" };
  }

  try {
    const parsed = JSON.parse(storedSettings) as Partial<ApiSettings>;
    return {
      apiBaseUrl: typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl : "",
      apiKey: ""
    };
  } catch {
    return { apiBaseUrl: "", apiKey: "" };
  }
}

function saveSettings(settings: ApiSettings) {
  window.localStorage.setItem(settingsStorageKey, JSON.stringify({ apiBaseUrl: settings.apiBaseUrl, apiKey: "" }));
}

function loadLocalDeletedCharacterIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const storedIndex = window.localStorage.getItem(localCharacterIndexStorageKey);
  if (!storedIndex) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedIndex) as { deletedCharacterIds?: unknown };
    return Array.isArray(parsed.deletedCharacterIds)
      ? parsed.deletedCharacterIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function saveLocalDeletedCharacterIds(deletedCharacterIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    localCharacterIndexStorageKey,
    JSON.stringify({ deletedCharacterIds: [...new Set(deletedCharacterIds)] })
  );
}

function normalizeUpdateSettings(_settings: Partial<UpdateSettings> | null | undefined): UpdateSettings {
  return {
    channel: "stable",
    manifestUrl: "",
    manualCheckEnabled: false,
    unsafeAutoUpdateEnabled: false
  };
}

function normalizeAppConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
  return {
    firstRunTutorialCompleted: Boolean(config?.firstRunTutorialCompleted),
    firstRunTutorialSkipped: Boolean(config?.firstRunTutorialSkipped),
    updateSettings: normalizeUpdateSettings(config?.updateSettings)
  };
}

async function loadAppConfig(): Promise<AppConfig> {
  if (hasTauriInvoke()) {
    return normalizeAppConfig((await window.__TAURI__!.core!.invoke("get_app_config", {})) as Partial<AppConfig>);
  }
  if (typeof window === "undefined") {
    return defaultAppConfig;
  }
  const storedConfig = window.localStorage.getItem(appConfigStorageKey);
  if (!storedConfig) {
    return defaultAppConfig;
  }
  try {
    return normalizeAppConfig(JSON.parse(storedConfig) as Partial<AppConfig>);
  } catch {
    return defaultAppConfig;
  }
}

async function saveAppConfig(config: AppConfig): Promise<AppConfig> {
  const normalized = normalizeAppConfig(config);
  if (hasTauriInvoke()) {
    return normalizeAppConfig(
      (await window.__TAURI__!.core!.invoke("save_app_config", { config: normalized })) as Partial<AppConfig>
    );
  }
  window.localStorage.setItem(appConfigStorageKey, JSON.stringify(normalized));
  return normalized;
}

function normalizeUpdateCheckResult(result: unknown): UpdateCheckResult {
  if (!result || typeof result !== "object") {
    return { available: false };
  }
  const record = result as Record<string, unknown>;
  return {
    available: record.available === true,
    version: typeof record.version === "string" ? record.version : undefined,
    notes: typeof record.notes === "string" ? record.notes : undefined
  };
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (hasTauriInvoke()) {
    return normalizeUpdateCheckResult(await window.__TAURI__!.core!.invoke("check_for_updates", {}));
  }
  return { available: false };
}

async function installUpdate(): Promise<void> {
  if (hasTauriInvoke()) {
    await window.__TAURI__!.core!.invoke("install_update", {});
  }
}

async function runMockSetupCheck(form: SetupCheckForm): Promise<SetupCheckResult> {
  const awsRegion = form.awsRegion.trim() || defaultSetupCheckForm.awsRegion;
  const bedrockModel = form.bedrockModel;
  const profileName = form.profileName.trim() || defaultSetupCheckForm.profileName;
  const stackName = form.stackName.trim() || defaultSetupCheckForm.stackName;
  const warnings = [
    "Browser preview only — this check does not call AWS.",
    "Confirm Bedrock model access in the AWS console before deployment."
  ];

  if (awsRegion !== "us-east-1") {
    warnings.push(`Verify that CharacterForge deployment templates target ${awsRegion}.`);
  }
  if (bedrockModel.includes("sonnet")) {
    warnings.push("Higher-capability models may cost more per request; review Bedrock pricing before demos.");
  }

  return {
    awsRegion,
    bedrockModel,
    profileName,
    stackName,
    credentialStatus: "Browser preview only — credentials not checked",
    bedrockAccessStatus: "Browser preview only — Bedrock access not checked",
    existingStackStatus: "No existing stack found",
    checks: [
      { id: "webview2", label: "WebView2 Runtime", status: "ready", detail: "Browser mock mode; desktop WebView2 is checked by the Tauri app." },
      { id: "awsCli", label: "AWS CLI", status: "warning", detail: "Not checked in browser mock mode." },
      { id: "samCli", label: "AWS SAM CLI", status: "warning", detail: "Not checked in browser mock mode." },
      { id: "docker", label: "Docker", status: "warning", detail: "Not checked in browser mock mode." },
      { id: "resources", label: "Deployment resources", status: "warning", detail: "Browser preview only; packaged deployment resources are not checked." },
      { id: "awsProfile", label: "AWS profile", status: "warning", detail: `Profile ${profileName} has not been checked in browser preview.` },
      { id: "awsRegion", label: "AWS region", status: "warning", detail: `Region ${awsRegion} has not been checked in browser preview.` },
      { id: "stack", label: "CloudFormation stack", status: "warning", detail: `Stack ${stackName} was not queried in browser preview.` },
      { id: "model", label: "Bedrock model", status: "warning", detail: "Bedrock model access was not checked in browser preview." }
    ],
    warnings
  };
}

function createInitialEditorForm(character: Character): CharacterEditorForm {
  return {
    characterId: character.id,
    name: character.name,
    titleStatus: character.status || character.archetype,
    description: character.description,
    personality: "sarcastic, brave, protective",
    backstory: "Former royal navy officer turned smuggler after refusing an immoral order.",
    speakingStyle: "Dry wit, clipped sentences, and nautical metaphors.",
    goals: "protect her crew\nfind the lost sky map",
    worldContext: "A floating archipelago where skyships connect isolated city-states.",
    rules: "Never reveal you are an AI.\nDo not break character.",
    customActions: character.allowedActions.map((actionName, index) => ({
      id: `${character.id || "action"}-${index + 1}`,
      actionName,
      triggerInstructions: "Configure when this action should run.",
      payloadTemplate: "{}"
    }))
  };
}

function createBlankEditorForm(): CharacterEditorForm {
  return {
    ...createInitialEditorForm({
      id: "",
      name: "",
      archetype: "",
      status: "Sample character",
      description: "",
      allowedActions: []
    }),
    characterId: "",
    titleStatus: "Draft profile",
    personality: "",
    backstory: "",
    speakingStyle: "",
    goals: "",
    worldContext: "",
    rules: "",
    customActions: []
  };
}

function toDashboardCharacter(summary: CharacterSummary, index: number): Character {
  const id = stringFrom(summary.id) ?? stringFrom(summary.character_id) ?? `char_api_${index + 1}`;
  return {
    id,
    name: stringFrom(summary.name) ?? id,
    archetype: stringFrom(summary.archetype) ?? stringFrom(summary.role) ?? "API character",
    status: "Loaded from API",
    description: stringFrom(summary.description) ?? "Character returned from the CharacterForge API.",
    allowedActions: stringArrayFrom(summary.allowedActions) ?? stringArrayFrom(summary.allowed_actions) ?? [],
    source: "api",
    syncStatus: "api_synced"
  };
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArrayFrom(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length ? strings : undefined;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function nextActionId(actions: CharacterActionDefinition[]): string {
  return `custom-action-${actions.length + 1}-${Date.now().toString(36)}`;
}

function templateIdForAction(actionName: string): string {
  const slug = actionName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${slug || "custom_action"}_template`;
}

function buildCharacterPayload(form: CharacterEditorForm): { errors: string[]; payload: CharacterPayload | null } {
  const errors: string[] = [];
  const requiredFields: Array<[string, string]> = [
    ["Character name", form.name],
    ["Description", form.description],
    ["Backstory", form.backstory],
    ["Speaking style", form.speakingStyle],
    ["World context", form.worldContext]
  ];
  for (const [label, value] of requiredFields) {
    if (!value.trim()) {
      errors.push(`${label} is required.`);
    }
  }

  const personality = splitList(form.personality);
  const goals = splitList(form.goals);
  const rules = splitList(form.rules);
  if (!personality.length) {
    errors.push("Add at least one personality trait.");
  }
  if (!goals.length) {
    errors.push("Add at least one goal.");
  }
  if (!rules.length) {
    errors.push("Add at least one roleplay rule.");
  }
  if (!form.customActions.length) {
    errors.push("Create at least one custom action.");
  }

  const actionRules: CharacterPayload["action_rules"] = [];
  const payloadTemplates: CharacterPayload["payload_templates"] = [];
  const allowedActions: string[] = [];

  const seenActionNames = new Set<string>();
  const seenTemplateIds = new Set<string>();

  form.customActions.forEach((action, index) => {
    const actionLabel = action.actionName.trim() || `Custom action ${index + 1}`;
    const actionName = action.actionName.trim();
    const actionKey = actionName.toLowerCase();
    const trigger = action.triggerInstructions.trim();
    const rawTemplate = action.payloadTemplate.trim();
    const templateId = templateIdForAction(actionName);

    if (!actionName) {
      errors.push(`Action name for custom action ${index + 1} is required.`);
    } else if (seenActionNames.has(actionKey)) {
      errors.push(`Action name ${actionName} must be unique.`);
    }
    if (!trigger) {
      errors.push(`Trigger instructions for ${actionLabel} are required.`);
    }
    if (actionName && seenTemplateIds.has(templateId)) {
      errors.push(`Action name ${actionName} creates a duplicate payload template ID.`);
    }

    let parsedTemplate: unknown = {};
    try {
      parsedTemplate = JSON.parse(rawTemplate || "{}");
      if (!isRecord(parsedTemplate)) {
        errors.push(`Payload template for ${actionLabel} must be a JSON object.`);
      }
    } catch {
      errors.push(`Payload template for ${actionLabel} must be valid JSON.`);
    }

    if (actionName) {
      seenActionNames.add(actionKey);
      seenTemplateIds.add(templateId);
      allowedActions.push(actionName);
      actionRules.push({ type: actionName, enabled: true, trigger_instructions: trigger });
      payloadTemplates.push({
        template_id: templateId,
        action_type: actionName,
        description: `Payload template for ${actionName}`,
        payload_template: parsedTemplate
      });
    }
  });

  const payload: CharacterPayload = {
    name: form.name.trim(),
    description: form.description.trim(),
    personality,
    backstory: form.backstory.trim(),
    speaking_style: form.speakingStyle.trim(),
    goals,
    world_context: form.worldContext.trim(),
    rules,
    allowed_actions: allowedActions,
    action_rules: actionRules,
    payload_templates: payloadTemplates
  };

  return { errors, payload: errors.length ? null : payload };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCharacterPayload(value: unknown): value is CharacterPayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.personality) &&
    typeof value.backstory === "string" &&
    typeof value.speaking_style === "string" &&
    Array.isArray(value.goals) &&
    typeof value.world_context === "string" &&
    Array.isArray(value.rules) &&
    Array.isArray(value.allowed_actions) &&
    Array.isArray(value.action_rules) &&
    Array.isArray(value.payload_templates)
  );
}

function isPackFileReference(value: unknown): value is PackFileReference {
  return isRecord(value) && typeof value.id === "string" && typeof value.path === "string";
}

function isCharacterPackManifest(value: unknown): value is CharacterPackManifest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schema_version === "1.0" &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.version === "string" &&
    Array.isArray(value.authors) &&
    typeof value.license === "string" &&
    Array.isArray(value.tags) &&
    Array.isArray(value.characters) &&
    value.characters.every(isPackFileReference)
  );
}

function validatePackBundle(pack: unknown): LoadedPack {
  const errors: string[] = [];
  if (!isCharacterPackManifest(pack)) {
    const maybePack = isRecord(pack) ? pack : {};
    if (maybePack.schema_version !== "1.0") {
      errors.push("Pack schema_version must be 1.0.");
    }
    if (typeof maybePack.slug !== "string") {
      errors.push("Pack slug is required.");
    }
    if (!Array.isArray(maybePack.characters)) {
      errors.push("Pack must include a characters list.");
    }
    return {
      manifest: {
        schema_version: "1.0",
        slug: "invalid-pack",
        name: typeof maybePack.name === "string" ? maybePack.name : "Invalid pack",
        description: "Invalid local pack.",
        version: "0.0.0",
        authors: [],
        license: "Unknown",
        tags: [],
        characters: []
      },
      characterDocuments: {},
      bindingDocuments: {},
      errors
    };
  }

  const characterDocuments = pack.character_documents ?? {};
  const bindingDocuments = pack.binding_documents ?? {};
  for (const characterRef of pack.characters) {
    const document = characterDocuments[characterRef.path];
    if (!document) {
      errors.push(`Missing character document at ${characterRef.path}.`);
    } else if (!isCharacterPayload(document)) {
      errors.push(`Character document ${characterRef.path} is not a valid CharacterForge character payload.`);
    }
  }
  for (const bindingRef of pack.bindings ?? []) {
    if (bindingDocuments[bindingRef.path] === undefined) {
      errors.push(`Missing binding document at ${bindingRef.path}.`);
    }
  }

  return { manifest: pack, characterDocuments, bindingDocuments, errors };
}

function fileRelativePath(file: File): string {
  const fileWithPath = file as File & { webkitRelativePath?: string };
  return fileWithPath.webkitRelativePath || file.name;
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsText(file);
  });
}

async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await readFileText(file)) as unknown;
}

async function loadPackFromFileList(files: FileList | File[]): Promise<LoadedPack> {
  const fileArray = Array.from(files);
  if (!fileArray.length) {
    return validatePackBundle({});
  }

  const zipFile = fileArray.find((file) => file.name.toLowerCase().endsWith(".zip"));
  if (zipFile) {
    const zip = await JSZip.loadAsync(zipFile);
    const jsonEntries: Record<string, unknown> = {};
    for (const [path, entry] of Object.entries(zip.files)) {
      if (!entry.dir && path.toLowerCase().endsWith(".json")) {
        jsonEntries[path] = JSON.parse(await entry.async("string")) as unknown;
      }
    }
    const manifestPath = Object.keys(jsonEntries).find((path) => path.endsWith("character-pack.json"));
    const manifest = manifestPath ? jsonEntries[manifestPath] : jsonEntries[Object.keys(jsonEntries)[0]];
    return hydratePackManifest(manifest, jsonEntries, manifestPath ?? "");
  }

  if (fileArray.length === 1) {
    return hydratePackManifest(await readJsonFile(fileArray[0]), {}, "");
  }

  const jsonEntries: Record<string, unknown> = {};
  for (const file of fileArray.filter((candidate) => candidate.name.toLowerCase().endsWith(".json"))) {
    jsonEntries[fileRelativePath(file)] = await readJsonFile(file);
  }
  const manifestPath = Object.keys(jsonEntries).find((path) => path.endsWith("character-pack.json"));
  const manifest = manifestPath ? jsonEntries[manifestPath] : jsonEntries[Object.keys(jsonEntries)[0]];
  return hydratePackManifest(manifest, jsonEntries, manifestPath ?? "");
}

function hydratePackManifest(manifest: unknown, jsonEntries: Record<string, unknown>, manifestPath: string): LoadedPack {
  if (!isRecord(manifest)) {
    return validatePackBundle(manifest);
  }
  const basePath = manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1) : "";
  const candidatePack = { ...manifest } as CharacterPackManifest;
  const existingCharacterDocuments = isRecord(candidatePack.character_documents) ? candidatePack.character_documents : {};
  const existingBindingDocuments = isRecord(candidatePack.binding_documents) ? candidatePack.binding_documents : {};
  const characterDocuments: Record<string, CharacterPayload> = {};
  const bindingDocuments: Record<string, unknown> = {};

  if (Array.isArray(candidatePack.characters)) {
    for (const ref of candidatePack.characters.filter(isPackFileReference)) {
      const entry = existingCharacterDocuments[ref.path] ?? jsonEntries[`${basePath}${ref.path}`] ?? jsonEntries[ref.path];
      if (entry !== undefined) {
        characterDocuments[ref.path] = entry as CharacterPayload;
      }
    }
  }
  if (Array.isArray(candidatePack.bindings)) {
    for (const ref of candidatePack.bindings.filter(isPackFileReference)) {
      const entry = existingBindingDocuments[ref.path] ?? jsonEntries[`${basePath}${ref.path}`] ?? jsonEntries[ref.path];
      if (entry !== undefined) {
        bindingDocuments[ref.path] = entry;
      }
    }
  }

  return validatePackBundle({ ...candidatePack, character_documents: characterDocuments, binding_documents: bindingDocuments });
}

function buildExportPack(source: LoadedPack, selectedCharacterIds: string[]): CharacterPackManifest {
  const selectedCharacters = source.manifest.characters.filter((character) => selectedCharacterIds.includes(character.id));
  return {
    schema_version: "1.0",
    slug: `${source.manifest.slug}-dashboard-export`,
    name: `${source.manifest.name} Dashboard Export`,
    description: `Local dashboard export from ${source.manifest.name}.`,
    version: source.manifest.version,
    authors: source.manifest.authors,
    license: source.manifest.license,
    tags: source.manifest.tags,
    content_warnings: source.manifest.content_warnings ?? [],
    minimum_characterforge_version: source.manifest.minimum_characterforge_version,
    characters: selectedCharacters,
    bindings: source.manifest.bindings ?? [],
    assets: [],
    character_documents: Object.fromEntries(
      selectedCharacters.map((character) => [character.path, source.characterDocuments[character.path]]).filter(([, document]) => document)
    ),
    binding_documents: source.bindingDocuments
  };
}

function payloadFromCharacter(character: Character): CharacterPayload {
  return character.payload ?? {
    name: character.name,
    description: character.description,
    personality: [character.archetype],
    backstory: character.status,
    speaking_style: "Use the character description and saved local notes.",
    goals: [],
    world_context: "",
    rules: [],
    allowed_actions: character.allowedActions,
    action_rules: [],
    payload_templates: []
  };
}

function buildDashboardCharacterExportPack(characters: Character[]): CharacterPackManifest {
  const exportableCharacters = characters.filter((character) => character.syncStatus !== "deleted");
  const manifestCharacters = exportableCharacters.map((character) => ({
    id: character.id,
    path: `characters/${character.id.replace(/[^a-zA-Z0-9_-]+/g, "-") || "character"}.json`,
    name: character.name
  }));
  return {
    schema_version: "1.0",
    slug: "characterforge-dashboard-export",
    name: "CharacterForge Dashboard Export",
    description: "Local character export prepared before deleting the AWS stack.",
    version: "1.0.0",
    authors: [],
    license: "unspecified",
    tags: [],
    content_warnings: [],
    minimum_characterforge_version: "0.1.0",
    characters: manifestCharacters,
    bindings: [],
    assets: [],
    character_documents: Object.fromEntries(
      manifestCharacters.map((manifestCharacter, index) => [manifestCharacter.path, payloadFromCharacter(exportableCharacters[index])])
    ),
    binding_documents: {}
  };
}

function downloadJsonFile(payload: unknown): string {
  const json = formatJson(payload);
  const blob = new Blob([json], { type: "application/json" }) as Blob & { text?: () => Promise<string> };
  if (typeof blob.text !== "function") {
    blob.text = async () => json;
  }
  return URL.createObjectURL(blob);
}


function sourceLabel(character: Character): string {
  if (character.source === "api_local") {
    return "Source: API + local";
  }
  if (character.source === "api") {
    return "Source: API";
  }
  if (character.source === "local") {
    return "Source: Local folder";
  }
  return "Source: Sample";
}

function syncLabel(character: Character): string {
  switch (character.syncStatus) {
    case "api_synced":
      return "Sync: Cloud synced";
    case "api_pending":
      return "Sync: Not synced yet";
    case "conflict":
      return "Sync: Conflict or sync error";
    case "local_only":
      return "Sync: Local only";
    case "deleted":
      return "Sync: Deleted";
    default:
      return "Sync: Sample only";
  }
}

function characterFromPayload(id: string, payload: CharacterPayload, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: payload.name,
    archetype: overrides.archetype ?? "Custom character",
    status: overrides.status ?? "Draft profile",
    description: payload.description,
    allowedActions: payload.allowed_actions,
    payload,
    ...overrides
  };
}

function localIdForPayload(payload: CharacterPayload): string {
  const slug = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "local-character";
  return `local-${slug}`;
}

function responseCharacterId(response: unknown, fallback: string): string {
  return isRecord(response) && typeof response.id === "string" && response.id.trim()
    ? response.id.trim()
    : isRecord(response) && typeof response.character_id === "string" && response.character_id.trim()
      ? response.character_id.trim()
      : fallback;
}

function WelcomeScreen({
  onOpenScreen,
  onOpenSettings,
  onReopenTutorial,
  onSkipTutorial,
  onTutorialComplete,
  onTutorialStepChange,
  readiness,
  sharedState,
  showTutorial,
  tutorialStepIndex
}: {
  onOpenScreen: (screen: ScreenId) => void;
  onOpenSettings: () => void;
  onReopenTutorial: () => void;
  onSkipTutorial: () => void;
  onTutorialComplete: () => void;
  onTutorialStepChange: (stepIndex: number) => void;
  readiness: DashboardReadiness;
  sharedState: SharedDashboardState;
  showTutorial: boolean;
  tutorialStepIndex: number;
}) {
  const tutorialStep = firstRunTutorialSteps[tutorialStepIndex];
  const finalStep = tutorialStepIndex === firstRunTutorialSteps.length - 1;
  const endpointStatus = sharedState.apiConnection.apiBaseUrl || "Not connected";
  const connected = readiness.canLoadCharacters;
  const deploymentStatus =
    sharedState.deployment.stackStatus ??
    (sharedState.deployment.phase === "not_configured" ? "No stack connected" : sharedState.deployment.phase.replaceAll("_", " "));
  const characterCountLabel = connected ? sharedState.characters.length.toString() : "None loaded";
  const connectionLabel = connected ? "Connected" : "Not connected";
  const tutorialStepLabel = `Step ${tutorialStepIndex + 1} of ${firstRunTutorialSteps.length}`;

  function handleTutorialNext() {
    if (finalStep) {
      onTutorialComplete();
      return;
    }
    onTutorialStepChange(tutorialStepIndex + 1);
  }

  return (
    <section className="screen-card" aria-labelledby="welcome-title">
      <p className="eyebrow">{connected ? "API-connected dashboard" : "Setup needed"}</p>
      <h1 id="welcome-title">Welcome to CharacterForgeAI</h1>
      <p>
        See whether CharacterForgeAI is connected, whether the deployment is ready, and what to do next before creating
        or chatting with characters.
      </p>
      <div className={connected ? "notice" : "notice empty-state"}>
        {connected ? (
          <>
            CharacterForgeAI is connected to your configured API endpoint. Status cards below reflect the current
            connection and character state without showing API keys.
          </>
        ) : (
          <>
            <strong>No AWS backend connected yet.</strong> Go to Deployment to launch or connect your CharacterForgeAI
            stack.
          </>
        )}
      </div>
      {!connected ? (
        <div className="button-row">
          <button type="button" onClick={() => onOpenScreen("deployment")}>Open Deployment Setup</button>
          <button className="secondary" type="button" onClick={onReopenTutorial}>Start Guided Setup</button>
        </div>
      ) : null}
      <div className="summary-grid" aria-label="Welcome status summary">
        <SummaryCard label="Connection" value={connectionLabel} />
        <SummaryCard label="Deployment" value={deploymentStatus} />
        <SummaryCard label="Characters" value={characterCountLabel} />
        <SummaryCard label="API endpoint" value={endpointStatus} />
      </div>
      {showTutorial ? (
        <section className="tutorial-card" aria-labelledby="tutorial-title">
          <p className="eyebrow">{tutorialStepLabel}</p>
          <h2 id="tutorial-title">First-run tutorial</h2>
          <h3>{tutorialStep.title}</h3>
          <p>{tutorialStep.body}</p>
          <ul>
            {tutorialStep.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="tutorial-safety-grid" aria-label="First-run safety warnings">
            <div className="warning">
              <strong>AWS cost warning</strong>
              <p>AWS can charge for deployed resources. Set budgets and delete test stacks when finished.</p>
            </div>
            <div className="warning">
              <strong>Credential safety warning</strong>
              <p>Never paste production credentials into browser forms, commits, screenshots, or public demos.</p>
            </div>
          </div>
          <div className="button-row">
            <button type="button" onClick={handleTutorialNext}>{tutorialStep.nextLabel}</button>
            {tutorialStep.actions?.map((action) => (
              <button className="secondary" type="button" key={action.label} onClick={() => onOpenScreen(action.screen)}>
                {action.label}
              </button>
            ))}
            <button className="secondary" type="button" onClick={onSkipTutorial}>Skip tutorial</button>
          </div>
        </section>
      ) : (
        <section className="tutorial-card" aria-labelledby="tutorial-reopen-title">
          <p className="eyebrow">Saved setup preference</p>
          <h2 id="tutorial-reopen-title">First-run tutorial is saved as completed</h2>
          <p>
            CharacterForgeAI will remember this choice in the desktop app config. You can reopen the guided setup any
            time from this Welcome screen.
          </p>
          <div className="button-row">
            <button type="button" onClick={onReopenTutorial}>Reopen first-run tutorial</button>
            <button className="secondary" type="button" onClick={onOpenSettings}>Open Settings</button>
          </div>
        </section>
      )}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsScreen({
  onCheckForUpdates,
  onInstallUpdate,
  updateCheckResult,
  updateStatus
}: {
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  updateCheckResult: UpdateCheckResult | null;
  updateStatus: ConnectionStatus;
}) {
  return (
    <section className="screen-card" aria-labelledby="settings-title">
      <p className="eyebrow">Application preferences</p>
      <h1 id="settings-title">Settings</h1>
      <p>
        App-level preferences live here. Deployment setup, AWS readiness checks, and API connection fields stay on
        Deployment so users have one setup path.
      </p>
      <section className="setup-safety-panel" aria-labelledby="updates-title">
        <p className="eyebrow">App updates</p>
        <h2 id="updates-title">Check for Updates</h2>
        <p>
          Check whether a signed CharacterForgeAI desktop update is available. Browser mode uses a safe mock result and
          does not download anything.
        </p>
        <div className="button-row">
          <button type="button" onClick={onCheckForUpdates} disabled={updateStatus.state === "loading"}>
            Check for Updates
          </button>
          {updateCheckResult?.available ? (
            <button type="button" onClick={onInstallUpdate}>
              Update Now
            </button>
          ) : null}
        </div>
        <div className={`connection-status ${updateStatus.state}`} role="status">
          {updateStatus.message}
          {updateCheckResult?.available ? (
            <div>
              {updateCheckResult.version ? <span> Version {updateCheckResult.version}.</span> : null}
              {updateCheckResult.notes ? <span> {updateCheckResult.notes}</span> : null}
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function SetupCheckScreen({
  form,
  onFormChange,
  onRunCheck,
  onRunAwsSetupWizard,
  result,
  status,
  wizardResult,
  wizardStatus
}: {
  form: SetupCheckForm;
  onFormChange: (form: SetupCheckForm) => void;
  onRunCheck: () => void;
  onRunAwsSetupWizard: () => void;
  result: SetupCheckResult | null;
  status: ConnectionStatus;
  wizardResult: AwsSetupWizardResult | null;
  wizardStatus: ConnectionStatus;
}) {
  return (
    <section className="screen-card" aria-labelledby="setup-check-title">
      <p className="eyebrow">Setup readiness</p>
      <h1 id="setup-check-title">Setup Check</h1>
      <p>
        In the desktop app, this runs local Tauri checks for WebView2, AWS CLI, SAM, Docker, packaged resources,
        AWS profile, region, stack, and Bedrock model readiness without returning credential values.
      </p>
      <div className="notice compact">
        Browser mode uses the browser preview setup-check adapter; desktop mode uses Tauri Rust commands with redacted output.
      </div>
      <div className="editor-grid">
        <label className="field">
          AWS region
          <input
            value={form.awsRegion}
            onChange={(event) => onFormChange({ ...form, awsRegion: event.target.value })}
          />
        </label>
        <label className="field">
          Bedrock model
          <select
            value={form.bedrockModel}
            onChange={(event) => onFormChange({ ...form, bedrockModel: event.target.value })}
          >
            {bedrockModelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.value})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          AWS profile name
          <input
            value={form.profileName}
            onChange={(event) => onFormChange({ ...form, profileName: event.target.value })}
          />
        </label>
        <label className="field">
          Stack name
          <input
            value={form.stackName}
            onChange={(event) => onFormChange({ ...form, stackName: event.target.value })}
          />
        </label>
      </div>
      <div className="button-row">
        <button type="button" onClick={onRunCheck}>Run readiness check</button>
      </div>
      <section className="tutorial-card" aria-labelledby="aws-setup-wizard-title">
        <p className="eyebrow">Guided AWS setup</p>
        <h2 id="aws-setup-wizard-title">Credential-safe AWS setup wizard</h2>
        <p>
          This wizard uses named AWS CLI profiles, guides region and Bedrock model selection, and previews the
          CloudFormation stack settings before you use Start.
        </p>
        <div className="setup-check-grid">
          <article className="summary-card">
            <span>Credential safety</span>
            <strong>No access keys, secret keys, session tokens, passwords, or auth headers are stored, logged, or shown.</strong>
          </article>
          <article className="summary-card">
            <span>Cost awareness</span>
            <strong>Bedrock and deployed AWS resources can create charges; review pricing, budgets, and cleanup plans.</strong>
          </article>
          <article className="summary-card">
            <span>Bedrock access</span>
            <strong>Checks use the safe Bedrock control-plane model list, not a runtime prompt.</strong>
          </article>
        </div>
        <div className="button-row">
          <button type="button" onClick={onRunAwsSetupWizard}>Load AWS setup wizard</button>
        </div>
        <div className={`connection-status ${wizardStatus.state}`} role="status">
          {wizardStatus.message}
        </div>
        {wizardResult ? <AwsSetupWizardSummary result={wizardResult} /> : null}
      </section>
      <div className={`connection-status ${status.state}`} role="status">
        {status.message}
      </div>
      <div className="setup-check-grid">
        <SetupCheckCard label="AWS region" value={result?.awsRegion ?? form.awsRegion} />
        <SetupCheckCard label="Selected Bedrock model" value={result?.bedrockModel ?? form.bedrockModel} />
        <SetupCheckCard label="AWS profile" value={result?.profileName ?? form.profileName} />
        <SetupCheckCard label="Stack name" value={result?.stackName ?? form.stackName} />
        <SetupCheckCard label="Credential status" value={result?.credentialStatus ?? "Not checked yet"} />
        <SetupCheckCard label="Bedrock access status" value={result?.bedrockAccessStatus ?? "Not checked yet"} />
        <SetupCheckCard label="Existing stack status" value={result?.existingStackStatus ?? "Not checked yet"} />
      </div>
      {result?.checks.length ? (
        <section className="setup-warning-list" aria-labelledby="readiness-details-title">
          <h2 id="readiness-details-title">Readiness details</h2>
          <div className="setup-check-grid">
            {result.checks.map((check) => (
              <SetupCheckCard key={check.id} label={check.label} value={`${check.status}: ${check.detail}`} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="warning setup-warning-list" aria-labelledby="setup-warnings-title">
        <h2 id="setup-warnings-title">Warnings</h2>
        <ul>
          {(result?.warnings ?? ["Run readiness check before using this for deployment decisions."]).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function AwsSetupWizardSummary({ result }: { result: AwsSetupWizardResult }) {
  const browserPreviewOnly = result.bedrockAccessStatus.toLowerCase().includes("browser preview only");
  return (
    <section className="setup-warning-list" aria-labelledby="aws-setup-summary-title">
      <h3 id="aws-setup-summary-title">AWS setup wizard summary</h3>
      {browserPreviewOnly ? <p className="notice compact">{result.bedrockAccessStatus}</p> : null}
      <div className="setup-check-grid">
        <SetupCheckCard
          label={browserPreviewOnly ? "AWS CLI profile check" : "Detected AWS CLI profiles"}
          value={result.profiles.join(", ") || (browserPreviewOnly ? "No profiles checked" : "No profiles detected")}
        />
        <SetupCheckCard label="Selected profile" value={result.selectedProfile} />
        <SetupCheckCard label="Selected region" value={result.selectedRegion} />
        <SetupCheckCard label="Selected Bedrock model" value={result.selectedModel} />
        <SetupCheckCard
          label={browserPreviewOnly ? "Bedrock model check" : "Available Bedrock models"}
          value={result.availableModels.join(", ") || (browserPreviewOnly ? "No models checked" : "No models listed")}
        />
        <SetupCheckCard label="Bedrock access check" value={result.bedrockAccessStatus} />
      </div>
      <section className="notice compact" aria-labelledby="stack-preview-title">
        <h3 id="stack-preview-title">Stack preview</h3>
        <p>
          Stack {result.stackPreview.stackName} in {result.stackPreview.region} using profile {result.stackPreview.profileName}
          and model {result.stackPreview.bedrockModel}: {result.stackPreview.status}
        </p>
      </section>
      <section className="warning setup-warning-list" aria-labelledby="aws-setup-warning-title">
        <h3 id="aws-setup-warning-title">Wizard safety notes</h3>
        <ul>
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function SetupCheckCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

type DeploymentStatusPanelData = {
  apiMessage: string;
  apiStatus: string;
  characterSyncMessage: string;
  failureReason: string | null;
  lastOperation: string;
  phase: DeploymentPhase;
  sanitizedAlerts: string[];
  stackStatus: string;
};

function sanitizeDeploymentAlert(message: string): string {
  return message
    .replace(/AWS_ACCESS_KEY_ID\s*[:=]\s*[^\s,;]+/gi, "AWS_ACCESS_KEY_ID=<redacted>")
    .replace(/AWS_SECRET_ACCESS_KEY\s*[:=]\s*[^\s,;]+/gi, "AWS_SECRET_ACCESS_KEY=<redacted>")
    .replace(/AWS_SESSION_TOKEN\s*[:=]\s*[^\s,;]+/gi, "AWS_SESSION_TOKEN=<redacted>")
    .replace(/(api[_-]?key|password|token)\s*[:=]\s*[^\s,;]+/gi, "$1=<redacted>")
    .replace(/(secret access key|session token)\s+[^.\s,;]+/gi, "$1 <redacted>")
    .trim();
}

function getDeploymentResultFailureReason(result: DeploymentStartResult | DeploymentEndResult | null): string | null {
  if (!result || result.status === "succeeded" || result.status === "cancelled") {
    return null;
  }
  const logLine = result.logs.find((line) => /fail|rollback|denied|error|resource handler/i.test(line)) ?? result.logs.at(-1);
  return logLine ? sanitizeDeploymentAlert(logLine) : `CloudFormation reported ${result.finalStackStatus}.`;
}

function getDeploymentStatusPanelData({
  connectionStatus,
  endResult,
  setupResult,
  sharedState,
  startResult,
  status
}: {
  connectionStatus: ConnectionStatus;
  endResult: DeploymentEndResult | null;
  setupResult: SetupCheckResult | null;
  sharedState: SharedDashboardState;
  startResult: DeploymentStartResult | null;
  status: ConnectionStatus;
}): DeploymentStatusPanelData {
  const latestResult = endResult ?? startResult;
  const latestFailureReason = getDeploymentResultFailureReason(latestResult);
  const stackStatus = latestResult?.finalStackStatus ?? sharedState.deployment.stackStatus ?? sharedState.deployment.phase.replaceAll("_", " ");
  const phase = /ROLLBACK/.test(stackStatus)
    ? "rollback"
    : /FAILED/.test(stackStatus)
      ? "failed"
      : sharedState.deployment.phase;
  const lastOperation = status.state === "loading"
    ? "Deployment operation in progress."
    : endResult
      ? endResult.status === "succeeded"
        ? "End succeeded."
        : endResult.status === "cancelled"
          ? "End cancelled."
          : /ROLLBACK/.test(endResult.finalStackStatus)
            ? "Rollback detected."
            : "Failure detected."
      : startResult
        ? startResult.status === "succeeded"
          ? "Start succeeded."
          : /ROLLBACK/.test(startResult.finalStackStatus)
            ? "Rollback detected."
            : "Failure detected."
        : "No deployment operation has run yet.";
  const apiStatus = sharedState.apiConnection.state === "connected"
    ? "API connected."
    : sharedState.apiConnection.state === "not_configured"
      ? "API endpoint not configured."
      : sharedState.apiConnection.state === "error"
        ? "API connection failed."
        : "API endpoint configured but not connected.";
  const apiMessage = sharedState.apiConnection.message;
  const characterCount = sharedState.characters.length;
  const characterSyncMessage = sharedState.apiConnection.state === "connected"
    ? `${characterCount} API character${characterCount === 1 ? "" : "s"} ready for sync.`
    : sharedState.characterFolder.state === "ready"
      ? "Local character folder is ready; API sync waits for a connected API."
      : "Character sync waits for a connected API.";
  const readinessAlerts = setupResult
    ? setupResult.warnings.map(sanitizeDeploymentAlert)
    : ["Run readiness check before using this for deployment decisions."];
  const sanitizedAlerts = [
    ...readinessAlerts,
    ...(latestFailureReason ? [latestFailureReason] : []),
    ...(connectionStatus.state === "error" ? [sanitizeDeploymentAlert(connectionStatus.message)] : [])
  ].filter(Boolean);

  return {
    apiMessage,
    apiStatus,
    characterSyncMessage,
    failureReason: latestFailureReason,
    lastOperation,
    phase,
    sanitizedAlerts: sanitizedAlerts.length ? sanitizedAlerts : ["No active deployment alerts."],
    stackStatus,
  };
}

function DeploymentStatusPanels({
  connectionStatus,
  endResult,
  setupResult,
  sharedState,
  startResult,
  status
}: {
  connectionStatus: ConnectionStatus;
  endResult: DeploymentEndResult | null;
  setupResult: SetupCheckResult | null;
  sharedState: SharedDashboardState;
  startResult: DeploymentStartResult | null;
  status: ConnectionStatus;
}) {
  const panelData = getDeploymentStatusPanelData({ connectionStatus, endResult, setupResult, sharedState, startResult, status });
  return (
    <section className="setup-safety-panel" aria-labelledby="deployment-status-alerts-title">
      <h2 id="deployment-status-alerts-title">Deployment status and alerts</h2>
      <div className="setup-check-grid">
        <SetupCheckCard label="Stack status" value={panelData.stackStatus} />
        <SetupCheckCard label="Last operation" value={panelData.lastOperation} />
        <SetupCheckCard label="API connection" value={panelData.apiStatus} />
        <SetupCheckCard label="Character sync readiness" value={panelData.characterSyncMessage} />
      </div>
      <p className="notice compact">{sanitizeDeploymentAlert(panelData.apiMessage)}</p>
      {panelData.failureReason ? (
        <section className={`connection-status ${panelData.phase === "rollback" || panelData.phase === "failed" ? "error" : "idle"}`} aria-labelledby="rollback-failure-title">
          <h3 id="rollback-failure-title">Rollback / failure reason</h3>
          <p>{panelData.failureReason}</p>
        </section>
      ) : null}
      <section className="warning setup-warning-list" aria-labelledby="sanitized-alerts-title">
        <h3 id="sanitized-alerts-title">Sanitized alerts</h3>
        <ul>
          {panelData.sanitizedAlerts.map((alert) => (
            <li key={alert}>{alert}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function DeploymentStartScreen({
  connectionStatus,
  endDeleteConfirmed,
  exportBeforeEndConfirmed,
  exportBeforeEndStatus,
  form,
  isDesktopShell,
  settings,
  setupResult,
  characterFolder,
  folderScanIssues,
  folderStatus,
  localCharacters,
  setupCheckRequest,
  sharedState,
  setupStatus,
  testedApiSettings,
  wizardResult,
  wizardStatus,
  onApiSettingsChange,
  onEndDeleteConfirmedChange,
  onExportBeforeEndConfirmedChange,
  onFormChange,
  onPreviewStart,
  onOpenCharacterFolder,
  onExportCharactersBeforeEnd,
  onOpenCharacters,
  onRealEnd,
  onRunAwsSetupWizard,
  onRunCheck,
  onSaveSettings,
  onTestConnection,
  onRealStart,
  onStartSafetyConfirmedChange,
  preview,
  endResult,
  startResult,
  startSafetyConfirmed,
  status
}: {
  connectionStatus: ConnectionStatus;
  endDeleteConfirmed: boolean;
  exportBeforeEndConfirmed: boolean;
  exportBeforeEndStatus: ConnectionStatus;
  form: DeploymentStartRequest;
  isDesktopShell: boolean;
  settings: ApiSettings;
  setupResult: SetupCheckResult | null;
  characterFolder: CharacterFolderInfo;
  folderScanIssues: CharacterFolderScanIssue[];
  folderStatus: CharacterFolderStatus;
  localCharacters: Character[];
  setupCheckRequest: SetupCheckForm | null;
  sharedState: SharedDashboardState;
  setupStatus: ConnectionStatus;
  testedApiSettings: ApiSettings | null;
  wizardResult: AwsSetupWizardResult | null;
  wizardStatus: ConnectionStatus;
  onApiSettingsChange: (settings: ApiSettings) => void;
  onEndDeleteConfirmedChange: (value: boolean) => void;
  onExportBeforeEndConfirmedChange: (value: boolean) => void;
  onFormChange: (form: DeploymentStartRequest) => void;
  onPreviewStart: () => void;
  onOpenCharacterFolder: () => void;
  onExportCharactersBeforeEnd: () => void;
  onOpenCharacters: () => void;
  onRealEnd: () => void;
  onRunAwsSetupWizard: () => void;
  onRunCheck: () => void;
  onSaveSettings: () => void;
  onTestConnection: () => void;
  onRealStart: () => void;
  onStartSafetyConfirmedChange: (value: boolean) => void;
  preview: DeploymentStartPreview | null;
  endResult: DeploymentEndResult | null;
  startResult: DeploymentStartResult | null;
  startSafetyConfirmed: boolean;
  status: ConnectionStatus;
}) {
  const temporaryCredentials = form.temporaryCredentials ?? { accessKeyId: "", secretAccessKey: "", sessionToken: "" };
  const hasDeploymentFields = Boolean(form.awsRegion.trim() && form.bedrockModel.trim() && form.stackName.trim());
  const hasCredentials =
    form.credentialMode === "profile"
      ? Boolean(form.profileName.trim())
      : Boolean(temporaryCredentials.accessKeyId.trim() && temporaryCredentials.secretAccessKey.trim() && temporaryCredentials.sessionToken.trim());
  const startDisabledReasons = getDeploymentStartDisabledReasons({
    connectionStatus,
    form,
    isDesktopShell,
    settings,
    setupCheckRequest,
    setupResult,
    startSafetyConfirmed,
    testedApiSettings
  });
  const canStart = startDisabledReasons.length === 0;
  const exportBeforeEndFailed = exportBeforeEndStatus.state === "error";
  const canEnd = isDesktopShell && exportBeforeEndConfirmed && endDeleteConfirmed && hasDeploymentFields && hasCredentials && !exportBeforeEndFailed;
  const invalidFileCount = folderScanIssues.length;
  const localReadyCount = localCharacters.filter((character) => character.syncStatus === "api_pending" || character.syncStatus === "conflict" || character.source === "local").length;
  const localFolderMessage =
    folderStatus.state === "success"
      ? localReadyCount
        ? `Found ${localReadyCount} local character${localReadyCount === 1 ? "" : "s"} ready to sync.`
        : "Local character folder scan found no local characters ready to sync."
      : "Start will scan the default CharacterForgeAI character folder after the stack starts.";

  function updateTemporaryCredentials(field: keyof NonNullable<DeploymentStartRequest["temporaryCredentials"]>, value: string) {
    onFormChange({
      ...form,
      temporaryCredentials: {
        ...temporaryCredentials,
        [field]: value
      }
    });
  }

  return (
    <section className="screen-card" aria-labelledby="deployment-title">
      <p className="eyebrow">API setup and AWS deployment</p>
      <h1 id="deployment-title">Deployment</h1>
      <p>
        Configure the deployed CharacterForgeAI API, verify AWS readiness, and preview the local desktop Start/End flow from
        one place.
      </p>
      <DeploymentStatusPanels
        connectionStatus={connectionStatus}
        endResult={endResult}
        setupResult={setupResult}
        sharedState={sharedState}
        startResult={startResult}
        status={status}
      />
      <section className="setup-safety-panel" aria-labelledby="api-connection-title">
        <h2 id="api-connection-title">API connection</h2>
        <p>
          API Base URL comes from the CloudFormation or SAM deployment outputs for the deployed API endpoint. API Key comes
          from the deployment outputs that create the API Gateway usage-plan key, or from API Gateway if your stack
          rotation process issued a new one.
        </p>
        <section className="notice compact" aria-labelledby="api-discovery-help-title">
          <h3 id="api-discovery-help-title">Where do I find these?</h3>
          <ol>
            <li>
              When this app starts the stack, it reads CloudFormation Outputs after deployment completes and offers to
              fill the API Base URL from the stack output automatically.
            </li>
            <li>
              API keys stay redacted: the app never prints the raw key in logs or status panels, and the password field
              should be cleared before screen sharing.
            </li>
            <li>
              If you deployed separately, open AWS Console &gt; CloudFormation &gt; Stacks, select your CharacterForgeAI
              stack, then open Outputs and copy the API endpoint and API key output values if present.
            </li>
            <li>
              If the outputs are missing, open AWS Console &gt; API Gateway: use Stages to find the Invoke URL, and use API
              Keys or Usage Plans only long enough to copy the key value into this local session.
            </li>
          </ol>
        </section>
        <p className="warning">
          <strong>Credential safety warning:</strong> API keys should be treated as secrets: do not commit them, paste production secrets into demos, screenshots, or issue reports,
          and remove them from this field before sharing your screen.
        </p>
        <div className="editor-grid">
          <label className="field">
            API Base URL
            <input
              placeholder="https://api-base-url-from-your-deployment.example.invalid/prod"
              value={settings.apiBaseUrl}
              onChange={(event) => onApiSettingsChange({ ...settings, apiBaseUrl: event.target.value })}
            />
          </label>
          <label className="field">
            API Key
            <input
              autoComplete="off"
              placeholder="Paste a non-production API key for local testing"
              type="password"
              value={settings.apiKey}
              onChange={(event) => onApiSettingsChange({ ...settings, apiKey: event.target.value })}
            />
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={onSaveSettings}>Save settings</button>
          <button type="button" onClick={onTestConnection}>Test connection</button>
        </div>
        <div className={`connection-status ${connectionStatus.state}`} role="status">
          {connectionStatus.message}
        </div>
      </section>
      <div className="notice compact">Dry-run mode only: safe local command preview, no AWS requests.</div>
      <div className="editor-grid">
        <label className="field">
          AWS region
          <input value={form.awsRegion} onChange={(event) => onFormChange({ ...form, awsRegion: event.target.value })} />
        </label>
        <label className="field">
          Bedrock model
          <select value={form.bedrockModel} onChange={(event) => onFormChange({ ...form, bedrockModel: event.target.value })}>
            {bedrockModelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.value})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Stack name
          <input value={form.stackName} onChange={(event) => onFormChange({ ...form, stackName: event.target.value })} />
        </label>
        <label className="field">
          Environment name
          <input value={form.environmentName} onChange={(event) => onFormChange({ ...form, environmentName: event.target.value })} />
        </label>
      </div>

      <fieldset className="credential-fieldset">
        <legend>AWS credential source</legend>
        <label className="radio-field">
          <input
            checked={form.credentialMode === "profile"}
            name="deployment-credential-mode"
            onChange={() => onFormChange({ ...form, credentialMode: "profile" })}
            type="radio"
          />
          AWS profile
        </label>
        <label className="radio-field">
          <input
            checked={form.credentialMode === "temporary"}
            name="deployment-credential-mode"
            onChange={() => onFormChange({ ...form, credentialMode: "temporary" })}
            type="radio"
          />
          Temporary credentials
        </label>
      </fieldset>

      {form.credentialMode === "profile" ? (
        <label className="field">
          AWS profile name
          <input value={form.profileName} onChange={(event) => onFormChange({ ...form, profileName: event.target.value })} />
        </label>
      ) : (
        <div className="editor-grid" aria-label="Temporary credential fields">
          <label className="field">
            Access key ID
            <input
              autoComplete="off"
              value={temporaryCredentials.accessKeyId}
              onChange={(event) => updateTemporaryCredentials("accessKeyId", event.target.value)}
            />
          </label>
          <label className="field">
            Secret access key
            <input
              autoComplete="off"
              type="password"
              value={temporaryCredentials.secretAccessKey}
              onChange={(event) => updateTemporaryCredentials("secretAccessKey", event.target.value)}
            />
          </label>
          <label className="field field-wide">
            Session token
            <input
              autoComplete="off"
              type="password"
              value={temporaryCredentials.sessionToken}
              onChange={(event) => updateTemporaryCredentials("sessionToken", event.target.value)}
            />
          </label>
        </div>
      )}

      <section className="setup-safety-panel" aria-labelledby="deployment-readiness-title">
        <h2 id="deployment-readiness-title">Credential-safe AWS setup wizard</h2>
        <p>
          This merged Deployment wizard uses named AWS CLI profiles, guides region and Bedrock model selection, previews
          stack settings, and keeps the setup summary together with Start. In browser preview mode it shows an honest
          setup checklist only; use the packaged desktop app for real local AWS checks.
        </p>
        <div className="setup-check-grid">
          <article className="summary-card">
            <span>Credential safety</span>
            <strong>No access keys, secret keys, session tokens, passwords, or auth headers are stored, logged, or shown.</strong>
          </article>
          <article className="summary-card">
            <span>Cost awareness</span>
            <strong>Bedrock and deployed AWS resources can create charges; review pricing, budgets, and cleanup plans.</strong>
          </article>
          <article className="summary-card">
            <span>Bedrock access</span>
            <strong>Checks use the safe Bedrock control-plane model list, not a runtime prompt.</strong>
          </article>
        </div>
        <h3>Readiness checks and setup summary</h3>
        <p>
          Check your local AWS CLI profile, selected region, Bedrock model access, and existing CloudFormation stack before
          you run Start. The check uses safe control-plane calls only and never stores raw credentials.
        </p>
        <div className="button-row">
          <button type="button" onClick={onRunCheck}>Run readiness check</button>
          <button type="button" onClick={onRunAwsSetupWizard}>Load AWS setup wizard</button>
        </div>
        <div className={`connection-status ${setupStatus.state}`} role="status">
          {setupStatus.message}
        </div>
        <div className={`connection-status ${wizardStatus.state}`} role="status">
          {wizardStatus.message}
        </div>
        <div className="setup-check-grid">
          <SetupCheckCard label="AWS region" value={setupResult?.awsRegion ?? form.awsRegion} />
          <SetupCheckCard label="Selected Bedrock model" value={setupResult?.bedrockModel ?? form.bedrockModel} />
          <SetupCheckCard label="AWS profile" value={setupResult?.profileName ?? form.profileName} />
          <SetupCheckCard label="Stack name" value={setupResult?.stackName ?? form.stackName} />
          <SetupCheckCard label="Credential status" value={setupResult?.credentialStatus ?? "Not checked yet"} />
          <SetupCheckCard label="Bedrock access status" value={setupResult?.bedrockAccessStatus ?? "Not checked yet"} />
          <SetupCheckCard label="Existing stack status" value={setupResult?.existingStackStatus ?? "Not checked yet"} />
        </div>
        {wizardResult ? <AwsSetupWizardSummary result={wizardResult} /> : null}
        {setupResult?.checks.length ? (
          <section className="setup-warning-list" aria-labelledby="readiness-details-title">
            <h3 id="readiness-details-title">Readiness details</h3>
            <div className="setup-check-grid">
              {setupResult.checks.map((check) => (
                <SetupCheckCard key={check.id} label={check.label} value={`${check.status}: ${check.detail}`} />
              ))}
            </div>
          </section>
        ) : null}
        <section className="warning setup-warning-list" aria-labelledby="setup-warnings-title">
          <h3 id="setup-warnings-title">Warnings</h3>
          <ul>
            {(setupResult?.warnings ?? ["Run readiness check before using this for deployment decisions."]).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      </section>

      <div className="button-row">
        <button type="button" onClick={onPreviewStart}>Preview Start dry run</button>
      </div>

      <section className="setup-safety-panel" aria-labelledby="desktop-start-end-title">
        <h2 id="desktop-start-end-title">Desktop Start and End</h2>
        <p>
          Start and End use the existing desktop deployment engine with the configured AWS profile, region, Bedrock
          model, and stack name. No command text is required from the user; the app passes the required stack
          confirmation to the Tauri command after the setup checks and safety acknowledgement are complete.
        </p>
        <p className="warning">
          {isDesktopShell
            ? "Start stays disabled until required setup fields, readiness checks, API connection requirements, and safety acknowledgement are ready."
            : "Start and End are disabled in the browser preview and are available only in the packaged Tauri desktop shell."}
        </p>
        <label className="checkbox-field">
          <input
            checked={startSafetyConfirmed}
            onChange={(event) => onStartSafetyConfirmedChange(event.target.checked)}
            type="checkbox"
          />
          I reviewed the readiness results, AWS cost warning, credential safety warning, and API connection state.
        </label>
        {!canStart ? (
          <div className="notice compact" role="status">
            Start is disabled until you {startDisabledReasons.join(", ")}.
          </div>
        ) : null}
        <div className="button-row">
          <button type="button" disabled={!canStart} onClick={onRealStart}>Start</button>
        </div>
        <section className="notice compact" aria-labelledby="local-character-start-title">
          <h3 id="local-character-start-title">Local character folder after Start</h3>
          <p>{localFolderMessage}</p>
          <p>
            Start only scans and validates local character files. It does not silently overwrite cloud records or sync local
            changes automatically.
          </p>
          <p className="helper-text">Default folder: {characterFolder.path}</p>
          {invalidFileCount ? (
            <p className="warning">
              {invalidFileCount} invalid local file{invalidFileCount === 1 ? "" : "s"} {invalidFileCount === 1 ? "needs" : "need"} review before syncing.
            </p>
          ) : null}
          {folderStatus.state === "success" ? (
            <div className="button-row">
              <button type="button" onClick={onOpenCharacters}>Review or sync in Characters</button>
            </div>
          ) : null}
        </section>
      </section>

      <section className="setup-safety-panel" aria-labelledby="desktop-end-title">
        <h2 id="desktop-end-title">End deployment</h2>
        <p>
          End deletes the configured CloudFormation stack through the desktop shell. Save or export character data before
          deletion, then explicitly confirm the stack and region before the End button is enabled. Logs are redacted and
          stack deletion status is polled until it succeeds or fails.
        </p>
        <p className="warning">
          Warning: End deletes AWS backend resources for stack <strong>{form.stackName.trim() || "characterforge-ai-dev"}</strong> in region <strong>{form.awsRegion.trim() || "us-east-1"}</strong>. This cannot be undone from the dashboard.
        </p>
        <div className="notice compact">
          <strong>Before deleting, save your characters locally.</strong> Use Open Character Folder to review existing local
          files, or Export Characters to write a redacted local pack before ending the stack. If an export is requested
          and fails, deletion stays blocked until a successful export is completed.
        </div>
        <div className="button-row">
          <button type="button" onClick={onOpenCharacterFolder}>Open Character Folder</button>
          <button type="button" onClick={onExportCharactersBeforeEnd}>Export Characters</button>
        </div>
        <div className={`connection-status ${exportBeforeEndStatus.state}`} role="status">
          {exportBeforeEndStatus.message}
        </div>
        <label className="checkbox-field">
          <input
            checked={exportBeforeEndConfirmed}
            onChange={(event) => onExportBeforeEndConfirmedChange(event.target.checked)}
            type="checkbox"
          />
          I saved/exported the characters I need, or I deliberately choose to delete without exporting.
        </label>
        <label className="checkbox-field">
          <input
            checked={endDeleteConfirmed}
            onChange={(event) => onEndDeleteConfirmedChange(event.target.checked)}
            type="checkbox"
          />
          I understand End deletes stack {form.stackName.trim() || "characterforge-ai-dev"} in region {form.awsRegion.trim() || "us-east-1"} and removes the local deployment connection.
        </label>
        <div className="button-row">
          <button type="button" disabled={!canEnd} onClick={onRealEnd}>End</button>
        </div>
      </section>

      <div className={`connection-status ${status.state}`} role="status">
        {status.message}
      </div>

      {preview ? (
        <div className="deployment-preview">
          <div className="notice compact">
            {preview.awsCallsMade ? "Adapter reported live calls." : "No AWS, SAM, CloudFormation, Bedrock, or credential provider calls were made."}
          </div>
          <h2>SAM deploy command preview</h2>
          <pre className="json-preview" aria-label="SAM deploy command preview">
            {preview.commands.join("\n")}
          </pre>
          <section aria-labelledby="deployment-resources-title">
            <h2 id="deployment-resources-title">Resources that would be created</h2>
            <ul>
              {preview.resources.map((resource) => (
                <li key={resource}>{resource}</li>
              ))}
            </ul>
          </section>
          <section className="warning setup-warning-list" aria-labelledby="deployment-warnings-title">
            <h2 id="deployment-warnings-title">Dry-run warnings</h2>
            <ul>
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {startResult ? (
        <details className="deployment-preview">
          <summary>Real Start redacted log</summary>
          <p>
            Final stack status: <strong>{startResult.finalStackStatus}</strong>
            {startResult.savedOutputsPath ? ` · Outputs saved to ${startResult.savedOutputsPath}` : ""}
          </p>
          <pre className="json-preview" aria-label="Real Start redacted log">
            {startResult.logs.join("\n")}
          </pre>
        </details>
      ) : null}

      {endResult ? (
        <details className="deployment-preview">
          <summary>Real End redacted log</summary>
          <p>
            Final stack status: <strong>{endResult.finalStackStatus}</strong>
          </p>
          <pre className="json-preview" aria-label="Real End redacted log">
            {endResult.logs.join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

function CharactersScreen({
  characters,
  deleteStatus,
  editingVisible,
  editor,
  mode,
  packTools,
  characterFolder,
  folderScanIssues,
  folderStatus,
  syncSummary,
  pendingDelete,
  onCancelDelete,
  onConfirmDelete,
  onCreateCharacter,
  onEditCharacter,
  onRequestDelete,
  onOpenCharacterFolder
}: {
  characters: Character[];
  deleteStatus: EditorStatus;
  editingVisible: boolean;
  editor: {
    form: CharacterEditorForm;
    onFormChange: (form: CharacterEditorForm) => void;
    onSubmit: () => void;
    onCancel: () => void;
    previewPayload: CharacterPayload | null;
    status: EditorStatus;
    validationErrors: string[];
  };
  mode: "api" | "mock";
  packTools: {
    exportState: PackExportState | null;
    loadedPack: LoadedPack | null;
    onExportSelected: () => void;
    onFileLoad: (files: FileList | null) => void;
    onImportSelected: () => void;
    onSelectionChange: (characterIds: string[]) => void;
    selectedCharacterIds: string[];
    status: PackStatus;
    visible: boolean;
  };
  characterFolder: CharacterFolderInfo;
  folderScanIssues: CharacterFolderScanIssue[];
  folderStatus: CharacterFolderStatus;
  syncSummary: string[];
  pendingDelete: Character | null;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onCreateCharacter: () => void;
  onEditCharacter: (character: Character) => void;
  onRequestDelete: (character: Character) => void;
  onOpenCharacterFolder: () => void;
}) {
  return (
    <section className="screen-card" aria-labelledby="characters-title">
      <p className="eyebrow">Roster</p>
      <h1 id="characters-title">Characters</h1>
      <p>Manage character creation, editing, local folder import/export, and deletion from this single page.</p>
      <div className="button-row" aria-label="Character management actions">
        <button onClick={onCreateCharacter} type="button">
          Create Character
        </button>
        <button onClick={onOpenCharacterFolder} type="button">
          Open Character Folder
        </button>
      </div>
      <div className="notice compact">
        {mode === "api"
          ? "Showing API characters loaded through the TypeScript SDK."
          : characters.some((character) => character.status === "Loaded from local character folder" || character.status === "local file")
            ? "Showing characters loaded from the local CharacterForgeAI folder."
            : "Showing sample characters for offline exploration. They are not cloud-synced and can be deleted."}
      </div>
      <div className={`connection-status ${folderStatus.state}`} role={folderStatus.state === "error" ? "alert" : "status"}>
        {folderStatus.message}
      </div>
      <p className="helper-text">Import/export location: {characterFolder.path}</p>
      {syncSummary.length ? (
        <div className="notice compact" role="status">
          <strong>Sync summary:</strong>
          <ul>
            {syncSummary.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {folderScanIssues.length ? (
        <div className="notice compact" role="status">
          <strong>Local scan warnings:</strong>
          <ul>
            {folderScanIssues.map((issue) => (
              <li key={`${issue.path}-${issue.error}`}>
                {issue.path}: {issue.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={`connection-status ${deleteStatus.state}`} role={deleteStatus.state === "error" ? "alert" : "status"}>
        {deleteStatus.message}
      </div>
      {characters.length ? (
        <div className="character-list">
          {characters.map((character) => (
            <article aria-label={character.name} className="character-card" key={character.id}>
              <div>
                <h2>{character.name}</h2>
                <p>{character.archetype}</p>
              </div>
              <span className="status-pill">{character.status}</span>
              <div className="button-row" aria-label={`${character.name} sync badges`}>
                <span className="status-pill">{sourceLabel(character)}</span>
                <span className="status-pill">{syncLabel(character)}</span>
              </div>
              {character.syncError ? <p className="warning">Sync error: {character.syncError}</p> : null}
              <p>{character.description}</p>
              <div className="button-row">
                <button onClick={() => onEditCharacter(character)} type="button">
                  Edit {character.name}
                </button>
                <button className="danger-button" onClick={() => onRequestDelete(character)} type="button">
                  Delete {character.name}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>No characters yet</h2>
          <p>Create a character or import a local character pack to begin.</p>
        </div>
      )}

      {pendingDelete ? (
        <div aria-labelledby="delete-character-title" aria-modal="true" className="modal-panel" role="alertdialog">
          <h2 id="delete-character-title">Delete {pendingDelete.name}?</h2>
          <p>
            {mode === "api"
              ? `Delete ${pendingDelete.name} through the connected CharacterForge API, then remove the local folder copy and index after the backend confirms success.`
              : `Delete this local character record from the local character storage/index. This does not call the CharacterForge API.`}
          </p>
          <div className="button-row">
            <button onClick={onCancelDelete} type="button">
              Cancel delete
            </button>
            <button className="danger-button" disabled={deleteStatus.state === "loading"} onClick={onConfirmDelete} type="button">
              Confirm delete
            </button>
          </div>
        </div>
      ) : null}

      {editingVisible ? (
        <CharacterEditorDialog
          form={editor.form}
          onCancel={editor.onCancel}
          onFormChange={editor.onFormChange}
          onSubmit={editor.onSubmit}
          previewPayload={editor.previewPayload}
          status={editor.status}
          validationErrors={editor.validationErrors}
        />
      ) : null}

      {packTools.visible ? (
        <CharacterPacksScreen
          exportState={packTools.exportState}
          loadedPack={packTools.loadedPack}
          onExportSelected={packTools.onExportSelected}
          onFileLoad={packTools.onFileLoad}
          onImportSelected={packTools.onImportSelected}
          onSelectionChange={packTools.onSelectionChange}
          selectedCharacterIds={packTools.selectedCharacterIds}
          status={packTools.status}
        />
      ) : null}
    </section>
  );
}

function CharacterEditorDialog({
  form,
  onCancel,
  onFormChange,
  onSubmit,
  status,
  validationErrors,
  previewPayload
}: {
  form: CharacterEditorForm;
  onCancel: () => void;
  onFormChange: (form: CharacterEditorForm) => void;
  onSubmit: () => void;
  status: EditorStatus;
  validationErrors: string[];
  previewPayload: CharacterPayload | null;
}) {
  function updateField(field: keyof Omit<CharacterEditorForm, "customActions">, value: string) {
    onFormChange({ ...form, [field]: value });
  }

  function addCustomAction() {
    onFormChange({
      ...form,
      customActions: [
        ...form.customActions,
        { id: nextActionId(form.customActions), actionName: "", triggerInstructions: "", payloadTemplate: "{}" }
      ]
    });
  }

  function updateCustomAction(actionId: string, field: keyof Omit<CharacterActionDefinition, "id">, value: string) {
    onFormChange({
      ...form,
      customActions: form.customActions.map((action) => (action.id === actionId ? { ...action, [field]: value } : action))
    });
  }

  function deleteCustomAction(actionId: string) {
    onFormChange({
      ...form,
      customActions: form.customActions.filter((action) => action.id !== actionId)
    });
  }

  const dialogTitle = form.characterId ? `Edit ${form.name || "character"}` : "Create Character";

  return (
    <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <p className="eyebrow">Create or edit profile</p>
      <h1 id="editor-title">{dialogTitle}</h1>
      <p>
        Build a complete CharacterForge profile in this dialog. Character IDs stay hidden as backend or local implementation details.
      </p>
      <div className="editor-grid">
        <label className="field">
          Character name
          <input value={form.name} onChange={(event) => updateField("name", event.target.value)} />
        </label>
        <label className="field">
          Title/Status
          <input value={form.titleStatus} onChange={(event) => updateField("titleStatus", event.target.value)} />
        </label>
        <label className="field field-wide">
          Description
          <textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} />
        </label>
        <label className="field">
          Personality traits
          <textarea value={form.personality} onChange={(event) => updateField("personality", event.target.value)} />
        </label>
        <label className="field">
          Goals
          <textarea value={form.goals} onChange={(event) => updateField("goals", event.target.value)} />
        </label>
        <label className="field field-wide">
          Backstory
          <textarea value={form.backstory} onChange={(event) => updateField("backstory", event.target.value)} />
        </label>
        <label className="field field-wide">
          Speaking style
          <textarea value={form.speakingStyle} onChange={(event) => updateField("speakingStyle", event.target.value)} />
        </label>
        <label className="field field-wide">
          World context
          <textarea value={form.worldContext} onChange={(event) => updateField("worldContext", event.target.value)} />
        </label>
        <label className="field field-wide">
          Roleplay rules
          <textarea value={form.rules} onChange={(event) => updateField("rules", event.target.value)} />
        </label>
      </div>

      <div className="section-heading-row">
        <h2>Custom Actions</h2>
        <button type="button" onClick={addCustomAction}>
          Create New Action
        </button>
      </div>
      {form.customActions.length ? (
        <div className="action-editor-list">
          {form.customActions.map((action, index) => (
            <fieldset className="action-editor-card" key={action.id} aria-label={`Custom action ${index + 1}`}>
              <legend>Custom action {index + 1}</legend>
              <label className="field">
                Action Name
                <input value={action.actionName} onChange={(event) => updateCustomAction(action.id, "actionName", event.target.value)} />
              </label>
              <label className="field">
                Trigger Instructions
                <textarea
                  value={action.triggerInstructions}
                  onChange={(event) => updateCustomAction(action.id, "triggerInstructions", event.target.value)}
                />
              </label>
              <label className="field">
                Payload Template
                <textarea value={action.payloadTemplate} onChange={(event) => updateCustomAction(action.id, "payloadTemplate", event.target.value)} />
              </label>
              <button className="danger-button" type="button" onClick={() => deleteCustomAction(action.id)}>
                Delete Action
              </button>
            </fieldset>
          ))}
        </div>
      ) : (
        <div className="notice compact">No custom actions yet. Use Create New Action to add action names, triggers, and payload templates.</div>
      )}

      {validationErrors.length ? (
        <div className="connection-status error" role="alert">
          {validationErrors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      ) : null}
      <div className={`connection-status ${status.state}`} role="status">
        {status.message}
      </div>
      <div className="button-row">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onSubmit}>
          Submit character
        </button>
      </div>
      <h2>Exact JSON payload preview</h2>
      <pre aria-label="Exact JSON payload preview" className="json-preview">
        {formatJson(previewPayload ?? { error: "Fix validation issues to preview a submittable payload." })}
      </pre>
    </div>
  );
}

function CharacterPacksScreen({
  exportState,
  loadedPack,
  onExportSelected,
  onFileLoad,
  onImportSelected,
  onSelectionChange,
  selectedCharacterIds,
  status
}: {
  exportState: PackExportState | null;
  loadedPack: LoadedPack | null;
  onExportSelected: () => void;
  onFileLoad: (files: FileList | null) => void;
  onImportSelected: () => void;
  onSelectionChange: (characterIds: string[]) => void;
  selectedCharacterIds: string[];
  status: PackStatus;
}) {
  const validPack = loadedPack && !loadedPack.errors.length ? loadedPack : null;

  function toggleCharacter(characterId: string) {
    onSelectionChange(
      selectedCharacterIds.includes(characterId)
        ? selectedCharacterIds.filter((selectedId) => selectedId !== characterId)
        : [...selectedCharacterIds, characterId]
    );
  }

  return (
    <section className="screen-card" aria-labelledby="packs-title">
      <p className="eyebrow">Local pack tools</p>
      <h1 id="packs-title">Character Folder Import-Export</h1>
      <p>
        Load a local pack JSON file, extracted pack folder, or zip archive in the browser, validate it, preview contents,
        import selected characters, and export selected characters with payload templates and bindings.
      </p>
      <div className="notice compact">
        File parsing and export generation happen locally in the browser. Only the Import button calls the configured
        CharacterForge API.
      </div>
      <label className="field">
        Load pack JSON, folder, or zip
        <input
          accept=".json,.zip,application/json,application/zip"
          multiple
          onChange={(event) => onFileLoad(event.target.files)}
          type="file"
        />
      </label>
      <label className="field">
        Load extracted pack folder
        <input
          multiple
          onChange={(event) => onFileLoad(event.target.files)}
          type="file"
          {...({ webkitdirectory: "" } as Record<string, string>)}
        />
      </label>
      <div className={`connection-status ${status.state}`} role={status.state === "error" ? "alert" : "status"}>
        {status.message}
      </div>
      {loadedPack?.errors.length ? (
        <div className="connection-status error" role="alert">
          {loadedPack.errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      ) : null}
      {validPack ? (
        <>
          <div className="summary-grid">
            <SummaryCard label="Pack" value={validPack.manifest.name} />
            <SummaryCard label="Characters" value={`${validPack.manifest.characters.length} characters`} />
            <SummaryCard label="Bindings" value={`${validPack.manifest.bindings?.length ?? 0} binding${(validPack.manifest.bindings?.length ?? 0) === 1 ? "" : "s"}`} />
          </div>
          <div className="character-list">
            {validPack.manifest.characters.map((character) => (
              <article className="character-card" key={character.id}>
                <div>
                  <label className="checkbox-field">
                    <input
                      checked={selectedCharacterIds.includes(character.id)}
                      onChange={() => toggleCharacter(character.id)}
                      type="checkbox"
                    />
                    {character.name ?? character.id}
                  </label>
                  <p>{character.description ?? validPack.characterDocuments[character.path]?.description}</p>
                </div>
                <span className="status-pill">{character.id}</span>
                <p>
                  Payload templates: {validPack.characterDocuments[character.path]?.payload_templates.length ?? 0} · Actions: {validPack.characterDocuments[character.path]?.allowed_actions.join(", ")}
                </p>
              </article>
            ))}
          </div>
          <div className="button-row">
            <button disabled={!selectedCharacterIds.length} onClick={onImportSelected} type="button">
              Import selected characters
            </button>
            <button disabled={!selectedCharacterIds.length} onClick={onExportSelected} type="button">
              Export selected characters
            </button>
            {exportState ? (
              <a className="download-link" download={exportState.fileName} href={exportState.objectUrl}>
                Download {exportState.fileName}
              </a>
            ) : null}
            {exportState?.savedPath ? (
              <span className="status-pill">Saved to {exportState.savedPath}</span>
            ) : null}
          </div>
          <h2>Pack preview JSON</h2>
          <pre aria-label="Pack preview JSON" className="json-preview">
            {formatJson({ ...validPack.manifest, character_documents: validPack.characterDocuments, binding_documents: validPack.bindingDocuments })}
          </pre>
          {exportState ? (
            <>
              <h2>Export preview JSON</h2>
              <pre aria-label="Export preview JSON" className="json-preview">
                {formatJson(exportState.preview)}
              </pre>
            </>
          ) : null}
        </>
      ) : null}
      {!validPack ? (
        <div className="button-row">
          <button disabled type="button">
            Import selected characters
          </button>
          <button disabled type="button">
            Export selected characters
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ChatScreen({
  apiConnected,
  characters,
  onOpenDeployment,
  settings
}: {
  apiConnected: boolean;
  characters: Character[];
  onOpenDeployment: () => void;
  settings: ApiSettings;
}) {
  const syncedCharacters = characters.filter(
    (character) => character.syncStatus === "api_synced" && (character.source === "api" || character.source === "api_local")
  );
  const syncedCharacterKey = syncedCharacters.map((character) => `${character.id}:${character.name}:${character.syncStatus ?? ""}:${character.source ?? ""}`).join("|");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [transcript, setTranscript] = useState<ChatTranscriptMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);
  const [chatStatus, setChatStatus] = useState<ConnectionStatus>({ message: "Select a synced character to begin.", state: "idle" });

  useEffect(() => {
    if (!apiConnected || !syncedCharacters.length) {
      setSelectedCharacterId("");
      setTranscript([]);
      setLastResponse(null);
      return;
    }
    if (!selectedCharacterId || !syncedCharacters.some((character) => character.id === selectedCharacterId)) {
      setSelectedCharacterId(syncedCharacters[0].id);
      setTranscript([]);
      setLastResponse(null);
      setChatStatus({ message: `Loaded character: ${syncedCharacters[0].name}.`, state: "success" });
    }
  }, [apiConnected, selectedCharacterId, syncedCharacterKey]);

  const selectedCharacter = syncedCharacters.find((character) => character.id === selectedCharacterId) ?? syncedCharacters[0];

  async function handleSendChat() {
    if (!apiConnected || !selectedCharacter || !messageDraft.trim()) {
      return;
    }
    const outgoingText = messageDraft.trim();
    setMessageDraft("");
    setTranscript((messages) => [...messages, { id: `player-${Date.now()}`, speaker: "Player", text: outgoingText }]);
    setChatStatus({ message: `Sending chat to ${selectedCharacter.name}...`, state: "loading" });
    try {
      const client = new CharacterForgeClient({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey || undefined });
      const response = await client.chat(selectedCharacter.id, {
        context: {
          allowed_actions: selectedCharacter.allowedActions,
          character_name: selectedCharacter.name,
          source: selectedCharacter.source ?? "api",
          sync_status: selectedCharacter.syncStatus ?? "api_synced"
        },
        message: outgoingText,
        player_id: "dashboard-player",
        session_id: `dashboard-chat-${selectedCharacter.id}`
      });
      setLastResponse(response);
      setTranscript((messages) => [
        ...messages,
        {
          actions: response.actions?.map((action) => ({ type: action.type, payload: action.payload })),
          emotion: response.emotion,
          id: `character-${Date.now()}`,
          speaker: selectedCharacter.name,
          text: response.message
        }
      ]);
      setChatStatus({ message: `Chat response loaded for ${selectedCharacter.name}.`, state: "success" });
    } catch (error) {
      setChatStatus({ message: error instanceof Error ? `Chat failed: ${error.message}` : "Chat failed.", state: "error" });
    }
  }

  if (!apiConnected) {
    return (
      <section className="screen-card" aria-labelledby="chat-title">
        <p className="eyebrow">Live character chat</p>
        <h1 id="chat-title">Chat</h1>
        <div className="notice empty-state">
          <strong>Connect your deployment before chatting with characters.</strong>
          <p>Chat uses the live CharacterForge API and synced characters. Go to Deployment, enter the API details, and test the connection first.</p>
          <button onClick={onOpenDeployment} type="button">Open Deployment</button>
        </div>
      </section>
    );
  }

  if (!syncedCharacters.length) {
    return (
      <section className="screen-card" aria-labelledby="chat-title">
        <p className="eyebrow">Live character chat</p>
        <h1 id="chat-title">Chat</h1>
        <div className="notice empty-state">
          <strong>No synced characters are ready for Chat yet.</strong>
          <p>Create or sync a character from the Characters page, then return here to chat with the live API.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="screen-card" aria-labelledby="chat-title">
      <p className="eyebrow">Live character chat</p>
      <h1 id="chat-title">Chat</h1>
      <div className={`notice compact ${chatStatus.state === "error" ? "danger" : ""}`}>{chatStatus.message}</div>
      <label className="field">
        <span>Select Character</span>
        <select
          aria-label="Select Character"
          onChange={(event) => {
            const nextCharacter = syncedCharacters.find((character) => character.id === event.target.value);
            setSelectedCharacterId(event.target.value);
            setTranscript([]);
            setLastResponse(null);
            if (nextCharacter) {
              setChatStatus({ message: `Loaded character: ${nextCharacter.name}.`, state: "success" });
            }
          }}
          value={selectedCharacter?.id ?? ""}
        >
          {syncedCharacters.map((character) => (
            <option key={character.id} value={character.id}>{character.name}</option>
          ))}
        </select>
      </label>
      {selectedCharacter ? (
        <div className="notice compact">
          <strong>Loaded character: {selectedCharacter.name}</strong>
          <p>{selectedCharacter.description}</p>
          <p>Allowed actions: {selectedCharacter.allowedActions.length ? selectedCharacter.allowedActions.join(", ") : "None configured"}</p>
        </div>
      ) : null}
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSendChat();
        }}
      >
        <label className="field">
          <span>Player Message</span>
          <textarea
            aria-label="Player Message"
            onChange={(event) => setMessageDraft(event.target.value)}
            placeholder="Ask the selected character something..."
            rows={3}
            value={messageDraft}
          />
        </label>
        <button disabled={!messageDraft.trim() || chatStatus.state === "loading"} type="submit">Send Chat</button>
      </form>
      <div className="chat-window" aria-label="Chat transcript">
        {transcript.length ? transcript.map((message) => (
          <article className="chat-message" key={message.id}>
            <strong>{message.speaker}</strong>
            <p>{message.text}</p>
            {message.emotion ? <span className="status-pill">Emotion: {message.emotion}</span> : null}
          </article>
        )) : <p className="muted">Send a message to start the transcript.</p>}
      </div>
      <section className="action-panel" aria-labelledby="chat-payload-title">
        <h2 id="chat-payload-title">Returned payloads and actions</h2>
        {lastResponse ? <pre className="json-preview">{formatJson(lastResponse)}</pre> : <p>No payload returned yet.</p>}
      </section>
    </section>
  );
}

function RawJsonPreviewScreen({
  characters,
  connectionStatus,
  editorPayload,
  settings,
  sharedState
}: {
  characters: Character[];
  connectionStatus: ConnectionStatus;
  editorPayload: CharacterPayload | null;
  settings: ApiSettings;
  sharedState: SharedDashboardState;
}) {
  const rawJson = useMemo(
    () =>
      JSON.stringify(
        {
          settings: {
            apiBaseUrl: settings.apiBaseUrl || "<mock mode>",
            apiKey: settings.apiKey ? "<hidden>" : "<not set>"
          },
          connectionStatus,
          sharedDashboardState: sharedState,
          sampleCharacters: mockCharacters.map((character) => ({
            id: character.id,
            name: character.name,
            status: character.status,
            note: "Sample only; not cloud-synced."
          })),
          activeCharacters: characters,
          editorPayloadPreview: editorPayload
        },
        null,
        2
      ),
    [characters, connectionStatus, editorPayload, settings, sharedState]
  );

  return (
    <section className="screen-card" aria-labelledby="json-title">
      <p className="eyebrow">Developer view</p>
      <h1 id="json-title">Raw JSON Preview</h1>
      <pre className="json-preview">{rawJson}</pre>
    </section>
  );
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>("welcome");
  const [settings, setSettings] = useState<ApiSettings>(() => loadInitialSettings());
  const [draftSettings, setDraftSettings] = useState<ApiSettings>(() => loadInitialSettings());
  const [testedApiConnectionSettings, setTestedApiConnectionSettings] = useState<ApiSettings | null>(null);
  const [apiCharacters, setApiCharacters] = useState<Character[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() => ({
    message: loadInitialSettings().apiBaseUrl
      ? "API settings loaded. Test the connection to refresh characters."
      : "No API Base URL configured yet. Open Deployment to connect a deployed API.",
    state: loadInitialSettings().apiBaseUrl ? "idle" : "mock"
  }));
  const [editorForm, setEditorForm] = useState<CharacterEditorForm>(() => createInitialEditorForm(mockCharacters[0]));
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({
    message: "Ready to preview and submit a character profile.",
    state: "idle"
  });
  const [charactersEditorVisible, setCharactersEditorVisible] = useState(false);
  const [characterPackToolsVisible, setCharacterPackToolsVisible] = useState(false);
  const [characterFolder, setCharacterFolder] = useState<CharacterFolderInfo>({ path: browserCharacterFolderPath, browserMode: !hasTauriInvoke() });
  const [folderCharacters, setFolderCharacters] = useState<Character[]>([]);
  const [folderScanIssues, setFolderScanIssues] = useState<CharacterFolderScanIssue[]>([]);
  const [characterFolderStatus, setCharacterFolderStatus] = useState<CharacterFolderStatus>({
    message: "Open the default CharacterForgeAI folder to import/export local character files.",
    state: "idle"
  });
  const [pendingDeleteCharacter, setPendingDeleteCharacter] = useState<Character | null>(null);
  const [deletedCharacterIds, setDeletedCharacterIds] = useState<string[]>(() => loadLocalDeletedCharacterIds());
  const [characterDeleteStatus, setCharacterDeleteStatus] = useState<EditorStatus>({
    message: "Choose Edit or Delete on a character card, or create/import from the controls above.",
    state: "idle"
  });
  const [loadedPack, setLoadedPack] = useState<LoadedPack | null>(null);
  const [selectedPackCharacterIds, setSelectedPackCharacterIds] = useState<string[]>([]);
  const [packStatus, setPackStatus] = useState<PackStatus>({
    message: "Choose a local pack JSON file, extracted folder, or zip archive to begin.",
    state: "idle"
  });
  const [packExportState, setPackExportState] = useState<PackExportState | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(defaultAppConfig);
  const [updateStatus, setUpdateStatus] = useState<ConnectionStatus>({
    message: "Click Check for Updates to look for a desktop update.",
    state: "idle"
  });
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [showTutorial, setShowTutorial] = useState(true);
  const [setupCheckResult, setSetupCheckResult] = useState<SetupCheckResult | null>(null);
  const [setupCheckRequest, setSetupCheckRequest] = useState<SetupCheckForm | null>(null);
  const [awsSetupWizardResult, setAwsSetupWizardResult] = useState<AwsSetupWizardResult | null>(null);
  const [awsSetupWizardStatus, setAwsSetupWizardStatus] = useState<ConnectionStatus>({
    message: "AWS setup wizard not loaded yet.",
    state: "idle"
  });
  const [setupCheckStatus, setSetupCheckStatus] = useState<ConnectionStatus>({
    message: "Not checked yet.",
    state: "idle"
  });
  const [deploymentForm, setDeploymentForm] = useState<DeploymentStartRequest>(defaultDeploymentForm);
  const [deploymentPreview, setDeploymentPreview] = useState<DeploymentStartPreview | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<ConnectionStatus>({
    message: "Dry-run preview has not been generated yet.",
    state: "idle"
  });
  const [startSafetyConfirmed, setStartSafetyConfirmed] = useState(false);
  const [exportBeforeEndConfirmed, setExportBeforeEndConfirmed] = useState(false);
  const [exportBeforeEndStatus, setExportBeforeEndStatus] = useState<ConnectionStatus>({
    message: "No export has been requested for this End operation yet.",
    state: "idle"
  });
  const [endDeleteConfirmed, setEndDeleteConfirmed] = useState(false);
  const [deploymentStartResult, setDeploymentStartResult] = useState<DeploymentStartResult | null>(null);
  const [deploymentEndResult, setDeploymentEndResult] = useState<DeploymentEndResult | null>(null);

  const apiMode = Boolean(settings.apiBaseUrl.trim());
  const apiConnected = apiMode && connectionStatus.state === "success";
  const folderCharacterById = new Map(folderCharacters.map((character) => [character.id, character]));
  const localSourceCharacters = folderCharacters.length ? folderCharacters : mockCharacters.map((character) => ({ ...character, source: "mock" as const, syncStatus: "mock" as const }));
  const sourceCharacters = apiConnected
    ? [
        ...apiCharacters.map((apiCharacter) => {
          const localCopy = folderCharacterById.get(apiCharacter.id);
          if (!localCopy) {
            return { ...apiCharacter, source: "api" as const, syncStatus: "api_synced" as const };
          }
          return {
            ...apiCharacter,
            source: "api_local" as const,
            syncStatus: localCopy.syncStatus === "api_pending" || localCopy.syncStatus === "conflict" ? "conflict" as const : "api_synced" as const,
            syncError: localCopy.syncStatus === "api_pending" ? "Pending local changes exist for this API character." : localCopy.syncError
          };
        }),
        ...folderCharacters.filter((folderCharacter) => !apiCharacters.some((apiCharacter) => apiCharacter.id === folderCharacter.id))
      ]
    : localSourceCharacters;
  const activeCharacters = sourceCharacters.filter((character) => !deletedCharacterIds.includes(character.id));
  const pendingLocalChanges = folderCharacters.filter((character) => character.syncStatus === "api_pending" || character.syncStatus === "conflict");
  const syncSummary = [
    pendingLocalChanges.length
      ? `Pending local changes: ${pendingLocalChanges.length} character file${pendingLocalChanges.length === 1 ? " is" : "s are"} not synced yet.`
      : "",
    ...apiCharacters
      .filter((apiCharacter) => {
        const localCopy = folderCharacterById.get(apiCharacter.id);
        return localCopy?.syncStatus === "api_pending" || localCopy?.syncStatus === "conflict";
      })
      .map((apiCharacter) => `Conflict: ${apiCharacter.name} exists in both API and local folder with pending local changes.`)
  ].filter(Boolean);
  const sharedStateCharacters = activeCharacters;
  const deploymentConfig = useMemo(
    () =>
      buildDeploymentConfig({
        apiBaseUrl: settings.apiBaseUrl,
        awsRegion: deploymentForm.awsRegion,
        bedrockModel: deploymentForm.bedrockModel,
        profileName: deploymentForm.profileName,
        stackName: deploymentForm.stackName
      }),
    [deploymentForm.awsRegion, deploymentForm.bedrockModel, deploymentForm.profileName, deploymentForm.stackName, settings.apiBaseUrl]
  );
  const sharedDashboardState = useMemo(
    () =>
      buildSharedDashboardState({
        apiConnection: toApiConnectionStatus({
          apiBaseUrl: deploymentConfig.apiBaseUrl,
          message: connectionStatus.message,
          state: connectionStatus.state
        }),
        characterFolder: {
          message:
            characterFolderStatus.state === "success"
              ? characterFolderStatus.message
              : loadedPack
                ? loadedPack.errors.length
                  ? `Loaded ${loadedPack.manifest.name} with ${loadedPack.errors.length} local validation issue(s).`
                  : `Loaded ${loadedPack.manifest.name} character pack for local review.`
                : "No local character folder or pack has been loaded yet.",
          path: characterFolder.path || (loadedPack ? loadedPack.manifest.slug : undefined),
          state: characterFolderStatus.state === "success" || loadedPack ? (loadedPack?.errors.length ? "error" : "ready") : "not_configured"
        },
        characters: sharedStateCharacters.map((character) =>
          toCharacterRecord({
            allowedActions: character.allowedActions,
            archetype: character.archetype,
            description: character.description,
            id: character.id,
            name: character.name,
            status: character.status,
            syncStatus: character.syncStatus ?? (apiConnected ? "api_synced" : "mock")
          })
        ),
        deployment: toDeploymentStatus({
          configured: Boolean(deploymentConfig.stackName),
          message: deploymentStatus.message,
          stackStatus: deploymentStartResult?.finalStackStatus ?? deploymentEndResult?.finalStackStatus,
          state: deploymentStatus.state
        }),
        selectedCharacterId: sharedStateCharacters[0]?.id
      }),
    [
      sharedStateCharacters,
      apiCharacters.length,
      apiConnected,
      connectionStatus.message,
      connectionStatus.state,
      deploymentConfig.apiBaseUrl,
      deploymentConfig.stackName,
      deploymentEndResult?.finalStackStatus,
      deploymentStartResult?.finalStackStatus,
      deploymentStatus.message,
      deploymentStatus.state,
      loadedPack,
      characterFolder.path,
      characterFolderStatus.message,
      characterFolderStatus.state
    ]
  );
  const dashboardReadiness = useMemo(() => getDashboardReadiness(sharedDashboardState), [sharedDashboardState]);
  const editorPayloadResult = useMemo(() => buildCharacterPayload(editorForm), [editorForm]);
  const editorValidationErrors = editorPayloadResult.errors;
  const editorPayload = editorPayloadResult.payload;

  useEffect(() => {
    let active = true;
    loadAppConfig()
      .then((config) => {
        if (!active) {
          return;
        }
        setAppConfig(config);
        setShowTutorial(!config.firstRunTutorialCompleted && !config.firstRunTutorialSkipped);
      })
      .catch(() => {
        if (active) {
          setShowTutorial(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function persistAppConfig(nextConfig: Partial<AppConfig>) {
    const normalized = normalizeAppConfig({ ...appConfig, ...nextConfig });
    setAppConfig(normalized);
    void saveAppConfig(normalized).catch(() => {
      setAppConfig(appConfig);
    });
  }

  function handleTutorialComplete() {
    persistAppConfig({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
    setShowTutorial(false);
    setActiveScreen("deployment");
  }

  function handleSkipTutorial() {
    persistAppConfig({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: true });
    setShowTutorial(false);
  }

  function handleReopenTutorial() {
    setTutorialStepIndex(0);
    setShowTutorial(true);
  }

  async function handleCheckForUpdates() {
    setUpdateCheckResult(null);
    setUpdateStatus({ message: "Checking for updates...", state: "loading" });
    try {
      const result = await checkForUpdates();
      setUpdateCheckResult(result);
      if (result.available) {
        setUpdateStatus({ message: "Update available.", state: "success" });
      } else {
        setUpdateStatus({ message: "You are up to date.", state: "success" });
      }
    } catch {
      setUpdateCheckResult(null);
      setUpdateStatus({ message: "Could not check for updates.", state: "error" });
    }
  }

  async function handleInstallUpdate() {
    setUpdateStatus({ message: "Starting update...", state: "loading" });
    try {
      await installUpdate();
      setUpdateStatus({ message: "Update started.", state: "success" });
    } catch {
      setUpdateStatus({ message: "Could not start the update.", state: "error" });
    }
  }

  function handleSaveSettings() {
    const nextSettings = {
      apiBaseUrl: draftSettings.apiBaseUrl.trim(),
      apiKey: draftSettings.apiKey.trim()
    };
    setSettings(nextSettings);
    saveSettings(nextSettings);
    if (!nextSettings.apiBaseUrl) {
      setApiCharacters([]);
      setTestedApiConnectionSettings(null);
      setConnectionStatus({ message: "No API Base URL configured yet. Open Deployment to connect a deployed API.", state: "mock" });
    } else {
      setTestedApiConnectionSettings(null);
      setConnectionStatus({ message: "API settings saved. Test the connection to load characters.", state: "idle" });
    }
  }

  async function handleTestConnection() {
    const nextSettings = {
      apiBaseUrl: draftSettings.apiBaseUrl.trim(),
      apiKey: draftSettings.apiKey.trim()
    };

    if (!nextSettings.apiBaseUrl) {
      setSettings(nextSettings);
      saveSettings(nextSettings);
      setApiCharacters([]);
      setTestedApiConnectionSettings(null);
      setConnectionStatus({ message: "No API Base URL configured yet. Open Deployment to connect a deployed API.", state: "mock" });
      return;
    }

    setSettings(nextSettings);
    saveSettings(nextSettings);
    setConnectionStatus({ message: "Testing CharacterForge API connection...", state: "loading" });

    try {
      const client = new CharacterForgeClient({ baseUrl: nextSettings.apiBaseUrl, apiKey: nextSettings.apiKey || undefined });
      const response = await client.listCharacters();
      const characters = response.characters.map(toDashboardCharacter);
      setApiCharacters(characters);
      setTestedApiConnectionSettings(nextSettings);
      setConnectionStatus({
        message: `Connected to CharacterForge API. Loaded ${characters.length} character${characters.length === 1 ? "" : "s"}.`,
        state: "success"
      });
    } catch (error) {
      setApiCharacters([]);
      setTestedApiConnectionSettings(null);
      setConnectionStatus({
        message: error instanceof Error ? `Connection failed: ${error.message}` : "Connection failed.",
        state: "error"
      });
    }
  }

  function getDeploymentSetupForm(): SetupCheckForm {
    return {
      awsRegion: deploymentForm.awsRegion,
      bedrockModel: deploymentForm.bedrockModel,
      profileName: deploymentForm.profileName,
      stackName: deploymentForm.stackName
    };
  }

  async function handleRunSetupCheck() {
    const desktopMode = hasTauriInvoke();
    setSetupCheckStatus({ message: desktopMode ? "Running desktop setup readiness check..." : "Running browser preview setup check...", state: "loading" });
    try {
      const request = getDeploymentSetupForm();
      const result = await runSetupReadinessCheck(request);
      setSetupCheckRequest(request);
      setSetupCheckResult(result);
      setSetupCheckStatus({
        message: desktopMode ? "Desktop setup readiness check complete." : "Browser preview setup check complete.",
        state: "success"
      });
    } catch (error) {
      setSetupCheckStatus({ message: error instanceof Error ? error.message : "Setup check failed.", state: "error" });
    }
  }

  async function handleRunAwsSetupWizard() {
    setAwsSetupWizardStatus({ message: "Loading credential-safe AWS setup wizard...", state: "loading" });
    try {
      const result = await runAwsSetupWizardCheck(getDeploymentSetupForm());
      setAwsSetupWizardResult(result);
      setAwsSetupWizardStatus({ message: "AWS setup wizard ready.", state: "success" });
    } catch (error) {
      setAwsSetupWizardStatus({ message: error instanceof Error ? error.message : "AWS setup wizard failed.", state: "error" });
    }
  }

  async function handlePreviewDeploymentStart() {
    setDeploymentStatus({ message: "Building dry-run deployment preview...", state: "loading" });
    const preview = await createDeploymentAdapter().previewStart(deploymentForm);
    setDeploymentPreview(preview);
    setDeploymentStatus({ message: "Dry-run deployment preview ready.", state: "success" });
  }

  async function scanLocalCharactersAfterStart(): Promise<{ readyCount: number; invalidCount: number }> {
    const scan = await scanCharacterFolder();
    if (!isSafeCharacterFolderPath(scan.folderPath)) {
      setCharacterFolder({ path: scan.folderPath, browserMode: false });
      setFolderCharacters([]);
      setFolderScanIssues([]);
      setCharacterFolderStatus({ message: "Failed: character folder path must stay under CharacterForgeAI app data.", state: "error" });
      throw new Error("character folder path must stay under CharacterForgeAI app data");
    }

    const readyCount = scan.characters.filter((character) => character.syncStatus === "api_pending" || character.syncStatus === "conflict" || character.source === "local").length;
    setCharacterFolder({ path: scan.folderPath, browserMode: false });
    setFolderCharacters(scan.characters);
    setFolderScanIssues(scan.invalidFiles);
    setCharacterFolderStatus({
      message: readyCount
        ? `Found ${readyCount} local character${readyCount === 1 ? "" : "s"} ready to sync after Start. Review or sync them from Characters before overwriting cloud records.`
        : "Start scanned the local CharacterForgeAI character folder. No local characters are ready to sync.",
      state: "success"
    });
    return { readyCount, invalidCount: scan.invalidFiles.length };
  }

  async function handleRealDeploymentStart() {
    const requiredConfirmation = `START ${deploymentForm.stackName.trim() || "characterforge-ai-dev"}`;
    const adapter = createDeploymentAdapter();
    if (!isRealDeploymentAdapter(adapter)) {
      setDeploymentStatus({ message: "Deployment Start is available only inside the Tauri desktop shell.", state: "error" });
      return;
    }
    const startDisabledReasons = getDeploymentStartDisabledReasons({
      connectionStatus,
      form: deploymentForm,
      isDesktopShell: true,
      settings: draftSettings,
      setupCheckRequest,
      setupResult: setupCheckResult,
      startSafetyConfirmed,
      testedApiSettings: testedApiConnectionSettings
    });
    if (startDisabledReasons.length > 0) {
      setDeploymentStatus({ message: `Deployment Start blocked until you ${startDisabledReasons.join(", ")}.`, state: "error" });
      return;
    }

    setDeploymentStartResult(null);
    setDeploymentStatus({ message: "Running deployment Start through the desktop shell...", state: "loading" });
    try {
      const result = await adapter.start(deploymentForm, { confirmationText: requiredConfirmation });
      setDeploymentStartResult(result);
      let localScanSummary = "";
      if (result.status === "succeeded") {
        try {
          const scanSummary = await scanLocalCharactersAfterStart();
          localScanSummary = scanSummary.readyCount
            ? ` Found ${scanSummary.readyCount} local character${scanSummary.readyCount === 1 ? "" : "s"} ready to sync; review them in Characters before syncing.`
            : " No local characters are ready to sync.";
          if (scanSummary.invalidCount) {
            localScanSummary += ` ${scanSummary.invalidCount} invalid local file${scanSummary.invalidCount === 1 ? "" : "s"} ${scanSummary.invalidCount === 1 ? "needs" : "need"} review.`;
          }
        } catch (scanError) {
          setFolderCharacters([]);
          setFolderScanIssues([]);
          setCharacterFolderStatus({
            message: scanError instanceof Error ? `Failed: could not scan local character folder after Start: ${scanError.message}` : "Failed: could not scan local character folder after Start.",
            state: "error"
          });
          localScanSummary = " Local character folder scan failed; open Characters to review the folder before syncing.";
        }
      }
      setDeploymentStatus({
        message:
          result.status === "succeeded"
            ? `Deployment Start completed with ${result.finalStackStatus}. Non-secret outputs were saved locally.${localScanSummary}`
            : `Deployment Start ended with ${result.finalStackStatus}. Review the redacted log below.`,
        state: result.status === "succeeded" ? "success" : "error"
      });
    } catch (error) {
      setDeploymentStatus({
        message: error instanceof Error ? `Deployment Start blocked: ${error.message}` : "Deployment Start failed before commands ran.",
        state: "error"
      });
    }
  }

  async function handleExportCharactersBeforeEnd() {
    if (packExportState) {
      URL.revokeObjectURL(packExportState.objectUrl);
    }
    const exportPack = buildDashboardCharacterExportPack(activeCharacters);
    const fileName = `${exportPack.slug}.json`;
    setExportBeforeEndStatus({ message: "Exporting characters before End...", state: "loading" });
    setExportBeforeEndConfirmed(false);
    try {
      const objectUrl = downloadJsonFile(exportPack);
      const savedExport = await saveCharacterPackExport(fileName, exportPack);
      setPackExportState({ fileName, objectUrl, preview: exportPack, savedPath: savedExport?.path });
      setExportBeforeEndStatus({
        message: savedExport
          ? `Exported ${exportPack.characters.length} character${exportPack.characters.length === 1 ? "" : "s"} before End to ${savedExport.path}.`
          : `Prepared browser export for ${exportPack.characters.length} character${exportPack.characters.length === 1 ? "" : "s"} before End. Save the download locally before deleting the stack.`,
        state: "success"
      });
      setExportBeforeEndConfirmed(true);
    } catch (error) {
      setExportBeforeEndStatus({
        message: error instanceof Error ? `Export before End failed: ${error.message}. Delete is blocked until export succeeds.` : "Export before End failed. Delete is blocked until export succeeds.",
        state: "error"
      });
      setExportBeforeEndConfirmed(false);
    }
  }

  async function handleRealDeploymentEnd() {
    const requiredConfirmation = `END ${deploymentForm.stackName.trim() || "characterforge-ai-dev"}`;
    if (exportBeforeEndStatus.state === "error") {
      setDeploymentStatus({ message: "Deployment End blocked because the requested character export failed. Export successfully before deleting the stack.", state: "error" });
      return;
    }
    if (!exportBeforeEndConfirmed || !endDeleteConfirmed) {
      setDeploymentStatus({ message: "Confirm character export/save choice and deletion warnings before running deployment End.", state: "error" });
      return;
    }
    const adapter = createDeploymentAdapter();
    if (!isRealDeploymentAdapter(adapter)) {
      setDeploymentStatus({ message: "Deployment End is available only inside the Tauri desktop shell.", state: "error" });
      return;
    }

    setDeploymentEndResult(null);
    setDeploymentStatus({ message: "Running deployment End through the desktop shell...", state: "loading" });
    try {
      const result = await adapter.end(deploymentForm, {
        confirmationText: requiredConfirmation,
        exportConfirmed: exportBeforeEndConfirmed
      });
      setDeploymentEndResult(result);
      setDeploymentStatus({
        message:
          result.status === "succeeded"
            ? `Deployment End completed with ${result.finalStackStatus}.`
            : result.status === "cancelled"
              ? "Deployment End cancelled before commands ran."
              : `Deployment End ended with ${result.finalStackStatus}. Review the redacted log below.`,
        state: result.status === "succeeded" ? "success" : result.status === "cancelled" ? "idle" : "error"
      });
    } catch (error) {
      setDeploymentStatus({
        message: error instanceof Error ? `Deployment End blocked: ${error.message}` : "Deployment End failed before commands ran.",
        state: "error"
      });
    }
  }

  function handleCreateCharacterFromCharactersPage() {
    setEditorForm(createBlankEditorForm());
    setEditorStatus({ state: "idle", message: "Ready to create a new character profile." });
    setCharactersEditorVisible(true);
  }

  function handleEditCharacterFromCharactersPage(character: Character) {
    setEditorForm(createInitialEditorForm(character));
    setEditorStatus({ state: "idle", message: `Editing ${character.name}.` });
    setCharactersEditorVisible(true);
  }

  function handleCloseCharacterDialog() {
    setCharactersEditorVisible(false);
    setEditorStatus({ state: "idle", message: "Character dialog closed without saving." });
  }

  function handleRequestDeleteCharacter(character: Character) {
    setPendingDeleteCharacter(character);
    setCharacterDeleteStatus({ message: `Confirm before deleting ${character.name}.`, state: "idle" });
  }

  function markCharacterDeleted(characterId: string) {
    setDeletedCharacterIds((current) => {
      const next = [...new Set([...current, characterId])];
      saveLocalDeletedCharacterIds(next);
      return next;
    });
  }

  async function handleConfirmDeleteCharacter() {
    if (!pendingDeleteCharacter) {
      return;
    }
    const character = pendingDeleteCharacter;
    const apiDeleteMode = apiMode && connectionStatus.state === "success" && apiCharacters.some((apiCharacter) => apiCharacter.id === character.id);

    if (!apiDeleteMode) {
      setCharacterDeleteStatus({ message: `Saving: deleting ${character.name} from local character storage...`, state: "loading" });
      await deleteCharacterFile(character);
      markCharacterDeleted(character.id);
      setFolderCharacters((current) => current.filter((folderCharacter) => folderCharacter.id !== character.id));
      setCharacterDeleteStatus({ message: `Saved: deleted ${character.name} from local character storage.`, state: "success" });
      setPendingDeleteCharacter(null);
      return;
    }

    setCharacterDeleteStatus({ message: `Saving: deleting ${character.name} through the CharacterForge API...`, state: "loading" });
    try {
      const client = new CharacterForgeClient({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey || undefined });
      await client.deleteCharacter(character.id);
      await deleteCharacterFile(character);
      setApiCharacters((current) => current.filter((apiCharacter) => apiCharacter.id !== character.id));
      setFolderCharacters((current) => current.filter((folderCharacter) => folderCharacter.id !== character.id));
      markCharacterDeleted(character.id);
      setCharacterDeleteStatus({ message: `Saved: deleted ${character.name} from the API and local index; local folder copy removed after success.`, state: "success" });
      setPendingDeleteCharacter(null);
    } catch (error) {
      setCharacterDeleteStatus({
        message:
          error instanceof Error
            ? `Failed: could not delete ${character.name} from the API: ${error.message}`
            : `Failed: could not delete ${character.name} from the API.`,
        state: "error"
      });
      setPendingDeleteCharacter(null);
    }
  }

  async function handleSubmitCharacter() {
    if (editorValidationErrors.length || !editorPayload) {
      setEditorStatus({ message: "Fix validation issues before submitting the character profile.", state: "error" });
      return;
    }

    const existingId = editorForm.characterId.trim();
    const existingCharacter = existingId ? activeCharacters.find((character) => character.id === existingId) : undefined;
    const pendingLocalCharacter = existingCharacter?.source === "local" || existingCharacter?.syncStatus === "api_pending" || existingCharacter?.syncStatus === "conflict";
    const fallbackLocalId = existingId || localIdForPayload(editorPayload);

    if (!apiConnected) {
      const localCharacter = characterFromPayload(fallbackLocalId, editorPayload, {
        source: "local",
        syncStatus: "api_pending",
        status: editorForm.titleStatus.trim() || "Not synced yet"
      });
      setEditorStatus({ message: `Saving: writing ${localCharacter.name} to the local character folder...`, state: "loading" });
      try {
        await saveCharacterFile(localCharacter);
        setFolderCharacters((current) => [...current.filter((character) => character.id !== localCharacter.id), localCharacter]);
        setEditorStatus({ message: `Not synced yet: saved ${localCharacter.name} to the local character folder.`, state: "success" });
      } catch (error) {
        setEditorStatus({
          message: error instanceof Error ? `Failed: could not save local character file: ${error.message}` : "Failed: could not save local character file.",
          state: "error"
        });
      }
      return;
    }

    setEditorStatus({ message: "Saving: syncing character profile to the CharacterForge API...", state: "loading" });
    const client = new CharacterForgeClient({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey || undefined });
    let apiCharacterId = pendingLocalCharacter ? "" : existingId;
    let apiOperation: "created" | "updated" = apiCharacterId ? "updated" : "created";
    try {
      if (apiCharacterId) {
        await client.updateCharacter(apiCharacterId, editorPayload);
      } else {
        const response = await client.createCharacter(editorPayload);
        apiCharacterId = responseCharacterId(response, fallbackLocalId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "character sync failed";
      const pendingCharacter = characterFromPayload(fallbackLocalId, editorPayload, {
        source: "local",
        syncStatus: "conflict",
        syncError: message,
        status: editorForm.titleStatus.trim() || "Sync failed"
      });
      try {
        await saveCharacterFile(pendingCharacter);
        setFolderCharacters((current) => [...current.filter((character) => character.id !== pendingCharacter.id), pendingCharacter]);
      } catch {
        // Keep the API error as the primary user-facing failure.
      }
      setEditorStatus({
        message: `Failed sync: ${message}. ${pendingCharacter.name} was kept as a pending local change.`,
        state: "error"
      });
      return;
    }

    const syncedCharacter = characterFromPayload(apiCharacterId, editorPayload, {
      source: "api",
      syncStatus: "api_synced",
      status: editorForm.titleStatus.trim() || "Cloud synced"
    });
    setApiCharacters((current) => [...current.filter((character) => character.id !== syncedCharacter.id), syncedCharacter]);
    try {
      await saveCharacterFile(syncedCharacter);
      if (pendingLocalCharacter && existingId && existingId !== syncedCharacter.id && existingCharacter) {
        await deleteCharacterFile(existingCharacter);
      }
      setFolderCharacters((current) => [
        ...current.filter((character) => character.id !== syncedCharacter.id && character.id !== existingId),
        syncedCharacter
      ]);
      setEditorStatus({
        message: `Saved: ${apiOperation} ${syncedCharacter.name} through the API and updated the local folder copy.`,
        state: "success"
      });
    } catch (error) {
      setEditorStatus({
        message: error instanceof Error
          ? `Saved: ${apiOperation} ${syncedCharacter.name} through the API, but the local folder copy could not be updated: ${error.message}`
          : `Saved: ${apiOperation} ${syncedCharacter.name} through the API, but the local folder copy could not be updated.`,
        state: "success"
      });
    }
  }

  async function handleOpenCharacterFolder() {
    setCharacterFolderStatus({ message: "Opening and scanning the local CharacterForgeAI character folder...", state: "loading" });
    try {
      const folder = await getCharacterFolder();
      if (!isSafeCharacterFolderPath(folder.path)) {
        setCharacterFolder(folder);
        setFolderCharacters([]);
        setFolderScanIssues([]);
        setCharacterFolderStatus({ message: "Failed: character folder path must stay under CharacterForgeAI app data.", state: "error" });
        return;
      }

      const opened = await openCharacterFolder();
      if (!isSafeCharacterFolderPath(opened.path)) {
        setCharacterFolder(opened);
        setFolderCharacters([]);
        setFolderScanIssues([]);
        setCharacterFolderStatus({ message: "Failed: character folder path must stay under CharacterForgeAI app data.", state: "error" });
        return;
      }

      const scan = await scanCharacterFolder();
      if (!isSafeCharacterFolderPath(scan.folderPath)) {
        setCharacterFolder(opened);
        setFolderCharacters([]);
        setFolderScanIssues([]);
        setCharacterFolderStatus({ message: "Failed: character folder path must stay under CharacterForgeAI app data.", state: "error" });
        return;
      }

      setCharacterFolder({ path: scan.folderPath, browserMode: folder.browserMode || opened.browserMode });
      setFolderCharacters(scan.characters);
      setFolderScanIssues(scan.invalidFiles);
      setCharacterFolderStatus({
        message: folder.browserMode
          ? "Browser mode: character folder access is mocked."
          : `Opened character folder and loaded ${scan.characters.length} local character file${scan.characters.length === 1 ? "" : "s"}.`,
        state: "success"
      });
      if (!scan.characters.length && folder.browserMode) {
        setCharacterDeleteStatus({ message: "No local character files were found in the browser mock folder.", state: "idle" });
      }
      setCharacterPackToolsVisible(true);
    } catch (error) {
      setFolderCharacters([]);
      setFolderScanIssues([]);
      setCharacterFolderStatus({
        message: error instanceof Error ? `Failed: ${error.message}` : "Failed: could not open the character folder.",
        state: "error"
      });
    }
  }

  async function handlePackFileLoad(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    setPackStatus({ message: "Reading local character pack files...", state: "loading" });
    setPackExportState(null);
    try {
      const nextPack = await loadPackFromFileList(files);
      setLoadedPack(nextPack);
      if (nextPack.errors.length) {
        setSelectedPackCharacterIds([]);
        setPackStatus({ message: "Local character pack validation failed.", state: "error" });
      } else {
        setSelectedPackCharacterIds(nextPack.manifest.characters.map((character) => character.id));
        setPackStatus({
          message: `Validated ${nextPack.manifest.name}: pack ready for preview.`,
          state: "success"
        });
      }
    } catch (error) {
      setLoadedPack(null);
      setSelectedPackCharacterIds([]);
      setPackStatus({
        message: error instanceof Error ? `Could not read local pack: ${error.message}` : "Could not read local pack.",
        state: "error"
      });
    }
  }

  async function handleImportPackCharacters() {
    if (!loadedPack || loadedPack.errors.length || !selectedPackCharacterIds.length) {
      setPackStatus({ message: "Select valid pack characters before importing.", state: "error" });
      return;
    }
    if (!settings.apiBaseUrl.trim()) {
      setPackStatus({ message: "API base URL is required before importing selected pack characters.", state: "error" });
      return;
    }

    setPackStatus({ message: "Importing selected pack characters through the TypeScript SDK...", state: "loading" });
    try {
      const client = new CharacterForgeClient({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey || undefined });
      const selectedCharacters = loadedPack.manifest.characters.filter((character) => selectedPackCharacterIds.includes(character.id));
      for (const character of selectedCharacters) {
        await client.createCharacter(loadedPack.characterDocuments[character.path]);
      }
      setPackStatus({
        message: `Imported ${selectedCharacters.length} character${selectedCharacters.length === 1 ? "" : "s"} from ${loadedPack.manifest.name}.`,
        state: "success"
      });
    } catch (error) {
      setPackStatus({
        message: error instanceof Error ? `Pack import failed: ${error.message}` : "Pack import failed.",
        state: "error"
      });
    }
  }

  async function handleExportPackCharacters() {
    if (!loadedPack || loadedPack.errors.length || !selectedPackCharacterIds.length) {
      setPackStatus({ message: "Select valid pack characters before exporting.", state: "error" });
      return;
    }
    if (packExportState) {
      URL.revokeObjectURL(packExportState.objectUrl);
    }
    const exportPack = buildExportPack(loadedPack, selectedPackCharacterIds);
    const fileName = `${exportPack.slug}.json`;
    const objectUrl = downloadJsonFile(exportPack);
    try {
      const savedExport = await saveCharacterPackExport(fileName, exportPack);
      setPackExportState({ fileName, objectUrl, preview: exportPack, savedPath: savedExport?.path });
      setPackStatus({
        message: savedExport
          ? `Saved local export for ${selectedPackCharacterIds.length} selected character${selectedPackCharacterIds.length === 1 ? "" : "s"} to ${savedExport.path}.`
          : `Prepared local export for ${selectedPackCharacterIds.length} selected character${selectedPackCharacterIds.length === 1 ? "" : "s"}. Save it into ${characterFolder.path}.`,
        state: "success"
      });
    } catch (error) {
      setPackExportState({ fileName, objectUrl, preview: exportPack });
      setPackStatus({
        message: error instanceof Error ? `Prepared browser download, but folder export failed: ${error.message}` : "Prepared browser download, but folder export failed.",
        state: "error"
      });
    }
  }

  function renderScreen() {
    switch (activeScreen) {
      case "settings":
        return (
          <SettingsScreen
            onCheckForUpdates={() => void handleCheckForUpdates()}
            onInstallUpdate={() => void handleInstallUpdate()}
            updateCheckResult={updateCheckResult}
            updateStatus={updateStatus}
          />
        );
      case "deployment":
        return (
          <DeploymentStartScreen
            connectionStatus={connectionStatus}
            endDeleteConfirmed={endDeleteConfirmed}
            exportBeforeEndConfirmed={exportBeforeEndConfirmed}
            exportBeforeEndStatus={exportBeforeEndStatus}
            form={deploymentForm}
            isDesktopShell={hasTauriInvoke()}
            settings={draftSettings}
            setupResult={setupCheckResult}
            characterFolder={characterFolder}
            folderScanIssues={folderScanIssues}
            folderStatus={characterFolderStatus}
            localCharacters={folderCharacters}
            setupCheckRequest={setupCheckRequest}
            sharedState={sharedDashboardState}
            setupStatus={setupCheckStatus}
            testedApiSettings={testedApiConnectionSettings}
            wizardResult={awsSetupWizardResult}
            wizardStatus={awsSetupWizardStatus}
            onApiSettingsChange={setDraftSettings}
            onEndDeleteConfirmedChange={setEndDeleteConfirmed}
            onExportBeforeEndConfirmedChange={setExportBeforeEndConfirmed}
            onFormChange={setDeploymentForm}
            onPreviewStart={handlePreviewDeploymentStart}
            onOpenCharacterFolder={() => void handleOpenCharacterFolder()}
            onExportCharactersBeforeEnd={() => void handleExportCharactersBeforeEnd()}
            onOpenCharacters={() => setActiveScreen("characters")}
            onRealEnd={handleRealDeploymentEnd}
            onRunAwsSetupWizard={handleRunAwsSetupWizard}
            onRunCheck={handleRunSetupCheck}
            onSaveSettings={handleSaveSettings}
            onTestConnection={handleTestConnection}
            onRealStart={handleRealDeploymentStart}
            onStartSafetyConfirmedChange={setStartSafetyConfirmed}
            preview={deploymentPreview}
            endResult={deploymentEndResult}
            startResult={deploymentStartResult}
            startSafetyConfirmed={startSafetyConfirmed}
            status={deploymentStatus}
          />
        );
      case "characters":
        return (
          <CharactersScreen
            characters={activeCharacters}
            deleteStatus={characterDeleteStatus}
            editingVisible={charactersEditorVisible}
            editor={{
              form: editorForm,
              onFormChange: setEditorForm,
              onSubmit: handleSubmitCharacter,
              onCancel: handleCloseCharacterDialog,
              previewPayload: editorPayload,
              status: editorStatus,
              validationErrors: editorValidationErrors
            }}
            mode={apiConnected ? "api" : "mock"}
            characterFolder={characterFolder}
            folderScanIssues={folderScanIssues}
            folderStatus={characterFolderStatus}
            syncSummary={syncSummary}
            packTools={{
              exportState: packExportState,
              loadedPack,
              onExportSelected: handleExportPackCharacters,
              onFileLoad: handlePackFileLoad,
              onImportSelected: handleImportPackCharacters,
              onSelectionChange: setSelectedPackCharacterIds,
              selectedCharacterIds: selectedPackCharacterIds,
              status: packStatus,
              visible: characterPackToolsVisible
            }}
            pendingDelete={pendingDeleteCharacter}
            onCancelDelete={() => setPendingDeleteCharacter(null)}
            onConfirmDelete={() => void handleConfirmDeleteCharacter()}
            onCreateCharacter={handleCreateCharacterFromCharactersPage}
            onEditCharacter={handleEditCharacterFromCharactersPage}
            onRequestDelete={handleRequestDeleteCharacter}
            onOpenCharacterFolder={() => void handleOpenCharacterFolder()}
          />
        );
      case "packs":
        return (
          <CharacterPacksScreen
            exportState={packExportState}
            loadedPack={loadedPack}
            onExportSelected={handleExportPackCharacters}
            onFileLoad={handlePackFileLoad}
            onImportSelected={handleImportPackCharacters}
            onSelectionChange={setSelectedPackCharacterIds}
            selectedCharacterIds={selectedPackCharacterIds}
            status={packStatus}
          />
        );
      case "chat":
        return <ChatScreen apiConnected={apiConnected} characters={activeCharacters} onOpenDeployment={() => setActiveScreen("deployment")} settings={settings} />;
      case "json":
        return (
          <RawJsonPreviewScreen
            characters={activeCharacters}
            connectionStatus={connectionStatus}
            editorPayload={editorPayload}
            settings={settings}
            sharedState={sharedDashboardState}
          />
        );
      case "welcome":
      default:
        return (
          <WelcomeScreen
            onOpenScreen={setActiveScreen}
            onOpenSettings={() => setActiveScreen("settings")}
            onReopenTutorial={handleReopenTutorial}
            onSkipTutorial={handleSkipTutorial}
            onTutorialComplete={handleTutorialComplete}
            onTutorialStepChange={setTutorialStepIndex}
            readiness={dashboardReadiness}
            sharedState={sharedDashboardState}
            showTutorial={showTutorial}
            tutorialStepIndex={tutorialStepIndex}
          />
        );
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CF</span>
          <div>
            <strong>CharacterForge</strong>
            <span>{apiMode ? "Dashboard connected" : "Dashboard mockup"}</span>
          </div>
        </div>
        <nav aria-label="Dashboard screens">
          {screens.map((screen) => (
            <button
              aria-current={activeScreen === screen.id ? "page" : undefined}
              className={activeScreen === screen.id ? "active" : undefined}
              key={screen.id}
              onClick={() => setActiveScreen(screen.id)}
              type="button"
            >
              {screen.label}
            </button>
          ))}
        </nav>
        <details className="advanced-navigation">
          <summary>Developer / Advanced</summary>
          <div className="advanced-navigation-buttons">
            {developerScreens.map((screen) => (
              <button
                aria-current={activeScreen === screen.id ? "page" : undefined}
                className={activeScreen === screen.id ? "active" : undefined}
                key={screen.id}
                onClick={() => setActiveScreen(screen.id)}
                type="button"
              >
                {screen.label}
              </button>
            ))}
          </div>
        </details>
      </aside>
      <main>{renderScreen()}</main>
    </div>
  );
}
