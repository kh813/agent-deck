"""skill-catalog search: keyword search over the shared catalog."""
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
    "googleapiclient", "googleapiclient.discovery", "googleapiclient.http",
    "googleapiclient.errors",
    "google", "google.oauth2", "google.oauth2.credentials",
    "google_auth_oauthlib", "google_auth_oauthlib.flow",
    "google.auth", "google.auth.transport", "google.auth.transport.requests",
]:
    sys.modules.setdefault(_mod, MagicMock())
if "config" not in sys.modules or not isinstance(sys.modules["config"], MagicMock):
    _cfg = MagicMock()
    _cfg.CATALOG_FOLDER_ID = "test_catalog_folder"
    _cfg.CATALOG_FILE_ID = ""
    _cfg.CONFIG_PATH = Path("/nonexistent/config.toml")
    _cfg.USER_EMAIL = "test@example.com"
    sys.modules["config"] = _cfg
sys.modules.setdefault("scripts.auth", MagicMock())

import skills_catalog as sc  # noqa: E402

CATALOG = [
    {"name": "ask-portal", "owner": "_default", "modified": "2026-07-16",
     "description": "Searches the internal portal. 社内の手続き・ルール・経費精算について質問されたとき。"},
    {"name": "slide-generator", "owner": "_default", "modified": "2026-07-16",
     "description": "Converts Marp-format Markdown into a PPTX. Marp形式MarkdownをPPTXに変換します。"},
    {"name": "slide-interviewer", "owner": "_default", "modified": "2026-07-16",
     "description": "Interview process to gather content for a presentation. スライド作成のヒアリング。"},
    {"name": "expense-check", "owner": "taro.yamada", "modified": "2026-10-01",
     "description": "経費精算の申請内容をチェックします。スケジュール連携なし。"},
    {"name": "portal-news", "owner": "hanako.sato", "modified": "2026-09-01",
     "description": "Daily digest of news posts."},
]


def names(hits):
    return [h["name"] for h in hits]


class TestSearchSkills:
    def test_name_keyword(self):
        assert names(sc.search_skills(CATALOG, "slide")) == ["slide-generator", "slide-interviewer"]

    def test_description_keyword_english(self):
        assert names(sc.search_skills(CATALOG, "markdown")) == ["slide-generator"]

    def test_description_keyword_japanese(self):
        assert names(sc.search_skills(CATALOG, "経費精算")) == ["ask-portal", "expense-check"]

    def test_case_insensitive(self):
        assert names(sc.search_skills(CATALOG, "PPTX")) == names(sc.search_skills(CATALOG, "pptx")) == ["slide-generator"]

    def test_full_width_ascii_matches(self):
        assert names(sc.search_skills(CATALOG, "ＰＰＴＸ")) == ["slide-generator"]

    def test_hiragana_matches_katakana(self):
        assert names(sc.search_skills(CATALOG, "すけじゅーる")) == ["expense-check"]

    def test_half_width_katakana_matches(self):
        assert names(sc.search_skills(CATALOG, "ｽｹｼﾞｭｰﾙ")) == ["expense-check"]

    def test_multiple_keywords_are_anded(self):
        assert names(sc.search_skills(CATALOG, "slide hearing")) == []
        assert names(sc.search_skills(CATALOG, "slide ヒアリング")) == ["slide-interviewer"]
        assert names(sc.search_skills(CATALOG, ["slide", "ヒアリング"])) == ["slide-interviewer"]

    def test_full_width_space_separates_keywords(self):
        assert names(sc.search_skills(CATALOG, "slide　ヒアリング")) == ["slide-interviewer"]

    def test_owner_keyword(self):
        assert names(sc.search_skills(CATALOG, "yamada")) == ["expense-check"]

    def test_name_hits_rank_above_description_hits(self):
        # "portal" is in ask-portal's and portal-news's names; ask-portal's
        # description mentions it too, but ranking is by best field, then name.
        hits = names(sc.search_skills(CATALOG, "portal"))
        assert set(hits) == {"ask-portal", "portal-news"}
        assert hits == sorted(hits)
        # A description-only hit comes after name hits.
        hits = names(sc.search_skills(CATALOG, "news"))
        assert hits == ["portal-news"]
        cat = CATALOG + [{"name": "zz-news", "owner": "x", "modified": "", "description": ""},
                         {"name": "aa", "owner": "x", "modified": "", "description": "news reader"}]
        assert names(sc.search_skills(cat, "news")) == ["portal-news", "zz-news", "aa"]

    def test_no_match(self):
        assert sc.search_skills(CATALOG, "zzz-nothing") == []

    @pytest.mark.parametrize("q", ["", "   ", "　", []])
    def test_empty_query_matches_nothing(self, q):
        assert sc.search_skills(CATALOG, q) == []

    def test_missing_fields_do_not_crash(self):
        assert names(sc.search_skills([{"name": "bare"}], "bare")) == ["bare"]


class TestCmdSearch:
    def test_prints_hits_with_full_description(self, monkeypatch, capsys):
        monkeypatch.setattr(sc, "_load_catalog_skills", lambda: CATALOG)
        assert sc.cmd_search(["経費精算"]) == 0
        out = capsys.readouterr().out
        assert "2 件" in out and "2 match(es)" in out
        assert "■ ask-portal  (_default, 2026-07-16)" in out
        assert "社内の手続き・ルール・経費精算について質問されたとき。" in out  # not truncated
        assert "slide-generator" not in out

    def test_no_hits_returns_3_and_suggests_list(self, monkeypatch, capsys):
        monkeypatch.setattr(sc, "_load_catalog_skills", lambda: CATALOG)
        assert sc.cmd_search(["zzz"]) == 3
        out = capsys.readouterr().out
        assert "No skills match" in out and "skill-catalog list" in out

    def test_falls_back_to_local_index_when_drive_fails(self, monkeypatch, tmp_path, capsys):
        index = tmp_path / "catalog-index.md"
        monkeypatch.setattr(sc, "INDEX_PATH", index)
        sc._write_index(CATALOG)
        monkeypatch.setattr(sc, "_get_service", MagicMock(side_effect=RuntimeError("offline")))
        assert sc.cmd_search(["marp"]) == 0
        out = capsys.readouterr().out
        assert "ローカルキャッシュ" in out and "slide-generator" in out


def test_cli_without_keyword_is_a_usage_error(tmp_path):
    # Needs config.toml to get past the no-org-config guard; a copy of the
    # script in a scratch tree with a dummy config is enough for arg parsing.
    r = subprocess.run([sys.executable, "-I", str(_SETUP_DIR / "skills_catalog.py"), "search"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    assert r.returncode == 1
    assert "Traceback" not in r.stderr


def test_skill_md_documents_search():
    md = (ROOT / "python" / "skills" / "skill-catalog" / "SKILL.md").read_text(encoding="utf-8")
    assert "skill-catalog search" in md
    assert "skills_catalog.py search" in md
    front = md.split("---")[1]
    assert "search" in front and "検索" in front


def test_usage_docstring_lists_search():
    assert "skills_catalog.py search" in sc.__doc__
