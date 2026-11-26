# agent-deck 利用ガイド / agent-deck User Guide

このツールは、対話形式でさまざまな業務を自動化・効率化するツールです。スライド作成・スケジュール確認などを、AI との会話で操作できます。
This tool automates and streamlines various business tasks through natural language dialogue. You can create slides, check your schedule, and more — just by talking to the AI.

---

## 1. 利用前の準備 / Prerequisites

お使いのパソコンに以下のソフトがインストールされていることを確認してください。
Please ensure the following software is installed on your computer.

- **Python 3**（Mac のみ / Mac only）: ツールの実行に必要です。Windows は初回起動時に自動でセットアップされます。 / Required to run the tool on Mac. On Windows, this is set up automatically on first launch.
- **Google Chrome**: ブラウザ自動化やダウンロード操作に使用します。 / Used for browser automation and download operations.

> **Antigravity CLI (`agy`) は事前にインストールする必要はありません。** 未インストールの場合、初回起動時に画面の案内に従って「インストール」ボタンをクリックするだけで導入できます。
> **Antigravity CLI (`agy`) does not need to be installed in advance.** If it's missing, just click the "Install" button shown on first launch to set it up.

### Google Workspace アカウントの認証 / Google Workspace Authentication

このツールは**会社の Google Workspace アカウント**でのみ使用できます。
This tool must be used with your **company Google Workspace account**.

**初回起動時のみ**、ツールがブラウザを開いてサインインを求めます。
**On first launch only**, the tool opens a browser and prompts you to sign in.

> 初回起動時は、Chrome のサインイン画面が**2回連続で表示されることがあります**（1回目: スキルカタログ用の Google Drive アクセス、2回目: Antigravity CLI (`agy`) 自体のサインイン）。どちらも正常な動作で、初回のみです。同じ会社の Google アカウントでサインインしてください。
> On first launch, Chrome's sign-in screen **may appear twice in a row** (once for skill-catalog Google Drive access, once for Antigravity CLI (`agy`)'s own sign-in). Both are expected and only happen once. Sign in with the same company Google account both times.

> 必ず会社のアカウントでサインインしてください。個人の Gmail アカウントは使用しないでください。
> Always sign in with your company account. Do not use a personal Gmail account.

**再認証が必要になった場合 / If re-authentication is needed:**

ツールを再起動してください。起動時に自動的にサインイン画面が開きます。会社のアカウントでサインインしてください。
Restart the tool. The sign-in screen will open automatically on launch. Sign in with your company account.

---

## 2. セットアップ手順 / Setup

### ステップ 1：ZIPファイルを展開する / Step 1: Extract the ZIP file

1. 管理者から受け取った ZIP ファイル（アプリ本体）と `config.toml`（設定ファイル）を用意します。
   Prepare the ZIP file (the app itself) and `config.toml` (the config file) provided by your administrator.
2. ZIP ファイルを右クリックし、「すべて展開」または「展開」を選んで解凍します。
   Right-click the ZIP file and select "Extract All" or "Extract" to unzip it.
3. 解凍してできたフォルダ（`agent-deck`）を、デスクトップなど分かりやすい場所に保存します。
   Save the extracted folder (`agent-deck`) in an easy-to-find location such as your Desktop.
4. 受け取った `config.toml` を、そのフォルダの一番上の階層（`agent-deck.app`/`agent-deck.exe` と同じ場所）にコピーします。
   Copy the `config.toml` you received into the top level of that folder (the same location as `agent-deck.app`/`agent-deck.exe`).

### ステップ 2：ツールを起動する / Step 2: Launch the tool

**Mac の場合（初回のみ） / Mac — first time only:**

macOS のセキュリティ機能により、初回だけ以下の手順が必要な場合があります。
macOS security may require a one-time procedure on first launch.

1. `agent-deck.app` をダブルクリックします。「開発元を確認できないため開けません」というダイアログが出たら「**OK**」を押して閉じます。
   Double-click `agent-deck.app`. If a warning about an unidentified developer appears, click **OK** to dismiss.
2. Apple メニュー →「**システム設定**」→「**プライバシーとセキュリティ**」を開き、下にスクロールします。
   Open Apple menu → **System Settings** → **Privacy & Security** and scroll down.
3.「"agent-deck" はブロックされました」の横の「**このまま開く**」をクリックし、パスワードまたは Touch ID で認証します。
   Click **"Open Anyway"** next to the blocked entry and authenticate.
4. 再度ダイアログが出たら「**開く**」をクリックします。
   Click **Open** in the confirmation dialog.

> 2回目以降は `agent-deck.app` を**ダブルクリック**するだけで起動します。
> From the second launch onwards, simply **double-click** `agent-deck.app`.

**Windows の場合 / Windows:**

`agent-deck.exe` をダブルクリックしてください。
Double-click `agent-deck.exe`.

---

初回起動時は以下が自動で実行されます。画面にセットアップの進行状況が表示されます。
On first launch, the following steps run automatically. Setup progress is shown on screen.

1. **必要なプログラムのセットアップ**（Python 環境・スライド変換ソフトなど）
   **Required program setup** (Python environment, slide conversion tool, etc.)
2. **スキルの導入** — 組み込みスキル・組織固有スキル（設定されている場合）が自動的に取り込まれます。
   **Skill installation** — built-in skills, plus any org-specific skills (if configured), are pulled in automatically.
3. **Antigravity CLI (`agy`) のインストール**（見つからない場合、画面の案内に従ってクリック1つでインストールできます）
   **Antigravity CLI (`agy`) installation** (if not found, a one-click install prompt appears)
4. **Google アカウントのサインイン** — ブラウザが開きます。会社のアカウントでサインインしてください。
   **Google account sign-in** — a browser window opens. Sign in with your company account.

> ※ これらの作業は最初の1回だけ行われます。2回目以降はすぐに起動します。
> These steps only run once. Subsequent launches start immediately.
>
> ⏱ **Windows は初回のみ数分かかることがあります。** Python 環境のダウンロードが発生するためです。
> ⏱ **Windows first launch can take a few minutes.** This is due to downloading the Python environment.

