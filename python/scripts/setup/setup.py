import os
import sys
import platform
import subprocess
from pathlib import Path

# Windows pipe (agy.exe's pty etc.) makes stdout fall back to CP1252,
# corrupting or crashing on this file's Japanese output (see
# setup_config()'s prompts, skills_list()'s labels). Confirmed for real:
# a user's /update -> preflight.bat -> this script's "config" step printed
# mojibake instead of the intended Japanese text.
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = Path(SCRIPT_DIR).parents[2] / "config.toml"

def run_command(cmd, description=None):
    if description:
        print(f"==> {description}")
    try:
        subprocess.run(cmd, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error: {e}")
        return False
    return True

# ── skills lock ───────────────────────────────────────────────
# Serializes everything that rewrites skills/*.skill and the installed skill
# folders. Confirmed for real on Windows (2026-11-25): two preflights ran at
# once (a second session start while the first was still in its pre-launch
# step) and their build-skills.ps1 runs collided on the same files --
# "used by another process" / access denied -- failing the rebuild and the
# session start. macOS tolerated it only because unlinking an open file
# succeeds there. The UI now refuses a second concurrent start, but other
# overlaps (a scheduled task, two app windows, a `my-skills` command during
# a launch) are still possible, so the rebuild itself waits for its turn.
SKILLS_LOCK_PATH = Path(SCRIPT_DIR).parents[2] / "skills" / ".build.lock"
SKILLS_LOCK_TIMEOUT_S = 300
_skills_lock_depth = 0


def _try_lock_file(fh):
    if platform.system().lower() == "windows":
        import msvcrt
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False
    import fcntl
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _unlock_file(fh):
    if platform.system().lower() == "windows":
        import msvcrt
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


class _skills_lock:
    """Exclusive, cross-process, re-entrant (within one process) lock.

    Waits up to SKILLS_LOCK_TIMEOUT_S for another rebuild to finish, then
    proceeds anyway with a warning rather than blocking the session start
    forever (an OS file lock is released automatically when its holder
    exits, so a stale lock can only mean a genuinely hung rebuild)."""

    def __init__(self, path=None, timeout=None, poll=0.2):
        self.path = Path(path) if path else SKILLS_LOCK_PATH
        self.timeout = SKILLS_LOCK_TIMEOUT_S if timeout is None else timeout
        self.poll = poll
        self.fh = None
        self.locked = False

    def __enter__(self):
        global _skills_lock_depth
        _skills_lock_depth += 1
        if _skills_lock_depth > 1:
            return self
        import time
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, "a+")
        deadline = time.monotonic() + self.timeout
        announced = False
        while True:
            if _try_lock_file(self.fh):
                self.locked = True
                return self
            if not announced:
                print("  (another skill rebuild is running; waiting for it to finish...)")
                announced = True
            if time.monotonic() >= deadline:
                print("  [WARN] Timed out waiting for the other skill rebuild; continuing anyway.")
                return self
            time.sleep(self.poll)

    def __exit__(self, *exc):
        global _skills_lock_depth
        _skills_lock_depth -= 1
        if _skills_lock_depth > 0 or self.fh is None:
            return False
        try:
            if self.locked:
                _unlock_file(self.fh)
        finally:
            self.fh.close()
            self.fh = None
            self.locked = False
        return False


def _with_skills_lock(fn):
    import functools

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with _skills_lock():
            return fn(*args, **kwargs)
    return wrapper


def build_skills():
    print("==> Building skill packages...")
    system = platform.system().lower()
    if system == "windows":
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", os.path.join(SCRIPT_DIR, "build-skills.ps1")],
            check=True, stdin=subprocess.DEVNULL,
        )
    else:
        subprocess.run(
            ["bash", os.path.join(SCRIPT_DIR, "build-skills.sh")],
            check=True, stdin=subprocess.DEVNULL,
        )

