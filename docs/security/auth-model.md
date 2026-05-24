# CharacterForge AI Production Identity Model

This document defines the production identity model that later authentication, authorization, OpenAPI, infrastructure, SDK, and dashboard changes must implement. It covers the Audit 1.1, 1.2, and 1.3 target state without introducing secrets or live endpoint values.

## Goals

- Replace API-key-only access with principal-aware authorization for production traffic.
- Make every request resolve to a tenant, game, environment, and caller principal before business logic runs.
- Prevent cross-tenant, cross-game, and cross-environment object access even when object IDs are known.
- Keep API keys as optional metering and quota controls only.
- Give future tests and implementations a single reference for route scopes and ownership rules.

## Principal and claim vocabulary

Every production request must produce a normalized principal with these claims:

| Claim | Required for | Meaning | Notes |
| --- | --- | --- | --- |
| `tenant_id` | all production calls | Studio, customer, or organization boundary | Primary authorization partition. |
| `game_id` | all game/editor data calls | Game title/project within the tenant | Prevents one game from reading another game's characters. |
| `environment_id` | all game/editor data calls | Environment such as `dev`, `staging`, or `prod` | Prevents dev tooling from touching production data. |
| `user_id` | human user principal | Human designer, operator, or admin | Comes from Cognito/OIDC/JWT subject claims. |
| `service_principal_id` | service principal | Backend proxy, dedicated server, CI, or automation identity | Comes from service-token claims, IAM/SigV4 identity, or equivalent server-side identity. |
| `player_id` | player/session calls when known | Game-defined player or session participant | Must be scoped by tenant/game/environment and never globally trusted. |
| `roles` | all production calls | Coarse-grained groups such as `owner`, `developer`, `operator`, `runtime`, `viewer` | Roles map to scopes but handlers authorize on scopes and ownership. |
| `scopes` | all production calls | Fine-grained permissions such as `characters:read` | Route authorization uses scopes plus object ownership. |

A request is invalid if it lacks `tenant_id`, `game_id`, `environment_id`, or exactly one caller identity from `user_id` or `service_principal_id`, except for explicitly marked local development mode.

## Principal types

### Human user principal

A human user principal represents a designer, developer, operator, or studio admin using the dashboard, CLI, or editor tooling. Production user flows should use Cognito/OIDC/JWT with Authorization Code + PKCE where the client is public, including desktop tooling. Human tokens must include `tenant_id`, allowed `game_id` values or a selected `game_id`, allowed `environment_id` values or a selected `environment_id`, `user_id`, `roles`, and `scopes`.

### Service principal

A service principal represents non-human code: game backend proxy, dedicated server, CI release automation, or deployment automation. It must have `service_principal_id`, `tenant_id`, permitted `game_id`, permitted `environment_id`, and explicit `scopes`. Service-to-service authentication may use IAM/SigV4 for AWS-native callers or a short-lived signed JWT issued to a registered backend service. Long-lived static secrets must not be shipped to games.

### Player/session participant

A player is not the same as a CharacterForge operator. Player identity comes from the game backend and is represented as `player_id` in short-lived runtime tokens or request context. Player claims are valid only under the issuing `tenant_id`, `game_id`, and `environment_id`.

## Token types

| Token type | Issuer / flow | Audience | Lifetime | Allowed use |
| --- | --- | --- | --- | --- |
| User access JWT | Cognito/OIDC/JWT Authorization Code + PKCE | CharacterForge API | Short-lived | Dashboard, editor, and admin operations for a human user principal. |
| Service JWT | CharacterForge or trusted tenant identity provider | CharacterForge API | Short-lived and rotated | Backend proxy, dedicated server, and automation calls for a service principal. |
| IAM/SigV4 request identity | AWS IAM role/session | CharacterForge API or internal AWS integration | Session-bound | AWS-native service-to-service calls where IAM is the trust boundary. |
| Player/session token | Tenant game backend proxy | Runtime chat/session endpoints | Very short-lived | Player-scoped runtime calls mediated by a game backend proxy. |
| API Gateway API key | API Gateway usage plan | Metering/quota only | Rotated separately | API keys are metering only. API keys MUST NOT grant authorization or identify users, games, environments, players, or services. |

