---
name: update
description: Checks GitHub Releases for a newer agent-deck version and installs it. "update", "アップデート", "最新版を確認", "agent-deckを更新して" などで起動。 / Checks GitHub Releases for a newer agent-deck build and installs it if found.
---

# /update — agent-deck の更新 / Update agent-deck

## 言語設定 / Language Policy
ユーザーへの全ての返答は日英バイリンガルで表示してください。日本語を先に表示し、改行の後に英語を続けてください。
Always respond to the user in both Japanese and English. Display Japanese first, then English on the next line.

## 概要 / Overview

agent-deck の GitHub Releases（`kh813/agent-deck`）を確認し、現在インストールされているバージョンより新しいものがあればダウンロードして置き換えます。実行中の agent-deck 自体を書き換えるわけではないため、更新適用後はウィンドウを再起動する必要があります。
Checks agent-deck's GitHub Releases (`kh813/agent-deck`) and, if a newer version exists, downloads and installs it in place. This does not hot-swap the running process, so a restart is required to use the new version after applying an update.

## サブコマンド / Subcommands

| コマンド | 内容 |
|---|---|
| `python3 python/scripts/setup/self_update.py check` | 更新の有無だけを確認（ダウンロードしない） |
| `python3 python/scripts/setup/self_update.py apply` | 最新版を確認し、あればダウンロード・インストール |

Windowsでは `python3` を `python` に読み替えてください。
On Windows, replace `python3` with `python`.

このスキルに `--test` / `--prod` のようなチャンネル切り替えフラグはありません（Google Drive経由の旧アップデート方式にあった概念です）。ユーザーがそうしたフラグを付けて呼び出した場合は無視し、常に `check` から開始してください。
This skill has no `--test`/`--prod` channel-switching flags (that was a concept from the old Google-Drive-based update mechanism). If the user includes such a flag, ignore it and always start with `check`.

## 手順 / Workflow

ユーザーが `/update` と言った場合、まず `check` を実行して更新の有無を確認します：
When the user says `/update`, first run `check` to see if an update is available:

```bash
python3 python/scripts/setup/self_update.py check
```

出力が `Already up to date: <tag>` の場合はそのままユーザーに伝えて終了します。
If the output is `Already up to date: <tag>`, report that and stop.

出力が `Update available: <old> -> <new>` の場合は適用してよいか確認し、承諾されたら `apply` を実行します：
If the output is `Update available: <old> -> <new>`, ask for confirmation, then on approval run:

```bash
python3 python/scripts/setup/self_update.py apply
```

## 完了後の案内 / Post-Update Instructions

`apply` の出力に "installed to" が含まれる場合、以下をユーザーに伝えてください：
If `apply`'s output contains "installed to", tell the user:

「更新が完了しました。新しいバージョンを使うには、このウィンドウを閉じて agent-deck を再起動してください。」
"The update is complete. Please close this window and restart agent-deck to use the new version."

## エラー対応 / Error Handling

ネットワークエラーやGitHub APIのレート制限に達した場合、`self_update.py` は例外を送出して終了します。エラーメッセージをそのままユーザーに伝え、しばらく待ってから再試行するよう案内してください。
On network errors or GitHub API rate limiting, `self_update.py` exits with an exception. Show the error message as-is and suggest retrying after a while.

`python3 python/scripts/setup/self_update.py check` が "No such file or directory" で失敗した場合、現在の作業ディレクトリがプロジェクトルートではありません（以前のコマンドで `cd` した後戻していない等）。`self_update.py` 自身は自分のファイルパスからプロジェクトルートを算出するため、cwdに依存せず**どこから実行しても正しく動作します** — 見つけて実行するだけで構いません。ホームディレクトリ全体を検索しない（別プロジェクトの同名ファイルを誤って実行するおそれがあります）。まず現在のディレクトリから浅い階層を探し、見つからなければ一段上から探してください：
If `python3 python/scripts/setup/self_update.py check` fails with "No such file or directory", the current working directory isn't the project root (e.g. an earlier command `cd`'d away and didn't return). `self_update.py` itself computes its project root from its own file path, so it **works correctly regardless of cwd** — just find it and run it. Don't search the whole home directory (risks matching a same-named file from an unrelated project). Search a shallow depth from the current directory first, then one level up if needed:

```bash
found=$(find . -maxdepth 4 -path "*/python/scripts/setup/self_update.py" 2>/dev/null | head -1)
if [ -z "$found" ]; then
  found=$(find .. -maxdepth 5 -path "*/python/scripts/setup/self_update.py" 2>/dev/null | head -1)
fi
python3 "$found" check
```

Windowsでは同じ考え方を PowerShell の `Get-ChildItem -Recurse` で代用してください（例: `Get-ChildItem -Path . -Recurse -Depth 4 -Filter self_update.py -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`）。
On Windows, use the equivalent approach with PowerShell's `Get-ChildItem -Recurse` (e.g. `Get-ChildItem -Path . -Recurse -Depth 4 -Filter self_update.py -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`).
