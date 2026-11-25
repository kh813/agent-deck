"""skills_catalog.py api: authoring ops behind the catalog screen's
"My Skills" tab -- create / read / save / delete your own skills, and
uninstall skills imported from the catalog. Only skills-personal/ (and, for
uninstall, manually imported skills-catalog/ entries) may ever be written."""
import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_skills_catalog_api import CATALOG, _skill, roots, run_api, sc  # noqa: E402,F401


def with_stdin(monkeypatch, obj):
    monkeypatch.setattr(sys, "stdin", io.StringIO(obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)))


def index(owner_rows):
    sc._write_index([{"name": n, "owner": o, "modified": "2026-11-01", "description": "x"} for n, o in owner_rows])


GOOD = {"name": "weekly-report", "description": "週報を作る / Writes the weekly report",
        "body": "# 週報\n\n1. 予定を集める\n2. まとめる\n"}


class TestCreate:
    def test_writes_skill_md_in_personal(self, roots, monkeypatch, capsys):
        _c, _cat, personal = roots
        with_stdin(monkeypatch, GOOD)
        code, r = run_api(capsys, "create")
        assert code == 0 and r["ok"], r
        text = (personal / "weekly-report" / "SKILL.md").read_text(encoding="utf-8")
        assert text.startswith("---\nname: weekly-report\ndescription: 週報を作る / Writes the weekly report\n---\n\n# 週報")
        meta = sc._parse_frontmatter(text)
        assert meta["name"] == "weekly-report"
        assert not list(personal.rglob("*.tmp"))

    def test_multiline_description_is_folded_to_one_line(self, roots, monkeypatch, capsys):
        _c, _cat, personal = roots
        with_stdin(monkeypatch, {**GOOD, "description": "line one\nline two:\r\n  three"})
        code, r = run_api(capsys, "create")
        assert r["ok"], r
        meta = sc._parse_frontmatter((personal / "weekly-report" / "SKILL.md").read_text(encoding="utf-8"))
        assert meta["description"] == "line one line two: three"

    @pytest.mark.parametrize("name", ["", "a", "Weekly", "週報", "has space", "../evil", "a/b", "-lead", "disabled", "x" * 65])
    def test_rejects_bad_names(self, roots, monkeypatch, capsys, name):
        with_stdin(monkeypatch, {**GOOD, "name": name})
        code, r = run_api(capsys, "create")
        assert code == 1 and r["error"]["code"] == "invalid_name"
        assert not any(roots[2].iterdir())

    @pytest.mark.parametrize("field,code_", [("description", "invalid_description"), ("body", "invalid_body")])
    def test_requires_description_and_body(self, roots, monkeypatch, capsys, field, code_):
        with_stdin(monkeypatch, {**GOOD, field: "  \n "})
        code, r = run_api(capsys, "create")
        assert r["error"]["code"] == code_

    def test_too_large(self, roots, monkeypatch, capsys):
        with_stdin(monkeypatch, {**GOOD, "body": "x" * (sc.MAX_SKILL_MD_BYTES + 1)})
        _code, r = run_api(capsys, "create")
        assert r["error"]["code"] == "too_large"

    @pytest.mark.parametrize("where", ["common", "catalog", "personal", "personal-disabled"])
    def test_refuses_existing_name_anywhere(self, roots, monkeypatch, capsys, where):
        common, catalog, personal = roots
        root = {"common": common, "catalog": catalog}.get(where, personal)
        _skill(root, "weekly-report", desc="original", disabled=where.endswith("disabled"))
        with_stdin(monkeypatch, GOOD)
        _code, r = run_api(capsys, "create")
        assert r["error"]["code"] == "exists"
        found = list(root.rglob("weekly-report/SKILL.md"))
        assert len(found) == 1 and "original" in found[0].read_text(encoding="utf-8")

    def test_refuses_name_someone_else_shares(self, roots, monkeypatch, capsys):
        index([("weekly-report", "taro")])
        with_stdin(monkeypatch, GOOD)
        _code, r = run_api(capsys, "create")
        assert r["error"]["code"] == "exists" and "taro" in r["error"]["message"]

    def test_own_shared_name_in_index_is_not_a_clash(self, roots, monkeypatch, capsys):
        # e.g. re-creating after deleting locally: the catalog entry is yours.
        index([("weekly-report", "test")])
        with_stdin(monkeypatch, GOOD)
        _code, r = run_api(capsys, "create")
        assert r["ok"], r

    def test_bad_json(self, roots, monkeypatch, capsys):
        with_stdin(monkeypatch, "{nope")
        _code, r = run_api(capsys, "create")
        assert r["error"]["code"] == "usage"
        with_stdin(monkeypatch, "[1]")
        _code, r = run_api(capsys, "create")
        assert r["error"]["code"] == "usage"

    def test_no_stdin_is_a_validation_error_not_a_hang(self, roots, monkeypatch, capsys):
        with_stdin(monkeypatch, "")
        _code, r = run_api(capsys, "create")
        assert r["error"]["code"] == "invalid_name"


