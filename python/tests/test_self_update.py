"""
Tests for self_update.py — agent-ui's own GitHub-Releases-based updater.

Covers the atomic-swap safety pattern reused from agent-deck's
install_agent_ui.py: download/extract into a staging dir first, and only
remove the existing install once the replacement is verified in place.

Run:
  pytest python/tests/test_self_update.py -v
"""

import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))

import self_update as su  # noqa: E402


def _dest_name() -> str:
    return "agent-ui.exe" if sys.platform == "win32" else "agent-ui.app"


def _asset_name() -> str:
    return "agent-ui-win.zip" if sys.platform == "win32" else "agent-ui-mac.zip"


def _fake_release(tag: str, asset_url: str = "https://example.com/asset.zip") -> dict:
    return {
        "tag_name": tag,
        "assets": [{"name": _asset_name(), "browser_download_url": asset_url}],
    }


def _make_fake_zip(zip_path: Path) -> None:
    name = "agent-ui.exe" if sys.platform == "win32" else "agent-ui.app"
    with zipfile.ZipFile(zip_path, "w") as zf:
        if sys.platform == "win32":
            zf.writestr(name, b"fake exe content")
        else:
            zf.writestr(f"{name}/Contents/MacOS/agent-ui", b"#!/bin/sh\necho hi\n")


@pytest.fixture
def project_root(tmp_path, monkeypatch):
    monkeypatch.setattr(su, "PROJECT_ROOT", tmp_path)
    return tmp_path


class TestCheck:
    def test_reports_update_available_when_no_marker(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.1.0"))
        available, installed, latest = su.check()
        assert available is True
        assert installed == ""
        assert latest == "v0.1.0"

    def test_reports_up_to_date_when_marker_matches(self, project_root, monkeypatch):
        (project_root / f"{_dest_name()}.version").write_text("v0.1.0")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.1.0"))
        available, installed, latest = su.check()
        assert available is False
        assert installed == "v0.1.0"


class TestApply:
    def test_skips_download_when_already_up_to_date(self, project_root, monkeypatch):
        (project_root / f"{_dest_name()}.version").write_text("v0.1.0")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.1.0"))

        def fail_if_called(cmd, *a, **kw):
            raise AssertionError("curl should not be invoked when already up to date")

        monkeypatch.setattr(su.subprocess, "run", fail_if_called)
        su.apply()  # must return early, not raise

    def test_applies_update_and_writes_marker(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_fake_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        dest = project_root / _dest_name()
        marker = project_root / f"{_dest_name()}.version"
        assert dest.exists()
        assert marker.read_text().strip() == "v0.2.0"

    def test_curl_has_connect_and_max_time_limits(self, project_root, monkeypatch):
        """Regression test: a stalled network connection (no active refusal,
        just silence) must not hang apply() forever — hit for real via a
        confused agy skill invocation (`/update --test`, an argument the
        GitHub-Releases-based self_update.py has no concept of)."""
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        captured = {}

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                captured["cmd"] = cmd
                _make_fake_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert "--connect-timeout" in captured["cmd"], "curl call has no connect timeout"
        assert "--max-time" in captured["cmd"], "curl call has no overall time limit"

    def test_failed_download_preserves_existing_install(self, project_root, monkeypatch):
        dest = project_root / _dest_name()
        if sys.platform == "win32":
            dest.write_text("old binary")
        else:
            dest.mkdir()
            (dest / "marker.txt").write_text("old install")
        (project_root / f"{_dest_name()}.version").write_text("v0.1.0")

        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            raise subprocess.CalledProcessError(1, cmd)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        with pytest.raises(subprocess.CalledProcessError):
            su.apply()

        assert dest.exists(), (
            "apply() removed the existing install before confirming the "
            "replacement download succeeded."
        )


def _make_rebranded_zip(zip_path: Path, with_python: bool = True) -> None:
    """Fake upstream asset: bundle is agent-ui.* inside the zip regardless
    of what the installed copy is named locally."""
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("agent-ui.app/Contents/MacOS/agent-ui", b"#!/bin/sh\necho hi\n")
        if with_python:
            zf.writestr("python/skills/translator/SKILL.md", b"---\nname: translator\n---\n")
            zf.writestr("python/scripts/setup/build-skills.sh", b"#!/bin/bash\r\necho ok\r\n")


class TestRebrandedInstall:
    """2026-07-16: an organization may ship this layout under its own
    product name (agent-deck.app instead of agent-ui.app) — self_update
    must keep that name, read the rebrander's version marker, and never
    clobber it (see module docstring)."""

    def _setup_rebranded(self, project_root):
        bundle = project_root / "agent-deck.app"
        (bundle / "Contents" / "MacOS").mkdir(parents=True)
        (bundle / "Contents" / "MacOS" / "agent-ui").write_text("old binary")
        (project_root / "app").mkdir()
        (project_root / "app" / "agent-deck.app.version").write_text("v0.0.13+1")
        return bundle

    def test_detects_rebranded_bundle_name(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "darwin")
        self._setup_rebranded(project_root)
        assert su._dest_name() == "agent-deck.app"

    def test_reads_rebrander_marker_with_build_suffix_stripped(self, project_root, monkeypatch):
        """The rebrander's pinned installer writes "<tag>+<build>" to
        app/<name>.version — the "+build" part is its own re-publish
        counter, not part of the upstream tag."""
        monkeypatch.setattr(su.sys, "platform", "darwin")
        self._setup_rebranded(project_root)
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.0.13"))

        available, installed, latest = su.check()

        assert installed == "v0.0.13"
        assert available is False, (
            "a rebranded install at the same upstream tag must not be "
            "reported as needing an update just because of the +build suffix."
        )

    def test_apply_keeps_rebranded_name_and_spares_rebrander_marker(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "darwin")
        self._setup_rebranded(project_root)
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.0.14"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert (project_root / "agent-deck.app").exists(), "rebranded name must be kept"
        assert not (project_root / "agent-ui.app").exists(), (
            "the update must not appear as a SECOND bundle under the "
            "upstream name next to the stale rebranded one."
        )
        assert (project_root / "agent-deck.app.version").read_text().strip() == "v0.0.14", (
            "self_update must write its own root-level marker"
        )
        assert (project_root / "app" / "agent-deck.app.version").read_text().strip() == "v0.0.13+1", (
            "the rebrander's own marker must be left untouched — overwriting "
            "it with a newer tag makes the rebrander's pinned installer "
            "reinstall (downgrade to) its pin on the next launch."
        )


class TestPythonPayloadRefresh:
    """2026-07-16: apply() must also refresh <root>/python/ from the same
    zip — previously only the binary was swapped, silently leaving skills
    and setup scripts at the old version forever."""

    def test_apply_refreshes_python_tree(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "darwin")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert (project_root / "python" / "skills" / "translator" / "SKILL.md").exists()

    def test_apply_preserves_skills_personal(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "darwin")
        personal = project_root / "python" / "skills-personal" / "my-skill"
        personal.mkdir(parents=True)
        (personal / "SKILL.md").write_text("---\nname: my-skill\n---\n")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert (project_root / "python" / "skills-personal" / "my-skill" / "SKILL.md").exists(), (
            "user-created and catalog-synced skills must survive the refresh."
        )

    def test_apply_normalizes_sh_files_to_lf(self, project_root, monkeypatch):
        """agent-ui-win.zip's python/ tree has shipped CRLF before, which
        breaks bash on Mac."""
        monkeypatch.setattr(su.sys, "platform", "darwin")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        sh = project_root / "python" / "scripts" / "setup" / "build-skills.sh"
        assert b"\r" not in sh.read_bytes()
