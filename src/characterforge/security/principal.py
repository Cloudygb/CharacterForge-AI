from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any


class PrincipalError(ValueError):
    """Raised when an API Gateway event cannot produce a valid request principal."""


@dataclass(frozen=True, slots=True)
class Principal:
    """Normalized caller identity made available to Lambda route handlers."""

    tenant_id: str
    game_id: str
    environment_id: str
    scopes: frozenset[str]
    user_id: str | None = None
    service_principal_id: str | None = None
    roles: frozenset[str] = frozenset()
    is_local_dev: bool = False

    @property
    def subject(self) -> str:
        """Return the normalized caller identifier used for audit attribution."""

        return self.user_id or self.service_principal_id or "local-developer"


def principal_from_event(event: Mapping[str, Any]) -> Principal:
    """Extract and normalize the request principal from API Gateway authorizer claims."""

    if _local_dev_mode_enabled():
        return _local_dev_principal()

    claims, jwt_scopes = _authorizer_claims(event)
    tenant_id = _required_claim(claims, "tenant_id", aliases=("custom:tenant_id",))
    game_id = _required_claim(claims, "game_id", aliases=("custom:game_id",))
    environment_id = _required_claim(
        claims,
        "environment_id",
        aliases=("custom:environment_id", "environment"),
    )
    user_id = _optional_claim(claims, "user_id", aliases=("custom:user_id", "sub"))
    service_principal_id = _optional_claim(
        claims,
        "service_principal_id",
        aliases=("custom:service_principal_id", "client_id"),
    )
    if user_id and service_principal_id:
        service_principal_id = None
    if not user_id and not service_principal_id:
        raise PrincipalError("Missing required authorizer claim: user_id or service_principal_id")

    scopes = _extract_scopes(claims, jwt_scopes)
    if not scopes:
        raise PrincipalError("Missing required authorizer claims: scopes")

    return Principal(
        tenant_id=tenant_id,
        game_id=game_id,
        environment_id=environment_id,
        user_id=user_id,
        service_principal_id=service_principal_id,
        scopes=frozenset(scopes),
        roles=frozenset(_extract_roles(claims)),
    )


def _authorizer_claims(event: Mapping[str, Any]) -> tuple[Mapping[str, Any], Iterable[Any] | None]:
    request_context = event.get("requestContext")
    if not isinstance(request_context, Mapping):
        raise PrincipalError("Missing API Gateway authorizer claims.")
    authorizer = request_context.get("authorizer")
    if not isinstance(authorizer, Mapping):
        raise PrincipalError("Missing API Gateway authorizer claims.")

    jwt_context = authorizer.get("jwt")
    if isinstance(jwt_context, Mapping):
        claims = jwt_context.get("claims")
        if not isinstance(claims, Mapping):
            raise PrincipalError("Missing API Gateway authorizer claims.")
        scopes = jwt_context.get("scopes")
        return claims, scopes if isinstance(scopes, Iterable) and not isinstance(scopes, str) else None

    claims = authorizer.get("claims")
    if not isinstance(claims, Mapping):
        raise PrincipalError("Missing API Gateway authorizer claims.")
    return claims, None


def _required_claim(claims: Mapping[str, Any], name: str, *, aliases: tuple[str, ...] = ()) -> str:
    value = _optional_claim(claims, name, aliases=aliases)
    if value is None:
        raise PrincipalError(f"Missing required authorizer claim: {name}")
    return value


def _optional_claim(claims: Mapping[str, Any], name: str, *, aliases: tuple[str, ...] = ()) -> str | None:
    for key in (name, *aliases):
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_scopes(claims: Mapping[str, Any], jwt_scopes: Iterable[Any] | None) -> set[str]:
    scopes: set[str] = set()
    for raw_scope in jwt_scopes or ():
        if isinstance(raw_scope, str) and raw_scope.strip():
            scopes.add(raw_scope.strip())

    for key in ("scope", "scp", "scopes", "custom:scopes"):
        raw_value = claims.get(key)
        if isinstance(raw_value, str):
            scopes.update(scope for scope in raw_value.replace(",", " ").split() if scope)
        elif isinstance(raw_value, Iterable):
            scopes.update(str(scope).strip() for scope in raw_value if str(scope).strip())
    return scopes


def _extract_roles(claims: Mapping[str, Any]) -> set[str]:
    roles: set[str] = set()
    for key in ("roles", "role", "cognito:groups", "custom:roles"):
        raw_value = claims.get(key)
        if isinstance(raw_value, str):
            roles.update(role for role in raw_value.replace(",", " ").split() if role)
        elif isinstance(raw_value, Iterable):
            roles.update(str(role).strip() for role in raw_value if str(role).strip())
    return roles


def _local_dev_mode_enabled() -> bool:
    return os.getenv("CHARACTERFORGE_AUTH_LOCAL_DEV_MODE", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _local_dev_principal() -> Principal:
    return Principal(
        tenant_id="local-tenant",
        game_id="local-game",
        environment_id="local",
        user_id="local-developer",
        service_principal_id=None,
        scopes=frozenset(
            {
                "characters:read",
                "characters:write",
                "sessions:read",
                "sessions:write",
                "deployment:admin",
            }
        ),
        roles=frozenset({"local-admin"}),
        is_local_dev=True,
    )
