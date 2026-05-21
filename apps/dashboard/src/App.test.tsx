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
      "Characters",
      "Character Editor",
      "Chat Test",
      "Raw JSON Preview"
    ]) {
      expect(within(navigation).getByRole("button", { name: screenName })).toBeInTheDocument();
    }
  });

  it("uses mock data by default and warns that no live API calls are made", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /welcome to characterforge dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/mock dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/no api base url is set/i)).toBeInTheDocument();
  });

  it("navigates between character, editor, chat, settings, and JSON preview screens", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getByRole("heading", { name: /characters/i })).toBeInTheDocument();
    expect(screen.getByText("Captain Mira Voss")).toBeInTheDocument();
    expect(screen.getByText("Ember Archivist Thalen")).toBeInTheDocument();
    expect(screen.getByText(/showing mock characters/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Character Editor" }));
    expect(screen.getByRole("heading", { name: /character editor/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/character name/i)).toHaveValue("Captain Mira Voss");
    expect(screen.getByText(/allowed action types/i)).toBeInTheDocument();

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
});
