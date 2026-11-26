"""The guard hook both engines run before writing files (5.7.4).
Confirmed for real 2026-11-26 with agy and Claude Code: a write into another
tab's folder is refused, a write inside the tab's folder goes through."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "python" / "scripts" / "hooks" / "agent_deck_guard.py"
sys.path.insert(0, str(SCRIPT.parent))
import agent_deck_guard as g  # noqa: E402

sys.path.insert(0, str(ROOT / "python" / "scripts" / "setup"))


@pytest.fixture
def world(tmp_path):
    root, me, other, outside = (tmp_path / n for n in ("install", "proj-a", "proj-b", "elsewhere"))
    for d in (root / "tmp", me, other, outside):
        d.mkdir(parents=True)
    (root / "tmp" / g.REGISTRY_NAME).write_text(json.dumps({"sessions": [
        {"id": "main", "label": "アプリの場所", "cwd": str(root)},
        {"id": "tab-a", "label": "A", "cwd": str(me)},
        {"id": "tab-b", "label": "レポート", "cwd": str(other)},
    ]}), encoding="utf-8")
    env = {"AGENT_DECK_SESSION_ID": "tab-a", "AGENT_DECK_ROOT": str(root)}
    return root, me, other, outside, env


def agy_input(tool, path, cwd, workspaces=()):
    return json.dumps({"toolCall": {"name": tool, "args": {"TargetFile": str(path), "CodeContent": "x"}},
                       "cwd": str(cwd), "workspacePaths": [str(w) for w in workspaces]})


def claude_input(tool, path, cwd):
    return json.dumps({"tool_name": tool, "tool_input": {"file_path": str(path), "content": "x"}, "cwd": str(cwd)})


class TestDecisions:
    def test_other_tab_folder_is_denied_both_engines(self, world):
        root, me, other, _, env = world
        out = json.loads(g.run("agy", agy_input("write_file", other / "x.txt", me), env))
        assert out["decision"] == "deny" and "レポート" in out["reason"]
        out = json.loads(g.run("claude", claude_input("Edit", other / "sub" / "x.txt", me), env))
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_own_folder_and_install_folder_pass_silently(self, world):
        root, me, _, _, env = world
        # agy treats any output -- even {} -- as a denial: no opinion = no output
        assert g.run("agy", agy_input("write_to_file", me / "a.txt", me), env) == ""
        assert g.run("agy", agy_input("write_file", root / "files" / "a.txt", me), env) == ""
        assert g.run("claude", claude_input("Write", me / "deep" / "a.txt", me), env) == ""

    def test_install_folder_is_shared_even_when_a_tab_works_there(self, world):
        root, me, _, _, env = world
        # main tab's folder is the install root; other tabs still use files/, tmp/
        assert g.run("agy", agy_input("write_file", root / "tmp" / "x", me), env) == ""

    def test_outside_asks(self, world):
        _, me, _, outside, env = world
        out = json.loads(g.run("agy", agy_input("write_file", outside / "x.txt", me), env))
        assert out["decision"] == "force_ask"  # never reuses an earlier "always allow"
        out = json.loads(g.run("claude", claude_input("Write", outside / "x.txt", me), env))
        assert out["hookSpecificOutput"]["permissionDecision"] == "ask"

    def test_agy_workspace_folders_count_as_inside(self, world):
        _, me, _, outside, env = world
        assert g.run("agy", agy_input("write_file", outside / "x", me, workspaces=[outside]), env) == ""

    def test_relative_paths_resolve_against_cwd(self, world):
        _, me, other, _, env = world
        rel = os.path.relpath(other / "x.txt", me)
        assert json.loads(g.run("claude", claude_input("Write", rel, me), env))["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_apply_patch_paths_are_checked(self, world):
        _, me, other, _, env = world
        patch = f"*** Begin Patch\n*** Update File: {other / 'f.py'}\n@@\n-a\n+b\n*** End Patch"
        data = json.dumps({"toolCall": {"name": "apply_patch", "args": {"input": patch}}, "cwd": str(me)})
        assert json.loads(g.run("agy", data, env))["decision"] == "deny"

    def test_symlink_into_another_tab_is_caught(self, world, tmp_path):
        if sys.platform == "win32":
            pytest.skip("symlinks need privileges on Windows")
        _, me, other, _, env = world
        link = me / "shortcut"
        link.symlink_to(other)
        assert json.loads(g.run("agy", agy_input("write_file", link / "x.txt", me), env))["decision"] == "deny"

    def test_tilde_paths_cannot_bypass_guard(self, world, monkeypatch):
        _, me, other, _, env = world
        monkeypatch.setenv("HOME", str(other.parent))
        monkeypatch.setenv("USERPROFILE", str(other.parent))
        # ~/proj-b/x.txt must expand to other/x.txt (not me/~/proj-b/x.txt)
        out = json.loads(g.run("agy", agy_input("write_file", "~/proj-b/x.txt", me), env))
        assert out["decision"] == "deny"
        out = json.loads(g.run("claude", claude_input("Write", "~/.ssh/authorized_keys", me), env))
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_apply_patch_move_to_is_checked(self, world):
        _, me, other, _, env = world
        patch = f"*** Begin Patch\n*** Update File: {me / 'f.py'}\n*** Move to: {other / 'f.py'}\n@@\n-a\n+b\n*** End Patch"
        data = json.dumps({"toolCall": {"name": "apply_patch", "args": {"input": patch}}, "cwd": str(me)})
        assert json.loads(g.run("agy", data, env))["decision"] == "deny"

    def test_protected_install_paths_denied_even_from_root_tab(self, world):
        root, me, _, _, env = world
        root_env = {"AGENT_DECK_SESSION_ID": "main", "AGENT_DECK_ROOT": str(root)}
        protected = [
            root / "tmp" / g.REGISTRY_NAME,
            root / "tmp" / "screenshots" / "shot.png",
            root / "tmp" / "sessions" / "tab-b" / "out.txt",
            root / "python" / "scripts" / "hooks" / "agent_deck_guard.py",
            root / "python" / "skills" / "attendance" / "SKILL.md",
            root / "agent_config.json",
            root / "AGENTS.md",
            root / "config" / "config.toml",
            root / ".claude" / "agent-deck-settings.json",
        ]
        for target in protected:
            out = json.loads(g.run("agy", agy_input("write_file", target, me), env))
            assert out["decision"] == "deny", f"expected deny from tab-a for {target}"
            out_main = json.loads(g.run("claude", claude_input("Write", target, root), root_env))
            assert out_main["hookSpecificOutput"]["permissionDecision"] == "deny", f"expected deny from main for {target}"
        # Allowed install subdirs remain writable; screenshots stay readable
        assert g.run("agy", agy_input("write_file", root / "files" / "ok.txt", me), env) == ""
        assert g.run("agy", agy_input("write_file", root / "tmp" / "sessions" / "tab-a" / "ok.txt", me), env) == ""
        assert g.run("agy", agy_input("write_file", root / "python" / "skills-personal" / "mine" / "SKILL.md", me), env) == ""
        assert g.run("agy", agy_input("read_file", root / "tmp" / "screenshots" / "shot.png", me), env) == ""

    def test_sensitive_and_system_paths_denied(self, world, monkeypatch, tmp_path):
        root, me, _, _, env = world
        fake_home = tmp_path / "home"
        (fake_home / ".ssh").mkdir(parents=True)
        (fake_home / ".gemini" / "config").mkdir(parents=True)
        (fake_home / ".gemini" / "skills" / "demo").mkdir(parents=True)
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.setenv("USERPROFILE", str(fake_home))

        # agy read & write on credentials / hooks.json denied
        assert json.loads(g.run("agy", agy_input("read_file", fake_home / ".ssh" / "id_rsa", me), env))["decision"] == "deny"
        assert json.loads(g.run("agy", agy_input("write_file", fake_home / ".gemini" / "config" / "hooks.json", me), env))["decision"] == "deny"
        assert json.loads(g.run("agy", agy_input("read_file", root / "python" / "scripts" / "automation" / "ChromeUserData" / "Default" / "Cookies", me), env))["decision"] == "deny"
        # reading installed skills under ~/.gemini/skills/ is still allowed
        assert g.run("agy", agy_input("read_file", fake_home / ".gemini" / "skills" / "demo" / "SKILL.md", me), env) == ""
        # Windows AppData/Roaming is denied, while AppData/Local/Temp (OS temp) is not treated as credential dir
        assert g.is_sensitive_path(str(fake_home / "AppData" / "Roaming" / "secret.json"), "read", True)
        assert not g.is_sensitive_path(str(fake_home / "AppData" / "Local" / "Temp" / "work" / "ok.txt"), "write", True)
        # system directories denied
        assert json.loads(g.run("agy", agy_input("write_file", "/etc/hosts", me), env))["decision"] == "deny"
        assert g.is_system_write_path("C:/Windows/System32/drivers/etc/hosts", True)

    def test_shell_tool_guards_bypass_attempts_without_blocking_skills(self, world):
        root, me, other, _, env = world

        def bash(cmd):
            return json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": str(me)})

        def agy_sh(cmd):
            return json.dumps({"toolCall": {"name": "run_shell_command", "args": {"command": cmd}}, "cwd": str(me)})

        # Guard & registry tampering denied
        assert json.loads(g.run("claude", bash(f"rm {root / 'tmp' / g.REGISTRY_NAME}"), env))["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert json.loads(g.run("agy", agy_sh("cat ~/.gemini/config/hooks.json"), env))["decision"] == "deny"
        # Sensitive files denied
        assert json.loads(g.run("claude", bash("cat ~/.ssh/id_rsa"), env))["hookSpecificOutput"]["permissionDecision"] == "deny"
        # Another tab's folder denied
        assert json.loads(g.run("claude", bash(f"echo hi > {other / 'pwn.txt'}"), env))["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert json.loads(g.run("agy", agy_sh(f"cp a.txt {other / 'a.txt'}"), env))["decision"] == "deny"
        # Mutating protected install files denied
        assert json.loads(g.run("claude", bash(f"echo bad > {root / 'AGENTS.md'}"), env))["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert json.loads(g.run("agy", agy_sh(f"rm {root / 'python' / 'scripts' / 'setup' / 'setup.py'}"), env))["decision"] == "deny"
        # Normal skill execution (including redirecting stdout into own folder) passes!
        assert g.run("claude", bash(f'python3 "{root}/python/scripts/automation/automate.py" calendar > out.txt'), env) == ""
        assert g.run("agy", agy_sh(f'python3 "{root}/python/scripts/automation/automate.py" calendar'), env) == ""


class TestOnlyInsideAgentDeck:
    def test_no_session_env_no_opinion(self, world):
        _, me, other, _, _ = world
        assert g.run("agy", agy_input("write_file", other / "x", me), {}) == ""
        assert g.run("claude", claude_input("Write", other / "x", me), {}) == ""

    def test_non_write_tools_ignored(self, world):
        _, me, other, _, env = world
        assert g.run("agy", agy_input("view_file", other / "x", me), env) == ""
        assert g.run("claude", claude_input("Read", other / "x", me), env) == ""

    def test_broken_input_never_blocks(self, world):
        *_, env = world
        assert g.run("agy", "{not json", env) == ""
        assert g.run("claude", "", env) == ""

    def test_no_registry_still_guards_the_folder(self, world, tmp_path):
        root, me, _, outside, env = world
        (root / "tmp" / g.REGISTRY_NAME).unlink()
        assert json.loads(g.run("agy", agy_input("write_file", outside / "x", me), env))["decision"] == "force_ask"


def test_case_rules(tmp_path):
    a = tmp_path / "Proj"
    assert g.is_within(str(a / "x"), str(a), False)
    assert not g.is_within(str(tmp_path / "Project" / "x"), str(a), False)
    assert g.is_within(str(a).lower() + "/x", str(a), True)


def test_real_script_in_a_subprocess(world):
    """As the engines run it: stdin JSON in, decision JSON out (UTF-8)."""
    _, me, other, _, env = world
    r = subprocess.run([sys.executable, str(SCRIPT), "--engine", "claude"],
                       input=claude_input("Write", other / "x.txt", me).encode("utf-8"),
                       capture_output=True, env={**os.environ, **env}, timeout=30)
    assert r.returncode == 0
    out = json.loads(r.stdout.decode("utf-8"))
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "レポート" in out["hookSpecificOutput"]["permissionDecisionReason"]
    r = subprocess.run([sys.executable, str(SCRIPT), "--engine", "agy"],
                       input=agy_input("write_file", me / "ok.txt", me).encode("utf-8"),
                       capture_output=True, env={**os.environ, **env}, timeout=30)
    assert r.returncode == 0 and r.stdout == b""


class TestInstall:
    def test_agy_hook_merged_without_touching_others(self, tmp_path):
        import setup as agent_setup
        hooks = tmp_path / "hooks.json"
        hooks.write_text(json.dumps({"mine": {"PreToolUse": [{"matcher": "run_command", "hooks": [{"command": "x"}]}]}}), encoding="utf-8")
        agent_setup.install_agy_guard_hook(project_root=tmp_path, hooks_path=hooks)
        agent_setup.install_agy_guard_hook(project_root=tmp_path, hooks_path=hooks)  # idempotent
        data = json.loads(hooks.read_text(encoding="utf-8"))
        assert set(data) == {"mine", agent_setup.GUARD_HOOK_NAME}
        entry = data[agent_setup.GUARD_HOOK_NAME]["PreToolUse"][0]
        assert entry["matcher"] == g.AGY_MATCHER
        cmd = entry["hooks"][0]["command"]
        assert "agent_deck_guard.py" in cmd and cmd.rstrip('"').endswith("--engine agy")  # Windows: wrapped for cmd /c

    def test_invalid_hooks_file_is_left_alone(self, tmp_path):
        import setup as agent_setup
        hooks = tmp_path / "hooks.json"
        hooks.write_text("{broken", encoding="utf-8")
        assert agent_setup.install_agy_guard_hook(project_root=tmp_path, hooks_path=hooks) is None
        assert hooks.read_text(encoding="utf-8") == "{broken"

    def test_claude_settings_get_the_hook(self, tmp_path):
        import setup as agent_setup
        dest = agent_setup.install_claude_settings(project_root=tmp_path)
        data = json.loads(dest.read_text(encoding="utf-8"))
        pre = data["hooks"]["PreToolUse"]
        assert any(h["matcher"] == g.CLAUDE_MATCHER and h["hooks"][0]["command"].endswith("--engine claude") for h in pre)
        assert data["permissions"]["deny"], "the existing deny rules stay"

    def test_matchers_match_the_hook(self):
        import setup as agent_setup
        assert agent_setup.GUARD_AGY_MATCHER == g.AGY_MATCHER
        assert agent_setup.GUARD_CLAUDE_MATCHER == g.CLAUDE_MATCHER

    def test_installed_on_rebuild_and_init(self):
        src = (ROOT / "python" / "scripts" / "setup" / "setup.py").read_text(encoding="utf-8")
        rebuild = src[src.index("def skills_rebuild():"):]
        assert "install_agy_guard_hook()" in rebuild[: rebuild.index("\ndef ")]
        init = src[src.index('if cmd == "init":'):]
        assert "install_agy_guard_hook()" in init[: init.index("elif")]


def test_command_quoting_per_shell(tmp_path):
    import setup as agent_setup
    root = tmp_path / "Taro Yamada" / "agent-deck"
    mac = agent_setup.guard_hook_command("agy", root, windows=False)
    assert mac.startswith('"') and mac.endswith("--engine agy") and "Taro Yamada" in mac
    win_agy = agent_setup.guard_hook_command("agy", root, windows=True)
    assert win_agy.startswith('""') and win_agy.endswith('--engine agy"'), win_agy  # survives cmd /c
    win_claude = agent_setup.guard_hook_command("claude", root, windows=True)
    assert win_claude == mac.replace("--engine agy", "--engine claude")  # bash: plain quoting


@pytest.mark.skipif(sys.platform != "win32", reason="cmd.exe quoting")
def test_windows_cmd_runs_the_agy_command(tmp_path, world):
    """What agy does on Windows: cmd /c <command>, from a path with a space."""
    import setup as agent_setup
    import shutil as _sh
    root = tmp_path / "Taro Yamada" / "agent-deck"
    dst = root / "python" / "scripts" / "hooks"
    dst.mkdir(parents=True)
    _sh.copy(SCRIPT, dst / SCRIPT.name)
    cmd = agent_setup.guard_hook_command("agy", root)
    _, me, other, _, env = world
    r = subprocess.run(f"cmd /c {cmd}", input=agy_input("write_file", other / "x.txt", me).encode("utf-8"),
                       capture_output=True, env={**os.environ, **env}, timeout=60, shell=True)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout.decode("utf-8"))["decision"] == "deny"
