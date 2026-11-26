use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

// Whether the app's current terminal theme has a dark background. The
// frontend reports it through menu::set_theme; start_pty_internal passes it
// on as COLORFGBG so CLIs that pick their palette from the terminal's
// light/dark-ness (Claude Code's `"theme": "auto"`) match what xterm.js
// actually renders. Without this Claude Code defaults to its dark palette,
// and on the default light theme xterm's minimumContrastRatio then darkens
// the selected and unselected slash-command suggestions to nearly the same
// color.
static TERMINAL_IS_DARK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_terminal_is_dark(dark: bool) {
    TERMINAL_IS_DARK.store(dark, std::sync::atomic::Ordering::Relaxed);
}

/// COLORFGBG value ("<fg>;<bg>" as ANSI color indices) for the given
/// background: bg 0 = dark, bg 15 = light.
pub(crate) fn colorfgbg(dark: bool) -> &'static str {
    if dark { "15;0" } else { "0;15" }
}

#[derive(Clone)]
pub struct PtyState {
    pub session: Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>,
    pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    pub child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
    pub broadcast_tx: Arc<tokio::sync::RwLock<Option<tokio::sync::broadcast::Sender<crate::web_server::WsServerEvent>>>>,
    /// Bumped on every start_pty: lets a session's output task tell its own
    /// child from a newer session's (see child-exit watching below).
    pub generation: Arc<std::sync::atomic::AtomicU64>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
            writer: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
            broadcast_tx: Arc::new(tokio::sync::RwLock::new(None)),
            generation: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }
}

// TEMPORARY: shared path for the raw PTY byte log used to diagnose rendering
// bugs in the upstream CLI's own output. See start_pty_internal (truncates
// it fresh per session) and resize_pty_internal (appends a marker so a
// mid-session resize can be correlated against the byte stream around it -
// suspected of desyncing the upstream CLI's own relative-cursor redraw math
// from what's actually on screen).
fn debug_log_path() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("agent-deck-pty-debug.log")
}

fn debug_log_marker(text: &str) {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(debug_log_path()) {
        use std::io::Write as _;
        let _ = writeln!(f, "\n[agent-ui @ {millis}ms] {text}");
    }
}

