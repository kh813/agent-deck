"""build-skills.ps1 (the Windows skill builder) actually runs and produces
valid .skill packages. Uses Windows PowerShell on Windows, or PowerShell 7
(pwsh) elsewhere when installed; CI runs it on windows-latest
(.github/workflows/test.yml), so Windows-only script breakage is caught
without a manual check."""
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell") or shutil.which("pwsh")

needs_ps = pytest.mark.skipif(PS is None, reason="no PowerShell available")


def _tree(tmp_path: Path, n=5) -> Path:
    root = tmp_path / "install"
    setup_dir = root / "python" / "scripts" / "setup"
    setup_dir.mkdir(parents=True)
    shutil.copy(ROOT / "python" / "scripts" / "setup" / "build-skills.ps1", setup_dir)
    for i in range(n):
        d = root / "python" / "skills" / f"s{i}"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(f"---\nname: s{i}\ndescription: d{i}\n---\n", encoding="utf-8")
    disabled = root / "python" / "skills-personal" / "disabled" / "off"
    disabled.mkdir(parents=True)
    (disabled / "SKILL.md").write_text("---\nname: off\n---\n", encoding="utf-8")
    return root


def _run(root: Path):
    return subprocess.run(
        [PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
         str(root / "python" / "scripts" / "setup" / "build-skills.ps1")],
        capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL,
    )


@needs_ps
def test_builds_every_enabled_skill(tmp_path):
    root = _tree(tmp_path)
    r = _run(root)
    assert r.returncode == 0, r.stdout + r.stderr
    out = root / "skills"
    assert sorted(p.name for p in out.glob("*.skill")) == [f"s{i}.skill" for i in range(5)]
    assert not list(out.glob("*.zip"))
    with zipfile.ZipFile(out / "s0.skill") as zf:
        assert zf.namelist() == ["SKILL.md"]


@needs_ps
def test_rebuild_replaces_stale_packages(tmp_path):
    root = _tree(tmp_path)
    assert _run(root).returncode == 0
    (root / "skills" / "gone.skill").write_bytes(b"old")
    shutil.rmtree(root / "python" / "skills" / "s4")
    r = _run(root)
    assert r.returncode == 0, r.stdout + r.stderr
    assert sorted(p.name for p in (root / "skills").glob("*.skill")) == [f"s{i}.skill" for i in range(4)]


# ── encoding rule for every .ps1 (no PowerShell needed) ─────────────

def _tracked(pattern):
    r = subprocess.run(["git", "ls-files", pattern], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        pytest.skip("not a git checkout")
    return [ROOT / p for p in r.stdout.split()]


def test_every_ps1_is_ascii_or_utf8_bom():
    """Windows PowerShell 5.1 reads a BOM-less .ps1 in the ANSI code page.
    Confirmed on windows-latest (CP1252, 2026-11-25): one em dash in
    build-skills.ps1 decoded to a curly quote, which PowerShell treats as a
    string delimiter -- the whole script failed to parse and no skill was
    built. On Japanese Windows (CP932) the same bytes happen to survive,
    which is why it went unnoticed. Keep .ps1 files ASCII, or save them as
    UTF-8 with a BOM."""
    bad = []
    for p in _tracked("*.ps1"):
        data = p.read_bytes()
        if data.startswith(b"\xef\xbb\xbf"):
            data[3:].decode("utf-8")
            continue
        try:
            data.decode("ascii")
        except UnicodeDecodeError:
            bad.append(p.relative_to(ROOT).as_posix())
    assert not bad, f"non-ASCII .ps1 without a UTF-8 BOM: {bad}"


def test_command_files_are_lf_in_git():
    """.command (macOS double-click bash) must be LF even in a Windows checkout."""
    attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    assert "*.command  text  eol=lf" in attrs
    for p in _tracked("*.command"):
        assert b"\r" not in p.read_bytes(), p
