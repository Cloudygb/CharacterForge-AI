# Best-Practice Audit Remediation Ledger

This ledger tracks remediation evidence for the internal CharacterForge AI best-practice audit dated 2026-05-23. It is intentionally stored outside public docs and should not include the original audit report, guide artifacts, secrets, live endpoints, credential values, screenshots with sensitive details, or local machine credentials.

## Branch

- Remediation branch: `best-practice-audit-remediation`
- Ledger status values: `Planned`, `In progress`, `Implemented`, `Deferred`, `Accepted risk`
- Each finding must keep its row updated with the commit or PR, tests run, and verification evidence before it can be considered closed.

## Findings

| Task ID | Audit Finding | Severity | Status | PR/Commit | Tests | Verification Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| CF-AUDIT-1.1 | 1.1 API key only is not sufficient authentication | P0 | In progress | Step 15 model commit recorded in final task summary; Step 16 auth-regression commit recorded in final task summary; Step 17 authorizer commit recorded in final task summary; Step 18 principal extraction commit pending | `pytest tests/test_identity_model_documentation.py -q`; `pytest tests/test_authorization.py -q`; `pytest tests/test_api_authorizer_infrastructure.py -q`; `pytest tests/test_openapi_api_key_security.py -q`; `pytest tests/test_principal_extraction.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q` | Production identity model defines human and service principals, token types, scopes, and states that API keys are metering only; Step 16 adds auth regression tests; Step 17 adds configurable Cognito/OIDC JWT authorizer infrastructure, a local development only mode, and BearerAuth OpenAPI documentation; Step 18 extracts API Gateway authorizer claims into a typed Principal and rejects missing required claims outside explicit local-dev test mode. Scope/object enforcement remains in later auth implementation steps. |
| CF-AUDIT-1.2 | 1.2 Broken object-level authorization risk | P0 | In progress | Step 15 model commit recorded in final task summary; Step 16 auth-regression commit recorded in final task summary; Step 19 ownership metadata commit recorded in final task summary; Step 20 character authorization commit pending | `pytest tests/test_identity_model_documentation.py -q`; `pytest tests/test_authorization.py -q`; `pytest tests/test_character_handlers.py -q`; `pytest tests/test_character_store.py tests/test_session_store.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q` | Production identity model defines tenant/game/environment ownership dimensions and route-level ownership rules; Step 16 adds regression tests for cross-tenant access; Step 19 stores ownership and audit metadata on records; Step 20 enforces characters:read and characters:write plus tenant/game/environment checks for character list/get/create/update/delete handlers. Session/chat enforcement remains in later implementation steps. |
| CF-AUDIT-1.3 | 1.3 Client secret handling conflicts with game deployment reality | P0 | In progress | Step 15 commit recorded in final task summary | `pytest tests/test_identity_model_documentation.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q` | Production identity model requires backend proxy/dedicated-server paths, short-lived tokens, PKCE for public clients, and local-development-only direct API-key use. |
| CF-AUDIT-1.4 | 1.4 Wildcard CORS is too permissive | P0/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.5 | 1.5 Input and resource limits are not strong enough | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.6 | 1.6 LLM prompt-injection and action execution controls are incomplete | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.7 | 1.7 Error responses may leak too much detail | P2/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-2.1 | 2.1 IAM is broader than the selected model | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-2.2 | 2.2 Missing preventive/detective production controls | P1/P2 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-2.3 | 2.3 Stack automation should emphasize safe reversibility | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-3.1 | 3.1 CSP is disabled while privileged commands exist | P0 | Implemented | Step 7 commit recorded in final task summary | `pytest tests/test_tauri_security_config.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q`; dashboard `npm run build`; Tauri build smoke | Production Tauri config has an explicit bundled-assets CSP instead of `csp: null`; tests reject unsafe inline/eval script/style sources, broad remote origins, live endpoints, and credential-looking values. |
| CF-AUDIT-3.2 | 3.2 IPC command surface should be least-privileged | P1 | Implemented | Step 8 commit recorded in final task summary | `pytest tests/test_tauri_ipc_permissions.py tests/test_best_practice_audit_regressions.py -q`; dashboard `npm test -- --run src/deploymentAdapters.test.ts src/App.test.tsx`; Tauri `cargo test` | Dashboard IPC commands are registered through a Tauri app manifest, split into explicit read-only, local-file, deployment-start, and deployment-end capabilities, and dangerous Start/End commands require typed confirmation plus a one-time native confirmation session token before execution. |
| CF-AUDIT-3.3 | 3.3 Local deployment process trusts PATH and environment overrides | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-4.1 | 4.1 Unsigned installer is release-blocking | P0 | Implemented | Step 4 commit `a88764c`; Step 5 commit recorded in final task summary | `pytest tests/test_installer_release_verification.py -q`; `pytest tests/test_release_manifest.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q`; PowerShell dev/release verifier smoke checks | Release-mode build requires signing config, certificate, timestamp URL, expected publisher, Authenticode verification, signed installer verification, and generated checksums from the final signed installer; public SmartScreen bypass guidance removed. |
| CF-AUDIT-4.2 | 4.2 Updater UI exists without secure updater implementation | P0 | Implemented | Step 6 commit recorded in final task summary | `npm test -- --run src/App.test.tsx`; `cargo test`; `pytest tests/test_best_practice_audit_regressions.py -q`; `pytest tests/test_dashboard_tauri_packaging.py -q` | Normal release UI hides Check for Updates and Update Now, explains updates are manual for this build, and points users to signed GitHub Releases plus generated release manifest verification until signed updater infrastructure exists. |
| CF-AUDIT-4.3 | 4.3 Prerequisite installers need stronger pinning and failure handling | P1 | Implemented | Step 10 and Step 11 commits recorded in final task summaries | `pytest tests/test_installer_prerequisite_installers.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q`; `pytest tests/test_audit_remediation_ledger.py -q`; `pytest -q` | NSIS now pops and checks every prerequisite helper return code. Elevated prerequisite downloads use pinned URLs, pinned version metadata, expected SHA-256, expected signer publisher checks, and documented update procedure notes. |
| CF-AUDIT-4.4 | 4.4 Installer scope, downgrade, and MSI/NSIS strategy need cleanup | P1 | Implemented | Step 9 and Step 12 commits recorded in final task summaries | `pytest tests/test_dashboard_tauri_packaging.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q`; `pytest tests/test_audit_remediation_ledger.py -q`; installer build/config inspection | Tauri Windows bundle config blocks downgrades and uses a single supported NSIS-only current-user release installer policy; the clean-machine checklist and build script align to the staged NSIS `.exe` artifact. |
| CF-AUDIT-4.5 | 4.5 Uninstall cleanup misses real app data paths | P2 | Implemented | Step 13 commit recorded in final task summary | `pytest tests/test_dashboard_tauri_packaging.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q`; `pytest tests/test_audit_remediation_ledger.py -q`; generated uninstaller hook inspection | Uninstaller offers opt-in cleanup for `%APPDATA%\CharacterForgeAI` config/cache, preserves user-authored characters by default, and warns users to export or copy character files before choosing removal. |
| CF-AUDIT-4.6 | 4.6 Supply-chain artifacts are missing | P2 | Implemented | Step 5 and Step 14 commits recorded in final task summaries | `pytest tests/test_release_manifest.py -q`; `pytest tests/test_release_sbom.py -q`; manifest/sha256 smoke comparison; SBOM generator smoke; full suite | Release manifest generator writes final-artifact checksums after signing. Release builds now generate CycloneDX npm, Rust, and Python SBOMs plus `release-provenance.json` under `dist/release-sbom`, and the release script fails if any required SBOM/provenance artifact is missing. |
| CF-AUDIT-5.1 | 5.1 First-run flow is too text-heavy | P0/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-5.2 | 5.2 Deployment page mixes too many workflows | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-5.3 | 5.3 Destructive Start/End needs typed confirmation | P0 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-5.4 | 5.4 Character editor is too advanced too soon | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-5.5 | 5.5 Chat should work before AWS | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-5.6 | 5.6 Settings is really Updates | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-5.7 | 5.7 Accessibility gaps | P1/P2 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-5.8 | 5.8 Developer efficiency features are missing | P2 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-6.1 | 6.1 Persistence model needs clearer UX | P1/P2 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-6.2 | 6.2 Local data deserves first-class management | P2 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-7.1 | 7.1 No actual engine plugin exists | P0 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-7.2 | 7.2 The secure production integration path is missing | P0 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-7.3 | 7.3 SDK lacks game-ready runtime resilience | P0/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-7.4 | 7.4 Action contract is too loose for game execution | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-7.5 | 7.5 No event/game-state ingestion model | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-7.6 | 7.6 Docs inconsistency: `game_context` vs `context` | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-7.7 | 7.7 No runnable sample game | P2/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-8.1 | 8.1 OpenAPI should document auth and rate-limit behavior | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-8.2 | 8.2 SDK is too loosely typed | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-9.1 | 9.1 Local automated tests are strong but CI is missing | P2/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |

