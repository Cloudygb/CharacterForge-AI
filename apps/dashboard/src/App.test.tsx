import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const listCharactersMock = vi.fn();
const createCharacterMock = vi.fn();
const updateCharacterMock = vi.fn();

vi.mock("@characterforge/characterforge-ai", () => ({
  CharacterForgeClient: vi.fn().mockImplementation(function CharacterForgeClientMock(
    this: {
      createCharacter: (payload: unknown) => Promise<unknown>;
      listCharacters: () => Promise<unknown>;
      updateCharacter: (characterId: string, payload: unknown) => Promise<unknown>;
    },
    options: { apiKey?: string; baseUrl: string }
  ) {
    this.createCharacter = (payload: unknown) => createCharacterMock(options, payload);
    this.listCharacters = () => listCharactersMock(options);
    this.updateCharacter = (characterId: string, payload: unknown) => updateCharacterMock(options, characterId, payload);
  })
}));

describe("CharacterForge dashboard", () => {
  beforeEach(() => {
    listCharactersMock.mockReset();
    createCharacterMock.mockReset();
    updateCharacterMock.mockReset();
    delete window.__TAURI__;
    window.localStorage.clear();
  });

  it("renders only the simplified next-release dashboard sections in the sidebar", () => {
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: /dashboard screens/i });
    const topLevelButtons = within(navigation).getAllByRole("button");
    expect(topLevelButtons.map((button) => button.textContent)).toEqual(["Welcome", "Deployment", "Characters", "Chat", "Settings"]);

    for (const removedScreenName of ["API Settings", "Setup Check", "Character Editor", "Character Packs", "Chat Test", "Raw JSON Preview"]) {
      expect(within(navigation).queryByRole("button", { name: removedScreenName })).not.toBeInTheDocument();
    }
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

    await user.click(screen.getByRole("button", { name: /open deployment setup/i }));
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
    expect(screen.getByRole("button", { name: /open character editor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open character packs/i })).toBeInTheDocument();

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
    await user.click(screen.getByRole("button", { name: /open character editor/i }));
    expect(screen.getByRole("heading", { name: /character editor/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Welcome" }));
    await user.click(screen.getByRole("button", { name: /open character packs/i }));
    expect(screen.getByRole("heading", { name: /character packs/i })).toBeInTheDocument();

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

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getByRole("heading", { name: /characters/i })).toBeInTheDocument();
    expect(screen.getByText("Captain Mira Voss")).toBeInTheDocument();
    expect(screen.getByText("Ember Archivist Thalen")).toBeInTheDocument();
    expect(screen.getByText(/showing mock characters/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Character Editor" }));
    expect(screen.getByRole("heading", { name: /character editor/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/character name/i)).toHaveValue("Captain Mira Voss");
    expect(screen.getByText(/allowed action types/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Character Packs" }));
    expect(screen.getByRole("heading", { name: /character packs/i })).toBeInTheDocument();
    expect(screen.getByText(/load a local pack/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByRole("heading", { name: /^chat$/i })).toBeInTheDocument();
    expect(screen.getByText(/meet me at the eastern dock/i)).toBeInTheDocument();
    expect(screen.getByText(/give_quest/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /check for updates/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/api base url/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/do not paste production api keys into committed files/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Raw JSON Preview" }));
    expect(screen.getByRole("heading", { name: /raw json preview/i })).toBeInTheDocument();
    expect(screen.getByText(/mockCharacters/i)).toBeInTheDocument();
    expect(screen.getByText(/connectionStatus/i)).toBeInTheDocument();
  });

  it("runs mocked setup checks for AWS readiness without calling AWS", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));

    expect(screen.getByText(/mocked setup-check adapter/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/aws region/i)).toHaveValue("us-east-1");
    expect(screen.getByLabelText(/bedrock model/i)).toHaveValue("anthropic.claude-3-haiku-20240307-v1:0");
    expect(screen.getByText(/credential status/i)).toBeInTheDocument();
    expect(screen.getAllByText(/not checked yet/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /run readiness check/i }));

    expect(await screen.findByText(/mock setup check complete/i)).toBeInTheDocument();
    expect(screen.getAllByText(/aws region/i).length).toBeGreaterThan(0);
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText(/selected bedrock model/i)).toBeInTheDocument();
    expect(screen.getByText("anthropic.claude-3-haiku-20240307-v1:0")).toBeInTheDocument();
    expect(screen.getAllByText(/credential status/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/mock credentials detected/i)).toBeInTheDocument();
    expect(screen.getByText(/bedrock access status/i)).toBeInTheDocument();
    expect(screen.getAllByText(/model access simulated as ready/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/existing stack status/i)).toBeInTheDocument();
    expect(screen.getByText(/no existing stack found/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /warnings/i })).toBeInTheDocument();
    expect(screen.getAllByText(/mock results only/i).length).toBeGreaterThan(0);
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

    expect(await screen.findByText(/mock setup check complete/i)).toBeInTheDocument();
    expect(screen.getByText("eu-west-1")).toBeInTheDocument();
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
    expect(screen.getByText(/uses named aws cli profiles/i)).toBeInTheDocument();
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

    await user.click(screen.getByRole("checkbox", { name: /i exported the character packs/i }));
    await user.click(screen.getByRole("checkbox", { name: /i understand end deletes/i }));
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
    expect(screen.getAllByText(/dry-run mode only/i).length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "us-west-2");
    await user.selectOptions(screen.getByLabelText(/bedrock model/i), "anthropic.claude-3-5-sonnet-20240620-v1:0");
    await user.clear(screen.getByLabelText(/stack name/i));
    await user.type(screen.getByLabelText(/stack name/i), "characterforge-demo");
    await user.clear(screen.getByLabelText(/aws profile name/i));
    await user.type(screen.getByLabelText(/aws profile name/i), "game-dev");

    await user.click(screen.getByRole("button", { name: /preview start dry run/i }));

    expect(await screen.findByText(/dry-run deployment preview ready/i)).toBeInTheDocument();
    expect(screen.getByText(/no aws, sam, cloudformation, bedrock, or credential provider calls were made/i)).toBeInTheDocument();
    expect(screen.getByText(/sam deploy command preview/i)).toBeInTheDocument();
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
    expect(screen.getByText(/real start redacted log/i).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/started stack characterforge-demo/i)).not.toBeVisible();

    const endButton = screen.getByRole("button", { name: /^end$/i });
    expect(endButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /i exported the character packs/i }));
    expect(endButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /i understand end deletes/i }));
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
    expect(screen.getByText(/real end redacted log/i).closest("details")).not.toHaveAttribute("open");
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

  it("keeps mock mode active and does not call the SDK when no API base URL is set", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect((await screen.findAllByText(/mock mode is active/i)).length).toBeGreaterThan(0);
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
    expect(screen.queryByRole("button", { name: /update now/i })).not.toBeInTheDocument();
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
    expect(screen.getByText(/api-connected dashboard/i)).toBeInTheDocument();
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

    expect(screen.queryByText(/api-connected dashboard/i)).not.toBeInTheDocument();
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
    expect(screen.getByText(/showing api characters/i)).toBeInTheDocument();
  });

  it("builds an exact create-character payload from editor fields and submits it through the SDK", async () => {
    const user = userEvent.setup();
    createCharacterMock.mockResolvedValueOnce({ character_id: "char_new_mira" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.type(screen.getByLabelText(/^api key$/i), "test-api-key");
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await user.click(screen.getByRole("button", { name: "Character Editor" }));
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

    await user.click(screen.getByRole("checkbox", { name: /quest actions/i }));
    await user.click(screen.getByRole("checkbox", { name: /fight actions/i }));
    await user.click(screen.getByRole("checkbox", { name: /item actions/i }));
    await user.click(screen.getByRole("checkbox", { name: /dialogue actions/i }));
    await user.click(screen.getByRole("checkbox", { name: /flag actions/i }));
    await user.type(screen.getByLabelText(/trigger instructions for give_quest/i), "Offer when the player asks for work.");
    await user.type(screen.getByLabelText(/trigger instructions for start_combat/i), "Start combat if the player threatens the crew.");
    await user.type(screen.getByLabelText(/trigger instructions for give_item/i), "Grant the compass when trust is earned.");
    await user.type(screen.getByLabelText(/trigger instructions for start_dialogue/i), "Open dialogue for map rumors.");
    await user.type(screen.getByLabelText(/trigger instructions for set_flag/i), "Mark the sky map rumor as learned.");
    await user.clear(screen.getByLabelText(/quest payload template json/i));
    fireEvent.change(screen.getByLabelText(/quest payload template json/i), {
      target: { value: '{"quest_id":"lost_sky_map","title":"Recover the Lost Sky Map"}' }
    });
    await user.clear(screen.getByLabelText(/fight payload template json/i));
    fireEvent.change(screen.getByLabelText(/fight payload template json/i), {
      target: { value: '{"encounter_id":"dock_ambush","difficulty":"medium"}' }
    });

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
          template_id: "quest_template",
          action_type: "give_quest",
          description: "Quest action payload template",
          payload_template: { quest_id: "lost_sky_map", title: "Recover the Lost Sky Map" }
        },
        {
          template_id: "fight_template",
          action_type: "start_combat",
          description: "Fight action payload template",
          payload_template: { encounter_id: "dock_ambush", difficulty: "medium" }
        },
        {
          template_id: "item_template",
          action_type: "give_item",
          description: "Item action payload template",
          payload_template: { item_id: "mira_compass", quantity: 1 }
        },
        {
          template_id: "dialogue_template",
          action_type: "start_dialogue",
          description: "Dialogue action payload template",
          payload_template: { dialogue_id: "mira_map_rumors" }
        },
        {
          template_id: "flag_template",
          action_type: "set_flag",
          description: "Flag action payload template",
          payload_template: { flag_id: "learned_sky_map_rumor", value: true }
        }
      ]
    };
    expect(createCharacterMock).toHaveBeenCalledWith(
      { baseUrl: "https://api.example.test/dev", apiKey: "test-api-key" },
      expectedPayload
    );
    expect(updateCharacterMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/created character profile/i)).toBeInTheDocument();
  });

  it("validates editor input and updates existing characters when a character ID is provided", async () => {
    const user = userEvent.setup();
    updateCharacterMock.mockResolvedValueOnce({ character_id: "char_mira_voss" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Character Editor" }));
    await user.clear(screen.getByLabelText(/character name/i));
    await user.click(screen.getByRole("button", { name: /submit character/i }));
    expect(screen.getByText(/character name is required/i)).toBeInTheDocument();
    expect(createCharacterMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/character name/i), "Captain Mira Voss");

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await user.click(screen.getByRole("button", { name: "Character Editor" }));
    await user.clear(screen.getByLabelText(/existing character id/i));
    await user.type(screen.getByLabelText(/existing character id/i), "char_mira_voss");
    await user.click(screen.getByRole("checkbox", { name: /item actions/i }));
    await user.type(screen.getByLabelText(/trigger instructions for give_item/i), "Give the compass after the player earns trust.");

    await user.click(screen.getByRole("button", { name: /submit character/i }));

    expect(updateCharacterMock).toHaveBeenCalledWith(
      { baseUrl: "https://api.example.test/dev", apiKey: undefined },
      "char_mira_voss",
      expect.objectContaining({
        name: "Captain Mira Voss",
        allowed_actions: expect.arrayContaining(["give_item"]),
        action_rules: expect.arrayContaining([
          { type: "give_item", enabled: true, trigger_instructions: "Give the compass after the player earns trust." }
        ])
      })
    );
    expect(createCharacterMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/updated character profile/i)).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Character Packs" }));

    const fileInput = screen.getByLabelText(/load pack json, folder, or zip/i);
    fireEvent.change(fileInput, {
      target: { files: [new File([JSON.stringify(packBundle)], "character-pack.json", { type: "application/json" })] }
    });

    expect(await screen.findByText(/validated local test pack/i)).toBeInTheDocument();
    expect(screen.getByText(/2 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/1 binding/i)).toBeInTheDocument();
    expect(screen.getByText("Captain Mira Voss")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Character Packs" }));
    fireEvent.change(screen.getByLabelText(/load pack json, folder, or zip/i), {
      target: { files: [new File([JSON.stringify({ name: "Broken Pack" })], "broken-pack.json", { type: "application/json" })] }
    });

    expect(await screen.findByText(/pack schema_version must be 1.0/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import selected characters/i })).toBeDisabled();
    expect(createCharacterMock).not.toHaveBeenCalled();
  });
});
