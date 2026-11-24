"""Tests for migration/migrate_to_latest.py -- the one-time forced update
for installs whose own self_update.py has the pre-v0.2.2-rc2 PROJECT_ROOT
bug. Uses a fake install tree whose config/self_update modules record what
they were asked to do; no network, no real app."""
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
MIGRATION_DIR = ROOT / "migration"

BUGGY_SELF_UPDATE = '''
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
CALLS = []
FIXED = """PROJECT_ROOT = Path(__file__).resolve().parents[3]\\n"""

def _upgrade_payload():
    # What a real apply does: python/ (incl. this file) replaced by the new build.
    (PROJECT_ROOT / "python" / "scripts" / "setup" / "self_update.py").write_text(FIXED)

def apply_drive(file_id):
    CALLS.append(("drive", file_id, PROJECT_ROOT))
    _upgrade_payload()

def apply(channel="prod"):
    CALLS.append(("github", channel, PROJECT_ROOT))
    _upgrade_payload()
'''


@pytest.fixture
def migrate(monkeypatch):
    spec = importlib.util.spec_from_file_location("migrate_to_latest", MIGRATION_DIR / "migrate_to_latest.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    saved_path = list(sys.path)
    yield mod
    sys.path[:] = saved_path
    for name in ("config", "self_update"):
        sys.modules.pop(name, None)


def _make_install(tmp_path, test_id="", prod_id=""):
    root = tmp_path / "agent deck"  # space on purpose
    setup = root / "python" / "scripts" / "setup"
    setup.mkdir(parents=True)
    (root / "agent_config.json").write_text("{}")
    (root / "config.toml").write_text("")
    (root / "python" / "config").mkdir()
    (root / "python" / "config" / "__init__.py").write_text(
        f'ORG_RELEASE_TEST_FILE_ID = "{test_id}"\nORG_RELEASE_PROD_FILE_ID = "{prod_id}"\n')
    (setup / "self_update.py").write_text(BUGGY_SELF_UPDATE)
    return root


def test_rejects_non_install_folder(migrate, tmp_path, capsys):
    assert migrate.main(["x", str(tmp_path), "prod"]) == 1
    assert "agent_config.json" in capsys.readouterr().out


def test_drive_prod_uses_install_root_not_python_dir(migrate, tmp_path):
    root = _make_install(tmp_path, test_id="T", prod_id="P")
    assert migrate.main(["x", str(root), "prod"]) == 0
    su = sys.modules["self_update"]
    assert su.CALLS == [("drive", "P", root.resolve())]


def test_drive_test_channel(migrate, tmp_path):
    root = _make_install(tmp_path, test_id="T", prod_id="P")
    assert migrate.main(["x", str(root), "test"]) == 0
    assert sys.modules["self_update"].CALLS[0][:2] == ("drive", "T")


def test_falls_back_to_github_without_org_ids(migrate, tmp_path):
    root = _make_install(tmp_path)
    assert migrate.main(["x", str(root), "test"]) == 0
    assert sys.modules["self_update"].CALLS[0][:2] == ("github", "test")


def test_quoted_dragged_path_is_accepted(migrate, tmp_path):
    root = _make_install(tmp_path, prod_id="P")
    assert migrate.main(["x", f'"{root}" ', "prod"]) == 0


def test_warns_when_fetched_build_is_still_buggy(migrate, tmp_path, capsys):
    root = _make_install(tmp_path, prod_id="P")
    setup_py = root / "python" / "scripts" / "setup" / "self_update.py"
    # The fetched build itself still predates the fix: payload stays buggy.
    setup_py.write_text(BUGGY_SELF_UPDATE.replace(
        "def _upgrade_payload():", "def _upgrade_payload():\n    return"))
    assert migrate.main(["x", str(root), "prod"]) == 1
    assert "WARN" in capsys.readouterr().out


def test_interactive_channel_choice(migrate):
    assert migrate.ask_channel(lambda _: "2") == "test"
    assert migrate.ask_channel(lambda _: "") == "prod"
    assert migrate.ask_channel(lambda _: "1") == "prod"


def test_interactive_waits_for_app_to_quit(migrate, monkeypatch, tmp_path):
    states = iter([True, True, False])
    monkeypatch.setattr(migrate, "app_is_running", lambda root: next(states))
    prompts = []
    migrate.wait_until_app_quit(tmp_path, lambda msg: prompts.append(msg))
    assert len(prompts) == 2


def test_only_this_installs_app_counts_as_running(migrate, monkeypatch, tmp_path):
    """A different install running elsewhere (the user's everyday copy)
    must not block the update -- confirmed for real during testing."""
    other = tmp_path / "other"
    mine = tmp_path / "mine"
    if sys.platform == "win32":
        running = [str(other / "agent-deck.exe")]
        mine_path = str(mine / "agent-deck.exe")
    else:
        running = [str(other / "agent-deck.app/Contents/MacOS/agent-deck")]
        mine_path = str(mine / "agent-deck.app/Contents/MacOS/agent-deck")
    monkeypatch.setattr(migrate, "_running_app_paths", lambda: running)
    assert not migrate.app_is_running(mine)
    running.append(mine_path)
    assert migrate.app_is_running(mine)


def test_bat_wrapper_is_ascii_crlf_without_paren_blocks():
    data = (MIGRATION_DIR / "Update_agent-deck_for_Windows.bat").read_bytes()
    data.decode("ascii")
    assert b"\n" not in data.replace(b"\r\n", b"")
    for line in data.decode("ascii").splitlines():
        if not line.strip().lower().startswith("rem"):
            assert not line.rstrip().endswith("("), line
    # A trailing backslash before the closing quote would escape it.
    assert 'set "ROOT=%HERE%."' in data.decode("ascii")


def test_command_wrapper_is_executable_and_lf():
    p = MIGRATION_DIR / "Update_agent-deck_for_Mac.command"
    assert b"\r" not in p.read_bytes()
    if sys.platform != "win32":
        assert p.stat().st_mode & 0o111


def test_is_fixed_matches_the_real_fixed_file(migrate):
    """Must recognise the repo's actual fixed self_update.py (and its
    explanatory comment mentioning parents[2] must not confuse it)."""
    assert migrate.is_fixed(ROOT)