class TestRead:
    def test_personal_skill_is_editable_and_split(self, roots, capsys):
        d = _skill(roots[2], "mine", desc="my desc")
        (d / "run.py").write_text("print(1)\n", encoding="utf-8")
        (d / "lib").mkdir()
        (d / "lib" / "x.txt").write_text("x", encoding="utf-8")
        _code, r = run_api(capsys, "read", "mine")
        data = r["data"]
        assert data["editable"] and data["mine"] and data["root"] == "personal"
        assert data["description"] == "my desc"
        assert data["body"] == "body\n"
        assert data["extra_files"] == ["lib/x.txt", "run.py"]
        assert data["content"].startswith("---\nname: mine")

    def test_builtin_and_imported_are_read_only(self, roots, capsys):
        _skill(roots[0], "builtin")
        _skill(roots[1], "imported", email="taro@example.com")
        for name, root in (("builtin", "common"), ("imported", "catalog")):
            _code, r = run_api(capsys, "read", name)
            assert r["data"]["root"] == root and not r["data"]["editable"] and not r["data"]["mine"]

    def test_disabled_personal_skill(self, roots, capsys):
        _skill(roots[2], "sleepy", disabled=True)
        _code, r = run_api(capsys, "read", "sleepy")
        assert r["data"]["editable"] and not r["data"]["enabled"]

    def test_root_arg_reaches_a_shadowed_personal_skill(self, roots, capsys):
        _skill(roots[1], "dup", desc="imported")
        _skill(roots[2], "dup", desc="mine")
        _code, r = run_api(capsys, "read", "dup")
        assert r["data"]["description"] == "imported"
        _code, r = run_api(capsys, "read", "dup", "personal")
        assert r["data"]["description"] == "mine" and r["data"]["editable"]

    def test_shared_flag_from_index(self, roots, capsys):
        _skill(roots[2], "mine")
        index([("mine", "test")])
        _code, r = run_api(capsys, "read", "mine")
        assert r["data"]["shared"]

    @pytest.mark.parametrize("name", ["../skills/x", "nope", "..", "a\\b"])
    def test_unknown_or_pathlike(self, roots, capsys, name):
        _code, r = run_api(capsys, "read", name)
        assert r["error"]["code"] == "not_found"


