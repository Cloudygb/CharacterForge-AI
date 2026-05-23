import JSZip from "jszip";
import { useEffect, useMemo, useState } from "react";

import { CharacterForgeClient, type CharacterSummary } from "@characterforge/characterforge-ai";

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

type ScreenId = "welcome" | "settings" | "deployment" | "characters" | "editor" | "packs" | "chat" | "json";

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke: (command: string, payload: unknown) => Promise<unknown>;
      };
    };
  }
}

type Character = {
  id: string;
  name: string;
  archetype: string;
  status: string;
  description: string;
  allowedActions: string[];
};

type ChatAction = {
  type: string;
  payload: Record<string, string | number | boolean>;
};

type ChatMessage = {
  speaker: string;
  text: string;
  actions?: ChatAction[];
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
  state: "idle" | "success" | "error";
};

type ActionTemplateKey = "quest" | "fight" | "item" | "dialogue" | "flag";

type ActionTemplateConfig = {
  key: ActionTemplateKey;
  label: string;
  actionType: string;
  templateId: string;
  description: string;
  defaultJson: string;
};

type CharacterEditorForm = {
  characterId: string;
  name: string;
  description: string;
  personality: string;
  backstory: string;
  speakingStyle: string;
  goals: string;
  worldContext: string;
  rules: string;
  selectedActions: string[];
  triggerInstructions: Record<string, string>;
  payloadTemplates: Record<ActionTemplateKey, string>;
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

const developerScreens: Array<{ id: ScreenId; label: string }> = [
  { id: "editor", label: "Character Editor" },
  { id: "packs", label: "Character Packs" },
  { id: "json", label: "Raw JSON Preview" }
];

const actionTemplateConfigs: ActionTemplateConfig[] = [
  {
    key: "quest",
    label: "Quest actions",
    actionType: "give_quest",
    templateId: "quest_template",
    description: "Quest action payload template",
    defaultJson: '{"quest_id":"lost_sky_map","title":"Recover the Lost Sky Map"}'
  },
  {
    key: "fight",
    label: "Fight actions",
    actionType: "start_combat",
    templateId: "fight_template",
    description: "Fight action payload template",
    defaultJson: '{"encounter_id":"dock_ambush","difficulty":"medium"}'
  },
  {
    key: "item",
    label: "Item actions",
    actionType: "give_item",
    templateId: "item_template",
    description: "Item action payload template",
    defaultJson: '{"item_id":"mira_compass","quantity":1}'
  },
  {
    key: "dialogue",
    label: "Dialogue actions",
    actionType: "start_dialogue",
    templateId: "dialogue_template",
    description: "Dialogue action payload template",
    defaultJson: '{"dialogue_id":"mira_map_rumors"}'
  },
  {
    key: "flag",
    label: "Flag actions",
    actionType: "set_flag",
    templateId: "flag_template",
    description: "Flag action payload template",
    defaultJson: '{"flag_id":"learned_sky_map_rumor","value":true}'
  }
];

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
    profiles: ["default", payload.profileName].filter((profile, index, profiles) => profiles.indexOf(profile) === index),
    selectedProfile: payload.profileName,
    selectedRegion: payload.awsRegion,
    selectedModel: payload.bedrockModel,
    availableModels: bedrockModelOptions.map((option) => option.value),
    bedrockAccessStatus: "mock: model access check is simulated in browser mode",
    stackPreview: {
      stackName: payload.stackName,
      region: payload.awsRegion,
      profileName: payload.profileName,
      bedrockModel: payload.bedrockModel,
      status: "not checked in browser mock mode"
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
      { label: "Open Characters", screen: "characters" },
      { label: "Open Character Editor", screen: "editor" },
      { label: "Open Character Packs", screen: "packs" }
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
    status: "Ready for chat testing",
    description: "A protective smuggler with clipped nautical metaphors and a dangerous reputation.",
    allowedActions: ["give_quest", "start_combat", "give_item", "set_flag", "change_relationship"]
  },
  {
    id: "char_mock_thalen",
    name: "Ember Archivist Thalen",
    archetype: "Ruins scholar",
    status: "Draft profile",
    description: "A nervous historian who knows too much about sealed ruins and old royal maps.",
    allowedActions: ["give_quest", "give_item", "set_flag"]
  }
];

