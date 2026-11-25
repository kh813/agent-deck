"""skills_catalog.py api: the JSON entry point behind agent-deck's catalog
screen. Every op must end with exactly one marker-prefixed JSON line, and
failures (sys.exit in the reused commands, Drive errors, ambiguity) must
come back as ok:false with a code the UI can act on."""
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SETUP_DIR = ROOT / "python" / "scripts" / "setup"
sys.path.insert(0, str(_SETUP_DIR))
sys.path.insert(0, str(ROOT / "python"))
for _mod in [
    "googleapiclient", "googleapiclient.discovery", "googleapiclient.http", "googleapiclient.errors",
    "google", "google.oauth2", "google.oauth2.credentials", "google_auth_oauthlib",
    "google_auth_oauthlib.flow", "google.auth", "google.auth.transport", "google.auth.transport.requests",
]:
    sys.modules.setdefault(_mod, MagicMock())
if not isinstance(sys.modules.get("config"), MagicMock):
    _cfg = MagicMock()
    _cfg.CATALOG_FOLDER_ID = "test_catalog_folder"
    _cfg.CATALOG_FILE_ID = ""
    _cfg.CONFIG_PATH = Path("/nonexistent/config.toml")
    _cfg.USER_EMAIL = "test@example.com"
    sys.modules["config"] = _cfg
sys.modules.setdefault("scripts.auth", MagicMock())

import skills_catalog as sc  # noqa: E402

CATALOG = [
    {"name": "ask-portal", "owner": "_default", "modified": "2026-07-16", "description": "社内ポータル検索"},
    {"name": "slide-generator", "owner": "_default", "modified": "2026-07-16", "description": "Marp to PPTX"},
    {"name": "expense", "owner": "taro", "modified": "2026-10-01", "description": "経費チェック"},
]


def _skill(root: Path, name: str, desc="d", email="", disabled=False):
    d = root / ("disabled" if disabled else "") / name
    d.mkdir(parents=True, exist_ok=True)
    fm = f"---\nname: {name}\ndescription: {desc}\n" + (f"email: {email}\n" if email else "") + "---\nbody\n"
    (d / "SKILL.md").write_text(fm, encoding="utf-8")
    return d


@pytest.fixture
def roots(tmp_path, monkeypatch):
    common, catalog, personal = tmp_path / "skills", tmp_path / "skills-catalog", tmp_path / "skills-personal"
    for r in (common, catalog, personal):
        r.mkdir()
    monkeypatch.setattr(sc, "COMMON_SKILL_ROOTS", [common])
    monkeypatch.setattr(sc, "CATALOG_SKILLS_DIR", catalog)
    monkeypatch.setattr(sc, "SKILLS_SRC", personal)
    monkeypatch.setattr(sc, "INDEX_PATH", tmp_path / "catalog-index.md")
    monkeypatch.setattr(sc, "USER_EMAIL", "test@example.com")
    return common, catalog, personal


def run_api(capsys, *args):
    code = sc.cmd_api(list(args))
    out = capsys.readouterr().out.splitlines()
    assert out, "no output"
    last = out[-1]
    assert last.startswith(sc.API_MARKER), last
    assert sum(1 for l in out if l.startswith(sc.API_MARKER)) == 1, "exactly one JSON line"
    return code, json.loads(last[len(sc.API_MARKER):])


class TestReadOps:
    def test_catalog_marks_what_is_installed_where(self, roots, monkeypatch, capsys):
        common, catalog, personal = roots
        _skill(catalog, "ask-portal")
        _skill(common, "slide-generator")
        monkeypatch.setattr(sc, "_load_catalog_skills", lambda: CATALOG)
        code, r = run_api(capsys, "catalog")
        assert code == 0 and r["ok"]
        inst = {s["name"]: s["installed"] for s in r["data"]["skills"]}
        assert inst == {"ask-portal": "catalog", "slide-generator": "common", "expense": None}
        assert r["data"]["offline"] is False

    def test_catalog_reports_offline_fallback(self, roots, monkeypatch, capsys):
        sc._write_index(CATALOG)
        monkeypatch.setattr(sc, "_get_service", MagicMock(side_effect=RuntimeError("offline")))
        code, r = run_api(capsys, "catalog")
        assert r["ok"] and r["data"]["offline"] is True
        assert "ローカルキャッシュ" in r["log"]  # human message captured, not printed

    def test_search(self, roots, monkeypatch, capsys):
        monkeypatch.setattr(sc, "_load_catalog_skills", lambda: CATALOG)
        _, r = run_api(capsys, "search", "経費")
        assert [s["name"] for s in r["data"]["skills"]] == ["expense"]

    def test_search_needs_a_keyword(self, roots, capsys):
        code, r = run_api(capsys, "search")
        assert code == 1 and r["error"]["code"] == "usage"

    def test_info_ambiguous_returns_candidates(self, roots, monkeypatch, capsys):
        monkeypatch.setattr(sc, "_get_service", lambda *a, **k: object())
        monkeypatch.setattr(sc, "_find_skill", lambda svc, q: [
            {"owner": "a", "name": "x", "format": "md", "file_id": "1", "modified": "m"},
            {"owner": "b", "name": "x", "format": "md", "file_id": "2", "modified": "m"}])
        code, r = run_api(capsys, "info", "x")
        assert code == 1 and r["error"]["code"] == "ambiguous"
        assert r["error"]["candidates"] == ["a/x", "b/x"]

    def test_info_not_found(self, roots, monkeypatch, capsys):
        monkeypatch.setattr(sc, "_get_service", lambda *a, **k: object())
        monkeypatch.setattr(sc, "_find_skill", lambda svc, q: [])
        _, r = run_api(capsys, "info", "nope")
        assert r["error"]["code"] == "not_found"

    def test_info_returns_content_and_meta(self, roots, monkeypatch, capsys):
        monkeypatch.setattr(sc, "_get_service", lambda *a, **k: object())
        monkeypatch.setattr(sc, "_find_skill", lambda svc, q: [
            {"owner": "taro", "name": "expense", "format": "md", "file_id": "1", "modified": "2026-10-01"}])
        monkeypatch.setattr(sc, "_get_file_content", lambda svc, fid: "---\nname: expense\nauthor: Taro\ndescription: 経費\n---\nbody")
        _, r = run_api(capsys, "info", "expense")
        d = r["data"]
        assert (d["name"], d["owner"], d["author"], d["description"]) == ("expense", "taro", "Taro", "経費")
        assert d["content"].endswith("body") and d["installed"] is None


