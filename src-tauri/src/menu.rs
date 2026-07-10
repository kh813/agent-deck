use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, Submenu, HELP_SUBMENU_ID};
use tauri::{AppHandle, Emitter, Manager};

const THEME_MENU_ID_PREFIX: &str = "theme:";

// Keep in sync with the theme ids/names in src/utils/themes.ts
const THEMES: &[(&str, &str)] = &[
    ("light", "Light (Default)"),
    ("dark", "Dark"),
    ("solarizedLight", "Solarized Light"),
    ("solarizedDark", "Solarized Dark"),
    ("dracula", "Dracula"),
    ("oneDark", "One Dark"),
];

struct ThemeMenuState(Mutex<Vec<(String, CheckMenuItem<tauri::Wry>)>>);

// Tauri only builds its default Edit/Window/Help menu automatically on macOS,
// so build it explicitly (Windows/Linux get a menu bar too) and add a Theme
// submenu that mirrors the in-app theme selector.
pub fn build_menu(handle: &AppHandle, initial_theme: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(handle)?;

    let items: Vec<(String, CheckMenuItem<tauri::Wry>)> = THEMES
        .iter()
        .map(|(id, label)| {
            let item = CheckMenuItem::with_id(
                handle,
                format!("{THEME_MENU_ID_PREFIX}{id}"),
                *label,
                true,
                *id == initial_theme,
                None::<&str>,
            )?;
            Ok((id.to_string(), item))
        })
        .collect::<tauri::Result<_>>()?;

    let theme_submenu_items: Vec<&dyn IsMenuItem<tauri::Wry>> =
        items.iter().map(|(_, item)| item as &dyn IsMenuItem<tauri::Wry>).collect();
    let theme_submenu = Submenu::with_items(handle, "Theme", true, &theme_submenu_items)?;

    // Place Theme just before Help, matching where most apps put extra top-level menus.
    let help_index = menu.items()?.iter().position(|item| item.id() == HELP_SUBMENU_ID);
    match help_index {
        Some(index) => menu.insert(&theme_submenu, index)?,
        None => menu.append(&theme_submenu)?,
    }

    handle.manage(ThemeMenuState(Mutex::new(items)));

    Ok(menu)
}

fn set_checked_theme(app: &AppHandle, theme_id: &str) {
    if let Some(state) = app.try_state::<ThemeMenuState>() {
        let items = state.0.lock().unwrap();
        for (id, item) in items.iter() {
            let _ = item.set_checked(id == theme_id);
        }
    }
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let Some(theme_id) = event.id().as_ref().strip_prefix(THEME_MENU_ID_PREFIX) else {
        return;
    };

    set_checked_theme(app, theme_id);
    let _ = app.emit("theme-changed", theme_id.to_string());
}

// Invoked by the frontend when the theme changes via the in-app selector,
// so the menu checkmarks stay in sync.
#[tauri::command]
pub fn set_theme(app: AppHandle, theme_id: String) {
    set_checked_theme(&app, &theme_id);
}