Production handlers must not accept direct API-key authorization. direct API-key use is local-development only until the migration is complete and must be labeled that way in docs and examples.

## Roles and scopes

Roles are convenient assignment bundles; scopes are the enforcement unit. Initial role-to-scope mapping:

| Role | Intended caller | Scopes |
| --- | --- | --- |
| `owner` | Tenant owner/admin | `characters:read`, `characters:write`, `characters:delete`, `sessions:read`, `sessions:delete`, `deployment:admin`, `billing:read`, `audit:read` |
| `developer` | Game designer/developer | `characters:read`, `characters:write`, `sessions:read`, `sessions:write` |
| `operator` | Runtime or support operator | `characters:read`, `sessions:read`, `sessions:delete` |
| `runtime` | Game backend proxy or dedicated server | `characters:read`, `sessions:write`, `sessions:read` |
| `viewer` | Read-only reviewer | `characters:read`, `sessions:read` |

Scope rules:

- `characters:read` allows listing or reading characters only inside the caller's `tenant_id`, `game_id`, and `environment_id`.
- `characters:write` allows creating/updating characters only inside the caller's `tenant_id`, `game_id`, and `environment_id`.
- `characters:delete` allows deletion only for matching ownership dimensions and should be withheld from runtime clients.
- `sessions:write` allows creating chat/session turns for a permitted character and, when present, matching `player_id`.
- `sessions:read` allows session-history reads for matching tenant/game/environment/session ownership.
- `sessions:delete` allows session deletion for matching ownership and elevated operator/admin roles.
- `deployment:admin` allows Start/End/deployment actions and must not be granted to public game clients.

## Object ownership model

All durable resources created after migration must carry these ownership fields:

- Character records: `tenant_id`, `game_id`, `environment_id`, `character_id`, `created_by_principal_id`, `updated_by_principal_id`, `source_client`, `created_at`, `updated_at`.
- Session records: `tenant_id`, `game_id`, `environment_id`, `session_id`, `character_id`, optional `player_id`, `created_by_principal_id`, `source_client`, `last_used_at`.
- Deployment records: `tenant_id`, `game_id`, `environment_id`, stack/deployment identifier, `created_by_principal_id`, `updated_by_principal_id`, `source_client`, `last_used_at`.

DynamoDB keys should include ownership dimensions, not only global object IDs. A safe target pattern is to partition or prefix by `tenant_id`, `game_id`, and `environment_id`, then store object IDs within that boundary. Knowing a `character_id` or `session_id` is never sufficient authorization.

## Route authorization matrix

Every current API route must check both scope and ownership before calling service logic.

| Method | Route | Required scope | Ownership rule | Principal types |
| --- | --- | --- | --- | --- |
| POST | `/characters` | `characters:write` | tenant_id + game_id + environment_id | human user principal or service principal with editor/admin scope |
| GET | `/characters` | `characters:read` | tenant_id + game_id + environment_id | human user principal or service principal |
| GET | `/characters/{character_id}` | `characters:read` | tenant_id + game_id + environment_id + character_id | human user principal or service principal |
| PUT | `/characters/{character_id}` | `characters:write` | tenant_id + game_id + environment_id + character_id | human user principal or service principal with editor/admin scope |
| DELETE | `/characters/{character_id}` | `characters:delete` | tenant_id + game_id + environment_id + character_id | human user principal with owner/operator scope; not runtime clients |
| POST | `/characters/{character_id}/chat` | `sessions:write` | tenant_id + game_id + environment_id + character_id + player_id/session_id | game backend proxy, dedicated server, or authorized editor test client |
| GET | `/sessions/{session_id}` | `sessions:read` | tenant_id + game_id + environment_id + session_id | human user principal or service principal; player token only for its own session |
| DELETE | `/sessions/{session_id}` | `sessions:delete` | tenant_id + game_id + environment_id + session_id | owner/operator human user principal or tightly scoped service principal |