---

## 2.5 基本的な操作方法とエンジンの切り替え / Basic Operations & Engine Selection

### 🤖 動作エンジン（Agent）の切り替え / Switching Engines
デフォルトでは `agy` (Antigravity CLI) が使用されますが、ローカル環境に以下のエージェントがインストールされている場合、ヘッダーの「エージェント / Agent」ドロップダウンから切り替えることができます。
By default `agy` (Antigravity CLI) is used; if any of the agents below are installed, switch between them from the "Agent" dropdown in the header.
* **`agy`**: 標準の Antigravity CLI エンジン。
* **`claude`**: Claude Code エンジン（スキル・`/スキル名` もそのまま使えます / skills and `/skill-name` work as-is）。
* **`codex`**: Codex CLI エンジン。

最後に選んだエンジンは次回起動時にも使われます。選んでいたエンジンが見つからない場合は、インストール済みのエンジンに自動で切り替わります。
The engine you picked last is used again on the next launch. If it's no longer installed, agent-deck switches to one that is.

> [!NOTE]
> Claude Code の初回起動時に表示される「このフォルダを信頼しますか？」や、コマンド実行・ファイル編集の許可確認（`1. Yes / 2. … / No` の番号付きメニュー）は、画面下部のボタンから選んで応答できます（ターミナル上で直接答えることもでき、どちらで答えても、もう一方の確認表示も消えます）。Claude Code が未インストールの場合は、起動時の画面からインストールできます（管理者権限は不要です）。
> Claude Code's first-run "trust this folder?" dialog and its command/edit permission menus (`1. Yes / 2. … / No`) can be answered with the buttons at the bottom of the screen (or directly in the terminal -- answering in either place also clears the other). If Claude Code isn't installed yet, it can be installed from the startup screen (no admin rights needed).
>
> Claude Code の配色はアプリのテーマ（ライト／ダーク）に自動で合わせます（agent-deck 内でのみ。普段ターミナルで使う Claude Code のテーマ設定は変わりません）。テーマを切り替えたときは、セッションを開始し直すと反映されます。
> Claude Code's colors follow the app's light/dark theme (inside agent-deck only -- your own Claude Code theme setting is untouched). After switching themes, restart the session to apply it.

> [!IMPORTANT]
> 誤作動やセッションの不整合を防ぐため、セッション実行中（`RUNNING` 状態）は、ドロップダウンおよびメニューバーからのエンジン切り替えはロック（Disabled）されます。エンジンを切り替える場合は、一度「停止 / Stop」をクリックしてセッションを終了してください。

### 📂 作業フォルダの変更と履歴 / Working Folder & History
ヘッダーの「作業フォルダ / Working folder」欄をクリックすると、フォルダを選んで作業フォルダを変更できます（セッション実行中は変更できません）。
Click the "Working folder" field in the header to pick a different folder (not while a session is running).

一度選択した作業フォルダは、最大5件まで「最近使ったフォルダ」として自動保存されます。作業フォルダ欄の右隣にある `▼` ボタンから、過去のフォルダへワンクリックで移動できます。
Up to 5 recently used folders are remembered; the `▼` button next to the field switches back to one in a click.

### 📄 SKILL.md のプレビューと編集 / Previewing & Editing SKILL.md
選択した作業ディレクトリ内に `SKILL.md`（または `skill/SKILL.md`）が存在する場合、ヘッダーに以下のボタンが自動的に表示されます。
* **`SKILL.md プレビュー`**: クリックすると、アプリ内のポップアップモーダルで指示書（SKILL.md）の内容を即座に確認できます。
* **`エディタで編集`**: クリックすると、お使いの OS に規定されているテキストエディタ（VS Code やメモ帳など）が立ち上がり、直接 `SKILL.md` を書き換えることができます。

> [!NOTE]
> `agy` 以外のエンジン（Claude Code等）を使用している場合、セッション開始時にこの `SKILL.md` の記述が**最初のメタプロンプトとして自動的に注入**され、エージェントへタスク指示が送られます。

### 📎 画像（スクリーンショット）やファイルを渡す / Handing Over Images & Files (v0.2.8+)
スクリーンショットをコピーして、ターミナル画面または下の入力欄に貼り付けると（Mac は `Cmd+V`、Windows は `Ctrl+V`）、画像が作業フォルダの `tmp/screenshots/` に保存され、そのファイルの場所が入力されます。続けて「この画面のエラーを説明して」のように指示を書き、Enter で送信してください。agy・Claude Code のどちらでも使えます。ファイルをウィンドウにドラッグ＆ドロップすると、そのファイルの場所が入力されます（画像以外も可）。
Copy a screenshot and paste it into the terminal or the input bar (`Cmd+V` on Mac, `Ctrl+V` on Windows): the image is saved to `tmp/screenshots/` in the working folder and its path is typed in. Add your instruction (e.g. "explain the error on this screen") and press Enter. Works with both agy and Claude Code. Dragging files onto the window types their paths (any file type).

**入力欄の「🖼 画像」ボタン（v0.2.9〜）/ The "🖼 Image" button (v0.2.9+):** 画面下の入力欄で「🖼 画像」を押すと、「スクリーンショットを貼り付け」（クリップボードの画像）か「画像ファイルを選択…」（複数可）を選べます。選んだ画像は入力欄の上に表示され（× で外せます）、指示文と一緒に「送信」で送られます。例: スクリーンショットを貼り付けて「エラーの原因を教えて」と入力し、送信。入力欄に画像を直接貼り付けても同じように添付されます。貼り付けたスクリーンショットは `tmp/screenshots/` に保存され 7 日後に自動で削除されます。選択した画像ファイルはコピーせず、その場所をそのまま AI に渡します。
Press "🖼 Image" in the input bar to "Paste screenshot" (from the clipboard) or "Choose image files…" (several allowed). The images appear above the input (× removes one) and are sent with your text by "Send" -- e.g. paste a screenshot, type "what's causing this error?", Send. Pasting an image straight into the input bar attaches it too. Pasted screenshots are saved to `tmp/screenshots/` and deleted automatically after 7 days; chosen image files are not copied -- the AI reads them where they are.

