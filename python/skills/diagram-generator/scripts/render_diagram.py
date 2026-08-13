#!/usr/bin/env python3
"""Render a Mermaid diagram (.mmd source) to a PNG or SVG image.

Usage:
  python3 render_diagram.py <input.mmd> <output.png|output.svg>

Renders entirely offline inside a headless Chromium tab driven by
Playwright -- the same browser-automation stack this project's setup.py
already provisions (`python -m playwright install chromium`), so this needs
no Node.js/npm or mermaid-cli install of its own.
"""
import html
import os
import sys
from pathlib import Path

# Windows pipe (agy.exe's pty etc.) makes stdout fall back to CP932/CP1252,
# crashing outright on non-ASCII output -- see gcalendar.py for the same fix.
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass


def _reexec_with_venv():
    """Re-exec with venv Python if playwright is not available (mirrors
    gcalendar.py's _reexec_with_venv() for googleapiclient)."""
    try:
        import playwright  # noqa: F401
    except ImportError:
        script_dir = Path(__file__).resolve().parent
        # scripts/ -> diagram-generator/ -> skills/ -> python/ -> project root
        project_root = script_dir.parents[3]
        if sys.platform == "win32":
            venv_python = project_root / "venv" / "Scripts" / "python.exe"
        else:
            venv_python = project_root / "venv" / "bin" / "python3"
        if venv_python.exists():
            os.environ["PYTHONWARNINGS"] = "ignore"
            os.execv(str(venv_python), [str(venv_python)] + sys.argv)
        else:
            print("[ERROR] venv not found. Please run setup first.")
            sys.exit(1)


_HTML_TEMPLATE = """<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#ffffff;">
<pre class="mermaid">{diagram}</pre>
<script>{mermaid_js}</script>
<script>
  mermaid.initialize({{ startOnLoad: true, theme: "default" }});
</script>
</body></html>
"""


def render(input_path: Path, output_path: Path) -> None:
    # Deferred until here (not module level): argument validation in main()
    # must work with zero dependencies beyond stdlib, since this script runs
    # fine standalone -- only actually rendering needs playwright/venv.
    _reexec_with_venv()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ensure_mermaid_js import ensure_mermaid_js
    from playwright.sync_api import sync_playwright

    diagram_src = input_path.read_text(encoding="utf-8")
    mermaid_js = ensure_mermaid_js().read_text(encoding="utf-8")
    html_doc = _HTML_TEMPLATE.format(
        diagram=html.escape(diagram_src), mermaid_js=mermaid_js
    )

    tmp_html = output_path.with_name(output_path.stem + "._render.html")
    tmp_html.write_text(html_doc, encoding="utf-8")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page()
                page.goto(f"file://{tmp_html.resolve()}")
                page.wait_for_selector("pre.mermaid svg", timeout=15000)

                if page.query_selector(".error-icon") is not None:
                    error_text = page.inner_text("pre.mermaid")
                    print(f"[ERROR] Mermaid failed to parse the diagram:\n{error_text}")
                    sys.exit(1)

                svg_el = page.query_selector("pre.mermaid svg")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                if output_path.suffix.lower() == ".svg":
                    svg_content = svg_el.evaluate("el => el.outerHTML")
                    output_path.write_text(svg_content, encoding="utf-8")
                else:
                    svg_el.screenshot(path=str(output_path))
            finally:
                browser.close()
    finally:
        tmp_html.unlink(missing_ok=True)


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 render_diagram.py <input.mmd> <output.png|output.svg>")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not input_path.is_file():
        print(f"Error: input file not found: {input_path}")
        sys.exit(1)

    if output_path.suffix.lower() not in (".png", ".svg"):
        print(f"Error: output must end in .png or .svg, got: {output_path.suffix}")
        sys.exit(1)

    render(input_path, output_path)
    print(f"Diagram rendered to {output_path}")


if __name__ == "__main__":
    main()
