import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const listCharactersMock = vi.fn();

vi.mock("@characterforge/characterforge-ai", () => ({
  CharacterForgeClient: vi.fn().mockImplementation(function CharacterForgeClientMock(
    this: { listCharacters: () => Promise<unknown> },
    options: { apiKey?: string; baseUrl: string }
  ) {
    this.listCharacters = () => listCharactersMock(options);
  })
}));

describe("CharacterForge dashboard", () => {
  beforeEach(() => {
    listCharactersMock.mockReset();
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
    expect(screen.getByText(/allowed actions/i)).toBeInTheDocument();

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
});