> 保存した画像は 7 日後に自動で削除されます。同じ画像を何度貼り付けても 1 つだけ保存され、大きな画像は自動で縮小されます（長辺 2000px）。Windows では、ターミナル画面で `Ctrl+V` による文字の貼り付けもできるようになりました。
> Saved images are deleted automatically after 7 days. Pasting the same image again reuses the saved file, and large images are scaled down (2000px on the long side). On Windows, `Ctrl+V` now also pastes text in the terminal.

### 🧭 メニューの構成 / Menu Layout (v0.2.8+)
| メニュー / Menu | 主な項目 / Main items |
|---|---|
| File | Force Kill Session、Close Window（Windows は Quit も） |
| Edit | コピー・貼り付けなど / Copy, Paste, ... |
| View | Theme（配色）、Font（フォント・文字サイズ）、Language / 言語（表示言語）（Mac は全画面表示も） |
| Window | 最小化など / Minimize, ... |
| Settings | Update to Latest... / Update to Test Release...（アップデート）、Check for Updates Automatically（自動チェック） |
| Help | バージョン表示 / Version |

### 🌐 表示言語 / Display Language
画面の表示は日本語と英語に対応しています。通常は OS の言語設定（Windows では表示言語または地域設定のどちらかが日本語なら日本語）に合わせて自動で切り替わります。メニューの「`View` ➔ `Language / 言語`」で「日本語」「English」を固定することもできます（「Automatic (OS) / 自動」で元に戻ります）。
The UI is available in Japanese and English. By default it follows the OS (on Windows, Japanese if either the display language or the regional format is Japanese). Pin it with `View` ➔ `Language / 言語` ("日本語" / "English"; "Automatic (OS) / 自動" goes back to following the OS).

### 🎨 コードの色付け / Syntax Highlighting
agy・Claude Code が表示するコードの色付け（キーワード・関数名・数値など）は、どのテーマでも本文と見分けられる色で表示されます（v0.2.8 で Solarized・Light テーマの配色を調整）。色合いはテーマ（`View` ➔ `Theme`）によって変わります。
Code colors shown by agy and Claude Code (keywords, function names, numbers, ...) stay distinguishable from plain text on every theme (Solarized and Light palettes adjusted in v0.2.8). The exact hues follow the theme (`View` ➔ `Theme`).

### 💭 AI の思考過程の表示 / How AI Thinking Is Shown
AI の思考過程（agy の考え中の要約や「Thought for …」、Claude Code の補足表示）は、回答本文より淡いグレーで表示され、目立たないようになっています。思考の詳細はどちらのエンジンも折りたたまれており、回答だけを読めば済むようになっています。
The AI's thinking (agy's live summary and "Thought for …", Claude Code's side notes) is shown in a lighter gray than the answer, so it stays in the background. Both engines keep the detailed thinking collapsed, so you only need to read the answer.

### 🔤 ターミナルのフォントと文字サイズ / Terminal Font & Size

メニューバーの **View → Font** から、ターミナルの表示フォントと文字サイズを変更できます（すぐに反映され、次回起動時も保持されます）。
Use **View → Font** in the menu bar to change the terminal's font and size (applied immediately and remembered across launches).

| メニュー / Menu | 内容 / What it does |
| :--- | :--- |
| **Font Family** | フォントを選択（Mac: Menlo / Monaco / SF Mono / Osaka 等幅 など、Windows: Consolas / Cascadia Mono / MS ゴシック / BIZ UDゴシック など）。**Default** は管理者が設定した標準フォント / Pick a font; **Default** = the font set by your administrator |
| **Font Size** | 文字サイズを選択、または **Increase / Decrease**（`⌘` / `Ctrl` + `=` / `-`）で 1 ずつ変更（8〜32） / Pick a size, or step it with Increase/Decrease (8–32) |
| **Reset Font to Default** | フォントと文字サイズを標準に戻す（`⌘` / `Ctrl` + `0`） / Back to the standard font and size |

> PC にインストールされていないフォントを選んだ場合は、標準の等幅フォントで表示されます。
> If the chosen font isn't installed on this PC, a standard monospace font is used instead.

### ⚡ セッションの強制終了 (SIGKILL) / Force Kill Session
エージェントの処理がフリーズしたり無限ループに陥った場合は、画面上部のメニューバーから「`File` ➔ `Force Kill Session`」を選択することで、実行中のプロセスグループ（子プロセスや孫プロセスを含む）を完全に強制終了させ、即座にチャット入力を受け付ける状態に戻すことができます。

### 終了時の確認 / Confirmation on Quit (v0.2.8+)
スキルの実行中やエージェントの応答中（画面が動いている間）、またはアップデート・インストール中に `Cmd+Q`（Windows は `Ctrl+Q`）を押したりウィンドウを閉じたりすると、「本当に終了しますか？」と確認されます。入力待ちで止まっているときは確認なしで終了します。
While a skill is running or the agent is responding (the screen is updating), or during an update/install, pressing `Cmd+Q` (`Ctrl+Q` on Windows) or closing the window asks "Quit anyway?" first. When the agent is idle at its prompt, it quits right away.

---

## 3. スキルの使い方 / How to Use Skills

ツールが起動したら、会話で操作できます。スキルは**自然な文章**または**スラッシュコマンド（`/スキル名`）**で呼び出せます。
Once the tool launches, you can operate it through conversation. Skills can be invoked with **natural language** or a **slash command (`/skill-name`)**.

### スラッシュコマンド一覧 / Slash Command List

