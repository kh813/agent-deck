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