def setup_venv():
    """Create venv and pre-install all Python dependencies."""
    print("==> Setting up Python virtual environment...")
    project_root = Path(SCRIPT_DIR).parents[2]
    venv_dir = project_root / "venv"

    if not venv_dir.exists():
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True,
                        stdin=subprocess.DEVNULL)

    if platform.system().lower() == "windows":
        pip    = venv_dir / "Scripts" / "pip.exe"
        python = venv_dir / "Scripts" / "python.exe"
    else:
        pip    = venv_dir / "bin" / "pip"
        python = venv_dir / "bin" / "python3"

    pip_flags = ["-qq", "--disable-pip-version-check", "--no-cache-dir", "--no-warn-script-location"]
    # Not used by any of agent-deck's own public skills (the corporate slide-
    # generation feature that used to live here moved entirely to agent-deck
    # in 0.0.11 — see python/scripts/slides/ removal). Kept anyway: a
    # wrapping project's own scripts (e.g. agent-deck's src/scripts/slides/
    # generate_pptx.py) reuse THIS venv rather than maintaining a second one
    # of their own, and expect python-pptx to already be here.
    subprocess.run([str(python), "-m", "pip", "install", *pip_flags, "python-pptx"], check=True,
                   stdin=subprocess.DEVNULL)
    subprocess.run([str(python), "-m", "pip", "install", *pip_flags,
                    "google-auth", "google-auth-oauthlib", "google-api-python-client"],
                   check=True, stdin=subprocess.DEVNULL)
    subprocess.run([str(python), "-m", "pip", "install", *pip_flags,
                    "markitdown[pdf,docx,pptx,xlsx]"], check=True, stdin=subprocess.DEVNULL)

    if platform.system().lower() == "windows":
        subprocess.run([str(python), "-m", "pip", "install", *pip_flags, "pywin32"],
                       check=True, stdin=subprocess.DEVNULL)

    automation_req = Path(SCRIPT_DIR).parent / "automation" / "requirements.txt"
    subprocess.run([str(python), "-m", "pip", "install", *pip_flags,
                    "-r", str(automation_req)], check=True, stdin=subprocess.DEVNULL)
    subprocess.run([str(python), "-m", "playwright", "install", "chromium"],
                   capture_output=True, stdin=subprocess.DEVNULL)

    (venv_dir / ".installed").touch()
    print("==> Virtual environment ready.")

_HOME_SKILLS_MANIFEST = ".installed-skills-manifest"

def _project_root_posix(project_root=None):
    """Absolute project root with forward slashes on every OS
    (C:/Users/x/agent-deck on Windows) -- safe to embed in Markdown,
    JSON and TOML strings, and accepted by python/cmd/PowerShell alike."""
    root = Path(project_root) if project_root else Path(SCRIPT_DIR).parents[2]
    return root.resolve().as_posix()

# `python3 python/...` at a command position (not part of a longer path).
_SKILL_CMD_PATH_RE = None

_SKILL_ROOT_PREFIXES = ("python/skills-catalog/", "python/skills-personal/", "python/skills/")

def _resolve_skill_root_path(rel, project_root):
    """A path under one skill root (e.g. python/skills-personal/x/scripts/a.py)
    that doesn't exist there but does under another root: return that one.

    Org skills are authored in skills-personal/ (so their SKILL.md says
    `python/skills-personal/<name>/scripts/...`) but land in skills-catalog/
    on every other machine via sync -- and older installs synced them into
    skills-personal/. Resolving by what actually exists keeps both working."""
    root = Path(project_root)
    if (root / rel).exists():
        return rel
    for prefix in _SKILL_ROOT_PREFIXES:
        if rel.startswith(prefix):
            remainder = rel[len(prefix):]
            for other in _SKILL_ROOT_PREFIXES:
                if other != prefix and (root / other / remainder).exists():
                    return other + remainder
    return rel

def render_skill_md(text, project_root=None, skill_dir=None):
    """Make a SKILL.md work from any session working folder.

    Skill sources reference scripts project-root-relative
    (`python3 python/scripts/automation/automate.py ...`), which only works
    while the agent's cwd is the project root -- not after the user picks
    another working folder, and not for the per-user copies in
    ~/.gemini/skills / ~/.claude/skills. At deploy time:
      - `{{PROJECT_ROOT}}` -> the absolute project root;
      - `{{SKILL_DIR}}` -> the absolute dir the skill's source lives in
        (whichever of skills/ / skills-catalog/ / skills-personal/);
      - `python3 python/<path>` / `python python/<path>` ->
        `python3 "<root>/python/<path>"`, with a path under a skill root
        redirected to the root where it actually exists.
    A leading backslash keeps text literal (minus the backslash), for skills
    that document these conventions: `\\{{SKILL_DIR}}`, `\\python3 python/x.py`.
    Sources stay unchanged (they're also what the catalog distributes)."""
    import re
    global _SKILL_CMD_PATH_RE
    if _SKILL_CMD_PATH_RE is None:
        # Group 1 is an escaping backslash; it only counts as one when not
        # itself part of a path (venv\Scripts\python is preceded by a word char).
        _SKILL_CMD_PATH_RE = re.compile(
            r'(?<![\w/.\\-])(\\?)(?<![\w/.-]\\)(python3?)([ \t]+)(python/[^\s`"\'()|;&<>]+)')
    root_path = Path(project_root) if project_root else Path(SCRIPT_DIR).parents[2]
    root = _project_root_posix(project_root)
    values = {"PROJECT_ROOT": root}
    if skill_dir is not None:
        values["SKILL_DIR"] = Path(skill_dir).resolve().as_posix()

    def placeholder(m):
        if m.group(1):  # escaped: \{{X}} -> literal {{X}}
            return "{{" + m.group(2) + "}}"
        return values.get(m.group(2), m.group(0))

    text = re.sub(r"(\\?)\{\{(PROJECT_ROOT|SKILL_DIR)\}\}", placeholder, text)

    def command(m):
        if m.group(1):  # escaped: \python3 python/x -> literal python3 python/x
            return m.group(0)[1:]
        return f'{m.group(2)}{m.group(3)}"{root}/{_resolve_skill_root_path(m.group(4), root_path)}"'

    return _SKILL_CMD_PATH_RE.sub(command, text)

