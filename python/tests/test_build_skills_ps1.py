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

pytestmark = pytest.mark.skipif(PS is None, reason="no PowerShell available")


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


def test_builds_every_enabled_skill(tmp_path):
    root = _tree(tmp_path)
    r = _run(root)
    assert r.returncode == 0, r.stdout + r.stderr
    out = root / "skills"
    assert sorted(p.name for p in out.glob("*.skill")) == [f"s{i}.skill" for i in range(5)]
    assert not list(out.glob("*.zip"))
    with zipfile.ZipFile(out / "s0.skill") as zf:
        assert zf.namelist() == ["SKILL.md"]


def test_rebuild_replaces_stale_packages(tmp_path):
    root = _tree(tmp_path)
    assert _run(root).returncode == 0
    (root / "skills" / "gone.skill").write_bytes(b"old")
    shutil.rmtree(root / "python" / "skills" / "s4")
    r = _run(root)
    assert r.returncode == 0, r.stdout + r.stderr
    assert sorted(p.name for p in (root / "skills").glob("*.skill")) == [f"s{i}.skill" for i in range(4)]
