"""Self-update checker for agent-ui itself.

Updates agent-ui in place: asks GitHub for whatever the *latest* published
release actually is, and swaps the currently-installed app bundle/exe (a
sibling of python/ and config/ at the project root — see the release
workflow's zip-staging step) for the new one, along with the bundled
python/ tree (skills, setup scripts) from the same zip.

Rebranded installs (2026-07-16): an organization may ship this whole layout
under its own product name — the bundle then sits at the project root as
e.g. agent-deck.app / agent-deck.exe instead of agent-ui.* (only the OUTER
name differs; the binary inside a Mac bundle is still Contents/MacOS/agent-ui,
baked in at build time). This script therefore:
  - detects the installed bundle's actual name and KEEPS it when swapping
    in the update, rather than assuming agent-ui.*;
  - reads the installed version from the rebrander's marker
    (app/<name>.version, written as "<tag>+<build>" by its own pinned
    installer) as a fallback, comparing tags with any "+build" suffix
    stripped;
  - always WRITES its own marker to <root>/<name>.version and never touches
    the rebrander's app/<name>.version — the rebrander's pinned installer
    checks its own marker against its own pin, and overwriting it with a
    newer tag would make that installer "helpfully" reinstall (downgrade
    to) its pin on the next launch.

python/ payload (2026-07-16): also extracted from the same zip on every
update — previously only the binary was swapped, silently leaving skills
and setup scripts at the old version forever. python/skills-personal/ (user
-created and catalog-synced skills) is preserved across the refresh. Every
*.sh in the new payload is normalized to LF: agent-ui-win.zip's python/
tree has shipped CRLF before (Windows CI runners), which breaks bash on
Mac ("$'\\r': command not found").

Reuses the atomic-swap safety pattern: download and extract into a staging
directory first, and only remove the existing install once the replacement
is verified in place, so a failed/interrupted download never leaves the
user with no agent-ui at all.

Since agent-ui may be the very process invoking this (e.g. via a skill run
from inside a live session), this script never touches the running binary's
open file — it replaces it on disk and asks the user to relaunch. It does
not attempt a hot in-place self-replace.

Usage:
  python3 self_update.py check    # print whether an update is available
  python3 self_update.py apply    # download and install the latest release
"""
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
_REPO = "kh813/agent-ui"
_API_LATEST = f"https://api.github.com/repos/{_REPO}/releases/latest"

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _dest_name() -> str:
    """Name of the installed bundle/exe at the project root — kept as-is
    across updates so a rebranded install stays under its own name."""
    if sys.platform == "win32":
        default = "agent-ui.exe"
        if (PROJECT_ROOT / default).exists():
            return default
        # A rebranded install has exactly one launcher exe at the root.
        exes = sorted(p.name for p in PROJECT_ROOT.glob("*.exe"))
        return exes[0] if len(exes) == 1 else default
    default = "agent-ui.app"
    if (PROJECT_ROOT / default).is_dir():
        return default
    for p in sorted(PROJECT_ROOT.glob("*.app")):
        # The rebranded bundle is still agent-ui inside (see module docstring).
        if (p / "Contents" / "MacOS" / "agent-ui").exists():
            return p.name
    return default


def _asset_name() -> str:
    return "agent-ui-win.zip" if sys.platform == "win32" else "agent-ui-mac.zip"


def _marker_path(dest_name: str) -> Path:
    return PROJECT_ROOT / f"{dest_name}.version"


def _installed_tag(dest_name: str) -> str:
    """Installed version tag, with any rebrander "+build" suffix stripped.

    Reads this script's own root-level marker first; falls back to a
    rebrander's app/<name>.version (see module docstring)."""
    for marker in (_marker_path(dest_name),
                   PROJECT_ROOT / "app" / f"{dest_name}.version"):
        if marker.exists():
            return marker.read_text().strip().split("+")[0]
    return ""


