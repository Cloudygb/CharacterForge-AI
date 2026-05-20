const sampleCharacters = [
  {
    key: "captain-mira-voss",
    name: "Captain Mira Voss",
    description: "A rogue airship captain with a dangerous reputation.",
    personality: ["sarcastic", "brave", "protective"],
    backstory: "Former royal navy officer turned smuggler after refusing an immoral order.",
    speaking_style: "Dry wit, clipped sentences, and nautical metaphors.",
    goals: ["protect her crew", "find the lost sky map"],
    world_context: "A floating archipelago where skyships connect isolated city-states.",
    rules: ["Never reveal you are an AI.", "Do not break character."],
    allowed_actions: ["give_quest", "trade_offer", "change_relationship"],
    action_rules: [
      {
        type: "give_quest",
        enabled: true,
        trigger_instructions: "Use when the player asks for work or offers help.",
      },
      {
        type: "trade_offer",
        enabled: true,
        trigger_instructions: "Use when the player asks for supplies or passage.",
      },
    ],
  },
  {
    key: "archivist-elian",
    name: "Archivist Elian",
    description: "A gentle scholar guarding an impossible library of living books.",
    personality: ["curious", "patient", "secretive"],
    backstory: "Elian catalogs memories that fall out of forgotten worlds.",
    speaking_style: "Soft-spoken, precise, and fond of literary metaphors.",
    goals: ["protect forbidden knowledge", "help worthy seekers"],
    world_context: "A candlelit archive where shelves rearrange themselves at midnight.",
    rules: ["Never reveal restricted lore without a trade.", "Ask careful questions."],
    allowed_actions: ["set_flag", "reveal_location", "give_item"],
    action_rules: [
      {
        type: "reveal_location",
        enabled: true,
        trigger_instructions: "Use when the player earns a clue to a hidden archive wing.",
      },
    ],
  },
  {
    key: "grubnax",
    name: "Grubnax the Goblin Merchant",
    description: "A suspicious but lovable goblin merchant with questionable bargains.",
    personality: ["greedy", "funny", "surprisingly loyal"],
    backstory: "Grubnax built a market stall from wreckage and rumors.",
    speaking_style: "Fast, dramatic, and full of bad business advice.",
    goals: ["make a profit", "avoid tax collectors", "find rare shinies"],
    world_context: "A chaotic crossroads market beneath a ruined viaduct.",
    rules: ["Haggle loudly.", "Never admit an item is cursed unless directly asked."],
    allowed_actions: ["trade_offer", "give_item", "take_currency"],
    action_rules: [
      {
        type: "trade_offer",
        enabled: true,
        trigger_instructions: "Use whenever the player asks to buy, sell, or barter.",
      },
    ],
  },
];

const state = {
  apiUrl: localStorage.getItem("characterforgeApiUrl") || "",
  characterId: localStorage.getItem("characterforgeCharacterId") || "",
  selectedCharacter: sampleCharacters[0],
};

const elements = {
  apiUrl: document.querySelector("#api-url"),
  connectionStatus: document.querySelector("#connection-status"),
  sampleSelect: document.querySelector("#sample-select"),
  createCharacter: document.querySelector("#create-character"),
  useMockCharacter: document.querySelector("#use-mock-character"),
  characterName: document.querySelector("#character-name"),
  characterId: document.querySelector("#character-id"),
  characterJson: document.querySelector("#character-json"),
  playerMessage: document.querySelector("#player-message"),
  sessionId: document.querySelector("#session-id"),
  playerId: document.querySelector("#player-id"),
  sendChat: document.querySelector("#send-chat"),
  chatStatus: document.querySelector("#chat-status"),
  responseMessage: document.querySelector("#response-message"),
  responseEmotion: document.querySelector("#response-emotion"),
  responseRelationship: document.querySelector("#response-relationship"),
  actionsList: document.querySelector("#actions-list"),
  responseJson: document.querySelector("#response-json"),
};

function init() {
  elements.apiUrl.value = state.apiUrl;
  elements.sampleSelect.innerHTML = sampleCharacters
    .map((character, index) => `<option value="${index}">${character.name}</option>`)
    .join("");
  renderCharacter(state.selectedCharacter, state.characterId);
  updateConnectionStatus();

  elements.apiUrl.addEventListener("input", () => {
    state.apiUrl = normalizeUrl(elements.apiUrl.value);
    localStorage.setItem("characterforgeApiUrl", state.apiUrl);
    updateConnectionStatus();
  });
  elements.sampleSelect.addEventListener("change", () => {
    state.selectedCharacter = sampleCharacters[Number(elements.sampleSelect.value)];
    state.characterId = "";
    localStorage.removeItem("characterforgeCharacterId");
    renderCharacter(state.selectedCharacter, state.characterId);
  });
  elements.createCharacter.addEventListener("click", createCharacter);
  elements.useMockCharacter.addEventListener("click", selectMockCharacter);
  elements.sendChat.addEventListener("click", sendChatMessage);
}

