"""skills_catalog.py api export / import-file: moving skills as files.
Round trips, every archive layout we accept, conflicts, and the safety
checks (zip-slip, size caps, bad names) -- the file can come from anyone."""
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_skills_catalog_api import _skill, roots, run_api, sc  # noqa: E402,F401


def with_stdin(monkeypatch, obj):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(obj, ensure_ascii=False)))


def export(monkeypatch, capsys, path, *skills):
    with_stdin(monkeypatch, {"skills": list(skills), "path": str(path)})
    return run_api(capsys, "export")


def import_file(monkeypatch, capsys, path, overwrite=False):
    with_stdin(monkeypatch, {"path": str(path), "overwrite": overwrite})
    return run_api(capsys, "import-file")


def make_zip(path: Path, files: dict) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for name, text in files.items():
            zf.writestr(name, text)
    return path


MD = "---\nname: {n}\ndescription: 説明 {n}\n---\n\n手順\n"


class TestExport:
    def test_single_skill_zip_has_skill_md_at_root(self, roots, monkeypatch, capsys, tmp_path):
        d = _skill(roots[2], "mine", desc="私の")
        (d / "scripts").mkdir()
        (d / "scripts" / "run.py").write_text("print(1)", encoding="utf-8")
        (d / "__pycache__").mkdir()
        (d / "__pycache__" / "x.pyc").write_bytes(b"x")
        code, r = export(monkeypatch, capsys, tmp_path / "out" / "mine", {"name": "mine", "root": "personal"})
        assert code == 1  # folder "out" doesn't exist
        (tmp_path / "out").mkdir()
        code, r = export(monkeypatch, capsys, tmp_path / "out" / "mine", "mine")
        assert r["ok"], r
        assert r["data"]["path"].endswith("mine.zip") and r["data"]["names"] == ["mine"]
        with zipfile.ZipFile(r["data"]["path"]) as zf:
            assert sorted(zf.namelist()) == ["SKILL.md", "scripts/run.py"]
        assert not list((tmp_path / "out").glob("*.tmp"))

    def test_several_skills_one_folder_each(self, roots, monkeypatch, capsys, tmp_path):
        _skill(roots[2], "a1")
        _skill(roots[2], "b2", disabled=True)
        _skill(roots[1], "imported")
        _code, r = export(monkeypatch, capsys, tmp_path / "all.zip", "a1", "b2", {"name": "imported", "root": "catalog"})
        assert r["ok"], r
        with zipfile.ZipFile(tmp_path / "all.zip") as zf:
            assert sorted(zf.namelist()) == ["a1/SKILL.md", "b2/SKILL.md", "imported/SKILL.md"]

    def test_builtin_and_unknown_refused(self, roots, monkeypatch, capsys, tmp_path):
        _skill(roots[0], "builtin")
        for n in ("builtin", "nope", "../x"):
            _code, r = export(monkeypatch, capsys, tmp_path / "x.zip", n)
            assert r["error"]["code"] == "not_found", n
        assert not (tmp_path / "x.zip").exists()

    def test_usage(self, roots, monkeypatch, capsys, tmp_path):
        _skill(roots[2], "a1")
        assert export(monkeypatch, capsys, tmp_path / "x.zip")[1]["error"]["code"] == "usage"
        with_stdin(monkeypatch, {"skills": ["a1"], "path": ""})
        assert run_api(capsys, "export")[1]["error"]["code"] == "usage"
        assert export(monkeypatch, capsys, tmp_path / "x.zip", "a1", "a1")[1]["error"]["code"] == "usage"

    def test_overwrites_existing_file(self, roots, monkeypatch, capsys, tmp_path):
        _skill(roots[2], "a1")
        (tmp_path / "x.zip").write_text("old", encoding="utf-8")
        _code, r = export(monkeypatch, capsys, tmp_path / "x.zip", "a1")
        assert r["ok"] and zipfile.is_zipfile(tmp_path / "x.zip")


