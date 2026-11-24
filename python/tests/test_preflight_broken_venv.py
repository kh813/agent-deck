"""preflight.sh / preflight.bat: a venv whose interpreter exists but no
longer runs (e.g. built from a Homebrew Python that `brew upgrade` later
removed -- confirmed for real) must be moved aside so first-time setup
rebuilds it, instead of every venv-backed feature silently failing.

preflight.sh is run for real in a temp tree whose setup.py is a stub that
just records how it was called; preflight.bat is checked statically (no
Windows runner here)."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="runs preflight.sh with bash")

STUB_SETUP = """import sys, pathlib
root = pathlib.Path(__file__).resolve().parents[3]
with open(root / "calls.log", "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\\n")
"""


def _tree(tmp_path: Path) -> Path:
    (tmp_path / "python" / "scripts" / "setup").mkdir(parents=True)
    (tmp_path / "python" / "scripts" / "setup" / "setup.py").write_text(STUB_SETUP)
    shutil.copy(ROOT / "preflight.sh", tmp_path / "preflight.sh")
    return tmp_path


def _run(tree: Path) -> list:
    env = dict(os.environ, PATH=f"{Path(sys.executable).parent}:/usr/bin:/bin")
    # preflight calls a bare `python3`; make sure it resolves to a real one.
    bindir = tree / "_bin"
    bindir.mkdir(exist_ok=True)
    (bindir / "python3").symlink_to(sys.executable)
    env["PATH"] = f"{bindir}:{env['PATH']}"
    subprocess.run(["bash", str(tree / "preflight.sh")], cwd=tree, env=env,
                   check=True, capture_output=True, text=True)
    log = tree / "calls.log"
    return log.read_text().splitlines() if log.exists() else []


def test_broken_venv_is_moved_aside_and_rebuilt(tmp_path):
    tree = _tree(tmp_path)
    (tree / "venv" / "bin").mkdir(parents=True)
    (tree / "venv" / "bin" / "python3").symlink_to("/nonexistent/python3.14")

    calls = _run(tree)

    assert not (tree / "venv").exists() or not (tree / "venv" / "bin" / "python3").is_symlink()
    assert (tree / "venv.broken" / "bin" / "python3").is_symlink()
    assert "init" in calls, calls


def test_previous_venv_broken_is_replaced(tmp_path):
    tree = _tree(tmp_path)
    (tree / "venv.broken").mkdir()
    (tree / "venv.broken" / "old-marker").write_text("x")
    (tree / "venv" / "bin").mkdir(parents=True)
    (tree / "venv" / "bin" / "python3").symlink_to("/nonexistent/python3.14")

    _run(tree)

    assert not (tree / "venv.broken" / "old-marker").exists()


def test_working_venv_is_left_alone(tmp_path):
    tree = _tree(tmp_path)
    (tree / "venv" / "bin").mkdir(parents=True)
    (tree / "venv" / "bin" / "python3").symlink_to(sys.executable)

    calls = _run(tree)

    assert (tree / "venv" / "bin" / "python3").is_symlink()
    assert not (tree / "venv.broken").exists()
    assert "init" not in calls
    assert "skills rebuild" in calls


def test_venv_without_interpreter_is_left_alone(tmp_path):
    """No interpreter at all is not 'broken' -- nothing to move aside."""
    tree = _tree(tmp_path)
    (tree / "venv").mkdir()

    calls = _run(tree)

    assert (tree / "venv").is_dir()
    assert not (tree / "venv.broken").exists()
    assert "init" not in calls


def test_preflight_bat_moves_broken_venv_but_keeps_empty_marker():
    src = (ROOT / "preflight.bat").read_bytes().decode("ascii")
    health = src.index('\r\n:venv_health_done\r\n')  # the label, not the gotos
    block = src[src.index('if not exist "venv\\Scripts\\python.exe" goto :venv_health_done'):health]
    assert '"venv\\Scripts\\python.exe" -c "import sys"' in block
    assert 'move "venv" "venv.broken"' in block
    # The health check must run before the "does venv\\ exist" branch that
    # decides whether to run setup.bat.
    assert health < src.index('if exist "venv\\" goto :venv_exists')
