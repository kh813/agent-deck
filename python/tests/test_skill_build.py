"""
Regression tests for skill building and installation.

Adapted from the (separate, company-internal) agent-deck skill-catalog
consumer's own test_skill_build.py for this project's simpler two-root model
(python/skills bundled + python/skills-personal per-install — no internal
tier and no --public/--company build modes, since this repo itself is the
fully-public layer). Confusingly, as of 2026-07-16 both projects are named
"agent-deck" (a company product built on top of this one, sharing the name
by coincidence after this repo's own agent-ui -> agent-deck rename) — this
comment predates that and refers to the company's own, separate repo.

Run:
  pytest python/tests/test_skill_build.py -v
"""

import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT          = Path(__file__).resolve().parents[2]
SKILLS_ROOTS  = [ROOT / "python" / "skills", ROOT / "python" / "skills-personal"]
SKILLS_DIST   = ROOT / "skills"

sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))
import setup as setup_mod  # noqa: E402


def _skill_mds(roots):
    return [md for root in roots if root.exists() for md in root.rglob("SKILL.md")]


# ── 1. preflight bootstraps builds skills before launch ───────────────────

class TestPreflightBuildStep:
    def _src(self, name: str) -> str:
        return (ROOT / name).read_text()

    def test_preflight_sh_rebuilds_skills(self):
        assert "skills' 'rebuild" in self._src("preflight.sh") or \
               "skills\", \"rebuild" in self._src("preflight.sh") or \
               "skills rebuild" in self._src("preflight.sh"), (
            "preflight.sh does not call setup.py skills rebuild. Without this, "
            "python/skills/ can be stale on first launch."
        )

    def test_preflight_bat_rebuilds_skills(self):
        assert "skills rebuild" in self._src("preflight.bat"), (
            "preflight.bat does not call setup.py skills rebuild."
        )


# ── 2. setup.py skills rebuild calls both build and install ───────────────

class TestSetupPySkillsRebuild:
    def _src(self) -> str:
        return (ROOT / "python" / "scripts" / "setup" / "setup.py").read_text()

    def test_skills_rebuild_calls_build_skills(self):
        """skills_rebuild() must call build_skills() to create .skill files."""
        assert "build_skills()" in self._src(), (
            "setup.py skills_rebuild() does not call build_skills(). "
            "Without this, no .skill packages are created."
        )

    def test_skills_rebuild_calls_install_skills(self):
        """skills_rebuild() must call install_skills() to deploy .skill files."""
        assert "install_skills()" in self._src(), (
            "setup.py skills_rebuild() does not call install_skills(). "
            "Without this, skills are built but never copied to .gemini/skills/."
        )

    def test_install_copies_to_home_gemini(self):
        """install_skills() must copy skills to ~/.gemini/skills/ for Antigravity CLI."""
        assert "home_gemini_skills" in self._src(), (
            "install_skills() is missing the home_gemini_skills step. "
            "agy reads skills from ~/.gemini/skills/, not from .gemini/skills/."
        )

    def test_build_invokes_build_skills_sh(self):
        """build_skills() must shell out to build-skills.sh."""
        assert "build-skills.sh" in self._src(), (
            "setup.py build_skills() does not call build-skills.sh. "
            "The shell script is the canonical tool for locating SKILL.md files and "
            "producing .skill ZIP packages."
        )


# ── 2b. install_skills() cleans up renamed/retired skills from ~/.gemini/ ──
#
# Regression test (2026-07-16): confirmed happening for real — a skill
# renamed/consolidated (e.g. "calendar" -> "daily-schedule") left its old
# directory behind in ~/.gemini/skills/ forever, since the per-name copy
# loop only ever touches entries matching CURRENT skill names. An agent
# stumbled onto the stale "calendar" skill's outdated instructions instead
# of the current "daily-schedule" one, wasting significant time before
# finding the right command.

def _make_skill_zip(skills_dir: Path, name: str) -> None:
    with zipfile.ZipFile(skills_dir / f"{name}.skill", "w") as zf:
        zf.writestr("SKILL.md", f"---\nname: {name}\n---\n")


