# Unreal Engine Integration Guide

This guide explains how an Unreal project can call CharacterForge AI and bind returned actions into gameplay systems. It is intentionally documentation-only: do not build or ship an Unreal plugin yet.

## API call flow

A typical Unreal flow is:

1. A player enters an NPC interaction, dialogue widget, or conversation trigger.
2. Gameplay code gathers the player message plus a small `game_context` map.
3. A game-side API client sends `POST /characters/{character_id}/chat` to CharacterForge.
4. CharacterForge loads the character profile and recent session history, builds the prompt, calls the configured LLM, validates the JSON response, persists the turn, and returns:
   - `message` for the dialogue widget or subtitle system
   - `emotion` for animation state, facial pose, or portrait selection
   - `actions` for gameplay systems
5. Unreal displays the response and forwards each action to a dispatcher owned by game code.
6. The dispatcher maps each approved action type to C++ systems, Blueprint-callable functions, Gameplay Ability System events, or subsystem methods.

Example request shape:

```json
{
  "session_id": "slot-1:npc-mira",
  "message": "I can help find the lost sky map.",
  "game_context": {
    "player_level": 6,
    "map_name": "HarborDistrict",
    "active_quests": ["RepairTheAirship"],
    "nearby_factions": ["SkyportGuards", "FreeCaptains"]
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
        "quest_id": "LostSkyMap",
        "title": "Find the Lost Sky Map"
      }
    }
  ]
}
```

## API key storage cautions

Do not hard-code a live `x-api-key` value in C++ source, Blueprint defaults, config files committed to Git, packaged assets, cooked builds, save games, or logs. Packaged Unreal clients can be inspected.

Safer patterns:

- For local development, read the key from an ignored developer-only config file or environment variable.
- For public client builds, call your own backend service first. That backend stores the CharacterForge API key server-side and decides whether the request is allowed.
- For multiplayer, call CharacterForge from the authoritative game server or backend, not from untrusted clients.
- For prototypes, use a restricted development key with API Gateway throttling and quotas.
- Rotate the key if it appears in source control, crash reports, screenshots, analytics, or packaged builds.

Use placeholder documentation values only:

```text
CHARACTERFORGE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
CHARACTERFORGE_API_KEY=<your-api-key-value>
```

## Minimal Unreal HTTP client shape

This is a sketch, not a plugin API:

```cpp
void UCharacterForgeClient::SendChat(
    const FString& BaseUrl,
    const FString& ApiKey,
    const FString& CharacterId,
    const FString& RequestJson)
{
    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(BaseUrl / TEXT("characters") / CharacterId / TEXT("chat"));
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetHeader(TEXT("x-api-key"), ApiKey);
    Request->SetContentAsString(RequestJson);

    Request->OnProcessRequestComplete().BindUObject(
        this,
        &UCharacterForgeClient::HandleChatResponse);

    Request->ProcessRequest();
}
```

Production code should add typed request/response structs, request cancellation, retries for transient failures, timeouts, redacted logs, and a server-side proxy for public builds.

## Action dispatcher pattern

Keep CharacterForge actions as structured intent. Unreal remains responsible for deciding whether and how to execute them.

```cpp
DECLARE_DELEGATE_OneParam(FCharacterForgeActionHandler, const TSharedPtr<FJsonObject>&);

class FCharacterForgeActionDispatcher
{
public:
    void RegisterHandler(const FString& ActionType, FCharacterForgeActionHandler Handler)
    {
        Handlers.Add(ActionType, MoveTemp(Handler));
    }

    void Dispatch(const FString& ActionType, const TSharedPtr<FJsonObject>& Payload) const
    {
        const FCharacterForgeActionHandler* Handler = Handlers.Find(ActionType);
        if (!Handler)
        {
            UE_LOG(LogTemp, Warning, TEXT("No CharacterForge handler for action: %s"), *ActionType);
            return;
        }

        Handler->ExecuteIfBound(Payload);
    }

private:
    TMap<FString, FCharacterForgeActionHandler> Handlers;
};
```

Recommended rules:

- Register only action types your project explicitly supports.
- Validate every payload field before touching gameplay state.
- Treat unknown action types as warnings, not executable commands.
- Do not let model text choose arbitrary UObject names, function names, console commands, or Blueprint events.
- Prefer designer-approved payload templates for high-impact gameplay changes.

## Binding examples

### Quest binding

CharacterForge action:

```json
{
  "type": "give_quest",
  "payload": {
    "quest_id": "LostSkyMap",
    "title": "Find the Lost Sky Map"
  }
}
```

Unreal-side target:

```cpp
QuestSubsystem->StartQuest(FName("LostSkyMap"));
```

Blueprint equivalent: call a `Start Quest` function on your quest subsystem with the validated `quest_id` field.

### Combat binding

CharacterForge action:

```json
{
  "type": "start_combat",
  "payload": {
    "encounter_id": "DocksideAmbush",
    "difficulty": "Medium"
  }
}
```

Unreal-side target:

```cpp
CombatSubsystem->StartEncounter(FName("DocksideAmbush"), EEncounterDifficulty::Medium);
```

Only execute combat actions when the current map, game mode, and player state allow a combat transition.

### Inventory binding

CharacterForge action:

```json
{
  "type": "give_item",
  "payload": {
    "item_id": "TemperedPickaxe",
    "quantity": 1
  }
}
```

Unreal-side target:

```cpp
InventoryComponent->AddItem(FName("TemperedPickaxe"), 1);
```

Validate that the item row exists in your DataTable, Primary Asset registry, or inventory database before granting it.

### Flag and relationship binding

CharacterForge can also emit lightweight state changes:

```json
{
  "type": "set_flag",
  "payload": {
    "flag": "MiraTrustsPlayer",
    "value": true
  }
}
```

```json
{
  "type": "change_relationship",
  "payload": {
    "npc_id": "Mira",
    "relationship_change": 1
  }
}
```

These are good fits for a save-game subsystem, world-state subsystem, or relationship manager. Clamp numeric changes and ignore flags that are not allowlisted for the current character.

## When to call CharacterForge from gameplay code

Good call sites:

- A player submits dialogue to an AI-enabled NPC.
- A dialogue choice needs a dynamic in-character response.
- A quest giver should react to recent player actions or world state.
- A server prepares NPC flavor text, rumors, hints, or quest offers before a player enters a scene.
- A non-latency-critical interaction can show a short waiting state.

Avoid calling CharacterForge:

- From `Tick`, physics callbacks, animation notifies, or replication hot paths.
- During latency-critical combat resolution.
- From deterministic gameplay logic that must replay identically.
- For authoritative reward grants unless your server validates the action against game rules.
- Directly from shipped clients with a live CharacterForge API key.

## Unreal implementation notes

- Use Unreal's HTTP module asynchronously and keep dialogue UI responsive.
- Route response handling back to the game thread before modifying UObjects, widgets, actors, components, or subsystems.
- Keep `session_id` stable per NPC conversation thread so CharacterForge can retrieve recent history.
- Send compact `game_context`; avoid full save files, secrets, analytics identifiers, or personally identifiable data.
- Use Gameplay Tags, DataTables, Primary Assets, or enums to validate action payload IDs before execution.
- Log status codes and request identifiers, but redact API keys and sensitive player data.
- In multiplayer, prefer a server-authoritative flow: client sends dialogue to your server, server calls CharacterForge, server validates actions, then replicates approved results.
