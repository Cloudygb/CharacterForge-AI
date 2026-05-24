from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LEDGER_PATH = REPO_ROOT / "documents" / "plans" / "best-practice-audit-remediation-ledger.md"
REGRESSION_INDEX_PATH = REPO_ROOT / "tests" / "test_best_practice_audit_regressions.py"

EXPECTED_AUDIT_GATES = [
    "auth required",
    "object auth",
    "no wildcard production CORS",
    "CSP non-null",
    "installer signing required",
    "updater real-or-disabled",
    "typed Start/End confirmation",
    "downgrades blocked",
    "prerequisite helper exit-code handling",
    "prerequisite installer metadata pinning",
    "installer scope and format",
    "uninstall data cleanup",
    "supply-chain artifacts",
    "identity model documented",
    "OpenAPI auth responses",
    "no API key persistence",
    "docs direct-key warning",
    "context naming consistency",
]

EXPECTED_FINDINGS = [
    ("1.1", "P0", "API key only is not sufficient authentication"),
    ("1.2", "P0", "Broken object-level authorization risk"),
    ("1.3", "P0", "Client secret handling conflicts with game deployment reality"),
    ("1.4", "P0/P1", "Wildcard CORS is too permissive"),
    ("1.5", "P1", "Input and resource limits are not strong enough"),
    ("1.6", "P1", "LLM prompt-injection and action execution controls are incomplete"),
    ("1.7", "P2/P1", "Error responses may leak too much detail"),
    ("2.1", "P1", "IAM is broader than the selected model"),
    ("2.2", "P1/P2", "Missing preventive/detective production controls"),
    ("2.3", "P1", "Stack automation should emphasize safe reversibility"),
    ("3.1", "P0", "CSP is disabled while privileged commands exist"),
    ("3.2", "P1", "IPC command surface should be least-privileged"),
    ("3.3", "P1", "Local deployment process trusts PATH and environment overrides"),
    ("4.1", "P0", "Unsigned installer is release-blocking"),
    ("4.2", "P0", "Updater UI exists without secure updater implementation"),
    ("4.3", "P1", "Prerequisite installers need stronger pinning and failure handling"),
    ("4.4", "P1", "Installer scope, downgrade, and MSI/NSIS strategy need cleanup"),
    ("4.5", "P2", "Uninstall cleanup misses real app data paths"),
    ("4.6", "P2", "Supply-chain artifacts are missing"),
    ("5.1", "P0/P1", "First-run flow is too text-heavy"),
    ("5.2", "P1", "Deployment page mixes too many workflows"),
    ("5.3", "P0", "Destructive Start/End needs typed confirmation"),
    ("5.4", "P1", "Character editor is too advanced too soon"),
    ("5.5", "P1", "Chat should work before AWS"),
    ("5.6", "P1", "Settings is really Updates"),
    ("5.7", "P1/P2", "Accessibility gaps"),
    ("5.8", "P2", "Developer efficiency features are missing"),
    ("6.1", "P1/P2", "Persistence model needs clearer UX"),
    ("6.2", "P2", "Local data deserves first-class management"),
    ("7.1", "P0", "No actual engine plugin exists"),
    ("7.2", "P0", "The secure production integration path is missing"),
    ("7.3", "P0/P1", "SDK lacks game-ready runtime resilience"),
    ("7.4", "P1", "Action contract is too loose for game execution"),
    ("7.5", "P1", "No event/game-state ingestion model"),
    ("7.6", "P1", "Docs inconsistency: `game_context` vs `context`"),
    ("7.7", "P2/P1", "No runnable sample game"),
    ("8.1", "P1", "OpenAPI should document auth and rate-limit behavior"),
    ("8.2", "P1", "SDK is too loosely typed"),
    ("9.1", "P2/P1", "Local automated tests are strong but CI is missing"),
]

REQUIRED_COLUMNS = [
    "Task ID",
    "Audit Finding",
    "Severity",
    "Status",
    "PR/Commit",
    "Tests",
    "Verification Evidence",
]

