#!/usr/bin/env python3
"""PreToolUse guard for agent-deck sessions (app_specs.md 5.7.4).

Both engines call this before file / shell tools run:
  agy:    ~/.gemini/config/hooks.json  ("agent-deck-guard", installed by setup.py)
  claude: .claude/agent-deck-settings.json  ("hooks" -> PreToolUse)

It only acts inside sessions agent-deck started (AGENT_DECK_SESSION_ID is
set in their environment); your own agy / claude elsewhere is untouched.

  * sensitive credential/config paths (~/.ssh, ~/.aws, ~/.gemini/config, ...)
    -> deny (read & write for agy; write & shell for both)
  * OS system directories (/etc, /System, C:\\Windows, ...) -> deny writes
  * protected agent-deck install files (python/scripts, python/skills,
    agent_config.json, AGENTS.md, config/, .claude/, tmp/agent-deck-sessions.json,
    other tabs' tmp/sessions/<id>/) -> deny writes even when cwd == root
  * a write into ANOTHER tab's working folder -> deny
    (two agents must never edit the same files; the tab list in
    <root>/tmp/agent-deck-sessions.json comes from the app)
  * shell commands targeting another tab's folder, guard files, sensitive
    paths, or writing to protected install files -> deny
  * a write outside this tab's working folder, its workspace folders and
    the install's shared writable areas (files/, tmp/, python/skills-personal/)
    -> ask the user first (agy: force_ask)
  * anything else -> no opinion (normal rules)

Why a hook: agy ignores the Gemini-style ~/.gemini/policies, its Auto mode
writes outside the workspace without asking in some cases, and agy's own
permission rules can't say "only inside this folder" (deny beats allow).
Confirmed 2026-11-26.

Never fails closed on its own bugs: any error -> no opinion, so a broken
hook can't wedge every session.
"""
import json
import os
import re
import shlex
import sys
from pathlib import Path

REGISTRY_NAME = "agent-deck-sessions.json"

AGY_WRITE_TOOLS = (
    "write_file", "write_to_file", "replace_file_content", "multi_replace_file_content",
    "edit_file", "create_file", "delete_file", "apply_patch", "edit_notebook", "rename_file",
    "replace", "move_file", "patch_file", "notebook_edit",
)
AGY_READ_TOOLS = (
    "read_file", "view_file", "view_file_outline", "view_code_item",
    "list_dir", "find_by_name", "grep_search", "read_notebook",
)
AGY_SHELL_TOOLS = ("run_shell_command", "run_command")
AGY_MATCHER = "|".join((*AGY_WRITE_TOOLS, *AGY_READ_TOOLS, *AGY_SHELL_TOOLS))

CLAUDE_WRITE_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
CLAUDE_SHELL_TOOLS = ("Bash",)
CLAUDE_MATCHER = "|".join((*CLAUDE_WRITE_TOOLS, *CLAUDE_SHELL_TOOLS))

_PATCH_FILE = re.compile(r"^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$", re.M)
_PATH_KEY = re.compile(r"(path|file|target|destination|source)", re.I)
_SHELL_CMD_KEYS = ("command", "CommandLine", "cmd")

# Home-relative directories / files that must never be accessed by agents.
_SENSITIVE_HOME_DIRS = (
    ".ssh", ".aws", ".gnupg", ".kube", ".vault", ".terraform",
    ".anthropic", ".openai", ".config", "Library", "AppData",
)
_SENSITIVE_HOME_FILES = (
    ".netrc", ".npmrc", ".pypirc", ".gitconfig", ".env", ".envrc",
    ".bashrc", ".bash_profile", ".zshrc", ".zprofile", ".profile",
)
# Agent config dirs: writes are always denied; reads are denied except installed skills/.
_SENSITIVE_AGENT_DIRS = (".gemini", ".claude")

