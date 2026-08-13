"""
Tests for the diagram-generator skill (python/skills/diagram-generator/):
argument validation in render_diagram.py, and the skill's file/frontmatter
shape. Does not launch a real browser (no test in this repo does -- see
ensure_marp.py, also untested for the same reason: it shells out to real
network/binary installs) -- only the fast, deterministic validation paths
that run before Playwright is ever touched.

Run:
  pytest python/tests/test_diagram_generator.py -v
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = ROOT / "python" / "skills" / "diagram-generator"
RENDER_SCRIPT = SKILL_DIR / "scripts" / "render_diagram.py"


def _run(*args):
    return subprocess.run(
        [sys.executable, str(RENDER_SCRIPT), *args],
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
    )


class TestRenderDiagramArgValidation:
    def test_no_args_prints_usage_and_exits_nonzero(self):
        result = _run()
        assert result.returncode != 0
        assert "Usage" in result.stdout

    def test_missing_input_file_exits_nonzero(self, tmp_path):
        result = _run(str(tmp_path / "does-not-exist.mmd"), str(tmp_path / "out.png"))
        assert result.returncode != 0
        assert "not found" in result.stdout

    def test_rejects_output_extension_other_than_png_or_svg(self, tmp_path):
        input_file = tmp_path / "diagram.mmd"
        input_file.write_text("flowchart TD\n    A --> B\n", encoding="utf-8")

        result = _run(str(input_file), str(tmp_path / "out.txt"))

        assert result.returncode != 0
        assert ".png or .svg" in result.stdout


class TestSkillShape:
    def test_skill_md_declares_expected_name(self):
        text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        assert "name: diagram-generator" in text

    def test_scripts_exist(self):
        assert RENDER_SCRIPT.is_file()
        assert (SKILL_DIR / "scripts" / "ensure_mermaid_js.py").is_file()