## Step 1 Evidence

| Evidence Item | Result |
| --- | --- |
| Branch created | `best-practice-audit-remediation` |
| Ledger coverage test | `pytest tests/test_audit_remediation_ledger.py -q` |
| Branch and working tree verification | `git status --short --branch` |
| Secret safety check | Ledger regression test rejects AWS key shapes, private key headers, live API Gateway hosts, live-looking CharacterForge API keys, and long secret assignments. |
| Public docs scope | Ledger is under `documents/plans/`, not `docs/` or README content. |

## Step 2 Baseline Verification Snapshot

Captured on branch `best-practice-audit-remediation` before feature remediation changes. The first `pytest -q` run includes the intentionally failing Step 2 ledger baseline regression test from the RED phase; the GREEN verification after this section is added is recorded under Step 2 Evidence.

| Area | Command | Working Directory | Result | Duration | Failure Summary |
| --- | --- | --- | --- | --- | --- |
| Python tests | `pytest -q` | repo root | Failed, exit 1 | 89.38s | 251 passed; 1 failed because the Step 2 baseline ledger test was intentionally RED before this snapshot existed. |
| Dashboard typecheck | `npm run typecheck` | `apps/dashboard` | Passed, exit 0 | 0.80s | None. |
| Dashboard tests | `npm test -- --run` | `apps/dashboard` | Failed, exit 1 | 3.67s | Vitest startup could not load optional Rollup package `@rollup/rollup-linux-x64-gnu`; npm optional dependency install state needs refresh. |
| Dashboard build | `npm run build` | `apps/dashboard` | Failed, exit 1 | 0.84s | Vite/Rollup startup could not load optional Rollup package `@rollup/rollup-linux-x64-gnu`; same dependency install state issue as dashboard tests. |
| Rust formatting | `cargo fmt --check` | `apps/dashboard/src-tauri` | Passed, exit 0 | 0.30s | None. |
| Rust tests | `cargo test` | `apps/dashboard/src-tauri` | Passed, exit 0 | 53.81s | 14 Rust tests passed. |
| Rust check | `cargo check` | `apps/dashboard/src-tauri` | Passed, exit 0 | 15.49s | None. |
| TypeScript SDK tests | `npm test` | `sdk/typescript` | Passed, exit 0 | 6.38s | 1 test file and 4 tests passed. |
| Installer verification | `pytest tests/test_installer_dependency_detection.py tests/test_installer_prerequisite_installers.py tests/test_dashboard_tauri_packaging.py -q` | repo root | Passed, exit 0 | 2.55s | 22 installer/packaging tests passed. |

