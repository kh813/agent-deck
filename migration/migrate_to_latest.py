#!/usr/bin/env python3
"""One-time forced update for agent-deck installs at v0.2.2-rc1 or earlier.

Why this exists: until v0.2.2-rc2, python/scripts/setup/self_update.py
computed PROJECT_ROOT as <root>/python instead of <root>, so the app's own
"Update" menu fails on every such install (org Drive channel: "venv not
found"; GitHub channel: would install into <root>/python/). The update is
run by the INSTALLED copy of self_update.py, so shipping a fixed version
can't help an install that still has the broken one.

This script runs that same installed self_update.py -- the exact code path
the menu uses -- but first sets its PROJECT_ROOT to the real install root.
Nothing in the install is edited beforehand; the update itself replaces
python/ (including self_update.py) with the new version's fixed copy, so
from then on the normal Update menu works again.

Usage (normally via the .command / .bat wrapper next to this file):
  <install>/venv/bin/python3 migrate_to_latest.py <install_root> [prod|test]

  Without a channel it asks interactively (and first waits for the app to
  be quit), which is what the double-click wrappers use.

  prod (default): the org's production Drive build if config.toml has
                  [drive] org_release_prod_file_id, else GitHub's latest
                  stable release.
  test:           the org's test Drive build (org_release_test_file_id),
                  else GitHub's newest pre-release.
"""
import re
import subprocess
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

# The fixed assignment line itself (a mere "parents[3]" substring would also
# match a comment).
FIXED_LINE_RE = re.compile(r"^PROJECT_ROOT\s*=\s*Path\(__file__\)\.resolve\(\)\.parents\[3\]", re.M)


def find_problem(root: Path) -> str:
    """Return a human-readable reason `root` isn't an agent-deck install, or ""."""
    if not (root / "agent_config.json").is_file():
        return f"agent_config.json が見つかりません / agent_config.json not found in {root}"
    if not (root / "python" / "scripts" / "setup" / "self_update.py").is_file():
        return f"self_update.py が見つかりません / python/scripts/setup/self_update.py not found in {root}"
    if not (root / "config.toml").is_file():
        return f"config.toml が見つかりません / config.toml not found in {root}"
    return ""


def load_modules(root: Path):
    """Import the INSTALLED config and self_update modules from `root`."""
    sys.path[:0] = [str(root / "python"), str(root / "python" / "scripts" / "setup")]
    import config  # noqa: E402
    import self_update as su  # noqa: E402
    su.PROJECT_ROOT = root
    return config, su


def resolve_source(config, channel: str):
    """("drive", file_id) when the org has a Drive build for `channel`,
    else ("github", channel)."""
    key = "ORG_RELEASE_TEST_FILE_ID" if channel == "test" else "ORG_RELEASE_PROD_FILE_ID"
    file_id = (getattr(config, key, "") or "").strip()
    return ("drive", file_id) if file_id else ("github", channel)


def is_fixed(root: Path) -> bool:
    src = (root / "python" / "scripts" / "setup" / "self_update.py").read_text(encoding="utf-8")
    return bool(FIXED_LINE_RE.search(src))


def _running_app_paths() -> list:
    """Executable paths of every running agent-deck process (any install)."""
    if sys.platform == "win32":
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-Process agent-deck -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"],
            capture_output=True, text=True).stdout
        return [ln.strip() for ln in out.splitlines() if ln.strip()]
    out = subprocess.run(["ps", "-axo", "command="], capture_output=True, text=True).stdout
    return [ln.strip() for ln in out.splitlines() if "agent-deck.app/Contents/MacOS/agent-deck" in ln]


def app_is_running(root: Path) -> bool:
    """Only THIS install's app matters (another install running elsewhere,
    e.g. the user's everyday copy, must not block the update)."""
    if sys.platform == "win32":
        target = str(root / "agent-deck.exe").lower()
        return any(p.lower() == target for p in _running_app_paths())
    target = str(root / "agent-deck.app" / "Contents" / "MacOS" / "agent-deck")
    return any(p.startswith(target) for p in _running_app_paths())


def wait_until_app_quit(root: Path, ask=input) -> None:
    try:
        while app_is_running(root):
            ask("この agent-deck が起動中です。終了してから Enter を押してください。\n"
                "This agent-deck is running -- quit it, then press Enter: ")
    except OSError:
        pass  # can't tell (no ps/powershell): just proceed


def ask_channel(ask=input) -> str:
    print("どちらに更新しますか？ / Which build?")
    print("  1) 正式版 / production  (既定 / default)")
    print("  2) テスト版 / test")
    answer = ask("番号を入力して Enter / Enter 1 or 2: ").strip()
    return "test" if answer == "2" else "prod"


def drop_legacy_catalog_duplicates(root: Path) -> list:
    """Installs from before python/skills-catalog/ existed kept catalog-synced
    skills in python/skills-personal/ (listed in its .catalog-sync-manifest).
    The org ZIP now bundles those same skills in python/skills-catalog/, so
    remove the legacy copies that are now duplicated there. The legacy
    manifest itself is left for the app's own migration step (it merges and
    deletes it on the next launch). The user's own skills are never in that
    manifest, so they're never touched."""
    import json
    import shutil
    personal = root / "python" / "skills-personal"
    catalog = root / "python" / "skills-catalog"
    legacy_manifest = personal / ".catalog-sync-manifest"
    if not legacy_manifest.is_file():
        return []
    try:
        names = list(json.loads(legacy_manifest.read_text(encoding="utf-8")))
    except (ValueError, OSError):
        return []
    removed = []
    for name in names:
        if (personal / name).is_dir() and (catalog / name / "SKILL.md").is_file():
            shutil.rmtree(personal / name)
            removed.append(name)
    return removed


def main(argv) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    root = Path(argv[1].strip().strip('"').strip("'")).expanduser().resolve()
    problem = find_problem(root)
    if problem:
        print(f"[ERROR] {problem}")
        return 1

    if len(argv) > 2:
        channel = argv[2]
        if channel not in ("prod", "test"):
            print(f"[ERROR] channel must be prod or test, got {channel!r}")
            return 2
    else:
        wait_until_app_quit(root)
        channel = ask_channel()

    config, su = load_modules(root)
    kind, value = resolve_source(config, channel)
    label = "テスト版 / test" if channel == "test" else "正式版 / production"
    origin = "組織 Drive / org Drive" if kind == "drive" else "GitHub"
    print(f"==> {root}")
    print(f"==> {label} を {origin} から取得します / Fetching the {label} build from {origin}")

    if kind == "drive":
        su.apply_drive(value)
    else:
        su.apply(value)

    for name in drop_legacy_catalog_duplicates(root):
        print(f"==> 旧配置の重複スキルを整理しました / Removed duplicate legacy copy: {name}")

    if is_fixed(root):
        print("==> 完了。次回からはアプリの Update メニューで更新できます。")
        print("    Done. From now on the app's Update menu works normally.")
        return 0
    print("[WARN] 更新後の self_update.py がまだ修正前の版です（v0.2.2-rc2 以降が必要）。")
    print("       The updated self_update.py is still the old one -- the fetched build")
    print("       predates v0.2.2-rc2. Publish a newer build to this channel and run again.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