# POSIX system roots protected from writes (temp/pytest roots excluded below).
_POSIX_SYSTEM_DIRS = (
    "/etc", "/usr", "/bin", "/sbin", "/opt", "/System", "/Library",
    "/dev", "/Applications", "/private", "/var",
)
_POSIX_TEMP_EXCEPTIONS = ("/tmp", "/private/tmp", "/var/folders", "/private/var/folders")
_WIN_SYSTEM_RE = re.compile(
    r"^[a-z]:/(?:windows|program files|program files \(x86\)|programdata|system32|syswow64)(?:/|$)",
    re.I,
)

# Writable subdirectories inside the agent-deck install root.
_INSTALL_WRITABLE_SUBDIRS = ("files", "tmp", "python/skills-personal")

# Shell patterns that indicate a destructive / mutating command (beyond bare `>`).
# Negative lookbehind/lookahead on path separators prevents matching folder names
# like ".../install/..." or ".../rm-rf/...".
_SHELL_MUTATING_CMD_RE = re.compile(
    r"(?:(?<![/\\.\w-])(?:tee|cp|mv|rm|rmdir|unlink|chmod|chown|touch|mkdir|ln|dd|install|truncate|"
    r"Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item)(?![/\\.\w-])|"
    r"(?<![/\\.\w-])sed\s+-i\b|(?<![/\\.\w-])perl\s+-[^\s]*i|(?<![/\\.\w-])python3?\b[^\n]*\s-c\b)",
    re.I,
)
_SHELL_REDIRECT_TARGET_RE = re.compile(r"(?:^|[\s0-9&])>>?\s*([^\s;&|]+)")
_SHELL_GUARD_FILE_RE = re.compile(
    r"(?:agent-deck-sessions\.json|agent_deck_guard\.py|agent-deck-settings\.json|"
    r"\.gemini[/\\]config[/\\]hooks\.json)",
    re.I,
)
_SHELL_SENSITIVE_RE = re.compile(
    r"(?:(?:~|(?:\$HOME|\$\{HOME\}|%USERPROFILE%|/[Uu]sers/[^/\s\"']+|/home/[^/\s\"']+|[A-Za-z]:[/\\][Uu]sers[/\\][^/\\\s\"']+)[/\\])"
    r"(?:\.(?:ssh|aws|gnupg|kube|vault|terraform|anthropic|openai|config|netrc|npmrc|pypirc|gitconfig|env|envrc|"
    r"bashrc|bash_profile|zshrc|zprofile|profile)(?:[/\\\"\'\s;|$]|$)|"
    r"\.(?:gemini|claude)[/\\](?!skills(?:[/\\]|$))|"
    r"Library[/\\]|AppData[/\\])|"
    r"%APPDATA%|%LOCALAPPDATA%)",
    re.I,
)
_SHELL_PROTECTED_INSTALL_RE = re.compile(
    r"(?:^|[\s\"'=/\\])(?:python[/\\](?!skills-personal(?:[/\\]|$))|"
    r"\.claude[/\\]|\.gemini[/\\]|config[/\\]|"
    r"agent_config\.json|AGENTS\.md|CLAUDE\.md|preflight\.(?:sh|bat)|config\.toml)(?:[\s\"'/\\;|$]|$)",
    re.I,
)
_SHELL_SYSTEM_DIR_RE = re.compile(
    r"(?:^|[\s\"';|&(>])(?:/(?:etc|System|Library|dev|Applications|private/etc)/|"
    r"[A-Za-z]:[/\\](?:Windows|Program Files|ProgramData|System32|SysWOW64)[/\\])",
    re.I,
)


def _norm(p: str, case_insensitive: bool) -> str:
    try:
        r = os.path.realpath(os.path.expanduser(p))
    except (OSError, ValueError):
        r = os.path.abspath(os.path.expanduser(p))
    r = r.replace("\\", "/").rstrip("/") or "/"
    return r.lower() if case_insensitive else r


def is_within(path: str, folder: str, case_insensitive: bool) -> bool:
    if not path or not folder:
        return False
    p, f = _norm(path, case_insensitive), _norm(folder, case_insensitive)
    return p == f or p.startswith(f if f.endswith("/") else f + "/")