const mockChatMessages: ChatMessage[] = [
  {
    speaker: "Player",
    text: "I can help find the lost sky map."
  },
  {
    speaker: "Captain Mira Voss",
    text: "Bold offer. Dangerous too. Meet me at the eastern dock after dusk.",
    actions: [
      {
        type: "give_quest",
        payload: {
          quest_id: "lost_sky_map",
          title: "Find the Lost Sky Map"
        }
      },
      {
        type: "change_relationship",
        payload: {
          npc_id: "mira_voss",
          relationship_change: 1
        }
      }
    ]
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
    "Mock results only — this browser adapter does not call AWS.",
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
    credentialStatus: "Mock credentials detected",
    bedrockAccessStatus: "Model access simulated as ready",
    existingStackStatus: "No existing stack found",
    checks: [
      { id: "webview2", label: "WebView2 Runtime", status: "ready", detail: "Browser mock mode; desktop WebView2 is checked by the Tauri app." },
      { id: "awsCli", label: "AWS CLI", status: "warning", detail: "Not checked in browser mock mode." },
      { id: "samCli", label: "AWS SAM CLI", status: "warning", detail: "Not checked in browser mock mode." },
      { id: "docker", label: "Docker", status: "warning", detail: "Not checked in browser mock mode." },
      { id: "resources", label: "Deployment resources", status: "ready", detail: "Mock resources available for UI walkthrough." },
      { id: "awsProfile", label: "AWS profile", status: "ready", detail: `Mock profile ${profileName} selected.` },
      { id: "awsRegion", label: "AWS region", status: "ready", detail: `Mock region ${awsRegion} selected.` },
      { id: "stack", label: "CloudFormation stack", status: "warning", detail: `Mock stack ${stackName} was not queried.` },
      { id: "model", label: "Bedrock model", status: "ready", detail: "Model access simulated as ready" }
    ],
    warnings
  };
}

