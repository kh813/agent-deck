"""
Tests for the google-workspace skill's open_gws_auth_login.py: opens a new
Terminal (macOS) / cmd.exe (Windows) window running `gws auth login`, so
users unfamiliar with a terminal don't have to open one themselves.

Run:
  pytest python/tests/test_open_gws_auth_login.py -v
"""
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "python" / "skills" / "google-workspace" / "scripts" / "open_gws_auth_login.py"

spec = importlib.util.spec_from_file_location("open_gws_auth_login", SCRIPT_PATH)
m = importlib.util.module_from_spec(spec)
sys.modules["open_gws_auth_login"] = m
spec.loader.exec_module(m)


class TestEscaping:
    def test_escapes_double_quotes(self):
        assert m._escape_applescript_string('say "hi"') == 'say \\"hi\\"'

    def test_escapes_backslashes(self):
        assert m._escape_applescript_string("a\\b") == "a\\\\b"


class TestMain:
    def test_darwin_opens_terminal_via_osascript_with_app_bin_on_path(self, monkeypatch):
        monkeypatch.setattr(m.platform, "system", lambda: "Darwin")
        calls = []
        monkeypatch.setattr(m.subprocess, "Popen", lambda *a, **kw: calls.append((a, kw)))
        monkeypatch.setattr(sys, "argv", ["open_gws_auth_login.py"])

        m.main()

        assert len(calls) == 1
        args = calls[0][0][0]
        assert args[0] == "osascript"
        assert args[1] == "-e"
        script = args[2]
        assert 'tell application "Terminal" to do script' in script
        assert "gws auth login -s gmail,drive,calendar,sheets,docs" in script
        assert str(ROOT / "app" / "bin") in script
        assert f"cd {ROOT}" in script

    def test_darwin_accepts_custom_services(self, monkeypatch):
        monkeypatch.setattr(m.platform, "system", lambda: "Darwin")
        calls = []
        monkeypatch.setattr(m.subprocess, "Popen", lambda *a, **kw: calls.append((a, kw)))
        monkeypatch.setattr(sys, "argv", ["open_gws_auth_login.py", "gmail,drive"])

        m.main()

        script = calls[0][0][0][2]
        assert "gws auth login -s gmail,drive" in script
        assert "calendar" not in script

    def test_windows_opens_cmd_with_app_bin_on_path(self, monkeypatch):
        monkeypatch.setattr(m.platform, "system", lambda: "Windows")
        calls = []
        monkeypatch.setattr(m.subprocess, "Popen", lambda *a, **kw: calls.append((a, kw)))
        monkeypatch.setattr(sys, "argv", ["open_gws_auth_login.py"])

        m.main()

        assert len(calls) == 1
        cmd_string = calls[0][0][0]
        assert "start cmd.exe /k" in cmd_string
        assert "gws auth login -s gmail,drive,calendar,sheets,docs" in cmd_string
        assert str(ROOT / "app" / "bin") in cmd_string

    def test_unsupported_os_exits_nonzero_without_crashing(self, monkeypatch, capsys):
        monkeypatch.setattr(m.platform, "system", lambda: "Linux")
        monkeypatch.setattr(sys, "argv", ["open_gws_auth_login.py"])

        with pytest.raises(SystemExit) as exc_info:
            m.main()

        assert exc_info.value.code == 1
        out = capsys.readouterr().out
        assert "gws auth login -s gmail,drive,calendar,sheets,docs" in out
