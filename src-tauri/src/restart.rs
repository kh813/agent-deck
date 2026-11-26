// Restart into the freshly installed version after "Update to ..." finished.
//
// Whether the update actually installed something is read from the marker
// files self_update.py writes ONLY after a successful install, at the
// install root: `<app>.version` (GitHub channels) and
// `<app>.drive-source.json` (org Drive channels). "Already up to date",
// a refused downgrade or a failure leave them untouched -> no restart.
//
// The relaunch runs from a tiny detached shell that waits a moment first, so
// the new instance starts after this one has gone (no two copies touching
// the same files / web-server port), and the quit confirmation is skipped
// (quit_guard::confirm_exit) -- the user asked for the update.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Runtime};

use crate::pty::{is_development_mode, resolve_project_root};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Marker clock tolerance (file system timestamp granularity, clock skew).
const MARKER_SLACK: Duration = Duration::from_secs(2);

fn is_update_marker(name: &str) -> bool {
    name.ends_with(".version") || name.ends_with(".drive-source.json")
}

/// Did an update finish installing at `root` since `since`?
pub(crate) fn update_applied_since(root: &Path, since: SystemTime) -> bool {
    let threshold = since.checked_sub(MARKER_SLACK).unwrap_or(UNIX_EPOCH);
    let Ok(entries) = std::fs::read_dir(root) else { return false };
    entries.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        is_update_marker(&name)
            && e.metadata().and_then(|m| m.modified()).map_or(false, |t| t >= threshold)
    })
}

#[tauri::command]
pub fn self_update_applied(started_at_ms: u64) -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    let since = UNIX_EPOCH + Duration::from_millis(started_at_ms);
    update_applied_since(&resolve_project_root(exe), since)
}

/// The path to launch: on Windows the running exe was renamed to
/// `<name>.exe.old` by the update (self_update._atomic_swap) and the new one
/// sits at the original name -- never relaunch the `.old`.
pub(crate) fn fresh_exe_path(exe: &Path) -> PathBuf {
    let s = exe.to_string_lossy();
    match s.strip_suffix(".old") {
        Some(orig) => PathBuf::from(orig),
        None => exe.to_path_buf(),
    }
}

/// The enclosing `.app` bundle of a macOS executable, if any.
pub(crate) fn app_bundle_of(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|p| p.extension().map_or(false, |e| e == "app"))
        .map(Path::to_path_buf)
}

/// (program, args) that relaunch the app after a short wait.
pub(crate) fn relaunch_command(exe: &Path, is_windows: bool) -> (String, Vec<String>) {
    let target = fresh_exe_path(exe);
    if is_windows {
        // `start ""` detaches the GUI app; ping is cmd's portable sleep.
        (
            "cmd".to_string(),
            vec![
                "/C".to_string(),
                format!("ping -n 3 127.0.0.1 >NUL & start \"\" \"{}\"", target.display()),
            ],
        )
    } else if let Some(bundle) = app_bundle_of(&target) {
        // `open -n` = a normal LaunchServices launch of the (new) bundle.
        (
            "/bin/sh".to_string(),
            vec!["-c".to_string(), "sleep 1.5; open -n \"$0\"".to_string(), bundle.display().to_string()],
        )
    } else {
        (
            "/bin/sh".to_string(),
            vec!["-c".to_string(), "sleep 1.5; \"$0\" >/dev/null 2>&1 &".to_string(), target.display().to_string()],
        )
    }
}

fn spawn_relaunch(exe: &Path) -> std::io::Result<()> {
    let (program, args) = relaunch_command(exe, cfg!(target_os = "windows"));
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        // Passed verbatim: Rust's argument quoting would mangle cmd's own.
        cmd.raw_arg(&args[0]).raw_arg(&args[1]);
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    cmd.args(&args);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.spawn().map(|_| ())
}

#[tauri::command]
pub fn restart_after_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if is_development_mode(&exe) {
        return Err("development build: restart it yourself".into());
    }
    spawn_relaunch(&exe).map_err(|e| format!("could not relaunch: {e}"))?;
    crate::quit_guard::confirm_exit();
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("agentdeck-restart-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn applied_only_when_a_marker_was_written_after_start() {
        let root = tmp("markers");
        let before = SystemTime::now() - Duration::from_secs(60);
        assert!(!update_applied_since(&root, before), "no marker at all");
        fs::write(root.join("agent-deck.app.drive-source.json"), "{}").unwrap();
        assert!(update_applied_since(&root, before));
        // started after the marker was written (= this update didn't write it)
        let later = SystemTime::now() + Duration::from_secs(30);
        assert!(!update_applied_since(&root, later));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn github_marker_and_rebranded_names_count_other_files_dont() {
        let root = tmp("names");
        let before = SystemTime::now() - Duration::from_secs(60);
        fs::write(root.join("config.toml"), "x").unwrap();
        fs::write(root.join("AGENTS.md"), "x").unwrap();
        assert!(!update_applied_since(&root, before));
        fs::write(root.join("acme-console.exe.version"), "v0.2.9").unwrap();
        assert!(update_applied_since(&root, before));
        let _ = fs::remove_dir_all(&root);
        assert!(!update_applied_since(&root, before), "missing folder");
    }

    #[test]
    fn never_relaunches_the_renamed_old_exe() {
        assert_eq!(fresh_exe_path(Path::new(r"C:\a\agent-deck.exe.old")), PathBuf::from(r"C:\a\agent-deck.exe"));
        assert_eq!(fresh_exe_path(Path::new("/x/agent-deck.app/Contents/MacOS/agent-deck")),
                   PathBuf::from("/x/agent-deck.app/Contents/MacOS/agent-deck"));
    }

    #[test]
    fn mac_relaunches_the_bundle_with_open_after_a_pause() {
        let (p, a) = relaunch_command(Path::new("/Users/t/Applications/agent deck/agent-deck.app/Contents/MacOS/agent-deck"), false);
        assert_eq!(p, "/bin/sh");
        assert_eq!(a[0], "-c");
        assert!(a[1].starts_with("sleep ") && a[1].contains("open -n \"$0\""));
        assert_eq!(a[2], "/Users/t/Applications/agent deck/agent-deck.app", "path passed as an argument, not spliced into the script");
    }

    #[test]
    fn windows_relaunches_the_new_exe_detached_after_a_pause() {
        let (p, a) = relaunch_command(Path::new(r"C:\Users\Taro Yamada\agent-deck\agent-deck.exe.old"), true);
        assert_eq!(p, "cmd");
        assert_eq!(a[0], "/C");
        assert!(a[1].starts_with("ping -n "));
        assert!(a[1].ends_with(r#"start "" "C:\Users\Taro Yamada\agent-deck\agent-deck.exe""#), "{}", a[1]);
    }

    #[test]
    fn wired_into_the_app() {
        let lib = include_str!("lib.rs");
        assert!(lib.contains("restart::self_update_applied"));
        assert!(lib.contains("restart::restart_after_update"));
        assert!(include_str!("quit_guard.rs").contains("pub fn confirm_exit()"));
    }
}