def _find_source_skill_dir(skill_name, project_root=None):
    """Where build-skills took <skill_name> from: first enabled match across
    the roots in build order (same precedence as build-skills.sh)."""
    root = Path(project_root) if project_root else Path(SCRIPT_DIR).parents[2]
    for skill_root in _skill_roots(root):
        if not skill_root.exists():
            continue
        for skill_md in sorted(skill_root.rglob("SKILL.md")):
            if skill_md.parent.name == skill_name and "disabled" not in skill_md.relative_to(skill_root).parts:
                return skill_md.parent
    return None

def _sync_home_skills(local_skills_dir, home_skills_dir, installed, overwrite_unmanaged=True):
    """Mirror the freshly-installed local skills into a per-user skills dir.

    A manifest of what THIS process installed last time lets a renamed or
    retired skill be cleaned up here too — without it, a skill that no
    longer exists in the current build (e.g. "calendar" consolidated into
    "daily-schedule") is never touched again: the copy loop only overwrites
    entries matching CURRENT skill names, so the old directory sits there
    forever, and an agent that stumbles onto it follows stale,
    no-longer-correct instructions instead of the current skill. Confirmed
    happening for real. A name never tracked by this manifest (e.g. a skill
    a user created directly in the home dir some other way) is never
    removed; with overwrite_unmanaged=False it is not overwritten either.
    """
    import shutil
    home_skills_dir = Path(home_skills_dir)
    home_skills_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = home_skills_dir / _HOME_SKILLS_MANIFEST
    previously_installed = set(manifest_path.read_text().splitlines()) if manifest_path.exists() else set()

    for stale_name in previously_installed - set(installed):
        stale_dir = home_skills_dir / stale_name
        if stale_dir.exists():
            shutil.rmtree(stale_dir)
            print(f"  Removed stale: {stale_name} ({home_skills_dir})")

    managed = []
    for skill_name in installed:
        home_skill = home_skills_dir / skill_name
        if home_skill.exists():
            if not overwrite_unmanaged and skill_name not in previously_installed:
                print(f"  Skipped (user-owned skill with the same name): {home_skill}")
                continue
            shutil.rmtree(home_skill)
        shutil.copytree(os.path.join(local_skills_dir, skill_name), str(home_skill))
        managed.append(skill_name)

    manifest_path.write_text("\n".join(sorted(managed)))


def install_skills():
    print("==> Installing skills to .gemini/skills/ and .claude/skills/...")
    import zipfile
    import shutil
    skills_dir = "skills"
    gemini_skills_dir = os.path.join(".gemini", "skills")
    if os.path.exists(gemini_skills_dir):
        shutil.rmtree(gemini_skills_dir)
    os.makedirs(gemini_skills_dir)
    installed = []
    for skill_file in sorted(os.listdir(skills_dir)):
        if not skill_file.endswith(".skill"):
            continue
        skill_name = skill_file[:-6]
        dest = os.path.join(gemini_skills_dir, skill_name)
        os.makedirs(dest, exist_ok=True)
        with zipfile.ZipFile(os.path.join(skills_dir, skill_file)) as zf:
            zf.extractall(dest)
        skill_md = Path(dest) / "SKILL.md"
        if skill_md.exists():
            skill_md.write_text(
                render_skill_md(skill_md.read_text(encoding="utf-8"),
                                skill_dir=_find_source_skill_dir(skill_name)),
                encoding="utf-8")
        print(f"  Installed: {skill_name}")
        installed.append(skill_name)

    # Claude Code reads the same SKILL.md format (name/description
    # frontmatter) from <project>/.claude/skills/<name>/SKILL.md, so the
    # project-local copy is a straight mirror of .gemini/skills/.
    claude_skills_dir = os.path.join(".claude", "skills")
    if os.path.exists(claude_skills_dir):
        shutil.rmtree(claude_skills_dir)
    shutil.copytree(gemini_skills_dir, claude_skills_dir)

    # Also install to the per-user dirs, so the skills are found when a
    # session's working folder is not the project root:
    # ~/.gemini/skills/ for Antigravity CLI (agy), ~/.claude/skills/ for
    # Claude Code. ~/.claude/skills/ is commonly shared with the user's own
    # hand-made skills, so a same-named skill this setup never installed is
    # left untouched there rather than overwritten.
    _sync_home_skills(gemini_skills_dir, Path.home() / ".gemini" / "skills", installed)
    _sync_home_skills(claude_skills_dir, Path.home() / ".claude" / "skills", installed,
                      overwrite_unmanaged=False)