class TestSave:
    def test_updates_description_and_body_keeps_other_frontmatter(self, roots, monkeypatch, capsys):
        d = _skill(roots[2], "mine", desc="old", email="test@example.com")
        text = (d / "SKILL.md").read_text(encoding="utf-8").replace("---\nbody", "author: Test User\n---\nbody")
        (d / "SKILL.md").write_text(text, encoding="utf-8")
        (d / "run.py").write_text("x", encoding="utf-8")
        with_stdin(monkeypatch, {"name": "mine", "description": "new desc", "body": "new\r\nbody\n\n\n"})
        _code, r = run_api(capsys, "save")
        assert r["ok"], r
        out = (d / "SKILL.md").read_text(encoding="utf-8")
        meta = sc._parse_frontmatter(out)
        assert meta == {"name": "mine", "description": "new desc", "email": "test@example.com", "author": "Test User"}
        assert out.endswith("---\n\nnew\nbody\n")
        assert (d / "run.py").read_text(encoding="utf-8") == "x", "bundled files untouched"

    def test_reports_shared_so_the_ui_can_offer_to_update_the_catalog(self, roots, monkeypatch, capsys):
        _skill(roots[2], "mine")
        index([("mine", "test")])
        with_stdin(monkeypatch, {"name": "mine", "description": "d", "body": "b"})
        _code, r = run_api(capsys, "save")
        assert r["data"]["shared"] is True

    def test_disabled_skill_saves_in_place(self, roots, monkeypatch, capsys):
        d = _skill(roots[2], "sleepy", disabled=True)
        with_stdin(monkeypatch, {"name": "sleepy", "description": "d2", "body": "b2"})
        _code, r = run_api(capsys, "save")
        assert r["ok"]
        assert "b2" in (d / "SKILL.md").read_text(encoding="utf-8")
        assert not (roots[2] / "sleepy").exists()

    def test_skill_without_frontmatter_gets_one(self, roots, monkeypatch, capsys):
        d = roots[2] / "bare"
        d.mkdir()
        (d / "SKILL.md").write_text("just text\n", encoding="utf-8")
        with_stdin(monkeypatch, {"name": "bare", "description": "d", "body": "b"})
        run_api(capsys, "save")
        assert sc._parse_frontmatter((d / "SKILL.md").read_text(encoding="utf-8")) == {"name": "bare", "description": "d"}

    @pytest.mark.parametrize("root_idx", [0, 1])
    def test_refuses_builtin_and_imported(self, roots, monkeypatch, capsys, root_idx):
        d = _skill(roots[root_idx], "other", desc="keep")
        with_stdin(monkeypatch, {"name": "other", "description": "x", "body": "y"})
        _code, r = run_api(capsys, "save")
        assert r["error"]["code"] == "not_editable"
        assert "keep" in (d / "SKILL.md").read_text(encoding="utf-8")

    def test_validates(self, roots, monkeypatch, capsys):
        _skill(roots[2], "mine")
        with_stdin(monkeypatch, {"name": "mine", "description": "", "body": "b"})
        _code, r = run_api(capsys, "save")
        assert r["error"]["code"] == "invalid_description"

    def test_pathlike_name(self, roots, monkeypatch, capsys):
        with_stdin(monkeypatch, {"name": "../skills/x", "description": "d", "body": "b"})
        _code, r = run_api(capsys, "save")
        assert r["error"]["code"] == "not_found"


class TestDelete:
    def test_deletes_whole_dir(self, roots, capsys):
        d = _skill(roots[2], "mine")
        (d / "run.py").write_text("x", encoding="utf-8")
        _code, r = run_api(capsys, "delete", "mine")
        assert r["ok"] and not d.exists()

    def test_disabled(self, roots, capsys):
        d = _skill(roots[2], "mine", disabled=True)
        run_api(capsys, "delete", "mine")
        assert not d.exists()

    def test_refuses_while_shared(self, roots, capsys):
        d = _skill(roots[2], "mine")
        index([("mine", "test")])
        _code, r = run_api(capsys, "delete", "mine")
        assert r["error"]["code"] == "shared" and d.exists()

    @pytest.mark.parametrize("root_idx", [0, 1])
    def test_never_touches_other_roots(self, roots, capsys, root_idx):
        d = _skill(roots[root_idx], "other")
        _code, r = run_api(capsys, "delete", "other")
        assert r["error"]["code"] == "not_editable" and d.exists()

    def test_pathlike(self, roots, capsys):
        _code, r = run_api(capsys, "delete", "..")
        assert r["error"]["code"] == "not_found"
        assert roots[2].exists()


