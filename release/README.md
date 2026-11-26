# Files that ship at the root of a release

These become the top-level `AGENTS.md` and `CLAUDE.md` of every release ZIP
(`.github/workflows/release.yml` copies them; the app also writes them back
at startup, see `src-tauri/src/root_files.rs`).

They are the **guardrails for the installed product** (e.g. "don't edit the
app's own files"). They deliberately do NOT live at this repo's root under
their real names: Antigravity CLI auto-loads an `AGENTS.md` (and Claude Code a
`CLAUDE.md`) from the folder it runs in -- and possibly from subfolders -- so
a real-named copy here would apply the product's guardrails to development of
agent-deck itself, where they block the work. Hence the `.release.md` names.

| File here | Ships as | Read by |
|---|---|---|
| `AGENTS.release.md` | `AGENTS.md` | Antigravity CLI (directly), Claude Code (via `CLAUDE.md`) |
| `CLAUDE.release.md` | `CLAUDE.md` (`@AGENTS.md`) | Claude Code |

Development instructions for agent-deck itself are the repo-root `CLAUDE.md`
(gitignored, never shipped).
