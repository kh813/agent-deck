---
name: diagram-generator
description: Markdownの箇条書き・リストから組織図やフローチャートの画像（PNG/SVG）を生成・更新します。「組織図を作って」「この手順をフローチャートにして」「図で見せて」などと言われたときに使用してください。Generates and updates organization-chart and flowchart images (PNG/SVG) from a Markdown list. Use for "make an org chart", "turn this into a flowchart", "diagram this", "draw this as a chart".
---

# 図表ジェネレーター / Diagram Generator

## 言語設定 / Language Policy
ユーザーへの全ての返答は日英バイリンガルで表示してください。日本語を先に表示し、改行の後に英語を続けてください。
Always respond to the user in both Japanese and English. Display Japanese first, then English on the next line.

## 概要 / Overview

ユーザーが与える箇条書き・リスト（組織の階層、作業手順など）から Mermaid 記法のテキストを生成し、それを画像（PNG/SVG）にレンダリングします。図の実体は `files/` に保存される `.mmd`（Mermaid ソース）テキストファイルなので、**「更新」は同じ `.mmd` を編集して再レンダリングするだけ**です。Node.js・npx・mermaid-cli は不要 — このプロジェクトが元々ブラウザ自動化スキル用に用意している Playwright + Chromium（`venv/`）でオフラインレンダリングします。

Converts a user-provided Markdown list (an org hierarchy, a set of process steps, etc.) into Mermaid diagram syntax, then renders it to an image (PNG/SVG). The diagram's real source of truth is the `.mmd` (Mermaid source) text file saved under `files/` — **"updating" the diagram just means editing that same `.mmd` and re-rendering.** No Node.js/npx/mermaid-cli needed — rendering happens fully offline via the Playwright + Chromium this project already provisions for its browser-automation skills.

## ワークフロー / Workflow

### 1. リストの受け取り / Receive the list

まだリストが提示されていなければ、提示するよう案内する。図の種類に応じて、以下がわかる形になっているか確認する:
If the list hasn't been provided yet, ask for it. Depending on the diagram type, confirm the list makes the following clear:

- **組織図 / Org chart**: 誰が誰の上司か（親子関係）/ who reports to whom (parent-child relationships)
- **フローチャート / Flowchart**: 手順の順序、分岐条件があればその内容 / the order of steps, and any branch conditions

### 2. Mermaid記法への変換 / Convert to Mermaid syntax

いずれも `flowchart TD`（上から下）を使う。ノードIDは英数字のみ（日本語ラベルは `[]` の中に書く）。
Use `flowchart TD` (top-down) for both. Node IDs must be plain alphanumeric — put non-ASCII/Japanese labels inside `[]`.

| 用途 / Purpose | 記法 / Syntax |
|---|---|
| 通常ノード / Box node | `A[ラベル]` |
| 開始・終了 / Start-end (rounded) | `A([開始])` |
| 分岐（菱形）/ Decision (diamond) | `A{条件を満たすか?}` |
| 矢印（親→子・手順の順序）/ Arrow | `A --> B` |
| ラベル付き矢印（分岐の条件）/ Labeled arrow | `A -->|Yes| B` |

**組織図の例 / Org chart example:**
```
flowchart TD
    CEO[CEO]
    CTO[CTO]
    CFO[CFO]
    CEO --> CTO
    CEO --> CFO
```

**フローチャートの例 / Flowchart example:**
```
flowchart TD
    Start([開始]) --> Check{条件を満たすか?}
    Check -->|Yes| StepA[処理A]
    Check -->|No| StepB[処理B]
    StepA --> End([終了])
    StepB --> End
```

生成した Mermaid コードは `files/<topic>.mmd` として保存する（最初の見出しやテーマから小文字・ハイフン区切りのファイル名を決める。不明なら `diagram` を使う）。**既存の図を更新する場合は、同じ `files/<topic>.mmd` を上書き編集してから Step 3 を再実行する** — 新しい名前のファイルを作らない。
Save the generated Mermaid code as `files/<topic>.mmd` (derive the filename from the first heading/topic, lowercase with hyphens; use `diagram` if unclear). **To update an existing diagram, overwrite that same `files/<topic>.mmd` and re-run Step 3** — don't create a new file under a different name.

### 3. 画像に変換 / Render to image

```bash
python3 python/skills/diagram-generator/scripts/render_diagram.py files/<topic>.mmd files/<topic>.png
```

SVG が欲しい場合は出力先の拡張子を `.svg` に変える（ベクター形式で拡大縮小に強い）。
For SVG instead (vector, scales cleanly), change the output extension to `.svg`.

```bash
python3 python/skills/diagram-generator/scripts/render_diagram.py files/<topic>.mmd files/<topic>.svg
```

初回実行時のみ `mermaid.js` を自動ダウンロードするため少し時間がかかる（2回目以降はキャッシュ済み）。
The first run downloads mermaid.js automatically, so it's a little slower — subsequent runs reuse the cached copy.

### 4. 結果報告 / Report Result

生成された画像ファイルのフルパスをユーザーに伝える。
Tell the user the full path of the generated image file.

## エラー対応 / Error Handling

エラーが発生した場合、**`python/` 以下のソースコードを変更せずに**、エラー内容をそのままユーザーに報告してください。
If an error occurs, **do not modify any source files under `python/`** — report the error message to the user as-is.

| エラー / Error | 対処 / Fix |
|---|---|
| `venv not found` | `python3 python/scripts/setup/setup.py` を実行してセットアップ / Run setup |
| `Syntax error in text`（終了コード1）/ Exit code 1 with "Syntax error in text" | Mermaid記法を見直して再実行。よくある間違い: ノードIDに空白・記号を使っている、矢印を連続させている（`A --> --> B`）など / Review the Mermaid syntax and retry. Common mistakes: spaces/symbols in node IDs, chained arrows |
| `mermaid.js` のダウンロード失敗 / mermaid.js download failure | ネットワーク接続を確認して再実行 / Check network connectivity and retry |
| 出力が期待と違うレイアウト / Layout looks off | ノードの定義順序や `-->` の向きを見直す。複雑な図は `flowchart LR`（左から右）も検討 / Review node definition order and arrow direction. For complex diagrams, consider `flowchart LR` (left-to-right) instead |

## 使用例 / Examples

- 「この組織のリストを組織図にして」→ リストを `flowchart TD` に変換 → `files/org-chart.mmd` 保存 → `render_diagram.py` で PNG化
- 「この手順をフローチャートにして」→ 分岐を `{}` で表現 → `files/process-flow.mmd` 保存 → PNG化
- 「さっきの組織図に部署を1つ追加して」→ 既存の `files/org-chart.mmd` を編集 → 同じコマンドで再レンダリング（上書き）
