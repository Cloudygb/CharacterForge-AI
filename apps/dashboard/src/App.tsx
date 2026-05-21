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

const settingsStorageKey = "characterforge.dashboard.settings";

const screens: Array<{ id: ScreenId; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "settings", label: "API Settings" },
  { id: "characters", label: "Characters" },
  { id: "editor", label: "Character Editor" },
  { id: "chat", label: "Chat Test" },
  { id: "json", label: "Raw JSON Preview" }
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
        <SummaryCard label="Enabled action types" value="5" />
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

function CharacterEditorScreen({ character }: { character: Character }) {
  return (
    <section className="screen-card" aria-labelledby="editor-title">
      <p className="eyebrow">Profile draft</p>
      <h1 id="editor-title">Character Editor</h1>
      <div className="editor-grid">
        <label className="field">
          Character name
          <input readOnly value={character.name} />
        </label>
        <label className="field">
          Archetype
          <input readOnly value={character.archetype} />
        </label>
        <label className="field field-wide">
          Description
          <textarea readOnly value={character.description} />
        </label>
      </div>
      <h2>Allowed actions</h2>
      <div className="tag-list">
        {(character.allowedActions.length ? character.allowedActions : ["No actions returned"]).map((action) => (
          <span className="action-tag" key={action}>
            {action}
          </span>
        ))}
      </div>
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
  settings
}: {
  characters: Character[];
  connectionStatus: ConnectionStatus;
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
          mockChatResponse: mockChatMessages[1]
        },
        null,
        2
      ),
    [characters, connectionStatus, settings]
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

  const apiMode = Boolean(settings.apiBaseUrl.trim());
  const activeCharacters = apiMode && apiCharacters.length ? apiCharacters : mockCharacters;

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
        return <CharacterEditorScreen character={activeCharacters[0]} />;
      case "chat":
        return <ChatTestScreen />;
      case "json":
        return <RawJsonPreviewScreen characters={activeCharacters} connectionStatus={connectionStatus} settings={settings} />;
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