| コマンド / Command | 機能 / Function |
|-------------------|-----------------|
| `/slide-interviewer` | 対話形式でスライドを作成 / Create slides through an interview |
| `/slide-generator` | 用意した内容から直接スライドを生成 / Generate slides directly from prepared content |
| `/daily-schedule` | 今日・今後の予定を確認 / Check today's and upcoming schedule |
| `/file-organizer` | files/ フォルダのファイルを整理 / Organize files in the files/ folder |
| `/gdrive-folder-migrator` | Google Drive フォルダの一括移行 / Bulk migrate a Google Drive folder |
| `/download-from-drive` | Google Drive からファイル・フォルダをダウンロード / Download a file or folder from Google Drive |
| `/upload-to-drive` | ファイル・フォルダを Google Drive にアップロード / Upload a file or folder to Google Drive |
| `/rename-files` | files/ フォルダのファイルを一括リネーム / Bulk-rename files in the files/ folder |
| `/convert-to-markdown` | ファイルを Markdown に変換・分析 / Convert/analyze files as Markdown |
| `/convert-to-pdf` | Word・Excel を PDF に変換（Windows）/ Convert Word/Excel to PDF (Windows) |
| `/translator` | 文章の翻訳・言語判定 / Translate text, detect language |
| `/info-collector` | 指定した情報源から特定項目だけを収集 / Collect specific fields from a given source |
| `/research-assistant` | トピックを指定した自由な調査 / Open-ended topic research |
| `/agy-schedule` | 定型プロンプトの定期実行を設定（agy / Claude Code どちらでも）/ Schedule a recurring prompt (agy or Claude Code) |
| `/notify-chat` | 定期実行の結果を Google Chat に通知する設定 / Set up Google Chat notifications for scheduled runs |
| `/setup` | 環境の初期化・スキル管理 / Setup and skill management |
| `/skill-catalog` | グループ共有のスキルカタログを閲覧・取得 / Browse and import shared skills from the group catalog |
| `/my-skills` | オリジナルスキルの作成・更新・無効化・共有・削除 / Create, update, disable, share, and delete your own skills |

> 組織によっては、上記に加えて社内システム向けの独自スキルが `skill-catalog` 経由で自動導入されている場合があります。その場合は `/my-skills list` で一覧を確認できます（§9参照）。
> Depending on your organization, additional org-specific skills for internal systems may be auto-installed via the skill catalog. If so, you can see them listed via `/my-skills list` (see §9).

**例 / Example:**
```
/daily-schedule
```
または自然な言葉で / or in natural language:
```
今日の予定を教えて
```

---

## 4. スライドの作り方 / Creating Slides

1. 次のように入力してください。
   Type the following.
   ```
   /slide-interviewer
   ```
   （または「スライドの作成を手伝って」と言うだけでもOKです）
   (Or simply say "スライドの作成を手伝って" — that works too.)

2. 「プレゼンの目的は何ですか？」「ターゲットは誰ですか？」といった質問が始まります。
   You'll be asked questions like "What is the purpose of this presentation?" and "Who is the target audience?"

3. 質問に答えていくと、最後に自動的にパワーポイントファイルが生成されます。
   As you answer the questions, a PowerPoint file is automatically generated at the end.

### 生成されたファイルの場所 / Where to find the output file

作成されたパワーポイントファイルは、`agent-deck` フォルダ内の `tmp` フォルダの中に保存されます。
The generated PowerPoint file is saved in the `tmp` folder inside the `agent-deck` folder.

---

## 5. スケジュール確認 / Schedule (Google Calendar)

Google Calendar と Google Tasks から今日・今後の予定を取得して要約します。
Fetches and summarizes today's and upcoming events from Google Calendar and Google Tasks.

1. 「今日の予定を教えて」と入力します（または `/daily-schedule`）。
   Type "今日の予定を教えて" (or `/daily-schedule`).
2. 初回のみ Chrome が開き、Google アカウントでの認証が必要です。
   On first use only, Chrome opens for Google account authentication.
3. 認証後は自動的に予定が取得されます。
   After authentication, events are fetched automatically every time.

### 表示される情報 / What's shown

| 表示 / Display | 内容 / Content |
|----------------|----------------|
| 📅 05/07（木）← 今日 | その日の見出し / Day heading |
| `08:00〜09:00  会議名` | 時間指定の予定 / Timed event |
| `終日  Home` | 終日イベント / All-day event |
| `⚠️ 締め切り` | タイトルに「締め切り」「due」等を含む予定 / Events with deadline keywords |
| `☑ タスク名` | Google Tasks の期限付きタスク / Google Tasks with a due date |
| 🔴 期限切れタスク | 期限が過ぎた未完了タスク / Overdue incomplete tasks |

**使い方の例 / Examples:**
- 「今日の予定を教えて」→ 今日＋3営業日を表示 / Shows today + 3 business days
- 「今後5日間の予定を見せて」→ 今日＋5営業日を表示 / Shows today + 5 business days

> Google Tasks でタスクに**期限を設定**しておくと該当日に表示されます。期限なしのタスクは表示されません。
> Tasks appear on the corresponding day only when a **due date is set** in Google Tasks. Tasks without a due date are not shown.

---

## 6. ファイルの整理 / File Organizer

`files/` フォルダにファイルを入れておくと、会話しながらファイルを自動で仕分けできます。
Place files in the `files/` folder, then organize them interactively through conversation.

### 使い方 / How to use

1. `agent-deck` フォルダ内の `files/` フォルダにファイルをコピーします。
   Copy your files into the `files/` folder inside the `agent-deck` folder.
2. 「ファイルを整理して」と入力します（または `/file-organizer`）。
   Type "ファイルを整理して" (or `/file-organizer`).
3. 整理方法を聞かれます。
   You'll be asked how you want to organize the files.

### 整理方法の選択肢 / Organization options

| 方法 / Method | 内容 / Description |
|---|---|
| 種類別 / By file type | PDF・Excel・Word・画像などの拡張子ごとにフォルダ分け / Separate into folders by extension (PDF, Excel, Word, images, etc.) |
| 日付別 / By date | ファイルの更新日（年月）ごとにフォルダ分け / Separate by modification date (year/month) |
| キーワード別 / By keyword | ファイル名に含まれるキーワードでフォルダ分け / Separate by keywords found in filenames |
| カスタム / Custom | 一つずつ行き先を指定 / Specify the destination for each file individually |

### 例 / Examples
- 「種類別に整理して」→ `files/PDF/`、`files/Excel/` などが自動で作られます。
  "Sort by type" → `files/PDF/`, `files/Excel/`, etc. are created automatically.
