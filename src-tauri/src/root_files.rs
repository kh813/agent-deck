// Keeps the install's top-level shipped files in sync with this app build.
//
// Self-update (python/scripts/setup/self_update.py) only swaps the app
// bundle/exe, refreshes python/ and copies config.toml -- the files at the
// install root (preflight.sh/.bat, agent_config.json, AGENTS.md, CLAUDE.md,
// messages/) stayed at whatever version was FIRST installed. Confirmed for
// real: an install updated rc2 -> rc4 via the Update menu still ran the old
// preflight.sh, and installs coming from 0.1.x never received the Claude
// Code `--settings` args in agent_config.json or the engine-neutral
// AGENTS.md.
//
// The app binary itself IS replaced by every update, so it carries the
// canonical copies (embedded at compile time) and writes them back at
// startup -- before the pre-launch command (preflight) ever runs, so a
// running script is never rewritten under itself (cmd.exe in particular
// re-reads a .bat by offset while executing it).
use std::fs;
use std::path::Path;

struct Shipped {
    rel: &'static str,
    bytes: &'static [u8],
    /// None = every platform; Some(true) = Windows only; Some(false) = non-Windows only.
    windows_only: Option<bool>,
}

const SHIPPED: &[Shipped] = &[
    Shipped { rel: "agent_config.json", bytes: include_bytes!("../../agent_config.json"), windows_only: None },
    // The product's guardrails. Kept under release/ with non-standard names
    // so they don't apply while developing agent-deck itself (release/README.md).
    Shipped { rel: "AGENTS.md", bytes: include_bytes!("../../release/AGENTS.release.md"), windows_only: None },
    Shipped { rel: "CLAUDE.md", bytes: include_bytes!("../../release/CLAUDE.release.md"), windows_only: None },
    Shipped { rel: "messages/no_python.txt", bytes: include_bytes!("../../messages/no_python.txt"), windows_only: None },
    Shipped { rel: "messages/setup_failed.txt", bytes: include_bytes!("../../messages/setup_failed.txt"), windows_only: None },
    Shipped { rel: "preflight.sh", bytes: include_bytes!("../../preflight.sh"), windows_only: Some(false) },
    Shipped { rel: "preflight.bat", bytes: include_bytes!("../../preflight.bat"), windows_only: Some(true) },
];

/// Only touch something that looks like an agent-deck install.
fn is_install_root(root: &Path) -> bool {
    root.join("agent_config.json").is_file()
        && root.join("python").join("scripts").join("setup").join("self_update.py").is_file()
}

fn applies_here(f: &Shipped, is_windows: bool) -> bool {
    match f.windows_only {
        None => true,
        Some(w) => w == is_windows,
    }
}

fn write_atomically(dest: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("sync-tmp");
    fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dest)
            .map(|m| m.permissions().mode())
            .unwrap_or(if dest.extension().map_or(false, |e| e == "sh") { 0o755 } else { 0o644 });
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(mode));
    }
    fs::rename(&tmp, dest)
}

/// Write every shipped file that is missing or differs. Returns the
/// relative paths that were (re)written. A replaced agent_config.json is
/// kept as agent_config.json.prev (org-specific settings belong in
/// config/agent_config.json, which config.rs reads first).
pub(crate) fn sync_root_files_for(root: &Path, is_windows: bool) -> Vec<String> {
    let mut written = Vec::new();
    if !is_install_root(root) {
        return written;
    }
    for f in SHIPPED.iter().filter(|f| applies_here(f, is_windows)) {
        let dest = root.join(f.rel);
        if fs::read(&dest).map(|cur| cur == f.bytes).unwrap_or(false) {
            continue;
        }
        if f.rel == "agent_config.json" && dest.exists() {
            let _ = fs::copy(&dest, root.join("agent_config.json.prev"));
        }
        match write_atomically(&dest, f.bytes) {
            Ok(()) => written.push(f.rel.to_string()),
            Err(e) => eprintln!("[root_files] failed to update {}: {}", f.rel, e),
        }
    }
    written
}

pub fn sync_root_files(root: &Path) -> Vec<String> {
    let written = sync_root_files_for(root, cfg!(target_os = "windows"));
    if !written.is_empty() {
        eprintln!("[root_files] updated: {}", written.join(", "));
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    fn install(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("agentdeck-rootfiles-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("python/scripts/setup")).unwrap();
        fs::write(dir.join("python/scripts/setup/self_update.py"), "").unwrap();
        fs::write(dir.join("agent_config.json"), "{\"old\": true}").unwrap();
        fs::write(dir.join("preflight.sh"), "old").unwrap();
        dir
    }

    #[test]
    fn writes_missing_and_outdated_files_and_backs_up_config() {
        let root = install("update");
        let written = sync_root_files_for(&root, false);
        assert!(written.contains(&"preflight.sh".to_string()));
        assert!(written.contains(&"agent_config.json".to_string()));
        assert!(written.contains(&"AGENTS.md".to_string()));
        assert!(written.contains(&"messages/no_python.txt".to_string()));
        assert!(!written.contains(&"preflight.bat".to_string()), "no .bat on macOS");
        assert_eq!(fs::read(root.join("preflight.sh")).unwrap(), include_bytes!("../../preflight.sh"));
        assert_eq!(fs::read(root.join("CLAUDE.md")).unwrap(), b"@AGENTS.md\n");
        assert_eq!(fs::read_to_string(root.join("agent_config.json.prev")).unwrap(), "{\"old\": true}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn second_run_is_a_no_op() {
        let root = install("noop");
        sync_root_files_for(&root, false);
        assert!(sync_root_files_for(&root, false).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn windows_gets_bat_not_sh() {
        let root = install("win");
        let written = sync_root_files_for(&root, true);
        assert!(written.contains(&"preflight.bat".to_string()));
        assert!(!written.contains(&"preflight.sh".to_string()));
        assert_eq!(fs::read(root.join("preflight.sh")).unwrap(), b"old");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn leaves_non_install_dirs_alone() {
        let dir = std::env::temp_dir().join(format!("agentdeck-rootfiles-none-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("agent_config.json"), "{}").unwrap(); // no python/ tree
        assert!(sync_root_files_for(&dir, false).is_empty());
        assert!(!dir.join("AGENTS.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let root = install("perm");
        fs::set_permissions(root.join("preflight.sh"), fs::Permissions::from_mode(0o755)).unwrap();
        sync_root_files_for(&root, false);
        let mode = fs::metadata(root.join("preflight.sh")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o755);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn embedded_bat_is_crlf() {
        let bat = SHIPPED.iter().find(|f| f.rel == "preflight.bat").unwrap().bytes;
        assert!(bat.windows(2).any(|w| w == b"\r\n"));
        assert!(!bat.iter().enumerate().any(|(i, &b)| b == b'\n' && (i == 0 || bat[i - 1] != b'\r')));
    }
}
