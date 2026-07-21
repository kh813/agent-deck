"""
Blanket file-encoding/line-ending policy tests (2026-07-21).

This session hit the SAME class of Windows encoding/line-ending bug three
separate times, in three different files (setup.py's mojibake, a wrapping
project's preflight.bat UTF-8-vs-CP932 parser corruption, auth.py/
skills_catalog.py's UnicodeEncodeError crash on an em-dash) — each one
discovered only after a real user hit it on a real Windows machine. Rather
than keep fixing these one confirmed-broken file at a time, this module
scans EVERY .py file under python/scripts/ for the underlying policy
violation, so a new file (or an edit to an existing one) that reintroduces
the pattern fails locally instead of shipping to a Windows user.

Policy enforced here: every .py file under python/scripts/ that prints a
non-ASCII string literal must reconfigure sys.stdout/stderr to UTF-8 on
win32 (see test_windows_utf8.py for the incident history of what happens
without this: mojibake or a hard UnicodeEncodeError crash).

Run:
  pytest python/tests/test_file_encoding_policy.py -v
"""
import ast
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

_GUARD_MARKER = "sys.stdout.reconfigure"


def _tracked_py_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True,
        check=True, text=True,
    ).stdout
    return [
        ROOT / line for line in out.splitlines()
        if line.startswith("python/scripts/") and line.endswith(".py")
    ]


def _prints_non_ascii_literal(path: Path) -> bool:
    """True if this file has a `print(...)` call whose arguments include a
    string constant (including f-string parts) with a non-ASCII character.
    A pure syntactic/AST check — deliberately does not try to determine
    whether that print is actually reachable on Windows, since a currently-
    unreachable branch can become reachable with an unrelated later edit,
    and the fix (the reconfigure guard) is cheap and harmless to apply
    regardless."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print":
            for arg in node.args:
                for sub in ast.walk(arg):
                    if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                        if any(ord(c) > 127 for c in sub.value):
                            return True
    return False


class TestPythonScriptsPrintingNonAsciiHaveWindowsGuard:
    """Confirmed for real, twice: a script that print()s a non-ASCII
    (Japanese, or even just an em-dash) string literal, with no
    sys.stdout/stderr UTF-8 reconfigure guard on win32, either renders as
    mojibake or crashes outright with UnicodeEncodeError when its stdout is
    piped through agy.exe's pty on Windows (CP932/CP1252 fallback). Scans
    every tracked .py file under python/scripts/. As of 2026-07-21 every
    flagged file has the guard, so this allowlist is intentionally empty —
    a new file reintroducing the pattern should fail immediately rather
    than being silently allowed."""

    _ALLOWLIST: set[str] = set()

    def test_every_flagged_script_has_the_guard(self):
        offenders = []
        for path in _tracked_py_files():
            rel = str(path.relative_to(ROOT))
            if rel in self._ALLOWLIST:
                continue
            if not _prints_non_ascii_literal(path):
                continue
            src = path.read_text(encoding="utf-8")
            if _GUARD_MARKER not in src:
                offenders.append(rel)
        assert not offenders, (
            f"Script(s) print non-ASCII text but lack the Windows UTF-8 "
            f"stdout/stderr reconfigure guard: {offenders} -- either add "
            "the guard (see setup.py or self_update.py for the exact "
            "pattern) or, if truly unfixable right now, add the path to "
            "this test's _ALLOWLIST with a comment explaining why."
        )
