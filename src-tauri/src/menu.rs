use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID};
use tauri::{AppHandle, Emitter, Manager};

use crate::self_update::org_release_configured;

const THEME_MENU_ID_PREFIX: &str = "theme:";
const AUTO_CHECK_UPDATE_MENU_ID: &str = "settings:auto-check-update";
const UPDATE_GITHUB_MENU_ID: &str = "update:github";
const UPDATE_ORG_PROD_MENU_ID: &str = "update:org-prod";
const UPDATE_ORG_TEST_MENU_ID: &str = "update:org-test";
// Labels say what you get, not where it comes from: whether the stable build
// is the org's Drive copy or the public GitHub release is an install detail.
const UPDATE_STABLE_LABEL: &str = "Update to Latest...";
const UPDATE_TEST_LABEL: &str = "Update to Test Edition...";
const FORCE_KILL_SESSION_MENU_ID: &str = "session:force-kill";
const VERSION_MENU_ID: &str = "app:version";
const FONT_FAMILY_MENU_ID_PREFIX: &str = "font-family:";
const FONT_SIZE_MENU_ID_PREFIX: &str = "font-size:";
const FONT_SIZE_INCREASE_MENU_ID: &str = "font:size-increase";
const FONT_SIZE_DECREASE_MENU_ID: &str = "font:size-decrease";
const FONT_RESET_MENU_ID: &str = "font:reset";
/// Menu id suffix for "use the font from agent_config.json".
const FONT_FAMILY_DEFAULT_ID: &str = "default";

/// Terminal font presets: (menu id, label, CSS font-family stack). Each stack
/// ends in platform fallbacks + `monospace`, so a font that isn't installed
/// on this machine degrades to a sane monospace font instead of a
/// proportional one.
#[cfg(target_os = "macos")]
const FONT_FAMILIES: &[(&str, &str, &str)] = &[
    ("menlo", "Menlo", "Menlo, Monaco, monospace"),
    ("monaco", "Monaco", "Monaco, Menlo, monospace"),
    ("sf-mono", "SF Mono", "'SF Mono', SFMono-Regular, Menlo, monospace"),
    ("courier-new", "Courier New", "'Courier New', Courier, monospace"),
    ("osaka-mono", "Osaka-Mono (等幅)", "'Osaka-Mono', Osaka, Menlo, monospace"),
    ("hiragino-sans", "Hiragino Sans (ヒラギノ角ゴ)", "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Menlo, monospace"),
    ("fira-code", "Fira Code", "'Fira Code', Menlo, monospace"),
    ("jetbrains-mono", "JetBrains Mono", "'JetBrains Mono', Menlo, monospace"),
    ("source-code-pro", "Source Code Pro", "'Source Code Pro', Menlo, monospace"),
];
#[cfg(not(target_os = "macos"))]
const FONT_FAMILIES: &[(&str, &str, &str)] = &[
    ("consolas", "Consolas", "Consolas, 'Courier New', monospace"),
    ("cascadia-mono", "Cascadia Mono", "'Cascadia Mono', Consolas, monospace"),
    ("cascadia-code", "Cascadia Code", "'Cascadia Code', Consolas, monospace"),
    ("courier-new", "Courier New", "'Courier New', Courier, monospace"),
    ("ms-gothic", "MS Gothic (ＭＳ ゴシック)", "'MS Gothic', 'ＭＳ ゴシック', Consolas, monospace"),
    ("biz-udgothic", "BIZ UDGothic", "'BIZ UDGothic', 'MS Gothic', Consolas, monospace"),
    ("fira-code", "Fira Code", "'Fira Code', Consolas, monospace"),
    ("jetbrains-mono", "JetBrains Mono", "'JetBrains Mono', Consolas, monospace"),
    ("source-code-pro", "Source Code Pro", "'Source Code Pro', Consolas, monospace"),
];
// Keep in sync with FONT_SIZE_MIN/MAX in src/lib/terminalFont.ts.
const FONT_SIZES: &[u32] = &[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];

/// What a Font-menu click asks the frontend to do (sent as the
/// "font-menu" event payload). The frontend owns the actual setting
/// (localStorage, defaults from agent_config.json) and reports back via
/// set_font_menu_state so the checkmarks match.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "action", content = "value", rename_all = "kebab-case")]
pub enum FontMenuAction {
    /// None = back to the agent_config.json font.
    Family(Option<String>),
    Size(u32),
    SizeIncrease,
    SizeDecrease,
    Reset,
}

