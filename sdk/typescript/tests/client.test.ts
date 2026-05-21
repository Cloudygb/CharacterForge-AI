import { describe, expect, it, vi } from "vitest";

import {
  ActionDispatcher,
  CharacterForgeApiError,
  CharacterForgeClient,
  type CharacterForgeAction,
} from "../src/index";

type FetchCall = [input: string | URL | Request, init?: RequestInit];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

function makeFetchMock(responses: Response[]) {
  const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  return fetchMock;
}

function lastFetchCall(fetchMock: ReturnType<typeof makeFetchMock>): FetchCall {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) {
    throw new Error("fetch was not called");
  }
  return call as FetchCall;
}

describe("CharacterForgeClient", () => {
  it("sends create/list/get/update/delete requests to the expected character routes", async () => {
    const fetchMock = makeFetchMock([
      jsonResponse({ character_id: "char_1", name: "Mira" }, { status: 201 }),
      jsonResponse({ characters: [{ character_id: "char_1", name: "Mira" }] }),
      jsonResponse({ character_id: "char_1", name: "Mira" }),
      jsonResponse({ character_id: "char_1", name: "Captain Mira" }),
      new Response(null, { status: 204 }),
    ]);
    const client = new CharacterForgeClient({
      apiKey: "test-api-key",
      baseUrl: "https://api.example.com/dev/",
      fetch: fetchMock,
    });

    await expect(client.createCharacter({ name: "Mira" })).resolves.toMatchObject({
      character_id: "char_1",
    });
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/characters",
      expect.objectContaining({
        body: JSON.stringify({ name: "Mira" }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-api-key": "test-api-key",
        }),
        method: "POST",
      }),
    ]);

    await expect(client.listCharacters()).resolves.toEqual({
      characters: [{ character_id: "char_1", name: "Mira" }],
    });
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/characters",
      expect.objectContaining({ method: "GET" }),
    ]);

    await client.getCharacter("char_1");
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/characters/char_1",
      expect.objectContaining({ method: "GET" }),
    ]);

    await client.updateCharacter("char_1", { name: "Captain Mira" });
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/characters/char_1",
      expect.objectContaining({
        body: JSON.stringify({ name: "Captain Mira" }),
        method: "PUT",
      }),
    ]);

    await expect(client.deleteCharacter("char_1")).resolves.toBeUndefined();
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/characters/char_1",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });

  it("routes chat and session methods to the expected API paths", async () => {
    const fetchMock = makeFetchMock([
      jsonResponse({ message: "Aye.", actions: [], emotion: "calm" }),
      jsonResponse({ messages: [{ role: "player", content: "Hello" }] }),
      jsonResponse({ cleared_count: 2 }),
    ]);
    const client = new CharacterForgeClient({
      baseUrl: "https://api.example.com/dev",
      fetch: fetchMock,
    });

    await client.chat("char_1", {
      context: { location: "Harbor" },
      message: "Hello",
      player_id: "player_1",
      session_id: "session_1",
    });
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/characters/char_1/chat",
      expect.objectContaining({
        body: JSON.stringify({
          context: { location: "Harbor" },
          message: "Hello",
          player_id: "player_1",
          session_id: "session_1",
        }),
        method: "POST",
      }),
    ]);

    await client.getSession("session_1", { limit: 5 });
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/sessions/session_1?limit=5",
      expect.objectContaining({ method: "GET" }),
    ]);

    await expect(client.clearSession("session_1")).resolves.toEqual({ cleared_count: 2 });
    expect(lastFetchCall(fetchMock)).toEqual([
      "https://api.example.com/dev/sessions/session_1",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });

  it("throws a structured error for non-success API responses", async () => {
    const fetchMock = makeFetchMock([
      jsonResponse(
        { error: { code: "not_found", message: "Character 'missing' was not found." } },
        { status: 404 },
      ),
    ]);
    const client = new CharacterForgeClient({ baseUrl: "https://api.example.com", fetch: fetchMock });

    await expect(client.getCharacter("missing")).rejects.toMatchObject({
      body: { error: { code: "not_found", message: "Character 'missing' was not found." } },
      status: 404,
    } satisfies Partial<CharacterForgeApiError>);
  });
});

describe("ActionDispatcher", () => {
  it("maps returned action types to user-provided handlers and reports unhandled actions", async () => {
    const giveQuest = vi.fn(async (payload: unknown, action: CharacterForgeAction) => ({
      actionType: action.type,
      accepted: payload,
    }));
    const dispatcher = new ActionDispatcher({ give_quest: giveQuest });
    const actions: CharacterForgeAction[] = [
      { type: "give_quest", payload: { quest_id: "lost_sky_map" } },
      { type: "trade_offer", payload: { shop_id: "skyship_supplies" } },
    ];

    const result = await dispatcher.dispatch(actions);

    expect(giveQuest).toHaveBeenCalledWith({ quest_id: "lost_sky_map" }, actions[0]);
    expect(result.handled).toEqual([
      {
        action: actions[0],
        result: { accepted: { quest_id: "lost_sky_map" }, actionType: "give_quest" },
      },
    ]);
    expect(result.unhandled).toEqual([actions[1]]);
  });
});
