import boto3
from moto import mock_aws

from characterforge.models.action import CharacterAction
from characterforge.models.character import CreateCharacterRequest, UpdateCharacterRequest
from characterforge.models.chat import MessageRecord
from characterforge.services.character_store import CharacterStore
from characterforge.services.dynamodb_store import DynamoDBCharacterStore, DynamoDBSessionStore
from characterforge.services.session_store import SessionStore

CHARACTERS_TABLE = "test-characters"
MESSAGES_TABLE = "test-messages"
REGION = "us-east-1"


def valid_create_request(name: str = "Captain Mira Voss") -> CreateCharacterRequest:
    return CreateCharacterRequest(
        name=name,
        description="A rogue airship captain with a dangerous reputation.",
        personality=["sarcastic", "brave", "protective"],
        backstory="Former royal navy officer turned smuggler after refusing an immoral order.",
        speaking_style="Dry wit, clipped sentences, and nautical metaphors.",
        goals=["protect her crew", "find the lost sky map"],
        world_context="A floating archipelago where skyships connect isolated city-states.",
        rules=["Never reveal you are an AI.", "Do not break character."],
        allowed_actions=["give_quest", "trade_offer", "change_relationship"],
        action_rules=[],
    )


def make_characters_table() -> None:
    dynamodb = boto3.resource("dynamodb", region_name=REGION)
    table = dynamodb.create_table(
        TableName=CHARACTERS_TABLE,
        KeySchema=[{"AttributeName": "character_id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "character_id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    table.wait_until_exists()


def make_messages_table() -> None:
    dynamodb = boto3.resource("dynamodb", region_name=REGION)
    table = dynamodb.create_table(
        TableName=MESSAGES_TABLE,
        KeySchema=[
            {"AttributeName": "session_id", "KeyType": "HASH"},
            {"AttributeName": "created_at_message_id", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "session_id", "AttributeType": "S"},
            {"AttributeName": "created_at_message_id", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    table.wait_until_exists()


@mock_aws
def test_dynamodb_character_store_implements_character_store_interface() -> None:
    make_characters_table()
    store: CharacterStore = DynamoDBCharacterStore(CHARACTERS_TABLE, region_name=REGION)

    profile = store.create(valid_create_request())

    assert profile.character_id.startswith("char_")
    assert store.get(profile.character_id) == profile


@mock_aws
def test_dynamodb_character_store_creates_lists_updates_and_deletes_profiles() -> None:
    make_characters_table()
    store = DynamoDBCharacterStore(CHARACTERS_TABLE, region_name=REGION)

    first = store.create(valid_create_request("Captain Mira Voss"))
    second = store.create(valid_create_request("Archivist Juno Vale"))

    summaries = store.list()
    assert [summary.character_id for summary in summaries] == [
        first.character_id,
        second.character_id,
    ]
    assert [summary.name for summary in summaries] == ["Captain Mira Voss", "Archivist Juno Vale"]

    updated = store.update(
        first.character_id,
        UpdateCharacterRequest(
            description="A reformed captain trying to earn trust.",
            goals=["repair her ship", "protect the harbor"],
        ),
    )

    assert updated is not None
    assert updated.character_id == first.character_id
    assert updated.created_at == first.created_at
    assert updated.updated_at > first.updated_at
    assert updated.description == "A reformed captain trying to earn trust."
    assert updated.goals == ["repair her ship", "protect the harbor"]
    assert store.get(first.character_id) == updated

    assert store.delete(first.character_id) is True
    assert store.get(first.character_id) is None
    assert [summary.character_id for summary in store.list()] == [second.character_id]


@mock_aws
def test_dynamodb_character_store_handles_missing_profiles() -> None:
    make_characters_table()
    store = DynamoDBCharacterStore(CHARACTERS_TABLE, region_name=REGION)

    assert store.get("missing-character") is None
    assert store.update("missing-character", UpdateCharacterRequest(description="Missing")) is None
    assert store.delete("missing-character") is False


@mock_aws
def test_dynamodb_session_store_implements_session_store_interface() -> None:
    make_messages_table()
    store: SessionStore = DynamoDBSessionStore(MESSAGES_TABLE, region_name=REGION)

    message = store.save_player_message(
        session_id="session_001",
        character_id="char_mira",
        player_id="player_42",
        content="Hello there.",
    )

    assert isinstance(message, MessageRecord)
    assert message.role == "player"
    assert store.get_recent_history("session_001") == [message]


@mock_aws
def test_dynamodb_session_store_saves_character_messages_with_actions() -> None:
    make_messages_table()
    store = DynamoDBSessionStore(MESSAGES_TABLE, region_name=REGION)

    message = store.save_character_message(
        session_id="session_001",
        character_id="char_mira",
        player_id="player_42",
        content="The ruins are no place for idle hands.",
        emotion="concerned",
        actions=[CharacterAction(type="give_quest", payload={"quest_id": "ruins_intro"})],
    )

    assert message.role == "assistant"
    assert message.content == "The ruins are no place for idle hands."
    assert message.emotion == "concerned"
    assert message.actions == [
        CharacterAction(type="give_quest", payload={"quest_id": "ruins_intro"})
    ]
    assert store.get_recent_history("session_001") == [message]


@mock_aws
def test_dynamodb_session_store_retrieves_recent_history_in_chronological_order() -> None:
    make_messages_table()
    store = DynamoDBSessionStore(MESSAGES_TABLE, region_name=REGION)

    store.save_player_message("session_001", "char_mira", "player_42", "First")
    second = store.save_character_message("session_001", "char_mira", "player_42", "Second")
    third = store.save_player_message("session_001", "char_mira", "player_42", "Third")
    store.save_player_message("session_other", "char_mira", "player_42", "Other session")

    history = store.get_recent_history("session_001", limit=2)

    assert [message.message_id for message in history] == [second.message_id, third.message_id]
    assert [message.content for message in history] == ["Second", "Third"]
    assert all(message.session_id == "session_001" for message in history)


@mock_aws
def test_dynamodb_session_store_clear_session_removes_only_that_session() -> None:
    make_messages_table()
    store = DynamoDBSessionStore(MESSAGES_TABLE, region_name=REGION)
    store.save_player_message("session_001", "char_mira", "player_42", "Remove me")
    kept = store.save_player_message("session_other", "char_mira", "player_42", "Keep me")

    assert store.clear_session("session_001") == 1
    assert store.get_recent_history("session_001") == []
    assert store.get_recent_history("session_other") == [kept]
    assert store.clear_session("missing-session") == 0