pub(crate) fn font_menu_action(id: &str) -> Option<FontMenuAction> {
    if let Some(fid) = id.strip_prefix(FONT_FAMILY_MENU_ID_PREFIX) {
        if fid == FONT_FAMILY_DEFAULT_ID {
            return Some(FontMenuAction::Family(None));
        }
        return FONT_FAMILIES
            .iter()
            .find(|(i, _, _)| *i == fid)
            .map(|(_, _, css)| FontMenuAction::Family(Some(css.to_string())));
    }
    if let Some(size) = id.strip_prefix(FONT_SIZE_MENU_ID_PREFIX) {
        return size.parse().ok().map(FontMenuAction::Size);
    }
    match id {
        FONT_SIZE_INCREASE_MENU_ID => Some(FontMenuAction::SizeIncrease),
        FONT_SIZE_DECREASE_MENU_ID => Some(FontMenuAction::SizeDecrease),
        FONT_RESET_MENU_ID => Some(FontMenuAction::Reset),
        _ => None,
    }
}

/// Which family menu id should carry the checkmark for a user override
/// (None = the agent_config.json default). A custom stack that matches no
/// preset checks nothing.
pub(crate) fn checked_family_id(family_override: Option<&str>) -> Option<&'static str> {
    match family_override {
        None => Some(FONT_FAMILY_DEFAULT_ID),
        Some(css) => FONT_FAMILIES.iter().find(|(_, _, c)| *c == css).map(|(i, _, _)| *i),
    }
}

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
struct FontMenuState {
    families: Vec<(String, CheckMenuItem<tauri::Wry>)>,
    sizes: Vec<(u32, CheckMenuItem<tauri::Wry>)>,
}
struct AutoCheckUpdateMenuState(CheckMenuItem<tauri::Wry>);