#[derive(Serialize, Clone)]
struct PtyOutputPayload {
    // Raw bytes, not a decoded String: a fixed-size PTY read can end in the
    // middle of a multi-byte UTF-8 character, and independently
    // lossy-decoding each chunk would replace both halves of that character
    // with U+FFFD. Sending raw bytes and letting xterm.js's own UTF-8
    // decoder (which correctly buffers a partial trailing sequence across
    // separate `write()` calls) handle it avoids that corruption entirely.
    data: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PtyPromptPayload {
    pub prompt_type: String, // "confirm" | "path" | "login"
    pub message: String,
    pub options: Option<Vec<String>>,
    pub url: Option<String>,
    // Literal bytes to write to the PTY for each entry of `options` (same
    // index). Set for arrow-key menus whose option order differs between
    // CLIs (e.g. the folder-trust dialog lists "Yes" first in agy but
    // "No, exit" first in Claude Code), so the response is chosen by
    // position rather than by matching the label text. When absent, the
    // frontend falls back to its label-based mapping (promptResponse.ts).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inputs: Option<Vec<String>>,
}

// Strip ANSI helper on backend to parse clean prompt patterns
pub fn strip_ansi_rust(text: &str) -> String {
    // Claude Code (Ink) draws the gap between words as an absolute/relative
    // cursor column move (ESC[<n>G / ESC[<n>C) rather than a space
    // character, so plain stripping glues "Yes, I trust" into "Yes,Itrust".
    // Turn those moves into a space first so phrase matching still works.
    let col_move = Regex::new(r"\x1b\[[0-9]*[GC]").unwrap();
    let text = col_move.replace_all(text, " ");
    let text = text.as_ref();
    let re = Regex::new(r"[\x1b\x9b]\[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]").unwrap();
    re.replace_all(text, "").to_string()
}

const ARROW_DOWN: &str = "\x1b[B";

// Keys that pick entry `i` of an arrow-key menu whose cursor starts on the
// first entry: i down-arrows, then Enter.
fn menu_inputs(count: usize) -> Vec<String> {
    (0..count).map(|i| format!("{}\r", ARROW_DOWN.repeat(i))).collect()
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn detect_numbered_menu(text: &str) -> Option<PtyPromptPayload> {
    let q_re = Regex::new(r"Do you want [^?\n]{0,300}\?").unwrap();
    let q = q_re.find_iter(text).last()?;
    let rest = &text[q.end()..];
    let footer = rest.find("Esc to cancel")?;
    let body = &rest[..footer];

    let item_re = Regex::new(r"(?:^|\s)(?:❯\s*)?([1-9])\.\s").unwrap();
    let marks: Vec<(usize, usize, u32)> = item_re
        .captures_iter(body)
        .map(|c| {
            let m = c.get(0).unwrap();
            let n: u32 = c[1].parse().unwrap_or(0);
            (m.start(), m.end(), n)
        })
        .collect();
    // Must be a consecutive 1..N list with at least two entries.
    if marks.len() < 2 || marks.iter().enumerate().any(|(i, m)| m.2 != (i as u32) + 1) {
        return None;
    }

    let mut options = Vec::new();
    for (i, m) in marks.iter().enumerate() {
        let end = marks.get(i + 1).map(|n| n.0).unwrap_or(body.len());
        let label = collapse_ws(&body[m.1..end]);
        let label = label.trim_end_matches(|c: char| c == '·' || c.is_whitespace()).to_string();
        let label = if label.chars().count() > 90 {
            format!("{}…", label.chars().take(89).collect::<String>())
        } else {
            label
        };
        options.push(format!("{}. {}", m.2, label));
    }
    let inputs = menu_inputs(options.len());
    Some(PtyPromptPayload {
        prompt_type: "confirm".to_string(),
        message: collapse_ws(q.as_str()),
        options: Some(options),
        url: None,
        inputs: Some(inputs),
    })
}

// Detect prompts (y/n, folder path, login oauth url) from text
pub fn detect_prompts(text: &str) -> Option<PtyPromptPayload> {
    // 0. Generic "[y/N]"-style tool permission prompt
    if text.contains("Allow tool execution?") || text.contains("Allow file edit?") || text.contains("Allow web search?") || text.contains("Allow tool call?") {
        return Some(PtyPromptPayload {
            prompt_type: "confirm".to_string(),
            message: "The agent is requesting tool/file permission.".to_string(),
            options: Some(vec!["y".to_string(), "n".to_string()]),
            url: None,
            inputs: None,
        });
    }

    // 1. Login/Authentication URL (Google OAuth or device login url)
    let login_re = Regex::new(r"https://[a-zA-Z0-9./?=&_-]*(oauth|auth|device)[a-zA-Z0-9./?=&_-]*").unwrap();
    if let Some(mat) = login_re.find(text) {
        return Some(PtyPromptPayload {
            prompt_type: "login".to_string(),
            message: "Authentication login requested. The URL has been opened in your browser.".to_string(),
            options: None,
            url: Some(mat.as_str().to_string()),
            inputs: None,
        });
    }

    // 2. Folder Trust Check. agy: "Do you trust the contents of this
    // project?" with "Yes, I trust this folder" listed first. Claude Code:
    // "Quick safety check: Is this a project you created or one you trust?"
    // with "No, exit" listed first (and pre-selected). Both are arrow-key
    // menus starting on the first entry, so order the buttons -- and the
    // keys each one sends -- by where each option actually appears.
    if text.contains("Do you trust the contents of this project?") || text.contains("Yes, I trust this folder") {
        let yes = "Yes, I trust this folder";
        let no = "No, exit";
        let options: Vec<String> = match (text.find(yes), text.find(no)) {
            (Some(y), Some(n)) if n < y => vec![no.to_string(), yes.to_string()],
            _ => vec![yes.to_string(), no.to_string()],
        };
        let inputs = menu_inputs(options.len());
        return Some(PtyPromptPayload {
            prompt_type: "confirm".to_string(),
            message: "Do you trust the contents of this folder? The agent will be able to read, edit, and execute files here.".to_string(),
            options: Some(options),
            url: None,
            inputs: Some(inputs),
        });
    }

    // 2b. Numbered permission menu (Claude Code): "Do you want to proceed?",
    // "Do you want to make this edit to foo.txt?", "Do you want to create
    // foo.txt?" ... followed by "❯ 1. Yes  2. Yes, and ...  N. No" and an
    // "Esc to cancel" footer.
    if let Some(p) = detect_numbered_menu(text) {
        return Some(p);
    }

    // 3. Tool/Command Permission Request Prompt
    if text.contains("Requesting permission for:") || (text.contains("Do you want to proceed?") && !text.contains("[y/N]")) {
        let mut cmd_name = "command".to_string();
        if let Some(caps) = Regex::new(r"permission for:\s*\r?\n?\s*([^\r\n]+)").unwrap().captures(text) {
            cmd_name = caps.get(1).map_or("command".to_string(), |m| m.as_str().trim().to_string());
        }
        return Some(PtyPromptPayload {
            prompt_type: "confirm".to_string(),
            message: format!("Command permission requested for: `{}`. Do you want to proceed?", cmd_name),
            options: Some(vec![
                "Yes".to_string(),
                "Yes, and always allow in this conversation".to_string(),
                "Yes, and always allow (Persist to settings.json)".to_string(),
                "No".to_string(),
            ]),
            url: None,
            inputs: None,
        });
    }

    // 4. Y/N Confirmation
    // Proceed [y/N], Confirm [yes/no], procedd (y/n), Are you sure? [y/N]
    let confirm_re = Regex::new(r"(?i)(confirm|proceed|are you sure|y/n|yes/no)[\s\S]*?\[([yY]/[nN]|[yY]es/[nN]o)\]").unwrap();
    if confirm_re.is_match(text) {
        return Some(PtyPromptPayload {
            prompt_type: "confirm".to_string(),
            message: "Interactive confirmation requested.".to_string(),
            options: Some(vec!["Yes".to_string(), "No".to_string()]),
            url: None,
            inputs: None,
        });
    }

    // 4. Path Input prompt
    let path_re = Regex::new(r"(?i)(enter|select|input)\s+[\s\S]*?(path|folder|directory|destination)").unwrap();
    if path_re.is_match(text) {
        return Some(PtyPromptPayload {
            prompt_type: "path".to_string(),
            message: "Folder path input requested.".to_string(),
            options: None,
            url: None,
            inputs: None,
        });
    }

    None
}

// --- Internal Logic (Generic Runtime support for testing) ---

pub(crate) fn is_development_mode(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "target")
}

fn find_dev_project_root(mut path: PathBuf) -> Option<PathBuf> {
    while let Some(parent) = path.parent() {
        if parent.join("src-tauri").exists() {
            return Some(parent.to_path_buf());
        }
        path = parent.to_path_buf();
    }
    None
}

// Peels the OS-specific bundle/exe structure down to the immediate
// container directory, then reports whether that container is an `app/`
// wrapper folder (the old layout: a parent project's installer, e.g.
// agent-deck's install_agent_ui.py, placed agent-ui.app/agent-ui.exe
// directly inside app/, one level below the real project root) or the
// project root itself (the newer layout: the bundle/exe sits directly at
// the project root, with supporting binaries/scripts/venv as an `app/`
// sibling rather than a container). Both resolve_project_root and
// resolve_app_bundle_dir need this same peel, differing only in what they
// return once they know which layout they're looking at — see 2026-07-16's
// fix for agent-deck's root-declutter request (exe/.app moved out of app/
// to the project root; app/ kept as the sibling holding bin/, venv, etc.).
fn peel_to_container(mut path: PathBuf) -> (PathBuf, bool) {
    #[cfg(target_os = "macos")]
    {
        // Traverse up 4 times to get from the raw Mach-O binary out to the
        // folder containing the .app bundle itself:
        // 1. Contents/MacOS/agent-ui -> Contents/MacOS
        // 2. Contents/MacOS -> Contents
        // 3. Contents -> agent-ui.app
        // 4. agent-ui.app -> container (either an app/ wrapper, or the
        //    project root itself if the bundle sits directly there)
        for _ in 0..4 {
            if let Some(parent) = path.parent() {
                path = parent.to_path_buf();
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // exe's immediate parent is either an app/ wrapper, or the project
        // root itself if the exe sits directly there.
        if let Some(parent) = path.parent() {
            path = parent.to_path_buf();
        }
    }

    let is_app_wrapper = path
        .file_name()
        .map(|name| name == "app")
        .unwrap_or(false);
    (path, is_app_wrapper)
}

// Expand `${PROJECT_ROOT}` in engine launch args (agent_config.json) to the
// installation's project root, so an engine can be pointed at a file that
// lives in the install regardless of the session's working folder -- e.g.
// Claude Code's `--settings ${PROJECT_ROOT}/.claude/agent-deck-settings.json`
// (written by setup.py). If a `--settings <path>` file doesn't exist (setup
// hasn't run yet / failed), that flag pair is dropped: `claude` hard-fails
// with "Settings file not found" otherwise, and launching without the extra
// permission rules beats not launching at all.
pub(crate) fn resolve_launch_args(args: Vec<String>, project_root: &Path) -> Vec<String> {
    let root = project_root.to_string_lossy();
    let expanded: Vec<String> = args
        .into_iter()
        .map(|a| a.replace("${PROJECT_ROOT}", &root))
        .collect();
    let mut out = Vec::with_capacity(expanded.len());
    let mut i = 0;
    while i < expanded.len() {
        if expanded[i] == "--settings" {
            if let Some(val) = expanded.get(i + 1) {
                let looks_like_json = val.trim_start().starts_with('{');
                if !looks_like_json && !Path::new(val).exists() {
                    i += 2;
                    continue;
                }
            }
        }
        out.push(expanded[i].clone());
        i += 1;
    }
    out
}

// Directories that CLI agents' official installers put binaries in but that a
// Finder/Explorer-launched GUI app does NOT inherit on PATH (a GUI app gets
// launchd's minimal PATH on macOS, not the user's shell profile). Claude Code's
// native installer in particular always installs to ~/.local/bin (both OSes),
// so without this `claude` resolves neither via `which` nor inside the PTY.
fn user_bin_dirs(home: Option<&str>) -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.push("/opt/homebrew/bin".to_string());
        dirs.push("/usr/local/bin".to_string());
    }
    if let Some(home) = home {
        if !home.is_empty() {
            dirs.push(Path::new(home).join(".local").join("bin").to_string_lossy().to_string());
        }
    }
    dirs
}

// Prepend `extra` dirs (in order, highest priority first) to `base` PATH,
// skipping any already present as an exact PATH entry.
pub(crate) fn prepend_path_entries(base: &str, extra: &[String]) -> String {
    let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
    let existing: Vec<&str> = base.split(sep).filter(|p| !p.is_empty()).collect();
    let mut front: Vec<String> = Vec::new();
    for dir in extra {
        if !existing.iter().any(|e| e == dir) && !front.contains(dir) {
            front.push(dir.clone());
        }
    }
    if front.is_empty() {
        return base.to_string();
    }
    let joined = front.join(&sep.to_string());
    if base.is_empty() { joined } else { format!("{}{}{}", joined, sep, base) }
}

// PATH for every child process this app spawns (PTY session, pre-launch
// command, `which`/`where` agent detection): app-local bin dirs first, then
// the user-level installer dirs, then the inherited PATH.
pub(crate) fn child_path_env() -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let home = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE").ok()
    } else {
        std::env::var("HOME").ok()
    };
    let mut extra: Vec<String> = Vec::new();
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = resolve_app_bundle_dir(exe_path.clone());
        let proj_dir = resolve_project_root(exe_path);
        for p in [
            exe_dir.join("bin"),
            exe_dir.join("app").join("bin"),
            proj_dir.join("bin"),
            proj_dir.join("app").join("bin"),
        ] {
            extra.push(p.to_string_lossy().to_string());
        }
    }
    extra.extend(user_bin_dirs(home.as_deref()));
    prepend_path_entries(&base, &extra)
}

