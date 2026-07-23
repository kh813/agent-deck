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
| `/agy-schedule` | 定型プロンプトの定期実行を設定 / Schedule a recurring prompt |
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

1. メニューバーの「**Update**」を開きます。表示される項目は組織の設定によって異なります — 「Update to GitHub Latest...」の場合も、「Update to Org Latest...」（＋設定によっては「Update to Org Test...」）の場合もあります。いずれか表示されている項目をクリックしてください。
   Open the **Update** menu. Which item appears depends on your organization's setup — it may be "Update to GitHub Latest..." or "Update to Org Latest..." (plus "Update to Org Test..." if configured). Click whichever is shown.
2. 更新がある場合、画面上部に通知バナーが表示されます。「**Update Now**」をクリックすると、ダウンロード・適用が自動で行われます（進行状況はターミナル画面に表示されます）。
   If an update is available, a notification banner appears at the top of the window. Click **Update Now** to download and apply it automatically (progress is shown in the terminal view).
3. 完了後に再起動を案内するメッセージが表示されます。ウィンドウを閉じて `agent-deck.app`/`agent-deck.exe` を起動し直してください。
   When complete, a message asks you to restart. Close the window and relaunch `agent-deck.app`/`agent-deck.exe`.

> すでに最新版の場合は、その旨を伝えるメッセージが表示されます。
> If you already have the latest version, a message says so and no changes are made.

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
