#!/usr/bin/env python3
"""PreToolUse guard for agent-deck sessions (app_specs.md 5.7.4).

Both engines call this before a file-writing tool runs:
  agy:    ~/.gemini/config/hooks.json  ("agent-deck-guard", installed by setup.py)
  claude: .claude/agent-deck-settings.json  ("hooks" -> PreToolUse)

It only acts inside sessions agent-deck started (AGENT_DECK_SESSION_ID is
set in their environment); your own agy / claude elsewhere is untouched.

  * a write into ANOTHER tab's working folder  -> deny
    (two agents must never edit the same files; the tab list in
    <root>/tmp/agent-deck-sessions.json comes from the app)
  * a write outside this tab's working folder, its workspace folders and
    the agent-deck install folder            -> ask the user first
  * anything else                             -> no opinion (normal rules)

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
import sys
from pathlib import Path

REGISTRY_NAME = "agent-deck-sessions.json"

AGY_WRITE_TOOLS = (
    "write_file", "write_to_file", "replace_file_content", "multi_replace_file_content",
    "edit_file", "create_file", "delete_file", "apply_patch", "edit_notebook", "rename_file",
)
AGY_MATCHER = "|".join(AGY_WRITE_TOOLS)
CLAUDE_WRITE_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
CLAUDE_MATCHER = "|".join(CLAUDE_WRITE_TOOLS)

_PATCH_FILE = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", re.M)
_PATH_KEY = re.compile(r"(path|file|target|destination|source)", re.I)


def _norm(p: str, case_insensitive: bool) -> str:
    try:
        r = os.path.realpath(os.path.expanduser(p))
    except (OSError, ValueError):
        r = os.path.abspath(p)
    r = r.replace("\\", "/").rstrip("/") or "/"
    return r.lower() if case_insensitive else r


def is_within(path: str, folder: str, case_insensitive: bool) -> bool:
    if not path or not folder:
        return False
    p, f = _norm(path, case_insensitive), _norm(folder, case_insensitive)
    return p == f or p.startswith(f if f.endswith("/") else f + "/")


def target_paths(args, cwd: str) -> list:
    """Paths a write tool is about to touch, made absolute against cwd."""
    found = []

    def add(v):
        v = v.strip()
        if v and len(v) < 4096 and "\n" not in v:
            found.append(v if os.path.isabs(v) else os.path.join(cwd or ".", v))

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


def load_registry(root: str) -> list:
    try:
        data = json.loads((Path(root) / "tmp" / REGISTRY_NAME).read_text(encoding="utf-8"))
        return [s for s in data.get("sessions", []) if isinstance(s, dict)]
    except (OSError, ValueError, AttributeError):
        return []


def decide(paths, session_id: str, cwd: str, workspaces, root: str, sessions, case_insensitive: bool):
    """(decision, reason) or (None, None). decision: 'deny' | 'ask'."""
    if not paths:
        return None, None
    others = [s for s in sessions if s.get("id") != session_id and s.get("cwd")
              # the install folder is shared by every tab (skills use files/, tmp/)
              and not (root and _norm(s["cwd"], case_insensitive) == _norm(root, case_insensitive))]
    for p in paths:
        for o in others:
            if is_within(p, o["cwd"], case_insensitive):
                label = o.get("label") or o.get("id")
                return "deny", (
                    f"別のタブ「{label}」の作業フォルダ（{o['cwd']}）には書き込めません。2 つの AI が同じファイルを同時に編集しないためです。"
                    f" / Writing into another tab's working folder (\"{label}\": {o['cwd']}) is blocked so two agents never edit the same files."
                )
    allowed = [x for x in [cwd, root, *workspaces] if x]
    outside = [p for p in paths if not any(is_within(p, a, case_insensitive) for a in allowed)]
    if outside:
        return "ask", (
            f"作業フォルダの外への書き込みです: {outside[0]} — 許可しますか？"
            f" / This writes outside the tab's working folder: {outside[0]}. Allow it?"
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
        if engine == "agy":
            call = data.get("toolCall") or {}
            tool, args = call.get("name", ""), call.get("args") or {}
            cwd = data.get("cwd") or ""
            workspaces = list(data.get("workspacePaths") or [])
            if tool not in AGY_WRITE_TOOLS:
                return no_opinion
        else:
            tool, args = data.get("tool_name", ""), data.get("tool_input") or {}
            cwd = data.get("cwd") or ""
            workspaces = []
            if tool not in CLAUDE_WRITE_TOOLS:
                return no_opinion
        decision, reason = decide(target_paths(args, cwd), session_id, cwd, workspaces, root,
                                  load_registry(root) if root else [], _case_insensitive())
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
