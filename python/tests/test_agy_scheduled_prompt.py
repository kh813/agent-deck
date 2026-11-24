"""
Tests for agy_scheduled_prompt.py — the headless runner invoked by scheduled
agy tasks.

subprocess.run (the agy --print call) and notify_chat.send are both mocked;
no real agy binary or Chat webhook is touched. The log file is redirected to
tmp_path so tests never write into this repo's real logs/ directory.

Run:
  venv/bin/pytest python/tests/test_agy_scheduled_prompt.py -v
"""

import sys
import pytest
from pathlib import Path
from unittest.mock import MagicMock

_AUTOMATION_DIR = Path(__file__).resolve().parents[1] / "scripts" / "automation"
sys.path.insert(0, str(_AUTOMATION_DIR))

_notify_chat_mock = MagicMock()
sys.modules["notify_chat"] = _notify_chat_mock

import agy_scheduled_prompt as runner  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_log(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "_LOG_FILE", tmp_path / "agy_scheduled.log")
    _notify_chat_mock.send.reset_mock()
    yield


class TestSuccessfulRun:
    def test_sends_agy_output_to_chat(self, monkeypatch):
        monkeypatch.setattr(
            runner.subprocess, "run",
            MagicMock(return_value=MagicMock(returncode=0, stdout="ドル円は150円です", stderr="")),
        )

        exit_code = runner.run("今日のドル円レートを確認して")

        assert exit_code == 0
        _notify_chat_mock.send.assert_called_once_with("ドル円は150円です")

    def test_empty_output_sends_placeholder(self, monkeypatch):
        monkeypatch.setattr(
            runner.subprocess, "run",
            MagicMock(return_value=MagicMock(returncode=0, stdout="", stderr="")),
        )

        runner.run("prompt")

        sent = _notify_chat_mock.send.call_args.args[0]
        assert "空の応答" in sent


class TestFailedRun:
    def test_nonzero_exit_reports_failure(self, monkeypatch):
        monkeypatch.setattr(
            runner.subprocess, "run",
            MagicMock(return_value=MagicMock(returncode=1, stdout="", stderr="agy crashed")),
        )

        exit_code = runner.run("prompt")

        assert exit_code == 1
        sent = _notify_chat_mock.send.call_args.args[0]
        assert "失敗" in sent
        assert "agy crashed" in sent


class TestTimeout:
    def test_timeout_reports_and_returns_nonzero(self, monkeypatch):
        import subprocess as real_subprocess

        def _raise(*a, **k):
            raise real_subprocess.TimeoutExpired(cmd="agy", timeout=300)

        monkeypatch.setattr(runner.subprocess, "run", _raise)

        exit_code = runner.run("prompt", timeout_seconds=300)

        assert exit_code == 1
        sent = _notify_chat_mock.send.call_args.args[0]
        assert "タイムアウト" in sent


class TestClaudeEngine:
    def test_claude_engine_runs_claude_print_mode(self, monkeypatch, tmp_path):
        mock_run = MagicMock(return_value=MagicMock(returncode=0, stdout="ok", stderr=""))
        monkeypatch.setattr(runner.subprocess, "run", mock_run)
        monkeypatch.setattr(runner, "_claude_binary", lambda: "/x/claude")
        monkeypatch.setattr(runner, "_PROJECT_ROOT", tmp_path)

        assert runner.run("hello", engine="claude") == 0

        cmd = mock_run.call_args.args[0]
        assert cmd[:3] == ["/x/claude", "-p", "hello"]
        assert "--allowedTools" in cmd
        assert "--settings" not in cmd  # settings file not generated in tmp_path
        _notify_chat_mock.send.assert_called_once_with("ok")

    def test_claude_engine_passes_agent_deck_settings_when_present(self, monkeypatch, tmp_path):
        (tmp_path / ".claude").mkdir()
        settings = tmp_path / ".claude" / "agent-deck-settings.json"
        settings.write_text("{}")
        monkeypatch.setattr(runner, "_PROJECT_ROOT", tmp_path)
        monkeypatch.setattr(runner, "_claude_binary", lambda: "claude")
        cmd = runner._build_command("claude", "p", 300)
        assert cmd[cmd.index("--settings") + 1] == str(settings)

    def test_agy_command_unchanged(self, monkeypatch):
        monkeypatch.setattr(runner, "_agy_binary", lambda: "agy")
        assert runner._build_command("agy", "p", 60) == ["agy", "--print", "p", "--print-timeout", "60s"]

    def test_unknown_engine_rejected(self):
        with pytest.raises(ValueError):
            runner.run("p", engine="codex")

    def test_claude_binary_prefers_native_installer_path(self, monkeypatch, tmp_path):
        exe = "claude.exe" if sys.platform == "win32" else "claude"
        native = tmp_path / ".local" / "bin" / exe
        native.parent.mkdir(parents=True)
        native.write_text("")
        monkeypatch.setattr(runner.Path, "home", classmethod(lambda cls: tmp_path))
        assert runner._claude_binary() == str(native)