def _home_dir() -> str:
    try:
        return os.path.expanduser("~")
    except Exception:
        return ""


def is_sensitive_path(path: str, mode: str, case_insensitive: bool) -> bool:
    """True if path points into credentials, shell profiles, or agent configs."""
    home = _home_dir()
    if not home or home == "~":
        return False
    for name in _SENSITIVE_HOME_DIRS:
        if is_within(path, os.path.join(home, name), case_insensitive):
            return True
    for name in _SENSITIVE_HOME_FILES:
        if is_within(path, os.path.join(home, name), case_insensitive):
            return True
    for name in _SENSITIVE_AGENT_DIRS:
        base = os.path.join(home, name)
        if is_within(path, base, case_insensitive):
            if mode == "read" and is_within(path, os.path.join(base, "skills"), case_insensitive):
                return False
            return True
    return False


def is_system_write_path(path: str, case_insensitive: bool) -> bool:
    """True if path targets an OS system directory."""
    raw = path.replace("\\", "/")
    if _WIN_SYSTEM_RE.match(raw):
        return True
    p = _norm(path, case_insensitive)
    if _WIN_SYSTEM_RE.match(p):
        return True
    for exc in _POSIX_TEMP_EXCEPTIONS:
        if is_within(path, exc, case_insensitive):
            return False
    for sysdir in _POSIX_SYSTEM_DIRS:
        if is_within(path, sysdir, case_insensitive):
            return True
    return False


def is_protected_install_write(path: str, root: str, session_id: str, case_insensitive: bool) -> bool:
    """Inside the agent-deck install root, only files/, this tab's tmp/ (not
    the session registry or other tabs' tmp/sessions/<id>/), and
    python/skills-personal/ are writable."""
    if not root or not is_within(path, root, case_insensitive):
        return False
    # Never allow modifying the session registry or its atomic temp file.
    for reg in (REGISTRY_NAME, f"{REGISTRY_NAME}.tmp"):
        if is_within(path, os.path.join(root, "tmp", reg), case_insensitive):
            return True
    # Pasted screenshots are managed by agent-deck itself (read-only for agents).
    if is_within(path, os.path.join(root, "tmp", "screenshots"), case_insensitive):
        return True
    # Inside tmp/sessions/<id>/, only this session's own directory is writable.
    sessions_dir = os.path.join(root, "tmp", "sessions")
    if is_within(path, sessions_dir, case_insensitive):
        own_tmp = os.path.join(sessions_dir, session_id) if session_id else ""
        return not (own_tmp and is_within(path, own_tmp, case_insensitive))
    # Allowed writable areas inside install root.
    for sub in _INSTALL_WRITABLE_SUBDIRS:
        if is_within(path, os.path.join(root, sub), case_insensitive):
            return False
    return True


def is_protected_install_read(path: str, root: str, case_insensitive: bool) -> bool:
    """Protect saved browser cookies/profiles inside the install from direct reads."""
    if not root or not is_within(path, root, case_insensitive):
        return False
    for name in ("ChromeUserData", "ChromeUserData-bundled"):
        if is_within(path, os.path.join(root, "python", "scripts", "automation", name), case_insensitive):
            return True
    return False


def _install_writable_dirs(root: str) -> list:
    if not root:
        return []
    return [os.path.join(root, sub) for sub in _INSTALL_WRITABLE_SUBDIRS]


def target_paths(args, cwd: str) -> list:
    """Paths a file tool is about to touch, made absolute against cwd."""
    found = []

    def add(v):
        v = v.strip()
        if not v or len(v) >= 4096 or "\n" in v:
            return
        expanded = os.path.expanduser(v)
        found.append(expanded if os.path.isabs(expanded) else os.path.join(cwd or ".", expanded))

    def walk(obj, key=""):
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, k)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, key)
        elif isinstance(obj, str):
            for m in _PATCH_FILE.finditer(obj):
                add(m.group(1))
            if _PATH_KEY.search(key or ""):
                add(obj)

    walk(args)
    return found


