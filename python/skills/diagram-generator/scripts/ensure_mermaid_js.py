"""Ensures mermaid.js's browser bundle is vendored locally at scripts/assets/.

Downloaded once from a pinned CDN URL so render_diagram.py can render diagrams
fully offline afterwards (same download-once-and-vendor idea as
slide-generator's ensure_marp.py). This project already ships Playwright +
Chromium for browser-automation skills (see setup.py's setup_venv()) and
mermaid.js is plain client-side JS that runs fine inside that same headless
browser -- so rendering this way needs no Node.js/npm, unlike the official
mermaid-cli (which is itself a puppeteer+mermaid.js wrapper doing the same
thing, just via a separate Node/Chromium install this project has no other
use for).

Run directly:
  python3 python/skills/diagram-generator/scripts/ensure_mermaid_js.py
"""
import subprocess
import sys
from pathlib import Path

MERMAID_VERSION = "11.4.1"

# The real bundle is a couple MB; a truncated download or an HTML error page
# saved in its place is nowhere near this size.
_MIN_VALID_JS_SIZE = 500_000


def _assets_dir() -> Path:
    return Path(__file__).resolve().parent / "assets"


def ensure_mermaid_js() -> Path:
    """Download mermaid.min.js into scripts/assets/ if missing/corrupted.

    Returns the local path to a valid mermaid.min.js. Raises RuntimeError on
    download failure (network error, etc.) -- the caller decides whether
    that's fatal.
    """
    assets_dir = _assets_dir()
    assets_dir.mkdir(parents=True, exist_ok=True)
    path = assets_dir / f"mermaid-{MERMAID_VERSION}.min.js"

    if path.exists() and path.stat().st_size < _MIN_VALID_JS_SIZE:
        print(f"  [WARN] mermaid.js at {path} looks corrupted "
              f"({path.stat().st_size} bytes) -- re-downloading.")
        path.unlink()

    if not path.exists():
        url = f"https://cdn.jsdelivr.net/npm/mermaid@{MERMAID_VERSION}/dist/mermaid.min.js"
        print("mermaid.js not found. Downloading...")
        try:
            subprocess.run(["curl", "-fsSL", "-o", str(path), url],
                            check=True, stdin=subprocess.DEVNULL)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"mermaid.js download failed: {e}") from e

        if not path.exists() or path.stat().st_size < _MIN_VALID_JS_SIZE:
            path.unlink(missing_ok=True)
            raise RuntimeError(
                "Download of mermaid.js failed or produced a corrupted file. "
                "Check your network connection and try again."
            )
        print(f"  mermaid.js installed to {path}.")
    else:
        print(f"  mermaid.js already exists at {path}.")

    return path


if __name__ == "__main__":
    try:
        ensure_mermaid_js()
    except RuntimeError as e:
        print(f"  [ERROR] {e}")
        sys.exit(1)
