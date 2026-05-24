from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import boto3
from boto3.dynamodb.conditions import Key

from characterforge.models.action import CharacterAction
from characterforge.models.character import (
    CharacterProfile,
    CharacterSummary,
    CreateCharacterRequest,
    UpdateCharacterRequest,
)
from characterforge.models.chat import MessageRecord
from characterforge.models.ownership import (
    LEGACY_ACTOR_ID,
    LEGACY_ENVIRONMENT_ID,
    LEGACY_GAME_ID,
    LEGACY_TENANT_ID,
)
from characterforge.security.principal import Principal


class DynamoDBCharacterStore:
    """DynamoDB-backed CharacterStore implementation."""

    def __init__(
        self,
        table_name: str,
        *,
        region_name: str | None = None,
        dynamodb_resource: Any | None = None,
    ) -> None:
        dynamodb = dynamodb_resource or boto3.resource("dynamodb", region_name=region_name)
        self._table = dynamodb.Table(table_name)

    def create(self, request: CreateCharacterRequest, *, principal: Principal | None = None) -> CharacterProfile:
        now = _utc_now()
        profile = CharacterProfile(
            character_id=f"char_{uuid4().hex}",
            created_at=now,
            updated_at=now,
            **_ownership_metadata(principal),
            **request.model_dump(),
        )
        self._table.put_item(Item=_to_dynamodb_item(profile))
        return profile.model_copy(deep=True)

    def get(self, character_id: str) -> CharacterProfile | None:
        response = self._table.get_item(Key={"character_id": character_id})
        item = response.get("Item")
        if item is None:
            return None
        return _character_from_item(item)

    def list(self) -> list[CharacterSummary]:
        response = self._table.scan()
        items = list(response.get("Items", []))
        while "LastEvaluatedKey" in response:
            response = self._table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
            items.extend(response.get("Items", []))

        profiles = [_character_from_item(item) for item in items]
        profiles.sort(key=lambda profile: (profile.created_at, profile.character_id))
        return [
            CharacterSummary(
                character_id=profile.character_id,
                tenant_id=profile.tenant_id,
                game_id=profile.game_id,
                environment_id=profile.environment_id,
                created_by=profile.created_by,
                updated_by=profile.updated_by,
                name=profile.name,
                description=profile.description,
                created_at=profile.created_at,
                updated_at=profile.updated_at,
            )
            for profile in profiles
        ]

    def update(
        self,
        character_id: str,
        request: UpdateCharacterRequest,
        *,
        principal: Principal | None = None,
    ) -> CharacterProfile | None:
        existing = self.get(character_id)
        if existing is None:
            return None

        update_data = request.model_dump(exclude_none=True)
        updated = existing.model_copy(
            update={**update_data, "updated_at": _utc_now(), "updated_by": _audit_actor(principal)},
            deep=True,
        )
        self._table.put_item(Item=_to_dynamodb_item(updated))
        return updated.model_copy(deep=True)

    def delete(self, character_id: str) -> bool:
        response = self._table.delete_item(
            Key={"character_id": character_id},
            ReturnValues="ALL_OLD",
        )
        return "Attributes" in response


