"""
Regression test for setup.py's _prompt() non-interactive handling.

The bug: _prompt() relied on input() raising EOFError when stdin has no
more data to degrade to an empty answer for setup_config()'s email/OAuth
prompts during preflight's non-interactive invocation. This works when
stdin is closed (immediate EOF) -- confirmed fine on Mac -- but confirmed
for real on Windows: a genuinely fresh install's first-time setup hung
indefinitely at the email prompt. Tauri's pre_launch_command there leaves
stdin open with no writer rather than closed, so input() blocks forever
waiting for a line instead of ever raising EOFError.

Fix: check sys.stdin.isatty() before ever calling input() -- false in
both the "closed" and "open but inert" cases, so it degrades correctly
regardless of which stdin-wiring quirk the platform has.

Run:
  pytest python/tests/test_setup_prompt.py -v
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))

import setup as agent_setup  # noqa: E402


class TestPromptNonInteractive:
    def test_returns_empty_without_calling_input_when_stdin_is_not_a_tty(self, monkeypatch):
        monkeypatch.setattr(agent_setup.sys.stdin, "isatty", lambda: False)

        def _fail_if_called(msg):
            raise AssertionError(
                "_prompt() called input() despite a non-interactive stdin -- "
                "this is exactly what hangs forever on Windows when stdin is "
                "open but has no writer (confirmed for real on a genuinely "
                "fresh install)."
            )

        monkeypatch.setattr("builtins.input", _fail_if_called)

        assert agent_setup._prompt("  Email: ") == ""

    def test_still_returns_empty_on_eof_when_stdin_looks_interactive(self, monkeypatch):
        """Belt-and-suspenders: even if isatty() somehow reports True but the
        read still hits EOF (e.g. a redirected-but-tty-like stream in some
        test harness), _prompt() must not crash."""
        monkeypatch.setattr(agent_setup.sys.stdin, "isatty", lambda: True)

        def _raise_eof(msg):
            raise EOFError

        monkeypatch.setattr("builtins.input", _raise_eof)

        assert agent_setup._prompt("  Email: ") == ""
