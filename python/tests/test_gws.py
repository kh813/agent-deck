"""
Tests for setup.py's setup_gws(): stages the gws (Google Workspace CLI --
https://github.com/googleworkspace/cli, NOT an official Google product)
binary and its client_secret.json based on config.toml's [gws] enabled
toggle, reusing the existing [oauth] client_id/client_secret.

Mocks ensure_gws_installed() throughout -- it does a real network download,
which no test in this repo exercises (see test_diagram_generator.py's note
on ensure_marp.py, which is likewise untested for the same reason).

Run:
  pytest python/tests/test_gws.py -v
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))

spec = importlib.util.spec_from_file_location(
    "agent_setup_gws", ROOT / "python" / "scripts" / "setup" / "setup.py"
)
agent_setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_setup)

_ENTRY = {
    "installed": {
        "client_id": "id123",
        "project_id": "proj-x",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": "secret456",
        "redirect_uris": ["http://localhost"],
    }
}


def _write_config(tmp_path, enabled, client_id="id123", client_secret="secret456", project_id="proj-x"):
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        f'[oauth]\nclient_id = "{client_id}"\nclient_secret = "{client_secret}"\n'
        f'project_id = "{project_id}"\n\n'
        f'[gws]\nenabled = {"true" if enabled else "false"}\n',
        encoding="utf-8",
    )
    return config_path


@pytest.fixture(autouse=True)
def _fake_config_dir(tmp_path, monkeypatch):
    config_dir = tmp_path / "gws-config"
    monkeypatch.setattr(agent_setup, "_GWS_CONFIG_DIR", config_dir)
    return config_dir


@pytest.fixture(autouse=True)
def _mock_ensure_gws(monkeypatch):
    """Never touch the network in tests -- see module docstring."""
    monkeypatch.setattr(agent_setup, "ensure_gws_installed", lambda: True)


class TestSetupGws:
    def test_registers_client_secret_when_enabled(self, tmp_path, monkeypatch, _fake_config_dir):
        config_path = _write_config(tmp_path, enabled=True)
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", config_path)

        agent_setup.setup_gws()

        secret = json.loads((_fake_config_dir / "client_secret.json").read_text(encoding="utf-8"))
        assert secret == _ENTRY
        assert (_fake_config_dir / agent_setup._GWS_MANAGED_MARKER).exists()

    def test_defaults_project_id_placeholder_when_unset(self, tmp_path, monkeypatch, _fake_config_dir):
        config_path = _write_config(tmp_path, enabled=True, project_id="")
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", config_path)

        agent_setup.setup_gws()

        secret = json.loads((_fake_config_dir / "client_secret.json").read_text(encoding="utf-8"))
        assert secret["installed"]["project_id"] == "agent-deck"

    def test_does_nothing_when_disabled_and_no_existing_file(self, tmp_path, monkeypatch, _fake_config_dir):
        config_path = _write_config(tmp_path, enabled=False)
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", config_path)

        agent_setup.setup_gws()

        assert not (_fake_config_dir / "client_secret.json").exists()

    def test_removes_managed_client_secret_when_toggled_off(self, tmp_path, monkeypatch, _fake_config_dir):
        _fake_config_dir.mkdir(parents=True)
        (_fake_config_dir / "client_secret.json").write_text(json.dumps(_ENTRY), encoding="utf-8")
        (_fake_config_dir / agent_setup._GWS_MANAGED_MARKER).write_text("", encoding="utf-8")

        config_path = _write_config(tmp_path, enabled=False)
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", config_path)

        agent_setup.setup_gws()

        assert not (_fake_config_dir / "client_secret.json").exists()
        assert not (_fake_config_dir / agent_setup._GWS_MANAGED_MARKER).exists()

    def test_does_not_touch_unmanaged_client_secret(self, tmp_path, monkeypatch, _fake_config_dir):
        """A file the user created themselves via `gws auth setup` (no marker)
        must survive both enabling and disabling our toggle untouched."""
        _fake_config_dir.mkdir(parents=True)
        own_content = json.dumps({"installed": {"client_id": "users-own-real-client"}})
        (_fake_config_dir / "client_secret.json").write_text(own_content, encoding="utf-8")

        config_path = _write_config(tmp_path, enabled=True)
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", config_path)

        agent_setup.setup_gws()

        assert (_fake_config_dir / "client_secret.json").read_text(encoding="utf-8") == own_content
        assert not (_fake_config_dir / agent_setup._GWS_MANAGED_MARKER).exists()

    def test_skips_when_enabled_but_oauth_not_configured(self, tmp_path, monkeypatch, _fake_config_dir):
        config_path = _write_config(tmp_path, enabled=True, client_id="", client_secret="")
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", config_path)

        agent_setup.setup_gws()

        assert not (_fake_config_dir / "client_secret.json").exists()

    def test_idempotent_does_not_rewrite_or_reinstall_when_up_to_date(self, tmp_path, monkeypatch, _fake_config_dir):
        _fake_config_dir.mkdir(parents=True)
        secret_path = _fake_config_dir / "client_secret.json"
        secret_path.write_text(json.dumps(_ENTRY), encoding="utf-8")
        (_fake_config_dir / agent_setup._GWS_MANAGED_MARKER).write_text("", encoding="utf-8")
        mtime_before = secret_path.stat().st_mtime_ns

        calls = []
        monkeypatch.setattr(agent_setup, "ensure_gws_installed", lambda: calls.append(1) or True)

        config_path = _write_config(tmp_path, enabled=True)
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", config_path)

        agent_setup.setup_gws()

        assert secret_path.stat().st_mtime_ns == mtime_before
        assert calls == []  # never re-downloads gws just to refresh an unchanged file

    def test_noop_when_config_toml_missing(self, tmp_path, monkeypatch, _fake_config_dir):
        monkeypatch.setattr(agent_setup, "CONFIG_PATH", tmp_path / "does-not-exist.toml")

        agent_setup.setup_gws()  # must not raise

        assert not (_fake_config_dir / "client_secret.json").exists()


class TestConfigTemplateDeclaresGwsSection:
    def test_template_has_toggle_and_project_id(self):
        template = (ROOT / "config" / "config.toml.template").read_text(encoding="utf-8")
        assert "[gws]" in template
        assert "enabled" in template
        assert "project_id" in template
