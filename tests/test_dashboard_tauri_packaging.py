import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "apps" / "dashboard"
TAURI = DASHBOARD / "src-tauri"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_dashboard_package_exposes_web_and_tauri_commands() -> None:
    package = read_json(DASHBOARD / "package.json")

    assert package["scripts"]["dev"] == "vite --host 0.0.0.0"
    assert package["scripts"]["build"] == "tsc -b && vite build"
    assert package["scripts"]["tauri:dev"] == "tauri dev"
    assert package["scripts"]["tauri:build"] == "tauri build"
    assert package["scripts"]["desktop:dev"] == "npm run tauri:dev"
    assert package["scripts"]["desktop:build"] == "npm run tauri:build"
    assert package["scripts"]["desktop:stage-installer"] == "node scripts/stage-windows-installer.mjs"
    assert package["scripts"]["desktop:release-installer"] == "powershell -NoProfile -ExecutionPolicy Bypass -File ../../scripts/build-windows-installer.ps1 -ReleaseMode -SignArtifacts"
    assert package["devDependencies"]["@tauri-apps/cli"].startswith("^2.")


def test_tauri_config_packages_existing_dashboard_build() -> None:
    config = read_json(TAURI / "tauri.conf.json")

    assert config["productName"] == "CharacterForgeAI"
    assert config["mainBinaryName"] == "CharacterForgeAI"
    assert config["identifier"] == "com.cloudygb.characterforgeai"
    assert config["build"]["frontendDist"] == "../dist"
    assert config["build"]["beforeBuildCommand"] == "npm run build"
    assert config["build"]["beforeDevCommand"] == "npm run dev"
    assert config["build"]["devUrl"] == "http://localhost:5173"
    assert "msi" in config["bundle"]["targets"]
    assert "nsis" in config["bundle"]["targets"]
    assert config["bundle"]["licenseFile"] == "../../../LICENSE"
    assert "icons/icon.ico" in config["bundle"]["icon"]
    assert "icons/icon.png" in config["bundle"]["icon"]
    resources = config["bundle"]["resources"]
    assert resources["../../../infra"] == "deployment/infra"
    assert resources["../../../src/characterforge"] == "deployment/src/characterforge"
    assert resources["../../../src/requirements.txt"] == "deployment/src/requirements.txt"
    assert resources["../../../pyproject.toml"] == "deployment/pyproject.toml"
    assert resources["../../../schemas"] == "deployment/schemas"
    assert resources["../../../LICENSE"] == "deployment/LICENSE"
    nsis = config["bundle"]["windows"]["nsis"]
    assert nsis["installMode"] == "perMachine"
    assert nsis["startMenuFolder"] == "CharacterForgeAI"
    assert nsis["installerHooks"] == "installer/characterforgeai.nsh"


def test_tauri_windows_icon_exists_for_release_builds() -> None:
    assert (TAURI / "icons" / "icon.ico").is_file()


def test_tauri_updater_is_not_enabled_before_signed_release_requirements_are_ready() -> None:
    config = read_json(TAURI / "tauri.conf.json")
    cargo_toml = (TAURI / "Cargo.toml").read_text(encoding="utf-8").lower()
    package = read_json(DASHBOARD / "package.json")

    assert "plugins" not in config or "updater" not in config.get("plugins", {})
    assert "updater" not in config
    assert "tauri-plugin-updater" not in cargo_toml
    assert "@tauri-apps/plugin-updater" not in package.get("dependencies", {})
    assert "@tauri-apps/plugin-updater" not in package.get("devDependencies", {})


def test_tauri_update_commands_are_safe_stubs_until_real_updater_plumbing_exists() -> None:
    rust_shell = (TAURI / "src" / "lib.rs").read_text(encoding="utf-8")
    normalized = rust_shell.lower()

    assert "fn check_for_updates() -> updatecheckresult" in normalized
    assert "available: false" in normalized
    assert "fn install_update() -> result<(), string>" in normalized
    assert "signed updater plumbing is not configured yet" in normalized
    assert "check_for_updates," in normalized
    assert "install_update," in normalized


def test_custom_nsis_installer_hook_is_user_friendly_and_safe() -> None:
    hook_path = TAURI / "installer" / "characterforgeai.nsh"
    hook = hook_path.read_text(encoding="utf-8")
    normalized = hook.lower()

    assert "nsis_hook_preinstall" in normalized
    assert "nsis_hook_postinstall" in normalized
    assert "welcome to characterforgeai" in normalized
    assert "choose where characterforgeai is installed" in normalized
    assert "check your computer for required tools" in normalized
    assert "install missing tools" in normalized
    assert "webview2" in normalized
    assert "aws cli v2" in normalized
    assert "aws sam cli" in normalized
    assert "docker desktop" in normalized
    assert "desktop shortcut" in normalized
    assert "start menu" in normalized
    assert "launch characterforgeai" in normalized
    assert "requestexecutionlevel admin" in normalized
    assert "setshellvarcontext all" in normalized
    assert "install-webview2-runtime.ps1" in normalized
    assert "install-aws-cli-v2.ps1" in normalized
    assert "install-aws-sam-cli.ps1" in normalized
    assert "show-docker-guidance.ps1" in normalized
    assert "detect-dependencies.ps1" in normalized
    assert "${__filedir__}\\detect-dependencies.ps1" in normalized
    assert "cfai_ensuredefaultchoices" in normalized
    assert "silent installs skip custom pages" in normalized

    forbidden = [
        "aws configure",
        "sam deploy",
        "aws cloudformation",
        "password",
        "secret_access_key",
        "session_token",
        "access_key",
    ]
    for term in forbidden:
        assert term not in normalized