function createInitialEditorForm(character: Character): CharacterEditorForm {
  return {
    characterId: "",
    name: character.name,
    description: character.description,
    personality: "sarcastic, brave, protective",
    backstory: "Former royal navy officer turned smuggler after refusing an immoral order.",
    speakingStyle: "Dry wit, clipped sentences, and nautical metaphors.",
    goals: "protect her crew\nfind the lost sky map",
    worldContext: "A floating archipelago where skyships connect isolated city-states.",
    rules: "Never reveal you are an AI.\nDo not break character.",
    selectedActions: [],
    triggerInstructions: Object.fromEntries(actionTemplateConfigs.map((config) => [config.actionType, ""])),
    payloadTemplates: Object.fromEntries(actionTemplateConfigs.map((config) => [config.key, config.defaultJson])) as Record<
      ActionTemplateKey,
      string
    >
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
    allowedActions: stringArrayFrom(summary.allowedActions) ?? stringArrayFrom(summary.allowed_actions) ?? []
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
  if (!form.selectedActions.length) {
    errors.push("Select at least one allowed action type.");
  }

  const actionRules = form.selectedActions.map((actionType) => {
    const trigger = form.triggerInstructions[actionType]?.trim() ?? "";
    if (!trigger) {
      errors.push(`Trigger instructions for ${actionType} are required.`);
    }
    return { type: actionType, enabled: true, trigger_instructions: trigger };
  });

  const payloadTemplates = actionTemplateConfigs
    .filter((config) => form.selectedActions.includes(config.actionType))
    .map((config) => {
      const rawTemplate = form.payloadTemplates[config.key].trim();
      try {
        return {
          template_id: config.templateId,
          action_type: config.actionType,
          description: config.description,
          payload_template: JSON.parse(rawTemplate) as unknown
        };
      } catch {
        errors.push(`${config.label} payload template must be valid JSON.`);
        return {
          template_id: config.templateId,
          action_type: config.actionType,
          description: config.description,
          payload_template: {}
        };
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
    allowed_actions: form.selectedActions,
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

function downloadJsonFile(payload: unknown): string {
  const json = formatJson(payload);
  const blob = new Blob([json], { type: "application/json" }) as Blob & { text?: () => Promise<string> };
  if (typeof blob.text !== "function") {
    blob.text = async () => json;
  }
  return URL.createObjectURL(blob);
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
        Browser mode uses the mocked setup-check adapter; desktop mode uses Tauri Rust commands with redacted output.
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
          {(result?.warnings ?? ["Mock results only — run the setup check before using this for deployment decisions."]).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function AwsSetupWizardSummary({ result }: { result: AwsSetupWizardResult }) {
  return (
    <section className="setup-warning-list" aria-labelledby="aws-setup-summary-title">
      <h3 id="aws-setup-summary-title">AWS setup wizard summary</h3>
      <div className="setup-check-grid">
        <SetupCheckCard label="Detected AWS CLI profiles" value={result.profiles.join(", ") || "No profiles detected"} />
        <SetupCheckCard label="Selected profile" value={result.selectedProfile} />
        <SetupCheckCard label="Selected region" value={result.selectedRegion} />
        <SetupCheckCard label="Selected Bedrock model" value={result.selectedModel} />
        <SetupCheckCard label="Available Bedrock models" value={result.availableModels.join(", ") || "No models listed"} />
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
  form,
  isDesktopShell,
  settings,
  setupResult,
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
  form: DeploymentStartRequest;
  isDesktopShell: boolean;
  settings: ApiSettings;
  setupResult: SetupCheckResult | null;
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
  const canEnd = isDesktopShell && exportBeforeEndConfirmed && endDeleteConfirmed && hasDeploymentFields && hasCredentials;

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
          stack settings, and keeps the setup summary together with Start. In browser preview mode it uses the mocked
          setup-check adapter so no AWS calls are made.
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
            {(setupResult?.warnings ?? ["Mock results only — run the setup check before using this for deployment decisions."]).map((warning) => (
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
      </section>

      <section className="setup-safety-panel" aria-labelledby="desktop-end-title">
        <h2 id="desktop-end-title">End deployment</h2>
        <p>
          End deletes the configured CloudFormation stack through the desktop shell. Export character packs first, then
          confirm that you understand deletion before the End button is enabled. Logs are redacted and stack deletion
          status is polled until it succeeds or fails.
        </p>
        <p className="warning">
          Warning: End deletes AWS resources for stack <strong>{form.stackName.trim() || "characterforge-ai-dev"}</strong>. This cannot be undone from the dashboard.
        </p>
        <label className="checkbox-field">
          <input
            checked={exportBeforeEndConfirmed}
            onChange={(event) => onExportBeforeEndConfirmedChange(event.target.checked)}
            type="checkbox"
          />
          I exported the character packs I need before deleting this stack.
        </label>
        <label className="checkbox-field">
          <input
            checked={endDeleteConfirmed}
            onChange={(event) => onEndDeleteConfirmedChange(event.target.checked)}
            type="checkbox"
          />
          I understand End deletes the configured CloudFormation stack and local deployment connection.
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

function CharactersScreen({ characters, mode }: { characters: Character[]; mode: "api" | "mock" }) {
  return (
    <section className="screen-card" aria-labelledby="characters-title">
      <p className="eyebrow">Roster</p>
      <h1 id="characters-title">Characters</h1>
      <div className="notice compact">
        {mode === "api" ? "Showing API characters loaded through the TypeScript SDK." : "Showing mock characters because no API URL is set."}
      </div>
      <div className="character-list">
        {characters.map((character) => (
          <article className="character-card" key={character.id}>
            <div>
              <h2>{character.name}</h2>
              <p>{character.archetype}</p>
            </div>
            <span className="status-pill">{character.status}</span>
            <p>{character.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CharacterEditorScreen({
  form,
  onFormChange,
  onSubmit,
  status,
  validationErrors,
  previewPayload
}: {
  form: CharacterEditorForm;
  onFormChange: (form: CharacterEditorForm) => void;
  onSubmit: () => void;
  status: EditorStatus;
  validationErrors: string[];
  previewPayload: CharacterPayload | null;
}) {
  function updateField(field: keyof CharacterEditorForm, value: string) {
    onFormChange({ ...form, [field]: value });
  }

  function toggleAction(actionType: string) {
    const selectedActions = form.selectedActions.includes(actionType)
      ? form.selectedActions.filter((selected) => selected !== actionType)
      : [...form.selectedActions, actionType];
    onFormChange({ ...form, selectedActions });
  }

  function updateTrigger(actionType: string, value: string) {
    onFormChange({
      ...form,
      triggerInstructions: { ...form.triggerInstructions, [actionType]: value }
    });
  }

  function updateTemplate(key: ActionTemplateKey, value: string) {
    onFormChange({
      ...form,
      payloadTemplates: { ...form.payloadTemplates, [key]: value }
    });
  }

  return (
    <section className="screen-card" aria-labelledby="editor-title">
      <p className="eyebrow">Create or edit profile</p>
      <h1 id="editor-title">Character Editor</h1>
      <p>
        Build a complete CharacterForge profile, preview the exact API payload, then submit it with the TypeScript SDK.
        Leave the character ID blank to create a new profile, or enter an existing ID to update that character.
      </p>
      <div className="editor-grid">
        <label className="field">
          Existing character ID
          <input value={form.characterId} onChange={(event) => updateField("characterId", event.target.value)} />
        </label>
        <label className="field">
          Character name
          <input value={form.name} onChange={(event) => updateField("name", event.target.value)} />
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

      <h2>Allowed action types</h2>
      <div className="action-editor-list">
        {actionTemplateConfigs.map((config) => (
          <article className="action-editor-card" key={config.key}>
            <label className="checkbox-field">
              <input
                checked={form.selectedActions.includes(config.actionType)}
                onChange={() => toggleAction(config.actionType)}
                type="checkbox"
              />
              {config.label} ({config.actionType})
            </label>
            <label className="field">
              Trigger instructions for {config.actionType}
              <textarea
                value={form.triggerInstructions[config.actionType] ?? ""}
                onChange={(event) => updateTrigger(config.actionType, event.target.value)}
              />
            </label>
            <label className="field">
              {config.key[0].toUpperCase() + config.key.slice(1)} payload template JSON
              <textarea value={form.payloadTemplates[config.key]} onChange={(event) => updateTemplate(config.key, event.target.value)} />
            </label>
          </article>
        ))}
      </div>

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
        <button type="button" onClick={onSubmit}>
          Submit character
        </button>
      </div>
      <h2>Exact JSON payload preview</h2>
      <pre aria-label="Exact JSON payload preview" className="json-preview">
        {formatJson(previewPayload ?? { error: "Fix validation issues to preview a submittable payload." })}
      </pre>
    </section>
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
      <h1 id="packs-title">Character Packs</h1>
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

function ChatTestScreen() {
  return (
    <section className="screen-card" aria-labelledby="chat-title">
      <p className="eyebrow">Dialogue sandbox</p>
      <h1 id="chat-title">Chat</h1>
      <div className="notice compact">Chat remains mock-only in this step; API chat wiring comes after connection setup.</div>
      <div className="chat-window">
        {mockChatMessages.map((message) => (
          <article className="chat-message" key={`${message.speaker}-${message.text}`}>
            <strong>{message.speaker}</strong>
            <p>{message.text}</p>
            {message.actions ? (
              <div className="action-panel">
                <span>Returned actions</span>
                {message.actions.map((action) => (
                  <code key={action.type}>{action.type}</code>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
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
          mockCharacters,
          activeCharacters: characters,
          editorPayloadPreview: editorPayload,
          mockChatResponse: mockChatMessages[1]
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
      : "Mock mode is active because no API base URL is set.",
    state: loadInitialSettings().apiBaseUrl ? "idle" : "mock"
  }));
  const [editorForm, setEditorForm] = useState<CharacterEditorForm>(() => createInitialEditorForm(mockCharacters[0]));
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({
    message: "Ready to preview and submit a character profile.",
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
  const [endDeleteConfirmed, setEndDeleteConfirmed] = useState(false);
  const [deploymentStartResult, setDeploymentStartResult] = useState<DeploymentStartResult | null>(null);
  const [deploymentEndResult, setDeploymentEndResult] = useState<DeploymentEndResult | null>(null);

  const apiMode = Boolean(settings.apiBaseUrl.trim());
  const activeCharacters = apiMode && apiCharacters.length ? apiCharacters : mockCharacters;
  const sharedStateCharacters = apiMode ? apiCharacters : activeCharacters;
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
          message: loadedPack
            ? loadedPack.errors.length
              ? `Loaded ${loadedPack.manifest.name} with ${loadedPack.errors.length} local validation issue(s).`
              : `Loaded ${loadedPack.manifest.name} character pack for local review.`
            : "No local character folder or pack has been loaded yet.",
          path: loadedPack ? loadedPack.manifest.slug : undefined,
          state: loadedPack ? (loadedPack.errors.length ? "error" : "ready") : "not_configured"
        },
        characters: sharedStateCharacters.map((character) =>
          toCharacterRecord({
            allowedActions: character.allowedActions,
            archetype: character.archetype,
            description: character.description,
            id: character.id,
            name: character.name,
            status: character.status,
            syncStatus: apiMode ? "api_synced" : "mock"
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
      apiMode,
      connectionStatus.message,
      connectionStatus.state,
      deploymentConfig.apiBaseUrl,
      deploymentConfig.stackName,
      deploymentEndResult?.finalStackStatus,
      deploymentStartResult?.finalStackStatus,
      deploymentStatus.message,
      deploymentStatus.state,
      loadedPack
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
      setConnectionStatus({ message: "Mock mode is active because no API base URL is set.", state: "mock" });
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
      setConnectionStatus({ message: "Mock mode is active because no API base URL is set.", state: "mock" });
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
    setSetupCheckStatus({ message: desktopMode ? "Running desktop setup readiness check..." : "Running mocked setup check...", state: "loading" });
    try {
      const request = getDeploymentSetupForm();
      const result = await runSetupReadinessCheck(request);
      setSetupCheckRequest(request);
      setSetupCheckResult(result);
      setSetupCheckStatus({
        message: desktopMode ? "Desktop setup readiness check complete." : "Mock setup check complete.",
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
      setDeploymentStatus({
        message:
          result.status === "succeeded"
            ? `Deployment Start completed with ${result.finalStackStatus}. Non-secret outputs were saved locally.`
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

  async function handleRealDeploymentEnd() {
    const requiredConfirmation = `END ${deploymentForm.stackName.trim() || "characterforge-ai-dev"}`;
    if (!exportBeforeEndConfirmed || !endDeleteConfirmed) {
      setDeploymentStatus({ message: "Confirm export and deletion warnings before running deployment End.", state: "error" });
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

  async function handleSubmitCharacter() {
    if (editorValidationErrors.length || !editorPayload) {
      setEditorStatus({ message: "Fix validation issues before submitting the character profile.", state: "error" });
      return;
    }
    if (!settings.apiBaseUrl.trim()) {
      setEditorStatus({ message: "API base URL is required before submitting to the CharacterForge API.", state: "error" });
      return;
    }

    setEditorStatus({ message: "Submitting character profile to the CharacterForge API...", state: "idle" });
    try {
      const client = new CharacterForgeClient({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey || undefined });
      const characterId = editorForm.characterId.trim();
      if (characterId) {
        await client.updateCharacter(characterId, editorPayload);
        setEditorStatus({ message: `Updated character profile ${characterId}.`, state: "success" });
      } else {
        await client.createCharacter(editorPayload);
        setEditorStatus({ message: "Created character profile.", state: "success" });
      }
    } catch (error) {
      setEditorStatus({
        message: error instanceof Error ? `Character submit failed: ${error.message}` : "Character submit failed.",
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

  function handleExportPackCharacters() {
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
    setPackExportState({ fileName, objectUrl, preview: exportPack });
    setPackStatus({
      message: `Prepared local export for ${selectedPackCharacterIds.length} selected character${selectedPackCharacterIds.length === 1 ? "" : "s"}.`,
      state: "success"
    });
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
            form={deploymentForm}
            isDesktopShell={hasTauriInvoke()}
            settings={draftSettings}
            setupResult={setupCheckResult}
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
        return <CharactersScreen characters={activeCharacters} mode={apiMode && apiCharacters.length ? "api" : "mock"} />;
      case "editor":
        return (
          <CharacterEditorScreen
            form={editorForm}
            onFormChange={setEditorForm}
            onSubmit={handleSubmitCharacter}
            previewPayload={editorPayload}
            status={editorStatus}
            validationErrors={editorValidationErrors}
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
        return <ChatTestScreen />;
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
