// agent-deck's own self-update, distinct from agent.rs's per-engine
// install/update machinery (which drives agy via install_commands.json).
// self_update.py resolves its own project root from `__file__` and needs no
// venv (pure stdlib) for the GitHub paths, so this can just shell out to a
// plain system python3/python with no cwd gymnastics.
//
// Three update "kinds", matching the Update submenu (see menu.rs):
//   "github"  -- GitHub's /releases/latest (self_update.py's plain path)
//   "org-prod" -- this org's config-bundled Drive build, config.toml's
//                 [drive] org_release_prod_file_id (see package_release.py)
//   "org-test" -- same, org_release_test_file_id
use std::process::Command;

use crate::agent::{InstallCommand, UpdateStatus};
use crate::pty::get_default_cwd;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn python_bin() -> &'static str {
    if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    }
}

fn self_update_script_path() -> std::path::PathBuf {
    get_default_cwd()
        .join("python")
        .join("scripts")
        .join("setup")
        .join("self_update.py")
}

// Reads config.toml's [drive] org_release_prod_file_id / org_release_test_file_id
// directly -- this is the one place Rust reads config.toml at all (everything
// else is Python's domain). Best-effort: any missing file/section/key, or an
// empty string, is just "not configured" rather than an error, since a plain
// OSS install with no org config.toml at all is an entirely normal state.
fn org_release_file_id_from_toml(text: &str, kind: &str) -> Option<String> {
    let key = match kind {
        "org-prod" => "org_release_prod_file_id",
        "org-test" => "org_release_test_file_id",
        _ => return None,
    };
    let value: toml::Value = toml::from_str(text).ok()?;
    let id = value.get("drive")?.get(key)?.as_str()?.trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

pub fn org_release_file_id(kind: &str) -> Option<String> {
    let path = get_default_cwd().join("config.toml");
    let text = std::fs::read_to_string(path).ok()?;
    org_release_file_id_from_toml(&text, kind)
}

// Used at menu-build time (see menu.rs::build_menu) to decide which Update
// submenu items to show: both org items when either is configured (an
// org-managed install should use its own controlled Drive channel, not
// bypass it via raw GitHub), otherwise just the plain GitHub item.
pub fn org_release_configured() -> (bool, bool) {
    (
        org_release_file_id("org-prod").is_some(),
        org_release_file_id("org-test").is_some(),
    )
}

/// A test-edition build: its version carries a semver prerelease suffix
/// (0.2.8-rc2), exactly like the release tags (release.yml publishes those as
/// GitHub pre-releases and package_release.py --test puts them on the org's
/// test channel).
pub(crate) fn is_test_build(version: &str) -> bool {
    version.contains('-')
}

/// What the app's periodic background check looks at -- the channel this
/// build came from, never the other one (2026-11-25: a test build was
/// offered the stable release, and vice versa would push testers off rc's):
///   test build   -> org test channel, or GitHub's newest pre-release
///   stable build -> org prod channel, or GitHub's latest release
/// An org install that doesn't publish this build's channel gets "none"
/// (no automatic check) rather than a fallback to the other channel or to
/// raw GitHub, which an org-managed install deliberately doesn't use.
pub(crate) fn default_kind_for(app_is_test: bool, org_prod_configured: bool, org_test_configured: bool) -> &'static str {
    let org_managed = org_prod_configured || org_test_configured;
    match (app_is_test, org_managed) {
        (true, true) if org_test_configured => "org-test",
        (false, true) if org_prod_configured => "org-prod",
        (_, true) => "none",
        (true, false) => "github-test",
        (false, false) => "github",
    }
}

// self_update.py arguments for a check. `background` adds --background:
// never opens a browser login (Drive), and fails quietly (exit 3) instead.
pub(crate) fn check_args(kind: &str, drive_file_id: Option<&str>, background: bool) -> Option<Vec<String>> {
    if kind == "none" {
        return None;
    }
    let mut args = vec!["check".to_string(), "--json".to_string()];
    if background {
        args.push("--background".to_string());
    }
    if kind == "github-test" {
        args.push("--test".to_string());
    }
    if kind == "org-prod" || kind == "org-test" {
        args.push("--drive-file-id".to_string());
        args.push(drive_file_id?.to_string());
    }
    Some(args)
}

