"""Multi-session safety wiring that only shows in the built app (5.7.4)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_notification_plugin_registered_and_permitted():
    lib = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
    assert ".plugin(tauri_plugin_notification::init())" in lib
    caps = json.loads((ROOT / "src-tauri" / "capabilities" / "default.json").read_text(encoding="utf-8"))
    assert "notification:default" in caps["permissions"]
    assert 'tauri-plugin-notification = "2"' in (ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")


def test_sessions_get_their_identity_and_own_tmp():
    pty = (ROOT / "src-tauri" / "src" / "pty.rs").read_text(encoding="utf-8")
    for var in ("AGENT_DECK_SESSION_ID", "AGENT_DECK_ROOT", "AGENT_DECK_TMP"):
        assert f'cmd.env("{var}"' in pty, var
    assert 'project_root.join("tmp").join("sessions").join(&session_id)' in pty


def test_registry_command_registered():
    lib = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
    assert "pty::set_session_registry" in lib
