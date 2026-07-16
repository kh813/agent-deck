"""
Tests for skills_catalog.py's catalog v2 features (2026-07-16):
multi-file (.zip) skills and the launch-time `sync` command that
auto-installs everything in the catalog's _default/ owner folder.

Google API, config, and logger are mocked so no network or OAuth is
required (same convention as test_drive_download.py).

Run:
  pytest python/tests/test_skills_catalog_sync.py -v
"""

import io
import json
import sys
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_SRC_DIR   = Path(__file__).resolve().parents[1]
_SETUP_DIR = _SRC_DIR / "scripts" / "setup"
sys.path.insert(0, str(_SETUP_DIR))
sys.path.insert(0, str(_SRC_DIR))

# Mock external dependencies so module-level code doesn't fail on import.
for _mod in [
    "googleapiclient", "googleapiclient.discovery", "googleapiclient.http",
    "googleapiclient.errors",
    "google", "google.oauth2", "google.oauth2.credentials",
    "google_auth_oauthlib", "google_auth_oauthlib.flow",
    "google.auth", "google.auth.transport", "google.auth.transport.requests",
]:
    sys.modules.setdefault(_mod, MagicMock())

_config_mock = MagicMock()
_config_mock.OAUTH_CLIENT_ID     = "test_client_id"
_config_mock.OAUTH_CLIENT_SECRET = "test_client_secret"
_config_mock.CATALOG_FOLDER_ID   = "test_catalog_folder"
_config_mock.CATALOG_URL         = "https://drive.google.com/drive/folders/test"
_config_mock.CATALOG_FILE_ID     = ""
_config_mock.CONFIG_PATH         = Path("/nonexistent/config.toml")
_config_mock.USER_EMAIL          = "test@example.com"
sys.modules["config"] = _config_mock

_auth_mock = MagicMock()
sys.modules["scripts.auth"] = _auth_mock

import skills_catalog as sc  # noqa: E402


@pytest.fixture
def skills_dir(tmp_path, monkeypatch):
    """Redirect skills-personal and the sync manifest into tmp_path."""
    personal = tmp_path / "skills-personal"
    personal.mkdir()
    monkeypatch.setattr(sc, "SKILLS_SRC", personal)
    monkeypatch.setattr(sc, "SYNC_MANIFEST_PATH", personal / ".catalog-sync-manifest")
    monkeypatch.setattr(sc, "CATALOG_FOLDER_ID", "test_catalog_folder")
    return personal


def _write_skill(root: Path, name: str, extra_files: dict = None):
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: test\n---\nbody\n")
    for rel, content in (extra_files or {}).items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    return d


class TestCatalogConfigured:
    def test_real_id_is_configured(self, monkeypatch):
        monkeypatch.setattr(sc, "CATALOG_FOLDER_ID", "1AbCdEf")
        assert sc.catalog_configured()

    def test_empty_is_not_configured(self, monkeypatch):
        monkeypatch.setattr(sc, "CATALOG_FOLDER_ID", "")
        assert not sc.catalog_configured()

    def test_template_placeholder_is_not_configured(self, monkeypatch):
        """config.toml.template ships literal "YOUR_..." placeholder strings
        — non-empty, so a bare truthiness check would treat every OSS
        install as catalog-enabled and attempt Drive calls (and interactive
        OAuth!) on every launch."""
        monkeypatch.setattr(sc, "CATALOG_FOLDER_ID", "YOUR_CATALOG_FOLDER_ID")
        assert not sc.catalog_configured()


