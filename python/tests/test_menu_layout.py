"""The real app's native menu bar, on the OS this runs on.

Native menus can't be built in unit tests (they need the app's main
thread), so this launches the actual debug binary with
AGENT_DECK_DUMP_MENU=1, which prints the finished menu tree, and checks it.
Runs only when AGENT_DECK_BIN points at the built binary -- CI's test
workflow does that on both macOS and Windows (.github/workflows/test.yml).
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

BIN = os.environ.get("AGENT_DECK_BIN")
pytestmark = pytest.mark.skipif(not BIN, reason="set AGENT_DECK_BIN to the built app binary")


def _dump() -> list[str]:
    env = dict(os.environ, AGENT_DECK_DUMP_MENU="1")
    p = subprocess.Popen([BIN], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
    lines: list[str] = []
    deadline = time.time() + 90
    try:
        while time.time() < deadline:
            line = p.stdout.readline()
            if not line and p.poll() is not None:
                break
            if line.startswith("[menu] "):
                lines.append(line.rstrip("\r\n")[len("[menu] "):])
                # The Help menu's "Version x" item is the last line printed.
                if lines[-1].strip().startswith("Version "):
                    break
    finally:
        p.kill()
        p.wait(timeout=30)
    assert lines, "no menu dump (did the app start?)"
    return lines


@pytest.fixture(scope="module")
def menu():
    lines = _dump()
    tree: dict[str, list[str]] = {}
    current = None
    for l in lines:
        if l.startswith("  "):
            tree[current].append(l.strip())
        else:
            current = l
            tree[current] = []
    return tree


def test_top_level_is_compact(menu):
    expected = ["File", "Edit", "View", "Window", "Settings", "Help"]
    if sys.platform == "darwin":
        expected = ["agent-deck"] + expected
    assert list(menu) == expected


def test_view_holds_theme_font_and_language(menu):
    for item in ("Theme", "Font", "Language / 言語"):
        assert item in menu["View"], menu["View"]


def test_file_holds_tabs_and_force_kill(menu):
    f = menu["File"]
    assert f[:4] == ["New Tab", "Close Tab", "---", "Force Kill Session"], f
    # Close Tab owns CmdOrCtrl+W: the predefined Close Window is gone
    assert not any(l.replace("&", "").lower().startswith("close window") for l in f), f


def test_settings_is_only_updates_and_settings(menu):
    s = [l for l in menu["Settings"] if l != "---"]
    assert s[0] == "Update to Latest..."
    assert s[-1] == "Check for Updates Automatically"
    assert set(s) <= {"Update to Latest...", "Update to Test Release...", "Check for Updates Automatically"}, s


def test_quit_is_our_guarded_item(menu):
    """The predefined Quit exits without asking; ours goes through the quit guard."""
    holder = "agent-deck" if sys.platform == "darwin" else "File"
    quits = [l for l in menu[holder] if l.lower().replace("&", "").startswith(("quit", "exit"))]
    assert quits, menu[holder]
    assert all("(predefined)" not in q for q in quits), quits


def test_help_shows_version(menu):
    assert any(l.startswith("Version ") for l in menu["Help"])
