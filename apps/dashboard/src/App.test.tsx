import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("CharacterForge dashboard", () => {
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
    expect(screen.getByText(/no live aws or characterforge api calls are made/i)).toBeInTheDocument();
  });

  it("navigates between character, editor, chat, settings, and JSON preview screens", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getByRole("heading", { name: /characters/i })).toBeInTheDocument();
    expect(screen.getByText("Captain Mira Voss")).toBeInTheDocument();
    expect(screen.getByText("Ember Archivist Thalen")).toBeInTheDocument();

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
    expect(screen.getByLabelText(/api base url/i)).toHaveValue("https://<api-id>.execute-api.<region>.amazonaws.com/<stage>");
    expect(screen.getByText(/do not paste production api keys into committed files/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Raw JSON Preview" }));
    expect(screen.getByRole("heading", { name: /raw json preview/i })).toBeInTheDocument();
    expect(screen.getByText(/mockCharacters/i)).toBeInTheDocument();
    expect(screen.getByText(/mockChatResponse/i)).toBeInTheDocument();
  });
});
