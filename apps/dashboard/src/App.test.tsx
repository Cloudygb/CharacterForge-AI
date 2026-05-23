import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const listCharactersMock = vi.fn();
const createCharacterMock = vi.fn();
const updateCharacterMock = vi.fn();
const deleteCharacterMock = vi.fn();
const chatMock = vi.fn();

vi.mock("@characterforge/characterforge-ai", () => ({
  CharacterForgeClient: vi.fn().mockImplementation(function CharacterForgeClientMock(
    this: {
      createCharacter: (payload: unknown) => Promise<unknown>;
      listCharacters: () => Promise<unknown>;
      updateCharacter: (characterId: string, payload: unknown) => Promise<unknown>;
      deleteCharacter: (characterId: string) => Promise<void>;
      chat: (characterId: string, payload: unknown) => Promise<unknown>;
    },
    options: { apiKey?: string; baseUrl: string }
  ) {
    this.createCharacter = (payload: unknown) => createCharacterMock(options, payload);
    this.listCharacters = () => listCharactersMock(options);
    this.updateCharacter = (characterId: string, payload: unknown) => updateCharacterMock(options, characterId, payload);
    this.deleteCharacter = (characterId: string) => deleteCharacterMock(options, characterId);
    this.chat = (characterId: string, payload: unknown) => chatMock(options, characterId, payload);
  })
}));

