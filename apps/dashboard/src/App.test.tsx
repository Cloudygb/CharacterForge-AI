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
    window.localStorage.clear();
  });

  it("renders the required dashboard screens in the sidebar", () => {
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: /dashboard screens/i });
    for (const screenName of [
      "Welcome",
      "API Settings",
      "Setup Check",
      "Deployment",
      "Characters",
      "Character Editor",
      "Character Packs",
      "Chat Test",
      "Raw JSON Preview"
    ]) {
      expect(within(navigation).getByRole("button", { name: screenName })).toBeInTheDocument();
    }
  });

  it("uses mock data by default and starts with a first-run tutorial before setup forms", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /welcome to characterforge dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/mock dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/no api base url is set/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /first-run tutorial/i })).toBeInTheDocument();
    expect(screen.getByText(/mock mode keeps this walkthrough safe/i)).toBeInTheDocument();
    expect(screen.getByText(/aws can charge for deployed resources/i)).toBeInTheDocument();
    expect(screen.getByText(/never paste production credentials/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api base url/i)).not.toBeInTheDocument();
  });

  it("walks through mock first-run tutorial screens before opening setup", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
    expect(screen.getByText(/mock mode keeps this walkthrough safe/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: safety/i }));
    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /aws can charge for deployed resources/i })).toBeInTheDocument();
    expect(screen.getAllByText(/set budgets and delete test stacks/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /next: credentials/i }));
    expect(screen.getByText(/step 3 of 4/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /never paste production credentials/i })).toBeInTheDocument();
    expect(screen.getByText(/browser fields are for local test keys only/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next: dashboard tour/i }));
    expect(screen.getByText(/step 4 of 4/i)).toBeInTheDocument();
    expect(screen.getByText(/use character packs to import and export local content/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open api settings/i }));
    expect(screen.getByRole("heading", { name: /api settings/i })).toBeInTheDocument();
    expect(screen.getByText(/review these safety notes before entering setup values/i)).toBeInTheDocument();
    expect(screen.getByText(/aws cost warning/i)).toBeInTheDocument();
    expect(screen.getByText(/credential safety warning/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api base url/i)).toBeInTheDocument();
  });

  it("navigates between setup check, character, editor, chat, settings, and JSON preview screens", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Setup Check" }));
    expect(screen.getByRole("heading", { name: /setup check/i })).toBeInTheDocument();
    expect(screen.getByText(/mocked setup-check adapter/i)).toBeInTheDocument();

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

    await user.click(screen.getByRole("button", { name: "Chat Test" }));
    expect(screen.getByRole("heading", { name: /chat test/i })).toBeInTheDocument();
    expect(screen.getByText(/meet me at the eastern dock/i)).toBeInTheDocument();
    expect(screen.getByText(/give_quest/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "API Settings" }));
    expect(screen.getByRole("heading", { name: /api settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/api base url/i)).toHaveValue("");
    expect(screen.getByText(/do not paste production api keys into committed files/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Raw JSON Preview" }));
    expect(screen.getByRole("heading", { name: /raw json preview/i })).toBeInTheDocument();
    expect(screen.getByText(/mockCharacters/i)).toBeInTheDocument();
    expect(screen.getByText(/connectionStatus/i)).toBeInTheDocument();
  });

  it("runs mocked setup checks for AWS readiness without calling AWS", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Setup Check" }));

    expect(screen.getByText(/mocked setup-check adapter/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/aws region/i)).toHaveValue("us-east-1");
    expect(screen.getByLabelText(/bedrock model/i)).toHaveValue("anthropic.claude-3-haiku-20240307-v1:0");
    expect(screen.getByText(/credential status/i)).toBeInTheDocument();
    expect(screen.getAllByText(/not checked yet/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /run setup check/i }));

    expect(await screen.findByText(/mock setup check complete/i)).toBeInTheDocument();
    expect(screen.getAllByText(/aws region/i).length).toBeGreaterThan(0);
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText(/selected bedrock model/i)).toBeInTheDocument();
    expect(screen.getByText("anthropic.claude-3-haiku-20240307-v1:0")).toBeInTheDocument();
    expect(screen.getAllByText(/credential status/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/mock credentials detected/i)).toBeInTheDocument();
    expect(screen.getByText(/bedrock access status/i)).toBeInTheDocument();
    expect(screen.getByText(/model access simulated as ready/i)).toBeInTheDocument();
    expect(screen.getByText(/existing stack status/i)).toBeInTheDocument();
    expect(screen.getByText(/no existing stack found/i)).toBeInTheDocument();
    expect(screen.getByText(/warnings/i)).toBeInTheDocument();
    expect(screen.getByText(/mock results only/i)).toBeInTheDocument();
    expect(screen.getByText(/confirm bedrock model access in the aws console/i)).toBeInTheDocument();
    expect(listCharactersMock).not.toHaveBeenCalled();
    expect(createCharacterMock).not.toHaveBeenCalled();
  });

  it("updates mocked setup-check warnings when region and model choices are risky", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Setup Check" }));
    await user.clear(screen.getByLabelText(/aws region/i));
    await user.type(screen.getByLabelText(/aws region/i), "eu-west-1");
    await user.selectOptions(screen.getByLabelText(/bedrock model/i), "anthropic.claude-3-5-sonnet-20240620-v1:0");
    await user.click(screen.getByRole("button", { name: /run setup check/i }));

    expect(await screen.findByText(/mock setup check complete/i)).toBeInTheDocument();
    expect(screen.getByText("eu-west-1")).toBeInTheDocument();
    expect(screen.getByText(/verify that characterforge deployment templates target eu-west-1/i)).toBeInTheDocument();
    expect(screen.getByText(/higher-capability models may cost more per request/i)).toBeInTheDocument();
  });

  it("previews the deployment Start flow in dry-run mode without calling AWS or the SDK", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Deployment" }));
    expect(screen.getByRole("heading", { name: /deployment start/i })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "API Settings" }));
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/mock mode is active/i)).toBeInTheDocument();
    expect(listCharactersMock).not.toHaveBeenCalled();
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

    await user.click(screen.getByRole("button", { name: "API Settings" }));
    await user.type(screen.getByLabelText(/api base url/i), "https://api.example.test/dev");
    await user.type(screen.getByLabelText(/^api key$/i), "test-api-key");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    expect(window.localStorage.getItem("characterforge.dashboard.settings")).not.toContain("test-api-key");
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/connected to characterforge api/i)).toBeInTheDocument();
    expect(listCharactersMock).toHaveBeenCalledWith({ baseUrl: "https://api.example.test/dev", apiKey: "test-api-key" });

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(await screen.findByText("Arden Vale")).toBeInTheDocument();
    expect(screen.getByText(/showing api characters/i)).toBeInTheDocument();
  });

  it("builds an exact create-character payload from editor fields and submits it through the SDK", async () => {
    const user = userEvent.setup();
    createCharacterMock.mockResolvedValueOnce({ character_id: "char_new_mira" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "API Settings" }));
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

    await user.click(screen.getByRole("button", { name: "API Settings" }));
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

    await user.click(screen.getByRole("button", { name: "API Settings" }));
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