class TestZipHelpers:
    def test_round_trip_preserves_scripts(self, tmp_path):
        skill = _write_skill(tmp_path, "my-skill",
                             {"scripts/tool.py": "print('hi')\n",
                              "data/ref.txt": "ref\n"})
        data = sc._zip_skill_dir(skill)

        dest = tmp_path / "extracted"
        sc._extract_skill_zip(data, dest)

        assert (dest / "SKILL.md").exists()
        assert (dest / "scripts" / "tool.py").read_text() == "print('hi')\n"
        assert (dest / "data" / "ref.txt").read_text() == "ref\n"

    def test_extract_replaces_existing_dir(self, tmp_path):
        skill = _write_skill(tmp_path, "my-skill", {"scripts/new.py": "new\n"})
        data = sc._zip_skill_dir(skill)

        dest = tmp_path / "extracted"
        dest.mkdir()
        (dest / "stale.py").write_text("stale\n")

        sc._extract_skill_zip(data, dest)

        assert not (dest / "stale.py").exists(), (
            "extraction must wholesale-replace the dir — a renamed script "
            "would otherwise leave its old copy behind forever"
        )
        assert (dest / "scripts" / "new.py").exists()

    def test_zip_slip_is_rejected(self, tmp_path):
        """The archive comes from a shared Drive folder others can write
        to — a malicious/corrupt member path must not escape the dest dir."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("../../evil.py", "evil")

        with pytest.raises(ValueError, match="Unsafe path"):
            sc._extract_skill_zip(buf.getvalue(), tmp_path / "dest")
        assert not (tmp_path / "evil.py").exists()

    def test_pycache_and_ds_store_excluded(self, tmp_path):
        skill = _write_skill(tmp_path, "my-skill",
                             {"scripts/tool.py": "x\n",
                              "scripts/__pycache__/tool.cpython-312.pyc": "junk",
                              ".DS_Store": "junk"})
        extra = sc._skill_extra_files(skill)
        names = [p.name for p in extra]
        assert "tool.py" in names
        assert "tool.cpython-312.pyc" not in names
        assert ".DS_Store" not in names


class TestFormatSelection:
    def test_md_only_skill_has_no_extra_files(self, tmp_path):
        skill = _write_skill(tmp_path, "simple")
        assert sc._skill_extra_files(skill) == []

    def test_dedupe_prefers_zip(self):
        entries = [
            {"owner": "_default", "name": "foo", "format": "md", "file_id": "1"},
            {"owner": "_default", "name": "foo", "format": "zip", "file_id": "2"},
            {"owner": "_default", "name": "bar", "format": "md", "file_id": "3"},
        ]
        best = {(e["owner"], e["name"]): e for e in []}
        result = sc._dedupe_prefer_zip(entries)
        by_name = {e["name"]: e for e in result}
        assert by_name["foo"]["format"] == "zip"
        assert by_name["bar"]["format"] == "md"
        assert len(result) == 2


def _fake_drive(monkeypatch, remote_entries, file_bytes=None):
    """Wire sync's Drive touchpoints to fakes. remote_entries: list of raw
    Drive file dicts in _default/. file_bytes: file_id -> bytes."""
    service = MagicMock()
    monkeypatch.setattr(sc, "_get_service", lambda timeout_seconds=None: service)
    monkeypatch.setattr(sc, "_list_owner_folders",
                        lambda svc: {"_default": "auto_folder_id", "alice": "alice_id"})
    monkeypatch.setattr(sc, "_list_skill_files_in_folder",
                        lambda svc, folder_id: remote_entries if folder_id == "auto_folder_id" else [])
    downloads = []

    def get_bytes(svc, file_id):
        downloads.append(file_id)
        return (file_bytes or {})[file_id]

    monkeypatch.setattr(sc, "_get_file_bytes", get_bytes)
    monkeypatch.setattr(sc, "_get_file_content",
                        lambda svc, file_id: get_bytes(svc, file_id).decode("utf-8"))
    return downloads


class TestSync:
    def test_noop_without_catalog_config(self, skills_dir, monkeypatch):
        monkeypatch.setattr(sc, "CATALOG_FOLDER_ID", "YOUR_CATALOG_FOLDER_ID")

        def fail(*a, **kw):
            raise AssertionError("Drive must not be touched when catalog is unconfigured")
        monkeypatch.setattr(sc, "_get_service", fail)

        sc.cmd_sync()  # must not raise

        assert not sc.SYNC_MANIFEST_PATH.exists()

    def test_installs_new_zip_skill(self, skills_dir, tmp_path, monkeypatch):
        src = _write_skill(tmp_path / "src", "org-skill",
                           {"scripts/run.py": "print('run')\n"})
        _fake_drive(monkeypatch,
                    [{"id": "f1", "name": "org-skill.zip",
                      "modifiedTime": "2026-07-16T00:00:00.000Z"}],
                    {"f1": sc._zip_skill_dir(src)})

        sc.cmd_sync()

        assert (skills_dir / "org-skill" / "SKILL.md").exists()
        assert (skills_dir / "org-skill" / "scripts" / "run.py").exists()
        manifest = json.loads(sc.SYNC_MANIFEST_PATH.read_text())
        assert manifest["org-skill"] == "2026-07-16T00:00:00.000Z"

    def test_installs_md_skill(self, skills_dir, monkeypatch):
        _fake_drive(monkeypatch,
                    [{"id": "f1", "name": "note-skill.md",
                      "modifiedTime": "2026-07-16T00:00:00.000Z"}],
                    {"f1": b"---\nname: note-skill\n---\nbody\n"})

        sc.cmd_sync()

        assert (skills_dir / "note-skill" / "SKILL.md").read_text().startswith("---")

    def test_unchanged_skill_is_not_redownloaded(self, skills_dir, monkeypatch):
        _write_skill(skills_dir, "org-skill")
        sc.SYNC_MANIFEST_PATH.write_text(
            json.dumps({"org-skill": "2026-07-16T00:00:00.000Z"}))
        downloads = _fake_drive(monkeypatch,
                                [{"id": "f1", "name": "org-skill.zip",
                                  "modifiedTime": "2026-07-16T00:00:00.000Z"}],
                                {})

        sc.cmd_sync()

        assert downloads == [], "matching modifiedTime must skip the download"

    def test_changed_skill_is_redownloaded(self, skills_dir, tmp_path, monkeypatch):
        _write_skill(skills_dir, "org-skill")
        sc.SYNC_MANIFEST_PATH.write_text(
            json.dumps({"org-skill": "2026-07-15T00:00:00.000Z"}))
        src = _write_skill(tmp_path / "src", "org-skill",
                           {"scripts/v2.py": "v2\n"})
        _fake_drive(monkeypatch,
                    [{"id": "f1", "name": "org-skill.zip",
                      "modifiedTime": "2026-07-16T00:00:00.000Z"}],
                    {"f1": sc._zip_skill_dir(src)})

        sc.cmd_sync()

        assert (skills_dir / "org-skill" / "scripts" / "v2.py").exists()
        manifest = json.loads(sc.SYNC_MANIFEST_PATH.read_text())
        assert manifest["org-skill"] == "2026-07-16T00:00:00.000Z"

    def test_removed_remote_skill_is_removed_locally(self, skills_dir, monkeypatch):
        _write_skill(skills_dir, "retired-skill")
        sc.SYNC_MANIFEST_PATH.write_text(
            json.dumps({"retired-skill": "2026-07-15T00:00:00.000Z"}))
        _fake_drive(monkeypatch, [], {})

        sc.cmd_sync()

        assert not (skills_dir / "retired-skill").exists()
        assert json.loads(sc.SYNC_MANIFEST_PATH.read_text()) == {}

    def test_user_created_skill_is_never_removed(self, skills_dir, monkeypatch):
        """A skill the user made via `my-skills create` (not in the
        manifest) must survive sync even though it's not in _default/."""
        _write_skill(skills_dir, "my-own-skill")
        _fake_drive(monkeypatch, [], {})

        sc.cmd_sync()

        assert (skills_dir / "my-own-skill" / "SKILL.md").exists()

    def test_offline_failure_is_graceful(self, skills_dir, monkeypatch):
        """sync runs inside every launch's preflight — a network failure
        must warn and leave everything untouched, never raise."""
        _write_skill(skills_dir, "org-skill")
        sc.SYNC_MANIFEST_PATH.write_text(
            json.dumps({"org-skill": "2026-07-15T00:00:00.000Z"}))

        def offline(timeout_seconds=None):
            raise ConnectionError("no network")
        monkeypatch.setattr(sc, "_get_service", offline)

        sc.cmd_sync()  # must not raise

        assert (skills_dir / "org-skill" / "SKILL.md").exists()
        assert json.loads(sc.SYNC_MANIFEST_PATH.read_text()) == {
            "org-skill": "2026-07-15T00:00:00.000Z"}

    def test_auth_uses_timeout(self, skills_dir, monkeypatch):
        """First-launch interactive auth must be time-capped — a closed
        browser must not hang the session start forever."""
        seen = {}

        def record(timeout_seconds=None):
            seen["timeout"] = timeout_seconds
            raise ConnectionError("stop here")
        monkeypatch.setattr(sc, "_get_service", record)

        sc.cmd_sync()

        assert seen["timeout"] == sc.SYNC_AUTH_TIMEOUT_SECONDS


class TestSetupPyIntegration:
    def test_skills_rebuild_syncs_before_building(self, monkeypatch):
        import setup as setup_mod

        order = []
        monkeypatch.setattr(setup_mod, "sync_catalog_skills", lambda: order.append("sync"))
        monkeypatch.setattr(setup_mod, "build_skills", lambda: order.append("build"))
        monkeypatch.setattr(setup_mod, "install_skills", lambda: order.append("install"))

        setup_mod.skills_rebuild()

        assert order == ["sync", "build", "install"], (
            "sync must run before build so freshly-synced catalog skills "
            "are part of the same rebuild"
        )

    def test_sync_failure_does_not_fail_rebuild(self, monkeypatch):
        import setup as setup_mod

        def boom(cmd, **kw):
            class R:
                returncode = 1
            return R()
        monkeypatch.setattr(setup_mod.subprocess, "run", boom)

        setup_mod.sync_catalog_skills()  # must not raise