def extract_shell_command(args) -> str:
    if not isinstance(args, dict):
        return ""
    for k in _SHELL_CMD_KEYS:
        v = args.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def load_registry(root: str) -> list:
    try:
        data = json.loads((Path(root) / "tmp" / REGISTRY_NAME).read_text(encoding="utf-8"))
        return [s for s in data.get("sessions", []) if isinstance(s, dict)]
    except (OSError, ValueError, AttributeError):
        return []


def _other_tabs(sessions, session_id: str, root: str, case_insensitive: bool) -> list:
    return [
        s for s in sessions
        if s.get("id") != session_id and s.get("cwd")
        # the install folder is shared by every tab (skills use files/, tmp/)
        and not (root and _norm(s["cwd"], case_insensitive) == _norm(root, case_insensitive))
    ]


def decide(paths, session_id: str, cwd: str, workspaces, root: str, sessions, case_insensitive: bool):
    """(decision, reason) or (None, None). decision: 'deny' | 'ask'."""
    if not paths:
        return None, None
    others = _other_tabs(sessions, session_id, root, case_insensitive)
    for p in paths:
        if is_sensitive_path(p, "write", case_insensitive):
            return "deny", (
                f"認証情報・設定ファイルへの書き込みは禁止されています: {p}"
                f" / Writing to credential or config files is blocked: {p}"
            )
        if is_system_write_path(p, case_insensitive):
            return "deny", (
                f"システムディレクトリへの書き込みは禁止されています: {p}"
                f" / Writing to system directories is blocked: {p}"
            )
        if is_protected_install_write(p, root, session_id, case_insensitive):
            return "deny", (
                f"agent-deck の保護されたファイルには書き込めません: {p}"
                f" / Writing to protected agent-deck files is blocked: {p}"
            )
        for o in others:
            if is_within(p, o["cwd"], case_insensitive):
                label = o.get("label") or o.get("id")
                return "deny", (
                    f"別のタブ「{label}」の作業フォルダ（{o['cwd']}）には書き込めません。2 つの AI が同じファイルを同時に編集しないためです。"
                    f" / Writing into another tab's working folder (\"{label}\": {o['cwd']}) is blocked so two agents never edit the same files."
                )

    allowed = [x for x in [*_install_writable_dirs(root), *workspaces] if x]
    # Add cwd unless cwd is the install root itself (in which case only the
    # install writable subdirs above are allowed, protected paths already denied).
    if cwd and not (root and _norm(cwd, case_insensitive) == _norm(root, case_insensitive)):
        allowed.append(cwd)
    outside = [p for p in paths if not any(is_within(p, a, case_insensitive) for a in allowed)]
    if outside:
        return "ask", (
            f"作業フォルダの外への書き込みです: {outside[0]} — 許可しますか？"
            f" / This writes outside the tab's working folder: {outside[0]}. Allow it?"
        )
    return None, None


def decide_read(paths, root: str, case_insensitive: bool):
    """(decision, reason) or (None, None) for read tools (used for agy)."""
    if not paths:
        return None, None
    for p in paths:
        if is_sensitive_path(p, "read", case_insensitive) or is_protected_install_read(p, root, case_insensitive):
            return "deny", (
                f"認証情報・設定ファイルへのアクセスは禁止されています: {p}"
                f" / Reading credential or config files is blocked: {p}"
            )
    return None, None


def _shell_tokens(cmd: str) -> list:
    try:
        tokens = shlex.split(cmd, posix=(os.name != "nt"))
    except ValueError:
        tokens = cmd.split()
    out = []
    for tok in tokens:
        out.append(tok)
        # Handle redirections glued to a path (e.g. ">/path", "2>/path") or key=value
        for sep in (">>", ">", "="):
            if sep in tok:
                part = tok.split(sep, 1)[1].strip("'\"")
                if part:
                    out.append(part)
    return out


