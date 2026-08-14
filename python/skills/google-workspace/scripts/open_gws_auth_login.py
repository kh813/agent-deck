#!/usr/bin/env python3
"""Opens a new Terminal (macOS) / cmd.exe (Windows) window running
`gws auth login`, so the user doesn't have to find and open a terminal
themselves -- agent-deck targets people unfamiliar with Terminal.app/
cmd.exe. This only automates *opening the terminal and typing the
command* -- the browser-based OAuth consent screen still needs the
user's own click-through, which cannot be automated on their behalf.

Usage:
  python3 open_gws_auth_login.py [services]
  python3 open_gws_auth_login.py gmail,drive,calendar,sheets,docs
"""
import platform
import subprocess
import sys
from pathlib import Path

_DEFAULT_SERVICES = "gmail,drive,calendar,sheets,docs"


def _escape_applescript_string(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def main():
    services = sys.argv[1] if len(sys.argv) > 1 else _DEFAULT_SERVICES

    # scripts/ -> google-workspace/ -> skills/ -> python/ -> project root
    project_root = Path(__file__).resolve().parents[4]
    app_bin = project_root / "app" / "bin"
    cmd = f"gws auth login -s {services}"

    system = platform.system()
    if system == "Darwin":
        # A freshly-opened Terminal.app window starts a plain login shell
        # with none of the PATH additions agy's own PTY gets (see
        # src-tauri/src/pty.rs) -- prepend app/bin explicitly so `gws`
        # resolves even though it isn't on the user's normal PATH.
        cmd = f'cd {project_root} && export PATH="{app_bin}:$PATH" && gws auth login -s {services}'
        # do script opens a new Terminal.app window/tab and runs the
        # command there -- non-blocking for this process (and for
        # whatever agent process invoked this script).
        script = f'tell application "Terminal" to do script "{_escape_applescript_string(cmd)}"'
        subprocess.Popen(["osascript", "-e", script])
    elif system == "Windows":
        cmd = f'cd /d "{project_root}" && set "PATH={app_bin};%PATH%" && gws auth login -s {services}'
        # start opens a new cmd.exe window; /k keeps it open after the
        # command finishes so the user can see the result.
        subprocess.Popen(f'start cmd.exe /k "{cmd}"', shell=True)
    else:
        print(f"[ERROR] Unsupported OS for auto-opening a terminal: {system}")
        print(f"        Please open a terminal yourself and run: {cmd}")
        sys.exit(1)

    print(f"新しいターミナルウィンドウで次のコマンドを実行しました: {cmd}")
    print("ブラウザが開くので、その画面でログイン・許可を完了してください。")
    print(f"Opened a new terminal window running: {cmd}")
    print("A browser window will open -- please complete the sign-in/consent there.")


if __name__ == "__main__":
    main()