pub fn check_self_update_internal(kind: &str, background: bool) -> Result<UpdateStatus, String> {
    let no_update = UpdateStatus {
        current_version: None,
        latest_version: None,
        update_available: false,
    };

    let file_id = org_release_file_id(kind);
    let Some(args) = check_args(kind, file_id.as_deref(), background) else {
        return Ok(no_update);
    };
    let mut cmd = Command::new(python_bin());
    cmd.arg(self_update_script_path()).args(args);
    cmd.current_dir(get_default_cwd());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    // Best-effort, same philosophy as check_agent_update_internal's own
    // fallback: no python, no network, or a bad GitHub/Drive API response
    // should never surface an error to the user -- it just means "no update
    // alert this time", not a broken app.
    let Ok(output) = cmd.output() else {
        return Ok(no_update);
    };
    if !output.status.success() {
        return Ok(no_update);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(line) = stdout.lines().last() else {
        return Ok(no_update);
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        return Ok(no_update);
    };

    let update_available = parsed
        .get("update_available")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let installed_tag = parsed
        .get("installed_tag")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let latest_tag = parsed
        .get("latest_tag")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(UpdateStatus {
        current_version: installed_tag,
        latest_version: latest_tag,
        update_available,
    })
}

pub fn get_self_update_command_internal(kind: &str) -> Result<InstallCommand, String> {
    let mut args = vec![
        self_update_script_path().to_string_lossy().to_string(),
        "apply".to_string(),
    ];
    if kind == "github-test" {
        args.push("--test".to_string());
    }
    if kind == "org-prod" || kind == "org-test" {
        let file_id = org_release_file_id(kind)
            .ok_or_else(|| format!("No Drive file ID configured in config.toml for {kind}"))?;
        args.push("--drive-file-id".to_string());
        args.push(file_id);
    }
    Ok(InstallCommand {
        command: python_bin().to_string(),
        args,
    })
}

// --- Tauri Command Wrappers ---

#[tauri::command]
pub async fn check_self_update(kind: String, background: Option<bool>) -> Result<UpdateStatus, String> {
    let background = background.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || check_self_update_internal(&kind, background))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn default_self_update_kind() -> String {
    let (prod, test) = org_release_configured();
    default_kind_for(is_test_build(env!("CARGO_PKG_VERSION")), prod, test).to_string()
}

#[tauri::command]
pub async fn get_self_update_command(kind: String) -> Result<InstallCommand, String> {
    get_self_update_command_internal(&kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_detection() {
        assert!(is_test_build("0.2.8-rc2"));
        assert!(is_test_build("1.0.0-test1"));
        assert!(!is_test_build("0.2.7"));
    }

    #[test]
    fn test_stable_build_checks_only_stable() {
        assert_eq!(default_kind_for(false, true, true), "org-prod");
        assert_eq!(default_kind_for(false, true, false), "org-prod");
        assert_eq!(default_kind_for(false, false, false), "github");
    }

    #[test]
    fn test_test_build_checks_only_test() {
        assert_eq!(default_kind_for(true, true, true), "org-test");
        assert_eq!(default_kind_for(true, false, true), "org-test");
        assert_eq!(default_kind_for(true, false, false), "github-test");
    }

    #[test]
    fn test_org_install_without_this_channel_does_not_auto_check() {
        assert_eq!(default_kind_for(true, true, false), "none");
        assert_eq!(default_kind_for(false, false, true), "none");
    }

    #[test]
    fn test_check_args_github_test_and_none() {
        assert_eq!(check_args("github-test", None, true).unwrap(), vec!["check", "--json", "--background", "--test"]);
        assert!(check_args("none", None, true).is_none());
    }

    #[test]
    fn test_apply_command_for_github_test() {
        let c = get_self_update_command_internal("github-test").unwrap();
        assert_eq!(&c.args[1..], ["apply", "--test"]);
        let c = get_self_update_command_internal("github").unwrap();
        assert_eq!(&c.args[1..], ["apply"]);
    }

    #[test]
    fn test_check_args_github() {
        assert_eq!(check_args("github", None, false).unwrap(), vec!["check", "--json"]);
        assert_eq!(check_args("github", None, true).unwrap(), vec!["check", "--json", "--background"]);
    }

    #[test]
    fn test_check_args_org_includes_file_id() {
        assert_eq!(
            check_args("org-prod", Some("F1"), true).unwrap(),
            vec!["check", "--json", "--background", "--drive-file-id", "F1"]
        );
        assert_eq!(
            check_args("org-test", Some("T1"), false).unwrap(),
            vec!["check", "--json", "--drive-file-id", "T1"]
        );
    }

    #[test]
    fn test_check_args_org_without_file_id_is_no_check() {
        assert!(check_args("org-prod", None, true).is_none());
    }

    #[test]
    fn test_reads_configured_prod_file_id() {
        let toml = "[drive]\norg_release_prod_file_id = \"abc123\"\n";
        assert_eq!(
            org_release_file_id_from_toml(toml, "org-prod"),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn test_reads_configured_test_file_id() {
        let toml = "[drive]\norg_release_test_file_id = \"xyz789\"\n";
        assert_eq!(
            org_release_file_id_from_toml(toml, "org-test"),
            Some("xyz789".to_string())
        );
    }

    #[test]
    fn test_empty_string_is_treated_as_unconfigured() {
        let toml = "[drive]\norg_release_prod_file_id = \"\"\n";
        assert_eq!(org_release_file_id_from_toml(toml, "org-prod"), None);
    }

    #[test]
    fn test_missing_key_is_unconfigured() {
        let toml = "[drive]\ncatalog_folder_id = \"unrelated\"\n";
        assert_eq!(org_release_file_id_from_toml(toml, "org-prod"), None);
    }

    #[test]
    fn test_missing_drive_section_is_unconfigured() {
        let toml = "[oauth]\nclient_id = \"x\"\n";
        assert_eq!(org_release_file_id_from_toml(toml, "org-prod"), None);
    }

    #[test]
    fn test_malformed_toml_is_unconfigured_not_a_panic() {
        let text = "this is not valid toml {{{";
        assert_eq!(org_release_file_id_from_toml(text, "org-prod"), None);
    }

    #[test]
    fn test_unknown_kind_returns_none() {
        let toml = "[drive]\norg_release_prod_file_id = \"abc123\"\n";
        assert_eq!(org_release_file_id_from_toml(toml, "github"), None);
    }
}