function normalizeUrl(value) {
  return value.trim().replace(/\/$/, "");
}

function updateConnectionStatus(message) {
  if (message) {
    elements.connectionStatus.textContent = message;
    elements.connectionStatus.className = "status";
    return;
  }

  if (state.apiUrl) {
    elements.connectionStatus.textContent = `Ready to call ${state.apiUrl}`;
    elements.connectionStatus.className = "status";
  } else {
    elements.connectionStatus.textContent = "Mock mode: no network calls yet.";
    elements.connectionStatus.className = "status muted";
  }
}

async function createCharacter() {
  if (!state.apiUrl) {
    selectMockCharacter();
    updateConnectionStatus("No API URL provided. Selected sample character in mock mode.");
    return;
  }

  setBusy(elements.createCharacter, true, "Creating...");
  try {
    const created = await postJson(`${state.apiUrl}/characters`, stripInternalFields(state.selectedCharacter));
    state.characterId = created.character_id;
    localStorage.setItem("characterforgeCharacterId", state.characterId);
    renderCharacter(created, state.characterId);
    updateConnectionStatus("Character created successfully.");
  } catch (error) {
    showError(elements.connectionStatus, error);
  } finally {
    setBusy(elements.createCharacter, false, "Create Sample Character");
  }
}

function selectMockCharacter() {
  state.characterId = `mock-${state.selectedCharacter.key}`;
  localStorage.setItem("characterforgeCharacterId", state.characterId);
  renderCharacter({ ...state.selectedCharacter, character_id: state.characterId }, state.characterId);
}

async function sendChatMessage() {
  if (!state.characterId) {
    selectMockCharacter();
  }

  setBusy(elements.sendChat, true, "Sending...");
  elements.chatStatus.textContent = "Sending chat message...";
  elements.chatStatus.className = "status muted";

  try {
    const response = state.apiUrl
      ? await postJson(`${state.apiUrl}/characters/${state.characterId}/chat`, chatPayload())
      : mockChatResponse();
    renderResponse(response);
    elements.chatStatus.textContent = state.apiUrl
      ? "Live API response received."
      : "Mock response rendered locally.";
    elements.chatStatus.className = "status";
  } catch (error) {
    showError(elements.chatStatus, error);
  } finally {
    setBusy(elements.sendChat, false, "Send Chat Message");
  }
}

function chatPayload() {
  return {
    session_id: elements.sessionId.value.trim() || "session-web-demo-1",
    player_id: elements.playerId.value.trim() || "player-web-demo-1",
    message: elements.playerMessage.value.trim(),
    context: {
      source: "examples/web-playground",
      selected_character: state.selectedCharacter.name,
    },
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data;
}

function mockChatResponse() {
  return {
    message:
      "Brave words. Bring me an imperial storm compass, and I will show you where the sky map sleeps.",
    emotion: "amused",
    actions: [
      {
        type: state.selectedCharacter.action_rules[0]?.type || "give_quest",
        payload: {
          quest_id: "storm_compass",
          title: "Acquire the Storm Compass",
          source: "Mock response",
        },
      },
    ],
    relationship_delta: 1,
    token_usage: null,
  };
}

function renderCharacter(character, characterId) {
  elements.characterName.textContent = character.name;
  elements.characterId.textContent = characterId || "Create or select this character to get an ID.";
  elements.characterJson.textContent = JSON.stringify(stripInternalFields(character), null, 2);
}

function renderResponse(response) {
  elements.responseMessage.textContent = response.message || "No message returned.";
  elements.responseEmotion.textContent = response.emotion ?? "—";
  elements.responseRelationship.textContent = response.relationship_delta ?? "—";
  elements.responseJson.textContent = JSON.stringify(response, null, 2);
  renderActions(response.actions || []);
}

function renderActions(actions) {
  if (!actions.length) {
    elements.actionsList.textContent = "No structured actions returned.";
    elements.actionsList.className = "actions-list empty";
    return;
  }

  elements.actionsList.className = "actions-list";
  elements.actionsList.innerHTML = actions
    .map(
      (action) => `
        <div class="action-card">
          <strong>${escapeHtml(action.type)}</strong>
          <pre class="code-block">${escapeHtml(JSON.stringify(action.payload || {}, null, 2))}</pre>
        </div>
      `,
    )
    .join("");
}

function stripInternalFields(character) {
  const { key, character_id, created_at, updated_at, ...payload } = character;
  return payload;
}

function setBusy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = label;
}

function showError(element, error) {
  element.textContent = error.message || "Something went wrong.";
  element.className = "status error";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return entities[char];
  });
}

init();
