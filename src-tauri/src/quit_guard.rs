// Asks before quitting while something is actually in progress.
//
// Every way out goes through request_quit(): the File/app-menu "Quit" item
// (our own item with CmdOrCtrl+Q -- see install_quit_menu_item; the
// predefined one would exit without asking), the window's close button
// (CloseRequested), and anything else that asks the app to exit, like the
// Dock's Quit (ExitRequested). An idle session -- the agent waiting at its
// prompt -- still quits immediately: the session is "running" nearly all the
// time, so asking on every quit would just be noise.
//
// "In progress" means either:
//   - the terminal printed something in the last BUSY_OUTPUT_WINDOW_MS (a
//     working agent or skill keeps redrawing a spinner/progress; an idle
//     prompt prints nothing), or
//   - the frontend reported busy work of its own: a session start (preflight),
//     or an agent-deck / engine update or install (set_quit_guard_busy).
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub const QUIT_MENU_ID: &str = "app:quit";
pub const BUSY_OUTPUT_WINDOW_MS: u64 = 5_000;

static LAST_OUTPUT_MS: AtomicU64 = AtomicU64::new(0);
static FRONTEND_BUSY: AtomicBool = AtomicBool::new(false);
static EXIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
static DIALOG_OPEN: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Called for every chunk of terminal output (pty.rs).
pub fn note_output() {
    LAST_OUTPUT_MS.store(now_ms(), Ordering::Relaxed);
}

pub(crate) fn should_confirm_quit(last_output_ms: u64, now_ms: u64, frontend_busy: bool) -> bool {
    frontend_busy || (last_output_ms != 0 && now_ms.saturating_sub(last_output_ms) < BUSY_OUTPUT_WINDOW_MS)
}

pub fn is_busy() -> bool {
    should_confirm_quit(
        LAST_OUTPUT_MS.load(Ordering::Relaxed),
        now_ms(),
        FRONTEND_BUSY.load(Ordering::Relaxed),
    )
}

/// True once the user agreed to quit (or nothing needed asking): lets the
/// exit/close events that follow app.exit() through.
pub fn exit_confirmed() -> bool {
    EXIT_CONFIRMED.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn set_quit_guard_busy(busy: bool) {
    FRONTEND_BUSY.store(busy, Ordering::Relaxed);
}

pub const CONFIRM_TITLE: &str = "agent-deck";
pub const CONFIRM_MESSAGE: &str = "処理の実行中です。終了すると、実行中のスキルや更新が中断されます。本当に終了しますか？\n\nA task is still running. Quitting will interrupt the running skill or update. Quit anyway?";
pub const CONFIRM_OK: &str = "終了する / Quit";
pub const CONFIRM_CANCEL: &str = "キャンセル / Cancel";

pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    if exit_confirmed() || !is_busy() {
        EXIT_CONFIRMED.store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    }
    // One dialog at a time (Cmd+Q pressed repeatedly, or Cmd+Q + close).
    if DIALOG_OPEN.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    let app2 = app.clone();
    app.dialog()
        .message(CONFIRM_MESSAGE)
        .title(CONFIRM_TITLE)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(CONFIRM_OK.into(), CONFIRM_CANCEL.into()))
        .show(move |quit| {
            DIALOG_OPEN.store(false, Ordering::SeqCst);
            if quit {
                EXIT_CONFIRMED.store(true, Ordering::SeqCst);
                app2.exit(0);
            }
        });
}

/// Is this the platform's predefined Quit item? muda's default labels are
/// "&Exit" on Windows and "&Quit" elsewhere (macOS may show "Quit
/// <app name>"); the `&` is a mnemonic marker and may or may not be stripped
/// by the time we read it back.
pub(crate) fn is_predefined_quit_text(text: &str) -> bool {
    let t = text.replace('&', "").trim().to_ascii_lowercase();
    t == "quit" || t == "exit" || t.starts_with("quit ")
}

