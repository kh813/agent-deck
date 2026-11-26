"""
Tests for self_update.py — agent-deck's own GitHub-Releases-based updater.

Covers the atomic-swap safety pattern: download/extract into a staging dir
first, and only remove the existing install once the replacement is
verified in place.

Run:
  pytest python/tests/test_self_update.py -v
"""

import json
import subprocess
import os
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))

import self_update as su  # noqa: E402


def _dest_name() -> str:
    return "agent-deck.exe" if sys.platform == "win32" else "agent-deck.app"


def _asset_name() -> str:
    return "agent-deck-win.zip" if sys.platform == "win32" else "agent-deck-mac.zip"


def _fake_release(tag: str, asset_url: str = "https://example.com/asset.zip") -> dict:
    return {
        "tag_name": tag,
        "assets": [{"name": _asset_name(), "browser_download_url": asset_url}],
    }


class _FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._body


def _fake_urlopen(payload):
    return _FakeResponse(payload)


def _make_fake_zip(zip_path: Path) -> None:
    name = "agent-deck.exe" if sys.platform == "win32" else "agent-deck.app"
    with zipfile.ZipFile(zip_path, "w") as zf:
        if sys.platform == "win32":
            zf.writestr(name, b"fake exe content")
        else:
            zf.writestr(f"{name}/Contents/MacOS/agent-deck", b"#!/bin/sh\necho hi\n")


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


