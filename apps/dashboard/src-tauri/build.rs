const APP_COMMANDS: &[&str] = &[
    "get_app_config",
    "save_app_config",
    "get_character_folder",
    "open_character_folder",
    "scan_character_folder",
    "save_character_pack_export",
    "save_character_file",
    "delete_character_file",
    "check_for_updates",
    "install_update",
    "check_setup_readiness",
    "check_aws_setup_wizard",
    "preview_deployment_start",
    "create_deployment_start_session",
    "start_deployment",
    "create_deployment_end_session",
    "end_deployment",
];

fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(APP_COMMANDS);
    let attributes = tauri_build::Attributes::new().app_manifest(app_manifest);
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}
