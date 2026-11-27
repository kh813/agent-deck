"""AGENTS.md is read by both Antigravity CLI (directly) and Claude Code (via
the release ZIP's `@AGENTS.md` CLAUDE.md stub), so its instructions must
work for either engine."""
from pathlib import Path

AGENTS_MD = (Path(__file__).resolve().parents[2] / "release" / "AGENTS.release.md").read_text(encoding="utf-8")


def test_names_each_engines_question_tool():
    assert "`ask_user`" in AGENTS_MD
    assert "`AskUserQuestion`" in AGENTS_MD


def test_lists_both_installed_skill_dirs():
    assert "`.gemini/skills/`" in AGENTS_MD
    assert "`.claude/skills/`" in AGENTS_MD


def test_claude_config_dir_is_protected_like_gemini():
    assert "`~/.claude`" in AGENTS_MD
    assert "`.claude/`" in AGENTS_MD


def test_multi_tab_rules():
    # per-tab temp folder and the "never another tab's folder" rule (5.7.4)
    assert "AGENT_DECK_TMP" in AGENTS_MD
    assert "another tab's working folder" in AGENTS_MD
