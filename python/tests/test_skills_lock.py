"""Skill rebuilds must never run concurrently.

Confirmed for real on Windows (2026-11-25): a second session start while the
first was still in its pre-launch step ran two preflights at once, and their
build-skills.ps1 runs collided on skills\\*.zip / *.skill ("used by another
process", access denied), failing the start. setup.py now serializes every
skill rebuild with an OS file lock (_skills_lock). These tests exercise that
lock with real processes, so they hold on both macOS and Windows (CI runs
them on both -- see .github/workflows/test.yml).
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SETUP_SRC = ROOT / "python" / "scripts" / "setup"


def _load_setup(name="agent_setup_lock"):
    spec = importlib.util.spec_from_file_location(name, SETUP_SRC / "setup.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── in-process behavior ─────────────────────────────────────────────

def test_lock_is_reentrant_within_one_process(tmp_path):
    setup = _load_setup()
    lock_path = tmp_path / "skills" / ".build.lock"
    with setup._skills_lock(lock_path, timeout=1):
        with setup._skills_lock(lock_path, timeout=1):  # must not deadlock
            pass
    assert setup._skills_lock_depth == 0


def test_lock_is_released_after_an_exception(tmp_path):
    setup = _load_setup()
    lock_path = tmp_path / "skills" / ".build.lock"
    with pytest.raises(RuntimeError):
        with setup._skills_lock(lock_path, timeout=1):
            raise RuntimeError("build failed")
    assert setup._skills_lock_depth == 0
    # Another process can take it right away.
    r = _hold_lock_proc(tmp_path, lock_path, hold=0, timeout=2)
    out, _ = r.communicate(timeout=30)
    assert json.loads(out.strip().splitlines()[-1])["waited"] < 1.5


def test_lock_creates_its_directory(tmp_path):
    setup = _load_setup()
    lock_path = tmp_path / "fresh" / "skills" / ".build.lock"
    with setup._skills_lock(lock_path, timeout=1):
        assert lock_path.exists()


@pytest.mark.parametrize("name", ["skills_rebuild", "skills_enable", "skills_disable"])
def test_skill_mutating_commands_take_the_lock(name, monkeypatch):
    setup = _load_setup()
    fn = getattr(setup, name)
    assert getattr(fn, "__wrapped__", None) is not None, f"{name} is not wrapped in _with_skills_lock"

    depths = []
    for inner in ("sync_catalog_skills", "build_skills", "install_skills", "install_claude_settings"):
        monkeypatch.setattr(setup, inner, lambda *a, **k: depths.append(setup._skills_lock_depth))
    import tempfile
    tmp = Path(tempfile.mkdtemp())
    monkeypatch.setattr(setup, "SKILLS_LOCK_PATH", tmp / ".build.lock")
    if name == "skills_rebuild":
        setup.skills_rebuild()
        assert depths and all(d >= 1 for d in depths)
    else:
        # Unknown skill: exits after searching -- still under the lock.
        monkeypatch.setattr(setup, "_skill_roots", lambda root: [])
        seen = []
        monkeypatch.setattr(setup.sys, "exit", lambda code=0: seen.append(setup._skills_lock_depth))
        fn("no-such-skill")
        assert seen == [1]
    shutil.rmtree(tmp, ignore_errors=True)


def test_init_builds_skills_under_the_lock():
    src = (SETUP_SRC / "setup.py").read_text(encoding="utf-8")
    init = src[src.index('if cmd == "init":'):src.index('elif cmd == "skills":')]
    assert "with _skills_lock():" in init
    block = init[init.index("with _skills_lock():"):]
    assert block.index("build_skills()") < block.index("install_gemini_policies()")
    assert block.index("install_skills()") < block.index("install_gemini_policies()")


def test_lock_file_is_gitignored():
    r = subprocess.run(["git", "check-ignore", "-q", "skills/.build.lock"], cwd=ROOT)
    if r.returncode == 128:
        pytest.skip("not a git checkout")
    assert r.returncode == 0, "skills/.build.lock must be gitignored"


# ── cross-process behavior (real OS locks) ──────────────────────────

_HOLDER = textwrap.dedent("""
    import importlib.util, json, sys, time
    spec = importlib.util.spec_from_file_location("s", sys.argv[1])
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    hold, timeout, path = float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
    t0 = time.time()
    with m._skills_lock(path, timeout=timeout, poll=0.05) as lk:
        t1 = time.time()
        locked = lk.locked
        print("LOCKED", flush=True)
        time.sleep(hold)
        t2 = time.time()
    print(json.dumps({"start": t1, "end": t2, "waited": t1 - t0, "locked": locked}), flush=True)
