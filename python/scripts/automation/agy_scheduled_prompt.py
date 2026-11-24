#!/usr/bin/env python3
"""
Headless runner: send a single prompt non-interactively to agy
(`agy --print`) or Claude Code (`claude -p`), log the result, and deliver it
to Chat via notify_chat.py.

Usage:
  python3 agy_scheduled_prompt.py "<prompt>" [--timeout SECONDS] [--engine agy|claude]

Not meant to be run interactively — this is the payload invoked by scheduled
tasks created through the `agy-schedule` skill (see agy_scheduler.py).
"""
import argparse
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

_SCRIPT_DIR   = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parents[2]
_LOG_FILE     = _SCRIPT_DIR / "logs" / "agy_scheduled.log"

sys.path.insert(0, str(_SCRIPT_DIR))


def _agy_binary() -> str:
    win_bin = _PROJECT_ROOT / "app" / "bin" / "agy.exe"
    mac_bin = _PROJECT_ROOT / "app" / "bin" / "agy"
    if win_bin.exists():
        return str(win_bin)
    if mac_bin.exists():
        return str(mac_bin)
    return "agy"  # fall back to PATH


def _claude_binary() -> str:
    # launchd / Task Scheduler start this with a minimal PATH that does not
    # include ~/.local/bin, where Claude Code's native installer puts it.
    exe = "claude.exe" if sys.platform == "win32" else "claude"
    native = Path.home() / ".local" / "bin" / exe
    if native.exists():
        return str(native)
    return shutil.which("claude") or "claude"


ENGINES = ("agy", "claude")
# Unattended runs can't answer permission prompts, so pre-allow the
# read-only web tools that typical scheduled prompts (info-collector style
# "check today's ...") need. Everything else stays governed by
# agent-deck's permission settings (.claude/agent-deck-settings.json).
_CLAUDE_HEADLESS_ALLOWED_TOOLS = "WebSearch,WebFetch"


def _build_command(engine: str, prompt: str, timeout_seconds: int) -> list:
    if engine == "claude":
        cmd = [_claude_binary(), "-p", prompt, "--allowedTools", _CLAUDE_HEADLESS_ALLOWED_TOOLS]
        settings = _PROJECT_ROOT / ".claude" / "agent-deck-settings.json"
        if settings.exists():
            cmd += ["--settings", str(settings)]
        return cmd
    return [_agy_binary(), "--print", prompt, "--print-timeout", f"{timeout_seconds}s"]


def _log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    # Rotate at 10,000 lines (matches automate.py's convention).
    lines = _LOG_FILE.read_text(encoding="utf-8").splitlines()
    if len(lines) > 10_000:
        _LOG_FILE.write_text("\n".join(lines[-10_000:]) + "\n", encoding="utf-8")


def run(prompt: str, timeout_seconds: int = 300, engine: str = "agy") -> int:
    from notify_chat import send

    if engine not in ENGINES:
        raise ValueError(f"engine must be one of {ENGINES}, got {engine!r}")
    _log(f"Running scheduled prompt ({engine}): {prompt!r}")
    try:
        result = subprocess.run(
            _build_command(engine, prompt, timeout_seconds),
            cwd=str(_PROJECT_ROOT),
            capture_output=True, text=True, timeout=timeout_seconds + 30,
        )
    except subprocess.TimeoutExpired:
        _log(f"{engine} headless run timed out")
        send(f"⚠️ 定期実行がタイムアウトしました / Scheduled run timed out.\nPrompt: {prompt}")
        return 1

    output = (result.stdout or "").strip() or (result.stderr or "").strip()
    _log(f"{engine} exit={result.returncode} output={output[:500]!r}")

    if result.returncode != 0:
        send(
            f"⚠️ 定期実行が失敗しました / Scheduled run failed "
            f"(exit {result.returncode}).\n{output[:1500]}"
        )
        return result.returncode

    send(output[:4000] if output else "(空の応答でした / empty response)")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run a prompt through agy or Claude Code headlessly and notify Chat."
    )
    parser.add_argument("prompt")
    parser.add_argument("--timeout", type=int, default=300, help="Timeout in seconds (default 300)")
    parser.add_argument("--engine", choices=ENGINES, default="agy", help="Agent CLI to run (default agy)")
    args = parser.parse_args()
    sys.exit(run(args.prompt, args.timeout, args.engine))


if __name__ == "__main__":
    main()