FORBIDDEN_LEDGER_PATTERNS = [
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----"),
    re.compile(r"https://[a-z0-9]{6,}\.execute-api\.[a-z0-9-]+\.amazonaws\.com", re.IGNORECASE),
    re.compile(r"cf_live_[A-Za-z0-9_=-]+"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*[A-Za-z0-9_./+=-]{24,}"),
]


def test_audit_remediation_ledger_tracks_every_p0_p1_p2_finding() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    for column in REQUIRED_COLUMNS:
        assert column in content

    missing: list[str] = []
    for finding_id, severity, title in EXPECTED_FINDINGS:
        row_pattern = re.compile(
            rf"\|\s*CF-AUDIT-{re.escape(finding_id)}\s*\|[^\n]*{re.escape(finding_id)}[^\n]*{re.escape(title)}[^\n]*{re.escape(severity)}[^\n]*\|",
            re.IGNORECASE,
        )
        if not row_pattern.search(content):
            missing.append(f"{finding_id} {severity} {title}")

    assert missing == []


def test_audit_remediation_ledger_records_step_2_verification_baseline() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 2 Baseline Verification Snapshot" in content
    required_commands = [
        "pytest -q",
        "npm run typecheck",
        "npm test -- --run",
        "npm run build",
        "cargo fmt --check",
        "cargo test",
        "cargo check",
        "npm test",
    ]
    for command in required_commands:
        assert command in content

    assert "Duration" in content
    assert "Result" in content
    assert "Failure Summary" in content
    assert "Installer verification" in content


def test_best_practice_audit_regression_index_lists_all_major_audit_gates() -> None:
    assert REGRESSION_INDEX_PATH.exists(), (
        f"Missing audit regression index at {REGRESSION_INDEX_PATH.relative_to(REPO_ROOT)}"
    )
    content = REGRESSION_INDEX_PATH.read_text(encoding="utf-8")

    for gate in EXPECTED_AUDIT_GATES:
        assert gate in content

    implemented_gate_count = 13  # CSP non-null; auth/object authorization regression tests; IPC least privilege; installer signing required; updater real-or-disabled; downgrades blocked; prerequisite helper exit-code handling; prerequisite installer metadata pinning; installer scope and format; uninstall data cleanup; supply-chain artifacts; identity model documented
    pending_or_implemented = content.count("@pytest.mark.xfail") + content.count("@pytest.mark.skip")
    assert pending_or_implemented >= len(EXPECTED_AUDIT_GATES) - implemented_gate_count
    assert "test_installer_release_verification.py" in content
    assert "keeps updater controls hidden" in content
    assert "Audit gate pending remediation" in content


def test_step_10_evidence_records_prerequisite_helper_exit_code_handling() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 10 Prerequisite Helper Exit-Code Handling" in content
    assert "CF-AUDIT-4.3" in content
    assert "required prerequisite helper failed" in content
    assert "optional prerequisite helper warning" in content
    assert "pytest tests/test_installer_prerequisite_installers.py -q" in content
    assert "No secrets" in content


def test_step_11_evidence_records_prerequisite_installer_metadata_pinning() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 11 Prerequisite Installer Metadata Pinning" in content
    assert "CF-AUDIT-4.3" in content
    assert "pinned version" in content
    assert "expected SHA-256" in content
    assert "expected signer publisher" in content
    assert "Update procedure" in content
    assert "pytest tests/test_installer_prerequisite_installers.py -q" in content
    assert "No secrets" in content


def test_step_12_evidence_records_installer_scope_and_format_policy() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 12 Installer Scope and Format Policy" in content
    assert "CF-AUDIT-4.4" in content
    assert "current-user" in content
    assert "NSIS-only" in content
    assert "MSI release target removed" in content
    assert "clean-machine checklist" in content
    assert "pytest tests/test_dashboard_tauri_packaging.py -q" in content
    assert "No secrets" in content


def test_step_13_evidence_records_uninstall_data_cleanup_policy() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 13 Uninstall Local Data Cleanup" in content
    assert "CF-AUDIT-4.5" in content
    assert "%APPDATA%\\CharacterForgeAI" in content
    assert "config/cache" in content
    assert "characters" in content
    assert "preserved by default" in content
    assert "export or copy" in content
    assert "pytest tests/test_dashboard_tauri_packaging.py -q" in content
    assert "No secrets" in content


def test_step_14_evidence_records_sbom_and_provenance_artifacts() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 14 SBOM and Provenance Artifacts" in content
    assert "CF-AUDIT-4.6" in content
    assert "CycloneDX" in content
    assert "npm" in content
    assert "Rust" in content
    assert "Python" in content
    assert "release-provenance.json" in content
    assert "release-sbom" in content
    assert "pytest tests/test_release_sbom.py -q" in content
    assert "No secrets" in content


def test_step_15_evidence_records_production_identity_model() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 15 Production Identity Model" in content
    assert "CF-AUDIT-1.1" in content
    assert "CF-AUDIT-1.2" in content
    assert "CF-AUDIT-1.3" in content
    assert "docs/security/auth-model.md" in content
    assert "tenant_id" in content
    assert "game_id" in content
    assert "environment_id" in content
    assert "service_principal_id" in content
    assert "API keys are metering only" in content
    assert "OWASP API1/API2/API5" in content
    assert "pytest tests/test_identity_model_documentation.py -q" in content
    assert "No secrets" in content


def test_step_16_evidence_records_authorization_regression_tests() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 16 Authorization Regression Tests" in content
    assert "CF-AUDIT-1.1" in content
    assert "CF-AUDIT-1.2" in content
    assert "tests/test_authorization.py" in content
    assert "unauthenticated requests" in content
    assert "invalid bearer tokens" in content
    assert "read-only tokens" in content
    assert "cross-tenant character" in content
    assert "cross-tenant session" in content
    assert "service tokens" in content
    assert "game/environment" in content
    assert "pytest tests/test_authorization.py -q" in content
    assert "4 xfailed" in content
    assert "No secrets" in content


def test_step_17_evidence_records_jwt_authorizer_infrastructure() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 17 JWT Authorizer Infrastructure" in content
    assert "CF-AUDIT-1.1" in content
    assert "infra/template.yaml" in content
    assert "openapi.yaml" in content
    assert "AuthorizationMode" in content
    assert "local development only" in content
    assert "CognitoUserPoolArn" in content
    assert "JwtIssuer" in content
    assert "JwtAudience" in content
    assert "BearerAuth" in content
    assert "API keys" in content
    assert "metering only" in content
    assert "pytest tests/test_api_authorizer_infrastructure.py -q" in content
    assert "SAM/CloudFormation validation" in content
    assert "OpenAPI validation" in content
    assert "No secrets" in content


def test_step_18_evidence_records_request_principal_extraction() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 18 Request Principal Extraction" in content
    assert "CF-AUDIT-1.1" in content
    assert "src/characterforge/security/principal.py" in content
    assert "tests/test_principal_extraction.py" in content
    assert "Principal" in content
    assert "tenant_id" in content
    assert "game_id" in content
    assert "environment_id" in content
    assert "user_id" in content
    assert "service_principal_id" in content
    assert "scopes" in content
    assert "local-dev test mode" in content
    assert "pytest tests/test_principal_extraction.py -q" in content
    assert "No secrets" in content


def test_step_19_evidence_records_ownership_metadata_models() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    assert "## Step 19 Ownership Metadata for Records" in content
    assert "CF-AUDIT-1.2" in content
    assert "tenant_id" in content
    assert "game_id" in content
    assert "environment_id" in content
    assert "created_by" in content
    assert "updated_by" in content
    assert "audit timestamps" in content
    assert "legacy dev data" in content
    assert "pytest tests/test_character_store.py tests/test_session_store.py -q" in content
    assert "No secrets" in content


def test_audit_remediation_ledger_does_not_commit_source_audit_or_secrets() -> None:
    assert LEDGER_PATH.exists(), f"Missing audit remediation ledger at {LEDGER_PATH.relative_to(REPO_ROOT)}"
    content = LEDGER_PATH.read_text(encoding="utf-8")

    forbidden_internal_artifact_markers = [
        "Best_Practice_Audit" + "_Implementation_Guide",
        "Best_Practice_Audit" + "_2026",
        "." + "pdf",
    ]
    for marker in forbidden_internal_artifact_markers:
        assert marker not in content

    failures: list[str] = []
    for pattern in FORBIDDEN_LEDGER_PATTERNS:
        if match := pattern.search(content):
            line_number = content.count("\n", 0, match.start()) + 1
            failures.append(f"line {line_number} matched {pattern.pattern}")

    assert failures == []