def trust_project_folder():
    import json
    trusted_file = Path.home() / ".gemini" / "trustedFolders.json"
    project_root = str(Path(SCRIPT_DIR).parents[2].resolve())
    try:
        data = json.loads(trusted_file.read_text(encoding="utf-8")) if trusted_file.exists() else {}
    except (json.JSONDecodeError, OSError):
        data = {}
    if data.get(project_root) != "TRUST_FOLDER":
        data[project_root] = "TRUST_FOLDER"
        trusted_file.parent.mkdir(parents=True, exist_ok=True)
        trusted_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"==> Trusted project folder: {project_root}")

def setup_files_folder():
    files_dir = Path("files")
    files_dir.mkdir(exist_ok=True)
    print("==> files/ folder ready.")

def install_gemini_policies():
    print("==> Installing Gemini CLI policies to ~/.gemini/policies/...")
    src_policies = Path(SCRIPT_DIR).parents[1] / "config" / "gemini" / "policies"
    dst_policies = Path.home() / ".gemini" / "policies"
    dst_policies.mkdir(parents=True, exist_ok=True)
    # {{PROJECT_ROOT}} lets the auto-allow rules match the absolute script
    # paths render_skill_md() writes into installed skills. Escaped for a
    # TOML basic string (the posix path has no backslashes; quotes are rare).
    root = _project_root_posix().replace('"', '\\"')
    for toml_file in src_policies.glob("*.toml"):
        text = toml_file.read_text(encoding="utf-8").replace("{{PROJECT_ROOT}}", root)
        (dst_policies / toml_file.name).write_text(text, encoding="utf-8")
        print(f"  Installed: {toml_file.name}")

CLAUDE_SETTINGS_NAME = "agent-deck-settings.json"

# ── Guard hook (python/scripts/hooks/agent_deck_guard.py, app_specs.md 5.7.4) ──
# Both engines run it before a file-writing tool: it refuses writes into
# another agent-deck tab's folder and asks before writes outside the tab's
# own folder. Matchers mirror the hook's AGY_MATCHER / CLAUDE_MATCHER.
GUARD_HOOK_NAME = "agent-deck-guard"
GUARD_AGY_MATCHER = (
    "write_file|write_to_file|replace_file_content|multi_replace_file_content|"
    "edit_file|create_file|delete_file|apply_patch|edit_notebook|rename_file|"
    "replace|move_file|patch_file|notebook_edit|"
    "read_file|view_file|view_file_outline|view_code_item|"
    "list_dir|find_by_name|grep_search|read_notebook|"
    "run_shell_command|run_command"
)
GUARD_CLAUDE_MATCHER = "Write|Edit|MultiEdit|NotebookEdit|Read|Glob|Grep|NotebookRead|Bash"


def _guard_python(project_root):
    """The install's venv Python when present (it exists after setup), else this one."""
    root = Path(project_root)
    for cand in (root / "venv" / "Scripts" / "python.exe", root / "venv" / "bin" / "python3"):
        if cand.exists():
            return cand
    return Path(sys.executable)


def guard_hook_command(engine, project_root=None, windows=None):
    """Shell command both engines run. Forward slashes work for Python on
    Windows too and need no escaping. agy runs hooks with `cmd /c` on
    Windows, which strips the first and last quote of a command holding
    several quoted parts (a path with spaces: C:/Users/Taro Yamada/...):
    one more pair of quotes around the whole command survives that. Claude
    Code runs hooks through bash, so it keeps plain quoting."""
    project_root = Path(project_root) if project_root else Path(SCRIPT_DIR).parents[2].resolve()
    script = project_root / "python" / "scripts" / "hooks" / "agent_deck_guard.py"
    py = _guard_python(project_root)
    cmd = f'"{py.as_posix()}" "{script.as_posix()}" --engine {engine}'
    windows = (os.name == "nt") if windows is None else windows
    if windows and engine == "agy":
        cmd = f'"{cmd}"'
    return cmd


def install_agy_guard_hook(project_root=None, hooks_path=None):
    """Merge agent-deck's guard into agy's shared hooks file
    (~/.gemini/config/hooks.json). Other named hooks are kept as they are; an
    unreadable file is left alone (never clobber someone's config)."""
    import json
    hooks_path = Path(hooks_path) if hooks_path else Path.home() / ".gemini" / "config" / "hooks.json"
    data = {}
    if hooks_path.exists():
        try:
            data = json.loads(hooks_path.read_text(encoding="utf-8-sig"))
            if not isinstance(data, dict):
                raise ValueError("not an object")
        except (OSError, ValueError) as e:
            print(
                f"  [ERROR] {hooks_path} is not valid JSON ({e}); agent-deck's guard hook was NOT installed. "
                "Fix or remove that file so multi-session protection can run.",
                file=sys.stderr,
            )
            return None
    data[GUARD_HOOK_NAME] = {"PreToolUse": [{
        "matcher": GUARD_AGY_MATCHER,
        "hooks": [{"type": "command", "command": guard_hook_command("agy", project_root), "timeout": 30}],
    }]}
    hooks_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = hooks_path.with_name(hooks_path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, hooks_path)
    print(f"==> Installed agy guard hook: {hooks_path}")
    return hooks_path