def test_custom_nsis_installer_hook_defines_the_intended_page_flow() -> None:
    hook = (TAURI / "installer" / "characterforgeai.nsh").read_text(encoding="utf-8")
    normalized = hook.lower()

    expected_order = [
        "page custom cfai_createwelcomepage",
        "licensedata \"license_file\"",
        "page license",
        "page custom cfai_createdependencyvalidationpage cfai_leavedependencyvalidationpage",
        "page custom cfai_createdependencyinstallpage cfai_leavedependencyinstallpage",
        "page directory",
        "page custom cfai_createshortcutoptionspage cfai_leaveshortcutoptionspage",
        "page instfiles",
        "page custom cfai_createfinishpage cfai_leavefinishpage",
    ]
    cursor = -1
    for snippet in expected_order:
        next_position = normalized.find(snippet)
        assert next_position > cursor, f"missing or out of order NSIS page snippet: {snippet}"
        cursor = next_position

    required_controls = [
        "nsd_createcheckbox",
        "$cfai_dependencyvalidationcheckbox",
        "$cfai_dependencyinstallcheckbox",
        "$cfai_desktopshortcutcheckbox",
        "$cfai_startmenushortcutcheckbox",
        "$cfai_launchnowcheckbox",
        "run dependency validation now",
        "install missing tools now",
        "desktop shortcut",
        "start menu shortcut",
        "launch characterforgeai now",
    ]
    for snippet in required_controls:
        assert snippet in normalized

    assert "messagebox mb_yesno" not in normalized
    assert "messagebox mb_ok" not in normalized
    assert "quit" in normalized
    assert "execshell \"open\" \"$instdir\\${cfai_exe_name}\"" in normalized


def test_tauri_bundles_deployment_resources_for_packaged_start_end_flows() -> None:
    config = read_json(TAURI / "tauri.conf.json")
    resources = config["bundle"]["resources"]
    required_targets = {
        "deployment/infra/template.yaml": ROOT / "infra" / "template.yaml",
        "deployment/src/characterforge/app.py": ROOT / "src" / "characterforge" / "app.py",
        "deployment/src/requirements.txt": ROOT / "src" / "requirements.txt",
        "deployment/pyproject.toml": ROOT / "pyproject.toml",
        "deployment/schemas/character-pack.schema.json": ROOT / "schemas" / "character-pack.schema.json",
        "deployment/schemas/game-binding.schema.json": ROOT / "schemas" / "game-binding.schema.json",
        "deployment/LICENSE": ROOT / "LICENSE",
    }

    for source in resources:
        assert (TAURI / source).resolve().exists(), f"missing bundle source: {source}"

    bundled_destinations = set(resources.values())
    for target, repo_path in required_targets.items():
        assert repo_path.exists(), f"missing repo deployment resource for {target}: {repo_path}"
        assert any(
            target == destination or target.startswith(f"{destination}/")
            for destination in bundled_destinations
        ), f"{target} is not covered by the Tauri resource bundle"


def test_tauri_rust_shell_guards_real_deployment_actions() -> None:
    cargo_toml = (TAURI / "Cargo.toml").read_text(encoding="utf-8")
    main_rs = (TAURI / "src" / "main.rs").read_text(encoding="utf-8")
    lib_rs = (TAURI / "src" / "lib.rs").read_text(encoding="utf-8")
    combined = "\n".join([cargo_toml, main_rs, lib_rs]).lower()

    assert "tauri" in cargo_toml
    assert "run()" in main_rs
    assert "generate_context" in lib_rs
    assert "preview_deployment_start" in lib_rs
    assert "start_deployment" in lib_rs
    assert "sam deploy" in combined
    assert "cloudformation" in combined
    assert "start {}" in lib_rs.lower()
    assert "confirmation_text" in lib_rs
    assert "<redacted>" in lib_rs
    assert "DeploymentResourcePaths" in lib_rs
    assert "resolve_deployment_resources" in lib_rs
    assert "CHARACTERFORGEAI_RESOURCE_DIR" in lib_rs
    assert "deployment/infra/template.yaml" in lib_rs
    assert "deployment/src/requirements.txt" in lib_rs
    assert "deployment/schemas/character-pack.schema.json" in lib_rs
    assert "deployment/LICENSE" in lib_rs
    assert "current_dir" in lib_rs
    assert "bedrockruntime" not in combined
    assert "aws secret" not in combined


