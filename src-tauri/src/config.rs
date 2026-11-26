use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::agent::InstallCommand;
use crate::pty::resolve_project_root;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EngineConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub app_name: String,
    pub default_theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub engines: Vec<EngineConfig>,
    // Optional command run (in the selected working directory) before every
    // PTY session starts, e.g. a parent project's own setup/update/auth
    // checks. Generalizes the old hardcoded "skill folder -> `<engine> build`"
    // flow (see agent::check_skill_folder / agent::build_skill), which still
    // runs as a fallback when this is unset, so existing configs without
    // these fields keep working unchanged.
    #[serde(default)]
    pub pre_launch_command: Option<String>,
    #[serde(default)]
    pub pre_launch_args: Vec<String>,
    // When true (default), a failing pre_launch_command aborts the session
    // start and surfaces the error. When false, the failure is shown as a
    // warning but the session starts anyway (for best-effort checks, e.g. a
    // version check that shouldn't block launch on a flaky network).
    #[serde(default = "default_true")]
    pub pre_launch_required: bool,
    // OS-specific overrides for pre_launch_command/pre_launch_args, for
    // projects whose pre-launch check differs by platform (e.g. `bash
    // preflight.sh` vs `cmd /c preflight.bat`). Mirrors the macos/windows
    // split already used for install/update commands in agent.rs. Resolved
    // into the flat pre_launch_command/pre_launch_args fields above by
    // get_app_config, so callers (Rust and frontend alike) only ever see the
    // already-resolved flat fields.
    #[serde(default)]
    pub pre_launch_macos: Option<InstallCommand>,
    #[serde(default)]
    pub pre_launch_windows: Option<InstallCommand>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            app_name: "agent-deck Chat Console".to_string(),
            default_theme: "light".to_string(),
            font_family: "Menlo, Monaco, 'Courier New', monospace".to_string(),
            font_size: 13,
            engines: vec![EngineConfig {
                id: "agy".to_string(),
                name: "Antigravity".to_string(),
                command: "agy".to_string(),
                args: vec![],
            }],
            pre_launch_command: None,
            pre_launch_args: vec![],
            pre_launch_required: true,
            pre_launch_macos: None,
            pre_launch_windows: None,
        }
    }
}

// Resolve pre_launch_macos/pre_launch_windows (if set) into the flat
// pre_launch_command/pre_launch_args fields for the current OS, so
// downstream consumers never need to branch on platform themselves.
fn resolve_pre_launch_override(mut config: AppConfig) -> AppConfig {
    let is_windows = cfg!(target_os = "windows");
    let override_cmd = if is_windows {
        config.pre_launch_windows.take()
    } else {
        config.pre_launch_macos.take()
    };
    if let Some(cmd) = override_cmd {
        config.pre_launch_command = Some(cmd.command);
        config.pre_launch_args = cmd.args;
    }
    config
}

fn get_exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|parent| parent.to_path_buf()))
}

#[tauri::command]
pub fn get_app_config(_cwd: Option<String>) -> AppConfig {
    let mut search_paths = Vec::new();

    // Security: NEVER load agent_config.json from an arbitrary tab working
    // directory (`_cwd`). A tab can be opened on any external folder or repo;
    // trusting a config file there would let that folder override
    // `pre_launch_command` (RCE) or strip guardrail flags (`--settings`,
    // `--add-dir`, `--append-system-prompt`) across the whole app.

    // 1. Search using the same project-root resolution as PTY launch
    // (macOS bundles need to traverse out of Contents/MacOS + the .app + the
    // app/ wrapper folder; get_exe_dir() alone only reaches Contents/MacOS).
    if let Ok(exe_path) = std::env::current_exe() {
        let project_root = resolve_project_root(exe_path);
        // config/ first: the root agent_config.json is rewritten to this
        // build's shipped version at startup (root_files.rs), so an org's
        // own customisation must live in config/agent_config.json.
        search_paths.push(project_root.join("config").join("agent_config.json"));
        search_paths.push(project_root.join("agent_config.json"));
    }

    // 2. Search in the directory containing the executable
    if let Some(exe_dir) = get_exe_dir() {
        search_paths.push(exe_dir.join("agent_config.json"));
        search_paths.push(exe_dir.join("config").join("agent_config.json"));
    }

    // 3. Search in the current runtime working directory
    search_paths.push(PathBuf::from("agent_config.json"));
    search_paths.push(PathBuf::from("config").join("agent_config.json"));

    // Traverse and load the first valid config file found
    for path in search_paths {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return resolve_pre_launch_override(config);
                }
            }
        }
    }

    // No agent_config.json anywhere: use the one this build ships (all
    // engines), not the agy-only built-in default. 2026-11-26, confirmed on
    // a Mac install whose root agent_config.json had gone missing: only
    // Antigravity was offered although Claude Code was installed.
    shipped_config()
}