def _claude_abs_rule_path(path):
    """Absolute path in Claude Code permission-rule form: `//` + POSIX path.
    Windows drive paths are normalized the way Claude Code does it
    (C:\\Users\\x -> /c/Users/x), giving //c/Users/x."""
    posix = Path(path).as_posix()
    if len(posix) >= 2 and posix[1] == ":":
        posix = "/" + posix[0].lower() + posix[2:]
    return "/" + posix

def install_claude_settings(project_root=None):
    """Render python/config/claude/settings.json into
    <project>/.claude/agent-deck-settings.json for `claude --settings`."""
    import json
    project_root = Path(project_root) if project_root else Path(SCRIPT_DIR).parents[2].resolve()
    template = Path(SCRIPT_DIR).parents[1] / "config" / "claude" / "settings.json"
    text = template.read_text(encoding="utf-8")
    rule_root = _claude_abs_rule_path(project_root)
    # Insert via json.dumps so a path with quotes/backslashes stays valid JSON.
    text = text.replace("${PROJECT_ROOT_RULE}", json.dumps(rule_root)[1:-1])
    text = text.replace("${PROJECT_ROOT_POSIX}", json.dumps(_project_root_posix(project_root))[1:-1])
    data = json.loads(text)
    data.pop("$comment", None)
    # The guard hook (see GUARD_HOOK_NAME), next to any hooks the template has.
    hooks = data.setdefault("hooks", {})
    hooks.setdefault("PreToolUse", []).append({
        "matcher": GUARD_CLAUDE_MATCHER,
        "hooks": [{"type": "command", "command": guard_hook_command("claude", project_root), "timeout": 30}],
    })
    dest = project_root / ".claude" / CLAUDE_SETTINGS_NAME
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"==> Installed Claude Code permission settings: {dest}")
    return dest

# ── setup skills ──────────────────────────────────────────────
#
# Three skill roots, built in this order -- on a name clash the FIRST one
# wins (build-skills.sh/.ps1 warn and skip the later copy):
#   python/skills/           common   — bundled with every agent-deck install (git-tracked)
#   python/skills-catalog/   catalog  — installed from the org's Drive skill-catalog
#                                       (`skills_catalog.py sync` / `download`), gitignored
#   python/skills-personal/  personal — the user's own, created by `my-skills create`, gitignored
# Each root may have its own `disabled/` subfolder for temporarily-disabled skills.

_SKILL_ROOT_NAMES = ["skills", "skills-catalog", "skills-personal"]

def _skill_roots(project_root):
    return [project_root / "python" / name for name in _SKILL_ROOT_NAMES]

def _find_skill_dir(skill_name, search_root):
    """Return the directory containing SKILL.md whose basename matches skill_name."""
    for skill_md in sorted(Path(search_root).rglob("SKILL.md")):
        if skill_md.parent.name == skill_name:
            return skill_md.parent
    return None

def skills_list():
    project_root = Path(SCRIPT_DIR).parents[2]

    enabled = []
    disabled = []
    for root in _skill_roots(project_root):
        if not root.exists():
            continue
        for skill_md in root.rglob("SKILL.md"):
            rel = skill_md.relative_to(root)
            (disabled if "disabled" in rel.parts else enabled).append(skill_md.parent.name)

    print("Enabled skills / 有効なスキル:")
    for name in sorted(enabled):
        print(f"  ✓ {name}")
    if disabled:
        print("\nDisabled skills / 無効なスキル:")
        for name in sorted(disabled):
            print(f"  ✗ {name}")

def _is_dev_checkout():
    """True when running from a git checkout of agent-deck itself. Release
    ZIPs never contain .git, so installs are unaffected."""
    return (CONFIG_PATH.parent / ".git").exists()

def sync_catalog_skills():
    """Best-effort: pull auto-distributed skills (the catalog's _default/
    folder) into skills-catalog/ before building, so they're part of the
    same rebuild. skills_catalog.py itself no-ops instantly unless
    config.toml points at a real catalog_folder_id, and handles its own
    venv re-exec for the google-api deps.

    Never fails the rebuild: offline, auth declined/timed out, or any
    other problem just means skills stay as they are until the next
    launch (skills_catalog.py sync already prints its own [WARN] with the
    reason in those cases)."""
    if not CONFIG_PATH.exists():
        return  # public-ZIP install: no org catalog to sync from
    if _is_dev_checkout() and os.environ.get("AGENT_DECK_CATALOG_SYNC") != "1":
        # Running from agent-deck's own git checkout (`tauri dev`): don't pull
        # the org catalog into the working tree -- confirmed for real, it
        # put _default/ skills into python/skills-catalog/ that clashed with
        # python/skills-personal/ copies and broke test_skill_build. Set
        # AGENT_DECK_CATALOG_SYNC=1 to test the sync from a checkout anyway.
        print("  (development checkout: skipping catalog sync; AGENT_DECK_CATALOG_SYNC=1 to enable)")
        return
    script = os.path.join(SCRIPT_DIR, "skills_catalog.py")
    try:
        result = subprocess.run([sys.executable, script, "sync"],
                                stdin=subprocess.DEVNULL)
        if result.returncode != 0:
            print("  [WARN] Catalog sync failed — continuing with existing skills.")
    except Exception as e:
        print(f"  [WARN] Catalog sync failed ({e}) — continuing with existing skills.")