def _fetch_latest_release() -> dict:
    req = urllib.request.Request(
        _API_LATEST, headers={"Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def check() -> tuple[bool, str, str]:
    """Return (update_available, installed_tag, latest_tag)."""
    release = _fetch_latest_release()
    latest_tag = release["tag_name"]
    installed_tag = _installed_tag(_dest_name())
    return (installed_tag != latest_tag, installed_tag, latest_tag)


def _normalize_sh_to_lf(target: Path) -> None:
    for sh in target.rglob("*.sh"):
        data = sh.read_bytes()
        if b"\r\n" in data:
            sh.write_bytes(data.replace(b"\r\n", b"\n"))


def _install_python_payload(staging: Path) -> None:
    """Refresh <root>/python/ from the zip, preserving skills-personal/."""
    new_python = staging / "python"
    if not new_python.exists():
        return

    dest_python = PROJECT_ROOT / "python"
    existing_personal = dest_python / "skills-personal"
    personal_backup = staging / "_skills_personal_backup"
    if existing_personal.exists():
        shutil.move(str(existing_personal), str(personal_backup))

    if dest_python.is_symlink():
        dest_python.unlink()
    elif dest_python.exists():
        shutil.rmtree(dest_python)
    shutil.copytree(new_python, dest_python)
    _normalize_sh_to_lf(dest_python)

    if personal_backup.exists():
        shutil.rmtree(dest_python / "skills-personal", ignore_errors=True)
        shutil.move(str(personal_backup), str(dest_python / "skills-personal"))


def apply() -> None:
    release = _fetch_latest_release()
    latest_tag = release["tag_name"]
    dest_name = _dest_name()
    installed_tag = _installed_tag(dest_name)

    if installed_tag == latest_tag:
        print(f"  Already up to date: {dest_name} ({latest_tag})")
        return

    asset_name = _asset_name()
    asset = next(
        (a for a in release.get("assets", []) if a["name"] == asset_name), None
    )
    if asset is None:
        raise RuntimeError(
            f"Release {latest_tag} does not contain an asset named {asset_name}"
        )
    url = asset["browser_download_url"]

    print(f"  Updating agent-ui: {installed_tag or 'unknown'} -> {latest_tag}")
    print(f"  Downloading {url}...")

    dest = PROJECT_ROOT / dest_name
    upstream_name = "agent-ui.exe" if sys.platform == "win32" else "agent-ui.app"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / asset_name
        subprocess.run(
            ["curl", "-fsSL", "--connect-timeout", "10", "--max-time", "120",
             url, "-o", str(zip_path)],
            check=True, stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW,
        )
        staging = tmp_path / "extracted"
        staging.mkdir()
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(staging)

        new_dest = staging / upstream_name
        if not new_dest.exists():
            raise RuntimeError(
                f"Downloaded archive from {url} did not contain {upstream_name}"
            )

        if sys.platform != "win32":
            subprocess.run(["xattr", "-cr", str(new_dest)], check=False, stdin=subprocess.DEVNULL)
            (new_dest / "Contents" / "MacOS" / "agent-ui").chmod(0o755)
            # Defensive ad-hoc re-sign over the final bundle (an upstream CI
            # signing bug once shipped a bundle whose resource seal predated
            # Contents/Resources — harmless no-op on correctly-signed builds).
            subprocess.run(
                ["codesign", "--force", "--deep", "--sign", "-", str(new_dest)],
                check=False, stdin=subprocess.DEVNULL,
            )

        if dest.is_symlink():
            dest.unlink()
        elif dest.is_dir():
            shutil.rmtree(dest)
        elif dest.exists():
            dest.unlink()
        shutil.move(str(new_dest), str(dest))

        _install_python_payload(staging)

    _marker_path(dest_name).write_text(latest_tag)
    print(f"  agent-ui {latest_tag} installed to {dest}.")
    print("  Restart agent-ui to use the new version.")


def _usage():
    print("Usage: self_update.py [check|apply]")
    sys.exit(1)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check":
        available, installed, latest = check()
        if available:
            print(f"Update available: {installed or 'unknown'} -> {latest}")
        else:
            print(f"Already up to date: {latest}")
    elif cmd == "apply":
        apply()
    else:
        _usage()
