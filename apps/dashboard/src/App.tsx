import JSZip from "jszip";
import { useMemo, useState } from "react";

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
  type RealDeploymentStartAdapter
} from "./deploymentAdapters";
import "./styles.css";

type ScreenId = "welcome" | "settings" | "setup" | "deployment" | "characters" | "editor" | "packs" | "chat" | "json";

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

type TutorialStep = {
  title: string;
  body: string;
  checklist: string[];
  nextLabel: string;
};

type SetupCheckForm = {
  awsRegion: string;
  bedrockModel: string;
};

type SetupCheckResult = {
  awsRegion: string;
  bedrockModel: string;
  credentialStatus: string;
  bedrockAccessStatus: string;
  existingStackStatus: string;
  warnings: string[];
};

const settingsStorageKey = "characterforge.dashboard.settings";

const screens: Array<{ id: ScreenId; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "settings", label: "API Settings" },
  { id: "setup", label: "Setup Check" },
  { id: "deployment", label: "Deployment" },
  { id: "characters", label: "Characters" },
  { id: "editor", label: "Character Editor" },
  { id: "packs", label: "Character Packs" },
  { id: "chat", label: "Chat Test" },
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
  bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0"
};

const defaultDeploymentForm: DeploymentStartRequest = {
  awsRegion: "us-east-1",
  bedrockModel: "amazon.nova-micro-v1:0",
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

const deploymentAdapter = createDeploymentAdapter();

function isRealDeploymentAdapter(adapter: typeof deploymentAdapter): adapter is RealDeploymentStartAdapter & RealDeploymentEndAdapter {
  return "start" in adapter && "end" in adapter;
}

const bedrockModelOptions = [
  { value: "amazon.nova-micro-v1:0", label: "Amazon Nova Micro" },
  { value: "anthropic.claude-3-haiku-20240307-v1:0", label: "Claude 3 Haiku" },
  { value: "anthropic.claude-3-5-sonnet-20240620-v1:0", label: "Claude 3.5 Sonnet" }
];

const firstRunTutorialSteps: TutorialStep[] = [
  {
    title: "Mock mode keeps this walkthrough safe",
    body: "Start in mock state so you can tour CharacterForge without creating AWS resources or sending live API requests.",
    checklist: ["Review the dashboard screens", "Open sample characters", "Try local pack previews before any live setup"],
    nextLabel: "Next: Safety"
  },
  {
    title: "AWS can charge for deployed resources",
    body: "Even small Lambda, API Gateway, DynamoDB, CloudWatch, or storage experiments can create usage charges after deployment.",
    checklist: ["Set budgets and delete test stacks when finished", "Use the AWS free tier only as a limit guide", "Check billing before sharing a demo"],
    nextLabel: "Next: Credentials"
  },
  {
    title: "Never paste production credentials",
    body: "Browser fields are for local test keys only. Production games should call a trusted backend or proxy that keeps secrets server-side.",
    checklist: ["Do not commit API keys", "Do not screenshot real secrets", "Rotate any key that may have been exposed"],
    nextLabel: "Next: Dashboard tour"
  },
  {
    title: "Dashboard tour",
    body: "Use Character Packs to import and export local content, Character Editor to shape payloads, and Raw JSON Preview to inspect safe mock state.",
    checklist: ["Keep mock mode until you intentionally connect", "Validate local packs before importing", "Review JSON before sharing artifacts"],
    nextLabel: "Open API Settings"
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
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : ""
    };
  } catch {
    return { apiBaseUrl: "", apiKey: "" };
  }
}

function saveSettings(settings: ApiSettings) {
  window.localStorage.setItem(settingsStorageKey, JSON.stringify({ apiBaseUrl: settings.apiBaseUrl, apiKey: "" }));
}