class TestUninstall:
    def test_removes_manual_import(self, roots, capsys):
        d = _skill(roots[1], "expense")
        _code, r = run_api(capsys, "uninstall", "expense")
        assert r["ok"] and not d.exists()

    def test_disabled_import(self, roots, capsys):
        d = _skill(roots[1], "expense", disabled=True)
        run_api(capsys, "uninstall", "expense")
        assert not d.exists()

    def test_refuses_auto_synced(self, roots, monkeypatch, capsys):
        d = _skill(roots[1], "ask-portal")
        monkeypatch.setattr(sc, "SYNC_MANIFEST_PATH", roots[1] / ".catalog-sync-manifest")
        (roots[1] / ".catalog-sync-manifest").write_text(json.dumps({"ask-portal": "t"}), encoding="utf-8")
        _code, r = run_api(capsys, "uninstall", "ask-portal")
        assert r["error"]["code"] == "auto_sync" and d.exists()

    @pytest.mark.parametrize("root_idx", [0, 2])
    def test_never_touches_builtin_or_personal(self, roots, capsys, root_idx):
        d = _skill(roots[root_idx], "x1")
        _code, r = run_api(capsys, "uninstall", "x1")
        assert r["error"]["code"] == "not_found" and d.exists()


def test_local_marks_auto_synced_imports(roots, monkeypatch, capsys):
    _skill(roots[1], "ask-portal")
    _skill(roots[1], "expense")
    monkeypatch.setattr(sc, "SYNC_MANIFEST_PATH", roots[1] / ".catalog-sync-manifest")
    (roots[1] / ".catalog-sync-manifest").write_text(json.dumps({"ask-portal": "t"}), encoding="utf-8")
    _code, r = run_api(capsys, "local")
    by = {s["name"]: s for s in r["data"]["skills"]}
    assert by["ask-portal"]["auto_sync"] is True
    assert by["expense"]["auto_sync"] is False


def test_create_then_read_then_save_round_trip(roots, monkeypatch, capsys):
    with_stdin(monkeypatch, GOOD)
    run_api(capsys, "create")
    _code, r = run_api(capsys, "read", "weekly-report")
    assert r["data"]["body"] == GOOD["body"]
    assert r["data"]["description"] == GOOD["description"]
    with_stdin(monkeypatch, {"name": "weekly-report", "description": r["data"]["description"], "body": r["data"]["body"]})
    run_api(capsys, "save")
    _code, r2 = run_api(capsys, "read", "weekly-report")
    assert r2["data"]["content"] == r["data"]["content"], "save with no changes is a no-op"


# ── The real script in a child process, like the app runs it ──
# A public install (no config.toml, no Google libraries needed): the local
# ops must still work, and Japanese text on stdin must arrive intact
# whatever the console code page (Windows CI runs this too).

import os  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "setup" / "skills_catalog.py"


@pytest.fixture
def public_install(tmp_path):
    setup = tmp_path / "python" / "scripts" / "setup"
    setup.mkdir(parents=True)
    shutil.copy(_SCRIPT, setup)
    common = tmp_path / "python" / "skills" / "setup"
    common.mkdir(parents=True)
    (common / "SKILL.md").write_text("---\nname: setup\ndescription: 標準\n---\nbody\n", encoding="utf-8")
    return tmp_path


