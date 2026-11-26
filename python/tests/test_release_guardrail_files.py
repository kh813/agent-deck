"""The product's guardrails (AGENTS.md for agy, CLAUDE.md = `@AGENTS.md` for
Claude Code) must ship at the root of every release -- and must NOT apply
while developing agent-deck itself (2026-11-26: a tracked root AGENTS.md
made agy refuse development work). They live in release/ under
non-standard names; release.yml and root_files.rs put them in place."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / "release"


def tracked():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return out.splitlines()


def test_no_real_named_agents_or_claude_md_is_tracked_anywhere():
    # agy / Claude Code auto-load these by name from the folder they run in
    # (and possibly subfolders), so none may be in the repo under that name.
    bad = [p for p in tracked() if Path(p).name in ("AGENTS.md", "CLAUDE.md", "GEMINI.md")]
    assert bad == [], bad


def test_root_agents_md_is_gitignored():
    assert "/AGENTS.md" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "/CLAUDE.md" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()


def test_release_sources_exist():
    assert (RELEASE / "AGENTS.release.md").read_text(encoding="utf-8").strip()
    assert (RELEASE / "CLAUDE.release.md").read_text(encoding="utf-8") == "@AGENTS.md\n"


def test_release_workflow_puts_both_at_the_zip_root():
    wf = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    assert "cp release/AGENTS.release.md AGENTS.md" in wf
    assert "cp release/CLAUDE.release.md CLAUDE.md" in wf
    # copied before packaging, and both packaging commands include them
    assert wf.index("cp release/AGENTS.release.md") < wf.index("package macOS app to zip")
    assert wf.count("AGENTS.md CLAUDE.md") >= 1 and "AGENTS.md,CLAUDE.md" in wf


def test_app_writes_the_same_files_back():
    rs = (ROOT / "src-tauri" / "src" / "root_files.rs").read_text(encoding="utf-8")
    assert 'rel: "AGENTS.md", bytes: include_bytes!("../../release/AGENTS.release.md")' in rs
    assert 'rel: "CLAUDE.md", bytes: include_bytes!("../../release/CLAUDE.release.md")' in rs


def test_release_files_are_lf_on_every_checkout():
    attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    assert "release/*.release.md text eol=lf" in attrs
    for name in ("AGENTS.release.md", "CLAUDE.release.md"):
        assert b"\r" not in (RELEASE / name).read_bytes(), name
