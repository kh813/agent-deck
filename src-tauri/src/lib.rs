mod pty;
mod agent;
mod config;
mod menu;
mod self_update;
mod cert;
pub mod web_server;

use pty::PtyState;
use web_server::WebServerHub;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_state = PtyState::default();

    // Resolve dist directory (static assets for Web UI)
    let dist_dir = if let Ok(exe_path) = std::env::current_exe() {
        let root = pty::resolve_project_root(exe_path);
        root.join("dist")
    } else {
        std::path::PathBuf::from("dist")
    };

    let web_hub = WebServerHub::new(pty_state.clone(), dist_dir);
    // Wire WebServerHub broadcast into pty_state
    if let Ok(mut guard) = pty_state.broadcast_tx.try_write() {
        *guard = Some(web_hub.broadcast_tx.clone());
    }

    tauri::Builder::default()
        .manage(pty_state)
        .manage(web_hub)
        // Tauri only builds this default Edit/Window/Help menu automatically on macOS;
        // set it explicitly so Windows and Linux also get a menu bar with Copy/Paste/etc.,
        // plus Theme and Settings submenus mirroring in-app preferences.
        .menu(|handle| menu::build_menu(handle, &config::get_app_config(None).default_theme, true))
        .on_menu_event(menu::handle_menu_event)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty::start_pty,
            pty::write_to_pty,
            pty::stop_pty,
            pty::resize_pty,
            pty::get_app_bundle_dir,
            agent::detect_agent,
            agent::get_install_command,
            agent::check_agent_update,
            agent::get_update_command,
            agent::check_skill_folder,
            agent::build_skill,
            agent::read_skill_file,
            agent::open_file_in_editor,
            agent::start_pre_launch_command,
            self_update::check_self_update,
            self_update::get_self_update_command,
            config::get_app_config,
            menu::set_theme,
            menu::set_auto_check_update,
            pty::force_kill_pty,
            web_server::start_web_server,
            web_server::stop_web_server,
            web_server::get_web_server_status,
            cert::import_ssl_certificate,
            cert::get_ssl_configuration,
            cert::reset_ssl_to_self_signed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        let result = greet("World");
        assert_eq!(result, "Hello, World! You've been greeted from Rust!");
    }
}
