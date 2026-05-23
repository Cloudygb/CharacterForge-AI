# Best-Practice Audit Remediation Ledger

This ledger tracks remediation evidence for the internal CharacterForge AI best-practice audit dated 2026-05-23. It is intentionally stored outside public docs and should not include the original audit report, guide artifacts, secrets, live endpoints, credential values, screenshots with sensitive details, or local machine credentials.

## Branch

- Remediation branch: `best-practice-audit-remediation`
- Ledger status values: `Planned`, `In progress`, `Implemented`, `Deferred`, `Accepted risk`
- Each finding must keep its row updated with the commit or PR, tests run, and verification evidence before it can be considered closed.

## Findings

| Task ID | Audit Finding | Severity | Status | PR/Commit | Tests | Verification Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| CF-AUDIT-1.1 | 1.1 API key only is not sufficient authentication | P0 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.2 | 1.2 Broken object-level authorization risk | P0 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.3 | 1.3 Client secret handling conflicts with game deployment reality | P0 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.4 | 1.4 Wildcard CORS is too permissive | P0/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.5 | 1.5 Input and resource limits are not strong enough | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.6 | 1.6 LLM prompt-injection and action execution controls are incomplete | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-1.7 | 1.7 Error responses may leak too much detail | P2/P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-2.1 | 2.1 IAM is broader than the selected model | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-2.2 | 2.2 Missing preventive/detective production controls | P1/P2 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-2.3 | 2.3 Stack automation should emphasize safe reversibility | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-3.1 | 3.1 CSP is disabled while privileged commands exist | P0 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-3.2 | 3.2 IPC command surface should be least-privileged | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-3.3 | 3.3 Local deployment process trusts PATH and environment overrides | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-4.1 | 4.1 Unsigned installer is release-blocking | P0 | Implemented | Step 4 commit `a88764c`; Step 5 commit recorded in final task summary | `pytest tests/test_installer_release_verification.py -q`; `pytest tests/test_release_manifest.py -q`; `pytest tests/test_best_practice_audit_regressions.py -q`; PowerShell dev/release verifier smoke checks | Release-mode build requires signing config, certificate, timestamp URL, expected publisher, Authenticode verification, signed installer verification, and generated checksums from the final signed installer; public SmartScreen bypass guidance removed. |
| CF-AUDIT-4.2 | 4.2 Updater UI exists without secure updater implementation | P0 | Implemented | Step 6 commit recorded in final task summary | `npm test -- --run src/App.test.tsx`; `cargo test`; `pytest tests/test_best_practice_audit_regressions.py -q`; `pytest tests/test_dashboard_tauri_packaging.py -q` | Normal release UI hides Check for Updates and Update Now, explains updates are manual for this build, and points users to signed GitHub Releases plus generated release manifest verification until signed updater infrastructure exists. |
| CF-AUDIT-4.3 | 4.3 Prerequisite installers need stronger pinning and failure handling | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-4.4 | 4.4 Installer scope, downgrade, and MSI/NSIS strategy need cleanup | P1 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-4.5 | 4.5 Uninstall cleanup misses real app data paths | P2 | Planned | Pending | Pending targeted regression and existing suite coverage | Pending implementation evidence |
| CF-AUDIT-4.6 | 4.6 Supply-chain artifacts are missing | P2 | Implemented | Step 5 commit recorded in final task summary | `pytest tests/test_release_manifest.py -q`; manifest/sha256 smoke comparison; full suite | Release manifest generator writes artifact name, version, size, SHA-256, signature status, signer, timestamp, and build commit from final staged artifacts after signing; README links generated manifest files instead of hand-maintained hashes. |
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
