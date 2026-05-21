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
    assert package["scripts"]["desktop:release-installer"] == "npm run desktop:build && npm run desktop:stage-installer"
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
    assert config["bundle"]["windows"]["nsis"]["installMode"] == "both"
    assert config["bundle"]["windows"]["nsis"]["startMenuFolder"] == "CharacterForgeAI"


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
    assert "sam " not in normalized
    assert "aws " not in normalized
    assert "cloudformation" not in normalized
