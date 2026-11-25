"""Save a Google login into the automation browser profile.

`automate.py update-user-data` -- used by ask-portal and the other
Chrome-driven skills when their saved session has expired. This used to
live only inside the download-*-users catalog skills' download.py, so once
those were dropped from the org's standard skills the command no longer
existed (confirmed 2026-11-25: ask-portal's "run update-user-data" advice
pointed at a missing script). It now ships with agent-deck itself.

Opens the browser (system Chrome, or Playwright's bundled Chromium when
macOS won't launch Chrome -- see common.get_chrome_executable), waits for
the Google Cloud Search box, which only renders after a successful login,
and closes the browser automatically so nothing waits on a manual close.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import sync_playwright  # noqa: E402

from common import get_chrome_executable, get_user_data_dir  # noqa: E402

CLOUDSEARCH_TOP = "https://cloudsearch.google.com/cloudsearch"
LOGIN_TIMEOUT_MS = 600_000  # 10 minutes


def main() -> int:
    print("ブラウザを開きます。社内 Google アカウントでログインしてください。")
    print("Opening the browser. Log in with your company Google account.")
    print(f"  {CLOUDSEARCH_TOP}")
    print()
    executable = get_chrome_executable()
    authenticated = False
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            get_user_data_dir(),
            headless=False,
            executable_path=executable,
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-infobars",
                "--disable-blink-features=AutomationControlled",
            ],
            ignore_default_args=["--enable-automation"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(CLOUDSEARCH_TOP)
        print("──────────────────────────────────────────────────────────────────")
        print("  ログイン完了後、ブラウザは自動的に閉じます。")
        print("  The browser closes automatically after you log in.")
        print("──────────────────────────────────────────────────────────────────")
        try:
            # URL checks alone give false positives (goto() can settle on
            # cloudsearch.google.com before the JS redirect to the login page).
            page.wait_for_selector('input[aria-label="Search"]', timeout=LOGIN_TIMEOUT_MS)
            try:
                # Let the session cookies reach disk before closing.
                page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                page.wait_for_timeout(5_000)
            authenticated = True
        except Exception:
            print()
            print("[WARN] タイムアウト（10分）。ログインが完了していない可能性があります。")
            print("[WARN] Timed out (10 min). Login may not have completed.")
        try:
            context.close()
        except Exception:
            pass
    if authenticated:
        print("✓ セッションが保存されました。次回から自動ログインになります。")
        print("✓ Session saved. Automated runs will be logged in from now on.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
