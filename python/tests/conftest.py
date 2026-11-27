"""Shared test isolation."""
import sys

import pytest


@pytest.fixture(autouse=True)
def _isolate_catalog_identity(tmp_path, monkeypatch):
    """skills_catalog remembers the catalog's Google account in the real
    home folder; tests must never read (or write) that file."""
    sc = sys.modules.get("skills_catalog")
    if sc is not None and hasattr(sc, "IDENTITY_PATH"):
        monkeypatch.setattr(sc, "IDENTITY_PATH", tmp_path / "catalog-identity.json")
    yield


@pytest.fixture(autouse=True)
def _no_writes_to_the_real_home(tmp_path, monkeypatch):
    """In-process code that writes under the user's home (e.g. setup.py's
    install_agy_guard_hook -> ~/.gemini/config/hooks.json, reached through
    skills_rebuild) must land in a scratch folder during tests. 2026-11-26:
    two tests did write the real file before this existed."""
    import pathlib
    fake_home = tmp_path / "_home"
    fake_home.mkdir(exist_ok=True)
    monkeypatch.setattr(pathlib.Path, "home", classmethod(lambda cls: fake_home))
    yield
