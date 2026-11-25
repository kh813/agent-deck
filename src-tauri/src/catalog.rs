// Bridge for the skill catalog screen (app_specs.md 5.7.3): runs
// `skills_catalog.py api <op> [args]` and hands its single marker-prefixed
// JSON result line to the frontend. All catalog logic (Drive auth, sync,
// sharing) stays in Python; this only runs it off the UI thread with a time
// limit and turns "no JSON at all" (python missing, crash) into an error.
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::pty::get_default_cwd;
use crate::self_update::python_bin;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const API_MARKER: &str = "@@AGENT_DECK_JSON@@ ";
/// Long enough for a first-time Google login in the browser.
pub const API_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Ops the screen may call (mirrors skills_catalog.py API_OPS).
pub(crate) const ALLOWED_OPS: &[&str] =
    &["catalog", "search", "info", "local", "import", "share", "unshare", "enable", "disable", "rebuild"];

/// The last marker line's JSON, if any.
pub(crate) fn parse_api_output(stdout: &str) -> Option<serde_json::Value> {
    stdout
        .lines()
        .rev()
        .find_map(|l| l.strip_prefix(API_MARKER))
        .and_then(|j| serde_json::from_str(j.trim()).ok())
}

/// Skill names / queries only: no option-looking or control-character args.
pub(crate) fn validate_args(op: &str, args: &[String]) -> Result<(), String> {
    if !ALLOWED_OPS.contains(&op) {
        return Err(format!("unknown catalog op: {op}"));
    }
    for a in args {
        if a.starts_with('-') || a.chars().any(|c| c.is_control()) || a.len() > 200 {
            return Err(format!("invalid argument: {a:?}"));
        }
    }
    Ok(())
}

fn error_value(code: &str, message: String) -> serde_json::Value {
    serde_json::json!({ "ok": false, "error": { "code": code, "message": message }, "log": "" })
}

pub fn run_catalog_api(op: &str, args: &[String], timeout: Duration) -> serde_json::Value {
    if let Err(e) = validate_args(op, args) {
        return error_value("usage", e);
    }
    let root = get_default_cwd();
    let script = root.join("python").join("scripts").join("setup").join("skills_catalog.py");
    let mut cmd = Command::new(python_bin());
    cmd.arg(&script).arg("api").arg(op).args(args);
    cmd.current_dir(&root);
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return error_value("python_missing", format!("Python を起動できません / cannot run Python: {e}")),
    };
    // Drain both pipes concurrently: a large result (a skill's full SKILL.md)
    // would otherwise fill the pipe and deadlock the wait below.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out_t = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let err_t = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return error_value("timeout", "時間内に完了しませんでした / Timed out".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return error_value("exception", e.to_string()),
        }
    }
    let stdout = out_t.join().unwrap_or_default();
    let stderr = err_t.join().unwrap_or_default();
    parse_api_output(&stdout).unwrap_or_else(|| {
        let tail: Vec<&str> = stderr.lines().chain(stdout.lines()).filter(|l| !l.trim().is_empty()).collect();
        let msg = tail.iter().rev().take(3).rev().cloned().collect::<Vec<_>>().join("\n");
        error_value("no_result", if msg.is_empty() { "no output".into() } else { msg })
    })
}

#[tauri::command]
pub async fn catalog_api(op: String, args: Vec<String>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_catalog_api(&op, &args, API_TIMEOUT))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_last_marker_line() {
        let out = "noise\n@@AGENT_DECK_JSON@@ {\"ok\":false}\nmore\n@@AGENT_DECK_JSON@@ {\"ok\":true,\"data\":{\"n\":1}}\n";
        let v = parse_api_output(out).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["data"]["n"], 1);
    }

    #[test]
    fn no_marker_or_bad_json_is_none() {
        assert!(parse_api_output("Traceback ...\nError").is_none());
        assert!(parse_api_output("@@AGENT_DECK_JSON@@ {not json").is_none());
        assert!(parse_api_output("").is_none());
    }

    #[test]
    fn handles_crlf_and_japanese() {
        let out = "@@AGENT_DECK_JSON@@ {\"ok\":true,\"data\":{\"d\":\"経費\"}}\r\n";
        assert_eq!(parse_api_output(out).unwrap()["data"]["d"], "経費");
    }

    #[test]
    fn validates_ops_and_args() {
        assert!(validate_args("search", &["経費".into(), "PDF".into()]).is_ok());
        assert!(validate_args("import", &["taro/expense".into()]).is_ok());
        assert!(validate_args("sync", &[]).is_err(), "only screen ops");
        assert!(validate_args("change-owner", &[]).is_err(), "admin ops stay out of the UI");
        assert!(validate_args("import", &["--evil".into()]).is_err());
        assert!(validate_args("import", &["a\nb".into()]).is_err());
        assert!(validate_args("import", &["x".repeat(201)]).is_err());
    }

    #[test]
    fn ops_match_the_python_api() {
        let py = include_str!("../../python/scripts/setup/skills_catalog.py");
        for op in ALLOWED_OPS {
            assert!(py.contains(&format!("\"{op}\": api_")), "{op} missing from API_OPS");
        }
        assert!(py.contains(&format!("API_MARKER = \"{API_MARKER}\"")));
    }

    #[test]
    fn invalid_op_returns_usage_without_running_python() {
        let v = run_catalog_api("sync", &[], Duration::from_secs(1));
        assert_eq!(v["ok"], false);
        assert_eq!(v["error"]["code"], "usage");
    }
}
