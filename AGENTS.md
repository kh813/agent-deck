## Startup

Setup is handled automatically by `preflight.sh`/`preflight.bat` **before** Antigravity CLI (agy) starts. By the time this session begins, setup is already complete. Do not run any startup check commands — proceed directly with the user's request.

---

## Authentication

Use this project only with your **company Google Workspace account**.

Sign-in is handled automatically on first use. If re-authentication is needed, exit agy and relaunch `agent-deck.app`/`agent-deck.exe` — browser-based Google sign-in will be prompted automatically.

---

## Project Overview

Skills and scripts for the company productivity toolkit, built on top of agent-deck.

- `python/scripts/` — setup, self-update, catalog, and automation scripts
- `python/skills/` — bundled public skill sources (SKILL.md)
- `python/skills-personal/` — org-specific and personal skill sources (SKILL.md)
- `files/` — user-facing working folder; also where the corporate PPTX template lives
- `.gemini/skills/` — installed skills

**Running a skill:** A skill's `name:` frontmatter field is an identifier for routing only — it is **not** a CLI subcommand. `agy` has no built-in command to run a skill by name (`agy <skill-name>` does not exist and will fail or hang). To run a skill, follow the exact command(s) documented in its `## 手順 / Workflow` section (e.g. `python3 python/scripts/automation/automate.py calendar`).

---

## User Input

Always use the **`ask_user` tool** whenever you need input from the user. Never ask by outputting plain text and waiting.

`ask_user` tool usage:
- `type: "text"` — Free-form text input
- `type: "choice"` — Choose from 2–4 options
- `type: "yesno"` — Yes / No confirmation

Example:
```json
{
  "questions": [
    {
      "header": "Search Topic",
      "question": "社内ポータルの検索内容を教えてください。\nWhat would you like to search for on the internal portal?",
      "type": "text",
      "placeholder": "e.g., Expense reimbursement"
    }
  ]
}
```

---

## Project File Protection

Never modify, create, or delete any file in this project **except the locations listed below**. This applies at all times.

**Writable:**
- `tmp/` — Temporary files (slide generation, etc.)
- `files/` — Files managed by the file-organizer skill
- `python/skills-personal/` — via the `/my-skills` skill only

**Everything else is read-only** (`python/skills/`, `.gemini/`, `docs/`, `config.toml`, `ANTIGRAVITY.md`, etc.)

If a script returns an error, do not attempt to fix the code — report the error to the user as-is.

---

## File Access Policy

File operations are strictly limited to the locations below. Never access files outside these locations — even if the user explicitly requests it.

**Allowed:**
- `files/` and `tmp/` in this project
- Standard OS home folders: Downloads, Documents, Desktop, Pictures, Music, Movies, Videos, Public

**Prohibited:**
- Mac/Linux system directories: `/etc/`, `/usr/`, `/bin/`, `/System/`, `/Library/`, `/private/`, `/Applications/`
- Windows system directories: `C:\Windows`, `C:\Program Files`, `C:\ProgramData`
- Home directory credentials/configs: `~/.ssh`, `~/.aws`, `~/.env`, `~/.bashrc`, `~/.zshrc`, `~/.gemini`, `~/.gitconfig`
- Home directory app config folders: `~/.config/`, `~/Library/` (Mac), `AppData/` (Windows)
- Renaming or deleting OS-default home folders themselves (Downloads, Documents, etc.)
- Any path outside the current user's home directory

---

## Browser Automation Skills

When generating `run.py` for a skill that involves browser automation, always import and use functions from `python/scripts/automation/chrome_utils.py`. Do not write raw Playwright code — use the pre-built utilities to ensure consistent behavior across model updates.

```python
from common import get_chrome_context
from chrome_utils import open_url, get_structured_list, save_csv  # use as needed
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    context, page = get_chrome_context(p)
    ...
```

Available functions:

| Group      | Functions |
|------------|-----------|
| Navigation | `open_url`, `open_new_tab`, `wait_until_authenticated` |
| Login      | `fill_credentials`, `handle_google_signin`, `handle_microsoft_signin` |
| Actions    | `scroll_to_bottom`, `select_option`, `dismiss_popup` |
| Extraction | `get_text`, `get_texts`, `get_attribute`, `get_table`, `get_structured_list`, `get_links` |
| Save       | `save_csv`, `save_json`, `save_text`, `save_page_html`, `save_page_text`, `expect_and_save_download` |
| Capture    | `screenshot`, `save_pdf` ※ `save_pdf` requires `headless=True` |

The site-specific trigger (e.g. which button opens the SSO login) must still be written in `run.py`. Everything after that trigger — waiting for auth, extracting data, saving results — should use `chrome_utils`.

---

## Excel Automation Skills

When generating `run.py` for a skill that involves Excel file operations, always import and use functions from `python/scripts/automation/excel_utils.py`. Do not write raw openpyxl or pandas code — use the pre-built utilities to ensure consistent behavior across model updates.

```python
from excel_utils import open_or_create, get_or_create_sheet, append_rows, save_workbook

wb = open_or_create("~/Downloads/data.xlsx")
sheet = get_or_create_sheet(wb, "Sheet1")
append_rows(sheet, records)          # records is list[dict] (chrome_utils output can be passed directly)
save_workbook(wb, "~/Downloads/data.xlsx")
```

Available functions:

| Group | Functions |
|-------|-----------|
| File | `open_workbook`, `new_workbook`, `open_or_create`, `save_workbook` |
| Sheet | `get_sheet`, `get_or_create_sheet`, `list_sheets` |
| Read | `read_all`, `read_column`, `find_row`, `get_last_row` |
| Write | `write_cell`, `append_row`, `append_rows`, `update_row` |
| Aggregate | `sum_column`, `count_column`, `filter_rows`, `aggregate` ※ uses pandas |
| Convert | `from_records`, `to_records`, `from_csv` |

`append_rows` accepts `list[dict]` directly — the same format returned by `chrome_utils.get_structured_list`, so Web-to-Excel workflows need no intermediate conversion.

---

## Skill Isolation

Skills operate independently. The following rules apply to all skills.

**Prohibited:**
- Reading another skill's SKILL.md or source files directly
- Modifying another skill's implementation
- Passing data between skills through any location other than `files/` or `tmp/`

**Permitted:**
- Invoking another skill as a sub-agent and receiving only its output result
- Exchanging data via files in `files/` or `tmp/`

---

## Long-Running Commands

Before executing a long-running command (download, install, build, etc.), tell the user:
「処理中です。しばらくお待ちください。 / Processing… Please wait.」

The "shell awaiting input" indicator may appear — no user action is needed.

**Truncate long output:** When a command may produce many lines, limit what enters the context:
- Mac/Linux: `command 2>&1 | tail -40`
- Windows: `command 2>&1 | Select-Object -Last 40`

---

## Output Constraints

**Language:** All user-facing responses must be **bilingual — Japanese first, then English on the next line**. No exceptions.

**Style:**
- No greetings, pleasantries, or preamble before answering.
- No step-by-step narration before acting — act, then report the result.
- No post-execution summaries or follow-up questions ("Is there anything else?").
- Answer directly and concisely. Terminate output immediately after the task is complete.