## Step 2 Evidence

| Evidence Item | Result |
| --- | --- |
| Baseline purpose | Pre-remediation verification state captured so later improvements are measurable. |
| Commands run | `pytest -q`; dashboard `npm run typecheck`; dashboard `npm test -- --run`; dashboard `npm run build`; Rust `cargo fmt --check`; Rust `cargo test`; Rust `cargo check`; SDK `npm test`; installer verification pytest subset. |
| Known failing baseline checks | Dashboard tests and dashboard build fail on missing Rollup optional dependency package `@rollup/rollup-linux-x64-gnu`; initial RED `pytest -q` failed only because this Step 2 ledger snapshot had not been recorded yet. |
| Passing baseline checks | Dashboard typecheck, Rust fmt, Rust tests, Rust check, TypeScript SDK tests, installer verification subset. |
| Secret safety | No secrets, live endpoints, credential values, or internal planning source artifacts were added to this ledger. |

## Step 3 Audit Regression Test Index

| Evidence Item | Result |
| --- | --- |
| Regression index file | `tests/test_best_practice_audit_regressions.py` |
| Audit gates indexed | auth required; object auth; no wildcard production CORS; CSP non-null; installer signing required; updater real-or-disabled; typed Start/End confirmation; OpenAPI auth responses; no API key persistence; docs direct-key warning; context naming consistency. |
| Placeholder behavior | Each gate is marked `xfail` with an `Audit gate pending remediation` reason so incomplete remediation cannot be mistaken for a passing audit gate. |
| Step verification | `pytest tests/test_best_practice_audit_regressions.py -q` reports 11 xfailed placeholders. |
| Safety scope | The regression index contains no secrets, live endpoints, credential values, or internal planning source artifacts. |

## Step 4 Release Signing Gate

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.1 / P0 unsigned installer |
| Release build gate | `scripts/build-windows-installer.ps1` accepts explicit `-ReleaseMode` and fails release mode unless `-SignArtifacts` and a signing config path are provided. |
| Required signing fields | Signing config import requires a real certificate thumbprint or subject, timestamp URL, and expected publisher; placeholders remain only in `scripts/code-signing.example.psd1`. |
| Signature verification | Release signing checks require `Get-AuthenticodeSignature`, `Valid` status, matching expected publisher, and a timestamp certificate before release staging can pass. |
| Release verifier | `scripts/verify-windows-installer.ps1 -ReleaseMode -ExpectedPublisher ...` rejects unsigned, Unknown, untrusted, wrong-publisher, and untimestamped artifacts while development verification remains explicit and warning-only for local unsigned builds. |
| Public docs cleanup | `README.md` no longer tells release users to bypass SmartScreen or run an unsigned unknown-publisher installer. |
| Regression tests | `tests/test_installer_release_verification.py`; implemented central gate in `tests/test_best_practice_audit_regressions.py`; updated packaging/ledger tests. |
| Verification summary | RED: `pytest tests/test_installer_release_verification.py -q` failed with 4 expected failures before implementation. GREEN: targeted release-signing/packaging/ledger/audit tests passed with 23 passed and 10 pending xfails. PowerShell verifier smoke: development mode returned 0 for an unsigned local dummy artifact; release mode returned non-zero and reported signature status, publisher, and timestamp failures. |
| Safety scope | No signing certificate, private key, token, password, live credential, or internal planning source artifact was committed. |

## Step 5 Release Manifest Checksums

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.1 generated checksums from final signed installer; CF-AUDIT-4.6 supply-chain release artifacts. |
| RED test | `pytest tests/test_release_manifest.py -q` failed with four expected failures before `scripts/generate-release-manifest.mjs`, post-signing manifest generation, and README manifest links existed. |
| Manifest generator | `scripts/generate-release-manifest.mjs` writes `release-manifest.json` and optional `release-manifest.md` with artifact name, version, size, SHA-256, signature status, signer, timestamp, and build commit. |
| Release build hook | `scripts/build-windows-installer.ps1 -ReleaseMode` verifies the signed staged installer with JSON output, then invokes the manifest generator using the final `dist/characterforgeai-installer.exe`. |
| Docs consumption | `README.md` links `release-manifest.json` and `release-manifest.md` and no longer carries a hand-maintained installer SHA-256. |
| Verification summary | RED: `pytest tests/test_release_manifest.py -q` failed with 4 expected failures before implementation. GREEN: `pytest tests/test_release_manifest.py -q` passed with 4 tests; release manifest smoke compared generated SHA-256 against `sha256sum`; targeted installer/packaging/ledger/audit tests passed; full `pytest -q` passed with 262 passed and 10 pending xfails. Commit is recorded in the final task summary. |
| Safety scope | No signing certificate, API key, token, password, live credential, live sensitive endpoint, generated release artifact, or internal planning source artifact was committed. |