def run_script(root: Path, *args, stdin: str | None = None, env_extra=None):
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
    env.update(env_extra or {})
    r = subprocess.run(
        [sys.executable, "-I", str(root / "python" / "scripts" / "setup" / "skills_catalog.py"), "api", *args],
        input=None if stdin is None else stdin.encode("utf-8"),
        stdin=None if stdin is not None else subprocess.DEVNULL,
        capture_output=True, timeout=60, env=env, cwd=str(root),
    )
    out = r.stdout.decode("utf-8", errors="replace")
    lines = [l for l in out.splitlines() if l.startswith(sc.API_MARKER)]
    assert len(lines) == 1, out + r.stderr.decode("utf-8", errors="replace")
    return r.returncode, json.loads(lines[0][len(sc.API_MARKER):])


@pytest.mark.parametrize("env_extra", [{}, {"PYTHONIOENCODING": "utf-8"}])
def test_public_install_create_read_save_delete(public_install, env_extra):
    draft = {"name": "weekly-report", "description": "週報を作る：毎週金曜", "body": "# 週報\n\n1. 予定を集める\n"}
    code, r = run_script(public_install, "create", stdin=json.dumps(draft, ensure_ascii=False), env_extra=env_extra)
    assert code == 0 and r["ok"], r
    md = public_install / "python" / "skills-personal" / "weekly-report" / "SKILL.md"
    assert "description: 週報を作る：毎週金曜" in md.read_text(encoding="utf-8")

    code, r = run_script(public_install, "read", "weekly-report", env_extra=env_extra)
    assert r["data"]["body"] == draft["body"] and r["data"]["editable"] and r["data"]["mine"]

    code, r = run_script(public_install, "save", stdin=json.dumps({**draft, "body": "更新"}, ensure_ascii=False),
                         env_extra=env_extra)
    assert r["ok"] and r["data"]["shared"] is False
    assert md.read_text(encoding="utf-8").endswith("---\n\n更新\n")

    code, r = run_script(public_install, "local", env_extra=env_extra)
    names = {s["name"]: s for s in r["data"]["skills"]}
    assert names["weekly-report"]["mine"] and names["setup"]["root"] == "common"
    assert names["setup"]["description"] == "標準"

    code, r = run_script(public_install, "delete", "weekly-report", env_extra=env_extra)
    assert r["ok"] and not md.parent.exists()


def test_public_install_catalog_ops_still_say_no_catalog(public_install):
    for op in ("catalog", "search", "share", "import"):
        code, r = run_script(public_install, op, "x")
        assert code == 1 and r["error"]["code"] == "no_catalog", op


def test_create_without_stdin_doesnt_hang(public_install):
    code, r = run_script(public_install, "create")
    assert code == 1 and r["error"]["code"] == "invalid_name"


def test_local_ops_list_matches_what_needs_no_drive():
    assert sc.LOCAL_API_OPS <= set(sc.API_OPS)
    for op in ("catalog", "search", "info", "import", "share", "unshare"):
        assert op not in sc.LOCAL_API_OPS


def test_public_install_export_import_round_trip_japanese_path(public_install, tmp_path):
    draft = {"name": "weekly-report", "description": "週報", "body": "手順\n"}
    run_script(public_install, "create", stdin=json.dumps(draft, ensure_ascii=False))
    out_dir = tmp_path / "書き出し フォルダ"
    out_dir.mkdir()
    code, r = run_script(public_install, "export", stdin=json.dumps(
        {"skills": [{"name": "weekly-report", "root": "personal"}], "path": str(out_dir / "週報スキル")}, ensure_ascii=False))
    assert r["ok"], r
    zip_path = Path(r["data"]["path"])
    assert zip_path.name == "週報スキル.zip" and zip_path.is_file()
    run_script(public_install, "delete", "weekly-report")
    code, r = run_script(public_install, "import-file", stdin=json.dumps({"path": str(zip_path)}, ensure_ascii=False))
    assert r["ok"] and r["data"]["names"] == ["weekly-report"], r
    md = public_install / "python" / "skills-personal" / "weekly-report" / "SKILL.md"
    assert md.read_text(encoding="utf-8").endswith("手順\n")