class DynamoDBSessionStore:
    """DynamoDB-backed SessionStore implementation for chat history."""

    def __init__(
        self,
        table_name: str,
        *,
        region_name: str | None = None,
        dynamodb_resource: Any | None = None,
    ) -> None:
        dynamodb = dynamodb_resource or boto3.resource("dynamodb", region_name=region_name)
        self._table = dynamodb.Table(table_name)

    def save_player_message(
        self,
        session_id: str,
        character_id: str,
        player_id: str,
        content: str,
        *,
        principal: Principal | None = None,
    ) -> MessageRecord:
        return self._save_message(
            session_id=session_id,
            character_id=character_id,
            player_id=player_id,
            role="player",
            content=content,
            principal=principal,
        )

    def save_character_message(
        self,
        session_id: str,
        character_id: str,
        player_id: str,
        content: str,
        *,
        emotion: str | None = None,
        actions: Sequence[CharacterAction] | None = None,
        principal: Principal | None = None,
    ) -> MessageRecord:
        return self._save_message(
            session_id=session_id,
            character_id=character_id,
            player_id=player_id,
            role="assistant",
            content=content,
            emotion=emotion,
            actions=list(actions or []),
            principal=principal,
        )

    def get_recent_history(
        self,
        session_id: str,
        *,
        limit: int | None = None,
    ) -> list[MessageRecord]:
        query_args: dict[str, Any] = {
            "KeyConditionExpression": Key("session_id").eq(session_id),
        }
        if limit is not None:
            query_args["ScanIndexForward"] = False
            query_args["Limit"] = limit
        else:
            query_args["ScanIndexForward"] = True

        response = self._table.query(**query_args)
        items = list(response.get("Items", []))

        if limit is None:
            while "LastEvaluatedKey" in response:
                response = self._table.query(
                    ExclusiveStartKey=response["LastEvaluatedKey"],
                    **query_args,
                )
                items.extend(response.get("Items", []))
        else:
            items.reverse()

        return [_message_from_item(item) for item in items]

    def clear_session(self, session_id: str) -> int:
        response = self._table.query(
            KeyConditionExpression=Key("session_id").eq(session_id),
            ProjectionExpression="session_id, created_at_message_id",
        )
        keys = list(response.get("Items", []))
        while "LastEvaluatedKey" in response:
            response = self._table.query(
                KeyConditionExpression=Key("session_id").eq(session_id),
                ProjectionExpression="session_id, created_at_message_id",
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            keys.extend(response.get("Items", []))

        with self._table.batch_writer() as batch:
            for key in keys:
                batch.delete_item(Key=key)
        return len(keys)

    def _save_message(
        self,
        *,
        session_id: str,
        character_id: str,
        player_id: str,
        role: str,
        content: str,
        emotion: str | None = None,
        actions: list[CharacterAction] | None = None,
        principal: Principal | None = None,
    ) -> MessageRecord:
        created_at = _utc_now()
        message_id = f"msg_{uuid4().hex}"
        message = MessageRecord(
            message_id=message_id,
            session_id=session_id,
            character_id=character_id,
            player_id=player_id,
            role=role,
            content=content,
            created_at=created_at,
            updated_at=created_at,
            actions=actions or [],
            emotion=emotion,
            **_ownership_metadata(principal),
        )
        item = _to_dynamodb_item(message)
        item["created_at_message_id"] = _message_sort_key(created_at, message_id)
        self._table.put_item(Item=item)
        return message.model_copy(deep=True)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _message_sort_key(created_at: datetime, message_id: str) -> str:
    return f"{_format_datetime(created_at)}#{message_id}"


def _ownership_metadata(principal: Principal | None) -> dict[str, str]:
    if principal is None:
        return {
            "tenant_id": LEGACY_TENANT_ID,
            "game_id": LEGACY_GAME_ID,
            "environment_id": LEGACY_ENVIRONMENT_ID,
            "created_by": LEGACY_ACTOR_ID,
            "updated_by": LEGACY_ACTOR_ID,
        }
    actor = principal.subject
    return {
        "tenant_id": principal.tenant_id,
        "game_id": principal.game_id,
        "environment_id": principal.environment_id,
        "created_by": actor,
        "updated_by": actor,
    }


def _audit_actor(principal: Principal | None) -> str:
    return principal.subject if principal is not None else LEGACY_ACTOR_ID


def _to_dynamodb_item(model: Any) -> dict[str, Any]:
    data = model.model_dump(mode="json")
    return _remove_none(data)


def _remove_none(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _remove_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_remove_none(item) for item in value]
    return value


def _character_from_item(item: Mapping[str, Any]) -> CharacterProfile:
    return CharacterProfile.model_validate(_from_dynamodb_value(dict(item)))


def _message_from_item(item: Mapping[str, Any]) -> MessageRecord:
    data = dict(item)
    data.pop("created_at_message_id", None)
    return MessageRecord.model_validate(_from_dynamodb_value(data))


def _from_dynamodb_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    if isinstance(value, Mapping):
        return {key: _from_dynamodb_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_from_dynamodb_value(item) for item in value]
    return value


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
