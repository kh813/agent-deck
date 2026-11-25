"""
Tests for package_release.py -- rebuilds the public GitHub release with
this org's own config.toml merged in, for internal (config-bundled) Drive
distribution. Covers build_package()'s fetch/merge/zip logic; upload() and
_get_service() are thin OAuth/Drive-API wrappers left untested, matching
this repo's existing convention for backup_config.py/drive_upload.py.

Run:
  pytest python/tests/test_package_release.py -v
"""
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts" / "tools"))
sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))

import package_release as pr  # noqa: E402
import self_update as su  # noqa: E402


def _fake_release(tag: str) -> dict:
    return {
        "tag_name": tag,
        "assets": [
            {"name": "agent-deck-mac.zip", "browser_download_url": f"https://example.com/{tag}/mac.zip"},
            {"name": "agent-deck-win.zip", "browser_download_url": f"https://example.com/{tag}/win.zip"},
        ],
    }


def _make_mac_zip(zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("agent-deck.app/Contents/MacOS/agent-deck", "#!/bin/sh\necho hi\n")
        zf.writestr("agent-deck.app/Contents/Info.plist", "<plist/>")
        zf.writestr("python/skills/translator/SKILL.md", "---\nname: translator\n---\n")
        zf.writestr("config/config.toml.template", "[oauth]\n")
        zf.writestr("agent_config.json", "{}")
        zf.writestr("preflight.sh", "#!/bin/bash\necho ok\n")
        zf.writestr("messages/no_python.txt", "no python")
        # Public, secret-free, git-tracked -- release.yml bakes these into
        # the public ZIP directly (see docs/admin_guide.md §15); this
        # script merges no org-specific counterpart for either anymore.
        zf.writestr("AGENTS.md", "## Startup\n...\n")
        zf.writestr("CLAUDE.md", "@AGENTS.md\n")
        zf.writestr("Initial_setup_for_Mac.command", "#!/bin/bash\nxattr -cr ./agent-deck.app\nopen ./agent-deck.app\n")


def _make_win_zip(zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("agent-deck.exe", "fake exe content")
        zf.writestr("python/skills/translator/SKILL.md", "---\nname: translator\n---\n")
        zf.writestr("config/config.toml.template", "[oauth]\n")
        zf.writestr("agent_config.json", "{}")
        zf.writestr("preflight.bat", "@echo off\r\necho ok\r\n")
        zf.writestr("messages/no_python.txt", "no python")
        zf.writestr("AGENTS.md", "## Startup\n...\n")
        zf.writestr("CLAUDE.md", "@AGENTS.md\n")


@pytest.fixture
def fake_org_config(tmp_path):
    cfg = tmp_path / "org-config.toml"
    cfg.write_text('[oauth]\nclient_id = "real-id"\nclient_secret = "real-secret"\n')
    return cfg


@pytest.fixture
def no_op_signing(monkeypatch):
    """Skip real xattr/codesign calls -- irrelevant to this module's own
    fetch/merge/zip logic, and codesign isn't guaranteed present everywhere
    tests run."""
    monkeypatch.setattr(pr.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0))


class TestBuildPackage:
    def test_merges_both_platforms_and_config_toml(self, tmp_path, fake_org_config, monkeypatch, no_op_signing):
        monkeypatch.setattr(su, "_fetch_release", lambda channel: _fake_release("v0.0.22-rc1"))

        def fake_download(url, dest):
            if "mac.zip" in url:
                _make_mac_zip(dest)
            else:
                _make_win_zip(dest)

        monkeypatch.setattr(pr, "_download", fake_download)

        out_zip = pr.build_package("test", tmp_path, config_toml=fake_org_config)

        assert out_zip.name == "agent-deck-test.zip"
        with zipfile.ZipFile(out_zip) as zf:
            names = zf.namelist()
        assert "config.toml" in names
        assert "agent-deck.app/Contents/MacOS/agent-deck" in names
        assert "agent-deck.exe" in names
        assert "python/skills/translator/SKILL.md" in names
        assert "preflight.sh" in names
        assert "preflight.bat" in names
        # AGENTS.md/CLAUDE.md ride through unchanged -- release.yml already
        # baked them into the public ZIP; this script merges no extra copy.
        assert "AGENTS.md" in names
        assert "CLAUDE.md" in names

    def test_prod_channel_uses_prod_zip_name(self, tmp_path, fake_org_config, monkeypatch, no_op_signing):
        monkeypatch.setattr(su, "_fetch_release", lambda channel: _fake_release("v0.0.21"))
        monkeypatch.setattr(pr, "_download", lambda url, dest: (
            _make_mac_zip(dest) if "mac.zip" in url else _make_win_zip(dest)
        ))

        out_zip = pr.build_package("prod", tmp_path, config_toml=fake_org_config)

        assert out_zip.name == "agent-deck.zip"

    def test_missing_asset_raises(self, tmp_path, fake_org_config, monkeypatch, no_op_signing):
        monkeypatch.setattr(su, "_fetch_release", lambda channel: {
            "tag_name": "v0.0.22-rc1",
            "assets": [{"name": "agent-deck-mac.zip", "browser_download_url": "https://example.com/mac.zip"}],
        })
        monkeypatch.setattr(pr, "_download", lambda url, dest: _make_mac_zip(dest))

        with pytest.raises(RuntimeError, match="agent-deck-win.zip"):
            pr.build_package("test", tmp_path, config_toml=fake_org_config)

    def test_aborts_when_signature_verification_fails(self, tmp_path, fake_org_config, monkeypatch):
        """Confirmed for real (2026-07-23): an invalid signature after the
        merge/re-sign round-trip means macOS refuses to even launch the app
        ("is damaged", error -47, no user override) -- must abort before
        zipping/uploading a build that can never launch."""
        monkeypatch.setattr(su, "_fetch_release", lambda channel: _fake_release("v0.0.22-rc1"))
        monkeypatch.setattr(pr, "_download", lambda url, dest: (
            _make_mac_zip(dest) if "mac.zip" in url else _make_win_zip(dest)
        ))

        def fake_run(cmd, *a, **kw):
            if cmd[0] == "codesign" and cmd[1] == "--verify":
                return subprocess.CompletedProcess(cmd, 1, stderr=b"invalid signature")
            return subprocess.CompletedProcess(cmd, 0)

        monkeypatch.setattr(pr.subprocess, "run", fake_run)

        with pytest.raises(RuntimeError, match="signature verification failed"):
            pr.build_package("test", tmp_path, config_toml=fake_org_config)

    def test_missing_config_toml_raises(self, tmp_path, monkeypatch, no_op_signing):
        monkeypatch.setattr(su, "_fetch_release", lambda channel: _fake_release("v0.0.22-rc1"))
        monkeypatch.setattr(pr, "_download", lambda url, dest: (
            _make_mac_zip(dest) if "mac.zip" in url else _make_win_zip(dest)
        ))

        with pytest.raises(RuntimeError, match="config.toml"):
            pr.build_package("test", tmp_path, config_toml=tmp_path / "does-not-exist.toml")

    def test_launcher_survives_merge_as_executable(self, tmp_path, fake_org_config, monkeypatch, no_op_signing):
        """zipfile.extractall() does NOT restore the executable bit even
        though it's present in the zip's external_attr -- confirmed for
        real (2026-08-14): a real package_release.py --test run produced a
        non-executable "Initial_setup_for_Mac.command", so double-clicking it
        failed with a Finder permission error instead of launching."""
        monkeypatch.setattr(su, "_fetch_release", lambda channel: _fake_release("v0.0.22-rc1"))
        monkeypatch.setattr(pr, "_download", lambda url, dest: (
            _make_mac_zip(dest) if "mac.zip" in url else _make_win_zip(dest)
        ))

        pr.build_package("test", tmp_path, config_toml=fake_org_config)

        launcher = tmp_path / "merged" / "Initial_setup_for_Mac.command"
        assert launcher.exists()
        assert os.access(launcher, os.X_OK), "launcher lost its executable bit after merge"

    def test_zip_has_no_wrapper_folder(self, tmp_path, fake_org_config, monkeypatch, no_op_signing):
        """Matches the public release ZIP's own flat layout, so
        README/user_guide.md's extraction instructions apply unchanged
        regardless of whether the ZIP came from GitHub or this org's Drive."""
        monkeypatch.setattr(su, "_fetch_release", lambda channel: _fake_release("v0.0.22-rc1"))
        monkeypatch.setattr(pr, "_download", lambda url, dest: (
            _make_mac_zip(dest) if "mac.zip" in url else _make_win_zip(dest)
        ))

        out_zip = pr.build_package("test", tmp_path, config_toml=fake_org_config)

        with zipfile.ZipFile(out_zip) as zf:
            names = zf.namelist()
        assert all(not n.startswith("agent-deck/") for n in names)


# ── Common (catalog _default/) skills bundled into the org ZIP (2026-11-25) ──

def _fake_catalog(monkeypatch, files: dict, folder_present=True):
    """Patch skills_catalog's Drive helpers: files = {name: (bytes, modifiedTime)}."""
    sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))
    import skills_catalog as sc
    monkeypatch.setattr(sc, "catalog_configured", lambda: True)
    monkeypatch.setattr(sc, "_list_owner_folders",
                        lambda svc: {"_default": "F"} if folder_present else {})
    monkeypatch.setattr(sc, "_list_skill_files_in_folder",
                        lambda svc, fid: [{"id": n, "name": n, "modifiedTime": m}
                                          for n, (_, m) in files.items()])
    monkeypatch.setattr(sc, "_get_file_bytes", lambda svc, fid: files[fid][0])
    monkeypatch.setattr(sc, "_get_file_content", lambda svc, fid: files[fid][0].decode())
    return sc