- 「請求書と報告書でフォルダを分けて」→ キーワードでフォルダを自動作成します。
  "Separate invoices and reports" → Creates folders using those keywords automatically.

---

## 7. Google Drive フォルダ移行 / Google Drive Folder Migration

指定した Google Drive のフォルダ全体（サブフォルダ・ファイルを含む）を、別の場所（共有ドライブなど）にまとめて移動します。
Moves an entire Google Drive folder — including all subfolders and files — to another location such as a Shared Drive.

1. 「Driveのフォルダを移動して」と入力します（または `/gdrive-folder-migrator`）。
   Type "Driveのフォルダを移動して" (or `/gdrive-folder-migrator`).
2. 移動元・移動先のフォルダ URL を貼り付けます。
   Paste the source and destination folder URLs.
3. スキャン結果（フォルダ数・ファイル数・ショートカット数）を確認し、実行を承認します。
   Review the scan results (folder, file, and shortcut counts) and confirm to proceed.
4. 移行が実行されます。大量のファイルはバッチに分割して処理され、中断・再開が可能です。
   Migration runs automatically. Large folders are split into batches and can be paused and resumed across sessions.

### 移行の動作 / How migration works

| 状況 / Situation | 動作 / Behavior |
|---|---|
| サブフォルダ（移動可能）/ Subfolder (movable) | フォルダごと一括移動（配下一式）/ Moved as a unit with all contents |
| サブフォルダ（移動不可）/ Subfolder (not movable) | 移動先に空フォルダを作成し配下を個別処理 / Created in destination; contents processed individually |
| 通常のファイル / Normal file | 移動先に移動 / Moved to destination |
| オーナーが組織外のファイル / External-owner file | 移動先にコピーし元ファイルを削除 / Copied; original deleted |
| ショートカット / Shortcut | ゴミ箱に移動（30日以内に復元可） / Trashed (restorable within 30 days) |

### 注意事項 / Notes

- 移動先が共有ドライブの場合、**オーガナイザー**以上の権限が必要です。
  If the destination is a Shared Drive, **Organizer** or higher permissions are required.
- コピーされたファイルはバージョン履歴・コメントは引き継がれません。
  Copied files do not retain version history or comments.
- 中断した場合は `/gdrive-folder-migrator` を再実行すると続きから再開できます。
  If interrupted, re-run `/gdrive-folder-migrator` to resume from where it left off.

---

## 8. ブラウザの自然言語操作 / Natural Language Browser Control

話しかけるだけで、Google Chrome を自動で操作できます。スクリプトを書く必要はなく、やりたいことを自然な言葉で伝えるだけで Chrome が動きます。
Just describe what you want, and Chrome is controlled automatically. No scripting needed — describe your goal in natural language.

**例 / Examples:**

```
「Google で "東京 週間天気予報" を検索して」
```
```
「https://example.com を開いてスクリーンショットを撮って」
```
```
「ログインフォームのメールアドレス欄に yamada@example.com と入力して」
```

### 仕様 / Notes

- ブラウザは常に **Google Chrome** が使用されます。デフォルトブラウザの設定に関わらず Chrome が起動します。
  **Google Chrome** is always used, regardless of your default browser setting.
- 認証が必要なサービスは、先にブラウザで手動ログインしておく必要があります。
  For services that require authentication, first log in manually in Chrome.

---

## 9. スキルカタログ — みんなのスキルを使う / Skill Catalog — Use Shared Skills

社員が作ったオリジナルスキルをグループ内で共有するための「スキルカタログ」があります。カタログにあるスキルをダウンロードすれば、自分のツールですぐに使えるようになります。組織固有のスキルが用意されている場合は、このカタログを通じて起動のたびに自動的に導入されます。
The group has a shared "skill catalog" where employees can share their original skills. Download any skill from the catalog to use it in your own tool right away. If your organization has set up org-specific skills, they're auto-installed via this same catalog on every launch.

> **スキルとは？**
> AI に覚えさせた「できること」のことです。たとえば「毎月の報告書を自動で作る」「特定のサービスから情報を取得する」といった操作を、ひとつの名前でまとめたものです。
>
> **What is a skill?**
> A skill is a named task the AI has been taught to perform — for example, "automatically create a monthly report" or "retrieve information from a specific service."

---

### 画面でカタログを使う / Use the Catalog Screen (v0.2.8+)
画面右上の「📚 スキル」ボタンでスキルカタログ画面が開きます。チャットでコマンドを打たなくても、次の操作ができます。
Click "📚 Skills" at the top right to open the Skill Catalog screen, where you can do the following without typing commands.

画面は 3 つのタブに分かれています。 / The screen has three tabs.