class TestInstallSkillsCleansUpStaleHomeSkills:
    @pytest.fixture()
    def project(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        (tmp_path / "skills").mkdir()
        (tmp_path / ".gemini" / "skills").mkdir(parents=True)
        home = tmp_path / "fake_home"
        home.mkdir()
        monkeypatch.setattr(setup_mod.Path, "home", classmethod(lambda cls: home))
        return tmp_path, home

    def test_stale_skill_removed_after_rename(self, project):
        tmp_path, home = project
        _make_skill_zip(tmp_path / "skills", "calendar")
        setup_mod.install_skills()
        assert (home / ".gemini" / "skills" / "calendar").exists()

        (tmp_path / "skills" / "calendar.skill").unlink()
        _make_skill_zip(tmp_path / "skills", "daily-schedule")
        setup_mod.install_skills()

        assert not (home / ".gemini" / "skills" / "calendar").exists(), (
            "install_skills() left the old 'calendar' skill behind in "
            "~/.gemini/skills/ after it was renamed to 'daily-schedule' — "
            "an agent can still discover and follow its stale instructions."
        )
        assert (home / ".gemini" / "skills" / "daily-schedule").exists()

    def test_user_created_home_skill_is_left_alone(self, project):
        """A skill this process never installed (e.g. created directly by
        some other means) must not be treated as stale and removed."""
        tmp_path, home = project
        user_skill = home / ".gemini" / "skills" / "my-own-skill"
        user_skill.mkdir(parents=True)
        (user_skill / "SKILL.md").write_text("---\nname: my-own-skill\n---\n")

        _make_skill_zip(tmp_path / "skills", "ask-portal")
        setup_mod.install_skills()

        assert (home / ".gemini" / "skills" / "my-own-skill" / "SKILL.md").exists()

    def test_idempotent_across_repeated_runs(self, project):
        tmp_path, home = project
        _make_skill_zip(tmp_path / "skills", "ask-portal")
        setup_mod.install_skills()
        setup_mod.install_skills()  # must not raise or remove anything
        assert (home / ".gemini" / "skills" / "ask-portal").exists()


# ── 3. Actual build output: every SKILL.md has a matching .skill ──────────
#
# Integration tests. setup_class runs build-skills.sh once so the class is
# self-contained and does not depend on the developer having run it manually.
# build-skills.sh is idempotent and only writes to skills/ (gitignored).

class TestSkillBuildOutput:
    @classmethod
    def setup_class(cls):
        result = subprocess.run(
            ["bash", str(ROOT / "python" / "scripts" / "setup" / "build-skills.sh")],
            capture_output=True,
            text=True,
        )
        cls._stdout = result.stdout
        cls._returncode = result.returncode

    def _enabled_names(self) -> list:
        return sorted(
            md.parent.name
            for md in _skill_mds(SKILLS_ROOTS)
            if "disabled" not in md.parts
        )

    def _disabled_names(self) -> list:
        return sorted(
            md.parent.name
            for md in _skill_mds(SKILLS_ROOTS)
            if "disabled" in md.parts
        )

    def test_build_exits_zero(self):
        """build-skills.sh must complete without errors."""
        assert self._returncode == 0, (
            f"build-skills.sh exited {self._returncode}.\nOutput:\n{self._stdout}"
        )

    def test_every_enabled_skill_has_skill_file(self):
        """Each python/skills/<name>/SKILL.md must produce skills/<name>.skill."""
        missing = [
            name for name in self._enabled_names()
            if not (SKILLS_DIST / f"{name}.skill").exists()
        ]
        assert not missing, (
            f"SKILL.md exists but .skill was not built for: {missing}. "
            "Check for errors in build-skills.sh output."
        )

    def test_disabled_skills_excluded(self):
        """python/skills/disabled/<name>/SKILL.md must NOT produce a .skill file."""
        unexpected = [
            name for name in self._disabled_names()
            if (SKILLS_DIST / f"{name}.skill").exists()
        ]
        assert not unexpected, (
            f"Disabled skills have a .skill package (should be excluded): {unexpected}. "
            "build-skills.sh must skip disabled/ subfolders."
        )

    def test_skill_count_matches_source(self):
        """Number of .skill files must equal the number of enabled SKILL.md files."""
        expected_names = self._enabled_names()
        built_names    = sorted(p.stem for p in SKILLS_DIST.glob("*.skill"))
        assert built_names == expected_names, (
            f"Built skills do not match enabled sources.\n"
            f"  Expected: {expected_names}\n"
            f"  Got:      {built_names}"
        )

    def test_each_skill_file_is_valid_zip_with_skill_md(self):
        """Each .skill file must be a valid ZIP containing SKILL.md."""
        for skill_file in sorted(SKILLS_DIST.glob("*.skill")):
            assert zipfile.is_zipfile(skill_file), \
                f"{skill_file.name} is not a valid ZIP file."
            with zipfile.ZipFile(skill_file) as zf:
                assert "SKILL.md" in zf.namelist(), (
                    f"{skill_file.name} does not contain SKILL.md. "
                    f"Contents: {zf.namelist()}"
                )