## Step 6 Updater Honesty

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.2 / P0 updater false affordance. |
| Decision | Signed update infrastructure is not available in this build, so the honest state is to disable the updater UI rather than expose placeholder update controls. |
| RED tests | `npm test -- --run src/App.test.tsx` failed against the new updater honesty expectations while Settings still rendered Check for Updates / Update Now flows; `pytest tests/test_best_practice_audit_regressions.py -q` failed until the updater gate was implemented. |
| UI remediation | `apps/dashboard/src/App.tsx` now renders a Manual updates only panel, hides Check for Updates and Update Now, and explains users should download the signed installer from GitHub Releases and verify `release-manifest.json` / `release-manifest.md`. |
| Regression tests | `apps/dashboard/src/App.test.tsx` asserts normal UI hides update controls, ignores mocked update availability, does not surface update-check errors, and does not invoke updater commands from Settings. `tests/test_best_practice_audit_regressions.py` now has a passing updater real-or-disabled gate. |
| Deferred risk | The Rust updater commands remain safe stubs for backend compatibility tests, but they are not reachable from normal release UI. Full Tauri updater v2 remains deferred until signed manifests, pinned public key, endpoint config, and installer update flow exist. |
| Verification summary | RED: `npm test -- --run src/App.test.tsx` and `pytest tests/test_best_practice_audit_regressions.py -q` failed before implementation because Settings still exposed the placeholder updater affordance. GREEN: dashboard `npm run typecheck` passed; dashboard `npm test -- --run src/App.test.tsx` passed with 66 tests; Rust `cargo test` passed with 14 tests; targeted packaging/ledger/audit pytest passed with 20 passed and 9 pending xfails; full `pytest -q` passed with 263 passed and 9 pending xfails; `git diff --check` and changed-file secret/live endpoint scan passed. commit is recorded in the final task summary. |
| Safety scope | No updater endpoint, signing key, public/private key material, token, password, live credential, or internal planning source artifact was committed. |

## Step 7 Strict Production CSP

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-3.1 / P0 Tauri CSP disabled while privileged commands exist. |
| RED tests | `pytest tests/test_tauri_security_config.py tests/test_best_practice_audit_regressions.py -q` failed with three expected CSP failures while `apps/dashboard/src-tauri/tauri.conf.json` still had `csp: null`. |
| CSP remediation | `apps/dashboard/src-tauri/tauri.conf.json` now sets an explicit bundled-assets CSP: default/script/style/img/font are limited to self plus data for images/fonts, Tauri IPC is limited to `ipc:` and `http://ipc.localhost`, and object/base/frame/form surfaces are denied. |
| Regression tests | `tests/test_tauri_security_config.py` rejects null/empty CSP, unnecessary unsafe-inline or unsafe-eval for script/style, broad remote origins, live API Gateway endpoints, and credential-looking values. The central `CSP non-null` audit gate now points to that concrete test file. |
| Verification summary | RED: `pytest tests/test_tauri_security_config.py tests/test_best_practice_audit_regressions.py -q` failed with three expected CSP failures before implementation. GREEN: `pytest tests/test_tauri_security_config.py -q` passed with 3 tests; central audit regression passed with 3 implemented gates and 8 pending xfails; ledger and dashboard packaging pytest subsets passed; dashboard `npm run build` passed; `npm run tauri:build` completed a release Tauri build smoke successfully; full `pytest -q` passed with 267 passed and 8 pending xfails; `git diff --check` and changed-file secret/live endpoint/internal artifact scan passed. Commit is recorded in the final task summary. |
| Safety scope | No API key, token, password, live credential, live endpoint, updater endpoint, signing material, or internal planning source artifact was committed. |

## Step 8 Evidence

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-3.2 / P1 Tauri IPC command surface should be least-privileged while privileged local deployment commands exist. |
| RED tests | `pytest tests/test_tauri_ipc_permissions.py tests/test_best_practice_audit_regressions.py -q` failed before implementation because explicit Tauri capability/permission groups and native deployment confirmation sessions did not exist. |
| Capability groups | `apps/dashboard/src-tauri/build.rs` registers all dashboard commands through a Tauri app manifest, and `apps/dashboard/src-tauri/capabilities/` splits access into read-only, local-file, deployment-start, and deployment-end capabilities scoped to the `main` window. |
| Permission sets | `apps/dashboard/src-tauri/permissions/` defines narrow `allow-*` permission sets for each capability group instead of one broad dashboard IPC surface. Start and End permissions are separated. |
| Native command hardening | `start_deployment` and `end_deployment` retain typed confirmations and additionally require one-time native confirmation session tokens created by operation-specific session commands. Tokens are operation-specific, stack-specific, and consumed after validation. |
| Frontend handshake | The desktop deployment adapter requests `create_deployment_start_session` or `create_deployment_end_session` immediately before invoking the privileged Start/End command and passes only the returned confirmation token with the existing typed confirmation payload. |
| Regression tests | `tests/test_tauri_ipc_permissions.py` verifies explicit capability groups, command isolation, native deployment session validation, and local file command validation. The central audit regression file now points to this concrete coverage. |
| Verification summary | Targeted Python IPC/audit tests, dashboard adapter/App tests, and Tauri `cargo test` pass after implementation. Final full verification commands are recorded in the Step 8 task summary. |
| Safety scope | No API key, token, password, live credential, live endpoint, updater endpoint, signing material, or internal planning source artifact was committed. Test-only placeholders remain synthetic and redacted. |