- **カタログ / Catalog**: 共有されているスキルを探して追加します。検索欄に入力するとその場で絞り込まれます（スキル名・作成者・説明文が対象。複数キーワードは AND、全角/半角・大文字/小文字は区別しません）。作成者メニュー、またはカードの作成者名をクリックして作成者で絞り込めます。「追加」で自分の PC に入れます（追加済みなら「最新版に更新」）。「詳細」で説明全文を表示。
  Find and add shared skills. The list filters as you type (name, author and description; several keywords must all match; width and case don't matter). Filter by author from the menu or by clicking an author's name. "Add" installs a skill ("Update to latest" if already added). "Details" shows the full description.
- **マイスキル / My Skills**: 自分のスキル（作ったもの、ファイルから読み込んだもの）。
  Your own skills (ones you made or imported from a file).
  - 「＋ 新しいスキル」で作成、「編集」で説明と手順を変更、「削除」で PC から削除。「カタログに共有」「カタログの版を更新」（編集後にカタログ側も最新にする）「共有を取り下げ」。共有中のスキルを保存すると、カタログの版も更新するか確認されます。共有中のスキルを「無効にする」と、カタログからも取り下げるか確認されます（「いいえ」ならこの PC でだけ無効になり、カタログには残ります）。
    "+ New skill" creates one, "Edit" changes its description and instructions, "Delete" removes it from this PC. "Share to catalog", "Update shared copy" (after editing) and "Unshare". Saving a shared skill asks whether to update the catalog's copy too; disabling a shared skill asks whether to remove it from the catalog as well (No: it's only disabled on this PC and stays in the catalog).
  - 「🤖 AI と相談して作る」「🤖 AI と相談して改善」（編集画面）は、実行中のセッションに `my-skills create` / `my-skills update <名前>` を送り、AI と対話しながら作成・改善します。
    "🤖 Create with AI" and "🤖 Improve with AI" (in the editor) send `my-skills create` / `my-skills update <name>` to the running session so you can build the skill in conversation.
  - 各スキルの「エクスポート」、または「📤 マイスキルをすべてエクスポート」で ZIP ファイルに保存できます（PC の移行やバックアップ、カタログを通さずに同僚へ渡すときに）。「📥 ファイルから読み込む」で ZIP または SKILL.md を読み込むと、マイスキルに追加されます。同じ名前のスキルがあるときは上書きするか確認されます。他の人が作ったスキルは「作成: 名前」と表示され、作成者はその人のままなので、自分のものとしてカタログに共有することはできません。
    "Export" on a skill, or "📤 Export all my skills", saves a ZIP (moving to a new PC, backups, handing a skill to a colleague outside the catalog). "📥 Import from file" adds a ZIP or SKILL.md to My Skills, asking before overwriting one with the same name. A skill someone else made shows "by <name>" and stays theirs, so you can't share it to the catalog as yours.
- **インストール済み / Installed**: カタログから追加したスキルと標準スキル。
  Skills added from the catalog, and the built-in ones.
  - カタログから追加したスキル: 「中身を見る」「無効にする / 有効にする」「エクスポート」「アンインストール」。全員に自動配布されるスキル（「全員に配布」）は次回起動時に戻るため、アンインストールではなく無効化で止めます。
    Added from the catalog: "View", "Disable / Enable", "Export", "Uninstall". Skills installed for everyone ("For everyone") come back on the next launch, so turn them off with Disable instead.
  - 標準スキル: 「中身を見る」のみ（一覧は折りたたまれています。検索すると開きます）。
    Built-in: "View" only (folded; a search opens it).
