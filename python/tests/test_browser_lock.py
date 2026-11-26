"""One browser-automation skill at a time across agent-deck tabs (5.7.4):
every browser skill uses the same Chrome profile, so a second one waits for
the first and then gives up with a clear message."""
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
AUTOMATION = ROOT / "python" / "scripts" / "automation"
sys.path.insert(0, str(AUTOMATION))
import common  # noqa: E402


@pytest.fixture
def lock_path(tmp_path, monkeypatch):
    p = tmp_path / "ChromeUserData.agent-deck.lock"
    monkeypatch.setattr(common, "browser_lock_path", lambda: str(p))
    common.release_browser_lock()
    yield p
    common.release_browser_lock()


def _holder(lock_path: Path, seconds: float) -> subprocess.Popen:
    code = textwrap.dedent(f"""
        import sys, time
        sys.path.insert(0, {str(AUTOMATION)!r})
        import common
        common.browser_lock_path = lambda: {str(lock_path)!r}
        common.acquire_browser_lock(wait_seconds=0)
        print("LOCKED", flush=True)
        time.sleep({seconds})
    """)
    proc = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
    assert proc.stdout.readline().strip() == "LOCKED"
    return proc


def test_second_skill_gives_up_with_a_clear_message(lock_path, capsys):
    holder = _holder(lock_path, 30)
    try:
        t = [0.0]
        with pytest.raises(common.BrowserBusyError) as e:
            common.acquire_browser_lock(wait_seconds=3, sleep=lambda s: t.__setitem__(0, t[0] + s), clock=lambda: t[0])
        assert "別のタブ" in str(e.value) and "Another tab" in str(e.value)
        assert "待っています" in capsys.readouterr().out  # said it was waiting
    finally:
        holder.kill()
        holder.wait()


def test_waits_then_gets_it_when_the_other_finishes(lock_path):
    holder = _holder(lock_path, 1.5)
    start = time.monotonic()
    common.acquire_browser_lock(wait_seconds=20)
    assert time.monotonic() - start >= 0.5
    holder.wait()


def test_reentrant_and_released_on_close(lock_path):
    common.acquire_browser_lock(wait_seconds=0)
    common.acquire_browser_lock(wait_seconds=0)  # same process: fine

    class Ctx:
        closed = False

        def close(self):
            self.closed = True

    ctx = common._release_on_close(Ctx())
    ctx.close()
    assert ctx.closed and common._browser_lock_fh is None
    # another process can take it now
    holder = _holder(lock_path, 0.1)
    holder.wait()


def test_get_chrome_context_takes_the_lock_before_launching():
    src = (AUTOMATION / "common.py").read_text(encoding="utf-8")
    body = src[src.index("def get_chrome_context("):]
    assert body.index("acquire_browser_lock()") < body.index("launch_persistent_context(")
    assert "return _release_on_close(context), page" in body
