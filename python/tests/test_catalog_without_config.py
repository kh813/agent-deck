"""An install from the public GitHub ZIP has no config.toml (only the org
ZIP ships one). The launch-time catalog sync must then be a silent no-op
instead of a FileNotFoundError traceback on every launch (seen for real on
Windows after updating to 0.2.3)."""
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _tree(tmp_path: Path) -> Path:
    setup_dir = tmp_path / "python" / "scripts" / "setup"
    setup_dir.mkdir(parents=True)
    shutil.copy(ROOT / "python" / "scripts" / "setup" / "skills_catalog.py", setup_dir)
    return setup_dir / "skills_catalog.py"


def _run(script: Path, *args):
    return subprocess.run([sys.executable, "-I", str(script), *args],
                          capture_output=True, text=True, timeout=60)


def test_sync_is_silent_noop_without_config(tmp_path):
    r = _run(_tree(tmp_path), "sync")
    assert r.returncode == 0, r.stderr
    assert "Traceback" not in r.stderr + r.stdout
    assert r.stdout.strip() == ""


def test_other_commands_explain_instead_of_traceback(tmp_path):
    r = _run(_tree(tmp_path), "list")
    assert r.returncode == 1
    assert "Traceback" not in r.stderr
    assert "config.toml" in r.stdout


def test_setup_skips_catalog_sync_without_config(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "agent_setup_nocfg", ROOT / "python" / "scripts" / "setup" / "setup.py")
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)
    monkeypatch.setattr(setup, "CONFIG_PATH", tmp_path / "config.toml")
    called = []
    monkeypatch.setattr(setup.subprocess, "run", lambda *a, **k: called.append(a))
    setup.sync_catalog_skills()
    assert called == []


def _load_setup(name):
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "python" / "scripts" / "setup" / "setup.py")
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)
    return setup


def _fake_root(tmp_path, git: bool):
    (tmp_path / "config.toml").write_text("")
    if git:
        (tmp_path / ".git").mkdir()
    return tmp_path / "config.toml"


def test_dev_checkout_skips_catalog_sync(tmp_path, monkeypatch):
    setup = _load_setup("agent_setup_devskip")
    monkeypatch.setattr(setup, "CONFIG_PATH", _fake_root(tmp_path, git=True))
    monkeypatch.delenv("AGENT_DECK_CATALOG_SYNC", raising=False)
    called = []
    monkeypatch.setattr(setup.subprocess, "run", lambda *a, **k: called.append(a))
    setup.sync_catalog_skills()
    assert called == []


def test_dev_checkout_sync_can_be_forced(tmp_path, monkeypatch):
    setup = _load_setup("agent_setup_devforce")
    monkeypatch.setattr(setup, "CONFIG_PATH", _fake_root(tmp_path, git=True))
    monkeypatch.setenv("AGENT_DECK_CATALOG_SYNC", "1")
    called = []
    monkeypatch.setattr(setup.subprocess, "run",
                        lambda *a, **k: called.append(a) or type("R", (), {"returncode": 0})())
    setup.sync_catalog_skills()
    assert len(called) == 1


def test_installed_copy_still_syncs(tmp_path, monkeypatch):
    setup = _load_setup("agent_setup_installsync")
    monkeypatch.setattr(setup, "CONFIG_PATH", _fake_root(tmp_path, git=False))
    monkeypatch.delenv("AGENT_DECK_CATALOG_SYNC", raising=False)
    called = []
    monkeypatch.setattr(setup.subprocess, "run",
                        lambda *a, **k: called.append(a) or type("R", (), {"returncode": 0})())
    setup.sync_catalog_skills()
    assert len(called) == 1
