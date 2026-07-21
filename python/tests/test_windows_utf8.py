"""
Regression test for Windows stdout/stderr UTF-8 reconfiguration.

The bug: on Windows, piping a script's stdout through agy.exe's pty makes
Python fall back to the CP932/CP1252 codepage, corrupting Japanese output
(or raising UnicodeEncodeError). Confirmed for real twice: (1) a user's
/update -> preflight.bat -> `setup.py config` step printed mojibake instead
of the intended Japanese prompts; (2) later, a user's launch-time catalog
sync crashed outright with `UnicodeEncodeError: 'cp932' codec can't encode
character '—'` (an em-dash) in auth.py's run_auth_flow() print, and
then crashed AGAIN in skills_catalog.py's own [WARN] handler (which embeds
the caught exception's message, itself containing that same em-dash) —
turning a should-be-graceful "skip this launch, retry next time" into a
hard traceback.

2026-07-21: extended this same guard to every remaining python/scripts/**
file that print()s non-ASCII text (see test_file_encoding_policy.py for
the blanket, AST-based scan that now enforces this going forward instead
of relying on fixing one confirmed-broken file at a time).

Separately, preflight.bat itself was found to have the SAME class of bug
at the file level: 240 non-ASCII bytes (raw Japanese `echo` lines) plus
multi-line parenthesized if/else blocks with a nested `goto` — cmd.exe
reads a .bat file's own source bytes as CP932 on Japanese Windows (a
non-ASCII byte there can look like a stray metacharacter mid-scan), and a
goto exiting a multi-line ( ... ) block right before another one begins
can desync cmd.exe's own tokenizer. Fixed the same way as the confirmed
Windows incident on a wrapping project's own copy of this file: every
bilingual message now lives in its own file under messages/, printed via
`type`, and every conditional uses single-line `if <cond> goto :label`.

Run:
  pytest python/tests/test_windows_utf8.py -v
"""
import subprocess
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

    def test_auth_py(self):
        self._check("python/scripts/auth.py")

    def test_skills_catalog_py(self):
        self._check("python/scripts/setup/skills_catalog.py")


def _tracked_bat_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "*.bat"], cwd=ROOT, capture_output=True,
        check=True, text=True,
    ).stdout
    return [ROOT / line for line in out.splitlines() if line.strip()]


class TestAllTrackedBatFilesArePureAsciiCrlf:
    """Regression guard (2026-07-21): preflight.bat (this repo's own
    top-level one, shipped to every Windows user via the release ZIP) was
    found with 240 non-ASCII bytes -- the only tracked .bat file with any
    (automate.bat, build-skills.bat, setup.bat are all plain ASCII). cmd.exe
    reads a .bat file's own source bytes as CP932 on Japanese Windows, and
    non-ASCII content there risks corrupting its parser. Scans every .bat
    file git actually tracks, present or future, so a new one (or an
    existing one re-saved as UTF-8/LF from macOS/Linux) fails immediately
    instead of shipping to a Windows user."""

    def test_every_tracked_bat_is_ascii(self):
        offenders = {}
        for path in _tracked_bat_files():
            data = path.read_bytes()
            bad = [i for i, b in enumerate(data) if b > 127]
            if bad:
                offenders[str(path.relative_to(ROOT))] = (len(bad), bad[0])
        assert not offenders, (
            f"Non-ASCII bytes found in tracked .bat file(s): {offenders} -- "
            "cmd.exe reads a .bat file's own source bytes as CP932 on "
            "Japanese Windows, and non-ASCII content there risks parser "
            "corruption. Move any text that needs non-ASCII characters "
            "into its own file under messages/ and print it via `type` "
            "instead."
        )

    def test_every_tracked_bat_is_crlf(self):
        offenders = []
        for path in _tracked_bat_files():
            data = path.read_bytes()
            has_bare_lf = any(
                b == 0x0A and (i == 0 or data[i - 1] != 0x0D)
                for i, b in enumerate(data)
            )
            if has_bare_lf:
                offenders.append(str(path.relative_to(ROOT)))
        assert not offenders, (
            f"Tracked .bat file(s) with LF-only (or mixed) line endings: "
            f"{offenders} -- Windows CMD requires CRLF; a bare LF batch "
            "file can fail outright."
        )


class TestPreflightBatHasNoMultilineParenBlocks:
    """Regression guard (2026-07-21): preflight.bat had multi-line
    parenthesized if/else blocks containing a nested `goto` to a label
    outside the block -- confirmed for real to cause a cmd.exe
    malformed-builtin-syntax error on a wrapping project's own copy of
    this same file, immediately after an earlier step printed successfully
    in a stretch of the file that had never contained non-ASCII bytes
    (proving it's a distinct bug from the UTF-8 one above, not just a
    symptom of it). Rewritten to use only single-line `if <cond> goto
    :label` statements. This test scans for a `(` at the end of a code
    line (the opening of a multi-line block, as opposed to a `(` that's
    just part of literal echo text) to catch a reintroduction."""

    def test_no_multiline_paren_blocks(self):
        src = (ROOT / "preflight.bat").read_bytes().decode("ascii")
        offenders = [
            (i, ln) for i, ln in enumerate(src.splitlines(), 1)
            if not ln.strip().lower().startswith("rem")
            and ln.rstrip().endswith("(")
        ]
        assert not offenders, (
            f"preflight.bat has a line ending in an open paren (a "
            f"multi-line if/else block): {offenders} -- this class of "
            "construct, especially combined with a nested goto or pipe, "
            "has caused real cmd.exe parser corruption on Windows. Use "
            "single-line `if <cond> goto :label` statements instead."
        )


class TestReleaseWorkflowPackagesMessagesFolder:
    """Regression guard (2026-07-21): preflight.bat's error-handler labels
    call `type "%~dp0messages\\....txt"` -- if release.yml's zip step
    doesn't include messages/, those `type` calls fail with "file not
    found" the first time a real user's setup or Python bootstrap fails,
    turning a should-be-readable error message into a confusing second
    failure. Checks the actual zip-packaging commands in release.yml
    reference messages, for both platforms."""

    def test_mac_zip_includes_messages(self):
        src = (ROOT / ".github" / "workflows" / "release.yml").read_text()
        zip_line = next(ln for ln in src.splitlines() if ln.strip().startswith("zip -r agent-deck-mac.zip"))
        assert " messages" in zip_line, (
            f"macOS zip step no longer packages messages/: {zip_line!r}"
        )

    def test_windows_zip_includes_messages(self):
        src = (ROOT / ".github" / "workflows" / "release.yml").read_text()
        zip_line = next(ln for ln in src.splitlines() if "Compress-Archive" in ln)
        assert ",messages" in zip_line, (
            f"Windows zip step no longer packages messages/: {zip_line!r}"
        )