pub(crate) fn resolve_project_root(path: PathBuf) -> PathBuf {
    if is_development_mode(&path) {
        if let Some(dev_root) = find_dev_project_root(path.clone()) {
            return dev_root;
        }
    }

    let (container, is_app_wrapper) = peel_to_container(path);
    if is_app_wrapper {
        // Old layout: container IS app/, so the project root is one more
        // level up.
        container
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(container)
    } else {
        // New layout: the bundle/exe sits directly at the project root, so
        // the container we already peeled down to IS the project root.
        container
    }
}

// Resolve the directory holding supporting binaries/scripts (bin/, the
// bundled Python runtime, venv, etc.) — NOT the project root one level
// further up that resolve_project_root returns in the old layout, nor the
// same directory as the exe/bundle itself in the new layout. This is where
// a sibling `./bin/<agent>` portable install lives (agent.rs's
// detect_agent_internal step 0), which for a macOS .app bundle is NOT simply
// the raw binary's own parent directory (Contents/MacOS/) — that naive
// computation was the bug this function originally fixed.
pub(crate) fn resolve_app_bundle_dir(path: PathBuf) -> PathBuf {
    if is_development_mode(&path) {
        if let Some(dev_root) = find_dev_project_root(path.clone()) {
            return dev_root;
        }
    }

    let (container, is_app_wrapper) = peel_to_container(path);
    if is_app_wrapper {
        // Old layout: container already IS the app/ wrapper we want.
        container
    } else {
        // New layout: the bundle/exe sits at the project root, so the
        // supporting-files directory is the app/ sibling next to it.
        container.join("app")
    }
}

pub(crate) fn get_default_cwd() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        return resolve_project_root(exe_path);
    }
    
    // Fallback to home directory without external dirs dependency
    #[cfg(target_os = "windows")]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            return PathBuf::from(home);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home);
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"))
}

enum PtyMessage {
    Output(Vec<u8>),
    Terminated,
    Error,
}

fn emit_output<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    broadcast_tx: &Option<tokio::sync::broadcast::Sender<crate::web_server::WsServerEvent>>,
    data: &[u8],
) {
    crate::quit_guard::note_output();
    let _ = app.emit("pty-output", PtyOutputPayload { data: data.to_vec() });
    if let Some(ref tx) = broadcast_tx {
        let _ = tx.send(crate::web_server::WsServerEvent::Output(data.to_vec()));
    }

    // Lossy-decoding here is fine even if it mangles a
    // boundary-spanning character: this text is only used
    // for prompt-pattern matching, not display, so an
    // occasional stray replacement character has no visible
    // effect on what the user sees in the terminal.
    let raw_data = String::from_utf8_lossy(data).into_owned();

    // Clean text and check prompt pattern
    let clean_text = strip_ansi_rust(&raw_data);
    if let Some(prompt) = detect_prompts(&clean_text) {
        // If it's a login link, open default OS browser
        if prompt.prompt_type == "login" {
            if let Some(ref url) = prompt.url {
                let _ = app.opener().open_path(url, None::<String>);
            }
        }
        
        let _ = app.emit("pty-prompt", prompt.clone());
        if let Some(ref tx) = broadcast_tx {
            let _ = tx.send(crate::web_server::WsServerEvent::Prompt(prompt));
        }
    }
}