// Tauri only builds its default Edit/Window/Help menu automatically on macOS,
// so build it explicitly (Windows/Linux get a menu bar too) and add a Theme
// submenu that mirrors the in-app theme selector.
pub fn build_menu(
    handle: &AppHandle,
    initial_theme: &str,
    initial_auto_check_update: bool,
) -> tauri::Result<Menu<tauri::Wry>> {
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

    // Font submenu: terminal (xterm.js) font family / size, per user.
    let mut family_items: Vec<(String, CheckMenuItem<tauri::Wry>)> = vec![(
        FONT_FAMILY_DEFAULT_ID.to_string(),
        CheckMenuItem::with_id(
            handle,
            format!("{FONT_FAMILY_MENU_ID_PREFIX}{FONT_FAMILY_DEFAULT_ID}"),
            "Default",
            true,
            true,
            None::<&str>,
        )?,
    )];
    for (id, label, _) in FONT_FAMILIES {
        family_items.push((
            id.to_string(),
            CheckMenuItem::with_id(handle, format!("{FONT_FAMILY_MENU_ID_PREFIX}{id}"), *label, true, false, None::<&str>)?,
        ));
    }
    let family_refs: Vec<&dyn IsMenuItem<tauri::Wry>> =
        family_items.iter().map(|(_, i)| i as &dyn IsMenuItem<tauri::Wry>).collect();
    let family_submenu = Submenu::with_items(handle, "Font Family", true, &family_refs)?;

    let size_items: Vec<(u32, CheckMenuItem<tauri::Wry>)> = FONT_SIZES
        .iter()
        .map(|size| {
            Ok((
                *size,
                CheckMenuItem::with_id(handle, format!("{FONT_SIZE_MENU_ID_PREFIX}{size}"), format!("{size} pt"), true, false, None::<&str>)?,
            ))
        })
        .collect::<tauri::Result<_>>()?;
    let increase_item = MenuItem::with_id(handle, FONT_SIZE_INCREASE_MENU_ID, "Increase Font Size", true, Some("CmdOrCtrl+="))?;
    let decrease_item = MenuItem::with_id(handle, FONT_SIZE_DECREASE_MENU_ID, "Decrease Font Size", true, Some("CmdOrCtrl+-"))?;
    let size_sep = PredefinedMenuItem::separator(handle)?;
    let mut size_refs: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&increase_item, &decrease_item, &size_sep];
    size_refs.extend(size_items.iter().map(|(_, i)| i as &dyn IsMenuItem<tauri::Wry>));
    let size_submenu = Submenu::with_items(handle, "Font Size", true, &size_refs)?;

    let font_sep = PredefinedMenuItem::separator(handle)?;
    let reset_item = MenuItem::with_id(handle, FONT_RESET_MENU_ID, "Reset Font to Default", true, Some("CmdOrCtrl+0"))?;
    let font_submenu = Submenu::with_items(handle, "Font", true, &[&family_submenu, &size_submenu, &font_sep, &reset_item])?;

    // Session submenu
    let force_kill_item = MenuItem::with_id(
        handle,
        FORCE_KILL_SESSION_MENU_ID,
        "Force Kill Session",
        true,
        None::<&str>,
    )?;
    let session_submenu = Submenu::with_items(handle, "Session", true, &[&force_kill_item])?;

    let auto_check_update_item = CheckMenuItem::with_id(
        handle,
        AUTO_CHECK_UPDATE_MENU_ID,
        "Check for Updates on Startup",
        true,
        initial_auto_check_update,
        None::<&str>,
    )?;
    let settings_submenu = Submenu::with_items(handle, "Settings", true, &[&auto_check_update_item])?;

    // Update submenu: an org-managed install (config.toml's [drive]
    // org_release_prod_file_id / org_release_test_file_id set -- see
    // package_release.py) should use its own controlled Drive channel
    // rather than bypass it via raw GitHub, so the plain GitHub item is
    // hidden whenever either org item is available. A plain OSS install
    // with no org config.toml at all gets just the GitHub item, which
    // works even fresh out of a ZIP with no config.toml present yet.
    let (org_prod_configured, org_test_configured) = org_release_configured();
    let update_submenu = if org_prod_configured || org_test_configured {
        // Most people should just take the stable build; the test edition
        // is for developers/testers, so it sits below a separator.
        let prod_item = if org_prod_configured {
            Some(MenuItem::with_id(handle, UPDATE_ORG_PROD_MENU_ID, UPDATE_STABLE_LABEL, true, None::<&str>)?)
        } else {
            None
        };
        let test_item = if org_test_configured {
            Some(MenuItem::with_id(handle, UPDATE_ORG_TEST_MENU_ID, UPDATE_TEST_LABEL, true, None::<&str>)?)
        } else {
            None
        };
        let sep = PredefinedMenuItem::separator(handle)?;
        let mut refs: Vec<&dyn IsMenuItem<tauri::Wry>> = Vec::new();
        if let Some(i) = &prod_item {
            refs.push(i);
        }
        if let Some(i) = &test_item {
            if !refs.is_empty() {
                refs.push(&sep);
            }
            refs.push(i);
        }
        Submenu::with_items(handle, "Update", true, &refs)?
    } else {
        let github_item = MenuItem::with_id(
            handle, UPDATE_GITHUB_MENU_ID, UPDATE_STABLE_LABEL, true, None::<&str>,
        )?;
        Submenu::with_items(handle, "Update", true, &[&github_item])?
    };

    // Place Theme/Session/Update/Settings just before Help, matching where most apps put extra top-level menus.
    let help_index = menu.items()?.iter().position(|item| item.id() == HELP_SUBMENU_ID);
    match help_index {
        Some(index) => menu.insert(&theme_submenu, index)?,
        None => menu.append(&theme_submenu)?,
    }
    let help_index = menu.items()?.iter().position(|item| item.id() == HELP_SUBMENU_ID);
    match help_index {
        Some(index) => menu.insert(&font_submenu, index)?,
        None => menu.append(&font_submenu)?,
    }
    let help_index = menu.items()?.iter().position(|item| item.id() == HELP_SUBMENU_ID);
    match help_index {
        Some(index) => menu.insert(&session_submenu, index)?,
        None => menu.append(&session_submenu)?,
    }
    let help_index = menu.items()?.iter().position(|item| item.id() == HELP_SUBMENU_ID);
    match help_index {
        Some(index) => menu.insert(&update_submenu, index)?,
        None => menu.append(&update_submenu)?,
    }
    let help_index = menu.items()?.iter().position(|item| item.id() == HELP_SUBMENU_ID);
    match help_index {
        Some(index) => menu.insert(&settings_submenu, index)?,
        None => menu.append(&settings_submenu)?,
    }

    // Disabled (non-clickable) item just showing the running version -- no
    // dedicated "About"/version display existed before this, so users
    // couldn't tell an old install apart from a fresh one without checking
    // Update menu availability itself (see docs/admin_guide.md §4).
    let version_item = MenuItem::with_id(
        handle,
        VERSION_MENU_ID,
        format!("Version {}", env!("CARGO_PKG_VERSION")),
        false,
        None::<&str>,
    )?;
    match menu.get(HELP_SUBMENU_ID).and_then(|item| item.as_submenu().cloned()) {
        Some(help_submenu) => help_submenu.prepend(&version_item)?,
        // No Help submenu on this platform -- surface it as its own
        // top-level entry rather than silently dropping it.
        None => menu.append(&version_item)?,
    }

    handle.manage(ThemeMenuState(Mutex::new(items)));
    handle.manage(FontMenuState { families: family_items, sizes: size_items });
    handle.manage(AutoCheckUpdateMenuState(auto_check_update_item));

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

