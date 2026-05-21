# Game Binding Guide

CharacterForge actions are intentionally generic: `give_quest`, `start_combat`,
`give_item`, `start_dialogue`, `set_flag`, and the other supported action types describe
what should happen, not how your game engine must do it. A game binding file is the small
adapter contract that maps those CharacterForge action types to the systems your game
already has.

This guide is user-facing project documentation. The schema lives at
`schemas/game-binding.schema.json`, and a complete sample lives at
`examples/game-bindings/rpg-binding.json`.

## What a binding does

A binding answers three questions for each action type you want your game client to run:

1. Which game system should receive the action?
2. Which method on that system should be called?
3. Which fields from the approved CharacterForge action payload become method arguments?

For example, CharacterForge may return this validated action after response parsing:

```json
{
  "type": "give_quest",
  "payload": {
    "quest_id": "ember_ruins",
    "title": "Investigate the Ember Hollow ruins",
    "reward_item": "tempered_pickaxe"
  }
}
```

The sample binding maps that to `QuestManager.StartQuest` and passes the fields your
game's quest system expects:

```json
{
  "give_quest": {
    "target": {
      "system": "QuestManager",
      "method": "StartQuest"
    },
    "payload_map": {
      "questId": "payload.quest_id",
      "title": "payload.title",
      "rewardItemId": "payload.reward_item"
    }
  }
}
```

Your game client stays in charge of execution. CharacterForge provides structured,
validated intent; the binding tells the client how to translate that intent into your
runtime.

## Sample mappings

The included sample shows five common RPG mappings:

| CharacterForge action type | Existing game call | Typical use |
| --- | --- | --- |
| `give_quest` | `QuestManager.StartQuest` | Start a quest offered by an NPC. |
| `start_combat` | `CombatManager.StartEncounter` | Launch a designer-approved encounter. |
| `give_item` | `Inventory.AddItem` | Grant a reward or traded item. |
| `start_dialogue` | `Dialogue.StartBranch` | Open an authored dialogue branch. |
| `set_flag` | `Flags.Set` | Set persistent story or world-state flags. |

Use the same pattern for other action types, such as `open_shop`, `trigger_scene`,
`change_relationship`, or `unlock_location`.

## Binding file structure

A binding file has three top-level fields:

```json
{
  "schema_version": "1.0",
  "game": {
    "name": "Your Game",
    "engine": "Unreal Engine",
    "version": "prototype"
  },
  "bindings": {
    "give_quest": {
      "description": "Start a quest from an approved CharacterForge payload template.",
      "target": {
        "system": "QuestManager",
        "method": "StartQuest"
      },
      "payload_map": {
        "questId": "payload.quest_id"
      },
      "when_missing": "error"
    }
  }
}
```

### `target`

`target.system` is the name of your game-side service or manager. `target.method` is the
method your game client should call. The binding does not require a specific engine or
language; `QuestManager.StartQuest` can be a C++ method, a Blueprint-callable Unreal
function, a Unity C# method, or a script event.

### `payload_map`

`payload_map` is keyed by your game method's argument names. Each value can be:

- a string source path, such as `payload.quest_id`
- an object with `source`, optional `default`, and optional `required`
- an object with `literal` for a fixed value supplied by the binding

Example with a default value:

```json
{
  "give_item": {
    "target": {
      "system": "Inventory",
      "method": "AddItem"
    },
    "payload_map": {
      "itemId": "payload.item_id",
      "quantity": {
        "source": "payload.quantity",
        "default": 1,
        "required": false
      }
    }
  }
}
```

### `when_missing`

Use `"error"` when a missing required payload field should stop execution. Use `"skip"`
when your client should ignore that action instead. For most gameplay-critical actions,
`"error"` is safer because it exposes bad bindings during testing.

## Runtime flow

1. A character response is parsed and validated by CharacterForge.
2. If the response used a `template_id`, CharacterForge replaces the model's payload with
   the approved designer-authored `payload_template`.
3. Your game client loads `examples/game-bindings/rpg-binding.json` or your own binding
   file that validates against `schemas/game-binding.schema.json`.
4. For each returned action, find `bindings[action.type]`.
5. Read `target.system` and `target.method`.
6. Build method arguments from `payload_map`.
7. Call your own runtime method, such as `QuestManager.StartQuest`,
   `CombatManager.StartEncounter`, `Inventory.AddItem`, `Dialogue.StartBranch`, or
   `Flags.Set`.

## Validation

The sample binding is covered by automated tests. To validate it locally, run:

```bash
pytest tests/test_game_bindings.py -q
```

To create your own binding, copy `examples/game-bindings/rpg-binding.json`, edit the
systems and payload maps for your game, then validate it against
`schemas/game-binding.schema.json` before shipping it with your client.
