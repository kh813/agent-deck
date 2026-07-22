"""
Regression test: the /update skill must not assume its bash commands run
with cwd == project root.

The bug: `python3 python/scripts/setup/self_update.py check` failed with
"No such file or directory" during a real /update session (2026-07-22) --
agy's session cwd had drifted away from the project root for some reason.
self_update.py itself computes its own project root from its own file
path (see self_update.py's PROJECT_ROOT = Path(__file__).resolve().parents[2]),
so it works correctly regardless of cwd once actually invoked -- the only
fragile part was the skill's bare relative-path command, which left
recovery entirely up to the LLM improvising a fix (it did, via an
unbounded `find ~`, which could match an unrelated project's same-named
file, as it briefly did with a sibling `agent-deck.old` checkout).

Run:
  pytest python/tests/test_update_skill_cwd_fallback.py -v
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL_MD = ROOT / "python" / "skills" / "system" / "update" / "SKILL.md"


class TestUpdateSkillHandlesCwdDrift:
    def test_skill_file_exists(self):
        assert SKILL_MD.is_file()

    def test_documents_a_bounded_fallback_search(self):
        text = SKILL_MD.read_text()
        assert "No such file or directory" in text, (
            "SKILL.md should explain what to do when the relative-path "
            "self_update.py invocation fails because cwd isn't the project root."
        )
        assert "find . -maxdepth" in text, (
            "SKILL.md's fallback should search a bounded depth from the "
            "current directory, not the whole home directory -- an "
            "unbounded search risks matching a same-named file from an "
            "unrelated sibling project."
        )

    def test_documents_a_windows_equivalent(self):
        text = SKILL_MD.read_text()
        assert "Get-ChildItem" in text, (
            "SKILL.md's cwd-drift fallback should also give a PowerShell "
            "equivalent for Windows, mirroring the existing python3->python "
            "note elsewhere in this file."
        )
