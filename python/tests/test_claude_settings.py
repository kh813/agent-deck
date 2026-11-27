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
    assert f"Edit({agent_setup._claude_abs_rule_path(tmp_path)}/python/**)" in deny
    # POSIX: //Users/x/...   Windows: C:\Users\x -> //c/Users/x (Claude Code's form)
    assert agent_setup._claude_abs_rule_path("/Users/x") == "//Users/x"
    assert agent_setup._claude_abs_rule_path("C:/Users/x") == "//c/Users/x"
    assert not any("${" in rule for rule in deny + data["permissions"]["allow"])


def test_protects_credentials_and_allows_skill_scripts(tmp_path):
    data = json.loads(agent_setup.install_claude_settings(tmp_path).read_text(encoding="utf-8"))
    deny, allow = data["permissions"]["deny"], data["permissions"]["allow"]
    root_rule = agent_setup._claude_abs_rule_path(tmp_path)
    for rule in (
        "Read(~/.ssh/**)",
        "Read(~/.aws/**)",
        "Read(~/.gemini/**)",
        "Edit(~/.claude/**)",
        "Edit(//etc/**)",
        f"Edit({root_rule}/tmp/agent-deck-sessions.json)",
        f"Edit({root_rule}/.claude/**)",
        f"Edit({root_rule}/AGENTS.md)",
        f"Edit({root_rule}/agent_config.json)",
        f"Read({root_rule}/python/scripts/automation/ChromeUserData/**)",
    ):
        assert rule in deny, rule
    assert "Skill" in allow
    assert "Bash(python3 python/*)" in allow
    # Overly broad Python auto-allows that bypassed Bash confirmation are removed.
    for overly_broad in ("Bash(python3 -m *)", "Bash(python -m *)", "Bash(venv/bin/python3 *)"):
        assert overly_broad not in allow, overly_broad


def test_windows_drive_path_uses_claude_rule_form():
    assert agent_setup._claude_abs_rule_path("C:/Users/x/agent-deck") == "//c/Users/x/agent-deck"
    assert agent_setup._claude_abs_rule_path("/Users/x/agent-deck") == "//Users/x/agent-deck"


def test_not_named_settings_json_so_dev_sessions_are_unaffected():
    # .claude/settings.json is auto-loaded by Claude Code; ours must only
    # apply when agent-deck passes it explicitly with --settings.
    assert agent_setup.CLAUDE_SETTINGS_NAME != "settings.json"
    cfg = json.loads((ROOT / "agent_config.json").read_text(encoding="utf-8"))
    claude = next(e for e in cfg["engines"] if e["id"] == "claude")
    assert claude["args"][:2] == ["--settings", "${PROJECT_ROOT}/.claude/agent-deck-settings.json"]
    # the product guardrails go in explicitly (5.7.4): they apply in any working folder
    assert claude["args"][2:] == ["--append-system-prompt", "${GUARDRAILS}"]
    agy = next(e for e in cfg["engines"] if e["id"] == "agy")
    assert agy["args"] == ["--add-dir", "${PROJECT_ROOT}"]  # agy loads AGENTS.md from an added folder


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