@_with_skills_lock
def skills_rebuild():
    sync_catalog_skills()
    build_skills()
    install_skills()
    install_claude_settings()
    install_agy_guard_hook()
    print("==> Skills rebuilt and reinstalled.")

@_with_skills_lock
def skills_disable(skill_name):
    import shutil
    project_root = Path(SCRIPT_DIR).parents[2]

    for root in _skill_roots(project_root):
        if not root.exists():
            continue
        skill_dir = _find_skill_dir(skill_name, root)
        if not skill_dir or "disabled" in skill_dir.relative_to(root).parts:
            continue

        disabled_dir = root / "disabled"
        disabled_dir.mkdir(exist_ok=True)
        dest = disabled_dir / skill_name
        if dest.exists():
            print(f"Error: '{dest}' already exists — already disabled?")
            sys.exit(1)

        shutil.move(str(skill_dir), str(dest))
        print(f"==> Disabled: {skill_name}")
        build_skills()
        install_skills()
        print(f"==> Done. Run /skills reload in Gemini to apply.")
        return

    roots_desc = "/".join(f"python/{n}/" for n in _SKILL_ROOT_NAMES)
    print(f"Error: skill '{skill_name}' not found in {roots_desc}")
    sys.exit(1)

@_with_skills_lock
def skills_enable(skill_name):
    import shutil
    project_root = Path(SCRIPT_DIR).parents[2]

    for root in _skill_roots(project_root):
        disabled_dir = root / "disabled"
        if not disabled_dir.exists():
            continue
        skill_dir = _find_skill_dir(skill_name, disabled_dir)
        if not skill_dir:
            continue

        dest = root / skill_name
        if dest.exists():
            print(f"Error: '{dest}' already exists — already enabled?")
            sys.exit(1)

        shutil.move(str(skill_dir), str(dest))
        print(f"==> Enabled: {skill_name}")
        build_skills()
        install_skills()
        print(f"==> Done. Run /skills reload in Gemini to apply.")
        return

    roots_desc = "/".join(f"python/{n}/disabled/" for n in _SKILL_ROOT_NAMES)
    print(f"Error: skill '{skill_name}' not found in {roots_desc}")
    sys.exit(1)

# ── setup config ──────────────────────────────────────────────

def _prompt(msg):
    """input() that degrades to an empty answer when running non-interactively.

    setup_config() can run non-interactively (invoked by agent-deck's
    pre_launch_command via preflight.sh/.bat, with no real user attached),
    where a bare input() would either raise EOFError or, confirmed for real
    on Windows, block forever (Tauri's pre_launch_command there apparently
    leaves stdin in a state where sys.stdin.isatty() is NOT a reliable
    signal either -- an isatty()-based guard alone still hung indefinitely
    on a genuinely fresh Windows install). Missing credentials/email are
    already handled as "not yet configured" (re-prompted next time this
    runs interactively), so degrading to an empty answer is safe here.

    The one deterministic signal is AGENT_DECK_NONINTERACTIVE, which
    preflight.sh/.bat export before calling `setup.py config` -- this
    doesn't depend on guessing how any given platform/shell wires up
    stdin for a spawned child process. isatty()/EOFError remain as a
    fallback for other invocation contexts (e.g. running this file
    directly without that env var set).
    """
    if os.environ.get("AGENT_DECK_NONINTERACTIVE"):
        return ""
    if not sys.stdin.isatty():
        return ""
    try:
        return input(msg)
    except EOFError:
        return ""


