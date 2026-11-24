# agent-deck 強制アップデート（一度だけ使うもの）/ One-time Forced Update

**対象:** agent-deck **v0.2.2-rc1 以前**（0.1.2-rc6、0.2.0、0.2.1 など）を使っている方。
これらの版はアプリの Update メニューからの更新が失敗します（「venv not found」など）。このスクリプトで一度だけ更新すれば、以降は Update メニューで更新できるようになります。

**Who needs this:** anyone on agent-deck **v0.2.2-rc1 or earlier** (0.1.2-rc6, 0.2.0, 0.2.1, …), whose Update menu fails (e.g. "venv not found"). Run this once; afterwards the normal Update menu works.

## 使い方 / How to use

1. agent-deck を終了します。/ Quit agent-deck.
2. このフォルダ（`migration`）を、agent-deck のフォルダ（`agent-deck.app` / `agent-deck.exe` があるフォルダ）の中に置きます。別の場所に置いた場合は、実行時に agent-deck のフォルダをウィンドウにドラッグするよう求められます。
   Put this `migration` folder inside your agent-deck folder (the one with `agent-deck.app` / `agent-deck.exe`). If you put it elsewhere, you'll be asked to drag the agent-deck folder into the window.
3. ダブルクリックします / Double-click:
   - **Mac:** `Update_agent-deck_for_Mac.command`
     「開発元を確認できないため開けません」と出たら、ファイルを **右クリック →「開く」** を選んでください。
     If macOS says it can't verify the developer, **right-click → Open** instead.
   - **Windows:** `Update_agent-deck_for_Windows.bat`
     「Windows によって PC が保護されました」と出たら **「詳細情報」→「実行」** を選んでください。
     If SmartScreen appears, choose **More info → Run anyway**.
4. 「1) 正式版」か「2) テスト版」を選びます（Enter だけなら正式版）。/ Choose 1 (production, default) or 2 (test).
5. 「完了」と表示されたら、agent-deck を起動します。/ When it says Done, start agent-deck.

Python の環境（`venv/`）が壊れている場合（Homebrew の Python を更新した後など）は、`venv.broken-日時` に退避して一時的な環境で更新します。退避した `venv` は次回の起動時に自動で作り直されます（初回起動と同じく数分かかります）。問題なく起動できたら `venv.broken-…` は削除して構いません。
If the Python environment (`venv/`) is broken (e.g. after a Homebrew Python upgrade), it's moved aside to `venv.broken-<date>` and the update runs from a temporary environment; `venv` is rebuilt automatically on the next launch (takes a few minutes, like the first launch). Once the app starts fine you can delete `venv.broken-…`.

`files/`・自作スキル（`python/skills-personal/`）はそのまま残ります。`config.toml` は組織の設定で更新されます。
Your `files/` and personal skills (`python/skills-personal/`) are kept; `config.toml` is refreshed with the org's settings.

## 仕組み / How it works

更新処理は、インストール済みの `python/scripts/setup/self_update.py` が実行します。v0.2.2-rc1 以前のこのファイルは、インストール先を `<フォルダ>/python` と取り違えるバグがあるため、修正版を配っても古い版からは更新できません。`migrate_to_latest.py` は、そのインストール済みの更新処理に正しいインストール先を教えてから実行するだけで、ファイルは事前に書き換えません。更新で `self_update.py` も修正版に置き換わります。

The update is performed by the installed `python/scripts/setup/self_update.py`, which in v0.2.2-rc1 and earlier mistakes `<folder>/python` for the install folder — so no newer build can fix an old install by itself. `migrate_to_latest.py` just runs that installed updater with the correct install folder; nothing is edited beforehand, and the update replaces `self_update.py` with the fixed one.
