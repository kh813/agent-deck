mod pty;
mod agent;
mod config;
mod menu;
mod self_update;
mod root_files;
mod restart;
mod cert;
mod quit_guard;
mod locale;
mod image_attach;
mod catalog;
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
    // Bring the install's top-level files (preflight, agent_config.json,
    // AGENTS.md, ...) up to this build's versions before anything reads
    // them -- self-update never replaces them (see root_files.rs). Skipped
    // when running from a dev build (target/).
    if let Ok(exe_path) = std::env::current_exe() {
        let root = pty::resolve_project_root(exe_path.clone());
        if !pty::is_development_mode(&exe_path) {
            root_files::sync_root_files(&root);
        }
        image_attach::prune_screenshots_on_startup(&root);
    }

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
        // Window close button (and Cmd+W, the only window) quits too: same
        // "ask only while busy" rule as the Quit item (quit_guard.rs).
        .on_window_event(|window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !quit_guard::exit_confirmed() && quit_guard::is_busy() {
                    api.prevent_close();
                    quit_guard::request_quit(window.app_handle());
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
            self_update::default_self_update_kind,
            self_update::get_self_update_command,
            restart::self_update_applied,
            restart::restart_after_update,
            config::get_app_config,
            menu::set_theme,
            menu::set_auto_check_update,
            menu::set_font_menu_state,
            menu::set_webgl_renderer_menu_state,
            quit_guard::set_quit_guard_busy,
            locale::get_os_locales,
            image_attach::save_pasted_image,
            image_attach::save_clipboard_image,
            catalog::catalog_api,
            menu::set_language_menu_state,
            pty::force_kill_pty,
            pty::close_pty_session,
            pty::stop_other_sessions,
            pty::resolve_session_folder,
            pty::set_session_registry,
            web_server::start_web_server,
            web_server::stop_web_server,
            web_server::get_web_server_status,
            web_server::web_ui_available,
            cert::import_ssl_certificate,
            cert::get_ssl_configuration,
            cert::reset_ssl_to_self_signed
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Exit requests from outside our own Quit item (e.g. the Dock's
            // Quit, the last window closing). `code` is Some only for our own
            // app.exit() after the guard already said yes.
            match event {
                tauri::RunEvent::ExitRequested { api, code, .. } => {
                    if code.is_none() && !quit_guard::exit_confirmed() && quit_guard::is_busy() {
                        api.prevent_exit();
                        quit_guard::request_quit(app);
                    }
                }
                tauri::RunEvent::Exit => {
                    // Kill every running tab's PTY child and clear the session
                    // registry so no orphan agents or stale registry linger.
                    use tauri::Manager;
                    if let Some(state) = app.try_state::<PtyState>() {
                        state.kill_all_sessions_blocking();
                    }
                    pty::clear_session_registry_on_exit();
                }
                _ => {}
            }
        });
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
