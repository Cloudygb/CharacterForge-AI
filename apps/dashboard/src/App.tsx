import { useMemo, useState } from "react";

import { CharacterForgeClient, type CharacterSummary } from "@characterforge/characterforge-ai";

import "./styles.css";

type ScreenId = "welcome" | "settings" | "characters" | "editor" | "chat" | "json";

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

const settingsStorageKey = "characterforge.dashboard.settings";

const screens: Array<{ id: ScreenId; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "settings", label: "API Settings" },
  { id: "characters", label: "Characters" },
  { id: "editor", label: "Character Editor" },
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

function WelcomeScreen({ mode }: { mode: "api" | "mock" }) {
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
        return <WelcomeScreen mode={apiMode ? "api" : "mock"} />;
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