def test_dashboard_docs_explain_windows_installer_without_live_deployment() -> None:
    readme = (DASHBOARD / "README.md").read_text(encoding="utf-8").lower()

    assert "desktop app" in readme
    assert "npm run desktop:dev" in readme
    assert "npm run desktop:build" in readme
    assert "windows installer" in readme
    assert "characterforgeai-installer.exe" in readme
    assert "characterforgeai.exe" in readme
    assert "src-tauri/target/release/bundle" in readme
    assert "does not deploy aws resources" in readme


def test_windows_installer_build_script_runs_local_checks_and_stages_nsis_artifact() -> None:
    script_path = ROOT / "scripts" / "build-windows-installer.ps1"
    script = script_path.read_text(encoding="utf-8")
    normalized = script.lower()

    assert "#requires -version 5.1" in normalized
    assert "$iswindows" in normalized
    assert "assert-command" in normalized
    for command in ["node", "npm", "cargo", "rustc"]:
        assert f'assert-command "{command}"' in normalized
    assert "npm ci" in normalized
    assert "npm run typecheck" in normalized
    assert "npm test -- --run" in normalized
    assert "npm run build" in normalized
    assert "npm run desktop:build" in normalized
    assert "target\\release\\bundle\\nsis" in normalized
    assert "characterforgeai-installer.exe" in normalized
    assert "copy-item" in normalized
    assert "signartifacts" in normalized
    assert "signingconfigpath" in normalized
    assert "invoke-code-signing" in normalized
    assert "signtool" in normalized
    assert "characterforgeai.exe" in normalized
    assert "characterforgeai-installer.exe" in normalized
    assert "get-authenticodesignature" in normalized
    assert "timestampurl" in normalized
    assert "sam " not in normalized
    assert "aws " not in normalized
    assert "cloudformation" not in normalized


def test_windows_installer_signing_placeholder_config_is_safe() -> None:
    config_path = ROOT / "scripts" / "code-signing.example.psd1"
    config = config_path.read_text(encoding="utf-8")
    normalized = config.lower()

    assert "certificatethumbprint" in normalized
    assert "<certificate-thumbprint>" in normalized
    assert "certificatesubject" in normalized
    assert "timestampurl" in normalized
    assert "signtoolpath" in normalized
    assert "characterforgeai.exe" in normalized
    assert "characterforgeai-installer.exe" in normalized

    forbidden = [
        ".pfx",
        "password",
        "token",
        "privatekey",
        "private key",
        "client_secret",
        "access_key",
        "session_token",
    ]
    for term in forbidden:
        assert term not in normalized


def test_windows_installer_verification_script_checks_staged_and_installed_artifacts() -> None:
    script_path = ROOT / "scripts" / "verify-windows-installer.ps1"
    script = script_path.read_text(encoding="utf-8")
    normalized = script.lower()

    assert "#requires -version 5.1" in normalized
    assert "dist\\characterforgeai-installer.exe" in normalized
    assert "characterforgeai-installer.exe" in normalized
    assert "expectedminsizemb" in normalized
    assert "tauri nsis installers do not bundle webview2" in normalized
    assert "valid lightweight release candidate" in normalized
    assert "get-authenticodesignature" in normalized
    assert "signature status" in normalized
    assert "characterforgeai.exe" in normalized
    assert "appdata" in normalized
    assert "programfiles" in normalized
    assert "start menu" in normalized
    assert "desktop shortcut" in normalized
    assert "skipinstalledartifacts" in normalized
    assert "convertto-json" in normalized

    forbidden = [
        "sam deploy",
        "aws cloudformation",
        "aws configure",
        "docker run",
        "secret_access_key",
        "session_token",
        "access_key",
    ]
    for term in forbidden:
        assert term not in normalized


def test_clean_machine_installer_checklist_stays_out_of_public_docs() -> None:
    checklist_path = ROOT / "scripts" / "windows-installer-clean-machine-checklist.md"
    checklist = checklist_path.read_text(encoding="utf-8")
    normalized = checklist.lower()

    assert checklist_path.exists()
    assert not (ROOT / "docs" / "windows-installer-clean-machine-checklist.md").exists()
    assert "clean-machine windows installer verification checklist" in normalized
    assert "scripts/verify-windows-installer.ps1" in normalized
    assert "dist/characterforgeai-installer.exe" in normalized
    assert "characterforgeai.exe" in normalized
    assert "signature status" in normalized
    assert "start menu" in normalized
    assert "desktop shortcut" in normalized
    assert "do not run sam deploy" in normalized
    assert "do not run aws cloudformation" in normalized