def decide_shell(cmd: str, session_id: str, cwd: str, root: str, sessions, case_insensitive: bool):
    """Guard shell commands against bypassing file rules."""
    if not cmd or not cmd.strip():
        return None, None

    if _SHELL_GUARD_FILE_RE.search(cmd):
        return "deny", (
            "agent-deck のガード設定・セッション管理ファイルへのシェル操作は禁止されています。"
            " / Shell access to agent-deck guard or session registry files is blocked."
        )

    if _SHELL_SENSITIVE_RE.search(cmd):
        return "deny", (
            "認証情報・設定ファイルへのシェルアクセスは禁止されています。"
            " / Shell access to credential or config files is blocked."
        )

    is_mutating_cmd = bool(_SHELL_MUTATING_CMD_RE.search(cmd))
    redirect_targets = [m.group(1).strip("'\"") for m in _SHELL_REDIRECT_TARGET_RE.finditer(cmd)]

    if is_mutating_cmd and _SHELL_SYSTEM_DIR_RE.search(cmd):
        return "deny", (
            "システムディレクトリへのシェル書き込みは禁止されています。"
            " / Shell writes to system directories are blocked."
        )

    if is_mutating_cmd and _SHELL_PROTECTED_INSTALL_RE.search(cmd):
        return "deny", (
            "agent-deck の保護されたファイルへのシェル書き込みは禁止されています。"
            " / Shell writes to protected agent-deck files are blocked."
        )

    for rt in redirect_targets:
        expanded = os.path.expanduser(rt)
        cand = expanded if os.path.isabs(expanded) else os.path.join(cwd or ".", expanded)
        if is_system_write_path(cand, case_insensitive):
            return "deny", (
                f"システムディレクトリへのシェルリダイレクトは禁止されています: {rt}"
                f" / Shell redirection to system directories is blocked: {rt}"
            )
        if root and is_protected_install_write(cand, root, session_id, case_insensitive):
            return "deny", (
                f"agent-deck の保護されたファイルへのシェルリダイレクトは禁止されています: {rt}"
                f" / Shell redirection to protected agent-deck files is blocked: {rt}"
            )

    others = _other_tabs(sessions, session_id, root, case_insensitive)
    norm_cmd = cmd.replace("\\", "/")
    norm_cmd_cmp = norm_cmd.lower() if case_insensitive else norm_cmd

    # Check direct mentions or resolved token paths pointing into another tab's folder
    # or another tab's tmp/sessions/<id>.
    for o in others:
        o_norm = _norm(o["cwd"], case_insensitive)
        if o_norm and o_norm != "/" and o_norm in norm_cmd_cmp:
            label = o.get("label") or o.get("id")
            return "deny", (
                f"別のタブ「{label}」の作業フォルダ（{o['cwd']}）に対するシェル操作は禁止されています。"
                f" / Shell operations targeting another tab's working folder (\"{label}\": {o['cwd']}) are blocked."
            )

    other_ids = [s.get("id") for s in sessions if s.get("id") and s.get("id") != session_id]
    for tok in _shell_tokens(cmd):
        if not tok or tok.startswith("-"):
            continue
        looks_like_path = ("/" in tok or "\\" in tok or tok.startswith("~") or tok.startswith("."))
        if not looks_like_path:
            continue
        expanded = os.path.expanduser(tok)
        cand = expanded if os.path.isabs(expanded) else os.path.join(cwd or ".", expanded)
        if is_sensitive_path(cand, "write" if (is_mutating_cmd or tok in redirect_targets) else "read", case_insensitive):
            return "deny", (
                f"認証情報・設定ファイルへのシェルアクセスは禁止されています: {tok}"
                f" / Shell access to credential or config files is blocked: {tok}"
            )
        if root and is_protected_install_read(cand, root, case_insensitive):
            return "deny", (
                f"ブラウザ認証データへの直接アクセスは禁止されています: {tok}"
                f" / Direct shell access to browser profile data is blocked: {tok}"
            )
        if is_mutating_cmd and root and is_protected_install_write(cand, root, session_id, case_insensitive):
            return "deny", (
                f"agent-deck の保護されたファイルへのシェル書き込みは禁止されています: {tok}"
                f" / Shell writes to protected agent-deck files are blocked: {tok}"
            )
        for o in others:
            if is_within(cand, o["cwd"], case_insensitive):
                label = o.get("label") or o.get("id")
                return "deny", (
                    f"別のタブ「{label}」の作業フォルダ（{o['cwd']}）に対するシェル操作は禁止されています。"
                    f" / Shell operations targeting another tab's working folder (\"{label}\": {o['cwd']}) are blocked."
                )
        if root:
            for oid in other_ids:
                if is_within(cand, os.path.join(root, "tmp", "sessions", oid), case_insensitive):
                    return "deny", (
                        "別のタブの一時フォルダへのシェル操作は禁止されています。"
                        " / Shell access to another tab's temp folder is blocked."
                    )

    return None, None


