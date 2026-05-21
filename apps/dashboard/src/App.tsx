import { useMemo, useState } from "react";

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

const mockSettings = {
  apiBaseUrl: "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>",
  apiKey: "<set in local environment or server-side proxy>",
  mode: "Mock data only"
};

function WelcomeScreen() {
  return (
    <section className="screen-card" aria-labelledby="welcome-title">
      <p className="eyebrow">Mock dashboard</p>
      <h1 id="welcome-title">Welcome to CharacterForge Dashboard</h1>
      <p>
        Review character profiles, inspect action payloads, and test the dashboard flow before wiring it to the
        deployed CharacterForge API.
      </p>
      <div className="notice">
        No live AWS or CharacterForge API calls are made in this step. All content below is local mock data.
      </div>
      <div className="summary-grid">
        <SummaryCard label="Mock characters" value={mockCharacters.length.toString()} />
        <SummaryCard label="Enabled action types" value="5" />
        <SummaryCard label="API mode" value="Mock" />
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

function ApiSettingsScreen() {
  return (
    <section className="screen-card" aria-labelledby="settings-title">
      <p className="eyebrow">Connection setup</p>
      <h1 id="settings-title">API Settings</h1>
      <p>These fields show the future configuration shape. They are read-only placeholders for this mock step.</p>
      <label className="field">
        API base URL
        <input readOnly value={mockSettings.apiBaseUrl} />
      </label>
      <label className="field">
        API key storage
        <input readOnly value={mockSettings.apiKey} />
      </label>
      <label className="field">
        Dashboard mode
        <input readOnly value={mockSettings.mode} />
      </label>
      <div className="warning">
        Do not paste production API keys into committed files, browser bundles, screenshots, or client-side config.
        Public builds should call a server-side proxy that stores the key outside the game or dashboard client.
      </div>
    </section>
  );
}

function CharactersScreen() {
  return (
    <section className="screen-card" aria-labelledby="characters-title">
      <p className="eyebrow">Roster</p>
      <h1 id="characters-title">Characters</h1>
      <div className="character-list">
        {mockCharacters.map((character) => (
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

function CharacterEditorScreen() {
  const character = mockCharacters[0];

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
        {character.allowedActions.map((action) => (
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

function RawJsonPreviewScreen() {
  const rawJson = useMemo(
    () =>
      JSON.stringify(
        {
          mockSettings,
          mockCharacters,
          mockChatResponse: mockChatMessages[1]
        },
        null,
        2
      ),
    []
  );

  return (
    <section className="screen-card" aria-labelledby="json-title">
      <p className="eyebrow">Developer view</p>
      <h1 id="json-title">Raw JSON Preview</h1>
      <pre className="json-preview">{rawJson}</pre>
    </section>
  );
}

function renderScreen(activeScreen: ScreenId) {
  switch (activeScreen) {
    case "settings":
      return <ApiSettingsScreen />;
    case "characters":
      return <CharactersScreen />;
    case "editor":
      return <CharacterEditorScreen />;
    case "chat":
      return <ChatTestScreen />;
    case "json":
      return <RawJsonPreviewScreen />;
    case "welcome":
    default:
      return <WelcomeScreen />;
  }
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>("welcome");

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CF</span>
          <div>
            <strong>CharacterForge</strong>
            <span>Dashboard mockup</span>
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
      <main>{renderScreen(activeScreen)}</main>
    </div>
  );
}
