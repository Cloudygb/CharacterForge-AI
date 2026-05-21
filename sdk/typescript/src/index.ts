export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface CharacterForgeClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export type CreateCharacterRequest = Record<string, unknown>;
export type UpdateCharacterRequest = Record<string, unknown>;
export type CharacterProfile = Record<string, unknown>;
export type CharacterSummary = Record<string, unknown>;

export interface ListCharactersResponse {
  characters: CharacterSummary[];
}

export interface ChatRequest {
  session_id: string;
  player_id: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface CharacterForgeAction {
  type: string;
  payload?: unknown;
}

export interface ChatResponse {
  message: string;
  emotion?: string | null;
  actions?: CharacterForgeAction[];
  relationship_delta?: number | null;
  token_usage?: unknown;
}

export interface SessionMessage {
  [key: string]: unknown;
}

export interface SessionHistoryResponse {
  messages: SessionMessage[];
}

export interface ClearSessionResponse {
  cleared_count: number;
}

export interface GetSessionOptions {
  limit?: number;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class CharacterForgeApiError extends Error {
  readonly body: unknown;
  readonly status: number;
  readonly statusText: string;

  constructor(message: string, options: { body: unknown; status: number; statusText: string }) {
    super(message);
    this.name = "CharacterForgeApiError";
    this.body = options.body;
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

export class CharacterForgeClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CharacterForgeClientOptions) {
    if (!options.baseUrl.trim()) {
      throw new Error("CharacterForgeClient requires a non-empty baseUrl.");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("CharacterForgeClient requires a fetch implementation.");
    }
  }

  createCharacter<TResponse = CharacterProfile>(payload: CreateCharacterRequest): Promise<TResponse> {
    return this.request<TResponse>("POST", "/characters", { body: payload });
  }

  listCharacters<TResponse = ListCharactersResponse>(): Promise<TResponse> {
    return this.request<TResponse>("GET", "/characters");
  }

  getCharacter<TResponse = CharacterProfile>(characterId: string): Promise<TResponse> {
    return this.request<TResponse>("GET", `/characters/${encodePathSegment(characterId)}`);
  }

  updateCharacter<TResponse = CharacterProfile>(
    characterId: string,
    payload: UpdateCharacterRequest,
  ): Promise<TResponse> {
    return this.request<TResponse>("PUT", `/characters/${encodePathSegment(characterId)}`, {
      body: payload,
    });
  }

  async deleteCharacter(characterId: string): Promise<void> {
    await this.request<void>("DELETE", `/characters/${encodePathSegment(characterId)}`);
  }

  chat<TResponse = ChatResponse>(characterId: string, payload: ChatRequest): Promise<TResponse> {
    return this.request<TResponse>("POST", `/characters/${encodePathSegment(characterId)}/chat`, {
      body: payload,
    });
  }

  getSession<TResponse = SessionHistoryResponse>(
    sessionId: string,
    options: GetSessionOptions = {},
  ): Promise<TResponse> {
    return this.request<TResponse>("GET", `/sessions/${encodePathSegment(sessionId)}`, {
      query: { limit: options.limit },
    });
  }

  clearSession<TResponse = ClearSessionResponse>(sessionId: string): Promise<TResponse> {
    return this.request<TResponse>("DELETE", `/sessions/${encodePathSegment(sessionId)}`);
  }

  create<TResponse = CharacterProfile>(payload: CreateCharacterRequest): Promise<TResponse> {
    return this.createCharacter<TResponse>(payload);
  }

  list<TResponse = ListCharactersResponse>(): Promise<TResponse> {
    return this.listCharacters<TResponse>();
  }

  get<TResponse = CharacterProfile>(characterId: string): Promise<TResponse> {
    return this.getCharacter<TResponse>(characterId);
  }

  update<TResponse = CharacterProfile>(
    characterId: string,
    payload: UpdateCharacterRequest,
  ): Promise<TResponse> {
    return this.updateCharacter<TResponse>(characterId, payload);
  }

  delete(characterId: string): Promise<void> {
    return this.deleteCharacter(characterId);
  }

  session<TResponse = SessionHistoryResponse>(
    sessionId: string,
    options: GetSessionOptions = {},
  ): Promise<TResponse> {
    return this.getSession<TResponse>(sessionId, options);
  }

  getSessionHistory<TResponse = SessionHistoryResponse>(
    sessionId: string,
    options: GetSessionOptions = {},
  ): Promise<TResponse> {
    return this.getSession<TResponse>(sessionId, options);
  }

  clearSessionHistory<TResponse = ClearSessionResponse>(sessionId: string): Promise<TResponse> {
    return this.clearSession<TResponse>(sessionId);
  }

  private async request<TResponse>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<TResponse> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const init: RequestInit = { headers, method };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(this.url(path, options.query), init);
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new CharacterForgeApiError(errorMessage(response, body), {
        body,
        status: response.status,
        statusText: response.statusText,
      });
    }
    return body as TResponse;
  }

  private url(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

export type ActionHandler<TResult = unknown> = (
  payload: unknown,
  action: CharacterForgeAction,
) => TResult | Promise<TResult>;

export type ActionHandlerMap<TResult = unknown> = Record<string, ActionHandler<TResult>>;

export interface HandledAction<TResult = unknown> {
  action: CharacterForgeAction;
  result: TResult;
}

export interface DispatchResult<TResult = unknown> {
  handled: HandledAction<TResult>[];
  unhandled: CharacterForgeAction[];
}

export class ActionDispatcher<TResult = unknown> {
  private readonly handlers: ActionHandlerMap<TResult>;

  constructor(handlers: ActionHandlerMap<TResult> = {}) {
    this.handlers = { ...handlers };
  }

  register(actionType: string, handler: ActionHandler<TResult>): this {
    this.handlers[actionType] = handler;
    return this;
  }

  async dispatch(
    actions: CharacterForgeAction | CharacterForgeAction[] | undefined | null,
  ): Promise<DispatchResult<TResult>> {
    const actionList = Array.isArray(actions) ? actions : actions ? [actions] : [];
    const handled: HandledAction<TResult>[] = [];
    const unhandled: CharacterForgeAction[] = [];

    for (const action of actionList) {
      const handler = this.handlers[action.type];
      if (!handler) {
        unhandled.push(action);
        continue;
      }
      handled.push({
        action,
        result: await handler(action.payload, action),
      });
    }

    return { handled, unhandled };
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    return JSON.parse(text);
  }
  return text;
}

function errorMessage(response: Response, body: unknown): string {
  if (isApiErrorBody(body)) {
    return body.error.message;
  }
  return `CharacterForge API request failed with ${response.status} ${response.statusText}`.trim();
}

function isApiErrorBody(body: unknown): body is { error: { message: string } } {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return false;
  }
  const error = (body as { error?: unknown }).error;
  return Boolean(
    error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string",
  );
}

function encodePathSegment(value: string): string {
  if (!value.trim()) {
    throw new Error("Path parameter values must be non-empty strings.");
  }
  return encodeURIComponent(value);
}
