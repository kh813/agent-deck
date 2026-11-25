"""Tests for setup.py's install_claude_settings(): renders the Claude Code
permission rules (the counterpart of agy's ~/.gemini/policies) that
agent_config.json passes via `claude --settings`."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "agent_setup_claude_settings", ROOT / "python" / "scripts" / "setup" / "setup.py"
)
agent_setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_setup)


def test_renders_absolute_python_deny_rule(tmp_path):
    dest = agent_setup.install_claude_settings(tmp_path)
    assert dest == tmp_path / ".claude" / "agent-deck-settings.json"
    data = json.loads(dest.read_text(encoding="utf-8"))
    assert "$comment" not in data
    deny = data["permissions"]["deny"]
    assert f"Edit(/{tmp_path.as_posix()}/python/**)" in deny
    assert not any("${" in rule for rule in deny + data["permissions"]["allow"])


def test_protects_credentials_and_allows_skill_scripts(tmp_path):
    data = json.loads(agent_setup.install_claude_settings(tmp_path).read_text(encoding="utf-8"))
    deny, allow = data["permissions"]["deny"], data["permissions"]["allow"]
    for rule in ("Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.gemini/**)", "Edit(~/.claude/**)", "Edit(//etc/**)"):
        assert rule in deny
    assert "Skill" in allow
    assert "Bash(python3 python/*)" in allow


def test_windows_drive_path_uses_claude_rule_form():
    assert agent_setup._claude_abs_rule_path("C:/Users/x/agent-deck") == "//c/Users/x/agent-deck"
    assert agent_setup._claude_abs_rule_path("/Users/x/agent-deck") == "//Users/x/agent-deck"


def test_not_named_settings_json_so_dev_sessions_are_unaffected():
    # .claude/settings.json is auto-loaded by Claude Code; ours must only
    # apply when agent-deck passes it explicitly with --settings.
    assert agent_setup.CLAUDE_SETTINGS_NAME != "settings.json"
    cfg = json.loads((ROOT / "agent_config.json").read_text(encoding="utf-8"))
    claude = next(e for e in cfg["engines"] if e["id"] == "claude")
    assert claude["args"] == ["--settings", "${PROJECT_ROOT}/.claude/agent-deck-settings.json"]


def test_rebuild_and_init_install_claude_settings():
    src = (ROOT / "python" / "scripts" / "setup" / "setup.py").read_text(encoding="utf-8")
    rebuild = src[src.index("def skills_rebuild():"):]
    rebuild = rebuild[: rebuild.index("\ndef ")]
    assert "install_claude_settings()" in rebuild
    init = src[src.index('if cmd == "init":'):]
    assert "install_claude_settings()" in init[: init.index("elif")]


def test_theme_follows_the_terminal(tmp_path):
    # Claude Code defaults to its dark palette; on agent-deck's light themes
    # the selected slash-command suggestion then became indistinguishable.
    data = json.loads(agent_setup.install_claude_settings(tmp_path).read_text(encoding="utf-8"))
    assert data["theme"] == "auto"