def _skill_zip(name: str, extra: dict = None) -> bytes:
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("SKILL.md", f"---\nname: {name}\ndescription: d\n---\n")
        for path, body in (extra or {}).items():
            zf.writestr(path, body)
    return buf.getvalue()


class TestBundleCatalogSkills:
    def test_bundles_default_skills_with_sync_manifest(self, tmp_path, monkeypatch):
        import json
        _fake_catalog(monkeypatch, {
            "org-a.zip": (_skill_zip("org-a", {"scripts/run.py": "x"}), "2026-07-16T01:02:03.000Z"),
            "note-b.md": (b"---\nname: note-b\n---\nbody\n", "2026-07-17T00:00:00.000Z"),
        })
        names = pr.bundle_catalog_skills(tmp_path, service=object())
        root = tmp_path / "python" / "skills-catalog"
        assert names == ["note-b", "org-a"]
        assert (root / "org-a" / "scripts" / "run.py").read_text() == "x"
        assert (root / "note-b" / "SKILL.md").read_text().startswith("---")
        manifest = json.loads((root / ".catalog-sync-manifest").read_text())
        # Same keys/values the runtime sync writes, so it won't re-download.
        assert manifest == {"org-a": "2026-07-16T01:02:03.000Z", "note-b": "2026-07-17T00:00:00.000Z"}

    def test_no_default_folder_bundles_nothing(self, tmp_path, monkeypatch):
        _fake_catalog(monkeypatch, {}, folder_present=False)
        assert pr.bundle_catalog_skills(tmp_path, service=object()) == []
        assert not (tmp_path / "python" / "skills-catalog").exists()

    def test_runtime_sync_treats_bundled_skills_as_up_to_date(self, tmp_path, monkeypatch):
        """End-to-end with the real cmd_sync: nothing is re-downloaded for a
        bundled skill whose Drive modifiedTime hasn't changed."""
        files = {"org-a.zip": (_skill_zip("org-a"), "2026-07-16T01:02:03.000Z")}
        sc = _fake_catalog(monkeypatch, files)
        pr.bundle_catalog_skills(tmp_path, service=object())
        cat = tmp_path / "python" / "skills-catalog"
        monkeypatch.setattr(sc, "CATALOG_SKILLS_DIR", cat)
        monkeypatch.setattr(sc, "SYNC_MANIFEST_PATH", cat / ".catalog-sync-manifest")
        monkeypatch.setattr(sc, "LEGACY_SYNC_MANIFEST_PATH", tmp_path / "none" / ".catalog-sync-manifest")
        monkeypatch.setattr(sc, "_get_service", lambda timeout_seconds=None: object())
        downloads = []
        monkeypatch.setattr(sc, "_get_file_bytes", lambda svc, fid: downloads.append(fid) or files[fid][0])
        sc.cmd_sync()
        assert downloads == []

    def test_build_package_calls_bundle_hook_and_zips_it(self, tmp_path, fake_org_config, monkeypatch, no_op_signing):
        monkeypatch.setattr(su, "_fetch_release", lambda channel: _fake_release("v0.2.2"))
        monkeypatch.setattr(pr, "_download",
                            lambda url, dest: _make_mac_zip(dest) if "mac.zip" in url else _make_win_zip(dest))

        def hook(merged):
            d = merged / "python" / "skills-catalog" / "org-a"
            d.mkdir(parents=True)
            (d / "SKILL.md").write_text("x")

        out_zip = pr.build_package("prod", tmp_path, config_toml=fake_org_config, bundle_skills=hook)
        with zipfile.ZipFile(out_zip) as zf:
            assert "python/skills-catalog/org-a/SKILL.md" in zf.namelist()


