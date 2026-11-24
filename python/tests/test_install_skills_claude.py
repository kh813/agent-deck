"""Tests for setup.py's install_skills(): skills go to agy's (.gemini) AND
Claude Code's (.claude) skill dirs, both project-local and per-user."""
import importlib.util
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "agent_setup_install_skills", ROOT / "python" / "scripts" / "setup" / "setup.py"
)
agent_setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_setup)


def _make_skill(project: Path, name: str, body: str = "") -> None:
    (project / "skills").mkdir(exist_ok=True)
    with zipfile.ZipFile(project / "skills" / f"{name}.skill", "w") as zf:
        zf.writestr("SKILL.md", f"---\nname: {name}\ndescription: d\n---\n{body}")


@pytest.fixture
def env(tmp_path, monkeypatch):
    project = tmp_path / "project"
    home = tmp_path / "home"
    project.mkdir()
    home.mkdir()
    monkeypatch.chdir(project)
    monkeypatch.setattr(agent_setup.Path, "home", classmethod(lambda cls: home))
    return project, home


def test_installs_to_gemini_and_claude_local_and_home(env):
    project, home = env
    _make_skill(project, "alpha")
    _make_skill(project, "beta")
    agent_setup.install_skills()
    for base in (project / ".gemini" / "skills", project / ".claude" / "skills",
                 home / ".gemini" / "skills", home / ".claude" / "skills"):
        for name in ("alpha", "beta"):
            assert (base / name / "SKILL.md").is_file(), base / name
    manifest = (home / ".claude" / "skills" / agent_setup._HOME_SKILLS_MANIFEST).read_text()
    assert manifest.splitlines() == ["alpha", "beta"]


def test_user_owned_claude_skill_with_same_name_is_not_overwritten(env):
    project, home = env
    _make_skill(project, "alpha", "from agent-deck")
    mine = home / ".claude" / "skills" / "alpha"
    mine.mkdir(parents=True)
    (mine / "SKILL.md").write_text("my own skill")
    agent_setup.install_skills()
    assert (mine / "SKILL.md").read_text() == "my own skill"
    manifest = (home / ".claude" / "skills" / agent_setup._HOME_SKILLS_MANIFEST).read_text()
    assert "alpha" not in manifest.splitlines()
    # agy's home dir keeps its historical overwrite behavior
    assert "from agent-deck" in (home / ".gemini" / "skills" / "alpha" / "SKILL.md").read_text()


def test_managed_claude_skill_is_updated_and_stale_one_removed(env):
    project, home = env
    _make_skill(project, "alpha", "v1")
    _make_skill(project, "old")
    agent_setup.install_skills()
    (project / "skills" / "old.skill").unlink()
    _make_skill(project, "alpha", "v2")
    unrelated = home / ".claude" / "skills" / "unrelated"
    unrelated.mkdir()
    agent_setup.install_skills()
    claude_home = home / ".claude" / "skills"
    assert "v2" in (claude_home / "alpha" / "SKILL.md").read_text()
    assert not (claude_home / "old").exists()
    assert not (project / ".claude" / "skills" / "old").exists()
    assert unrelated.exists()