class TestChannel:
    """--test walks the plain /releases list for the newest pre-release,
    entirely separate from the prod path's /releases/latest (which GitHub
    itself excludes pre-releases from)."""

    def test_check_test_channel_uses_prerelease_fetch_not_latest(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.1.0"))
        monkeypatch.setattr(su, "_fetch_latest_prerelease", lambda: _fake_release("v0.2.0-rc1"))
        available, installed, latest = su.check("test")
        assert available is True
        assert latest == "v0.2.0-rc1"

    def test_fetch_latest_prerelease_skips_non_prerelease_entries(self, monkeypatch):
        releases = [
            {**_fake_release("v0.2.0"), "prerelease": False},
            {**_fake_release("v0.2.0-rc2"), "prerelease": True},
            {**_fake_release("v0.2.0-rc1"), "prerelease": True},
        ]
        monkeypatch.setattr(su.urllib.request, "urlopen", lambda *a, **k: _fake_urlopen(releases))
        result = su._fetch_latest_prerelease()
        assert result["tag_name"] == "v0.2.0-rc2"  # first (newest) prerelease in the list

    def test_fetch_latest_prerelease_raises_when_none_found(self, monkeypatch):
        releases = [{**_fake_release("v0.2.0"), "prerelease": False}]
        monkeypatch.setattr(su.urllib.request, "urlopen", lambda *a, **k: _fake_urlopen(releases))
        with pytest.raises(RuntimeError):
            su._fetch_latest_prerelease()


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

    def test_aborts_when_signature_verification_fails(self, project_root, monkeypatch):
        """Confirmed for real (2026-07-23): an invalid signature after the
        defensive re-sign means macOS refuses to even launch the app ("is
        damaged", error -47, no user override) -- apply() must not swap
        this in over a working install."""
        if sys.platform == "win32":
            pytest.skip("codesign verification only applies on macOS")

        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_fake_zip(Path(cmd[-1]))
                return subprocess.CompletedProcess(cmd, 0)
            if cmd[0] == "codesign" and cmd[1] == "--verify":
                return subprocess.CompletedProcess(cmd, 1, stderr=b"invalid signature")
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        with pytest.raises(RuntimeError, match="signature verification failed"):
            su.apply()

        assert not (project_root / _dest_name()).exists(), (
            "a failed signature check must abort before the atomic swap, "
            "leaving the (nonexistent, in this test) prior install alone"
        )

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


class TestWindowsLockedExeSwap:
    """Regression test (2026-07-16): apply() used to delete-then-create at
    the same path when swapping in the new exe. On Windows this is exactly
    the pattern already confirmed broken for the separate migration
    update.py: deleting a currently-running exe succeeds (the OS loader
    opens it with FILE_SHARE_DELETE), but creating a new file at that same
    path right after fails until the last handle closes -- i.e. until the
    user restarts. Since apply() runs from inside an agy session spawned by
    the very exe being replaced, this would have silently broken the
    standard /update skill on every real Windows machine. Fix: rename the
    old exe aside first (Windows permits renaming a running exe) instead of
    deleting it, freeing the original path without needing the old handle
    to close."""

    def test_apply_renames_locked_exe_instead_of_deleting_it(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "win32")
        dest = project_root / "agent-deck.exe"
        dest.write_text("old binary")
        (project_root / f"{dest.name}.version").write_text("v0.1.0")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        real_unlink = Path.unlink

        def guarded_unlink(self_path, *a, **kw):
            if self_path == dest:
                raise PermissionError(
                    "The process cannot access the file because it is "
                    "being used by another process"
                )
            return real_unlink(self_path, *a, **kw)

        monkeypatch.setattr(Path, "unlink", guarded_unlink)

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_fake_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()  # must not raise despite dest being "locked"

        assert dest.read_text() == "fake exe content", "new exe must land at the original path"
        assert (project_root / "agent-deck.exe.old").exists(), (
            "old exe should be renamed aside, not deleted in place"
        )

    def test_apply_cleans_up_stale_old_file_from_a_prior_update(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "win32")
        dest = project_root / "agent-deck.exe"
        dest.write_text("old binary")
        (dest.with_name("agent-deck.exe.old")).write_text("stale from a prior update")
        (project_root / f"{dest.name}.version").write_text("v0.1.0")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_fake_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert dest.read_text() == "fake exe content"
        assert (dest.with_name("agent-deck.exe.old")).read_text() == "old binary", (
            "the stale .old from a prior update must be cleared before "
            "this update's own old exe is renamed into that slot."
        )


def _make_org_rebranded_zip(zip_path: Path, with_python: bool = True) -> None:
    """Fake upstream asset: the bundle inside the release zip is always
    agent-deck.* (the project's own canonical name since the 2026-07-16
    agent-ui -> agent-deck rename), regardless of what an organization's
    OWN install is locally named."""
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("agent-deck.app/Contents/MacOS/agent-deck", b"#!/bin/sh\necho hi\n")
        if with_python:
            zf.writestr("python/skills/translator/SKILL.md", b"---\nname: translator\n---\n")
            zf.writestr("python/scripts/setup/build-skills.sh", b"#!/bin/bash\r\necho ok\r\n")


class TestOrgRebrandedInstall:
    """An organization may ship this whole layout under its own product
    name (e.g. acme-console.app instead of agent-deck.app) — self_update
    must keep that name, read the rebrander's version marker, and never
    clobber it (see module docstring)."""

    def _setup_rebranded(self, project_root):
        bundle = project_root / "acme-console.app"
        (bundle / "Contents" / "MacOS").mkdir(parents=True)
        (bundle / "Contents" / "MacOS" / "agent-deck").write_text("old binary")
        (project_root / "app").mkdir()
        (project_root / "app" / "acme-console.app.version").write_text("v0.0.13+1")
        return bundle

    def test_detects_rebranded_bundle_name(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "darwin")
        self._setup_rebranded(project_root)
        assert su._dest_name() == "acme-console.app"

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
                _make_org_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert (project_root / "acme-console.app").exists(), "rebranded name must be kept"
        assert not (project_root / "agent-deck.app").exists(), (
            "the update must not appear as a SECOND bundle under the "
            "upstream name next to the stale rebranded one."
        )
        assert (project_root / "acme-console.app.version").read_text().strip() == "v0.0.14", (
            "self_update must write its own root-level marker"
        )
        assert (project_root / "app" / "acme-console.app.version").read_text().strip() == "v0.0.13+1", (
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
                _make_org_rebranded_zip(Path(cmd[-1]))
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
                _make_org_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert (project_root / "python" / "skills-personal" / "my-skill" / "SKILL.md").exists(), (
            "user-created and catalog-synced skills must survive the refresh."
        )

    def test_apply_preserves_automation_user_data(self, project_root, monkeypatch):
        """Confirmed for real (2026-11-25): every update wiped the saved
        Chrome login (ask-portal etc.), scheduled-task sidecars and logs."""
        monkeypatch.setattr(su.sys, "platform", "darwin")
        auto = project_root / "python" / "scripts" / "automation"
        for sub, name in (("ChromeUserData/Default", "Cookies"),
                          ("scheduled", "morning.json"),
                          ("logs", "run.log")):
            (auto / sub).mkdir(parents=True, exist_ok=True)
            (auto / sub / name).write_text("keep")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_org_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert (auto / "ChromeUserData" / "Default" / "Cookies").read_text() == "keep"
        assert (auto / "scheduled" / "morning.json").read_text() == "keep"
        assert (auto / "logs" / "run.log").read_text() == "keep"
        # the rest of python/ was still refreshed from the zip
        assert (project_root / "python" / "skills" / "translator" / "SKILL.md").exists()

    def test_preserved_paths_are_all_gitignored(self):
        ignore = (Path(__file__).resolve().parents[2] / ".gitignore").read_text()
        for keep in su._PRESERVED_PYTHON_DIRS:
            assert f"python/{keep}" in ignore, f"{keep} must never ship in a release"

    def test_apply_preserves_skills_catalog(self, project_root, monkeypatch):
        """Catalog-installed skills (incl. manual downloads, which `sync`
        can't restore) live in skills-catalog/ and must survive too."""
        monkeypatch.setattr(su.sys, "platform", "darwin")
        catalog = project_root / "python" / "skills-catalog" / "org-skill"
        (catalog / "scripts").mkdir(parents=True)
        (catalog / "SKILL.md").write_text("---\nname: org-skill\n---\n")
        (catalog / "scripts" / "run.py").write_text("x\n")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_org_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        assert (catalog / "SKILL.md").exists()
        assert (catalog / "scripts" / "run.py").exists()

    def test_apply_normalizes_sh_files_to_lf(self, project_root, monkeypatch):
        """The Windows release zip's python/ tree has shipped CRLF before,
        which breaks bash on Mac."""
        monkeypatch.setattr(su.sys, "platform", "darwin")
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "curl":
                _make_org_rebranded_zip(Path(cmd[-1]))
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply()

        sh = project_root / "python" / "scripts" / "setup" / "build-skills.sh"
        assert b"\r" not in sh.read_bytes()


class _FakeDriveExecute:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return self._result


class _FakeDriveFiles:
    def __init__(self, modified_time):
        self._modified_time = modified_time

    def get(self, fileId, fields, supportsAllDrives):
        return _FakeDriveExecute({"modifiedTime": self._modified_time})

    def get_media(self, fileId, supportsAllDrives):
        return object()  # never touched -- _download_drive_media is mocked in these tests


class _FakeDriveService:
    def __init__(self, modified_time):
        self._files = _FakeDriveFiles(modified_time)

    def files(self):
        return self._files


class TestDriveChannel:
    """The org's config-bundled Drive channel (package_release.py's own
    upload target) -- a third source entirely, separate from both GitHub
    channels above. Uses the Drive file's modifiedTime as its "version"
    since there's no release tag for a single mutable file."""

    def test_check_drive_reports_available_when_no_marker(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_get_drive_service", lambda **kw: _FakeDriveService("2026-07-23T00:00:00Z"))
        available, installed, latest = su.check_drive("file-123")
        assert available is True
        assert installed == ""
        assert latest == "2026-07-23T00:00:00Z"

    def test_check_drive_reports_up_to_date_when_marker_matches(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_get_drive_service", lambda **kw: _FakeDriveService("2026-07-23T00:00:00Z"))
        su._drive_marker_path(_dest_name()).write_text(
            '{"file_id": "file-123", "modifiedTime": "2026-07-23T00:00:00Z"}'
        )
        available, installed, latest = su.check_drive("file-123")
        assert available is False

    def test_check_drive_ignores_marker_from_a_different_file_id(self, project_root, monkeypatch):
        """Switching from org-test to org-prod (different Drive file IDs)
        must not be mistaken for "already up to date" just because some
        other file's marker happens to be sitting there."""
        monkeypatch.setattr(su, "_get_drive_service", lambda **kw: _FakeDriveService("2026-07-23T00:00:00Z"))
        su._drive_marker_path(_dest_name()).write_text(
            '{"file_id": "other-file-id", "modifiedTime": "2026-07-23T00:00:00Z"}'
        )
        available, installed, latest = su.check_drive("file-123")
        assert available is True
        assert installed == ""

    def test_apply_drive_installs_and_merges_config_toml(self, project_root, monkeypatch):
        monkeypatch.setattr(su.sys, "platform", "darwin")
        monkeypatch.setattr(su, "_get_drive_service", lambda **kw: _FakeDriveService("2026-07-23T00:00:00Z"))

        def fake_download(service, file_id, dest_path):
            zf_path = _make_fake_zip_for_drive(dest_path)
            return zf_path

        monkeypatch.setattr(su, "_download_drive_media", fake_download)

        def fake_run(cmd, *a, **kw):
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(su.subprocess, "run", fake_run)

        su.apply_drive("file-123")

        dest = project_root / _dest_name()
        assert dest.exists()
        assert (project_root / "config.toml").read_text() == "[oauth]\nclient_id = \"org-real-id\"\n"
        marker = json.loads(su._drive_marker_path(_dest_name()).read_text())
        assert marker == {"file_id": "file-123", "modifiedTime": "2026-07-23T00:00:00Z"}


def _make_fake_zip_for_drive(zip_path: Path) -> None:
    """Matches package_release.py's own flat layout: agent-deck.app/.exe,
    python/, and config.toml all as zip-root siblings."""
    name = _dest_name()
    with zipfile.ZipFile(zip_path, "w") as zf:
        if sys.platform == "win32":
            zf.writestr(name, b"fake exe content")
        else:
            zf.writestr(f"{name}/Contents/MacOS/agent-deck", b"#!/bin/sh\necho hi\n")
        zf.writestr("python/skills/translator/SKILL.md", b"---\nname: translator\n---\n")
        zf.writestr("config.toml", b'[oauth]\nclient_id = "org-real-id"\n')


# ── Regression (2026-11-24): PROJECT_ROOT pointed at <root>/python ─────────
#
# Every other test monkeypatches PROJECT_ROOT, so for months nothing noticed
# that the real value was parents[2] (= <root>/python): the org Drive update
# failed with "venv not found" (looked for <root>/python/venv) and could not
# import config, and the GitHub path would have swapped the app into
# <root>/python/. Confirmed for real updating a v0.1.2-rc6 install.

def test_project_root_is_the_install_root():
    assert su.PROJECT_ROOT == ROOT
    assert (su.PROJECT_ROOT / "python" / "scripts" / "setup" / "self_update.py").exists()
    assert (su.PROJECT_ROOT / "agent_config.json").exists()


def test_drive_mode_reexec_uses_root_venv(monkeypatch, tmp_path):
    """Without google libs, --drive-file-id must re-exec under <root>/venv."""
    monkeypatch.setattr(su, "PROJECT_ROOT", tmp_path)
    venv_python = tmp_path / "venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python3")
    venv_python.parent.mkdir(parents=True)
    venv_python.write_text("")
    monkeypatch.setattr(su.sys, "argv", ["self_update.py", "check", "--drive-file-id", "x"])
    import builtins
    real_import = builtins.__import__

    def no_google(name, *a, **k):
        if name.startswith("googleapiclient"):
            raise ImportError(name)
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_google)
    calls = []
    monkeypatch.setattr(su.os, "execv", lambda exe, argv: calls.append(exe))
    monkeypatch.setattr(su.subprocess, "run", lambda argv, *a, **k: calls.append(argv[0]) or subprocess.CompletedProcess(argv, 0))
    try:
        su._reexec_with_venv_for_drive_mode()
    except SystemExit:
        pass
    assert calls and str(calls[0]) == str(venv_python)


def test_restart_notice_is_red_bold_in_a_terminal(monkeypatch, capsys):
    monkeypatch.setattr(sys.stdout, "isatty", lambda: True, raising=False)
    monkeypatch.setenv("TERM", "xterm-256color")
    su._print_restart_notice()
    out = capsys.readouterr().out
    assert "\033[1;31m" in out and "agent-deck" in out


def test_restart_notice_is_plain_when_not_a_terminal(monkeypatch, capsys):
    monkeypatch.setattr(sys.stdout, "isatty", lambda: False, raising=False)
    su._print_restart_notice()
    out = capsys.readouterr().out
    assert "\033[" not in out and "Close agent-deck" in out


# ── background check (the app's periodic update check) ───────────────
#
# Must never open a browser login out of nowhere, and must never fail
# loudly: offline / no auth / bad response -> quiet exit 3 + JSON.

def _install_fake_google(monkeypatch, creds):
    import types
    mods = {}
    cred_mod = types.ModuleType("google.oauth2.credentials")
    cred_mod.Credentials = types.SimpleNamespace(from_authorized_user_file=lambda *a, **k: creds)
    flow_mod = types.ModuleType("google_auth_oauthlib.flow")

    class _Flow:
        @staticmethod
        def from_client_config(*a, **k):
            raise AssertionError("interactive login flow must not start in background mode")
    flow_mod.InstalledAppFlow = _Flow
    req_mod = types.ModuleType("google.auth.transport.requests")
    req_mod.Request = lambda: None
    disc_mod = types.ModuleType("googleapiclient.discovery")
    disc_mod.build = lambda *a, **k: "SERVICE"
    cfg = types.ModuleType("config")
    cfg.OAUTH_CLIENT_ID = cfg.OAUTH_CLIENT_SECRET = "x"
    cfg.USER_EMAIL = ""
    auth = types.ModuleType("scripts.auth")
    auth.run_auth_flow = lambda *a, **k: (_ for _ in ()).throw(AssertionError("no login in background"))
    for name, mod in {
        "google": types.ModuleType("google"), "google.oauth2": types.ModuleType("google.oauth2"),
        "google.oauth2.credentials": cred_mod, "google_auth_oauthlib": types.ModuleType("google_auth_oauthlib"),
        "google_auth_oauthlib.flow": flow_mod, "google.auth": types.ModuleType("google.auth"),
        "google.auth.transport": types.ModuleType("google.auth.transport"),
        "google.auth.transport.requests": req_mod, "googleapiclient": types.ModuleType("googleapiclient"),
        "googleapiclient.discovery": disc_mod, "config": cfg,
        "scripts": types.ModuleType("scripts"), "scripts.auth": auth,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)


class TestBackgroundCheck:
    def test_no_saved_token_raises_auth_required_without_login(self, monkeypatch, tmp_path):
        monkeypatch.setattr(su.Path, "home", classmethod(lambda cls: tmp_path))
        _install_fake_google(monkeypatch, creds=None)
        with pytest.raises(su.AuthRequired):
            su._get_drive_service(interactive=False)

    def test_failed_refresh_raises_auth_required(self, monkeypatch, tmp_path):
        import types
        (tmp_path / ".gemini").mkdir()
        (tmp_path / ".gemini" / "agent_ui_library_token.json").write_text("{}")
        monkeypatch.setattr(su.Path, "home", classmethod(lambda cls: tmp_path))

        def boom(_req):
            raise RuntimeError("invalid_grant")
        creds = types.SimpleNamespace(valid=False, expired=True, refresh_token="r", refresh=boom)
        _install_fake_google(monkeypatch, creds=creds)
        with pytest.raises(su.AuthRequired):
            su._get_drive_service(interactive=False)

    def test_valid_saved_token_works_in_background(self, monkeypatch, tmp_path):
        import types
        (tmp_path / ".gemini").mkdir()
        (tmp_path / ".gemini" / "agent_ui_library_token.json").write_text("{}")
        monkeypatch.setattr(su.Path, "home", classmethod(lambda cls: tmp_path))
        creds = types.SimpleNamespace(valid=True, to_json=lambda: "{}")
        _install_fake_google(monkeypatch, creds=creds)
        assert su._get_drive_service(interactive=False) == "SERVICE"

    def test_check_drive_passes_interactive_flag(self, project_root, monkeypatch):
        seen = {}

        def fake(interactive=True):
            seen["interactive"] = interactive
            return _FakeDriveService("2026-07-23T00:00:00Z")
        monkeypatch.setattr(su, "_get_drive_service", fake)
        su.check_drive("file-123", interactive=False)
        assert seen == {"interactive": False}


def _background_cli(tmp_path, body: str):
    """Run the real CLI entry point with check()/check_drive() replaced, by
    copying self_update.py into a scratch tree and appending overrides
    right before its __main__ block."""
    setup = tmp_path / "python" / "scripts" / "setup"
    setup.mkdir(parents=True)
    src = (ROOT / "python" / "scripts" / "setup" / "self_update.py").read_text(encoding="utf-8")
    marker = 'if __name__ == "__main__":'
    i = src.rindex(marker)
    src = src[:i] + body + "\n\n" + src[i:]
    (setup / "self_update.py").write_text(src, encoding="utf-8")
    return setup / "self_update.py"


class TestBackgroundCli:
    def test_offline_is_quiet_exit_3_with_json(self, tmp_path):
        script = _background_cli(tmp_path, "def check(channel='prod', current=''):\n    raise OSError('offline')\n")
        r = subprocess.run([sys.executable, "-I", str(script), "check", "--json", "--background"],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert r.returncode == 3
        assert "Traceback" not in r.stderr
        assert json.loads(r.stdout.strip().splitlines()[-1]) == {"update_available": False, "error": "OSError"}

    def test_auth_required_is_quiet_exit_3(self, tmp_path):
        script = _background_cli(tmp_path, textwrap_dedent('''
            def _reexec_with_venv_for_drive_mode():
                pass
            def check_drive(file_id, interactive=True, current=''):
                assert interactive is False
                raise AuthRequired("no saved Drive authorization")
        '''))
        r = subprocess.run([sys.executable, "-I", str(script), "check", "--json", "--background", "--drive-file-id", "F"],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert r.returncode == 3
        assert json.loads(r.stdout.strip().splitlines()[-1])["error"] == "AuthRequired"

    def test_update_available_is_reported(self, tmp_path):
        script = _background_cli(tmp_path, "def check(channel='prod', current=''):\n    return (True, 'v0.2.6', 'v0.2.7')\n")
        r = subprocess.run([sys.executable, "-I", str(script), "check", "--json", "--background"],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert r.returncode == 0, r.stderr
        assert json.loads(r.stdout.strip().splitlines()[-1]) == {
            "update_available": True, "installed_tag": "v0.2.6", "latest_tag": "v0.2.7", "channel": "prod"}

    def test_background_never_applies(self, tmp_path):
        script = _background_cli(tmp_path, textwrap_dedent('''
            def check(channel='prod', current=''):
                return (True, 'v0.2.6', 'v0.2.7')
            def apply(channel='prod', current=''):
                raise SystemExit(99)
        '''))
        r = subprocess.run([sys.executable, "-I", str(script), "check", "--json", "--background"],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert r.returncode == 0


def textwrap_dedent(s):
    import textwrap
    return textwrap.dedent(s).strip("\n")


class TestBackgroundChannel:
    def test_background_test_flag_checks_the_test_channel(self, tmp_path):
        script = _background_cli(tmp_path, textwrap_dedent('''
            def check(channel='prod', current=''):
                return (True, 'v0.2.8-rc1', 'v0.2.8-rc2' if channel == 'test' else 'v0.2.7')
        '''))
        r = subprocess.run([sys.executable, "-I", str(script), "check", "--json", "--background", "--test"],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert r.returncode == 0, r.stderr
        out = json.loads(r.stdout.strip().splitlines()[-1])
        assert out["channel"] == "test" and out["latest_tag"] == "v0.2.8-rc2"

    def test_background_without_test_flag_checks_stable(self, tmp_path):
        script = _background_cli(tmp_path, textwrap_dedent('''
            def check(channel='prod', current=''):
                return (True, 'v0.2.6', 'v0.2.8-rc2' if channel == 'test' else 'v0.2.7')
        '''))
        r = subprocess.run([sys.executable, "-I", str(script), "check", "--json", "--background"],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        assert out["channel"] == "prod" and out["latest_tag"] == "v0.2.7"


# ── Version ordering: never offer/apply an older build (2026-11-25: a
# 0.2.8-rc install "updated" to 0.2.7 because "different" counted as "newer").

class TestVersionOrdering:
    @pytest.mark.parametrize("newer,older", [
        ("v0.2.8", "v0.2.7"),
        ("v0.2.8", "0.2.8-rc4"),        # release > its own prerelease
        ("v0.2.8-rc4", "v0.2.8-rc3"),
        ("v0.2.8-rc10", "v0.2.8-rc9"),  # numeric, not lexical
        ("v0.2.8-rc1", "v0.2.7"),
        ("v0.10.0", "v0.9.9"),
        ("v1.0.0", "v0.99.99"),
    ])
    def test_is_newer(self, newer, older):
        assert su.is_newer(newer, older)
        assert not su.is_newer(older, newer)

    def test_same_version_is_not_newer(self):
        assert not su.is_newer("v0.2.8-rc4", "0.2.8-rc4")  # v prefix doesn't matter
        assert not su.is_newer("v0.2.7", "v0.2.7+rebrand.1")

    def test_unparseable_falls_back_to_inequality(self):
        assert su.is_newer("2026-11-25T00:00:00Z", "2026-11-24T00:00:00Z")
        assert not su.is_newer("x", "x")
        assert not su.is_newer("", "v0.2.7")

    def test_stable_check_from_a_newer_rc_offers_nothing(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.7"))
        available, installed, latest = su.check("prod", current="0.2.8-rc4")
        assert (available, installed, latest) == (False, "0.2.8-rc4", "v0.2.7")

    def test_stable_release_after_rc_is_offered(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.8"))
        assert su.check("prod", current="0.2.8-rc4")[0] is True

    def test_apply_refuses_a_downgrade(self, project_root, monkeypatch, capsys):
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.7"))
        monkeypatch.setattr(su, "_download", lambda *a, **k: pytest.fail("must not download"), raising=False)
        monkeypatch.setattr(su, "_atomic_swap", lambda *a, **k: pytest.fail("must not swap"))
        su.apply("prod", current="0.2.8-rc4")
        out = capsys.readouterr().out
        assert "not downgrading" in out and "0.2.8-rc4" in out

    def test_apply_same_version_is_up_to_date(self, project_root, monkeypatch, capsys):
        monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.7"))
        monkeypatch.setattr(su, "_atomic_swap", lambda *a, **k: pytest.fail("must not swap"))
        su.apply("prod", current="0.2.7")
        assert "Already up to date" in capsys.readouterr().out


class _VersionedDriveFiles:
    def __init__(self, modified, version):
        self.meta = {"modifiedTime": modified}
        if version:
            self.meta["appProperties"] = {su.DRIVE_VERSION_PROPERTY: version}
        self.downloaded = False

    def get(self, **kw):
        meta = self.meta

        class _Req:
            def execute(self_inner):
                return meta
        return _Req()

    def get_media(self, **kw):
        self.downloaded = True
        raise AssertionError("must not download")


class _VersionedDrive:
    def __init__(self, modified, version):
        self._f = _VersionedDriveFiles(modified, version)

    def files(self):
        return self._f


class TestDriveVersions:
    def test_check_drive_compares_versions_when_recorded(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_get_drive_service", lambda **kw: _VersionedDrive("2026-11-25T00:00:00Z", "v0.2.7"))
        assert su.check_drive("F", current="0.2.8-rc4") == (False, "0.2.8-rc4", "v0.2.7")
        assert su.check_drive("F", current="0.2.6")[0] is True

    def test_check_drive_without_recorded_version_keeps_timestamp_rule(self, project_root, monkeypatch):
        monkeypatch.setattr(su, "_get_drive_service", lambda **kw: _VersionedDrive("2026-11-25T00:00:00Z", ""))
        available, _, latest = su.check_drive("F", current="0.2.8-rc4")
        assert available is True and latest == "2026-11-25T00:00:00Z"

    def test_apply_drive_refuses_a_downgrade(self, project_root, monkeypatch, capsys):
        drive = _VersionedDrive("2026-11-25T00:00:00Z", "v0.2.7")
        monkeypatch.setattr(su, "_get_drive_service", lambda **kw: drive)
        su.apply_drive("F", current="0.2.8-rc4")
        assert not drive._f.downloaded
        assert "not downgrading" in capsys.readouterr().out

    def test_cli_passes_current_version(self, tmp_path):
        script = _background_cli(tmp_path, textwrap_dedent('''
            def _fetch_latest_release():
                return {"tag_name": "v0.2.7", "assets": []}
        '''))
        r = subprocess.run([sys.executable, "-I", str(script), "check", "--json", "--background",
                            "--current-version", "0.2.8-rc4"],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        assert out["update_available"] is False and out["installed_tag"] == "0.2.8-rc4"


class TestPythonPayloadInPlace:
    """2026-11-26, confirmed on Windows: an update swapped the exe, then
    failed to refresh python/ (a preserved folder with an open file couldn't
    be moved), leaving the new app over v0.2.7 scripts -- the skill screen
    showed "失敗しました: an organization distributes its own skills ...".
    python/ is now refreshed in place and BEFORE the app swap."""

    def _staging(self, tmp_path, files):
        st = tmp_path / "staging"
        for rel, text in files.items():
            p = st / "python" / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        return st

    def test_overwrites_adds_removes_and_keeps_user_data(self, project_root, tmp_path):
        py = project_root / "python"
        for rel, text in {
            "scripts/setup/skills_catalog.py": "old",
            "scripts/setup/removed_upstream.py": "stale",
            "skills/gone-skill/SKILL.md": "stale",
            "skills-personal/mine/SKILL.md": "keep",
            "skills-catalog/org/SKILL.md": "keep",
            "scripts/automation/ChromeUserData/Default/Cookies": "keep",
            "scripts/automation/logs/run.log": "keep",
        }.items():
            (py / rel).parent.mkdir(parents=True, exist_ok=True)
            (py / rel).write_text(text, encoding="utf-8")
        st = self._staging(tmp_path, {
            "scripts/setup/skills_catalog.py": "new",
            "scripts/setup/added.py": "new",
            "skills/translator/SKILL.md": "new",
        })
        su._install_python_payload(st)
        r = lambda rel: (py / rel).read_text(encoding="utf-8")
        assert r("scripts/setup/skills_catalog.py") == "new"
        assert r("scripts/setup/added.py") == "new"
        assert r("skills/translator/SKILL.md") == "new"
        assert not (py / "scripts/setup/removed_upstream.py").exists()
        assert not (py / "skills/gone-skill").exists(), "emptied folders go too"
        for rel in ("skills-personal/mine/SKILL.md", "skills-catalog/org/SKILL.md",
                    "scripts/automation/ChromeUserData/Default/Cookies", "scripts/automation/logs/run.log"):
            assert r(rel) == "keep", rel

    def test_never_moves_or_opens_preserved_folders(self, project_root, tmp_path, monkeypatch):
        """The Windows failure: moving a folder with an open file inside."""
        py = project_root / "python"
        (py / "scripts/automation/ChromeUserData").mkdir(parents=True)
        (py / "scripts/automation/ChromeUserData/Lock").write_text("in use")
        st = self._staging(tmp_path, {"scripts/setup/x.py": "new"})
        real_move, real_rmtree = su.shutil.move, su.shutil.rmtree

        def guard(path, *a, **k):
            assert "ChromeUserData" not in str(path), f"touched {path}"
        monkeypatch.setattr(su.shutil, "move", lambda s, d, *a, **k: (guard(s), real_move(s, d))[1])
        monkeypatch.setattr(su.shutil, "rmtree", lambda p, *a, **k: (guard(p), real_rmtree(p, *a, **k))[1])
        su._install_python_payload(st)
        assert (py / "scripts/automation/ChromeUserData/Lock").read_text() == "in use"

    def test_a_file_that_cant_be_written_raises_with_a_hint(self, project_root, tmp_path, monkeypatch):
        st = self._staging(tmp_path, {"scripts/setup/a.py": "new", "scripts/setup/locked.py": "new"})
        real_copy = su.shutil.copy2

        def copy(src, dst, *a, **k):
            if str(dst).endswith("locked.py"):
                raise PermissionError(13, "Access is denied")
            return real_copy(src, dst, *a, **k)
        monkeypatch.setattr(su.shutil, "copy2", copy)
        with pytest.raises(RuntimeError) as e:
            su._install_python_payload(st)
        assert "locked.py" in str(e.value) and "Chrome" in str(e.value)

    @pytest.mark.parametrize("channel", ["github", "drive"])
    def test_python_failure_leaves_the_app_unswapped(self, project_root, monkeypatch, channel):
        """Consistent install on failure: the old app with the old python/."""
        monkeypatch.setattr(su.sys, "platform", "darwin")
        monkeypatch.setattr(su, "_verify_mac_signature", lambda *a, **k: None)
        app = project_root / "agent-deck.app" / "Contents" / "MacOS"
        app.mkdir(parents=True)
        (app / "agent-deck").write_text("OLD APP")

        def boom(staging):
            raise RuntimeError("python/ busy")
        monkeypatch.setattr(su, "_install_python_payload", boom)
        if channel == "github":
            monkeypatch.setattr(su, "_fetch_latest_release", lambda: _fake_release("v0.2.0"))
            monkeypatch.setattr(su.subprocess, "run", lambda cmd, *a, **kw: (
                _make_org_rebranded_zip(Path(cmd[-1])) if cmd[0] == "curl" else None,
                subprocess.CompletedProcess(cmd, 0))[1])
            with pytest.raises(RuntimeError, match="busy"):
                su.apply()
        else:
            monkeypatch.setattr(su, "_get_drive_service", lambda **kw: _FakeDriveService("2026-11-26T00:00:00Z"))
            monkeypatch.setattr(su, "_download_drive_media", lambda svc, fid, path: _make_org_rebranded_zip(path))
            with pytest.raises(RuntimeError, match="busy"):
                su.apply_drive("file-1")
        assert (app / "agent-deck").read_text() == "OLD APP"

    def test_order_in_source(self):
        src = (Path(su.__file__)).read_text(encoding="utf-8")
        for fn in ("def apply(", "def apply_drive("):
            body = src[src.index(fn):]
            body = body[:body.index("\ndef ", 1)]
            assert body.index("_install_python_payload(staging)") < body.index("_atomic_swap(new_dest, dest)"), fn


class TestNewestPrerelease:
    """2026-11-26, confirmed: GitHub listed v0.2.8-rc9 above v0.2.8-rc10."""

    def _r(self, tag, pre=True, published="2026-11-26T00:00:00Z", draft=False):
        return {"tag_name": tag, "prerelease": pre, "published_at": published, "draft": draft}

    def test_rc10_beats_rc9_whatever_the_list_order(self):
        real_order = [self._r("v0.2.8-rc9"), self._r("v0.2.8-rc8"), self._r("v0.2.8-rc10"), self._r("v0.2.8-rc6")]
        assert su._newest_prerelease(real_order)["tag_name"] == "v0.2.8-rc10"
        assert su._newest_prerelease(list(reversed(real_order)))["tag_name"] == "v0.2.8-rc10"

    def test_next_version_beats_rc_of_previous(self):
        rs = [self._r("v0.2.8-rc10"), self._r("v0.3.0-rc1"), self._r("v0.2.9-rc2")]
        assert su._newest_prerelease(rs)["tag_name"] == "v0.3.0-rc1"

    def test_stable_and_drafts_ignored(self):
        rs = [self._r("v0.2.8", pre=False), self._r("v0.2.9-rc1", draft=True), self._r("v0.2.8-rc3")]
        assert su._newest_prerelease(rs)["tag_name"] == "v0.2.8-rc3"

    def test_unparseable_tags_lose_to_versions_and_tie_on_time(self):
        rs = [self._r("nightly", published="2026-12-01T00:00:00Z"), self._r("v0.1.0-rc1", published="2026-01-01T00:00:00Z")]
        assert su._newest_prerelease(rs)["tag_name"] == "v0.1.0-rc1"
        rs = [self._r("a-test", published="2026-01-01T00:00:00Z"), self._r("b-test", published="2026-02-01T00:00:00Z")]
        assert su._newest_prerelease(rs)["tag_name"] == "b-test"

    def test_none(self):
        with pytest.raises(RuntimeError):
            su._newest_prerelease([self._r("v1.0.0", pre=False)])

    def test_fetch_uses_it_and_asks_for_a_full_page(self, monkeypatch):
        seen = {}

        def fake(req, *a, **k):
            seen["url"] = req.full_url
            return _fake_urlopen([self._r("v0.2.8-rc9"), self._r("v0.2.8-rc10")])
        monkeypatch.setattr(su.urllib.request, "urlopen", fake)
        assert su._fetch_latest_prerelease()["tag_name"] == "v0.2.8-rc10"
        assert seen["url"].endswith("?per_page=100")

    def test_package_release_resolves_through_it(self):
        src = (Path(__file__).resolve().parents[1] / "scripts" / "tools" / "package_release.py").read_text(encoding="utf-8")
        assert "su._fetch_release(channel)" in src


class TestRealFileLocks:
    """The same update with files ACTUALLY held open (no simulated errors).
    The Windows CI is the one that matters: there, an open file makes its
    folder immovable and itself undeletable -- the real cause of the
    half-finished update (2026-11-26). On macOS these just pass."""

    def _install(self, project_root, tmp_path):
        py = project_root / "python"
        files = {
            "scripts/setup/skills_catalog.py": "old",
            "scripts/setup/stale_in_use.py": "stale",
            "scripts/automation/ChromeUserData/Default/Cookies": "keep",
            "scripts/automation/logs/run.log": "keep",
            "skills-personal/mine/SKILL.md": "keep",
        }
        for rel, text in files.items():
            (py / rel).parent.mkdir(parents=True, exist_ok=True)
            (py / rel).write_text(text, encoding="utf-8")
        st = tmp_path / "staging"
        for rel in ("scripts/setup/skills_catalog.py", "skills/translator/SKILL.md"):
            (st / "python" / rel).parent.mkdir(parents=True, exist_ok=True)
            (st / "python" / rel).write_text("new", encoding="utf-8")
        return py, st

    def test_update_succeeds_while_chrome_profile_and_log_are_open(self, project_root, tmp_path):
        py, st = self._install(project_root, tmp_path)
        cookies = open(py / "scripts/automation/ChromeUserData/Default/Cookies", "rb")
        log = open(py / "scripts/automation/logs/run.log", "ab")
        stale = open(py / "scripts/setup/stale_in_use.py", "rb")
        try:
            su._install_python_payload(st)  # must not raise
            assert (py / "scripts/setup/skills_catalog.py").read_text(encoding="utf-8") == "new"
            assert (py / "skills/translator/SKILL.md").exists()
            assert (py / "skills-personal/mine/SKILL.md").read_text(encoding="utf-8") == "keep"
        finally:
            cookies.close(); log.close(); stale.close()
        assert (py / "scripts/automation/ChromeUserData/Default/Cookies").read_text(encoding="utf-8") == "keep"
        assert (py / "scripts/automation/logs/run.log").read_text(encoding="utf-8") == "keep"

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows file-locking semantics")
    def test_windows_really_refuses_to_move_a_folder_with_an_open_file(self, tmp_path):
        """Proof the test above exercises the real failure: the old update
        moved this folder aside, and Windows says no while a file is open."""
        folder = tmp_path / "ChromeUserData"
        (folder / "Default").mkdir(parents=True)
        (folder / "Default" / "Cookies").write_text("x")
        with open(folder / "Default" / "Cookies", "rb"):
            with pytest.raises(OSError):
                os.rename(folder, tmp_path / "moved")
        os.rename(folder, tmp_path / "moved")  # fine once closed