fn set_checked_auto_update(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<AutoCheckUpdateMenuState>() {
        let _ = state.0.set_checked(enabled);
    }
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();

    if let Some(theme_id) = id.strip_prefix(THEME_MENU_ID_PREFIX) {
        set_checked_theme(app, theme_id);
        let _ = app.emit("theme-changed", theme_id.to_string());
        return;
    }

    if let Some(action) = font_menu_action(id) {
        // CheckMenuItems toggle themselves on click; the frontend answers
        // with set_font_menu_state, which puts the right checkmarks back.
        let _ = app.emit("font-menu", action);
        return;
    }

    if id == FORCE_KILL_SESSION_MENU_ID {
        let _ = app.emit("menu-force-kill-requested", ());
        return;
    }

    if id == AUTO_CHECK_UPDATE_MENU_ID {
        if let Some(state) = app.try_state::<AutoCheckUpdateMenuState>() {
            // muda already flips the checkmark before dispatching this event
            // (see its Windows/macOS menu_selected handlers), so the current
            // checked state already reflects the click - just read and relay it.
            let enabled = state.0.is_checked().unwrap_or(true);
            let _ = app.emit("auto-check-update-changed", enabled);
        }
        return;
    }

    if id == UPDATE_GITHUB_MENU_ID {
        let _ = app.emit("check-self-update-requested", "github");
        return;
    }

    if id == UPDATE_ORG_PROD_MENU_ID {
        let _ = app.emit("check-self-update-requested", "org-prod");
        return;
    }

    if id == UPDATE_ORG_TEST_MENU_ID {
        let _ = app.emit("check-self-update-requested", "org-test");
    }
}

// Invoked by the frontend when the theme changes via the in-app selector,
// so the menu checkmarks stay in sync.
#[tauri::command]
pub fn set_theme(app: AppHandle, theme_id: String, is_dark: Option<bool>) {
    set_checked_theme(&app, &theme_id);
    if let Some(dark) = is_dark {
        crate::pty::set_terminal_is_dark(dark);
    }
}

// Invoked by the frontend on load (and whenever the setting changes some
// other way) so the menu checkmark stays in sync.
#[tauri::command]
pub fn set_auto_check_update(app: AppHandle, enabled: bool) {
    set_checked_auto_update(&app, enabled);
}

// Invoked by the frontend whenever the terminal font setting changes (and
// on load) so the Font menu's checkmarks match. family = the user's override
// CSS stack, or None for the agent_config.json default; size = the
// effective size in px.
#[tauri::command]
pub fn set_font_menu_state(app: AppHandle, family: Option<String>, size: u32) {
    if let Some(state) = app.try_state::<FontMenuState>() {
        let checked = checked_family_id(family.as_deref());
        for (id, item) in state.families.iter() {
            let _ = item.set_checked(Some(id.as_str()) == checked);
        }
        for (s, item) in state.sizes.iter() {
            let _ = item.set_checked(*s == size);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn family_menu_ids_map_to_css_stacks() {
        assert_eq!(font_menu_action("font-family:default"), Some(FontMenuAction::Family(None)));
        for (id, _, css) in FONT_FAMILIES {
            assert_eq!(
                font_menu_action(&format!("font-family:{id}")),
                Some(FontMenuAction::Family(Some(css.to_string())))
            );
            assert!(css.ends_with("monospace"), "{id} must fall back to monospace");
        }
        assert_eq!(font_menu_action("font-family:nope"), None);
    }

    #[test]
    fn size_and_reset_ids() {
        assert_eq!(font_menu_action("font-size:14"), Some(FontMenuAction::Size(14)));
        assert_eq!(font_menu_action("font:size-increase"), Some(FontMenuAction::SizeIncrease));
        assert_eq!(font_menu_action("font:size-decrease"), Some(FontMenuAction::SizeDecrease));
        assert_eq!(font_menu_action("font:reset"), Some(FontMenuAction::Reset));
        assert_eq!(font_menu_action("theme:dark"), None);
    }

    #[test]
    fn preset_ids_are_unique_and_not_default() {
        let mut ids: Vec<&str> = FONT_FAMILIES.iter().map(|(i, _, _)| *i).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), FONT_FAMILIES.len());
        assert!(!ids.contains(&FONT_FAMILY_DEFAULT_ID));
    }

    #[test]
    fn checkmark_follows_override() {
        assert_eq!(checked_family_id(None), Some("default"));
        let (id, _, css) = FONT_FAMILIES[1];
        assert_eq!(checked_family_id(Some(css)), Some(id));
        assert_eq!(checked_family_id(Some("Some Custom Font")), None);
    }

    #[test]
    fn payload_shape_matches_frontend() {
        let v = serde_json::to_value(FontMenuAction::Family(Some("X".into()))).unwrap();
        assert_eq!(v, serde_json::json!({"action": "family", "value": "X"}));
        let v = serde_json::to_value(FontMenuAction::SizeIncrease).unwrap();
        assert_eq!(v, serde_json::json!({"action": "size-increase"}));
        let v = serde_json::to_value(FontMenuAction::Family(None)).unwrap();
        assert_eq!(v, serde_json::json!({"action": "family", "value": null}));
    }
}
