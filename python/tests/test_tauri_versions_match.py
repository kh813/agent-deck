"""`tauri build` refuses to build when an npm Tauri package and its Rust crate
differ in major/minor (2026-11-26: adding the notification plugin with npm
pulled @tauri-apps/api 2.12 against tauri 2.11 and the 0.3.0-rc3 release
build failed on both platforms -- normal CI doesn't run tauri build)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PAIRS = {
    "@tauri-apps/api": "tauri",
    "@tauri-apps/plugin-dialog": "tauri-plugin-dialog",
    "@tauri-apps/plugin-notification": "tauri-plugin-notification",
    "@tauri-apps/plugin-opener": "tauri-plugin-opener",
    "@tauri-apps/plugin-shell": "tauri-plugin-shell",
    "@tauri-apps/plugin-store": "tauri-plugin-store",
}


def crate_versions():
    lock = (ROOT / "src-tauri" / "Cargo.lock").read_text(encoding="utf-8")
    return dict(re.findall(r'\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"', lock.replace("\r\n", "\n")))


def minor(v):
    return tuple(v.split(".")[:2])


def test_npm_and_crate_major_minor_match():
    npm = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))["packages"]
    crates = crate_versions()
    bad = []
    for pkg, crate in PAIRS.items():
        n = npm.get(f"node_modules/{pkg}", {}).get("version")
        c = crates.get(crate)
        if n and c and minor(n) != minor(c):
            bad.append(f"{pkg} {n} vs {crate} {c}")
    assert bad == [], bad


def test_ranges_cant_drift_to_a_new_minor():
    deps = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["dependencies"]
    for pkg in ("@tauri-apps/api", "@tauri-apps/plugin-notification"):
        assert deps[pkg].startswith("~"), f"{pkg}: {deps[pkg]}"