/// The agent_config.json shipped with (and embedded in) this build.
pub(crate) fn shipped_config() -> AppConfig {
    serde_json::from_str::<AppConfig>(include_str!("../../agent_config.json"))
        .map(resolve_pre_launch_override)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn shipped_config_offers_every_engine() {
        let c = shipped_config();
        let ids: Vec<&str> = c.engines.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"agy") && ids.contains(&"claude"), "{ids:?}");
        assert!(c.pre_launch_command.is_some(), "per-OS preflight resolved");
    }

    #[test]
    fn test_get_app_config_ignores_untrusted_cwd_config() {
        // Security regression guard: an external working folder containing a
        // malicious or custom agent_config.json must NEVER override the
        // install's config (pre_launch_command / guardrail engine args).
        let temp_base = std::env::temp_dir().join(format!("agent_ui_test_{}", uuid_like_timestamp()));
        let config_dir = temp_base.join("config");
        fs::create_dir_all(&config_dir).unwrap();

        let evil_config = r#"{
            "app_name": "Evil CWD Override",
            "default_theme": "dark",
            "font_family": "Courier",
            "font_size": 16,
            "engines": [],
            "pre_launch_command": "sh",
            "pre_launch_args": ["-c", "echo pwned"]
        }"#;
        fs::write(temp_base.join("agent_config.json"), evil_config).unwrap();
        fs::write(config_dir.join("agent_config.json"), evil_config).unwrap();

        let config = get_app_config(Some(temp_base.to_string_lossy().to_string()));
        assert_ne!(config.app_name, "Evil CWD Override");
        assert_ne!(config.pre_launch_command.as_deref(), Some("sh"));

        let _ = fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_pre_launch_fields_default_when_absent() {
        // Existing configs (like the ones above) that predate pre_launch_*
        // must keep parsing, with pre_launch_command absent and
        // pre_launch_required defaulting to true.
        let config: AppConfig = serde_json::from_str(
            r#"{
                "app_name": "No Pre-Launch Fields",
                "default_theme": "light",
                "font_family": "Menlo",
                "font_size": 13,
                "engines": []
            }"#,
        )
        .unwrap();
        assert_eq!(config.pre_launch_command, None);
        assert!(config.pre_launch_args.is_empty());
        assert_eq!(config.pre_launch_required, true);
    }

    #[test]
    fn test_pre_launch_fields_parsed_when_present() {
        let config: AppConfig = serde_json::from_str(
            r#"{
                "app_name": "With Pre-Launch",
                "default_theme": "light",
                "font_family": "Menlo",
                "font_size": 13,
                "engines": [],
                "pre_launch_command": "bash",
                "pre_launch_args": ["preflight.sh"],
                "pre_launch_required": false
            }"#,
        )
        .unwrap();
        assert_eq!(config.pre_launch_command, Some("bash".to_string()));
        assert_eq!(config.pre_launch_args, vec!["preflight.sh".to_string()]);
        assert_eq!(config.pre_launch_required, false);
    }

    #[test]
    fn test_pre_launch_os_override_resolves_for_current_platform() {
        let raw = r#"{
            "app_name": "OS Override",
            "default_theme": "light",
            "font_family": "Menlo",
            "font_size": 13,
            "engines": [],
            "pre_launch_command": "fallback",
            "pre_launch_args": ["should-not-be-used"],
            "pre_launch_macos": {"command": "bash", "args": ["preflight.sh"]},
            "pre_launch_windows": {"command": "cmd", "args": ["/c", "preflight.bat"]}
        }"#;
        let config: AppConfig = serde_json::from_str(raw).unwrap();
        let resolved = resolve_pre_launch_override(config);

        if cfg!(target_os = "windows") {
            assert_eq!(resolved.pre_launch_command, Some("cmd".to_string()));
            assert_eq!(resolved.pre_launch_args, vec!["/c".to_string(), "preflight.bat".to_string()]);
        } else {
            assert_eq!(resolved.pre_launch_command, Some("bash".to_string()));
            assert_eq!(resolved.pre_launch_args, vec!["preflight.sh".to_string()]);
        }
    }

    #[test]
    fn test_pre_launch_no_override_keeps_flat_fields() {
        let config: AppConfig = serde_json::from_str(
            r#"{
                "app_name": "No Override",
                "default_theme": "light",
                "font_family": "Menlo",
                "font_size": 13,
                "engines": [],
                "pre_launch_command": "python3",
                "pre_launch_args": ["preflight.py"]
            }"#,
        )
        .unwrap();
        let resolved = resolve_pre_launch_override(config);
        assert_eq!(resolved.pre_launch_command, Some("python3".to_string()));
        assert_eq!(resolved.pre_launch_args, vec!["preflight.py".to_string()]);
    }

    fn uuid_like_timestamp() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    }
}
