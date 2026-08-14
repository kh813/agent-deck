---
name: google-workspace
description: gws CLI（Google Workspace CLI、非公式OSS）を使ってGmail・Drive・Calendar・Sheets・Docsを操作します。「メールを送って」「受信トレイを確認」「予定を追加して」「スプレッドシートに書き込んで」「Driveのファイルを検索して」などと言われたときに使用。このプロジェクトの [gws] enabled = true が設定済みの場合のみ動作します。Operates Gmail/Drive/Calendar/Sheets/Docs via the gws CLI (unofficial OSS). Use for "send an email", "check my inbox", "add an event", "write to this spreadsheet", "search Drive". Only works when this project's [gws] enabled = true.
---

# Google Workspace 連携 / Google Workspace Integration

## 言語設定 / Language Policy
ユーザーへの全ての返答は日英バイリンガルで表示してください。日本語を先に表示し、改行の後に英語を続けてください。
Always respond to the user in both Japanese and English. Display Japanese first, then English on the next line.

## 概要 / Overview

[`gws`](https://github.com/googleworkspace/cli)（Google 公式プロダクトではない OSS — README に明記）を使って、Gmail・Drive・Calendar・Sheets・Docs をコマンドラインから操作します。`app/bin/` にインストール済みなので、agy のシェルからは素の `gws` コマンドとして直接呼び出せます。既存の Drive/Calendar 直接 API 連携（`daily-schedule` スキルなど）とは完全に別経路・独立で、こちらは `config.toml` の `[gws] enabled = true` を管理者が明示的に設定している場合のみ使えます。

Uses [`gws`](https://github.com/googleworkspace/cli) (an unofficial OSS tool, not a Google product — see its README) to operate Gmail, Drive, Calendar, Sheets, and Docs from the command line. It's installed at `app/bin/`, so agy's shell can call it directly as `gws`. This is a completely separate path from the existing direct-API Drive/Calendar integrations (e.g. the `daily-schedule` skill) — it only works when an admin has explicitly set `[gws] enabled = true` in `config.toml`.

## 事前確認 / Preflight Check

初回、または動作が怪しい場合は認証状態を確認する:
On first use, or if something seems off, check auth status:

```bash
gws auth status
```

`"auth_method": "none"` または `client_config_exists: false` の場合、`gws` は未設定またはブラウザ認可が未完了です。ターミナル操作に不慣れなユーザーのために、以下を実行してターミナルを自動で開いて`gws auth login`を実行してください:

```bash
python3 python/skills/google-workspace/scripts/open_gws_auth_login.py
```

これは新しいTerminal（macOS）/ cmd.exe（Windows）ウィンドウを開いて`gws auth login`を実行するだけです。**ブラウザでの実際の同意操作（アカウント選択・許可ボタン）はユーザー自身が行う必要があります**（エージェントが代行してブラウザ認可を完了させることはできません）。実行したら、ユーザーに「新しく開いたターミナルウィンドウとブラウザで、ログイン・許可を完了してください」と伝えてください。管理者向けの有効化手順は `docs/admin_guide.md` §15 を参照。

If `"auth_method": "none"` or `client_config_exists: false`, `gws` is not configured or hasn't completed browser consent yet. For users unfamiliar with a terminal, run this to open one automatically and start `gws auth login` there:

```bash
python3 python/skills/google-workspace/scripts/open_gws_auth_login.py
```

This only opens a new Terminal (macOS) / cmd.exe (Windows) window and runs `gws auth login` in it. **The actual browser consent (choosing an account, clicking Allow) still requires the user's own action** (the agent cannot complete browser consent on their behalf). After running it, tell the user to complete the sign-in in the newly-opened terminal window and browser. See `docs/admin_guide.md` §15 for the admin-side enable steps.

## よくある操作 / Common Operations

| やりたいこと / Task | コマンド / Command |
|---|---|
| 未読メールの概要 / Unread inbox summary | `gws gmail +triage` |
| メール送信 / Send an email | `gws gmail +send --to "a@example.com" --subject "件名" --body "本文"` |
| メール返信 / Reply to a message | `gws gmail +reply --message-id MESSAGE_ID --body "本文"` |
| 今日の予定 / Today's agenda | `gws calendar +agenda` |
| 予定追加 / Create an event | `gws calendar +insert --summary "件名" --start '2026-06-17T09:00:00+09:00' --end '2026-06-17T09:30:00+09:00'` |
| スプレッドシート読み取り / Read a spreadsheet | `gws sheets +read --spreadsheet SPREADSHEET_ID --range 'Sheet1!A1:C10'` |
| スプレッドシートに1行追加 / Append a row | `gws sheets +append --spreadsheet SPREADSHEET_ID --values "値1,値2"` |
| Docsに追記 / Append text to a Doc | `gws docs +write --document DOCUMENT_ID --text "追記するテキスト"` |
| Driveファイル検索 / Search Drive files | `gws drive files list --params '{"q": "name contains '\''<キーワード>'\''", "pageSize": 10}'` |
| Driveにアップロード / Upload to Drive | `gws drive +upload ./report.pdf --name "Q1 Report"` |

各サービスの全コマンドは `gws <service> --help`（認証不要、オフラインで確認可能）。
See `gws <service> --help` for the full command list per service (works offline, no auth needed).

## 実行前の確認 / Confirm Before Acting

メール送信・予定作成（特に他の参加者を招待する場合）・ファイルのアップロードなど、**他者に見える／取り消しにくい操作**は、実行前に内容（宛先・件名・本文・日時など）をユーザーに提示し、明示的な確認を得てから実行してください。読み取り専用の操作（`+triage`・`+agenda`・`+read`・`files list` など）はこの限りではありません。迷ったら `--dry-run` を付けて実際に送信せずリクエスト内容を確認できます。

For actions that are **visible to others or hard to undo** — sending email, creating calendar events (especially with attendees), uploading files — show the user the details (recipients, subject, body, time, etc.) and get explicit confirmation before running the command. Read-only operations (`+triage`, `+agenda`, `+read`, `files list`, etc.) don't need this. When unsure, use `--dry-run` to preview the request without actually sending it.

## Google Sheets のシェルエスケープ注意 / Shell Escaping for Sheets

`range` の `!` は bash のヒストリ展開と衝突するため、必ずシングルクォートで囲む: `'Sheet1!A1:C10'`。
`!` in a range triggers bash history expansion — always wrap the value in single quotes: `'Sheet1!A1:C10'`.

## エラー対応 / Error Handling

エラーが発生した場合、**`python/` 以下のソースコードを変更せずに**、エラー内容をそのままユーザーに報告してください。
If an error occurs, **do not modify any source files under `python/`** — report the error message to the user as-is.

| エラー / Error | 対処 / Fix |
|---|---|
| `gws: command not found` | この機能が無効です。管理者に `docs/admin_guide.md` §15 の有効化手順を確認してもらってください / This feature isn't enabled — ask an admin to follow the enable steps in `docs/admin_guide.md` §15 |
| `"auth_method": "none"` / `No OAuth client configured` | 上記「事前確認」の通り `open_gws_auth_login.py` を実行してターミナルを開く / Run `open_gws_auth_login.py` per "Preflight Check" above to open a terminal |
| `Access blocked`（ログイン時）/ "Access blocked" during login | OAuth 同意画面のテストユーザーにアカウントが追加されていない。管理者に確認を依頼 / The account isn't added as a test user on the OAuth consent screen — ask an admin |
| スコープ不足のエラー / Scope-related error | `python3 python/skills/google-workspace/scripts/open_gws_auth_login.py <services>`（カンマ区切り）で必要なサービスを指定して再認可 / Re-run `open_gws_auth_login.py <services>` (comma-separated) naming the needed services |

## 使用例 / Examples

- 「今日の未読メールを教えて」→ `gws gmail +triage`
- 「田中さんに明日の会議についてメールして」→ 宛先・件名・本文をユーザーに確認 → `gws gmail +send ...`
- 「来週火曜10時に定例MTGを入れて」→ 日時・参加者を確認 → `gws calendar +insert ...`
- 「このスプレッドシートのA1:C10を見せて」→ `gws sheets +read ...`