describe("CharacterForge dashboard", () => {
  beforeEach(() => {
    listCharactersMock.mockReset();
    createCharacterMock.mockReset();
    updateCharacterMock.mockReset();
    deleteCharacterMock.mockReset();
    chatMock.mockReset();
    delete window.__TAURI__;
    window.localStorage.clear();
  });

  async function startDeploymentWithLocalScan(
    scanResult: { folderPath: string; characters: unknown[]; invalidFiles: unknown[] },
    overrides: Partial<Record<string, (args?: unknown) => Promise<unknown>>> = {}
  ) {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValue({ characters: [] });
    const invoke = vi.fn().mockImplementation((command: string, args?: unknown) => {
      if (overrides[command]) {
        return overrides[command]?.(args);
      }
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "ready",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: []
        });
      }
      if (command === "start_deployment") {
        return Promise.resolve({ status: "succeeded", finalStackStatus: "CREATE_COMPLETE", logs: ["done"] });
      }
      if (command === "scan_character_folder") {
        return Promise.resolve(scanResult);
      }
      if (command === "open_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters", opened: true, browserMode: false });
      }
      if (command === "save_character_pack_export") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters\\characterforge-dashboard-export.json" });
      }
      if (command === "end_deployment") {
        return Promise.resolve({ status: "succeeded", finalStackStatus: "DELETE_COMPLETE", logs: ["Deleted stack characterforge-demo"] });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));
    await user.click(screen.getByRole("button", { name: /^start$/i }));
    await screen.findByText(/deployment start completed with create_complete/i);
    return { invoke, user };
  }

  it("renders only the simplified next-release dashboard sections in the sidebar", () => {
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: /dashboard screens/i });
    const topLevelButtons = within(navigation).getAllByRole("button");
    expect(topLevelButtons.map((button) => button.textContent)).toEqual(["Welcome", "Deployment", "Characters", "Chat", "Settings"]);

    for (const removedScreenName of ["API Settings", "Setup Check", "Character Editor", "Character Packs", "Chat Test", "Raw JSON Preview"]) {
      expect(within(navigation).queryByRole("button", { name: removedScreenName })).not.toBeInTheDocument();
    }
  });

  it("uses polished labels, button hierarchy, and disclosure controls on normal pages", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText(/characterforgeai workspace/i)).toBeInTheDocument();
    expect(screen.queryByText(/dashboard mockup/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up deployment/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();
    expect(screen.getByText(/advanced local preview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview start dry run/i })).toHaveClass("secondary");
    expect(screen.getByRole("button", { name: /^end$/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /i understand end deletes stack/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getByText(/showing starter characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete captain mira voss/i })).toHaveClass("danger-button");

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByRole("button", { name: /open deployment/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: /check for updates/i })).toBeInTheDocument();
    expect(screen.queryByText(/api key/i)).not.toBeInTheDocument();
  });

  it("merges API setup, AWS readiness, and deployment controls into Deployment", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/api base url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^api key$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/aws region/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bedrock model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/aws profile name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stack name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run readiness check/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview start dry run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^start$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^end$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/real deployment confirmation/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/deployment end confirmation/i)).not.toBeInTheDocument();
    expect(screen.getByText(/deployment outputs/i)).toBeInTheDocument();
    expect(screen.getByText(/api base url comes from/i)).toBeInTheDocument();
    expect(screen.getByText(/api keys should be treated as secrets/i)).toBeInTheDocument();
    expect(screen.getAllByText(/credential safety warning/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: /check for updates/i })).not.toBeInTheDocument();
  });

  it("explains safe API Base URL and API Key discovery on Deployment without embedded secrets", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));

    expect(screen.getByRole("heading", { name: /where do i find these/i })).toBeInTheDocument();
    expect(screen.getByText(/when this app starts the stack/i)).toBeInTheDocument();
    expect(screen.getByText(/reads cloudformation outputs/i)).toBeInTheDocument();
    expect(screen.getByText(/aws console > cloudformation/i)).toBeInTheDocument();
    expect(screen.getByText(/aws console > api gateway/i)).toBeInTheDocument();
    expect(screen.getByText(/api keys stay redacted/i)).toBeInTheDocument();

    const renderedDeploymentCopy = [
      document.body.textContent ?? "",
      ...Array.from(document.querySelectorAll("input")).map((input) => input.getAttribute("placeholder") ?? "")
    ].join("\n");
    expect(renderedDeploymentCopy).not.toMatch(/https:\/\/[a-z0-9]{10}\.execute-api\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9-]+/i);
    expect(renderedDeploymentCopy).not.toMatch(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/);
    expect(renderedDeploymentCopy).not.toMatch(/x-api-key\s*[:=]\s*[-A-Za-z0-9_]{20,}/i);
  });

  it("shows useful not-connected Welcome empty states with a Deployment link", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: /welcome to characterforgeai/i })).toBeInTheDocument();
    expect(screen.getByText(/no aws backend connected yet/i)).toBeInTheDocument();
    expect(screen.getByText(/go to deployment to launch or connect your characterforgeai stack/i)).toBeInTheDocument();
    const disconnectedSummary = within(screen.getByLabelText(/welcome status summary/i));
    expect(disconnectedSummary.getByText(/connection/i)).toBeInTheDocument();
    expect(disconnectedSummary.getAllByText(/not connected/i).length).toBeGreaterThan(0);
    expect(disconnectedSummary.getByText(/characters/i)).toBeInTheDocument();
    expect(disconnectedSummary.getByText(/none loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/mock dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock characters/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /first-run tutorial/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what characterforgeai does/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start guided setup/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/api base url/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /set up deployment/i }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();
  });

  it("reopens Guided Setup from the disconnected Welcome page after it was completed", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "characterforge.dashboard.appConfig",
      JSON.stringify({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false, updateSettings: {} })
    );

    render(<App />);

    await waitFor(() => expect(screen.queryByText(/step 1 of 8/i)).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /start guided setup/i }));
    expect(screen.getByRole("heading", { name: /first-run tutorial/i })).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
  });

  it("walks through practical first-run guided setup content before opening Settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what characterforgeai does/i })).toBeInTheDocument();
    expect(screen.getByText(/create characters, deploy the backend, and chat test/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: prerequisites/i }));
    expect(screen.getByText(/step 2 of 8/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /prerequisites before you deploy/i })).toBeInTheDocument();
    expect(screen.getAllByText(/aws profile/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/aws region/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bedrock model access/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /next: deployment setup/i }));
    expect(screen.getByText(/step 3 of 8/i)).toBeInTheDocument();
    expect(screen.getAllByText(/stack name/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^open deployment$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: start backend/i }));
    expect(screen.getByText(/step 4 of 8/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /start the backend/i })).toBeInTheDocument();
    expect(screen.getByText(/press start/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: connect api/i }));
    expect(screen.getByText(/step 5 of 8/i)).toBeInTheDocument();
    expect(screen.getAllByText(/api base url/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/api key/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^open deployment$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: characters/i }));
    expect(screen.getByText(/step 6 of 8/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /create or import characters/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open characters/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open character editor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open character packs/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: chat and payloads/i }));
    expect(screen.getByText(/step 7 of 8/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /chat with a synced character/i })).toBeInTheDocument();
    expect(screen.getAllByText(/payload/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /open chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open payload preview/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: end safely/i }));
    expect(screen.getByText(/step 8 of 8/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /end deployment safely/i })).toBeInTheDocument();
    expect(screen.getAllByText(/export\/save before delete/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/end button/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /finish guided setup and open deployment/i }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/api base url/i)).toBeInTheDocument();
  });

  it("provides page navigation actions from guided setup steps without exposing secrets", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "characterforge.dashboard.settings",
      JSON.stringify({ apiBaseUrl: "https://characters.example.test", apiKey: "test-api-key" })
    );
    render(<App />);

    expect(screen.queryByText("test-api-key")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("test-api-key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next: prerequisites/i }));
    await user.click(screen.getByRole("button", { name: /next: deployment setup/i }));
    await user.click(screen.getByRole("button", { name: /^open deployment$/i }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    await user.click(screen.getByRole("button", { name: /next: start backend/i }));
    await user.click(screen.getByRole("button", { name: /next: connect api/i }));
    await user.click(screen.getByRole("button", { name: /^open deployment$/i }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    await user.click(screen.getByRole("button", { name: /next: characters/i }));
    await user.click(screen.getByRole("button", { name: /open characters/i }));
    expect(screen.getByRole("heading", { name: /characters/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    await user.click(screen.getByRole("button", { name: /open characters/i }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    expect(screen.getByRole("dialog", { name: /create character/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    await user.click(screen.getByRole("button", { name: /open characters/i }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));
    expect(screen.getByRole("heading", { name: /character folder import-export/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    await user.click(screen.getByRole("button", { name: /next: chat and payloads/i }));
    await user.click(screen.getByRole("button", { name: /open chat/i }));
    expect(screen.getByRole("heading", { name: /chat/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    await user.click(screen.getByRole("button", { name: /open payload preview/i }));
    expect(screen.getByRole("heading", { name: /raw json preview/i })).toBeInTheDocument();

    expect(screen.queryByText("test-api-key")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("test-api-key")).not.toBeInTheDocument();
    expect(screen.queryByText(/example secret/i)).not.toBeInTheDocument();
  });

  it("persists first-run tutorial completion through Tauri config commands", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string, payload: unknown) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: false, firstRunTutorialSkipped: false });
      }
      if (command === "save_app_config") {
        return Promise.resolve(payload && typeof payload === "object" && "config" in payload ? payload.config : {});
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);

    expect(await screen.findByRole("heading", { name: /first-run tutorial/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next: prerequisites/i }));
    await user.click(screen.getByRole("button", { name: /next: deployment setup/i }));
    await user.click(screen.getByRole("button", { name: /next: start backend/i }));
    await user.click(screen.getByRole("button", { name: /next: connect api/i }));
    await user.click(screen.getByRole("button", { name: /next: characters/i }));
    await user.click(screen.getByRole("button", { name: /next: chat and payloads/i }));
    await user.click(screen.getByRole("button", { name: /next: end safely/i }));
    await user.click(screen.getByRole("button", { name: /finish guided setup and open deployment/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "save_app_config",
        expect.objectContaining({
          config: expect.objectContaining({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false })
        })
      )
    );
  });

  it("allows skipping first-run tutorial and reopening it later", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string, payload: unknown) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: true });
      }
      if (command === "save_app_config") {
        return Promise.resolve(payload && typeof payload === "object" && "config" in payload ? payload.config : {});
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_app_config", {}));
    expect(screen.queryByRole("heading", { name: /^first-run tutorial$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/first-run tutorial is saved as completed/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reopen first-run tutorial/i }));
    expect(screen.getByRole("heading", { name: /first-run tutorial/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /skip tutorial/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "save_app_config",
        expect.objectContaining({
          config: expect.objectContaining({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: true })
        })
      )
    );
    expect(screen.queryByRole("heading", { name: /^first-run tutorial$/i })).not.toBeInTheDocument();
  });

  it("navigates between simplified sections and advanced diagnostics screens", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText("Developer / Advanced"));
    expect(screen.queryByRole("button", { name: "Setup Check" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Character Editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Character Packs" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getByRole("heading", { name: /characters/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create character/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^open character folder$/i })).toBeInTheDocument();
    expect(screen.getByText("Captain Mira Voss")).toBeInTheDocument();
    expect(screen.getByText("Ember Archivist Thalen")).toBeInTheDocument();
    expect(screen.getByText(/showing starter characters/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByRole("heading", { name: /^chat$/i })).toBeInTheDocument();
    expect(screen.getByText(/connect your deployment before chatting with characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open deployment/i })).toBeInTheDocument();
    expect(screen.queryByText(/meet me at the eastern dock/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /check for updates/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/api base url/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/do not paste production api keys into committed files/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Raw JSON Preview" }));
    expect(screen.getByRole("heading", { name: /raw json preview/i })).toBeInTheDocument();
    expect(screen.getByText(/starterCharacters/i)).toBeInTheDocument();
    expect(screen.getByText(/connectionStatus/i)).toBeInTheDocument();
  });


  it("shows a Chat empty state with a Deployment link when the API is disconnected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Chat" }));

    expect(screen.getByRole("heading", { name: /^chat$/i })).toBeInTheDocument();
    expect(screen.getByText(/connect your deployment before chatting with characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open deployment/i })).toBeInTheDocument();
    expect(screen.queryByText(/meet me at the eastern dock/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/select character/i)).not.toBeInTheDocument();
    expect(chatMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /open deployment/i }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();
  });

  it("keeps disconnected normal app surfaces free of fake live data", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText(/no aws backend connected yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/mock mode is active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ready for chat testing/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    expect(screen.getByText(/api endpoint not configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/mock results only/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock credentials detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model access simulated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock resources available/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getByText(/showing starter characters/i)).toBeInTheDocument();
    expect(screen.getAllByText(/starter character/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/delete captain mira voss/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/showing mock characters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/source: mock/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sync: mock/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText(/connect your deployment before chatting with characters/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/chat transcript/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/send a message to start the transcript/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/meet me at the eastern dock/i)).not.toBeInTheDocument();
  });

  it("does not turn the browser AWS setup wizard into fake detected deployment data", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.click(screen.getByRole("button", { name: /load aws setup wizard/i }));

    expect((await screen.findAllByText(/local preview only — no aws profiles, stacks, or bedrock model access were checked/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/no profiles checked/i)).toBeInTheDocument();
    expect(screen.getByText(/no models checked/i)).toBeInTheDocument();
    expect(screen.getByText(/stack was not queried/i)).toBeInTheDocument();
    expect(screen.queryByText(/detected aws cli profiles/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/default, characterforge/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model access check is simulated/i)).not.toBeInTheDocument();
  });

  it("selects a synced character from the API list before chatting", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({
      characters: [
        { id: "char_api_arden", name: "Arden Vale", archetype: "API ranger", description: "Fetched from API.", allowed_actions: ["give_quest"] },
        { id: "char_api_lyra", name: "Lyra Quill", archetype: "API bard", description: "Second API character.", allowed_actions: ["set_flag"] }
      ]
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Chat" }));
    const selector = screen.getByLabelText(/select character/i);
    expect(selector).toHaveValue("char_api_arden");
    expect(screen.getAllByText(/loaded character: arden vale/i).length).toBeGreaterThan(0);

    await user.selectOptions(selector, "char_api_lyra");
    expect(screen.getAllByText(/loaded character: lyra quill/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/second api character/i)).toBeInTheDocument();
  });

  it("maps chat requests to the selected character and displays response payloads", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({
      characters: [{ id: "char_api_arden", name: "Arden Vale", archetype: "API ranger", description: "Fetched from API.", allowed_actions: ["give_quest", "set_flag"] }]
    });
    chatMock.mockResolvedValueOnce({
      message: "The warded gate opens.",
      emotion: "focused",
      actions: [
        { type: "give_quest", payload: { quest_id: "harbor-001", title: "Find the Harbor Key" } },
        { type: "set_flag", payload: { flag: "gate_open", value: true } }
      ],
      token_usage: { input_tokens: 12, output_tokens: 24 }
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Chat" }));
    await user.type(screen.getByLabelText(/player message/i), "Open the old gate");
    await user.click(screen.getByRole("button", { name: /send chat/i }));

    await waitFor(() => expect(chatMock).toHaveBeenCalledWith(
      { baseUrl: "https://api.example.test/dev", apiKey: undefined },
      "char_api_arden",
      expect.objectContaining({
        message: "Open the old gate",
        player_id: "dashboard-player",
        session_id: "dashboard-chat-char_api_arden",
        context: expect.objectContaining({ character_name: "Arden Vale", source: "api", sync_status: "api_synced" })
      })
    ));
    expect(await screen.findByText(/open the old gate/i)).toBeInTheDocument();
    expect(screen.getAllByText(/the warded gate opens/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/show response details/i)).toBeInTheDocument();
    expect(screen.getAllByText(/give_quest/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/harbor-001/i)).toBeInTheDocument();
    expect(screen.getByText(/gate_open/i)).toBeInTheDocument();
    expect(screen.getByText(/input_tokens/i)).toBeInTheDocument();
  });

  it("merges character editing, pack tools, and delete confirmation into the Characters page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Characters" }));

    expect(screen.getByRole("button", { name: /create character/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^open character folder$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Character Editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Character Packs" })).not.toBeInTheDocument();

    const miraCard = screen.getByRole("article", { name: /captain mira voss/i });
    expect(within(miraCard).getByRole("button", { name: /edit captain mira voss/i })).toBeInTheDocument();
    expect(within(miraCard).getByRole("button", { name: /delete captain mira voss/i })).toBeInTheDocument();

    await user.click(within(miraCard).getByRole("button", { name: /edit captain mira voss/i }));
    const editDialog = screen.getByRole("dialog", { name: /edit captain mira voss/i });
    expect(within(editDialog).getByLabelText(/character name/i)).toHaveValue("Captain Mira Voss");
    expect(within(editDialog).getByLabelText(/title\/status/i)).toHaveValue("Starter character");
    expect(within(editDialog).queryByLabelText(/existing character id/i)).not.toBeInTheDocument();
    expect(within(editDialog).getByText(/custom actions/i)).toBeInTheDocument();
    await user.click(within(editDialog).getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog", { name: /edit captain mira voss/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));
    expect(screen.getByRole("heading", { name: /character folder import-export/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/load pack json, folder, or zip/i)).toBeInTheDocument();

    await user.click(within(miraCard).getByRole("button", { name: /delete captain mira voss/i }));
    expect(screen.getByRole("alertdialog", { name: /delete captain mira voss/i })).toBeInTheDocument();
    expect(screen.getByText(/delete this local character from this device/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel delete/i }));
    expect(screen.getByText("Captain Mira Voss")).toBeInTheDocument();

    await user.click(within(miraCard).getByRole("button", { name: /delete captain mira voss/i }));
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(screen.queryByText("Captain Mira Voss")).not.toBeInTheDocument();
    expect(screen.getByText(/saved: deleted captain mira voss from local character storage/i)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("characterforge.dashboard.localCharacterIndex") ?? "{}")).toEqual({
      deletedCharacterIds: ["char_mock_mira"]
    });
    expect(listCharactersMock).not.toHaveBeenCalled();
    expect(createCharacterMock).not.toHaveBeenCalled();
  });

  it("opens the desktop character folder and loads scanned local character files", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "get_character_folder") {
        return Promise.resolve({
          path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          browserMode: false
        });
      }
      if (command === "open_character_folder") {
        return Promise.resolve({
          path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          opened: true,
          browserMode: false
        });
      }
      if (command === "scan_character_folder") {
        return Promise.resolve({
          folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          characters: [
            {
              id: "char_folder_sera",
              name: "Sera Folderborn",
              archetype: "Local folder mage",
              description: "Loaded from a local character file.",
              status: "local file"
            }
          ],
          invalidFiles: [{ path: "broken-character.json", error: "missing name" }]
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));

    expect(await screen.findByText(/opened character folder/i)).toBeInTheDocument();
    expect(screen.getByText(/C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters/i)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /sera folderborn/i })).toBeInTheDocument();
    expect(screen.getByText(/showing characters loaded from the local characterforgeai folder/i)).toBeInTheDocument();
    expect(screen.getAllByText((_, node) => node?.textContent === "broken-character.json: missing name").length).toBeGreaterThan(0);
    expect(invoke).toHaveBeenCalledWith("get_character_folder", {});
    expect(invoke).toHaveBeenCalledWith("open_character_folder", {});
    expect(invoke).toHaveBeenCalledWith("scan_character_folder", {});
  });

  it("uses a safe browser-mode character folder mock when Tauri is unavailable", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));

    expect(screen.getByText(/browser mode: character folder access is mocked/i)).toBeInTheDocument();
    expect(screen.getByText(/%APPDATA%\\CharacterForgeAI\\characters/i)).toBeInTheDocument();
    expect(screen.getByText(/no local character files were found in the browser mock folder/i)).toBeInTheDocument();
    expect(listCharactersMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe desktop character folder paths before opening or scanning", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "get_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\Desktop\\..\\Secrets", browserMode: false });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));

    expect(await screen.findByText(/failed: character folder path must stay under characterforgeai app data/i)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_character_folder", {});
    expect(invoke).not.toHaveBeenCalledWith("open_character_folder", {});
    expect(invoke).not.toHaveBeenCalledWith("scan_character_folder", {});
  });

  it("deletes an API character only after backend success and shows sync status", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({
      characters: [{ id: "char_api_arden", name: "Arden Vale", archetype: "API ranger", description: "Fetched from API." }]
    });
    let resolveDelete: () => void = () => undefined;
    deleteCharacterMock.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveDelete = resolve;
    }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    const ardenCard = screen.getByRole("article", { name: /arden vale/i });
    await user.click(within(ardenCard).getByRole("button", { name: /delete arden vale/i }));
    expect(screen.getByRole("alertdialog", { name: /delete arden vale/i })).toBeInTheDocument();
    expect(screen.getByText(/delete arden vale from the connected service/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(await screen.findByText(/saving: deleting arden vale through the characterforge api/i)).toBeInTheDocument();
    await waitFor(() => expect(deleteCharacterMock).toHaveBeenCalledWith({ baseUrl: "https://api.example.test/dev", apiKey: undefined }, "char_api_arden"));
    expect(screen.getByText("Arden Vale")).toBeInTheDocument();
    resolveDelete();
    await waitFor(() => expect(screen.queryByText("Arden Vale")).not.toBeInTheDocument());
    expect(await screen.findByText(/saved: deleted arden vale from the api and local index/i)).toBeInTheDocument();
  });

  it("keeps an API character visible when backend delete fails", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({
      characters: [{ id: "char_api_lyra", name: "Lyra Quill", archetype: "API bard", description: "Fetched from API." }]
    });
    deleteCharacterMock.mockRejectedValueOnce(new Error("DynamoDB delete denied"));

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    const lyraCard = screen.getByRole("article", { name: /lyra quill/i });
    await user.click(within(lyraCard).getByRole("button", { name: /delete lyra quill/i }));
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));

    await waitFor(() => expect(deleteCharacterMock).toHaveBeenCalledWith({ baseUrl: "https://api.example.test/dev", apiKey: undefined }, "char_api_lyra"));
    expect(await screen.findByText(/failed: could not delete lyra quill from the api: dynamodb delete denied/i)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /lyra quill/i })).toBeInTheDocument();
  });



  it("pushes connected character saves through the API before updating the local folder copy", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string, payload: unknown) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "save_character_file") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters\\char_api_nova.json" });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };
    listCharactersMock.mockResolvedValueOnce({ characters: [] });
    createCharacterMock.mockResolvedValueOnce({ id: "char_api_nova" });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    const dialog = screen.getByRole("dialog", { name: /create character/i });
    await user.type(within(dialog).getByLabelText(/character name/i), "Nova Syncwright");
    await user.type(within(dialog).getByLabelText(/description/i), "A connected character synced through the API first.");
    await user.type(within(dialog).getByLabelText(/personality traits/i), "careful, bright");
    await user.type(within(dialog).getByLabelText(/goals/i), "keep cloud and local copies aligned");
    await user.type(within(dialog).getByLabelText(/backstory/i), "Built release sync ledgers for local folders.");
    await user.type(within(dialog).getByLabelText(/speaking style/i), "Concise status updates.");
    await user.type(within(dialog).getByLabelText(/world context/i), "CharacterForgeAI sync validation lab.");
    await user.type(within(dialog).getByLabelText(/roleplay rules/i), "Never invent sync success.");
    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    await user.type(within(dialog).getByLabelText(/action name/i), "sync_audit");
    await user.type(within(dialog).getByLabelText(/trigger instructions/i), "When a sync status changes.");

    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));

    await waitFor(() => expect(createCharacterMock).toHaveBeenCalledWith({ baseUrl: "https://api.example.test/dev", apiKey: undefined }, expect.objectContaining({ name: "Nova Syncwright" })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_character_file", expect.objectContaining({
      character: expect.objectContaining({ id: "char_api_nova", name: "Nova Syncwright", syncStatus: "api_synced", source: "api" })
    })));
    expect(await screen.findByText(/saved: created nova syncwright through the api and updated the local folder copy/i)).toBeInTheDocument();
    const novaCard = screen.getByRole("article", { name: /nova syncwright/i });
    expect(within(novaCard).getByText(/source: api/i)).toBeInTheDocument();
    expect(within(novaCard).getByText(/sync: cloud synced/i)).toBeInTheDocument();
  });

  it("saves offline character edits to the local folder and marks them not synced yet", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string, payload: unknown) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "save_character_file") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters\\local-offline-mina.json" });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    const dialog = screen.getByRole("dialog", { name: /create character/i });
    await user.type(within(dialog).getByLabelText(/character name/i), "Offline Mina");
    await user.type(within(dialog).getByLabelText(/description/i), "Created while disconnected.");
    await user.type(within(dialog).getByLabelText(/personality traits/i), "patient, practical");
    await user.type(within(dialog).getByLabelText(/goals/i), "sync later");
    await user.type(within(dialog).getByLabelText(/backstory/i), "Wrote local-first records.");
    await user.type(within(dialog).getByLabelText(/speaking style/i), "Calm and direct.");
    await user.type(within(dialog).getByLabelText(/world context/i), "Offline test harness.");
    await user.type(within(dialog).getByLabelText(/roleplay rules/i), "Show pending status.");
    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    await user.type(within(dialog).getByLabelText(/action name/i), "queue_sync");
    await user.type(within(dialog).getByLabelText(/trigger instructions/i), "When the API is unavailable.");

    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));

    expect(createCharacterMock).not.toHaveBeenCalled();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_character_file", expect.objectContaining({
      character: expect.objectContaining({ name: "Offline Mina", syncStatus: "api_pending", source: "local" })
    })));
    expect(await screen.findByText(/not synced yet: saved offline mina to the local character folder/i)).toBeInTheDocument();
    const minaCard = screen.getByRole("article", { name: /offline mina/i });
    expect(within(minaCard).getByText(/source: local folder/i)).toBeInTheDocument();
    expect(within(minaCard).getByText(/sync: not synced yet/i)).toBeInTheDocument();
  });



  it("treats a configured but failed API connection as offline and saves local pending changes", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "save_character_file") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters\\local-disconnected-dara.json" });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };
    listCharactersMock.mockRejectedValueOnce(new Error("Network offline"));

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    expect((await screen.findAllByText(/connection failed: network offline/i)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    const dialog = screen.getByRole("dialog", { name: /create character/i });
    await user.type(within(dialog).getByLabelText(/character name/i), "Disconnected Dara");
    await user.type(within(dialog).getByLabelText(/description/i), "Saved while the configured API is offline.");
    await user.type(within(dialog).getByLabelText(/personality traits/i), "careful");
    await user.type(within(dialog).getByLabelText(/goals/i), "queue safely");
    await user.type(within(dialog).getByLabelText(/backstory/i), "Waited for connectivity.");
    await user.type(within(dialog).getByLabelText(/speaking style/i), "Brief status updates.");
    await user.type(within(dialog).getByLabelText(/world context/i), "Disconnected sync lane.");
    await user.type(within(dialog).getByLabelText(/roleplay rules/i), "Do not call offline APIs.");
    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    await user.type(within(dialog).getByLabelText(/action name/i), "queue_disconnected_sync");
    await user.type(within(dialog).getByLabelText(/trigger instructions/i), "When connection checks fail.");
    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));

    expect(createCharacterMock).not.toHaveBeenCalled();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_character_file", expect.objectContaining({
      character: expect.objectContaining({ name: "Disconnected Dara", source: "local", syncStatus: "api_pending" })
    })));
    expect(await screen.findByText(/not synced yet: saved disconnected dara to the local character folder/i)).toBeInTheDocument();
  });

  it("creates API records for pending local characters after reconnect instead of updating a local-only id", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "get_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters", browserMode: false });
      }
      if (command === "open_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters", opened: true, browserMode: false });
      }
      if (command === "scan_character_folder") {
        return Promise.resolve({
          folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          characters: [{ id: "local-pending-sora", name: "Pending Sora", archetype: "Local scout", description: "Queued before reconnect.", status: "Draft", allowedActions: ["sync_now"], source: "local", syncStatus: "api_pending" }],
          invalidFiles: []
        });
      }
      if (command === "save_character_file") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters\\char_api_sora.json" });
      }
      if (command === "delete_character_file") {
        return Promise.resolve();
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };
    listCharactersMock.mockResolvedValueOnce({ characters: [] });
    createCharacterMock.mockResolvedValueOnce({ id: "char_api_sora" });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));
    const soraCard = await screen.findByRole("article", { name: /pending sora/i });
    expect(within(soraCard).getByText(/sync: not synced yet/i)).toBeInTheDocument();
    await user.click(within(soraCard).getByRole("button", { name: /edit pending sora/i }));
    const dialog = screen.getByRole("dialog", { name: /edit pending sora/i });
    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    await user.type(within(dialog).getAllByLabelText(/action name/i).at(-1)!, "sync_confirmed");
    await user.type(within(dialog).getAllByLabelText(/trigger instructions/i).at(-1)!, "After reconnect sync succeeds.");
    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));

    await waitFor(() => expect(createCharacterMock).toHaveBeenCalledWith({ baseUrl: "https://api.example.test/dev", apiKey: undefined }, expect.objectContaining({ name: "Pending Sora" })));
    expect(updateCharacterMock).not.toHaveBeenCalled();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_character_file", expect.objectContaining({ characterId: "local-pending-sora" })));
    expect(await screen.findByText(/saved: created pending sora through the api and updated the local folder copy/i)).toBeInTheDocument();
  });


  it("keeps failed connected saves as pending local changes with a sync error", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string, payload: unknown) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "save_character_file") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters\\local-retry-rune.json" });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };
    listCharactersMock.mockResolvedValueOnce({ characters: [] });
    createCharacterMock.mockRejectedValueOnce(new Error("DynamoDB conditional check failed"));

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    const dialog = screen.getByRole("dialog", { name: /create character/i });
    await user.type(within(dialog).getByLabelText(/character name/i), "Retry Rune");
    await user.type(within(dialog).getByLabelText(/description/i), "Needs retry after a backend conflict.");
    await user.type(within(dialog).getByLabelText(/personality traits/i), "persistent, wary");
    await user.type(within(dialog).getByLabelText(/goals/i), "retry safely");
    await user.type(within(dialog).getByLabelText(/backstory/i), "Survived a failed conditional write.");
    await user.type(within(dialog).getByLabelText(/speaking style/i), "Warns about conflicts.");
    await user.type(within(dialog).getByLabelText(/world context/i), "DynamoDB sync lane.");
    await user.type(within(dialog).getByLabelText(/roleplay rules/i), "Never hide failed syncs.");
    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    await user.type(within(dialog).getByLabelText(/action name/i), "retry_sync");
    await user.type(within(dialog).getByLabelText(/trigger instructions/i), "When sync failed.");

    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));

    await waitFor(() => expect(createCharacterMock).toHaveBeenCalled());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_character_file", expect.objectContaining({
      character: expect.objectContaining({ name: "Retry Rune", syncStatus: "conflict", source: "local" })
    })));
    expect(await screen.findByText(/failed sync: dynamodb conditional check failed. retry rune was kept as a pending local change/i)).toBeInTheDocument();
    const retryCard = screen.getByRole("article", { name: /retry rune/i });
    expect(within(retryCard).getByText(/source: local folder/i)).toBeInTheDocument();
    expect(within(retryCard).getByText(/sync: conflict or sync error/i)).toBeInTheDocument();
  });

  it("shows pending local changes and API/local conflicts from the character folder scan", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "get_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters", browserMode: false });
      }
      if (command === "open_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters", opened: true, browserMode: false });
      }
      if (command === "scan_character_folder") {
        return Promise.resolve({
          folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          characters: [
            { id: "char_api_warden", name: "Warden Cloud", archetype: "Local duplicate", description: "Local pending duplicate.", status: "Draft", syncStatus: "api_pending", source: "local" },
            { id: "char_local_pending", name: "Pending Piper", archetype: "Local bard", description: "Waiting for API sync.", status: "Draft", syncStatus: "api_pending", source: "local" }
          ],
          invalidFiles: []
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };
    listCharactersMock.mockResolvedValueOnce({
      characters: [{ id: "char_api_warden", name: "Warden Cloud", archetype: "API sentinel", description: "Cloud copy." }]
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));

    const wardenCard = await screen.findByRole("article", { name: /warden cloud/i });
    expect(within(wardenCard).getByText(/source: api \+ local/i)).toBeInTheDocument();
    expect(within(wardenCard).getByText(/sync: conflict or sync error/i)).toBeInTheDocument();
    expect(screen.getByText(/conflict: warden cloud exists in both api and local folder with pending local changes/i)).toBeInTheDocument();
    const pendingCard = screen.getByRole("article", { name: /pending piper/i });
    expect(within(pendingCard).getByText(/source: local folder/i)).toBeInTheDocument();
    expect(within(pendingCard).getByText(/sync: not synced yet/i)).toBeInTheDocument();
    expect(screen.getByText(/pending local changes: 2 character files are not synced yet/i)).toBeInTheDocument();
  });


  it("excludes conflicted or pending local characters from Chat selection until they sync", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "get_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters", browserMode: false });
      }
      if (command === "open_character_folder") {
        return Promise.resolve({ path: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters", opened: true, browserMode: false });
      }
      if (command === "scan_character_folder") {
        return Promise.resolve({
          folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          characters: [
            { id: "char_api_warden", name: "Warden Cloud", archetype: "Local duplicate", description: "Local pending duplicate.", status: "Draft", syncStatus: "api_pending", source: "local" },
            { id: "char_local_pending", name: "Pending Piper", archetype: "Local bard", description: "Waiting for API sync.", status: "Draft", syncStatus: "api_pending", source: "local" }
          ],
          invalidFiles: []
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };
    listCharactersMock.mockResolvedValueOnce({
      characters: [{ id: "char_api_warden", name: "Warden Cloud", archetype: "API sentinel", description: "Cloud copy." }]
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);
    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));
    await screen.findByText(/conflict: warden cloud exists in both api and local folder with pending local changes/i);

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText(/no synced characters are ready for chat yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/select character/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /warden cloud/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /pending piper/i })).not.toBeInTheDocument();
  });


  it("runs mocked setup checks for AWS readiness without calling AWS", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));

    expect(screen.getByText(/desktop app performs local checks without displaying credential values/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/aws region/i)).toHaveValue("us-east-1");
    expect(screen.getByLabelText(/bedrock model/i)).toHaveValue("anthropic.claude-3-haiku-20240307-v1:0");
    expect(screen.getByText(/credential status/i)).toBeInTheDocument();
    expect(screen.getAllByText(/not checked yet/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /run readiness check/i }));

    expect(await screen.findByText(/local preview setup check complete/i)).toBeInTheDocument();
    expect(screen.getAllByText(/aws region/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("us-east-1").length).toBeGreaterThan(0);
    expect(screen.getByText(/selected bedrock model/i)).toBeInTheDocument();
    expect(screen.getByText("anthropic.claude-3-haiku-20240307-v1:0")).toBeInTheDocument();
    expect(screen.getAllByText(/credential status/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/local preview only — credentials not checked/i)).toBeInTheDocument();
    expect(screen.getByText(/bedrock access status/i)).toBeInTheDocument();
    expect(screen.getAllByText(/bedrock access not checked/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/existing stack status/i)).toBeInTheDocument();
    expect(screen.getByText(/no existing stack found/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /warnings/i })).toBeInTheDocument();
    expect(screen.getAllByText(/local preview only/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/confirm bedrock model access in the aws console/i).length).toBeGreaterThan(0);
    expect(listCharactersMock).not.toHaveBeenCalled();
    expect(createCharacterMock).not.toHaveBeenCalled();
  });

  it("updates mocked setup-check warnings when region and model choices are risky", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "eu-west-1");
    await user.selectOptions(screen.getByLabelText(/bedrock model/i), "anthropic.claude-3-5-sonnet-20240620-v1:0");
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));

    expect(await screen.findByText(/local preview setup check complete/i)).toBeInTheDocument();
    expect(screen.getAllByText("eu-west-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/verify that characterforge deployment templates target eu-west-1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/higher-capability models may cost more per request/i).length).toBeGreaterThan(0);
  });

  it("runs app-side Tauri setup readiness checks without exposing credentials", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockResolvedValue({
      overallStatus: "ready",
      checks: [
        { id: "webview2", label: "WebView2 Runtime", status: "ready", detail: "WebView2 runtime available" },
        { id: "awsCli", label: "AWS CLI", status: "ready", detail: "aws-cli/2.15.0" },
        { id: "samCli", label: "AWS SAM CLI", status: "ready", detail: "SAM CLI, version 1.110.0" },
        { id: "docker", label: "Docker", status: "warning", detail: "Docker CLI installed; engine is not running" },
        { id: "resources", label: "Deployment resources", status: "ready", detail: "Packaged deployment resources found" },
        { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
        { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
        { id: "stack", label: "CloudFormation stack", status: "warning", detail: "Stack characterforge-demo does not exist yet" },
        { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
      ],
      warnings: ["No credential values are returned by setup checks."]
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));

    expect(await screen.findByText(/desktop setup readiness check complete/i)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("check_setup_readiness", {
      request: {
        awsRegion: "us-west-2",
        bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
        profileName: "game-dev",
        stackName: "characterforge-demo"
      }
    });
    for (const label of [
      "WebView2 Runtime",
      "AWS CLI",
      "AWS SAM CLI",
      "Docker",
      "Deployment resources",
      "AWS profile",
      "AWS region",
      "CloudFormation stack",
      "Bedrock model"
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/Profile game-dev is configured/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Stack characterforge-demo does not exist yet/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/raw-secret-value/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-session-token/i)).not.toBeInTheDocument();
  });

  it("guides credential-safe AWS setup wizard with mocked profile/model output", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_aws_setup_wizard") {
        return Promise.resolve({
          profiles: ["default", "game-dev"],
          selectedProfile: "game-dev",
          selectedRegion: "us-west-2",
          selectedModel: "anthropic.claude-3-haiku-20240307-v1:0",
          availableModels: ["anthropic.claude-3-haiku-20240307-v1:0", "amazon.nova-micro-v1:0"],
          bedrockAccessStatus: "ready: model access confirmed by Bedrock control-plane list call",
          stackPreview: {
            stackName: "characterforge-demo",
            region: "us-west-2",
            profileName: "game-dev",
            bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
            status: "CREATE_COMPLETE"
          },
          warnings: [
            "Credential values are never stored, logged, or returned by this wizard.",
            "Bedrock usage and deployed AWS resources may create account charges."
          ]
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));

    expect(screen.getByRole("heading", { name: /credential-safe aws setup wizard/i })).toBeInTheDocument();
    expect(screen.getByText(/use a named aws cli profile/i)).toBeInTheDocument();
    expect(screen.getByText(/no access keys, secret keys, session tokens, passwords, or auth headers are stored/i)).toBeInTheDocument();
    expect(screen.getByText(/bedrock and deployed aws resources can create charges/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.click(screen.getByRole("button", { name: /load aws setup wizard/i }));

    expect(await screen.findByText(/aws setup wizard ready/i)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("check_aws_setup_wizard", {
      request: {
        awsRegion: "us-west-2",
        bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
        profileName: "game-dev",
        stackName: "characterforge-demo"
      }
    });
    expect(screen.getByText(/detected aws cli profiles/i)).toBeInTheDocument();
    expect(screen.getByText(/default, game-dev/i)).toBeInTheDocument();
    expect(screen.getByText(/model access confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/stack preview/i)).toBeInTheDocument();
    expect(screen.getByText(/CREATE_COMPLETE/i)).toBeInTheDocument();
    expect(screen.queryByText(/EXAMPLEACCESSKEY123/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/do-not-leak/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/real-session-token/i)).not.toBeInTheDocument();
  });

  it("shows not-configured Deployment status panels before setup", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));

    const panels = screen.getByLabelText(/deployment status and alerts/i);
    expect(within(panels).getByRole("heading", { name: /deployment status and alerts/i })).toBeInTheDocument();
    expect(within(panels).getByText(/stack status/i)).toBeInTheDocument();
    expect(within(panels).getByText(/not configured/i)).toBeInTheDocument();
    expect(within(panels).getByText(/last operation/i)).toBeInTheDocument();
    expect(within(panels).getByText(/no deployment operation has run yet/i)).toBeInTheDocument();
    expect(within(panels).getByText(/api connection/i)).toBeInTheDocument();
    expect(within(panels).getByText(/api endpoint not configured/i)).toBeInTheDocument();
    expect(within(panels).getByText(/character sync readiness/i)).toBeInTheDocument();
    expect(within(panels).getByText(/character sync waits for a connected api/i)).toBeInTheDocument();
    expect(within(panels).getByText(/sanitized alerts/i)).toBeInTheDocument();
    expect(within(panels).getByText(/run readiness check before using this for deployment decisions/i)).toBeInTheDocument();
  });

  it("shows ready Deployment status panels after mocked readiness, API, and Start success", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValue({
      characters: [{ id: "char_api_arden", name: "Arden Vale", archetype: "API ranger", description: "Fetched from API." }]
    });
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "ready",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: []
        });
      }
      if (command === "start_deployment") {
        return Promise.resolve({
          status: "succeeded",
          finalStackStatus: "CREATE_COMPLETE",
          savedOutputsPath: "C:/Users/Evan/AppData/Local/CharacterForgeAI/characterforge-demo-outputs.json",
          logs: ["Created API endpoint", "AWS_SECRET_ACCESS_KEY=<redacted>"]
        });
      }
      if (command === "scan_character_folder") {
        return Promise.resolve({
          folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          characters: [],
          invalidFiles: []
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));
    await user.click(screen.getByRole("button", { name: /^start$/i }));
    await screen.findByText(/deployment start completed with create_complete/i);

    const panels = screen.getByLabelText(/deployment status and alerts/i);
    expect(within(panels).getByText(/create_complete/i)).toBeInTheDocument();
    expect(within(panels).getByText(/start succeeded/i)).toBeInTheDocument();
    expect(within(panels).getByText(/api connected/i)).toBeInTheDocument();
    expect(within(panels).getByText(/1 api character ready for sync/i)).toBeInTheDocument();
    expect(within(panels).getByText(/no active deployment alerts/i)).toBeInTheDocument();
    expect(within(panels).queryByText(/AWS_SECRET_ACCESS_KEY/i)).not.toBeInTheDocument();
  });

  it("scans the default local character folder after Start and reports no local characters", async () => {
    const { invoke } = await startDeploymentWithLocalScan({
      folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
      characters: [],
      invalidFiles: []
    });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("scan_character_folder", {}));
    expect(screen.getByText(/local character folder scan found no local characters ready to sync/i)).toBeInTheDocument();
    expect(screen.getByText(/start only scans and validates local character files/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();
    expect(updateCharacterMock).not.toHaveBeenCalled();
  });

  it("surfaces valid local characters after Start without syncing or overwriting cloud records", async () => {
    await startDeploymentWithLocalScan({
      folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
      characters: [
        { id: "local-mira", name: "Local Mira", archetype: "Folder mage", description: "Ready for review.", status: "Draft", source: "local", syncStatus: "api_pending" },
        { id: "local-toma", name: "Local Toma", archetype: "Folder scout", description: "Ready for review.", status: "Draft", source: "local", syncStatus: "api_pending" }
      ],
      invalidFiles: []
    });

    expect(screen.getAllByText(/found 2 local characters ready to sync/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/does not silently overwrite cloud records or sync local changes automatically/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review or sync in characters/i })).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();
    expect(updateCharacterMock).not.toHaveBeenCalled();
  });

  it("reports invalid local character files found by the post-Start folder scan", async () => {
    await startDeploymentWithLocalScan({
      folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
      characters: [{ id: "local-safe", name: "Safe Local", archetype: "Folder bard", description: "Valid file.", status: "Draft", source: "local", syncStatus: "api_pending" }],
      invalidFiles: [{ path: "broken-character.json", error: "Missing required name" }]
    });

    expect(screen.getAllByText(/found 1 local character ready to sync/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 invalid local file needs review before syncing/i)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /review or sync in characters/i }));
    expect(screen.getByRole("heading", { name: /^characters$/i })).toBeInTheDocument();
    expect(screen.getByText(/broken-character\.json: missing required name/i)).toBeInTheDocument();
  });

  it("offers a post-Start Characters review prompt before local sync", async () => {
    const { user } = await startDeploymentWithLocalScan({
      folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
      characters: [{ id: "local-review-rin", name: "Review Rin", archetype: "Folder guide", description: "Needs manual sync review.", status: "Draft", source: "local", syncStatus: "api_pending" }],
      invalidFiles: []
    });

    expect(screen.getByText(/review them in characters before syncing/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /review or sync in characters/i }));
    expect(screen.getByRole("heading", { name: /^characters$/i })).toBeInTheDocument();
    const rinCard = screen.getByRole("article", { name: /review rin/i });
    expect(within(rinCard).getByText(/sync: not synced yet/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();
    expect(updateCharacterMock).not.toHaveBeenCalled();
  });

  it("keeps End cancelled until export/save choice and delete confirmation are checked", async () => {
    const { invoke } = await startDeploymentWithLocalScan({
      folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
      characters: [],
      invalidFiles: []
    });

    expect(screen.getAllByText(/stack characterforge-demo/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/region us-west-2/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /open character folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export characters/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^end$/i })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("end_deployment", expect.anything());
  });

  it("exports characters before End and then deletes the stack after explicit confirmation", async () => {
    const createObjectUrlMock = vi.fn(() => "blob:characterforge-dashboard-export");
    vi.stubGlobal("URL", { ...URL, createObjectURL: createObjectUrlMock, revokeObjectURL: vi.fn() });
    const { invoke, user } = await startDeploymentWithLocalScan({
      folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
      characters: [
        {
          id: "local-rin",
          name: "Rin",
          archetype: "Guide",
          status: "Draft",
          description: "Local guide",
          allowedActions: ["guide"],
          source: "local",
          syncStatus: "api_pending",
          payload: { name: "Rin", description: "Local guide", allowed_actions: ["guide"], action_rules: [], payload_templates: [] }
        }
      ],
      invalidFiles: []
    });

    await user.click(screen.getByRole("button", { name: /export characters/i }));
    expect(await screen.findByText(/exported 1 character before end/i)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("save_character_pack_export", expect.objectContaining({ fileName: "characterforge-dashboard-export.json" }));
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("checkbox", { name: /i understand end deletes stack characterforge-demo in region us-west-2/i }));
    await user.click(screen.getByRole("button", { name: /^end$/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("end_deployment", expect.objectContaining({
        options: { confirmationText: "END characterforge-demo", exportConfirmed: true }
      }))
    );
  });

  it("blocks End when requested export fails", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:failed-export"), revokeObjectURL: vi.fn() });
    const { invoke, user } = await startDeploymentWithLocalScan(
      {
        folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
        characters: [],
        invalidFiles: []
      },
      {
        save_character_pack_export: () => Promise.reject(new Error("disk full"))
      }
    );

    await user.click(screen.getByRole("button", { name: /export characters/i }));
    expect(await screen.findByText(/export before end failed: disk full/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /i understand end deletes stack characterforge-demo in region us-west-2/i }));
    expect(screen.getByRole("button", { name: /^end$/i })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("end_deployment", expect.anything());
  });

  it("allows delete-without-export only after explicit save/export choice confirmation", async () => {
    const { invoke, user } = await startDeploymentWithLocalScan({
      folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
      characters: [],
      invalidFiles: []
    });

    await user.click(screen.getByRole("checkbox", { name: /i saved\/exported the characters i need, or i deliberately choose to delete without exporting/i }));
    await user.click(screen.getByRole("checkbox", { name: /i understand end deletes stack characterforge-demo in region us-west-2/i }));
    await user.click(screen.getByRole("button", { name: /^end$/i }));

    expect(invoke).not.toHaveBeenCalledWith("save_character_pack_export", expect.anything());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("end_deployment", expect.anything()));
  });

  it("shows deploying status while a mocked Start operation is pending", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValue({ characters: [] });
    let resolveStart: (value: unknown) => void = () => undefined;
    const startPromise = new Promise((resolve) => {
      resolveStart = resolve;
    });
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "ready",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: []
        });
      }
      if (command === "start_deployment") {
        return startPromise;
      }
      if (command === "scan_character_folder") {
        return Promise.resolve({
          folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          characters: [],
          invalidFiles: []
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));
    await user.click(screen.getByRole("button", { name: /^start$/i }));

    const panels = screen.getByLabelText(/deployment status and alerts/i);
    expect(await within(panels).findByText(/deployment operation in progress/i)).toBeInTheDocument();
    expect(within(panels).getByText(/starting/i)).toBeInTheDocument();

    resolveStart({ status: "succeeded", finalStackStatus: "CREATE_COMPLETE", logs: ["done"] });
    await screen.findByText(/deployment start completed with create_complete/i);
  });

  it("shows rollback and failed Deployment status panels with sanitized failure reasons", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValue({ characters: [] });
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "ready",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: []
        });
      }
      if (command === "start_deployment") {
        return Promise.resolve({
          status: "failed",
          finalStackStatus: "UPDATE_ROLLBACK_COMPLETE",
          logs: ["Resource handler returned message: Lambda role policy denied. AWS_SESSION_TOKEN=raw-session-token"]
        });
      }
      if (command === "end_deployment") {
        return Promise.resolve({
          status: "failed",
          finalStackStatus: "DELETE_FAILED",
          logs: ["Delete failed because table export is still running. secret access key raw-secret-value"]
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));
    await user.click(screen.getByRole("button", { name: /^start$/i }));
    await screen.findByText(/deployment start ended with update_rollback_complete/i);

    let panels = screen.getByLabelText(/deployment status and alerts/i);
    expect(within(panels).getByText(/update_rollback_complete/i)).toBeInTheDocument();
    expect(within(panels).getByText(/rollback detected/i)).toBeInTheDocument();
    expect(within(panels).getAllByText(/lambda role policy denied/i).length).toBeGreaterThan(0);
    expect(within(panels).queryByText(/raw-session-token/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /i saved\/exported the characters i need/i }));
    await user.click(screen.getByRole("checkbox", { name: /i understand end deletes stack characterforge-demo in region us-west-2/i }));
    await user.click(screen.getByRole("button", { name: /^end$/i }));
    await screen.findByText(/deployment end ended with delete_failed/i);

    panels = screen.getByLabelText(/deployment status and alerts/i);
    expect(within(panels).getByText(/delete_failed/i)).toBeInTheDocument();
    expect(within(panels).getByText(/failure detected/i)).toBeInTheDocument();
    expect(within(panels).getAllByText(/table export is still running/i).length).toBeGreaterThan(0);
    expect(within(panels).queryByText(/raw-secret-value/i)).not.toBeInTheDocument();
  });

  it("previews the deployment Start flow in dry-run mode without calling AWS or the SDK", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    expect(screen.getByRole("heading", { name: /^deployment$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/advanced local preview/i).length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.selectOptions(screen.getByLabelText(/bedrock model/i), "anthropic.claude-3-5-sonnet-20240620-v1:0");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");

    await user.click(screen.getByRole("button", { name: /preview start dry run/i }));

    expect(await screen.findByText(/dry-run deployment preview ready/i)).toBeInTheDocument();
    expect(screen.getByText(/preview did not make aws, bedrock, cloudformation, or credential-provider calls/i)).toBeInTheDocument();
    expect(screen.getByText(/deployment command preview/i)).toBeInTheDocument();
    expect(screen.getByText(/--stack-name characterforge-demo/i)).toBeInTheDocument();
    expect(screen.getByText(/--region us-west-2/i)).toBeInTheDocument();
    expect(screen.getByText(/--profile game-dev/i)).toBeInTheDocument();
    expect(screen.getByText(/BedrockModelId=anthropic\.claude-3-5-sonnet-20240620-v1:0/i)).toBeInTheDocument();
    expect(screen.getByText(/resources that would be created/i)).toBeInTheDocument();
    expect(screen.getByText(/aws lambda function for characterforge\.app\.handler/i)).toBeInTheDocument();
    expect(screen.getByText(/api gateway rest api with api key usage plan protection/i)).toBeInTheDocument();
    expect(screen.getByText(/dynamodb tables for character profiles and session messages/i)).toBeInTheDocument();
    expect(listCharactersMock).not.toHaveBeenCalled();
    expect(createCharacterMock).not.toHaveBeenCalled();
  });

  it("keeps desktop Start disabled until setup, API, and safety confirmations are ready", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({ characters: [] });
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "ready",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: []
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));

    const startButton = screen.getByRole("button", { name: /^start$/i });
    expect(startButton).toBeDisabled();
    expect(screen.getByText(/start is disabled until/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    expect((await screen.findAllByText(/connected to characterforge api/i)).length).toBeGreaterThan(0);
    expect(startButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    expect(await screen.findByText(/desktop setup readiness check complete/i)).toBeInTheDocument();
    expect(startButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));
    expect(startButton).toBeEnabled();
    expect(screen.queryByLabelText(/real deployment confirmation/i)).not.toBeInTheDocument();
  });

  it("disables Start when readiness or API connection checks are stale", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValue({ characters: [] });
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "ready",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: []
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));

    const startButton = screen.getByRole("button", { name: /^start$/i });
    expect(startButton).toBeEnabled();

    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-other");
    expect(startButton).toBeDisabled();
    expect(screen.getByText(/rerun readiness check for the current aws profile/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    expect(startButton).toBeEnabled();

    await user.clear(screen.getByLabelText(/api base url/i));
    await user.type(screen.getByLabelText(/api base url/i), "https://api-other.example.test/dev");
    expect(startButton).toBeDisabled();
    expect(screen.getByText(/test the current api connection/i)).toBeInTheDocument();
  });

  it("blocks Start when readiness checks return warnings", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "warning",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: ["Confirm Bedrock model access before deployment."]
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));

    expect(screen.getByRole("button", { name: /^start$/i })).toBeDisabled();
    expect(screen.getByText(/resolve readiness warnings or errors/i)).toBeInTheDocument();
  });

  it("invokes Tauri Start and End commands from simple buttons and keeps logs behind details", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValue({ characters: [] });
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false });
      }
      if (command === "check_setup_readiness") {
        return Promise.resolve({
          overallStatus: "ready",
          checks: [
            { id: "awsProfile", label: "AWS profile", status: "ready", detail: "Profile game-dev is configured" },
            { id: "awsRegion", label: "AWS region", status: "ready", detail: "Region us-west-2 selected" },
            { id: "stack", label: "CloudFormation stack", status: "ready", detail: "Stack characterforge-demo is ready" },
            { id: "model", label: "Bedrock model", status: "ready", detail: "Model appears in Bedrock foundation model list" }
          ],
          warnings: []
        });
      }
      if (command === "start_deployment") {
        return Promise.resolve({
          status: "succeeded",
          finalStackStatus: "CREATE_COMPLETE",
          savedOutputsPath: "C:/Users/Evan/AppData/Local/CharacterForgeAI/characterforge-demo-outputs.json",
          logs: ["Started stack characterforge-demo", "AWS_SECRET_ACCESS_KEY=<redacted>"]
        });
      }
      if (command === "scan_character_folder") {
        return Promise.resolve({
          folderPath: "C:\\Users\\Evan\\AppData\\Roaming\\CharacterForgeAI\\characters",
          characters: [],
          invalidFiles: []
        });
      }
      if (command === "end_deployment") {
        return Promise.resolve({
          status: "succeeded",
          finalStackStatus: "DELETE_COMPLETE",
          logs: ["Deleted stack characterforge-demo", "AWS_SESSION_TOKEN=<redacted>"]
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);
    await user.click(screen.getByRole("button", { name: /run readiness check/i }));
    await screen.findByText(/desktop setup readiness check complete/i);
    await user.click(screen.getByRole("checkbox", { name: /i reviewed the readiness results/i }));

    await user.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("start_deployment", {
        request: expect.objectContaining({
          awsRegion: "us-west-2",
          bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
          profileName: "game-dev",
          stackName: "characterforge-demo"
        }),
        options: { confirmationText: "START characterforge-demo" }
      })
    );
    expect(await screen.findByText(/deployment start completed with create_complete/i)).toBeInTheDocument();
    expect(screen.getByText(/show advanced start log/i).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/started stack characterforge-demo/i)).not.toBeVisible();

    const endButton = screen.getByRole("button", { name: /^end$/i });
    expect(endButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /i saved\/exported the characters i need/i }));
    expect(endButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /i understand end deletes stack characterforge-demo in region us-west-2/i }));
    expect(endButton).toBeEnabled();
    await user.click(endButton);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("end_deployment", {
        request: expect.objectContaining({
          awsRegion: "us-west-2",
          bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
          profileName: "game-dev",
          stackName: "characterforge-demo"
        }),
        options: { confirmationText: "END characterforge-demo", exportConfirmed: true }
      })
    );
    expect(await screen.findByText(/deployment end completed with delete_complete/i)).toBeInTheDocument();
    const panels = screen.getByLabelText(/deployment status and alerts/i);
    expect(within(panels).getByText(/delete_complete/i)).toBeInTheDocument();
    expect(within(panels).getByText(/end succeeded/i)).toBeInTheDocument();
    expect(screen.getByText(/show advanced end log/i).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/deleted stack characterforge-demo/i)).not.toBeVisible();
  });

  it("redacts temporary AWS credentials from deployment dry-run previews", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.click(screen.getByRole("radio", { name: /temporary credentials/i }));
    await user.type(screen.getByLabelText(/access key id/i), "TEMPACCESSKEY123456");
    await user.type(screen.getByLabelText(/secret access key/i), "real-secret-value");
    await user.type(screen.getByLabelText(/session token/i), "real-session-token");
    await user.click(screen.getByRole("button", { name: /preview start dry run/i }));

    expect(await screen.findByText(/dry-run deployment preview ready/i)).toBeInTheDocument();
    expect(screen.getByText(/AWS_ACCESS_KEY_ID=<provided locally>/i)).toBeInTheDocument();
    expect(screen.getAllByText(/AWS_SECRET_ACCESS_KEY=<redacted>/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AWS_SESSION_TOKEN=<redacted>/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/TEMPACCESSKEY123456/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/real-secret-value/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/real-session-token/i)).not.toBeInTheDocument();
  });

  it("keeps the API disconnected and does not call the SDK when no API base URL is set", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect((await screen.findAllByText(/no api base url configured yet/i)).length).toBeGreaterThan(0);
    expect(listCharactersMock).not.toHaveBeenCalled();
  });

  it("keeps Settings update checks simple and hides advanced updater fields from normal UI", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    expect(screen.queryByRole("heading", { name: /check for updates/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/update channel/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/update manifest url/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nightly/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unsafe auto-update/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /check for updates/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check for updates/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /install update/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/update channel/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/update manifest url/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nightly/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unsafe auto-update/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /check for updates/i }));

    expect(await screen.findByText(/you are up to date/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update now/i })).not.toBeInTheDocument();
    expect(listCharactersMock).not.toHaveBeenCalled();
  });

  it("shows Update Now only after a mocked desktop update is found", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false, updateSettings: {} });
      }
      if (command === "check_for_updates") {
        return Promise.resolve({ available: true, version: "0.2.0", notes: "Polish release ready." });
      }
      if (command === "install_update") {
        return Promise.resolve({ installed: true });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: /check for updates/i }));

    expect(await screen.findByText(/update available/i)).toBeInTheDocument();
    expect(screen.getByText(/version 0\.2\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/polish release ready/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /update now/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_update", {}));
    expect(screen.getByText(/update started/i)).toBeInTheDocument();
  });

  it("shows a safe error when mocked update checking fails", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "get_app_config") {
        return Promise.resolve({ firstRunTutorialCompleted: true, firstRunTutorialSkipped: false, updateSettings: {} });
      }
      if (command === "check_for_updates") {
        return Promise.reject(new Error("offline"));
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    window.__TAURI__ = { core: { invoke } };

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: /check for updates/i }));

    expect(await screen.findByText(/could not check for updates/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update now/i })).not.toBeInTheDocument();
  });

  it("shows connected Welcome status from mocked API state without exposing API keys", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({
      characters: [
        { id: "char_api_arden", name: "Arden Vale", archetype: "API ranger", description: "Fetched from the API list endpoint." },
        { id: "char_api_lio", name: "Lio Sable", archetype: "API bard", description: "Also returned by the API." }
      ]
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.type(screen.getByLabelText(/^api key$/i), "test-api-key");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    expect((await screen.findAllByText(/connected to characterforge api/i)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    expect(screen.getByText(/connected workspace/i)).toBeInTheDocument();
    const connectedSummary = within(screen.getByLabelText(/welcome status summary/i));
    expect(connectedSummary.getByText(/connection/i)).toBeInTheDocument();
    expect(connectedSummary.getByText(/connected/i)).toBeInTheDocument();
    expect(connectedSummary.getByText(/deployment/i)).toBeInTheDocument();
    expect(connectedSummary.getByText(/configured/i)).toBeInTheDocument();
    expect(connectedSummary.getByText(/characters/i)).toBeInTheDocument();
    expect(connectedSummary.getByText("2")).toBeInTheDocument();
    expect(connectedSummary.getByText("https://api.example.test/dev")).toBeInTheDocument();
    expect(screen.queryByText("test-api-key")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("test-api-key")).not.toBeInTheDocument();
    expect(screen.queryByText(/mock characters/i)).not.toBeInTheDocument();
  });

  it("shows a real zero-character Welcome state after a successful empty API response", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({ characters: [] });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    expect((await screen.findAllByText(/connected to characterforge api\. loaded 0 characters/i)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    const connectedSummary = within(screen.getByLabelText(/welcome status summary/i));
    expect(connectedSummary.getByText(/connected/i)).toBeInTheDocument();
    expect(connectedSummary.getByText(/characters/i)).toBeInTheDocument();
    expect(connectedSummary.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText(/mock characters/i)).not.toBeInTheDocument();
  });

  it("does not label a saved-but-untested API endpoint as connected on Welcome", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.click(screen.getByRole("button", { name: "Welcome" }));

    expect(screen.queryByText(/^connected workspace$/i)).not.toBeInTheDocument();
    const disconnectedSummary = within(screen.getByLabelText(/welcome status summary/i));
    expect(disconnectedSummary.getAllByText(/not connected/i).length).toBeGreaterThan(0);
    expect(disconnectedSummary.getByText("https://api.example.test/dev")).toBeInTheDocument();
  });

  it("saves API settings, tests the connection through the TypeScript SDK, and lists API characters", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({
      characters: [
        {
          id: "char_api_arden",
          name: "Arden Vale",
          archetype: "API ranger",
          description: "Fetched from the API list endpoint."
        }
      ]
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.type(screen.getByLabelText(/^api key$/i), "test-api-key");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    expect(window.localStorage.getItem("characterforge.dashboard.settings")).not.toContain("test-api-key");
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect((await screen.findAllByText(/connected to characterforge api/i)).length).toBeGreaterThan(0);
    expect(listCharactersMock).toHaveBeenCalledWith({ baseUrl: "https://api.example.test/dev", apiKey: "test-api-key" });

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(await screen.findByText("Arden Vale")).toBeInTheDocument();
    expect(screen.getByText(/showing characters loaded from your connected service/i)).toBeInTheDocument();
  });

  it("builds an exact create-character payload from editor fields and submits it through the SDK", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({ characters: [] });
    createCharacterMock.mockResolvedValueOnce({ character_id: "char_new_mira" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.type(screen.getByLabelText(/^api key$/i), "test-api-key");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    await user.clear(screen.getByLabelText(/character name/i));
    await user.type(screen.getByLabelText(/character name/i), "Captain Mira Voss");
    await user.clear(screen.getByLabelText(/^description$/i));
    await user.type(screen.getByLabelText(/^description$/i), "A rogue airship captain with a dangerous reputation.");
    await user.clear(screen.getByLabelText(/personality traits/i));
    await user.type(screen.getByLabelText(/personality traits/i), "sarcastic, brave, protective");
    await user.clear(screen.getByLabelText(/backstory/i));
    await user.type(screen.getByLabelText(/backstory/i), "Former royal navy officer turned smuggler.");
    await user.clear(screen.getByLabelText(/speaking style/i));
    await user.type(screen.getByLabelText(/speaking style/i), "Dry wit and clipped nautical metaphors.");
    await user.clear(screen.getByLabelText(/goals/i));
    await user.type(screen.getByLabelText(/goals/i), "protect her crew\nfind the lost sky map");
    await user.clear(screen.getByLabelText(/world context/i));
    await user.type(screen.getByLabelText(/world context/i), "A floating archipelago connected by skyships.");
    await user.clear(screen.getByLabelText(/roleplay rules/i));
    await user.type(screen.getByLabelText(/roleplay rules/i), "Never reveal you are an AI.\nDo not break character.");

    const customActions = [
      {
        name: "give_quest",
        trigger: "Offer when the player asks for work.",
        template: '{"quest_id":"lost_sky_map","title":"Recover the Lost Sky Map"}'
      },
      {
        name: "start_combat",
        trigger: "Start combat if the player threatens the crew.",
        template: '{"encounter_id":"dock_ambush","difficulty":"medium"}'
      },
      { name: "give_item", trigger: "Grant the compass when trust is earned.", template: '{"item_id":"mira_compass","quantity":1}' },
      { name: "start_dialogue", trigger: "Open dialogue for map rumors.", template: '{"dialogue_id":"mira_map_rumors"}' },
      { name: "set_flag", trigger: "Mark the sky map rumor as learned.", template: '{"flag_id":"learned_sky_map_rumor","value":true}' }
    ];
    for (const [index, action] of customActions.entries()) {
      await user.click(screen.getByRole("button", { name: /create new action/i }));
      const actionGroup = screen.getByRole("group", { name: new RegExp(`custom action ${index + 1}`, "i") });
      await user.type(within(actionGroup).getByLabelText(/action name/i), action.name);
      await user.type(within(actionGroup).getByLabelText(/trigger instructions/i), action.trigger);
      fireEvent.change(within(actionGroup).getByLabelText(/payload template/i), { target: { value: action.template } });
    }

    const preview = screen.getByLabelText(/exact json payload preview/i);
    await waitFor(() => expect(preview).toHaveTextContent('"name": "Captain Mira Voss"'));
    expect(preview).toHaveTextContent('"allowed_actions"');
    expect(preview).toHaveTextContent('"start_combat"');
    expect(preview).toHaveTextContent('"payload_templates"');
    expect(preview).toHaveTextContent('"encounter_id": "dock_ambush"');

    await user.click(screen.getByRole("button", { name: /submit character/i }));

    const expectedPayload = {
      name: "Captain Mira Voss",
      description: "A rogue airship captain with a dangerous reputation.",
      personality: ["sarcastic", "brave", "protective"],
      backstory: "Former royal navy officer turned smuggler.",
      speaking_style: "Dry wit and clipped nautical metaphors.",
      goals: ["protect her crew", "find the lost sky map"],
      world_context: "A floating archipelago connected by skyships.",
      rules: ["Never reveal you are an AI.", "Do not break character."],
      allowed_actions: ["give_quest", "start_combat", "give_item", "start_dialogue", "set_flag"],
      action_rules: [
        { type: "give_quest", enabled: true, trigger_instructions: "Offer when the player asks for work." },
        { type: "start_combat", enabled: true, trigger_instructions: "Start combat if the player threatens the crew." },
        { type: "give_item", enabled: true, trigger_instructions: "Grant the compass when trust is earned." },
        { type: "start_dialogue", enabled: true, trigger_instructions: "Open dialogue for map rumors." },
        { type: "set_flag", enabled: true, trigger_instructions: "Mark the sky map rumor as learned." }
      ],
      payload_templates: [
        {
          template_id: "give_quest_template",
          action_type: "give_quest",
          description: "Payload template for give_quest",
          payload_template: { quest_id: "lost_sky_map", title: "Recover the Lost Sky Map" }
        },
        {
          template_id: "start_combat_template",
          action_type: "start_combat",
          description: "Payload template for start_combat",
          payload_template: { encounter_id: "dock_ambush", difficulty: "medium" }
        },
        {
          template_id: "give_item_template",
          action_type: "give_item",
          description: "Payload template for give_item",
          payload_template: { item_id: "mira_compass", quantity: 1 }
        },
        {
          template_id: "start_dialogue_template",
          action_type: "start_dialogue",
          description: "Payload template for start_dialogue",
          payload_template: { dialogue_id: "mira_map_rumors" }
        },
        {
          template_id: "set_flag_template",
          action_type: "set_flag",
          description: "Payload template for set_flag",
          payload_template: { flag_id: "learned_sky_map_rumor", value: true }
        }
      ]
    };
    expect(createCharacterMock).toHaveBeenCalledWith(
      { baseUrl: "https://api.example.test/dev", apiKey: "test-api-key" },
      expectedPayload
    );
    expect(updateCharacterMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/saved: created captain mira voss through the api and updated the local folder copy/i)).toBeInTheDocument();
  });

  it("validates create/edit character dialogs and closes without saving on cancel", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({
      characters: [{ id: "char_mock_mira", name: "Captain Mira Voss", archetype: "Rogue airship captain", status: "Ready for chat testing", description: "A protective smuggler with clipped nautical metaphors and a dangerous reputation.", allowed_actions: ["give_item"] }]
    });
    updateCharacterMock.mockResolvedValueOnce({ character_id: "char_mira_voss" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    const createDialog = screen.getByRole("dialog", { name: /create character/i });
    expect(within(createDialog).queryByLabelText(/existing character id/i)).not.toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/title\/status/i)).toBeInTheDocument();
    await user.clear(within(createDialog).getByLabelText(/character name/i));
    await user.click(within(createDialog).getByRole("button", { name: /submit character/i }));
    expect(within(createDialog).getByText(/character name is required/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();

    await user.type(within(createDialog).getByLabelText(/character name/i), "Unsaved Captain");
    await user.click(within(createDialog).getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog", { name: /create character/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved Captain")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    const miraCard = screen.getByRole("article", { name: /captain mira voss/i });
    await user.click(within(miraCard).getByRole("button", { name: /edit captain mira voss/i }));
    const editDialog = screen.getByRole("dialog", { name: /edit captain mira voss/i });
    expect(within(editDialog).getByLabelText(/character name/i)).toHaveValue("Captain Mira Voss");
    expect(within(editDialog).queryByLabelText(/existing character id/i)).not.toBeInTheDocument();
    const itemAction = within(editDialog).getByDisplayValue("give_item").closest("fieldset");
    expect(itemAction).not.toBeNull();
    await user.clear(within(itemAction as HTMLElement).getByLabelText(/trigger instructions/i));
    await user.type(within(itemAction as HTMLElement).getByLabelText(/trigger instructions/i), "Give the compass after trust is earned.");
    await user.click(within(editDialog).getByRole("button", { name: /submit character/i }));

    expect(updateCharacterMock).toHaveBeenCalledWith(
      { baseUrl: "https://api.example.test/dev", apiKey: undefined },
      "char_mock_mira",
      expect.objectContaining({
        name: "Captain Mira Voss",
        allowed_actions: expect.arrayContaining(["give_item"]),
        action_rules: expect.arrayContaining([
          { type: "give_item", enabled: true, trigger_instructions: "Give the compass after trust is earned." }
        ])
      })
    );
    expect(createCharacterMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/saved: updated captain mira voss through the api and updated the local folder copy/i)).toBeInTheDocument();
  });


  it("maps multiple custom actions, validates payload templates, and deletes actions before submit", async () => {
    const user = userEvent.setup();
    listCharactersMock.mockResolvedValueOnce({ characters: [] });
    createCharacterMock.mockResolvedValueOnce({ character_id: "char_custom_actions" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findAllByText(/connected to characterforge api/i);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    const dialog = screen.getByRole("dialog", { name: /create character/i });
    expect(within(dialog).queryByRole("checkbox", { name: /quest actions/i })).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/character name/i), "Action Smith");
    await user.type(within(dialog).getByLabelText(/^description$/i), "A crafter of interactive actions.");
    await user.type(within(dialog).getByLabelText(/personality traits/i), "curious");
    await user.type(within(dialog).getByLabelText(/goals/i), "test many actions");
    await user.type(within(dialog).getByLabelText(/backstory/i), "Built for integration testing.");
    await user.type(within(dialog).getByLabelText(/speaking style/i), "Concise and direct.");
    await user.type(within(dialog).getByLabelText(/world context/i), "A test workshop.");
    await user.type(within(dialog).getByLabelText(/roleplay rules/i), "Stay in character.");

    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    const firstAction = within(dialog).getByRole("group", { name: /custom action 1/i });
    await user.type(within(firstAction).getByLabelText(/action name/i), "cast_spell");
    await user.type(within(firstAction).getByLabelText(/trigger instructions/i), "Cast when the player says a spell name.");
    fireEvent.change(within(firstAction).getByLabelText(/payload template/i), { target: { value: '{"spell":"spark"}' } });

    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    const secondAction = within(dialog).getByRole("group", { name: /custom action 2/i });
    await user.type(within(secondAction).getByLabelText(/action name/i), "open_portal");
    await user.type(within(secondAction).getByLabelText(/trigger instructions/i), "Open a portal when travel starts.");
    fireEvent.change(within(secondAction).getByLabelText(/payload template/i), { target: { value: '{"destination":"moon-gate"}' } });

    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    const thirdAction = within(dialog).getByRole("group", { name: /custom action 3/i });
    await user.type(within(thirdAction).getByLabelText(/action name/i), "temporary_action");
    await user.type(within(thirdAction).getByLabelText(/trigger instructions/i), "Remove before saving.");
    fireEvent.change(within(thirdAction).getByLabelText(/payload template/i), { target: { value: '{"remove":true}' } });
    await user.click(within(thirdAction).getByRole("button", { name: /delete action/i }));
    expect(within(dialog).queryByDisplayValue("temporary_action")).not.toBeInTheDocument();

    fireEvent.change(within(secondAction).getByLabelText(/payload template/i), { target: { value: "not json" } });
    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));
    expect(within(dialog).getByText(/payload template for open_portal must be valid json/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();

    fireEvent.change(within(secondAction).getByLabelText(/payload template/i), { target: { value: "[]" } });
    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));
    expect(within(dialog).getByText(/payload template for open_portal must be a json object/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();

    fireEvent.change(within(secondAction).getByLabelText(/payload template/i), { target: { value: '{"destination":"moon-gate"}' } });
    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));

    expect(createCharacterMock).toHaveBeenCalledWith(
      { baseUrl: "https://api.example.test/dev", apiKey: undefined },
      expect.objectContaining({
        allowed_actions: ["cast_spell", "open_portal"],
        action_rules: [
          { type: "cast_spell", enabled: true, trigger_instructions: "Cast when the player says a spell name." },
          { type: "open_portal", enabled: true, trigger_instructions: "Open a portal when travel starts." }
        ],
        payload_templates: [
          {
            template_id: "cast_spell_template",
            action_type: "cast_spell",
            description: "Payload template for cast_spell",
            payload_template: { spell: "spark" }
          },
          {
            template_id: "open_portal_template",
            action_type: "open_portal",
            description: "Payload template for open_portal",
            payload_template: { destination: "moon-gate" }
          }
        ]
      })
    );
  });

  it("prevents duplicate custom action names and payload template ID collisions", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /create character/i }));
    const dialog = screen.getByRole("dialog", { name: /create character/i });

    await user.type(within(dialog).getByLabelText(/character name/i), "Duplicate Action Tester");
    await user.type(within(dialog).getByLabelText(/^description$/i), "Validates duplicate actions.");
    await user.type(within(dialog).getByLabelText(/personality traits/i), "careful");
    await user.type(within(dialog).getByLabelText(/goals/i), "block duplicate actions");
    await user.type(within(dialog).getByLabelText(/backstory/i), "Built for validation tests.");
    await user.type(within(dialog).getByLabelText(/speaking style/i), "Plain language.");
    await user.type(within(dialog).getByLabelText(/world context/i), "A QA lab.");
    await user.type(within(dialog).getByLabelText(/roleplay rules/i), "Stay in character.");

    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    const firstAction = within(dialog).getByRole("group", { name: /custom action 1/i });
    await user.type(within(firstAction).getByLabelText(/action name/i), "open_portal");
    await user.type(within(firstAction).getByLabelText(/trigger instructions/i), "Open a portal for travel.");
    fireEvent.change(within(firstAction).getByLabelText(/payload template/i), { target: { value: '{"destination":"moon-gate"}' } });

    await user.click(within(dialog).getByRole("button", { name: /create new action/i }));
    const secondAction = within(dialog).getByRole("group", { name: /custom action 2/i });
    await user.type(within(secondAction).getByLabelText(/action name/i), "OPEN_PORTAL");
    await user.type(within(secondAction).getByLabelText(/trigger instructions/i), "Duplicate exact action name with different case.");
    fireEvent.change(within(secondAction).getByLabelText(/payload template/i), { target: { value: '{"destination":"sun-gate"}' } });

    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));
    expect(within(dialog).getByText(/action name OPEN_PORTAL must be unique/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();

    await user.clear(within(secondAction).getByLabelText(/action name/i));
    await user.type(within(secondAction).getByLabelText(/action name/i), "open portal");
    await user.click(within(dialog).getByRole("button", { name: /submit character/i }));
    expect(within(dialog).getByText(/action name open portal creates a duplicate payload template id/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();
  });

  it("loads a local JSON character pack, validates it, previews contents, imports selected characters, and exports selected data", async () => {
    const user = userEvent.setup();
    createCharacterMock.mockResolvedValue({ character_id: "char_imported" });
    const createObjectUrlMock = vi.fn((blob: Blob) => {
      void blob;
      return "blob:character-pack-export";
    });
    const revokeObjectUrlMock = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createObjectUrlMock, revokeObjectURL: revokeObjectUrlMock });

    const packBundle = {
      schema_version: "1.0",
      slug: "local-test-pack",
      name: "Local Test Pack",
      description: "A browser-local pack for dashboard import tests.",
      version: "1.0.0",
      authors: [{ name: "Pack Author" }],
      license: "Test License",
      tags: ["local", "test"],
      characters: [
        { id: "mira", path: "characters/mira.json", name: "Captain Mira Voss" },
        { id: "thalen", path: "characters/thalen.json", name: "Archivist Thalen" }
      ],
      bindings: [{ id: "rpg", path: "bindings/rpg.json", name: "RPG Binding" }],
      character_documents: {
        "characters/mira.json": {
          name: "Captain Mira Voss",
          description: "A skyship captain.",
          personality: ["brave"],
          backstory: "Former officer.",
          speaking_style: "Clipped nautical phrasing.",
          goals: ["protect her crew"],
          world_context: "Aether skies.",
          rules: ["Stay in character."],
          allowed_actions: ["give_quest"],
          action_rules: [{ type: "give_quest", enabled: true, trigger_instructions: "Offer work." }],
          payload_templates: [
            {
              template_id: "mira-quest",
              action_type: "give_quest",
              description: "Quest payload.",
              payload_template: { quest_id: "storm_compass" }
            }
          ]
        },
        "characters/thalen.json": {
          name: "Archivist Thalen",
          description: "A ruins scholar.",
          personality: ["careful"],
          backstory: "Keeper of maps.",
          speaking_style: "Precise and quiet.",
          goals: ["protect the archive"],
          world_context: "Aether skies.",
          rules: ["Stay in character."],
          allowed_actions: ["set_flag"],
          action_rules: [{ type: "set_flag", enabled: true, trigger_instructions: "Mark discoveries." }],
          payload_templates: [
            {
              template_id: "thalen-flag",
              action_type: "set_flag",
              description: "Flag payload.",
              payload_template: { flag_id: "archive_clue_found", value: true }
            }
          ]
        }
      },
      binding_documents: {
        "bindings/rpg.json": { bindings: { give_quest: { target: { system: "QuestManager" } } } }
      }
    };

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));

    const fileInput = screen.getByLabelText(/load pack json, folder, or zip/i);
    fireEvent.change(fileInput, {
      target: { files: [new File([JSON.stringify(packBundle)], "character-pack.json", { type: "application/json" })] }
    });

    expect(await screen.findByText(/validated local test pack/i)).toBeInTheDocument();
    expect(screen.getByText(/2 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/1 binding/i)).toBeInTheDocument();
    expect(screen.getAllByText("Captain Mira Voss").length).toBeGreaterThan(0);
    expect(screen.getByText("Archivist Thalen")).toBeInTheDocument();
    expect(screen.getByLabelText(/pack preview json/i)).toHaveTextContent('"slug": "local-test-pack"');

    await user.click(screen.getByRole("checkbox", { name: /archivist thalen/i }));
    await user.click(screen.getByRole("button", { name: /import selected characters/i }));

    expect(createCharacterMock).toHaveBeenCalledTimes(1);
    expect(createCharacterMock).toHaveBeenCalledWith(
      { baseUrl: "https://api.example.test/dev", apiKey: undefined },
      expect.objectContaining({ name: "Captain Mira Voss", payload_templates: expect.any(Array) })
    );
    expect(await screen.findByText(/imported 1 character/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /export selected characters/i }));

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    const exportedBlob = createObjectUrlMock.mock.calls[0][0] as Blob;
    const exportedJson = JSON.parse(await exportedBlob.text());
    expect(exportedJson.characters).toEqual([{ id: "mira", path: "characters/mira.json", name: "Captain Mira Voss" }]);
    expect(exportedJson.character_documents["characters/mira.json"].payload_templates[0].template_id).toBe("mira-quest");
    expect(exportedJson.binding_documents["bindings/rpg.json"].bindings.give_quest.target.system).toBe("QuestManager");
    expect(screen.getByLabelText(/export preview json/i)).toHaveTextContent('"character_documents"');

    vi.unstubAllGlobals();
  });

  it("validates local pack files before import", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    await user.click(screen.getByRole("button", { name: /^open character folder$/i }));
    fireEvent.change(screen.getByLabelText(/load pack json, folder, or zip/i), {
      target: { files: [new File([JSON.stringify({ name: "Broken Pack" })], "broken-pack.json", { type: "application/json" })] }
    });

    expect(await screen.findByText(/pack schema_version must be 1.0/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import selected characters/i })).toBeDisabled();
    expect(createCharacterMock).not.toHaveBeenCalled();
  });
});