def _case_insensitive() -> bool:
    return sys.platform in ("win32", "darwin")


def run(engine: str, stdin_text: str, env) -> str:
    """Returns what to print on stdout ('' = nothing)."""
    no_opinion = ""
    session_id = env.get("AGENT_DECK_SESSION_ID", "")
    if not session_id:
        return no_opinion
    try:
        data = json.loads(stdin_text or "{}")
        root = env.get("AGENT_DECK_ROOT", "")
        sessions = load_registry(root) if root else []
        ci = _case_insensitive()

        if engine == "agy":
            call = data.get("toolCall") or {}
            tool, args = call.get("name", ""), call.get("args") or {}
            cwd = data.get("cwd") or ""
            workspaces = list(data.get("workspacePaths") or [])
            if not cwd:
                own = next((s for s in sessions if s.get("id") == session_id), None)
                cwd = (own or {}).get("cwd") or ""
            if tool in AGY_WRITE_TOOLS:
                decision, reason = decide(target_paths(args, cwd), session_id, cwd, workspaces, root, sessions, ci)
            elif tool in AGY_READ_TOOLS:
                decision, reason = decide_read(target_paths(args, cwd), root, ci)
            elif tool in AGY_SHELL_TOOLS:
                decision, reason = decide_shell(extract_shell_command(args), session_id, cwd, root, sessions, ci)
            else:
                return no_opinion
        else:
            tool, args = data.get("tool_name", ""), data.get("tool_input") or {}
            cwd = data.get("cwd") or ""
            if not cwd:
                own = next((s for s in sessions if s.get("id") == session_id), None)
                cwd = (own or {}).get("cwd") or ""
            if tool in CLAUDE_WRITE_TOOLS:
                decision, reason = decide(target_paths(args, cwd), session_id, cwd, [], root, sessions, ci)
            elif tool in CLAUDE_SHELL_TOOLS:
                decision, reason = decide_shell(extract_shell_command(args), session_id, cwd, root, sessions, ci)
            else:
                return no_opinion
    except Exception:  # never wedge a session on a hook bug
        return no_opinion
    if not decision:
        return no_opinion
    if engine == "agy":
        # agy: "ask" may reuse an earlier "always allow"; force_ask never does.
        # No opinion must be NO output: agy treats "{}" as a denial.
        agy_decision = "force_ask" if decision == "ask" else decision
        return json.dumps({"decision": agy_decision, "reason": reason}, ensure_ascii=False)
    return json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": decision, "permissionDecisionReason": reason,
    }}, ensure_ascii=False)


def main() -> int:
    engine = "claude" if "--engine" in sys.argv and sys.argv[sys.argv.index("--engine") + 1:][:1] == ["claude"] else "agy"
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        text = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    except Exception:
        text = ""
    out = run(engine, text, os.environ)
    if out:
        sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