/// Replaces the default menu's predefined Quit item with our own
/// CmdOrCtrl+Q item (handled by request_quit). Returns whether one was found.
pub fn install_quit_menu_item<R: Runtime>(handle: &AppHandle<R>, menu: &Menu<R>) -> tauri::Result<bool> {
    let label = if cfg!(target_os = "macos") {
        format!("Quit {}", handle.package_info().name)
    } else {
        "Quit".to_string()
    };
    for item in menu.items()? {
        let MenuItemKind::Submenu(sub) = item else { continue };
        if let Some(pos) = predefined_quit_position(&sub)? {
            sub.remove_at(pos)?;
            let quit = MenuItem::with_id(handle, QUIT_MENU_ID, label, true, Some("CmdOrCtrl+Q"))?;
            sub.insert(&quit as &dyn IsMenuItem<R>, pos)?;
            return Ok(true);
        }
    }
    // No predefined Quit on this platform's default menu (Linux): nothing to
    // replace; window close still goes through the guard.
    Ok(false)
}

fn predefined_quit_position<R: Runtime>(sub: &Submenu<R>) -> tauri::Result<Option<usize>> {
    for (i, child) in sub.items()?.iter().enumerate() {
        if let Some(p) = child.as_predefined_menuitem() {
            if is_predefined_quit_text(&p.text()?) {
                return Ok(Some(i));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_session_quits_without_asking() {
        assert!(!should_confirm_quit(0, 1_000_000, false));
        assert!(!should_confirm_quit(1_000_000, 1_000_000 + BUSY_OUTPUT_WINDOW_MS, false));
        assert!(!should_confirm_quit(1_000_000, 1_000_000 + 60_000, false));
    }

    #[test]
    fn recent_output_asks() {
        assert!(should_confirm_quit(1_000_000, 1_000_000, false));
        assert!(should_confirm_quit(1_000_000, 1_000_000 + BUSY_OUTPUT_WINDOW_MS - 1, false));
    }

    #[test]
    fn frontend_busy_always_asks() {
        assert!(should_confirm_quit(0, 1_000_000, true));
        assert!(should_confirm_quit(1, 10_000_000, true));
    }

    #[test]
    fn clock_going_backwards_counts_as_recent() {
        // saturating_sub -> 0 elapsed: asking is the safe side.
        assert!(should_confirm_quit(2_000_000, 1_000_000, false));
    }

    #[test]
    fn window_is_a_few_seconds() {
        assert!((2_000..=10_000).contains(&BUSY_OUTPUT_WINDOW_MS));
    }

    #[test]
    fn recognizes_predefined_quit_labels() {
        // muda 0.19 defaults: "&Exit" (Windows), "&Quit" (others).
        for t in ["&Exit", "&Quit", "Quit agent-deck", "Quit", "Exit", " quit agent-deck "] {
            assert!(is_predefined_quit_text(t), "{t}");
        }
        for t in ["Quit-ish", "Close Window", "Hide agent-deck", "Force Kill Session", ""] {
            assert!(!is_predefined_quit_text(t), "{t}");
        }
    }

    #[test]
    fn note_output_and_busy_flag_drive_is_busy() {
        // Shared statics: one test exercises them in sequence.
        set_quit_guard_busy(false);
        LAST_OUTPUT_MS.store(0, Ordering::Relaxed);
        assert!(!is_busy());
        note_output();
        assert!(is_busy());
        LAST_OUTPUT_MS.store(now_ms() - BUSY_OUTPUT_WINDOW_MS - 1, Ordering::Relaxed);
        assert!(!is_busy());
        set_quit_guard_busy(true);
        assert!(is_busy());
        set_quit_guard_busy(false);
        assert!(!is_busy());
    }

    // Wiring checks: the guard only helps if every exit path reaches it.
    #[test]
    fn every_exit_path_is_wired() {
        let lib = include_str!("lib.rs");
        assert!(lib.contains("quit_guard::set_quit_guard_busy"));
        assert!(lib.contains("WindowEvent::CloseRequested"));
        assert!(lib.contains("api.prevent_close()"));
        assert!(lib.contains("RunEvent::ExitRequested"));
        assert!(lib.contains("api.prevent_exit()"));
        let menu = include_str!("menu.rs");
        assert!(menu.contains("quit_guard::install_quit_menu_item(handle, &menu)?"));
        assert!(menu.contains("id == crate::quit_guard::QUIT_MENU_ID"));
        assert!(include_str!("pty.rs").contains("crate::quit_guard::note_output();"));
    }

    #[test]
    fn dialog_text_is_bilingual() {
        assert!(CONFIRM_MESSAGE.contains("本当に終了しますか"));
        assert!(CONFIRM_MESSAGE.contains("Quit anyway?"));
        assert!(CONFIRM_OK.contains("Quit") && CONFIRM_CANCEL.contains("Cancel"));
    }
}