def setup_config():
    """Prompt for missing OAuth credentials; save to config.toml."""
    import re
    if not CONFIG_PATH.exists():
        return
    text = CONFIG_PATH.read_text(encoding="utf-8")

    def _get(key):
        m = re.search(rf'^{key}\s*=\s*"([^"]*)"', text, re.MULTILINE)
        return m.group(1).strip() if m else ""

    def _set(key, value):
        nonlocal text
        text = re.sub(rf'^({key}\s*=\s*)"[^"]*"', f'\\1"{value}"', text, flags=re.MULTILINE)

    # ── OAuth credentials ──────────────────────────────────────
    client_id     = _get("client_id")
    client_secret = _get("client_secret")
    if not client_id or not client_secret:
        print("==> OAuth 認証情報の設定 / OAuth credentials setup")
        print("    Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs")
        print()
        if not client_id:
            client_id = _prompt("  Client ID     : ").strip()
            _set("client_id", client_id)
        if not client_secret:
            client_secret = _prompt("  Client Secret : ").strip()
            _set("client_secret", client_secret)
        CONFIG_PATH.write_text(text, encoding="utf-8")
        text = CONFIG_PATH.read_text(encoding="utf-8")
        print("==> config.toml を更新しました / Saved to config.toml.")

    # Deliberately no email prompt here: real Google account selection
    # always happens at actual auth time (agy's own sign-in, or the Drive/
    # Calendar OAuth flow's account picker) regardless of this config
    # value, and preflight.sh/.bat always run this non-interactively
    # (AGENT_DECK_NONINTERACTIVE=1) -- _prompt() returns "" immediately, so
    # a prompt here could never actually resolve and would just reprint on
    # every single launch forever. [user] email in config.toml is still
    # honored as a login_hint pre-fill (see USER_EMAIL usages) for anyone
    # who sets it by hand.

_GWS_VERSION = "v0.22.5"
_GWS_MIN_VALID_BINARY_SIZE = 1_000_000
_GWS_CONFIG_DIR = Path.home() / ".config" / "gws"
_GWS_MANAGED_MARKER = ".agent_deck_managed"