- 共有スキルカタログのない環境（組織向け設定のない公開版）では「マイスキル」と「インストール済み」だけが表示されます。
  Without a shared catalog (the public edition without the org's settings), only "My Skills" and "Installed" are shown.

> 追加・作成・編集・削除・読み込み・有効/無効の変更は自動で反映され、新しく始めたセッションから使えます。実行中のセッションで使うには「停止」→「セッション開始」してください。初回の Drive 操作では、ブラウザで Google のログイン画面が開きます。
> Imports, creating, editing, deleting and enable/disable changes are applied automatically and are available in new sessions (Stop, then Start Session for the current one). The first Drive operation opens a Google sign-in page in your browser.

### カタログを見る / Browse the Catalog

```
スキルカタログの一覧を見せて
```
または / or:
```
/skill-catalog list
```
利用できるスキルの名前・作成者・更新日が一覧で表示されます。
A list of available skills with their names, creators, and update dates will be displayed.

---

### キーワードでスキルを探す / Search by Keyword

```
経費精算に使えるスキルはある？
```
または / or:
```
/skill-catalog search 経費精算
```
スキル名・作成者・説明にキーワードを含むスキルが、説明つきで表示されます。スペース区切りで複数のキーワードを指定すると、すべてを含むものに絞り込みます。大文字・小文字、全角・半角、ひらがな・カタカナの違いは区別しません。
Skills whose name, creator or description contains the keyword are shown with their descriptions. Several space-separated keywords narrow it to skills containing all of them. Case, full/half width and hiragana/katakana are not distinguished.

---

### スキルの詳細を確認する / View Skill Details

ダウンロードする前に、スキルの内容を確認できます。
You can check what a skill does before downloading it.

```
<skill-name> スキルの詳細を見せて
```
または / or:
```
/skill-catalog info <skill-name>
```
スキルの説明・作成者・更新日などが表示されます。
The skill's description, creator, update date, and more will be displayed.

---

### スキルをインポートする / Import a Skill

```
<skill-name> スキルをインポートして
```
または / or:
```
/skill-catalog import <skill-name>
```

> インポート後、「`/skills reload` を実行してください」と案内されます。その通りに入力すると、スキルがすぐに使えるようになります。
>
> After importing, you'll be prompted to run `/skills reload`. Enter it as instructed, and the skill will be ready to use immediately.

**同じ名前のスキルが複数ある場合 / If multiple skills have the same name:**
作成者つきで指定できます。例：
You can specify with the creator's name. Example:
```
/skill-catalog import user.name/<skill-name>
```

---

## 10. オリジナルスキルを作る / Creating Your Own Skills

会話だけで、自分専用のスキルを作ることができます。**プログラミングの知識は一切不要です。**
You can create your own custom skills through conversation. **No programming knowledge is required.**

> **どんなスキルが作れる？**
> 実行できる手順・コマンドであれば、何でもスキルにできます。「毎週月曜に〇〇をする」「このサービスから情報を取得する」といった繰り返し作業に向いています。
> Chrome を使った自動化スキル（気象データ・為替レート・ニュースの収集、特定サービスへのログインとダウンロードなど）は、事前に実装済みの共通機能を活用して作ることができます。
>
> **What kinds of skills can you create?**
> Any procedure or command that can be run can become a skill. It's especially useful for repetitive tasks like "do X every Monday" or "fetch information from this service."
> Browser automation skills — collecting weather data, exchange rates, or news, or logging into a service to download files — can be built using pre-implemented shared utilities.

---

### 自分のスキルを一覧で見る / List Your Skills

```
自分のスキル一覧を見せて
```
または / or:
```
/my-skills list
```

ローカルにインストールされているスキルが3つのカテゴリで一覧表示されます。
Lists all locally installed skills grouped into three categories.

| カテゴリ / Category | 内容 / Content |
|---|---|
| `Common` | 全員共通の組み込みスキル / Built-in skills shared with everyone |
| `My skill` | 自分が作成・オーナーのスキル / Skills you own |
| `<owner>` | カタログからインポートした他オーナーのスキル / Skills imported from catalog |

---

### スキルを新しく作る / Create a New Skill

```
新しいスキルを作って
```
または / or:
```
/my-skills create
```

いくつか質問されます。答えていくだけでスキルが完成します。
You'll be asked a few questions. Just answer them to complete the skill.

**聞かれる内容 / What you're asked:**

| 質問 / Question | 例 / Example |
|---|---|
| スキルの名前は？ | `monthly-report`（英小文字・ハイフン区切り） |
| 何をするスキルですか？ | 「毎月の売上レポートをまとめる」 |
| どんな言葉で起動しますか？ | 「レポートを作って」「月次集計して」 |
| 操作の手順は？ | 一緒に考えます |
| 使用例を教えてください | 「先月のレポートを作って」 |

質問への回答が終わるとスキルの内容が表示されます。「OK」か「修正して」と答えてください。
After you finish answering, the skill content is shown. Reply with "OK" to save, or describe any corrections.

---

### 作ったスキルを更新する / Update an Existing Skill

```
my-automation スキルを更新して
```
または / or:
```
/my-skills update my-automation
```

現在のスキルの内容を見ながら「ここを変えたい」と伝えるだけです。変更後の内容を確認してから保存されます。
Just describe what you want to change while viewing the current skill content. Changes are confirmed before saving.

---

### スキルの動作を確認する / Test a Skill

スキルが正しく動くか、実際の操作をせずに確認できます（dry-run）。
Verify that a skill works correctly without performing actual operations (dry-run).

```
my-automation スキルをテストして
```
または / or:
```
/my-skills test my-automation
```

テスト結果が ✓（成功）/ ✗（失敗）で表示されます。✗ があった場合は原因と対処法も案内されます。
Results are shown as ✓ (passed) / ✗ (failed). If there is a ✗, the cause and remedy are also provided.

> スキルにテスト手順が設定されていない場合は「テストセクションが定義されていません」と表示されます。`/my-skills update` でテスト手順を追加できます。
>
> If no test procedure is defined for the skill, "No test section is defined" will be shown. You can add one with `/my-skills update`.

---

### スキルを一時的に無効化する / Temporarily Disable a Skill

使わなくなったスキルを、削除せずに一時的に無効化できます。無効化したスキルはいつでも再有効化できます。
You can temporarily disable a skill without deleting it. Disabled skills can be re-enabled at any time.

```
my-automation スキルを無効化して
```
または / or:
```
/my-skills disable my-automation
```

---

### 無効化したスキルを再有効化する / Re-enable a Disabled Skill

無効化したスキルをもとに戻します。
Restores a previously disabled skill.

```
my-automation スキルを有効化して
```
または / or:
```
/my-skills enable my-automation
```

スキル名を省略すると、無効化されているスキルの一覧が表示され、選んで有効化できます。
If you omit the skill name, a list of disabled skills is shown for you to choose from.

---

### スキルをカタログに登録・共有する / Share Your Skill with the Catalog

自分が作ったスキルをカタログに登録して、グループ全員が使えるようにできます。
Register your skill in the catalog so everyone in the group can use it.

```
my-automation スキルをカタログに登録して
```
または / or:
```
/my-skills share my-automation
```

初回は Google アカウントでの認証（Chrome が自動で開きます）が必要です。
On first use, Google account authentication is required (Chrome opens automatically).

登録が完了すると、カタログ内の `あなたの名前/my-automation` に保存されます。
After sharing, the skill is saved as `your-name/my-automation` in the catalog.

---

### カタログからスキルを取り下げる / Remove Your Skill from the Catalog

カタログに登録したスキルを取り下げます。**ローカルのスキルは削除されません。**
Removes your skill from the catalog. **The skill on your local machine is NOT deleted.**

```
my-automation をカタログから取り下げて
```
または / or:
```
/my-skills unshare my-automation
```

> **注意:** 自分がオーナーのスキルのみ取り下げできます。取り下げても、他の人がすでにインポートして使っているスキルには影響しません。
> **Note:** You can only unshare skills you own. This does not affect skills already imported by others.

---

### スキルのオーナーを変更する / Transfer Skill Ownership

自分が作ったスキルのオーナーを別の社員に移すことができます。担当者交代などのときに使ってください。
You can transfer ownership of a skill you created to another employee. Use this when responsibilities change.

```
my-automation のオーナーを変更して
```
または / or:
```
/my-skills change owner my-automation
```

変更先のメールアドレスを聞かれます。会社のメールアドレスを入力してください。
You will be asked for the new owner's email address. Enter the company email address.

---

### スキルを完全削除する / Permanently Delete a Skill

スキルをローカル環境から**完全に削除**します（元に戻せません）。
**Permanently deletes** a skill from your local environment (cannot be undone).

> **しばらく使わないだけなら `disable` を使ってください。** `delete` は取り消しができません。
> **Use `disable` if you just want to hide it for a while.** `delete` is irreversible.

```
my-automation スキルを完全に削除して
```
または / or:
```
/my-skills delete my-automation
```

削除前に確認が表示されます。自分がオーナーの場合は「ローカルのみ削除」か「カタログも含めて削除」を選べます。
A confirmation prompt appears. If you own the skill, you can choose to delete it locally only, or from both local and the catalog.

---

## 11. ツールのアップデート / Updating the Tool

新しいバージョンが公開されたときは、メニューバーから最新版に更新できます（チャットでのコマンド入力は不要です）。
When a new version is published, you can update to the latest from the menu bar (no chat command needed).

**アップデートの流れ / What happens:**

1. メニューバーの「**Settings**」を開きます。通常は「**Update to Latest...**」（最新の正式版）をクリックしてください。「Update to Test Release...」（テスト版）は、開発・テストに参加している人向けです（組織の設定によっては表示されません）。
   Open the **Settings** menu. Normally click "**Update to Latest...**" (the latest official release). "Update to Test Release..." is for people taking part in development/testing (it may not appear, depending on your organization's setup).
2. 更新がある場合、画面上部に通知バナーが表示されます。「**Update Now**」をクリックすると、ダウンロード・適用が自動で行われます（進行状況はターミナル画面に表示されます）。
   If an update is available, a notification banner appears at the top of the window. Click **Update Now** to download and apply it automatically (progress is shown in the terminal view).
3. 完了すると「新しいバージョンで再起動します…」と表示され、agent-deck が自動で再起動します（v0.2.9〜。終了の確認は出ません）。それ以前の版や、自動で再起動できなかった場合は、ウィンドウを閉じて `agent-deck.app`/`agent-deck.exe` を起動し直してください。
   When complete, "Restarting into the new version…" appears and agent-deck restarts by itself (v0.2.9+, no quit confirmation). On older versions, or if it can't restart itself, close the window and relaunch `agent-deck.app`/`agent-deck.exe`.

> すでに最新版の場合は、その旨を伝えるメッセージが表示されます。
> If you already have the latest version, a message says so and no changes are made.

**自動チェック / Automatic check (v0.2.7+):** メニューから操作しなくても、1 日に 1 回（v0.2.8 から。前回の確認から 24 時間たっていれば、起動の約 30 秒後やスリープ明けにウィンドウを開いたときに）新しいバージョンを確認し、あれば同じ通知バナーを表示します。**確認するだけで、「今すぐ更新」を押すまで更新は行いません。**「後で」を押すとそのバージョンの通知は次回起動まで表示されません。確認するのは、今使っている版と同じ種類の最新版だけです（v0.2.8 から）。正式版を使っている人には正式版の、テスト版（バージョンに「-rc1」などが付く版）を使っている人にはテスト版の最新版だけを案内します。この確認は Settings メニューの「Check for Updates Automatically」でオフにできます。
Without using the menu, the app checks once a day (v0.2.8+: when 24 hours have passed since the last check — about 30 seconds after launch, or when you return to the window after sleep), showing the same banner when a new version exists. **It only checks — nothing is updated until you click Update Now.** "Later" hides the banner for that version until the next launch. It only looks at the same kind of build you run (v0.2.8+): stable users are told about new stable releases, test-edition users (versions like "-rc1") about new test builds only. Turn this off with Settings → "Check for Updates Automatically".

### ツールが起動しないとき / If the Tool Won't Launch

`agent-deck.app`/`agent-deck.exe` を一度終了し、フォルダの上に**最新の配布 ZIP を展開し直す**ことで多くの問題は解消します（`config.toml`・`files/` の内容は保持されます）。それでも解決しない場合は管理者に連絡してください。
Quit `agent-deck.app`/`agent-deck.exe`, then **re-extract the latest distribution ZIP over the existing folder** — this resolves most issues (`config.toml` and `files/` are preserved). If that doesn't help, contact your administrator.

---

## 12. プライバシーとセキュリティ / Privacy & Security

このツールはあなたのパソコン上でのみ動作します。アクセスできる場所は以下のとおりに制限されており、パスワードやシステムファイルには触れられないよう技術的にブロックされています。
This tool runs entirely on your local computer. Access is restricted to the locations listed below, and the tool is technically blocked from touching passwords or system files.

### アクセスできる場所 / What the tool can access

| 場所 / Location | 用途 / Purpose |
|---|---|
| `agent-deck` フォルダ内の `files/`・`tmp/` | ファイル整理・スライド生成などの作業エリア / Working area for file organization, slide generation, etc. |
| `Downloads`・`Documents`・`Desktop` 等の標準フォルダ | ユーザーの依頼に基づいたファイル操作（整理・移動など）/ File operations based on your requests |

### アクセスをブロックされている場所 / What the tool cannot access

- **パスワード・SSH キー・API キーなどの認証情報**（`~/.ssh`、`~/.aws`、`~/.env` 等）
  Passwords, SSH keys, API keys, and other credentials
- **macOS ユーザー設定フォルダ**（`~/Library/`）— キーチェーンやアプリのプリファレンスを含む
  macOS user Library folder — contains keychains and app preferences
- **各種設定ファイル**（`~/.config/`、`~/.gitconfig`、`~/.zshrc` 等）
  Shell and application config files
- **macOS システムフォルダ**（`/System`、`/Library`、`/etc` 等）
  macOS system folders
- **Windows AppData フォルダ**（ブラウザの保存パスワードや各種アプリの認証情報を含む）
  Windows AppData folder — contains saved browser passwords and app credentials
- **Windows システムフォルダ**（`C:\Windows`、`C:\Program Files` 等）
  Windows system folders

> **ファイルの送信について / About file transmission:**
> このツールはローカルで動作します。あなたのファイルが外部サーバーに送信されることはありません（カレンダー取得など、Google API を呼び出すスキルは除きます）。
> This tool operates locally. Your files are not sent to external servers (except when a skill explicitly calls a Google API).

---

## 13. 困ったときは / Need Help?

うまく動かない場合や使い方がわからなくなったときは「ヘルプを表示して」と入力してみてください。
If something isn't working or you're unsure what to do, type "ヘルプを表示して".

### エラーログを送る / Sending the Error Log

エラーが発生すると、ツールは自動的にログファイルに記録します。問題を報告する際は、このログファイルを添付してください。
When an error occurs, the tool automatically records it in a log file. Please attach this file when reporting a problem.

**ログファイルの場所 / Log file location:**

```
agent-deck/
└── tmp/
    └── logs/
        └── agent-deck.log    ← このファイルを送ってください / Send this file
```

ログには OAuth 認証エラー・セッション切れ・その他の例外など、エラーの詳細が記録されています。ファイルが存在しない場合は、まだエラーが発生していないか、エラーが別の原因によるものです。
The log contains details about OAuth errors, session expiry, and other exceptions. If the file does not exist, no errors have been recorded yet (or the error has a different cause).

> **注意 / Note:** ログにメールアドレスやファイルパスが含まれる場合があります。送付前に内容を確認してください。
> The log may contain your email address or file paths. Review the content before sending.