## Step 9 Evidence

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.4 / P1 normal installer downgrades allowed, creating vulnerable rollback risk. |
| RED tests | `pytest tests/test_dashboard_tauri_packaging.py::test_tauri_release_installers_block_normal_downgrades -q` failed before implementation because the Windows bundle config did not set `allowDowngrades`. |
| Installer remediation | `apps/dashboard/src-tauri/tauri.conf.json` now sets `bundle.windows.allowDowngrades` to `false`, overriding Tauri's permissive default for Windows release installers. |
| Regression tests | `tests/test_dashboard_tauri_packaging.py` asserts release installer config blocks downgrades and rejects `AllowDowngrades`/`allow-downgrades` true values. The central audit regression file now has a passing `downgrades blocked` gate pointing to that coverage. |
| Verification summary | Targeted downgrade config/audit tests pass after implementation. Final Step 9 verification commands are recorded in the task summary. |
| Safety scope | No API key, token, password, live credential, live endpoint, updater endpoint, signing material, generated release artifact, or internal planning source artifact was committed. |

## Step 10 Prerequisite Helper Exit-Code Handling

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.3 / P1 prerequisite helper failures ignored by NSIS. |
| RED tests | `pytest tests/test_installer_prerequisite_installers.py::test_nsis_prerequisite_helpers_check_return_codes_and_fail_only_required_helpers -q` failed before implementation because helper return codes were not popped or inspected. Ledger/index RED tests also failed until this evidence and central gate were added. |
| NSIS helper handling | `characterforgeai.nsh` now pops `nsExec::ExecToLog` return codes for dependency validation, WebView2 Runtime, AWS CLI v2, AWS SAM CLI, and Docker Desktop guidance helpers. |
| Required failure behavior | WebView2 Runtime, AWS CLI v2, and AWS SAM CLI are recorded as required install helpers. A required prerequisite helper failed summary uses `MessageBox MB_ICONSTOP`, points to local logs, and aborts setup. |
| Optional warning behavior | Dependency validation and Docker Desktop guidance are recorded as optional helper warnings. An optional prerequisite helper warning summary uses `MessageBox MB_ICONEXCLAMATION` and lets setup continue. |
| Regression tests | `tests/test_installer_prerequisite_installers.py` asserts every prerequisite helper has a nearby `Pop $CFAI_PrerequisiteHelperExitCode` and summary handler; `tests/test_best_practice_audit_regressions.py` exposes a passing central gate. |
| Verification summary | Focused installer prerequisite tests and audit/ledger tests pass after implementation. Final verification commands are recorded in the Step 10 task summary. |
| Safety scope | No secrets, credential values, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 11 Prerequisite Installer Metadata Pinning

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.3 / P1 mutable elevated prerequisite downloads. |
| RED tests | `pytest tests/test_installer_prerequisite_installers.py::test_prerequisite_installer_scripts_use_pinned_versions_hashes_publishers_and_update_notes tests/test_installer_prerequisite_installers.py::test_prerequisite_installer_dry_run_outputs_json_and_logs_without_downloads -q` failed before implementation because helpers still used mutable latest/redirect URLs and lacked complete pinned metadata. |
| Pinned metadata | WebView2 Runtime, AWS CLI v2, and AWS SAM CLI helpers now carry a pinned version label, deterministic download URL, expected SHA-256, expected signer publisher, and an expected signer thumbprint field for future tighter pinning when certificate rotation is reviewed. |
| Installer verification | Each elevated helper verifies `Get-FileHash -Algorithm SHA256` before running the installer, then verifies Authenticode status and signer publisher through `SignerCertificate.Subject`. Mismatches fail the helper before elevation proceeds to installer execution. |
| Dry-run behavior | `-DryRun` still avoids downloads and execution while emitting the same pinned metadata fields in JSON so tests and release reviewers can audit the intended prerequisite source without network side effects. |
| Update procedure | Script comments require maintainers to choose an explicit upstream installer version, download it once, compute SHA-256, verify signer publisher/thumbprint where available, then update pinned metadata and dry-run tests together. |
| Regression tests | `tests/test_installer_prerequisite_installers.py` fails if URL, version, SHA-256, signer publisher, signer thumbprint field, hash verification, signature publisher verification, or update procedure notes are missing. The central audit regression index exposes a passing prerequisite installer metadata pinning gate. |
| Verification summary | Focused RED/GREEN tests, the full installer prerequisite suite, central audit regression tests, ledger tests, and full `pytest -q` pass after implementation. Final verification commands are recorded in the Step 11 task summary. |
| Safety scope | No secrets, credential values, API keys, live application endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 12 Installer Scope and Format Policy

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.4 / P1 per-machine conflict and duplicate MSI/NSIS release behavior. |
| RED tests | `pytest tests/test_dashboard_tauri_packaging.py::test_windows_release_installer_policy_is_current_user_nsis_only_and_documented tests/test_best_practice_audit_regressions.py::test_installer_scope_and_format_is_implemented tests/test_audit_remediation_ledger.py::test_step_12_evidence_records_installer_scope_and_format_policy -q` failed before implementation because release config still built both MSI and NSIS, used a machine-wide NSIS install mode, and lacked Step 12 evidence. |
| Release policy | CharacterForgeAI now uses an NSIS-only current-user Windows release installer. This keeps the custom dependency validation/install pages in the supported release path and avoids a separate MSI artifact with different behavior. |
| Installer config | `apps/dashboard/src-tauri/tauri.conf.json` targets only `nsis`, sets `bundle.windows.nsis.installMode` to `currentUser`, and keeps `allowDowngrades` disabled. |
| NSIS hooks | The hook comments and shortcut handling now align with current-user installation; machine-wide shell context is not forced by the custom hook. |
| Checklist alignment | The clean-machine checklist declares the NSIS-only current-user policy, instructs testers to run as a normal non-admin user, and continues to verify only local installer behavior without cloud deployment or credentials. |
| MSI release target removed | MSI is not a supported release artifact for this remediation because the NSIS flow carries the custom prerequisite UX and release staging already selects the NSIS `.exe`. |
| Regression tests | `tests/test_dashboard_tauri_packaging.py` verifies current-user NSIS-only config, no MSI bundle path in the release build script, aligned checklist text, and no machine-wide NSIS hook behavior. The central audit regression index exposes a passing installer scope and format gate. |
| Verification summary | Packaging, central audit regression, ledger tests, dashboard typecheck, and full Python suite pass after implementation. Final verification commands are recorded in the Step 12 task summary. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 13 Uninstall Local Data Cleanup

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.5 / P2 uninstall cleanup missed real app data paths. |
| RED tests | `pytest tests/test_dashboard_tauri_packaging.py::test_uninstaller_cleanup_targets_actual_appdata_paths_and_preserves_characters_by_default tests/test_best_practice_audit_regressions.py::test_uninstall_data_cleanup_is_opt_in_and_targets_real_appdata_paths tests/test_audit_remediation_ledger.py::test_step_13_evidence_records_uninstall_data_cleanup_policy -q` failed before implementation because the uninstaller did not target `%APPDATA%\CharacterForgeAI` config/cache or expose Step 13 evidence. |
| Data policy | Uninstall keeps local data by default. Users can opt in to remove config/cache under `%APPDATA%\CharacterForgeAI`; user-authored `characters` data is preserved by default. |
| Character data handling | The uninstall page clearly identifies the `characters` folder and tells users to export or copy character files before selecting character removal. Character removal is a separate opt-in checkbox. |
| Actual paths | Tests compare the NSIS cleanup targets with app code paths for `CharacterForgeAI/config.json` and `CharacterForgeAI/characters`, plus the installer-defined `cache` folder under the same app-data root. |
| Regression tests | `tests/test_dashboard_tauri_packaging.py` verifies the uninstaller page, default keep behavior, exact `%APPDATA%\CharacterForgeAI` cleanup paths, and no recursive removal of the whole app-data root. The central audit regression index exposes a passing uninstall data cleanup gate. |
| Verification summary | Packaging, central audit regression, ledger tests, generated uninstaller hook inspection, and full Python suite pass after implementation. Final verification commands are recorded in the Step 13 task summary. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |
## Step 14 SBOM and Provenance Artifacts

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-4.6 / P2 missing supply-chain SBOM and provenance artifacts. |
| RED tests | `pytest tests/test_release_sbom.py tests/test_best_practice_audit_regressions.py::test_supply_chain_sbom_and_provenance_artifacts_are_generated_for_release_builds -q` failed before implementation because `scripts/generate-sbom.mjs`, release SBOM attachment, and missing-artifact checks did not exist. Ledger evidence test also failed until this section was added. |
| SBOM generator | `scripts/generate-sbom.mjs` writes CycloneDX JSON for npm workspace dependencies, Rust/Tauri dependencies, and Python project dependencies using repository manifests that are already available in source control. |
| Release provenance | The generator writes `release-provenance.json` with build commit, generated timestamp, source manifests, and the required SBOM filenames so release reviewers can trace the evidence bundle. |
| Release attachment path | Release-mode installer builds call the generator after signed release manifest creation and place artifacts under `dist/release-sbom`: `characterforgeai-npm.cdx.json`, `characterforgeai-rust.cdx.json`, `characterforgeai-python.cdx.json`, and `release-provenance.json`. |
| Missing-artifact gate | `scripts/build-windows-installer.ps1` uses `Assert-ReleaseArtifact` after generation so release mode fails closed if any SBOM or provenance artifact is missing from the staged release evidence. |
| Regression tests | `tests/test_release_sbom.py` verifies generated CycloneDX content for npm, Rust, and Python components, release script ordering after manifest generation, and missing-artifact checks. The central audit regression index exposes a passing supply-chain artifacts gate. |
| Verification summary | `pytest tests/test_release_sbom.py -q`, central audit regression tests, ledger tests, local SBOM generator smoke, and full Python suite pass after implementation. Final verification commands are recorded in the Step 14 task summary. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |
## Step 15 Production Identity Model

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-1.1 / API key only is not sufficient authentication; CF-AUDIT-1.2 / broken object-level authorization risk; CF-AUDIT-1.3 / client secret handling conflicts with game deployment reality. |
| RED tests | `pytest tests/test_identity_model_documentation.py -q` failed before `docs/security/auth-model.md` existed. Ledger evidence test also failed until this section was added. |
| Identity model document | `docs/security/auth-model.md` defines `tenant_id`, `game_id`, `environment_id`, `user_id`, `service_principal_id`, `player_id`, roles, scopes, token types, local development behavior, migration impact, threat model, and acceptance criteria. |
| API-key boundary | API keys are metering only. Production authorization must come from normalized human or service principals; direct API-key use remains local-development only until replaced by JWT/service identity enforcement. |
| Route authorization matrix | The model maps each current character/session API route to required scopes and ownership checks using tenant/game/environment dimensions plus object identifiers. |
| Threat coverage | The threat model addresses OWASP API1/API2/API5 risks including leaked API keys, cross-tenant object access, public game client secret extraction, confused deputy behavior, and audit attribution gaps. |
| Migration notes | The plan calls for tenant/game/environment keys, backfill of existing records, JWT authorizer introduction before scope enforcement, backend proxy or dedicated-server game integration, and negative cross-tenant/cross-game tests before production fail-closed enforcement. |
| Regression tests | `tests/test_identity_model_documentation.py` verifies the public-safe identity model, route scope/ownership coverage, threat model, migration impact, and acceptance criteria. The central audit regression index exposes a passing identity model documented gate. |
| Verification summary | `pytest tests/test_identity_model_documentation.py -q`, central audit regression tests, ledger tests, and full Python suite pass after implementation. Final verification commands are recorded in the Step 15 task summary. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 16 Authorization Regression Tests

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-1.1 / API key only is not sufficient authentication; CF-AUDIT-1.2 / broken object-level authorization risk. |
| RED tests | `pytest tests/test_authorization.py -q` reported 6 xfailed tests against the pre-principal API-key-only/global-object implementation, making the missing auth enforcement visible before handler changes. |
| Auth failures covered | `tests/test_authorization.py` asserts unauthenticated requests and invalid bearer tokens must return 401, and read-only tokens must not create characters. |
| Object authorization covered | Tests assert a token from one tenant cannot read another tenant's cross-tenant character or cross-tenant session history. |
| Service scope covered | Tests assert service tokens are scoped by game/environment and cannot use a staging service principal against production character runtime writes. |
| Test-token boundary | Synthetic unsigned JWT-shaped tokens are used only for future test-mode handler validation; production validation must reject unsigned tokens unless a test-only mode explicitly enables them. |
| Central audit index | `tests/test_best_practice_audit_regressions.py` now points the `auth required` and `object auth` gates at the concrete authorization regression tests instead of placeholder failures. |
| Verification summary | `pytest tests/test_authorization.py -q` returned 0 xfailed after Step 21 made session history and runtime service-token scope enforcement pass; central audit regression tests, ledger tests, and full Python suite pass with remaining non-auth audit xfails visible. Final verification commands are recorded in the relevant task summaries. |
| Deferred risk | Remaining authorization work is outside the session/chat object-authorization scope of Step 21; non-auth audit gates remain tracked separately. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 17 JWT Authorizer Infrastructure

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-1.1 / API key only is not sufficient authentication. |
| RED tests | `pytest tests/test_api_authorizer_infrastructure.py tests/test_sam_template.py::test_sam_template_configures_lambda_environment_and_routes tests/test_openapi_api_key_security.py tests/test_audit_remediation_ledger.py::test_step_17_evidence_records_jwt_authorizer_infrastructure -q` failed before implementation because the template lacked authorizer parameters, the OpenAPI contract used API-key auth, and this evidence section was absent. |
| Authorizer infrastructure | `infra/template.yaml` now has `AuthorizationMode` with a clearly labeled `local` value for local development only and a `cognito` value for deployed edge JWT validation. |
| Configurable token settings | The template exposes non-secret `CognitoUserPoolArn`, `JwtIssuer`, and `JwtAudience` parameters for Cognito/OIDC/JWT deployment configuration and release evidence. |
| API Gateway behavior | `CharacterForgeApi` defines `CharacterForgeJwtAuthorizer` on the `Authorization` header as the default edge authorizer; `AuthorizationMode` labels Cognito deployment versus local development behavior, and API keys remain attached only to the usage plan for metering. |
| OpenAPI contract | `openapi.yaml` declares `BearerAuth` as the global identity scheme and keeps `ApiKeyMetering` documented as optional usage-plan metering only, not caller identity or authorization. |
| Verification summary | `pytest tests/test_api_authorizer_infrastructure.py -q`, `pytest tests/test_sam_template.py -q`, `pytest tests/test_openapi_api_key_security.py -q`, central audit regression tests, ledger tests, SAM/CloudFormation validation, and OpenAPI validation pass after implementation. Final verification commands are recorded in the Step 17 task summary. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |
## Step 18 Request Principal Extraction

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-1.1 / API key only is not sufficient authentication. |
| RED tests | `pytest tests/test_principal_extraction.py tests/test_best_practice_audit_regressions.py::test_auth_required_for_production_api_routes tests/test_audit_remediation_ledger.py::test_step_18_evidence_records_request_principal_extraction -q` failed before implementation because `src/characterforge/security/principal.py`, Lambda principal extraction, and this evidence section did not exist. |
| Principal model | `src/characterforge/security/principal.py` defines a typed `Principal` with normalized `tenant_id`, `game_id`, `environment_id`, `user_id`, `service_principal_id`, roles, scopes, subject, and local-dev test mode marker. |
| Claim extraction | `principal_from_event` reads API Gateway authorizer claims from HTTP API JWT and REST-style authorizer contexts, normalizes custom claim aliases, splits scope strings/lists, and accepts either human user or service principal identities. |
| Fail-closed behavior | Lambda requests missing required tenant/game/environment/user-or-service/scopes claims return 401 outside explicit local-dev test mode. The local-dev test mode uses synthetic local claims only when `CHARACTERFORGE_AUTH_LOCAL_DEV_MODE` is enabled. |
| Handler availability | `src/characterforge/app.py` extracts the Principal before routing and passes it as a keyword argument to character, chat, and session handlers so later scope and object authorization checks can use typed caller context. |
| Regression tests | `tests/test_principal_extraction.py` covers valid claims, service principal claims, missing tenant, missing scopes, malformed authorizer contexts, explicit local-dev test mode, production rejection, and typed principal propagation to handlers. |
| Verification summary | `pytest tests/test_principal_extraction.py -q`, authorization regression tests, central audit regression tests, ledger tests, and full Python suite pass after implementation. Final verification commands are recorded in the Step 18 task summary. |
| Deferred risk | Step 18 makes authenticated claims available and fails closed on missing claims; route-level scope checks and object ownership enforcement remain in later auth implementation steps. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 19 Ownership Metadata for Records

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-1.2 / broken object-level authorization risk. |
| RED tests | `pytest tests/test_character_store.py tests/test_session_store.py tests/test_best_practice_audit_regressions.py::test_object_auth_prevents_cross_character_or_session_access tests/test_audit_remediation_ledger.py::test_step_19_evidence_records_ownership_metadata_models -q` failed before models and stores carried ownership metadata. |
| Character records | `CharacterProfile` and `CharacterSummary` now carry `tenant_id`, `game_id`, `environment_id`, `created_by`, `updated_by`, `created_at`, and `updated_at`; create/update stores populate audit timestamps and attribution from the typed request Principal when available. |
| Session records | `MessageRecord` now carries `tenant_id`, `game_id`, `environment_id`, `created_by`, `updated_by`, `created_at`, and `updated_at`; player and assistant message stores persist ownership metadata from the request Principal. |
| Legacy migration behavior | Backward-compatible legacy dev data migration is explicit: pre-auth records missing ownership fields validate with `legacy-local-tenant`, `legacy-local-game`, `legacy-local`, and `legacy-dev-data` markers so dev data can still load while remaining auditable. |
| Regression tests | `tests/test_character_store.py` and `tests/test_session_store.py` cover ownership metadata persistence and legacy dev data backfill for character/session records; the central object-auth audit gate checks those concrete model/store tests. |
| Verification summary | `pytest tests/test_character_store.py tests/test_session_store.py -q`, DynamoDB store tests, central audit regression tests, ledger tests, and full Python suite pass after implementation. Final verification commands are recorded in the Step 19 task summary. |
| Deferred risk | Step 19 adds ownership dimensions and audit timestamps to records, but route-level scope checks and cross-tenant enforcement remain in later Step 20/21 handler authorization work. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 20 Character Authorization Enforcement

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-1.2 / broken object-level authorization risk for character APIs. |
| RED tests | `pytest tests/test_character_handlers.py tests/test_authorization.py::test_read_only_tokens_cannot_write_characters tests/test_authorization.py::test_one_tenant_cannot_read_another_tenants_character tests/test_best_practice_audit_regressions.py::test_object_auth_prevents_cross_character_or_session_access tests/test_audit_remediation_ledger.py::test_step_20_evidence_records_character_authorization_enforcement -q` failed before character handlers enforced scopes and ownership. |
| Scope enforcement | Character list/get require `characters:read`; create/update/delete require `characters:write`; missing operation scope returns `403 forbidden`. |
| Ownership enforcement | Character list filters to the caller tenant/game/environment, while get/update/delete compare persisted ownership fields against the request Principal tenant/game/environment before returning or mutating records. |
| Existence hiding | Cross-tenant, cross-game, or cross-environment character get/update/delete attempts return `404 not_found` so unauthorized callers cannot confirm object existence. |
| Regression tests | `tests/test_character_handlers.py` covers list/get/create/update/delete scope checks and ownership checks; `tests/test_authorization.py` now passes read-only character write and cross-tenant character read cases. |
| Verification summary | `pytest tests/test_authorization.py tests/test_character_handlers.py -q`, central audit regression tests, ledger tests, existing character tests, and the full Python suite pass after implementation. Final verification commands are recorded in the Step 20 task summary. |
| Deferred risk | Step 20 protects character routes only; chat/session object authorization remains deferred to the session/chat authorization step. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |

