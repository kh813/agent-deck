use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{PathBuf, Path};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EngineConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub app_name: String,
    pub default_theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub engines: Vec<EngineConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            app_name: "agent-ui Chat Console".to_string(),
            default_theme: "light".to_string(),
            font_family: "Menlo, Monaco, 'Courier New', monospace".to_string(),
            font_size: 13,
            engines: vec![EngineConfig {
                id: "agy".to_string(),
                name: "Antigravity".to_string(),
                command: "agy".to_string(),
                args: vec![],
            }],
        }
    }
}

fn get_exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|parent| parent.to_path_buf()))
}

#[tauri::command]
pub fn get_app_config(cwd: Option<String>) -> AppConfig {
    // 1. Search in the CWD (Working directory)
    if let Some(ref cwd_str) = cwd {
        let cwd_path = Path::new(cwd_str).join("agent_config.json");
        if cwd_path.exists() {
            if let Ok(content) = fs::read_to_string(&cwd_path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return config;
                }
            }
        }
    }

    // 2. Search in the directory containing the executable
    if let Some(exe_dir) = get_exe_dir() {
        let config_path = exe_dir.join("agent_config.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return config;
                }
            }
        }
    }

    // 3. Search in the current runtime working directory
    let runtime_path = Path::new("agent_config.json");
    if runtime_path.exists() {
        if let Ok(content) = fs::read_to_string(&runtime_path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                return config;
            }
        }
    }

    // 4. Return default fallback
    AppConfig::default()
}
