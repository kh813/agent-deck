"""
Tests for automate.py's script dispatch (2026-07-16).

Catalog-distributed skills bundle their scripts inside their own skill
directory (python/skills-personal/<name>/scripts/), and dispatch through
this launcher to get its venv/playwright bootstrap — _find_script must
resolve scripts from those bundles, after the explicit AUTOMATION_DIRS.

Run:
  pytest python/tests/test_automate_dispatch.py -v
"""
import sys
from pathlib import Path

import pytest

_SRC_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SRC_DIR / "scripts" / "automation"))

import automate  # noqa: E402


@pytest.fixture
def roots(tmp_path, monkeypatch):
    """Point every search root into tmp_path."""
    script_dir = tmp_path / "python" / "scripts" / "automation"
    script_dir.mkdir(parents=True)
    monkeypatch.setattr(automate, "AUTOMATION_DIRS", [
        script_dir,
        tmp_path / "src-internal" / "scripts" / "automation",
        tmp_path / "src-personal" / "scripts" / "automation",
    ])
    monkeypatch.setattr(automate, "SKILL_SCRIPTS_GLOB",
                        tmp_path / "python" / "skills-personal")
    return tmp_path, script_dir


class TestFindScript:
    def test_finds_script_in_skill_bundle(self, roots):
        tmp_path, _ = roots
        bundled = tmp_path / "python" / "skills-personal" / "org-skill" / "scripts" / "download.py"
        bundled.parent.mkdir(parents=True)
        bundled.write_text("# bundled\n")

        assert automate._find_script("download.py") == bundled

    def test_explicit_dirs_win_over_skill_bundles(self, roots):
        """src-internal/ (and the public automation dir) take precedence —
        during the transition both an old src-internal copy and the new
        skill-bundled copy exist, and the established one must win until
        the old tree is retired."""
        tmp_path, _ = roots
        legacy = tmp_path / "src-internal" / "scripts" / "automation" / "download.py"
        legacy.parent.mkdir(parents=True)
        legacy.write_text("# legacy\n")
        bundled = tmp_path / "python" / "skills-personal" / "org-skill" / "scripts" / "download.py"
        bundled.parent.mkdir(parents=True)
        bundled.write_text("# bundled\n")

        assert automate._find_script("download.py") == legacy

    def test_missing_script_raises_with_searched_locations(self, roots):
        with pytest.raises(FileNotFoundError, match="nowhere.py"):
            automate._find_script("nowhere.py")

    def test_multiple_bundles_resolve_deterministically(self, roots):
        """Several skills may bundle identical copies of the same script
        (the it/ download skills do) — resolution must be stable, not
        filesystem-order-dependent."""
        tmp_path, _ = roots
        for skill in ["b-skill", "a-skill"]:
            p = tmp_path / "python" / "skills-personal" / skill / "scripts" / "download.py"
            p.parent.mkdir(parents=True)
            p.write_text(f"# {skill}\n")

        found = automate._find_script("download.py")
        assert found.parts[-3] == "a-skill", "glob results must be sorted"