def test_upload_records_the_release_tag_on_the_drive_file():
    """Installs compare this recorded version with their own instead of only
    the file's timestamp, so an older build is never offered as an update."""
    meta = pr.version_metadata("v0.2.8-rc4")
    assert meta["appProperties"] == {pr.su.DRIVE_VERSION_PROPERTY: "v0.2.8-rc4"}
    assert "v0.2.8-rc4" in meta["description"]


def test_main_uploads_with_the_built_release_tag(monkeypatch, tmp_path):
    calls = {}
    monkeypatch.setattr(pr, "ORG_RELEASE_PROD_FILE_ID", "PROD")
    monkeypatch.setattr(pr.su, "_fetch_release", lambda ch: {"tag_name": "v9.9.9", "assets": []})

    def fake_build(channel, staging, bundle_skills=None, release=None, **kw):
        calls["release"] = release
        z = tmp_path / "out.zip"
        z.write_bytes(b"zip")
        return z
    monkeypatch.setattr(pr, "build_package", fake_build)
    monkeypatch.setattr(pr, "upload", lambda z, fid, tag="": calls.update(fid=fid, tag=tag))
    monkeypatch.setattr(pr.sys, "argv", ["package_release.py", "--prod", "--no-catalog-skills"])
    pr.main()
    assert calls["release"]["tag_name"] == "v9.9.9"
    assert calls["fid"] == "PROD" and calls["tag"] == "v9.9.9"