class TestImport:
    def test_round_trip_keeps_files_and_frontmatter(self, roots, monkeypatch, capsys, tmp_path):
        d = _skill(roots[2], "mine", desc="私の", email="test@example.com")
        (d / "run.py").write_text("print('日本語')", encoding="utf-8")
        export(monkeypatch, capsys, tmp_path / "mine.zip", "mine")
        original = (d / "SKILL.md").read_bytes()
        import shutil
        shutil.rmtree(d)
        _code, r = import_file(monkeypatch, capsys, tmp_path / "mine.zip")
        assert r["ok"] and r["data"]["names"] == ["mine"], r
        assert (roots[2] / "mine" / "SKILL.md").read_bytes() == original
        assert (roots[2] / "mine" / "run.py").read_text(encoding="utf-8") == "print('日本語')"

    def test_multi_skill_round_trip(self, roots, monkeypatch, capsys, tmp_path):
        _skill(roots[2], "a1")
        _skill(roots[2], "b2")
        export(monkeypatch, capsys, tmp_path / "all.zip", "a1", "b2")
        _code, r = import_file(monkeypatch, capsys, tmp_path / "all.zip", overwrite=True)
        assert r["data"]["names"] == ["a1", "b2"] and r["data"]["overwrote"] == ["a1", "b2"]

    @pytest.mark.parametrize("files,expected", [
        ({"SKILL.md": MD.format(n="flat")}, ["flat"]),
        ({"weekly/SKILL.md": MD.format(n="weekly"), "weekly/x.py": "1"}, ["weekly"]),  # Finder/Explorer "compress folder"
        ({"backup/a1/SKILL.md": MD.format(n="a1"), "backup/b2/SKILL.md": MD.format(n="b2")}, ["a1", "b2"]),  # wrapped
        ({"SKILL.md": "---\ndescription: no name\n---\nx"}, ["from-file"]),  # name from the file name
        ({"__MACOSX/._SKILL.md": "junk", "SKILL.md": MD.format(n="flat"), ".DS_Store": "x"}, ["flat"]),
    ])
    def test_layouts(self, roots, monkeypatch, capsys, tmp_path, files, expected):
        _code, r = import_file(monkeypatch, capsys, make_zip(tmp_path / "From-File.zip", files))
        assert r["ok"], r
        assert r["data"]["names"] == expected
        for n in expected:
            assert (roots[2] / n / "SKILL.md").exists()
        assert not (roots[2] / "flat" / "__MACOSX").exists()

    def test_bare_markdown(self, roots, monkeypatch, capsys, tmp_path):
        p = tmp_path / "Note.md"
        p.write_text("\ufeff---\nname: note-skill\ndescription: メモ\n---\nbody", encoding="utf-8")
        _code, r = import_file(monkeypatch, capsys, p)
        assert r["data"]["names"] == ["note-skill"]
        assert (roots[2] / "note-skill" / "SKILL.md").read_text(encoding="utf-8").startswith("---\nname: note-skill")

    def test_skill_md_named_after_its_folder(self, roots, monkeypatch, capsys, tmp_path):
        (tmp_path / "my-folder").mkdir()
        p = tmp_path / "my-folder" / "SKILL.md"
        p.write_text("---\ndescription: d\n---\nbody", encoding="utf-8")
        _code, r = import_file(monkeypatch, capsys, p)
        assert r["data"]["names"] == ["my-folder"]

    def test_conflict_asks_then_overwrites_including_disabled_copy(self, roots, monkeypatch, capsys, tmp_path):
        old = _skill(roots[2], "flat", desc="old", disabled=True)
        z = make_zip(tmp_path / "f.zip", {"SKILL.md": MD.format(n="flat")})
        _code, r = import_file(monkeypatch, capsys, z)
        assert r["error"]["code"] == "exists" and r["error"]["names"] == ["flat"]
        assert "old" in (old / "SKILL.md").read_text(encoding="utf-8")
        _code, r = import_file(monkeypatch, capsys, z, overwrite=True)
        assert r["ok"] and r["data"]["overwrote"] == ["flat"]
        assert not old.exists()
        assert "説明 flat" in (roots[2] / "flat" / "SKILL.md").read_text(encoding="utf-8")

    def test_reports_shadowing(self, roots, monkeypatch, capsys, tmp_path):
        _skill(roots[0], "setup")
        _code, r = import_file(monkeypatch, capsys, make_zip(tmp_path / "s.zip", {"SKILL.md": MD.format(n="setup")}))
        assert r["data"]["shadowed"] == ["setup"]

    @pytest.mark.parametrize("files", [
        {"../evil/SKILL.md": MD.format(n="evil")},
        {"SKILL.md": MD.format(n="ok-name"), "../../outside.txt": "x"},
        {"SKILL.md": MD.format(n="ok-name"), "/abs.txt": "x"},
        {"SKILL.md": MD.format(n="ok-name"), "C:/x.txt": "x"},
    ])
    def test_zip_slip_refused_and_nothing_written(self, roots, monkeypatch, capsys, tmp_path, files):
        _code, r = import_file(monkeypatch, capsys, make_zip(tmp_path / "bad.zip", files))
        assert r["error"]["code"] == "invalid_file"
        assert not any(roots[2].iterdir())
        assert not (tmp_path / "outside.txt").exists()

    @pytest.mark.parametrize("files,code_", [
        ({"SKILL.md": "---\nname: Bad Name\ndescription: d\n---\n"}, "invalid_name"),
        ({"SKILL.md": "---\nname: disabled\ndescription: d\n---\n"}, "invalid_name"),
        ({"SKILL.md": "---\nname: no-desc\n---\n"}, "invalid_file"),
        ({"readme.txt": "no skill"}, "invalid_file"),
    ])
    def test_invalid_content(self, roots, monkeypatch, capsys, tmp_path, files, code_):
        _code, r = import_file(monkeypatch, capsys, make_zip(tmp_path / "x.zip", files))
        assert r["error"]["code"] == code_
        assert not any(roots[2].iterdir())

    def test_not_a_zip_wrong_type_missing(self, roots, monkeypatch, capsys, tmp_path):
        (tmp_path / "fake.zip").write_text("nope", encoding="utf-8")
        assert import_file(monkeypatch, capsys, tmp_path / "fake.zip")[1]["error"]["code"] == "invalid_file"
        (tmp_path / "x.txt").write_text("x", encoding="utf-8")
        assert import_file(monkeypatch, capsys, tmp_path / "x.txt")[1]["error"]["code"] == "invalid_file"
        assert import_file(monkeypatch, capsys, tmp_path / "none.zip")[1]["error"]["code"] == "not_found"

    def test_size_caps(self, roots, monkeypatch, capsys, tmp_path):
        monkeypatch.setattr(sc, "IMPORT_MAX_FILES", 3)
        files = {"SKILL.md": MD.format(n="big"), **{f"f{i}.txt": "x" for i in range(3)}}
        assert import_file(monkeypatch, capsys, make_zip(tmp_path / "many.zip", files))[1]["error"]["code"] == "too_large"
        monkeypatch.setattr(sc, "IMPORT_MAX_FILES", 2000)
        monkeypatch.setattr(sc, "IMPORT_MAX_BYTES", 100)
        files = {"SKILL.md": MD.format(n="big"), "blob.bin": "x" * 200}
        assert import_file(monkeypatch, capsys, make_zip(tmp_path / "big.zip", files))[1]["error"]["code"] == "too_large"
        assert not any(roots[2].iterdir())

    def test_someone_elses_skill_stays_theirs(self, roots, monkeypatch, capsys, tmp_path):
        md = "---\nname: theirs\ndescription: d\nemail: taro@example.com\n---\nx"
        import_file(monkeypatch, capsys, make_zip(tmp_path / "t.zip", {"SKILL.md": md}))
        _code, r = run_api(capsys, "local")
        s = next(x for x in r["data"]["skills"] if x["name"] == "theirs")
        assert s["root"] == "personal" and s["mine"] is False  # no share button for it


def test_export_import_are_local_ops():
    assert {"export", "import-file"} <= sc.LOCAL_API_OPS