def _gws_target():
    """darwin/windows only, matching this project's supported platforms
    (see ensure_marp.py's _target_for() for the same scope decision)."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    is_arm = machine in ("arm64", "aarch64")
    targets = {
        "darwin": {
            "url": f"https://github.com/googleworkspace/cli/releases/download/{_GWS_VERSION}/"
                   f"google-workspace-cli-{'aarch64' if is_arm else 'x86_64'}-apple-darwin.tar.gz",
            "file": "gws",
            "is_tar": True,
        },
        "windows": {
            "url": f"https://github.com/googleworkspace/cli/releases/download/{_GWS_VERSION}/"
                   f"google-workspace-cli-x86_64-pc-windows-msvc.zip",
            "file": "gws.exe",
            "is_zip": True,
        },
    }
    return targets.get(system)


def ensure_gws_installed() -> bool:
    """Download+extract the gws (Google Workspace CLI) binary into app/bin/
    if missing or corrupted -- mirrors slide-generator/scripts/ensure_marp.py's
    download-a-binary-release pattern exactly, so `gws` becomes directly
    callable inside agy's PTY shell (src-tauri/src/pty.rs already puts
    <project_root>/app/bin on PATH for tools "like marp or agy").

    gws (https://github.com/googleworkspace/cli) is NOT an official Google
    product despite living under the `googleworkspace` GitHub org -- see
    docs/admin_guide.md §15.
    """
    target = _gws_target()
    if target is None:
        print(f"[WARN] gws install not supported on this OS: {platform.system()}")
        return False

    app_bin = Path(SCRIPT_DIR).parents[2] / "app" / "bin"
    app_bin.mkdir(parents=True, exist_ok=True)
    path = app_bin / target["file"]

    if path.exists() and path.stat().st_size < _GWS_MIN_VALID_BINARY_SIZE:
        print(f"  [WARN] gws at {path} looks corrupted "
              f"({path.stat().st_size} bytes) -- re-downloading.")
        path.unlink()

    if not path.exists() or path.stat().st_size < _GWS_MIN_VALID_BINARY_SIZE:
        print("gws not found. Downloading...")
        ext = ".tar.gz" if target.get("is_tar") else ".zip"
        tmp_file = app_bin / f"tmp_gws{ext}"
        try:
            subprocess.run(["curl", "-fsSL", "-o", str(tmp_file), target["url"]],
                            check=True, stdin=subprocess.DEVNULL)
            if target.get("is_tar"):
                # Extract only the binary member -- the tarball also bundles
                # README/LICENSE/CHANGELOG, which would otherwise litter app/bin/.
                subprocess.run(["tar", "-xzf", str(tmp_file), "-C", str(app_bin), target["file"]],
                                check=True, stdin=subprocess.DEVNULL)
            else:
                import shutil
                extract_dir = app_bin / "_gws_extract_tmp"
                subprocess.run(
                    ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
                     f"Expand-Archive -Path '{tmp_file}' -DestinationPath '{extract_dir}' -Force"],
                    check=True, stdin=subprocess.DEVNULL,
                )
                extracted = extract_dir / target["file"]
                if extracted.exists():
                    extracted.replace(path)
                shutil.rmtree(extract_dir, ignore_errors=True)
        except subprocess.CalledProcessError as e:
            print(f"  [ERROR] gws download/extraction failed: {e}")
            return False
        finally:
            tmp_file.unlink(missing_ok=True)

        if not path.exists() or path.stat().st_size < _GWS_MIN_VALID_BINARY_SIZE:
            print("  [ERROR] Download of gws failed or produced a corrupted "
                  "file. Check your network connection and try again.")
            return False
        print(f"  gws installed to {path}.")
    else:
        print(f"  gws already exists at {path}.")

    if platform.system().lower() == "darwin":
        path.chmod(path.stat().st_mode | 0o111)
        subprocess.run(["xattr", "-d", "com.apple.quarantine", str(path)],
                        check=False, stdin=subprocess.DEVNULL)

    return True


def setup_gws():
    """Install gws and register the reused [oauth] client as its
    client_secret.json, but only when config.toml's [gws] enabled = true.

    client_secret.json is written in the standard Google "installed app"
    OAuth schema gws expects (confirmed for real: gws rejects the file
    outright as "No OAuth client configured" unless `project_id` is also
    present, even though it's never validated against Google -- any
    non-empty placeholder satisfies it).

    A `.agent_deck_managed` marker file records that we wrote it, so a user
    who instead ran `gws auth setup`/`gws auth login` by hand (their own,
    real GCP project) never gets that file silently overwritten or deleted
    by us. Runs on every launch (called from both `init` and `config`) so
    toggling the flag in config.toml takes effect on the next launch either
    way. This only stages the client config -- `gws auth login` itself still
    needs one interactive browser consent, same as this project's own Drive/
    Calendar OAuth flows (see docs/admin_guide.md §15).
    """
    import json
    import re
    if not CONFIG_PATH.exists():
        return
    text = CONFIG_PATH.read_text(encoding="utf-8")

    def _get_str(key):
        m = re.search(rf'^{key}\s*=\s*"([^"]*)"', text, re.MULTILINE)
        return m.group(1).strip() if m else ""

    def _get_bool(key):
        m = re.search(rf'^{key}\s*=\s*(true|false)', text, re.MULTILINE)
        return m is not None and m.group(1) == "true"

    enabled = _get_bool("enabled")
    secret_path = _GWS_CONFIG_DIR / "client_secret.json"
    marker_path = _GWS_CONFIG_DIR / _GWS_MANAGED_MARKER

    if not enabled:
        if secret_path.exists() and marker_path.exists():
            secret_path.unlink()
            marker_path.unlink()
            print("==> gws の client_secret.json の登録を解除しました / Unregistered gws client_secret.json.")
        return

    client_id = _get_str("client_id")
    client_secret = _get_str("client_secret")
    project_id = _get_str("project_id") or "agent-deck"
    if not client_id or not client_secret:
        return  # OAuth not configured yet -- setup_config() prompts for it first

    if secret_path.exists() and not marker_path.exists():
        return  # user's own gws credentials (e.g. `gws auth setup`) -- don't touch

    entry = {
        "installed": {
            "client_id": client_id,
            "project_id": project_id,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": client_secret,
            "redirect_uris": ["http://localhost"],
        }
    }
    if secret_path.exists():
        try:
            existing = json.loads(secret_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = None
        if existing == entry:
            return  # already up to date -- avoid rewriting the file every launch

    if not ensure_gws_installed():
        return

    _GWS_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    secret_path.write_text(json.dumps(entry, indent=2), encoding="utf-8")
    marker_path.write_text("", encoding="utf-8")
    print("==> gws の client_secret.json を ~/.config/gws に登録しました / Registered gws client_secret.json.")
    print("    次に一度だけ `gws auth login` を実行してブラウザで認可してください。")
    print("    Run `gws auth login` once to complete browser consent.")

# ── entrypoint ────────────────────────────────────────────────

def _usage():
    print("Usage: setup.py [init|config|gws|trust|skills [list|rebuild|enable <name>|disable <name>]]")
    sys.exit(1)

if __name__ == "__main__":
    args = sys.argv[1:]
    cmd  = args[0] if args else "init"

    if cmd == "init":
        setup_config()
        setup_gws()
        setup_venv()
        with _skills_lock():
            build_skills()
            install_skills()
        install_gemini_policies()
        install_claude_settings()
        install_agy_guard_hook()
        trust_project_folder()
        setup_files_folder()
        print("==> Setup completed successfully.")

    elif cmd == "skills":
        sub = args[1] if len(args) > 1 else "rebuild"
        if sub == "list":
            skills_list()
        elif sub == "rebuild":
            skills_rebuild()
        elif sub == "enable":
            if len(args) < 3:
                print("Error: specify a skill name.  e.g. setup.py skills enable downloads")
                sys.exit(1)
            skills_enable(args[2])
        elif sub == "disable":
            if len(args) < 3:
                print("Error: specify a skill name.  e.g. setup.py skills disable downloads")
                sys.exit(1)
            skills_disable(args[2])
        else:
            _usage()

    elif cmd == "config":
        setup_config()
        setup_gws()

    elif cmd == "gws":
        setup_gws()

    elif cmd == "trust":
        trust_project_folder()

    else:
        _usage()