## Step 21 Chat and Session Authorization Enforcement

| Evidence Item | Result |
| --- | --- |
| Audit coverage | CF-AUDIT-1.2 / broken object-level authorization risk for chat state and session history. |
| RED tests | `pytest tests/test_chat_handler.py tests/test_session_handlers.py tests/test_authorization.py::test_one_tenant_cannot_read_another_tenants_session_history tests/test_authorization.py::test_service_tokens_are_scoped_by_game_and_environment_for_runtime_writes tests/test_best_practice_audit_regressions.py::test_object_auth_prevents_cross_character_or_session_access tests/test_audit_remediation_ledger.py::test_step_21_evidence_records_chat_session_authorization_enforcement -q` failed before chat/session handlers enforced scopes, ownership, and player/session constraints. |
| Scope enforcement | Chat requires `characters:read`, `sessions:read`, and `sessions:write`; session history reads require `sessions:read`; session clears require `sessions:write`; missing operation scope returns `403 forbidden`. |
| Ownership enforcement | Chat only uses characters and existing session history whose persisted ownership fields match the caller tenant/game/environment; session history and clears hide records outside the caller tenant/game/environment. |
| Player/session constraints | User-principal chat requests require the payload `player_id` to match the caller identity, and existing session messages must match the requested `character_id` and `player_id` before new chat state is appended. |
| Existence hiding | Cross-tenant, cross-game, cross-environment, or wrong-player session history/chat state attempts return `404 not_found` so unauthorized callers cannot confirm session existence. |
| Regression tests | `tests/test_chat_handler.py`, `tests/test_session_handlers.py`, and `tests/test_authorization.py` cover chat character ownership, session history ownership, runtime service-token game/environment scoping, `player_id` constraints, and read/write scope checks. |
| Verification summary | `pytest tests/test_chat_handler.py tests/test_session_handlers.py tests/test_authorization.py -q`, central audit regression tests, ledger tests, and full Python suite pass after implementation. Final verification commands are recorded in the Step 21 task summary. |
| Safety scope | No secrets, credential values, API keys, live endpoints, generated release artifacts, or internal planning source artifacts were committed. |
