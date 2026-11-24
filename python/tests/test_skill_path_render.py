"""setup.py render_skill_md(): installed skills must work from any session
working folder, so project-relative `python3 python/...` script paths are
made absolute at deploy time (sources stay unchanged). The engines'
auto-allow rules get the matching absolute prefixes."""
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover
    tomllib = None

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "agent_setup_render", ROOT / "python" / "scripts" / "setup" / "setup.py"
)
agent_setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_setup)


def test_rewrites_command_paths_to_quoted_absolute(tmp_path):
    root = tmp_path.resolve().as_posix()
    src = (
        "Run `python3 python/scripts/automation/automate.py calendar`.\n"
        "python python/skills/x/scripts/run.py files/a.mmd\n"
    )
    out = agent_setup.render_skill_md(src, tmp_path)
    assert f'`python3 "{root}/python/scripts/automation/automate.py" calendar`' in out
    assert f'python "{root}/python/skills/x/scripts/run.py" files/a.mmd' in out


def test_leaves_prose_and_other_paths_alone(tmp_path):
    src = (
        "Data is stored in `python/scripts/automation/ChromeUserData/`.\n"
        "venv/bin/python3 -m pip list\n"
        "mypython3 python/x.py\n"
    )
    assert agent_setup.render_skill_md(src, tmp_path) == src


def test_expands_project_root_placeholder_and_is_idempotent(tmp_path):
    root = tmp_path.resolve().as_posix()
    src = 'python3 "{{PROJECT_ROOT}}/python/skills/a/run.py"\n'
    once = agent_setup.render_skill_md(src, tmp_path)
    assert once == f'python3 "{root}/python/skills/a/run.py"\n'
    assert agent_setup.render_skill_md(once, tmp_path) == once


def test_windows_style_root_uses_forward_slashes():
    out = agent_setup.render_skill_md("python3 python/a.py", None)
    assert "\\" not in out


def test_install_skills_renders_installed_copies_not_sources(tmp_path, monkeypatch):
    project, home = tmp_path / "p", tmp_path / "h"
    (project / "skills").mkdir(parents=True)
    home.mkdir()
    with zipfile.ZipFile(project / "skills" / "s.skill", "w") as zf:
        zf.writestr("SKILL.md", "---\nname: s\n---\npython3 python/scripts/x.py\n")
    monkeypatch.chdir(project)
    monkeypatch.setattr(agent_setup.Path, "home", classmethod(lambda cls: home))
    monkeypatch.setattr(agent_setup, "_project_root_posix", lambda project_root=None: "/ROOT")

    agent_setup.install_skills()

    for base in (project / ".gemini" / "skills", project / ".claude" / "skills",
                 home / ".gemini" / "skills", home / ".claude" / "skills"):
        assert 'python3 "/ROOT/python/scripts/x.py"' in (base / "s" / "SKILL.md").read_text()
    with zipfile.ZipFile(project / "skills" / "s.skill") as zf:
        assert b"python3 python/scripts/x.py" in zf.read("SKILL.md")


def test_gemini_policy_renders_to_valid_toml_with_absolute_prefix(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_setup.Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(agent_setup, "_project_root_posix", lambda project_root=None: "/Users/u/agent deck")
    agent_setup.install_gemini_policies()
    text = (tmp_path / ".gemini" / "policies" / "agent-ui.toml").read_text(encoding="utf-8")
    assert "{{PROJECT_ROOT}}" not in text
    if tomllib:
        rules = tomllib.loads(text)["rule"]
        prefixes = next(r["commandPrefix"] for r in rules if isinstance(r.get("commandPrefix"), list))
        assert 'python3 "/Users/u/agent deck/python/' in prefixes
        assert "python3 python/" in prefixes


def test_claude_settings_allow_absolute_script_paths(tmp_path):
    data = json.loads(agent_setup.install_claude_settings(tmp_path).read_text(encoding="utf-8"))
    root = tmp_path.resolve().as_posix()
    assert f'Bash(python3 "{root}/python/*)' in data["permissions"]["allow"]
    assert "Bash(python3 python/*)" in data["permissions"]["allow"]


def _touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("x\n")


def test_personal_path_redirects_to_catalog_where_it_was_synced(tmp_path):
    """Org skills are authored in skills-personal/ but land in
    skills-catalog/ on other machines."""
    _touch(tmp_path / "python" / "skills-catalog" / "org" / "scripts" / "run.py")
    out = agent_setup.render_skill_md("python3 python/skills-personal/org/scripts/run.py", tmp_path)
    assert out == f'python3 "{tmp_path.resolve().as_posix()}/python/skills-catalog/org/scripts/run.py"'


def test_catalog_path_redirects_to_personal_on_the_authors_machine(tmp_path):
    _touch(tmp_path / "python" / "skills-personal" / "org" / "scripts" / "run.py")
    out = agent_setup.render_skill_md("python3 python/skills-catalog/org/scripts/run.py", tmp_path)
    assert "/python/skills-personal/org/scripts/run.py" in out


def test_existing_path_is_kept_even_if_another_root_has_it(tmp_path):
    for r in ("skills-personal", "skills-catalog"):
        _touch(tmp_path / "python" / r / "org" / "scripts" / "run.py")
    out = agent_setup.render_skill_md("python3 python/skills-personal/org/scripts/run.py", tmp_path)
    assert "/python/skills-personal/org/" in out


def test_skill_dir_placeholder(tmp_path):
    d = tmp_path / "python" / "skills-catalog" / "org"
    out = agent_setup.render_skill_md('python3 "{{SKILL_DIR}}/scripts/run.py"', tmp_path, skill_dir=d)
    assert out == f'python3 "{d.resolve().as_posix()}/scripts/run.py"'


def test_find_source_skill_dir_follows_build_precedence(tmp_path):
    for r in ("skills-personal", "skills-catalog"):
        _touch(tmp_path / "python" / r / "dup" / "SKILL.md")
    _touch(tmp_path / "python" / "skills" / "disabled" / "dup" / "SKILL.md")
    found = agent_setup._find_source_skill_dir("dup", tmp_path)
    assert found == tmp_path / "python" / "skills-catalog" / "dup"
    assert agent_setup._find_source_skill_dir("missing", tmp_path) is None


def test_backslash_escapes_keep_examples_literal(tmp_path):
    src = (
        'Write `python3 "\\{{SKILL_DIR}}/scripts/foo.py"` and `\\python3 python/scripts/x.py`, '
        "root is \\{{PROJECT_ROOT}}."
    )
    out = agent_setup.render_skill_md(src, tmp_path, skill_dir=tmp_path / "s")
    assert out == (
        'Write `python3 "{{SKILL_DIR}}/scripts/foo.py"` and `python3 python/scripts/x.py`, '
        "root is {{PROJECT_ROOT}}."
    )


def test_windows_venv_path_is_not_treated_as_escape(tmp_path):
    src = "venv\\Scripts\\python python/scripts/x.py"
    assert agent_setup.render_skill_md(src, tmp_path) == src


def test_my_skills_examples_survive_rendering():
    """my-skills documents the conventions; its examples must reach the
    agent unexpanded, or it would copy my-skills' own absolute path."""
    src = (ROOT / "python" / "skills" / "my-skills" / "SKILL.md").read_text(encoding="utf-8")
    out = agent_setup.render_skill_md(src, ROOT, skill_dir=ROOT / "python" / "skills" / "my-skills")
    assert '`python3 "{{SKILL_DIR}}/scripts/foo.py"`' in out
    assert "`python3 python/scripts/...`" in out
