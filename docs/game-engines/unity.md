# Unity Integration Guide

This guide explains how a Unity game can call CharacterForge AI from gameplay code and route returned actions into local game systems. It is intentionally documentation-only: do not treat this as a Unity package or engine plugin yet.

## API call flow

A typical Unity flow is:

1. A player triggers dialogue with an NPC.
2. Gameplay code collects the player message and a small `game_context` snapshot.
3. A C# API client sends `POST /characters/{character_id}/chat` to CharacterForge.
4. CharacterForge loads the character profile and recent session history, builds the prompt, calls the configured LLM, validates the JSON response, persists the turn, and returns:
   - `message` for the dialogue UI
   - `emotion` for animation or portrait state
   - `actions` for game-side systems
5. Unity displays the message first, then passes each action to an action dispatcher.
6. The dispatcher maps each approved action type to existing Unity services such as `QuestManager`, `CombatManager`, `InventoryService`, or `WorldState`.

Example request shape:

```json
{
  "session_id": "save-slot-1:npc-mira",
  "message": "I can help find the lost sky map.",
  "game_context": {
    "player_level": 6,
    "current_location": "harbor_district",
    "active_quests": ["repair_the_airship"],
    "inventory_summary": ["rusty_cutlass", "sky_compass"]
  }
}
```

Example response shape:

```json
{
  "message": "Bold offer. Dangerous too. Meet me at the eastern dock after dusk.",
  "emotion": "curious",
  "actions": [
    {
      "type": "give_quest",
      "payload": {
        "quest_id": "lost_sky_map",
        "title": "Find the Lost Sky Map"
      }
    }
  ]
}
```

## API key storage cautions

Do not hard-code a live `x-api-key` value in Unity scenes, prefabs, ScriptableObjects, source files, player settings, or mobile builds. Anything shipped to a player can be extracted.

Safer patterns:

- For private prototypes, read the key from local developer environment variables or an ignored local config file.
- For public builds, put a small game backend between Unity and CharacterForge. The game backend stores the CharacterForge API key server-side and exposes only player-safe endpoints to the client.
- For hosted multiplayer, call CharacterForge from your authoritative server, not from each player device.
- For testing in the Unity Editor, use mock mode or a development-only key with low API Gateway usage limits.
- Rotate the API key if it is ever pasted into Git, logs, crash reports, screenshots, or builds.

Use placeholder documentation values only:

```text
CHARACTERFORGE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
CHARACTERFORGE_API_KEY=<your-api-key-value>
```

## Minimal C# client shape

This is a sketch of the gameplay-facing shape, not a packaged SDK:

```csharp
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

public sealed class CharacterForgeClient
{
    private readonly string baseUrl;
    private readonly string apiKey;
    private readonly HttpClient httpClient;

    public CharacterForgeClient(string baseUrl, string apiKey, HttpClient httpClient)
    {
        this.baseUrl = baseUrl.TrimEnd('/');
        this.apiKey = apiKey;
        this.httpClient = httpClient;
    }

    public async Task<string> ChatJsonAsync(string characterId, string requestJson)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{baseUrl}/characters/{characterId}/chat");

        request.Headers.Add("x-api-key", apiKey);
        request.Content = new StringContent(requestJson, Encoding.UTF8, "application/json");

        using HttpResponseMessage response = await httpClient.SendAsync(request);
        string responseJson = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        return responseJson;
    }
}
```

Production code should add typed request/response models, cancellation tokens, timeout handling, retry policy for transient failures, and redacted logging.

## Action dispatcher pattern

Keep CharacterForge responses data-only. The game decides what each action is allowed to do.

```csharp
public interface ICharacterForgeActionHandler
{
    void Handle(Dictionary<string, object> payload);
}

public sealed class CharacterForgeActionDispatcher
{
    private readonly Dictionary<string, ICharacterForgeActionHandler> handlers = new();

    public void Register(string actionType, ICharacterForgeActionHandler handler)
    {
        handlers[actionType] = handler;
    }

    public void Dispatch(string actionType, Dictionary<string, object> payload)
    {
        if (!handlers.TryGetValue(actionType, out ICharacterForgeActionHandler handler))
        {
            Debug.LogWarning($"No CharacterForge handler registered for action: {actionType}");
            return;
        }

        handler.Handle(payload);
    }
}
```

Recommended rules:

- Register only action types your build supports.
- Validate payload fields before calling game systems.
- Treat unknown actions as no-ops with warnings.
- Never let model text invoke arbitrary C# methods by name.
- Prefer designer-approved payload templates for high-impact actions.

## Binding examples

### Quest binding

CharacterForge action:

```json
{
  "type": "give_quest",
  "payload": {
    "quest_id": "lost_sky_map",
    "title": "Find the Lost Sky Map"
  }
}
```

Unity handler:

```csharp
public sealed class GiveQuestHandler : ICharacterForgeActionHandler
{
    private readonly QuestManager quests;

    public GiveQuestHandler(QuestManager quests)
    {
        this.quests = quests;
    }

    public void Handle(Dictionary<string, object> payload)
    {
        string questId = payload["quest_id"].ToString();
        quests.StartQuest(questId);
    }
}
```

### Combat binding

CharacterForge action:

```json
{
  "type": "start_combat",
  "payload": {
    "encounter_id": "dockside_ambush",
    "difficulty": "medium"
  }
}
```

Unity-side target:

```csharp
combatManager.StartEncounter(encounterId: "dockside_ambush", difficulty: "medium");
```

Use this only when the character profile allows `start_combat` and the current scene can safely transition into combat.

### Inventory binding

CharacterForge action:

```json
{
  "type": "give_item",
  "payload": {
    "item_id": "tempered_pickaxe",
    "quantity": 1
  }
}
```

Unity-side target:

```csharp
inventoryService.AddItem(itemId: "tempered_pickaxe", quantity: 1);
```

Always validate that the item ID exists in your item database before granting it.

## When to call CharacterForge from gameplay code

Good call sites:

- Player submits a dialogue line to an AI-powered NPC.
- The player selects a dialogue choice that should produce a dynamic response.
- A quest NPC needs to react to current world state or recent session history.
- The game reaches a safe conversation beat where a short network delay is acceptable.
- The server wants to pre-generate NPC flavor text or quest hints before the player reaches a scene.

Avoid calling CharacterForge:

- Every frame, tick, physics update, or animation event.
- During latency-critical combat resolution.
- From deterministic simulation code that must replay exactly.
- For actions that should be entirely authored and guaranteed, such as core economy grants or anti-cheat-sensitive rewards.
- Directly from public builds with a live API key embedded in the client.

## Unity implementation notes

- Use asynchronous calls so dialogue UI remains responsive.
- Show a typing state, spinner, or fallback line while waiting.
- Cache character IDs and session IDs in save data, not in scene-only state.
- Keep `session_id` stable for a conversation thread so CharacterForge can retrieve recent history.
- Send compact `game_context`; avoid dumping full save files, secrets, analytics IDs, or personally identifiable data.
- Run action dispatch on the Unity main thread when touching scene objects, GameObjects, or UI.
- Log request IDs and status codes, but redact API keys and player-sensitive payloads.