Future deployment routes must require `deployment:admin` plus tenant/game/environment ownership. They must never be callable with runtime player/session tokens.

## Local development behavior

Local development mode is an explicit compatibility bridge, not a production authorization model:

- Direct API-key use is local-development only and must be disabled or rejected for production stages once JWT/service identity is available.
- Local mode may create a synthetic principal with `tenant_id=local`, `game_id=local-demo`, `environment_id=local`, and `user_id=local-developer` for tests and examples.
- Local mode must be enabled by an explicit configuration flag and must not be inferred from a missing token.
- Local mode must not write production-looking tenant, game, or environment IDs.
- Tests should cover both local compatibility and production rejection of missing/invalid principals.

## Threat model

This threat model is designed to address OWASP API1, OWASP API2, and OWASP API5 risks:

| Threat | Control |
| --- | --- |
| leaked API key | API keys are metering only; no production handler trusts them as identity or authorization. |
| cross-tenant object access | Every object read/write checks `tenant_id`, `game_id`, and `environment_id` from authenticated claims before loading or mutating data. |
| public game client secret extraction | Public clients use game backend proxy mode, dedicated server mode, editor-only tooling, or short-lived player/session tokens instead of shipping static CharacterForge secrets. |
| confused deputy | Service principals declare allowed tenant/game/environment and scopes; deployment/admin scopes are separate from runtime scopes. |
| audit attribution gap | Resource writes record `created_by_principal_id`, `updated_by_principal_id`, `source_client`, environment, and last-used metadata. |

## Deployment and game integration modes

- Local dev direct mode: explicit local-development mode only, with synthetic local principal and local/demo API key compatibility where necessary.
- Studio backend proxy mode: preferred production game-client path. The game backend stores CharacterForge credentials server-side, authenticates the player with the game's own identity system, and exchanges/forwards short-lived scoped calls.
- Dedicated server mode: server process authenticates as a service principal with runtime scopes only.
- Editor-only tooling mode: designer/editor uses human user principal with PKCE and editor scopes; no game client receives deployment/admin privileges.

## Migration impact

This migration impact section defines the data, API, and client changes required to move from API-key-only access to principal-aware production authorization.

Implementation should proceed in compatible phases:

1. Add tenant_id/game_id/environment_id keys to new character, session, and deployment records while retaining read compatibility for existing local/demo records.
2. Backfill existing characters and sessions into a default migration tenant/game/environment selected by the operator before production enforcement.
3. Introduce JWT authorizer before enforcing scopes so handlers can receive normalized claims and tests can exercise missing/invalid claims.
4. Add a principal extraction layer that normalizes `tenant_id`, `game_id`, `environment_id`, `user_id`, `service_principal_id`, `roles`, and `scopes`.
5. Move game clients behind a backend proxy or dedicated-server service identity; keep direct API-key examples labeled local development only.
6. Convert DynamoDB access to include ownership dimensions before rejecting old global-ID-only records in production.
7. Add negative cross-tenant and cross-game tests before flipping production enforcement to fail closed.

## Acceptance criteria

These acceptance criteria define when the production identity model is ready for implementation:
- No production handler trusts x-api-key as identity.
- Every request resolves exactly one principal: either `user_id` or `service_principal_id`, with required tenant/game/environment claims.
- Every object read/write checks tenant_id, game_id, and environment_id before returning or mutating data.
- Every route in the authorization matrix has a required scope and ownership rule implemented in tests and code.
- Negative cross-tenant and cross-game tests exist for characters and sessions.
- API keys remain optional usage-plan metering only and can be rotated without changing principal authorization.
- Game clients have a documented backend proxy or dedicated-server path that does not ship static CharacterForge secrets.
- Audit fields identify the principal, source client, environment, and last-used metadata for writes and runtime session use.
- OpenAPI security descriptions distinguish bearer/service identity from API-key metering before production release.

## Deferred implementation notes

This document intentionally defines the model before coding the authorizer. Later steps should update infrastructure, OpenAPI, handlers, SDKs, and examples to conform to this model. Any implementation that cannot satisfy the route matrix must update this document and the related tests in the same change.