async function runMockSetupCheck(form: SetupCheckForm): Promise<SetupCheckResult> {
  const awsRegion = form.awsRegion.trim() || defaultSetupCheckForm.awsRegion;
  const bedrockModel = form.bedrockModel;
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
    credentialStatus: "Mock credentials detected",
    bedrockAccessStatus: "Model access simulated as ready",
    existingStackStatus: "No existing stack found",
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

function WelcomeScreen({ mode, onOpenSettings, onTutorialStepChange, tutorialStepIndex }: { mode: "api" | "mock"; onOpenSettings: () => void; onTutorialStepChange: (stepIndex: number) => void; tutorialStepIndex: number }) {
  const tutorialStep = firstRunTutorialSteps[tutorialStepIndex];
  const finalStep = tutorialStepIndex === firstRunTutorialSteps.length - 1;

  function handleTutorialNext() {
    if (finalStep) {
      onOpenSettings();
      return;
    }
    onTutorialStepChange(tutorialStepIndex + 1);
  }

  return (
    <section className="screen-card" aria-labelledby="welcome-title">
      <p className="eyebrow">{mode === "api" ? "API-connected dashboard" : "Mock dashboard"}</p>
      <h1 id="welcome-title">Welcome to CharacterForge Dashboard</h1>
      <p>
        Review character profiles, inspect action payloads, and test the dashboard flow before wiring deeper edit and
        chat actions into the deployed CharacterForge API.
      </p>
      <div className="notice">
        {mode === "api"
          ? "An API base URL is set. Character listing and connection tests use the TypeScript SDK client."
          : "No API base URL is set, so mock mode is active and the dashboard uses local sample data."}
      </div>
      <div className="summary-grid">
        <SummaryCard label={mode === "api" ? "Character source" : "Mock characters"} value={mode === "api" ? "API" : mockCharacters.length.toString()} />
        <SummaryCard label="Editor action groups" value={actionTemplateConfigs.length.toString()} />
        <SummaryCard label="API mode" value={mode === "api" ? "Connected" : "Mock"} />
      </div>
      <section className="tutorial-card" aria-labelledby="tutorial-title">
        <p className="eyebrow">Step {tutorialStepIndex + 1} of {firstRunTutorialSteps.length}</p>
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
        </div>
      </section>
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

function ApiSettingsScreen({
  connectionStatus,
  draftSettings,
  onDraftSettingsChange,
  onSaveSettings,
  onTestConnection
}: {
  connectionStatus: ConnectionStatus;
  draftSettings: ApiSettings;
  onDraftSettingsChange: (settings: ApiSettings) => void;
  onSaveSettings: () => void;
  onTestConnection: () => void;
}) {
  return (
    <section className="screen-card" aria-labelledby="settings-title">
      <p className="eyebrow">Connection setup</p>
      <h1 id="settings-title">API Settings</h1>
      <p>
        Add a CharacterForge API base URL and API key to load live character summaries. Leave the base URL blank to keep
        using mock mode.
      </p>
      <div className="setup-safety-panel" aria-label="Setup safety warnings">
        <p className="eyebrow">Review these safety notes before entering setup values</p>
        <div className="warning">
          <strong>AWS cost warning</strong>
          <p>
            AWS can charge for deployed resources such as Lambda, API Gateway, DynamoDB, CloudWatch logs, and storage.
            Set budgets and delete test stacks when finished.
          </p>
        </div>
        <div className="warning">
          <strong>Credential safety warning</strong>
          <p>
            Never paste production credentials into this browser demo. Use local test keys only, do not persist keys in
            committed files, and put production secrets behind a trusted backend.
          </p>
        </div>
      </div>
      <label className="field">
        API base URL
        <input
          placeholder="https://<api-id>.execute-api.<region>.amazonaws.com/<stage>"
          value={draftSettings.apiBaseUrl}
          onChange={(event) => onDraftSettingsChange({ ...draftSettings, apiBaseUrl: event.target.value })}
        />
      </label>
      <label className="field">
        API key
        <input
          autoComplete="off"
          placeholder="Paste only a local test key"
          type="password"
          value={draftSettings.apiKey}
          onChange={(event) => onDraftSettingsChange({ ...draftSettings, apiKey: event.target.value })}
        />
      </label>
      <div className="button-row">
        <button type="button" onClick={onSaveSettings}>
          Save settings
        </button>
        <button type="button" onClick={onTestConnection}>
          Test connection
        </button>
      </div>
      <div className={`connection-status ${connectionStatus.state}`} role="status">
        {connectionStatus.message}
      </div>
      <div className="warning">
        Do not paste production API keys into committed files, browser bundles, screenshots, or client-side config.
        Public builds should call a server-side proxy that stores the key outside the game or dashboard client.
      </div>
    </section>
  );
}

function SetupCheckScreen({
  form,
  onFormChange,
  onRunCheck,
  result,
  status
}: {
  form: SetupCheckForm;
  onFormChange: (form: SetupCheckForm) => void;
  onRunCheck: () => void;
  result: SetupCheckResult | null;
  status: ConnectionStatus;
}) {
  return (
    <section className="screen-card" aria-labelledby="setup-check-title">
      <p className="eyebrow">Mock setup readiness</p>
      <h1 id="setup-check-title">Setup Check</h1>
      <p>
        Use the setup-check adapter to preview AWS readiness signals before wiring real AWS checks. This screen does
        not call AWS, Bedrock, CloudFormation, or credential providers.
      </p>
      <div className="notice compact">Mocked setup-check adapter: safe local state only, no AWS requests.</div>
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
      </div>
      <div className="button-row">
        <button type="button" onClick={onRunCheck}>Run setup check</button>
      </div>
      <div className={`connection-status ${status.state}`} role="status">
        {status.message}
      </div>
      <div className="setup-check-grid">
        <SetupCheckCard label="AWS region" value={result?.awsRegion ?? form.awsRegion} />
        <SetupCheckCard label="Selected Bedrock model" value={result?.bedrockModel ?? form.bedrockModel} />
        <SetupCheckCard label="Credential status" value={result?.credentialStatus ?? "Not checked yet"} />
        <SetupCheckCard label="Bedrock access status" value={result?.bedrockAccessStatus ?? "Not checked yet"} />
        <SetupCheckCard label="Existing stack status" value={result?.existingStackStatus ?? "Not checked yet"} />
      </div>
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

function SetupCheckCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DeploymentStartScreen({
  confirmationText,
  endConfirmationText,
  exportBeforeEndConfirmed,
  form,
  isDesktopShell,
  onConfirmationChange,
  onEndConfirmationChange,
  onExportBeforeEndConfirmedChange,
  onFormChange,
  onPreviewStart,
  onRealEnd,
  onRealStart,
  preview,
  endResult,
  startResult,
  status
}: {
  confirmationText: string;
  endConfirmationText: string;
  exportBeforeEndConfirmed: boolean;
  form: DeploymentStartRequest;
  isDesktopShell: boolean;
  onConfirmationChange: (value: string) => void;
  onEndConfirmationChange: (value: string) => void;
  onExportBeforeEndConfirmedChange: (value: boolean) => void;
  onFormChange: (form: DeploymentStartRequest) => void;
  onPreviewStart: () => void;
  onRealEnd: () => void;
  onRealStart: () => void;
  preview: DeploymentStartPreview | null;
  endResult: DeploymentEndResult | null;
  startResult: DeploymentStartResult | null;
  status: ConnectionStatus;
}) {
  const temporaryCredentials = form.temporaryCredentials ?? { accessKeyId: "", secretAccessKey: "", sessionToken: "" };
  const requiredConfirmation = `START ${form.stackName.trim() || "characterforge-ai-dev"}`;
  const requiredEndConfirmation = `END ${form.stackName.trim() || "characterforge-ai-dev"}`;

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
      <p className="eyebrow">Dry-run deployment</p>
      <h1 id="deployment-title">Deployment Start</h1>
      <p>
        Preview the local desktop Start flow before enabling real AWS deployment. Dry-run mode only builds the SAM and
        CloudFormation command plan; it never calls AWS, SAM, Bedrock, CloudFormation, or credential providers.
      </p>
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

      <div className="button-row">
        <button type="button" onClick={onPreviewStart}>Preview Start dry run</button>
      </div>

      <section className="setup-safety-panel" aria-labelledby="real-start-title">
        <h2 id="real-start-title">Real desktop Start</h2>
        <p>
          Real Start uses the existing SAM template and CloudFormation stack through the desktop shell. It requires AWS
          CLI and SAM CLI locally, redacts credentials from logs, polls stack status, and saves only non-secret outputs
          such as API URL, API key ID, function name, and table names to a local file.
        </p>
        <p className="warning">
          {isDesktopShell
            ? `Type ${requiredConfirmation} to enable the real deployment Start button.`
            : "Real deployment Start is disabled in the browser preview and is available only in the packaged Tauri desktop shell."}
        </p>
        <label className="field">
          Real deployment confirmation
          <input value={confirmationText} onChange={(event) => onConfirmationChange(event.target.value)} />
        </label>
        <div className="button-row">
          <button type="button" onClick={onRealStart}>Start real deployment</button>
        </div>
      </section>

      <section className="setup-safety-panel" aria-labelledby="real-end-title">
        <h2 id="real-end-title">Real desktop End</h2>
        <p>
          End deletes the CloudFormation stack through the desktop shell. Export character packs first, then type the
          exact stack-name confirmation before deletion. Logs are redacted and stack deletion status is polled until it
          succeeds or fails.
        </p>
        <p className="warning">
          {isDesktopShell
            ? `Export character packs, then type ${requiredEndConfirmation} to enable deployment End.`
            : "Real deployment End is disabled in the browser preview and is available only in the packaged Tauri desktop shell."}
        </p>
        <label className="checkbox-field">
          <input
            checked={exportBeforeEndConfirmed}
            onChange={(event) => onExportBeforeEndConfirmedChange(event.target.checked)}
            type="checkbox"
          />
          I exported the character packs I need before deleting this stack.
        </label>
        <label className="field">
          Deployment End confirmation
          <input value={endConfirmationText} onChange={(event) => onEndConfirmationChange(event.target.value)} />
        </label>
        <div className="button-row">
          <button type="button" onClick={onRealEnd}>End deployment and delete stack</button>
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
        <section className="deployment-preview" aria-labelledby="deployment-start-log-title">
          <h2 id="deployment-start-log-title">Real Start redacted log</h2>
          <p>
            Final stack status: <strong>{startResult.finalStackStatus}</strong>
            {startResult.savedOutputsPath ? ` · Outputs saved to ${startResult.savedOutputsPath}` : ""}
          </p>
          <pre className="json-preview" aria-label="Real Start redacted log">
            {startResult.logs.join("\n")}
          </pre>
        </section>
      ) : null}

      {endResult ? (
        <section className="deployment-preview" aria-labelledby="deployment-end-log-title">
          <h2 id="deployment-end-log-title">Real End redacted log</h2>
          <p>
            Final stack status: <strong>{endResult.finalStackStatus}</strong>
          </p>
          <pre className="json-preview" aria-label="Real End redacted log">
            {endResult.logs.join("\n")}
          </pre>
        </section>
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
      <h1 id="chat-title">Chat Test</h1>
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
  settings
}: {
  characters: Character[];
  connectionStatus: ConnectionStatus;
  editorPayload: CharacterPayload | null;
  settings: ApiSettings;
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
          mockCharacters,
          activeCharacters: characters,
          editorPayloadPreview: editorPayload,
          mockChatResponse: mockChatMessages[1]
        },
        null,
        2
      ),
    [characters, connectionStatus, editorPayload, settings]
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
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [setupCheckForm, setSetupCheckForm] = useState<SetupCheckForm>(defaultSetupCheckForm);
  const [setupCheckResult, setSetupCheckResult] = useState<SetupCheckResult | null>(null);
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
  const [deploymentConfirmation, setDeploymentConfirmation] = useState("");
  const [deploymentEndConfirmation, setDeploymentEndConfirmation] = useState("");
  const [exportBeforeEndConfirmed, setExportBeforeEndConfirmed] = useState(false);
  const [deploymentStartResult, setDeploymentStartResult] = useState<DeploymentStartResult | null>(null);
  const [deploymentEndResult, setDeploymentEndResult] = useState<DeploymentEndResult | null>(null);

  const apiMode = Boolean(settings.apiBaseUrl.trim());
  const activeCharacters = apiMode && apiCharacters.length ? apiCharacters : mockCharacters;
  const editorPayloadResult = useMemo(() => buildCharacterPayload(editorForm), [editorForm]);
  const editorValidationErrors = editorPayloadResult.errors;
  const editorPayload = editorPayloadResult.payload;

  function handleSaveSettings() {
    const nextSettings = {
      apiBaseUrl: draftSettings.apiBaseUrl.trim(),
      apiKey: draftSettings.apiKey.trim()
    };
    setSettings(nextSettings);
    saveSettings(nextSettings);
    if (!nextSettings.apiBaseUrl) {
      setApiCharacters([]);
      setConnectionStatus({ message: "Mock mode is active because no API base URL is set.", state: "mock" });
    } else {
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
      setConnectionStatus({
        message: `Connected to CharacterForge API. Loaded ${characters.length} character${characters.length === 1 ? "" : "s"}.`,
        state: "success"
      });
    } catch (error) {
      setApiCharacters([]);
      setConnectionStatus({
        message: error instanceof Error ? `Connection failed: ${error.message}` : "Connection failed.",
        state: "error"
      });
    }
  }

  async function handleRunSetupCheck() {
    setSetupCheckStatus({ message: "Running mocked setup check...", state: "loading" });
    const result = await runMockSetupCheck(setupCheckForm);
    setSetupCheckResult(result);
    setSetupCheckStatus({ message: "Mock setup check complete.", state: "success" });
  }

  async function handlePreviewDeploymentStart() {
    setDeploymentStatus({ message: "Building dry-run deployment preview...", state: "loading" });
    const preview = await deploymentAdapter.previewStart(deploymentForm);
    setDeploymentPreview(preview);
    setDeploymentStatus({ message: "Dry-run deployment preview ready.", state: "success" });
  }

  async function handleRealDeploymentStart() {
    const requiredConfirmation = `START ${deploymentForm.stackName.trim() || "characterforge-ai-dev"}`;
    if (deploymentConfirmation.trim() !== requiredConfirmation) {
      setDeploymentStatus({ message: `Type ${requiredConfirmation} before running real deployment Start.`, state: "error" });
      return;
    }
    if (!isRealDeploymentAdapter(deploymentAdapter)) {
      setDeploymentStatus({ message: "Real deployment Start is available only inside the Tauri desktop shell.", state: "error" });
      return;
    }

    setDeploymentStartResult(null);
    setDeploymentStatus({ message: "Running real deployment Start through the desktop shell...", state: "loading" });
    try {
      const result = await deploymentAdapter.start(deploymentForm, { confirmationText: deploymentConfirmation });
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
    if (!exportBeforeEndConfirmed) {
      setDeploymentStatus({ message: "Export character packs before running deployment End.", state: "error" });
      return;
    }
    if (deploymentEndConfirmation.trim() !== requiredConfirmation) {
      setDeploymentStatus({ message: `Type ${requiredConfirmation} before running deployment End.`, state: "error" });
      return;
    }
    if (!isRealDeploymentAdapter(deploymentAdapter)) {
      setDeploymentStatus({ message: "Real deployment End is available only inside the Tauri desktop shell.", state: "error" });
      return;
    }

    setDeploymentEndResult(null);
    setDeploymentStatus({ message: "Running deployment End through the desktop shell...", state: "loading" });
    try {
      const result = await deploymentAdapter.end(deploymentForm, {
        confirmationText: deploymentEndConfirmation,
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
          <ApiSettingsScreen
            connectionStatus={connectionStatus}
            draftSettings={draftSettings}
            onDraftSettingsChange={setDraftSettings}
            onSaveSettings={handleSaveSettings}
            onTestConnection={handleTestConnection}
          />
        );
      case "setup":
        return (
          <SetupCheckScreen
            form={setupCheckForm}
            onFormChange={setSetupCheckForm}
            onRunCheck={handleRunSetupCheck}
            result={setupCheckResult}
            status={setupCheckStatus}
          />
        );
      case "deployment":
        return (
          <DeploymentStartScreen
            confirmationText={deploymentConfirmation}
            endConfirmationText={deploymentEndConfirmation}
            exportBeforeEndConfirmed={exportBeforeEndConfirmed}
            form={deploymentForm}
            isDesktopShell={isRealDeploymentAdapter(deploymentAdapter)}
            onConfirmationChange={setDeploymentConfirmation}
            onEndConfirmationChange={setDeploymentEndConfirmation}
            onExportBeforeEndConfirmedChange={setExportBeforeEndConfirmed}
            onFormChange={setDeploymentForm}
            onPreviewStart={handlePreviewDeploymentStart}
            onRealEnd={handleRealDeploymentEnd}
            onRealStart={handleRealDeploymentStart}
            preview={deploymentPreview}
            endResult={deploymentEndResult}
            startResult={deploymentStartResult}
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
          />
        );
      case "welcome":
      default:
        return (
          <WelcomeScreen
            mode={apiMode ? "api" : "mock"}
            onOpenSettings={() => setActiveScreen("settings")}
            onTutorialStepChange={setTutorialStepIndex}
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
      </aside>
      <main>{renderScreen()}</main>
    </div>
  );
}