class TestLocal:
    def test_classifies_and_includes_disabled(self, roots, capsys):
        common, catalog, personal = roots
        _skill(common, "setup")
        _skill(catalog, "expense", email="taro@example.com")
        _skill(personal, "mine-shared", email="test@example.com")
        _skill(personal, "mine-draft")  # no email yet = mine
        _skill(personal, "old", disabled=True)
        sc._write_index([{"name": "mine-shared", "owner": "test", "modified": "", "description": ""}])
        _, r = run_api(capsys, "local")
        by = {s["name"]: s for s in r["data"]["skills"]}
        assert by["setup"]["root"] == "common" and not by["setup"]["mine"]
        assert by["expense"]["root"] == "catalog" and by["expense"]["owner"] == "taro"
        assert by["mine-shared"]["mine"] and by["mine-shared"]["shared"]
        assert by["mine-draft"]["mine"] and not by["mine-draft"]["shared"]
        assert by["old"]["enabled"] is False
        assert r["data"]["me"] == "test"


class TestWriteOps:
    def test_import_reports_overwrite_and_shadowing(self, roots, monkeypatch, capsys):
        common, catalog, personal = roots
        _skill(catalog, "expense")
        _skill(personal, "expense")
        monkeypatch.setattr(sc, "_get_service", lambda *a, **k: object())
        monkeypatch.setattr(sc, "_find_skill", lambda svc, q: [
            {"owner": "taro", "name": "expense", "format": "md", "file_id": "1", "modified": "m"}])
        installed = []
        monkeypatch.setattr(sc, "_install_skill_entry", lambda svc, m: installed.append(m["name"]))
        _, r = run_api(capsys, "import", "taro/expense")
        assert r["ok"] and installed == ["expense"]
        assert r["data"] == {"name": "expense", "owner": "taro", "overwrote": True, "shadows_personal": True}

    def test_sys_exit_in_reused_command_becomes_failed_with_its_error_line(self, roots, monkeypatch, capsys):
        def boom(name):
            print("[INFO] something")
            print("[ERROR] 同名のスキルが別のオーナーのもとに存在します:")
            print("        other/x")
            sys.exit(1)
        monkeypatch.setattr(sc, "cmd_upload", boom)
        code, r = run_api(capsys, "share", "x")
        assert code == 1 and r["error"]["code"] == "failed"
        assert "同名のスキル" in r["error"]["message"]
        assert "[INFO] something" in r["log"]

    def test_drive_exception_becomes_exception_code(self, roots, monkeypatch, capsys):
        monkeypatch.setattr(sc, "cmd_delete", MagicMock(side_effect=OSError("network down")))
        _, r = run_api(capsys, "unshare", "x")
        assert r["error"]["code"] == "exception" and "network down" in r["error"]["message"]

    @pytest.mark.parametrize("op,setup_args", [("enable", ["enable", "x"]), ("disable", ["disable", "x"]), ("rebuild", ["rebuild"])])
    def test_setup_ops_run_setup_py(self, roots, monkeypatch, capsys, op, setup_args):
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, "==> Done\n", "")
        monkeypatch.setattr(sc.subprocess, "run", fake_run)
        args = [op] + (["x"] if op != "rebuild" else [])
        _, r = run_api(capsys, *args)
        assert r["ok"]
        assert calls[0][1].endswith("setup.py") and calls[0][2:] == ["skills", *setup_args]
        assert "==> Done" in r["log"]

    def test_setup_failure_surfaces_last_line(self, roots, monkeypatch, capsys):
        monkeypatch.setattr(sc.subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(
            cmd, 1, "Error: skill 'x' not found in python/skills/\n", ""))
        _, r = run_api(capsys, "enable", "x")
        assert r["error"]["code"] == "failed" and "not found" in r["error"]["message"]


def test_unknown_op(capsys):
    code, r = run_api(capsys, "frobnicate")
    assert code == 1 and r["error"]["code"] == "usage"


def test_no_config_gives_no_catalog_json(tmp_path):
    """A public install (no config.toml) answers api calls with a JSON
    no_catalog error instead of a plain message the UI can't parse."""
    setup = tmp_path / "python" / "scripts" / "setup"
    setup.mkdir(parents=True)
    shutil.copy(_SETUP_DIR / "skills_catalog.py", setup)
    r = subprocess.run([sys.executable, "-I", str(setup / "skills_catalog.py"), "api", "catalog"],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 1
    last = r.stdout.strip().splitlines()[-1]
    assert last.startswith("@@AGENT_DECK_JSON@@ ")
    assert json.loads(last.split(" ", 1)[1])["error"]["code"] == "no_catalog"