""")


def _hold_lock_proc(tmp_path, lock_path, hold, timeout):
    script = tmp_path / "holder.py"
    script.write_text(_HOLDER, encoding="utf-8")
    return subprocess.Popen(
        [sys.executable, "-I", str(script), str(SETUP_SRC / "setup.py"), str(hold), str(timeout), str(lock_path)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )


def _wait_locked(proc):
    line = proc.stdout.readline()
    assert line.strip() == "LOCKED", proc.stderr.read()


def test_second_process_waits_for_the_first(tmp_path):
    lock_path = tmp_path / "skills" / ".build.lock"
    a = _hold_lock_proc(tmp_path, lock_path, hold=1.5, timeout=30)
    _wait_locked(a)
    b = _hold_lock_proc(tmp_path, lock_path, hold=0, timeout=30)
    out_a, _ = a.communicate(timeout=60)
    out_b, err_b = b.communicate(timeout=60)
    ra = json.loads(out_a.strip().splitlines()[-1])
    rb = json.loads(out_b.strip().splitlines()[-1])
    assert ra["locked"] and rb["locked"]
    assert rb["start"] >= ra["end"] - 0.05, (ra, rb)  # no overlap
    assert "waiting for it to finish" in out_b


def test_many_concurrent_holders_never_overlap(tmp_path):
    lock_path = tmp_path / "skills" / ".build.lock"
    procs = [_hold_lock_proc(tmp_path, lock_path, hold=0.3, timeout=60) for _ in range(5)]
    spans = []
    for p in procs:
        out, err = p.communicate(timeout=120)
        assert p.returncode == 0, err
        spans.append(json.loads(out.strip().splitlines()[-1]))
    spans.sort(key=lambda s: s["start"])
    for prev, nxt in zip(spans, spans[1:]):
        assert nxt["start"] >= prev["end"] - 0.05, spans


def test_waiter_gives_up_after_timeout_and_continues(tmp_path):
    lock_path = tmp_path / "skills" / ".build.lock"
    a = _hold_lock_proc(tmp_path, lock_path, hold=4, timeout=30)
    _wait_locked(a)
    b = _hold_lock_proc(tmp_path, lock_path, hold=0, timeout=0.5)
    out_b, err_b = b.communicate(timeout=60)
    assert b.returncode == 0, err_b
    rb = json.loads(out_b.strip().splitlines()[-1])
    assert rb["locked"] is False
    assert 0.4 <= rb["waited"] < 3.5
    assert "Timed out waiting" in out_b
    a.communicate(timeout=60)


def test_lock_released_when_holder_is_killed(tmp_path):
    lock_path = tmp_path / "skills" / ".build.lock"
    a = _hold_lock_proc(tmp_path, lock_path, hold=60, timeout=30)
    _wait_locked(a)
    a.kill()
    a.communicate(timeout=30)
    b = _hold_lock_proc(tmp_path, lock_path, hold=0, timeout=10)
    out_b, err_b = b.communicate(timeout=60)
    rb = json.loads(out_b.strip().splitlines()[-1])
    assert rb["locked"] is True and rb["waited"] < 5


# ── end to end: two real `setup.py skills rebuild` runs at once ─────

def _install_tree(tmp_path: Path) -> Path:
    """A minimal install: the real setup scripts + a few bundled skills."""
    root = tmp_path / "install"
    shutil.copytree(SETUP_SRC, root / "python" / "scripts" / "setup",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "python" / "config", root / "python" / "config")
    for i in range(8):
        d = root / "python" / "skills" / f"skill-{i}"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(f"---\nname: skill-{i}\ndescription: test {i}\n---\nbody {i}\n", encoding="utf-8")
    return root


def test_concurrent_rebuilds_both_succeed(tmp_path):
    real_claude = Path.home() / ".claude" / "skills"
    before = sorted(p.name for p in real_claude.iterdir()) if real_claude.exists() else None
    if sys.platform != "win32" and shutil.which("zip") is None:
        pytest.skip("build-skills.sh needs zip")
    root = _install_tree(tmp_path)
    # install_skills() also mirrors into ~/.gemini/skills and ~/.claude/skills
    # (with stale-entry cleanup): point HOME at a scratch dir, or this test
    # would replace the developer's real installed skills (it did, once).
    home = tmp_path / "home"
    home.mkdir()
    env = dict(os.environ, HOME=str(home), USERPROFILE=str(home), AGENT_DECK_NONINTERACTIVE="1")
    cmd = [sys.executable, "-I", str(root / "python" / "scripts" / "setup" / "setup.py"), "skills", "rebuild"]
    procs = [subprocess.Popen(cmd, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
             for _ in range(3)]
    outs = [p.communicate(timeout=600)[0] for p in procs]
    for p, out in zip(procs, outs):
        assert p.returncode == 0, out
        assert "Skills rebuilt and reinstalled." in out, out
    built = sorted(f.name for f in (root / "skills").glob("*.skill"))
    assert built == [f"skill-{i}.skill" for i in range(8)]
    assert not list((root / "skills").glob("*.zip")), "leftover temp zips"
    for d in (home / ".claude" / "skills", home / ".gemini" / "skills"):
        assert sorted(p.name for p in d.iterdir() if p.is_dir()) == [f"skill-{i}" for i in range(8)]
    after = sorted(p.name for p in real_claude.iterdir()) if real_claude.exists() else None
    assert after == before, "test leaked into the real ~/.claude/skills"
