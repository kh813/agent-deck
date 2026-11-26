"""agy-schedule was renamed scheduled-tasks (v0.2.10) now that it schedules
Claude Code prompts too. The name the AI sees changed; the names existing
installs depend on did NOT -- tasks already registered with the OS keep
their labels/folder and keep running the same script paths."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "python" / "skills" / "system" / "scheduled-tasks" / "SKILL.md"
SCHEDULER = (ROOT / "python" / "scripts" / "automation" / "agy_scheduler.py").read_text(encoding="utf-8")


def test_skill_folder_and_name_match():
    text = SKILL.read_text(encoding="utf-8")
    assert re.search(r"^name: scheduled-tasks$", text, re.M)
    assert not (ROOT / "python" / "skills" / "system" / "agy-schedule").exists()


def test_description_is_engine_neutral():
    desc = re.search(r"^description: (.*)$", SKILL.read_text(encoding="utf-8"), re.M).group(1)
    assert "Claude Code" in desc and "agy" in desc
    assert not desc.startswith("agyを使った")


def test_no_reference_to_the_old_skill_name_in_shipped_files():
    shipped = [p for p in (ROOT / "python").rglob("*") if p.suffix in (".md", ".py", ".toml")
               and "tests" not in p.parts and p.is_file()]
    shipped += [ROOT / "release" / "AGENTS.release.md", ROOT / "docs" / "user_guide.md", ROOT / "docs" / "admin_guide.md"]
    hits = [str(p.relative_to(ROOT)) for p in shipped if "agy-schedule" in p.read_text(encoding="utf-8", errors="replace")]
    assert hits == [], hits


def test_os_registration_names_are_unchanged():
    # Renaming these would orphan every task users already registered.
    assert '_LABEL_PREFIX = "com.agent-ui.agy."' in SCHEDULER
    assert "AgentUI" in SCHEDULER and "AGY" in SCHEDULER


def test_scripts_keep_their_paths():
    # Registered tasks call these files by path.
    for name in ("agy_scheduler.py", "agy_scheduled_prompt.py"):
        assert (ROOT / "python" / "scripts" / "automation" / name).is_file()
