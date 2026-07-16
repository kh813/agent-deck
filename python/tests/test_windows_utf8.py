"""
Regression test for Windows stdout/stderr UTF-8 reconfiguration in setup.py.

The bug: on Windows, piping a script's stdout through agy.exe's pty makes
Python fall back to the CP1252 codepage, corrupting Japanese output (or
raising UnicodeEncodeError). Confirmed for real: a user's /update ->
preflight.bat -> `setup.py config` step printed mojibake instead of the
intended Japanese prompts (setup_config() prints several).

Known wider gap (2026-07-16, not yet closed): scanning this repo for
Japanese print() output turned up over a dozen other scripts with the same
exposure (skills_catalog.py, auth.py, every python/scripts/automation/*.py
and python/scripts/tools/*.py) — only setup.py is fixed and covered here so
far, since it's the one confirmed to have broken for a real user. Extending
this same guard (and this test) to the rest is tracked as follow-up work,
not rushed in alongside an urgent single-file fix.

Run:
  pytest python/tests/test_windows_utf8.py -v
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class TestWindowsUtf8Reconfigure:
    def _check(self, relpath: str) -> None:
        src = (ROOT / relpath).read_text(encoding="utf-8")

        assert "sys.platform == 'win32'" in src, (
            f"{relpath} no longer branches on sys.platform == 'win32' for "
            "the stdout/stderr UTF-8 reconfiguration."
        )
        assert "sys.stdout.reconfigure(encoding='utf-8'" in src, (
            f"{relpath} no longer reconfigures sys.stdout to UTF-8 on "
            "Windows. Without this, piping stdout through agy.exe's pty "
            "falls back to CP1252 and Japanese output raises "
            "UnicodeEncodeError or renders as mojibake."
        )
        assert "sys.stderr.reconfigure(encoding='utf-8'" in src, (
            f"{relpath} no longer reconfigures sys.stderr to UTF-8 on Windows."
        )
        assert "errors='replace'" in src, (
            f"{relpath}'s UTF-8 reconfigure dropped errors='replace' — "
            "without it, any character still unencodable raises instead of "
            "degrading gracefully."
        )

    def test_setup_py(self):
        self._check("python/scripts/setup/setup.py")