pub async fn start_pty_internal<R: tauri::Runtime>(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    app: tauri::AppHandle<R>,
    state: &PtyState,
) -> Result<(), String> {
    let _ = stop_pty_internal(state).await;

    // Default to a reasonable size if the frontend didn't report the
    // xterm.js viewport's actual fitted size yet. Whenever this doesn't
    // match what's really being rendered, interactive CLIs that redraw via
    // relative cursor movement (e.g. "up N rows, clear, redraw") can target
    // the wrong row and leave stale content behind instead of overwriting it.
    let rows = rows.unwrap_or(40);
    let cols = cols.unwrap_or(300);

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let project_root = std::env::current_exe()
        .map(resolve_project_root)
        .unwrap_or_else(|_| get_default_cwd());
    let args = resolve_launch_args(args, &project_root);

    let mut cmd = CommandBuilder::new(&command);
    cmd.args(args);
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("COLUMNS", cols.to_string());
    cmd.env("LINES", rows.to_string());
    // Ensure the terminal is recognized as a modern UTF-8 capable terminal
    // with 256color/truecolor support. This prevents CLI tools (like agy) from
    // falling back to dumb terminal mode and outputting Unicode characters
    // (like progress spinners) as raw escape sequences like \xxxx.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("COLORFGBG", colorfgbg(TERMINAL_IS_DARK.load(std::sync::atomic::Ordering::Relaxed)));
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");

    // Add local bin directories to PATH so that command-line tools like marp,
    // agy or claude are directly accessible inside the PTY shell.
    cmd.env("PATH", child_path_env());

    if let Some(cwd_path) = cwd {
        if !cwd_path.is_empty() {
            cmd.cwd(PathBuf::from(cwd_path));
        } else {
            cmd.cwd(get_default_cwd());
        }
    } else {
        cmd.cwd(get_default_cwd());
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    *state.session.lock().await = Some(pair.master);
    *state.writer.lock().await = Some(writer);
    *state.child.lock().await = Some(child);
    let my_generation = state.generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let child_handle = state.child.clone();
    let generation_handle = state.generation.clone();

    // TEMPORARY: raw PTY byte log for diagnosing rendering bugs in the
    // upstream CLI's own output. Truncated fresh on every session start.
    let debug_log_path = debug_log_path();
    let _ = std::fs::write(&debug_log_path, b"");
    debug_log_marker(&format!("start_pty rows={rows} cols={cols}"));

    let app_clone = app.clone();
    let broadcast_tx = state.broadcast_tx.read().await.clone();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<PtyMessage>(1024);

    // Spawn PTY reader thread that pushes read chunks to the channel
    let debug_log_path_clone = debug_log_path.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = tx.blocking_send(PtyMessage::Terminated);
                    break;
                }
                Ok(n) => {
                    if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(&debug_log_path_clone) {
                        use std::io::Write as _;
                        let _ = f.write_all(&buffer[..n]);
                    }

                    if tx.blocking_send(PtyMessage::Output(buffer[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(_) => {
                    let _ = tx.blocking_send(PtyMessage::Error);
                    break;
                }
            }
        }
    });

    // Spawn tokio task that flushes accumulated output to the frontend with batching
    tokio::spawn(async move {
        let mut accumulated = Vec::new();
        let mut last_flush = std::time::Instant::now();
        let flush_interval = std::time::Duration::from_millis(15); // 15ms batching window
        // The session also ends when its process exits, even if the output
        // pipe never reports EOF. Confirmed on Windows (2026-11-26): ConPTY
        // kept the pipe open after `self_update.py apply` exited, so
        // "terminated" never fired and the app never restarted into the
        // update (the same root cause as installers that "never finish").
        let mut last_exit_check = std::time::Instant::now();
        let mut exited_at: Option<std::time::Instant> = None;

        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(5), rx.recv()).await {
                Ok(Some(PtyMessage::Output(chunk))) => {
                    accumulated.extend_from_slice(&chunk);

                    // Flush immediately if buffer size is large (>= 16 KB)
                    // or if the flush interval has elapsed.
                    if accumulated.len() >= 16384 || last_flush.elapsed() >= flush_interval {
                        emit_output(&app_clone, &broadcast_tx, &accumulated);
                        accumulated.clear();
                        last_flush = std::time::Instant::now();
                    }
                }
                Ok(Some(PtyMessage::Terminated)) => {
                    if !accumulated.is_empty() {
                        emit_output(&app_clone, &broadcast_tx, &accumulated);
                    }
                    let _ = app_clone.emit("pty-status", "terminated");
                    if let Some(ref tx) = broadcast_tx {
                        let _ = tx.send(crate::web_server::WsServerEvent::Status("terminated".to_string()));
                    }
                    break;
                }
                Ok(Some(PtyMessage::Error)) => {
                    if !accumulated.is_empty() {
                        emit_output(&app_clone, &broadcast_tx, &accumulated);
                    }
                    let _ = app_clone.emit("pty-status", "error");
                    if let Some(ref tx) = broadcast_tx {
                        let _ = tx.send(crate::web_server::WsServerEvent::Status("error".to_string()));
                    }
                    break;
                }
                Ok(None) => {
                    break;
                }
                Err(_) => {
                    // Timeout (5ms idle). Flush immediately to keep interactive inputs responsive.
                    if !accumulated.is_empty() {
                        emit_output(&app_clone, &broadcast_tx, &accumulated);
                        accumulated.clear();
                        last_flush = std::time::Instant::now();
                    }
                    if last_exit_check.elapsed() >= CHILD_EXIT_POLL {
                        last_exit_check = std::time::Instant::now();
                        match exited_at {
                            None => match child_exit_state(&child_handle, &generation_handle, my_generation) {
                                ChildState::Exited => exited_at = Some(std::time::Instant::now()),
                                ChildState::Superseded => break, // stopped/replaced: not ours to report
                                ChildState::Running => {}
                            },
                            // A moment for the last output to arrive, then end
                            // the session as if the pipe had closed.
                            Some(t) if t.elapsed() >= CHILD_EXIT_GRACE => {
                                if generation_handle.load(std::sync::atomic::Ordering::SeqCst) == my_generation {
                                    let _ = app_clone.emit("pty-status", "terminated");
                                    if let Some(ref tx) = broadcast_tx {
                                        let _ = tx.send(crate::web_server::WsServerEvent::Status("terminated".to_string()));
                                    }
                                }
                                break;
                            }
                            Some(_) => {}
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

/// How often a session checks whether its process has exited, and how long
/// it then waits for trailing output before reporting "terminated".
const CHILD_EXIT_POLL: std::time::Duration = std::time::Duration::from_millis(250);
const CHILD_EXIT_GRACE: std::time::Duration = std::time::Duration::from_millis(500);

#[derive(Debug, PartialEq)]
pub(crate) enum ChildState {
    Running,
    Exited,
    /// This session was stopped or replaced by a newer one.
    Superseded,
}

pub(crate) fn child_exit_state(
    child: &Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
    generation: &std::sync::atomic::AtomicU64,
    mine: u64,
) -> ChildState {
    if generation.load(std::sync::atomic::Ordering::SeqCst) != mine {
        return ChildState::Superseded;
    }
    let Ok(mut guard) = child.try_lock() else { return ChildState::Running };
    match guard.as_mut() {
        None => ChildState::Superseded, // stop_pty took it (and reports itself)
        Some(c) => match c.try_wait() {
            Ok(Some(_)) => ChildState::Exited,
            _ => ChildState::Running,
        },
    }
}

pub async fn stop_pty_internal(state: &PtyState) -> Result<(), String> {
    let mut child_guard = state.child.lock().await;
    if let Some(mut child) = child_guard.take() {
        let _ = child.kill();
    }
    
    let mut writer_guard = state.writer.lock().await;
    *writer_guard = None;

    let mut session_guard = state.session.lock().await;
    *session_guard = None;

    Ok(())
}

pub async fn write_to_pty_internal(input: String, state: &PtyState) -> Result<(), String> {
    let mut writer_guard = state.writer.lock().await;
    if let Some(ref mut writer) = *writer_guard {
        writer
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("PTY session not started or writer not available".to_string())
    }
}

pub async fn resize_pty_internal(rows: u16, cols: u16, state: &PtyState) -> Result<(), String> {
    let session_guard = state.session.lock().await;
    if let Some(ref master) = *session_guard {
        debug_log_marker(&format!("resize_pty rows={rows} cols={cols}"));
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Tauri Command Wrapper ---

#[tauri::command]
pub async fn start_pty(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    start_pty_internal(command, args, cwd, rows, cols, app, &state).await
}

#[tauri::command]
pub async fn resize_pty(
    rows: u16,
    cols: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    resize_pty_internal(rows, cols, &state).await
}

#[tauri::command]
pub async fn write_to_pty(
    input: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    write_to_pty_internal(input, &state).await
}

#[tauri::command]
pub async fn stop_pty(state: State<'_, PtyState>) -> Result<(), String> {
    stop_pty_internal(&state).await
}

#[tauri::command]
pub async fn force_kill_pty(app: AppHandle, state: State<'_, PtyState>) -> Result<(), String> {
    let mut child_guard = state.child.lock().await;
    if let Some(mut child) = child_guard.take() {
        #[cfg(target_os = "windows")]
        {
            if let Some(pid) = child.process_id() {
                let _ = std::process::Command::new("taskkill")
                    .args(&["/F", "/T", "/PID", &pid.to_string()])
                    .output();
            } else {
                let _ = child.kill();
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if let Some(pid) = child.process_id() {
                let _ = std::process::Command::new("kill")
                    .args(&["-9", &format!("-{}", pid)])
                    .output();
            } else {
                let _ = child.kill();
            }
        }
    }

    let mut writer_guard = state.writer.lock().await;
    *writer_guard = None;

    let mut session_guard = state.session.lock().await;
    *session_guard = None;

    let _ = app.emit("pty-status", "terminated");

    Ok(())
}

#[tauri::command]
pub fn get_app_bundle_dir() -> Result<String, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        Ok(resolve_app_bundle_dir(exe_path).to_string_lossy().to_string())
    } else {
        Err("Failed to get current executable path".to_string())
    }
}

// --- Test Code ---

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn_short_lived() -> Box<dyn portable_pty::Child + Send + Sync> {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 10, cols: 40, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = if cfg!(windows) {
            let mut c = CommandBuilder::new("cmd");
            c.args(["/C", "exit 0"]);
            c
        } else {
            CommandBuilder::new("true")
        };
        cmd.cwd(std::env::temp_dir());
        let child = pair.slave.spawn_command(cmd).unwrap();
        // keep the master alive like a real session (pipe stays open)
        std::mem::forget(pair.master);
        child
    }

    #[tokio::test]
    async fn detects_a_finished_process_even_with_the_pipe_open() {
        // Windows 2026-11-26: ConPTY kept the pipe open after the update
        // script exited -> "terminated" never fired -> no restart.
        let child = Arc::new(Mutex::new(Some(spawn_short_lived())));
        let generation = std::sync::atomic::AtomicU64::new(7);
        let mut state = ChildState::Running;
        for _ in 0..100 {
            state = child_exit_state(&child, &generation, 7);
            if state == ChildState::Exited {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert_eq!(state, ChildState::Exited);
    }

    #[tokio::test]
    async fn a_stopped_or_newer_session_is_not_reported_as_ours() {
        let child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>> = Arc::new(Mutex::new(None));
        let generation = std::sync::atomic::AtomicU64::new(3);
        assert_eq!(child_exit_state(&child, &generation, 3), ChildState::Superseded, "stop_pty took it");
        let child = Arc::new(Mutex::new(Some(spawn_short_lived())));
        assert_eq!(child_exit_state(&child, &generation, 2), ChildState::Superseded, "a newer session started");
    }

    #[test]
    fn exit_timing_is_short() {
        assert!(CHILD_EXIT_POLL <= std::time::Duration::from_millis(500));
        assert!(CHILD_EXIT_GRACE <= std::time::Duration::from_secs(2));
    }

    #[test]
    fn test_resolve_launch_args_expands_project_root() {
        let dir = std::env::temp_dir().join(format!("agentdeck-args-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(dir.join(".claude").join("agent-deck-settings.json"), "{}").unwrap();
        let out = resolve_launch_args(
            vec!["--settings".into(), "${PROJECT_ROOT}/.claude/agent-deck-settings.json".into(), "--x".into()],
            &dir,
        );
        assert_eq!(out[0], "--settings");
        assert_eq!(out[1], format!("{}/.claude/agent-deck-settings.json", dir.to_string_lossy()));
        assert_eq!(out[2], "--x");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_resolve_launch_args_drops_missing_settings_file() {
        let out = resolve_launch_args(
            vec!["--settings".into(), "${PROJECT_ROOT}/nope.json".into(), "--verbose".into()],
            Path::new("/definitely/not/here"),
        );
        assert_eq!(out, vec!["--verbose".to_string()]);
        // inline JSON settings are kept as-is
        let out = resolve_launch_args(vec!["--settings".into(), "{\"a\":1}".into()], Path::new("/x"));
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn test_prepend_path_entries_adds_missing_in_order_and_skips_existing() {
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let base = format!("/usr/bin{}/home/u/.local/bin", sep);
        let out = prepend_path_entries(&base, &["/a".to_string(), "/home/u/.local/bin".to_string(), "/a".to_string()]);
        assert_eq!(out, format!("/a{}{}", sep, base));
        // exact-entry match, not substring: /usr/bin present must not hide /usr
        let out2 = prepend_path_entries("/usr/bin", &["/usr".to_string()]);
        assert_eq!(out2, format!("/usr{}/usr/bin", sep));
        assert_eq!(prepend_path_entries("", &["/x".to_string()]), "/x");
    }

    #[test]
    fn test_user_bin_dirs_includes_local_bin_for_claude_native_installer() {
        let dirs = user_bin_dirs(Some("/Users/someone"));
        let expected = Path::new("/Users/someone").join(".local").join("bin").to_string_lossy().to_string();
        assert!(dirs.contains(&expected));
        assert!(!user_bin_dirs(None).iter().any(|d| d.contains(".local")));
    }

    #[test]
    fn test_child_path_env_contains_inherited_path() {
        let inherited = std::env::var("PATH").unwrap_or_default();
        let first = inherited.split(if cfg!(target_os = "windows") { ';' } else { ':' }).next().unwrap_or("").to_string();
        assert!(child_path_env().contains(&first));
    }

    // Real Claude Code 2.1.x folder-trust frame (captured from a PTY):
    // words separated by ESC[<n>G column moves, "No, exit" listed first.
    const CLAUDE_TRUST_RAW: &str = "\x1b[2GQuick\x1b[8Gsafety\x1b[15Gcheck:\x1b[22GIs\x1b[25Gthis\x1b[30Ga\x1b[32Gproject\x1b[40Gyou\x1b[44Gcreated\x1b[52Gor\x1b[55Gone\x1b[59Gyou\x1b[63Gtrust?\r\r\n\x1b[2G\x1b[94m\u{276f}\x1b[4GNo,\x1b[8Gexit\x1b[39m\r\r\n\x1b[4GYes,\x1b[9GI\x1b[11Gtrust\x1b[17Gthis\x1b[22Gfolder\r\r\n\r\r\n\x1b[2G\x1b[37m\x1b[2mEnter\x1b[8Gto\x1b[11Gconfirm\x1b[19G\u{b7}\x1b[21GEsc\x1b[25Gto\x1b[28Gcancel\x1b[22m\x1b[39m\r\r\n";

    #[test]
    fn test_strip_ansi_keeps_word_gaps_drawn_as_column_moves() {
        let clean = strip_ansi_rust(CLAUDE_TRUST_RAW);
        assert!(clean.contains("Yes, I trust this folder"), "{clean}");
        assert!(clean.contains("No, exit"));
    }

    #[test]
    fn test_detect_claude_trust_dialog_orders_no_first() {
        let p = detect_prompts(&strip_ansi_rust(CLAUDE_TRUST_RAW)).unwrap();
        assert_eq!(p.prompt_type, "confirm");
        assert_eq!(p.options.unwrap(), vec!["No, exit", "Yes, I trust this folder"]);
        assert_eq!(p.inputs.unwrap(), vec!["\r".to_string(), "\x1b[B\r".to_string()]);
    }

    #[test]
    fn test_detect_agy_trust_dialog_orders_yes_first() {
        let text = "Do you trust the contents of this project?\n> Yes, I trust this folder\n  No, exit\n";
        let p = detect_prompts(text).unwrap();
        assert_eq!(p.options.unwrap(), vec!["Yes, I trust this folder", "No, exit"]);
        assert_eq!(p.inputs.unwrap(), vec!["\r".to_string(), "\x1b[B\r".to_string()]);
    }

    #[test]
    fn test_detect_claude_numbered_permission_menu() {
        // Real Claude Code 2.1.x Bash permission frame, after strip_ansi_rust.
        let text = " Bash command Create empty hello.txt file touch hello.txt Do you want to proceed? \u{276f} 1. Yes 2. Yes, and always allow access to      /private/tmp/x/permprobe from this project   3. Yes, and switch to auto mode \u{b7} auto mode handles these prompts for you   4. No Esc to cancel \u{b7} Tab to amend";
        let p = detect_prompts(text).unwrap();
        assert_eq!(p.prompt_type, "confirm");
        assert_eq!(p.message, "Do you want to proceed?");
        let opts = p.options.unwrap();
        assert_eq!(opts.len(), 4);
        assert_eq!(opts[0], "1. Yes");
        assert_eq!(opts[1], "2. Yes, and always allow access to /private/tmp/x/permprobe from this project");
        assert!(opts[2].starts_with("3. Yes, and switch to auto mode"));
        assert_eq!(opts[3], "4. No");
        let inputs = p.inputs.unwrap();
        assert_eq!(inputs[0], "\r");
        assert_eq!(inputs[3], "\x1b[B\x1b[B\x1b[B\r");
    }

    #[test]
    fn test_detect_claude_edit_menu() {
        let text = "Do you want to make this edit to notes.md?\n\u{276f} 1. Yes\n  2. Yes, allow all edits during this session (shift+tab)\n  3. No\n\nEsc to cancel";
        let p = detect_prompts(text).unwrap();
        assert_eq!(p.message, "Do you want to make this edit to notes.md?");
        assert_eq!(p.options.unwrap().len(), 3);
    }

    #[test]
    fn test_numbered_menu_requires_footer_and_sequence() {
        assert!(detect_numbered_menu("Do you want to proceed? 1. Yes 2. No").is_none());
        assert!(detect_numbered_menu("Do you want to proceed? 1. Yes 3. No Esc to cancel").is_none());
    }

    #[test]
    fn test_detect_prompts_generic_yn_permission() {
        let text = "Allow tool execution? [y/N]";
        let payload = detect_prompts(text).unwrap();
        assert_eq!(payload.prompt_type, "confirm");
        assert_eq!(payload.message, "The agent is requesting tool/file permission.");
        assert_eq!(payload.options.unwrap(), vec!["y".to_string(), "n".to_string()]);

        let text = "Allow file edit? [y/N]";
        let payload = detect_prompts(text).unwrap();
        assert_eq!(payload.prompt_type, "confirm");

        let text = "Allow web search? [y/N]";
        let payload = detect_prompts(text).unwrap();
        assert_eq!(payload.prompt_type, "confirm");
    }

    #[test]
    fn test_pty_spawn_and_cwd() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();

        let target_cwd = std::env::temp_dir();
        
        #[cfg(target_os = "windows")]
        let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(target_os = "windows")]
        cmd.args(&["/c", "cd"]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = CommandBuilder::new("pwd");

        cmd.cwd(target_cwd.clone());

        let mut child = pair.slave.spawn_command(cmd).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();

        let mut buffer = [0u8; 1024];
        let n = reader.read(&mut buffer).unwrap();
        let output = String::from_utf8_lossy(&buffer[..n]);
        let _ = child.wait().unwrap();

        println!("PTY Output: {}", output);
        println!("Target CWD: {}", target_cwd.to_string_lossy());
        
        assert!(n > 0);
    }

    #[test]
    fn test_strip_ansi_rust() {
        let text_with_colors = "\x1b[31mRed Text\x1b[0m and \x1b[1;34mBold Blue\x1b[0m";
        let clean = strip_ansi_rust(text_with_colors);
        assert_eq!(clean, "Red Text and Bold Blue");
    }

    #[test]
    fn test_detect_login_url() {
        let raw_output = "To sign in, please open the following URL in your browser:\nhttps://accounts.google.com/o/oauth2/device/auth?user_code=ABCD-EFGH\nWaiting for authentication...";
        let prompt = detect_prompts(raw_output);
        assert!(prompt.is_some());
        let p = prompt.unwrap();
        assert_eq!(p.prompt_type, "login");
        assert_eq!(p.url.unwrap(), "https://accounts.google.com/o/oauth2/device/auth?user_code=ABCD-EFGH");
    }

    #[test]
    fn test_detect_confirm_prompt() {
        let raw_confirm = "Do you want to proceed? [y/N]: ";
        let prompt = detect_prompts(raw_confirm);
        assert!(prompt.is_some());
        let p = prompt.unwrap();
        assert_eq!(p.prompt_type, "confirm");
        assert_eq!(p.options.unwrap(), vec!["Yes".to_string(), "No".to_string()]);
    }

    #[test]
    fn test_detect_path_prompt() {
        let raw_path = "Enter installation directory path: ";
        let prompt = detect_prompts(raw_path);
        assert!(prompt.is_some());
        let p = prompt.unwrap();
        assert_eq!(p.prompt_type, "path");
    }

    #[tokio::test]
    async fn test_start_pty_and_emission() {
        use tauri::test::mock_app;
        use tauri::Listener;

        let app = mock_app();
        let handle = app.handle().clone();
        
        let state = PtyState::default();

        #[cfg(target_os = "windows")]
        let cmd = "cmd.exe".to_string();
        #[cfg(target_os = "windows")]
        let args = vec!["/c".to_string(), "echo integration-test".to_string()];

        #[cfg(not(target_os = "windows"))]
        let cmd = "echo".to_string();
        #[cfg(not(target_os = "windows"))]
        let args = vec!["integration-test".to_string()];

        let (tx, mut rx) = tokio::sync::mpsc::channel(10);
        let tx_clone = tx.clone();
        
        handle.listen("pty-output", move |event| {
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                if let Some(bytes) = payload.get("data").and_then(|v| v.as_array()) {
                    let data: Vec<u8> = bytes
                        .iter()
                        .filter_map(|b| b.as_u64())
                        .map(|b| b as u8)
                        .collect();
                    let text = String::from_utf8_lossy(&data).into_owned();
                    let _ = tx_clone.try_send(text);
                }
            }
        });

        let start_res = start_pty_internal(cmd, args, None, None, None, handle.clone(), &state).await;
        assert!(start_res.is_ok());

        let mut received = String::new();
        let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(3));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                Some(data) = rx.recv() => {
                    received.push_str(&data);
                    if received.contains("integration-test") {
                        break;
                    }
                }
                _ = &mut timeout => {
                    panic!("Timeout waiting for PTY event. Received: '{}'", received);
                }
            }
        }

        assert!(received.contains("integration-test"));
        
        let stop_res = stop_pty_internal(&state).await;
        assert!(stop_res.is_ok());
    }

    #[test]
    fn test_get_default_cwd() {
        let cwd = get_default_cwd();
        assert!(!cwd.to_string_lossy().is_empty());
        assert!(cwd.exists());
        assert!(cwd.is_dir());
    }

    #[test]
    fn test_resolve_project_root_hierarchy() {
        // Old layout: a parent project's installer (e.g. agent-deck's
        // install_agent_ui.py) placed the bundle/exe inside an app/ wrapper.
        #[cfg(target_os = "macos")]
        {
            let mock_exe = PathBuf::from("/Users/test/agent-deck/app/agent-ui.app/Contents/MacOS/agent-ui");
            let resolved = resolve_project_root(mock_exe);
            assert_eq!(resolved, PathBuf::from("/Users/test/agent-deck"));
        }

        #[cfg(not(target_os = "macos"))]
        {
            // Windows mock path (testing with backslashes on windows, forward slashes on linux)
            let mock_exe = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck\\app\\agent-ui.exe")
            } else {
                PathBuf::from("/home/test/agent-deck/app/agent-ui.exe")
            };
            let resolved = resolve_project_root(mock_exe.clone());

            let expected = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck")
            } else {
                PathBuf::from("/home/test/agent-deck")
            };
            assert_eq!(resolved, expected);
        }
    }

    #[test]
    fn test_resolve_project_root_direct_at_root() {
        // New layout (2026-07-16): the bundle/exe sits directly at the
        // project root, with supporting binaries/scripts/venv under an app/
        // sibling instead of app/ being the bundle's own container.
        #[cfg(target_os = "macos")]
        {
            let mock_exe = PathBuf::from("/Users/test/agent-deck/agent-deck.app/Contents/MacOS/agent-ui");
            let resolved = resolve_project_root(mock_exe);
            assert_eq!(resolved, PathBuf::from("/Users/test/agent-deck"));
        }

        #[cfg(not(target_os = "macos"))]
        {
            let mock_exe = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck\\agent-deck.exe")
            } else {
                PathBuf::from("/home/test/agent-deck/agent-deck.exe")
            };
            let resolved = resolve_project_root(mock_exe);

            let expected = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck")
            } else {
                PathBuf::from("/home/test/agent-deck")
            };
            assert_eq!(resolved, expected);
        }
    }

    #[test]
    fn test_resolve_app_bundle_dir_hierarchy() {
        // Old layout: app/ is the bundle's own container.
        #[cfg(target_os = "macos")]
        {
            let mock_exe = PathBuf::from("/Users/test/agent-deck/app/agent-ui.app/Contents/MacOS/agent-ui");
            let resolved = resolve_app_bundle_dir(mock_exe);
            // One level shallower than resolve_project_root: the wrapper
            // folder containing the .app bundle, not the project root above it.
            assert_eq!(resolved, PathBuf::from("/Users/test/agent-deck/app"));
        }

        #[cfg(not(target_os = "macos"))]
        {
            let mock_exe = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck\\app\\agent-ui.exe")
            } else {
                PathBuf::from("/home/test/agent-deck/app/agent-ui.exe")
            };
            let resolved = resolve_app_bundle_dir(mock_exe);

            let expected = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck\\app")
            } else {
                PathBuf::from("/home/test/agent-deck/app")
            };
            assert_eq!(resolved, expected);
        }
    }

    #[test]
    fn test_resolve_app_bundle_dir_direct_at_root() {
        // New layout (2026-07-16): app/ is a SIBLING of the bundle/exe, not
        // its container — resolve_app_bundle_dir must still point at app/,
        // now by appending it rather than stopping one level short.
        #[cfg(target_os = "macos")]
        {
            let mock_exe = PathBuf::from("/Users/test/agent-deck/agent-deck.app/Contents/MacOS/agent-ui");
            let resolved = resolve_app_bundle_dir(mock_exe);
            assert_eq!(resolved, PathBuf::from("/Users/test/agent-deck/app"));
        }

        #[cfg(not(target_os = "macos"))]
        {
            let mock_exe = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck\\agent-deck.exe")
            } else {
                PathBuf::from("/home/test/agent-deck/agent-deck.exe")
            };
            let resolved = resolve_app_bundle_dir(mock_exe);

            let expected = if cfg!(target_os = "windows") {
                PathBuf::from("C:\\Users\\test\\agent-deck\\app")
            } else {
                PathBuf::from("/home/test/agent-deck/app")
            };
            assert_eq!(resolved, expected);
        }
    }

    #[tokio::test]
    async fn test_pty_env_propagation() {
        use tauri::test::mock_app;
        use tauri::Listener;

        let app = mock_app();
        let handle = app.handle().clone();
        let state = PtyState::default();

        // Print target environment variables to verify they propagate properly
        #[cfg(not(target_os = "windows"))]
        let cmd = "sh".to_string();
        #[cfg(not(target_os = "windows"))]
        let args = vec![
            "-c".to_string(),
            "echo TERM=$TERM; echo COLORTERM=$COLORTERM; echo PYTHONIOENCODING=$PYTHONIOENCODING; echo PATH=$PATH".to_string(),
        ];

        #[cfg(target_os = "windows")]
        let cmd = "powershell.exe".to_string();
        #[cfg(target_os = "windows")]
        let args = vec![
            "-Command".to_string(),
            "Write-Output \"TERM=$env:TERM\"; Write-Output \"COLORTERM=$env:COLORTERM\"; Write-Output \"PYTHONIOENCODING=$env:PYTHONIOENCODING\"; Write-Output \"PATH=$env:PATH\"".to_string(),
        ];

        let (tx, mut rx) = tokio::sync::mpsc::channel(10);
        let tx_clone = tx.clone();
        
        handle.listen("pty-output", move |event| {
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                if let Some(bytes) = payload.get("data").and_then(|v| v.as_array()) {
                    let data: Vec<u8> = bytes
                        .iter()
                        .filter_map(|b| b.as_u64())
                        .map(|b| b as u8)
                        .collect();
                    let text = String::from_utf8_lossy(&data).into_owned();
                    let _ = tx_clone.try_send(text);
                }
            }
        });

        let start_res = start_pty_internal(cmd, args, None, None, None, handle.clone(), &state).await;
        assert!(start_res.is_ok());

        let mut received = String::new();
        let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(5));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                Some(data) = rx.recv() => {
                    received.push_str(&data);
                    if received.contains("TERM=xterm-256color") 
                        && received.contains("COLORTERM=truecolor") 
                        && received.contains("PYTHONIOENCODING=utf-8")
                        && received.contains("PATH=") {
                        break;
                    }
                }
                _ = &mut timeout => {
                    panic!("Timeout waiting for PTY env. Received: '{}'", received);
                }
            }
        }

        assert!(received.contains("TERM=xterm-256color"));
        assert!(received.contains("COLORTERM=truecolor"));
        assert!(received.contains("PYTHONIOENCODING=utf-8"));
        assert!(received.contains("PATH="));
        
        let stop_res = stop_pty_internal(&state).await;
        assert!(stop_res.is_ok());
    }

    #[test]
    fn colorfgbg_reports_background_brightness() {
        // Claude Code's "auto" theme: last field <= 6 or == 8 means dark.
        assert_eq!(colorfgbg(true), "15;0");
        assert_eq!(colorfgbg(false), "0;15");
    }
}
