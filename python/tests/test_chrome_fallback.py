"""common.get_chrome_executable() / get_user_data_dir(): fall back to
Playwright's bundled Chromium when the system Chrome can't be launched.

Confirmed for real (2026-11-25, macOS 27 + Chrome 158): every new launch of
/Applications/Google Chrome.app was SIGKILLed by the kernel (exit 137,
"Taskgated Invalid Signature") while the already-running copy kept working,
so ask-portal failed with Playwright's TargetClosedError."""
import importlib.util
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
AUTOMATION = ROOT / "python" / "scripts" / "automation"


@pytest.fixture
def common(monkeypatch, tmp_path):
    cfg = MagicMock(COMPANY_DOMAIN="example.com", USER_EMAIL="u@example.com",
                    CONFIG_PATH=tmp_path / "config.toml")
    monkeypatch.setitem(sys.modules, "config", cfg)
    spec = importlib.util.spec_from_file_location("automation_common_fallback", AUTOMATION / "common.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Keep profiles out of the real tree.
    monkeypatch.setattr(mod.os.path, "abspath", lambda p: str(tmp_path / "common.py"))
    monkeypatch.setattr(mod, "_ensure_bundled_chromium", lambda: None)
    monkeypatch.setattr(mod, "pf", "Darwin")
    return mod


def _chrome_at(common, monkeypatch, path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
    monkeypatch.setattr(common, "_find_system_chrome", lambda: path)
    return path


def test_launchable_chrome_is_used(common, monkeypatch, tmp_path):
    path = _chrome_at(common, monkeypatch)
    monkeypatch.setattr(common.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a[0], 0, stdout="Google Chrome 158.0\n"))
    assert common.get_chrome_executable() == path
    assert Path(common.get_user_data_dir()).name == "ChromeUserData"


def test_killed_chrome_falls_back_to_bundled(common, monkeypatch, capsys):
    _chrome_at(common, monkeypatch)
    calls = []

    def killed(*a, **k):
        calls.append(a[0])
        return subprocess.CompletedProcess(a[0], 137, stdout="")

    monkeypatch.setattr(common.subprocess, "run", killed)
    assert common.get_chrome_executable() is None  # = Playwright's bundled Chromium
    assert Path(common.get_user_data_dir()).name == "ChromeUserData-bundled"
    assert "Chromium" in capsys.readouterr().out
    common.get_chrome_executable()
    assert len(calls) == 1, "the probe result must be cached"


def test_missing_chrome_falls_back_instead_of_exiting(common, monkeypatch):
    monkeypatch.setattr(common, "_find_system_chrome", lambda: None)
    assert common.get_chrome_executable() is None


def test_windows_skips_the_probe(common, monkeypatch):
    monkeypatch.setattr(common, "pf", "Windows")
    path = _chrome_at(common, monkeypatch, r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    monkeypatch.setattr(common.subprocess, "run", lambda *a, **k: pytest.fail("no probe on Windows"))
    assert common.get_chrome_executable() == path


def test_update_user_data_ships_with_agent_deck():
    """It used to exist only in the download-*-users catalog skills."""
    src = (AUTOMATION / "automate.py").read_text(encoding="utf-8")
    assert '"update-user-data": "chrome_login.py"' in src
    assert (AUTOMATION / "chrome_login.py").exists()


def test_bundled_profile_survives_updates_and_is_ignored():
    sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))
    import self_update
    assert "scripts/automation/ChromeUserData-bundled" in self_update._PRESERVED_PYTHON_DIRS
    assert "python/scripts/automation/ChromeUserData-bundled/" in (ROOT / ".gitignore").read_text()
