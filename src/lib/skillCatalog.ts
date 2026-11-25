// Skill catalog screen logic (app_specs.md 5.7.3). Everything here is pure
// except callCatalog, which runs `skills_catalog.py api` via the Rust
// catalog_api command.
import { invoke } from "@tauri-apps/api/core";
import type { Lang } from "../utils/i18n";

export type Installed = "catalog" | "personal" | "common" | null;

export interface CatalogSkill {
  name: string;
  owner: string;
  modified: string;
  description: string;
  installed: Installed;
}

export interface LocalSkill {
  name: string;
  description: string;
  root: "common" | "catalog" | "personal";
  enabled: boolean;
  owner: string;
  mine: boolean;
  shared: boolean;
  /** Installed on every PC by the org (catalog _default/): can't be uninstalled. */
  auto_sync?: boolean;
}

/** `read`: one local skill's SKILL.md, split for the editor. */
export interface SkillDoc {
  name: string;
  root: LocalSkill["root"];
  enabled: boolean;
  description: string;
  body: string;
  content: string;
  editable: boolean;
  mine: boolean;
  shared: boolean;
  extra_files: string[];
}

/** What create/save send (as JSON on stdin). */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

export interface ApiError {
  code: string;
  message: string;
  candidates?: string[];
}

export type ApiResult<T> = { ok: true; data: T; log: string } | { ok: false; error: ApiError; log: string };

export type CatalogOp =
  | "catalog" | "search" | "info" | "local" | "import" | "share" | "unshare" | "enable" | "disable" | "rebuild"
  | "read" | "create" | "save" | "delete" | "uninstall" | "export" | "import-file";

/** `input` goes to the script's stdin (create/save: a SkillDraft). */
export function callCatalog<T>(op: CatalogOp, args: string[] = [], input?: unknown): Promise<ApiResult<T>> {
  return invoke<ApiResult<T>>("catalog_api", { op, args, input: input === undefined ? null : JSON.stringify(input) });
}

/** Ops that may need the Google login in a browser (Drive access). */
export const DRIVE_OPS: ReadonlySet<CatalogOp> = new Set(["catalog", "search", "info", "import", "share", "unshare"]);

/** Ops that change installed skills -> run `rebuild` afterwards. */
export const NEEDS_REBUILD: ReadonlySet<CatalogOp> = new Set(["import", "enable", "disable", "create", "save", "delete", "uninstall", "import-file"]);

export type CardAction = { kind: "import" | "reimport" } | { kind: "none"; label: "builtin" | "yours" };

/** What the catalog card's button does. */
export function catalogCardAction(s: CatalogSkill): CardAction {
  switch (s.installed) {
    case "common":
      return { kind: "none", label: "builtin" };
    case "personal":
      return { kind: "none", label: "yours" };
    case "catalog":
      return { kind: "reimport" };
    default:
      return { kind: "import" };
  }
}

export type LocalAction =
  | "view" | "edit" | "share" | "reshare" | "unshare" | "enable" | "disable" | "export" | "delete" | "uninstall";

/**
 * Buttons for a skill on the "My skills" tab.
 *  - your own (skills-personal/): edit, share / update the shared copy /
 *    unshare, enable/disable, delete
 *  - imported from the catalog: view, enable/disable, uninstall (not for the
 *    ones the org installs on every PC -- they'd come back on next launch)
 *  - built-in: view only
 */
export function localActions(s: LocalSkill): LocalAction[] {
  if (s.root === "common") return ["view"];
  if (s.root === "catalog") {
    return ["view", s.enabled ? "disable" : "enable", "export", ...(s.auto_sync ? [] : (["uninstall"] as const))];
  }
  const out: LocalAction[] = ["edit"];
  if (s.mine && s.shared) out.push("reshare", "unshare");
  else if (s.mine && s.enabled) out.push("share");
  out.push(s.enabled ? "disable" : "enable", "export", "delete");
  return out;
}

/** The API op behind a button ("view"/"edit" open the editor instead). */
export function opForAction(a: LocalAction): CatalogOp | null {
  switch (a) {
    case "view":
    case "edit":
    case "export": // asks for a file first
      return null;
    case "reshare":
      return "share";
    default:
      return a;
  }
}

/** Same rule as skills_catalog.py SKILL_NAME_RE. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export type DraftProblem = "name" | "description" | "body" | null;

/** First thing wrong with a draft, checked before calling the API. */
export function draftProblem(d: SkillDraft, isNew: boolean): DraftProblem {
  if (isNew && (!SKILL_NAME_RE.test(d.name) || d.name === "disabled")) return "name";
  if (!d.description.trim()) return "description";
  if (!d.body.trim()) return "body";
  return null;
}

/** A starting point for a new skill's instructions. */
export function skillTemplate(lang: Lang): string {
  return lang === "ja"
    ? "# スキル名\n\n## やること\n\n1. \n2. \n3. \n\n## 注意点\n\n- \n"
    : "# Skill name\n\n## Steps\n\n1. \n2. \n3. \n\n## Notes\n\n- \n";
}

/** What "Create with AI" / "Improve with AI" type into the session. */
export function agentPrompt(kind: "create" | "update", name = ""): string {
  return kind === "create" ? "my-skills create" : `my-skills update ${name}`.trim();
}

// ── Search (same rules as skills_catalog.py search_skills) ──

/** Case-, width- and kana-insensitive form (NFKC + lower-case + hiragana->katakana). */
export function normalizeForSearch(text: string): string {
  const t = (text ?? "").normalize("NFKC").toLowerCase();
  let out = "";
  for (const c of t) {
    const code = c.codePointAt(0)!;
    out += code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : c;
  }
  return out;
}

export function searchKeywords(query: string): string[] {
  return query.replace(/\u3000/g, " ").split(/\s+/).filter((k) => k.trim()).map(normalizeForSearch);
}

type Searchable = { name: string; owner?: string; description?: string; author?: string };

/**
 * Entries matching EVERY keyword (AND) in name, owner/author or description,
 * ranked like the CLI: name hits first, then owner, then description; ties
 * by name. An empty query keeps everything in its original order.
 */
export function filterSkills<T extends Searchable>(skills: readonly T[], query: string): T[] {
  const keywords = searchKeywords(query);
  if (!keywords.length) return [...skills];
  const ranked: { score: number; s: T }[] = [];
  for (const s of skills) {
    const name = normalizeForSearch(s.name);
    const owner = normalizeForSearch(`${s.owner ?? ""} ${s.author ?? ""}`);
    const desc = normalizeForSearch(s.description ?? "");
    let score = 0;
    let all = true;
    for (const k of keywords) {
      if (name.includes(k)) score += 100;
      else if (owner.includes(k)) score += 10;
      else if (desc.includes(k)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) ranked.push({ score, s });
  }
  ranked.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name) || (a.s.owner ?? "").localeCompare(b.s.owner ?? ""));
  return ranked.map((r) => r.s);
}

export const AUTO_SYNC_OWNER = "_default";

/** Owners for the filter menu: the org's auto-installed set first, then A-Z. */
export function catalogOwners(skills: readonly CatalogSkill[]): string[] {
  const set = new Set(skills.map((s) => s.owner).filter(Boolean));
  const rest = [...set].filter((o) => o !== AUTO_SYNC_OWNER).sort((a, b) => a.localeCompare(b));
  return set.has(AUTO_SYNC_OWNER) ? [AUTO_SYNC_OWNER, ...rest] : rest;
}

export function filterByOwner<T extends { owner: string }>(skills: readonly T[], owner: string): T[] {
  return owner ? skills.filter((s) => s.owner === owner) : [...skills];
}

/** The "My skills" tab: yours first, then imported; built-ins last. */
export function sortLocal(skills: readonly LocalSkill[]): LocalSkill[] {
  const rank = (s: LocalSkill) => (s.mine ? 0 : s.root === "catalog" ? 1 : 2);
  return [...skills].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Import target: owner/name, so a same-named skill from someone else is never picked by accident. */
export const importTarget = (s: Pick<CatalogSkill, "owner" | "name">) => `${s.owner}/${s.name}`;

const TEXT = {
  ja: {
    title: "スキルカタログ",
    view: "中身を見る",
    edit: "編集",
    reshare: "カタログの版を更新",
    delete: "削除",
    uninstall: "アンインストール",
    newSkill: "＋ 新しいスキル",
    export: "エクスポート",
    exportAll: "📤 自作スキルをすべてエクスポート",
    importFile: "📥 ファイルから読み込む",
    exported: "{path} に保存しました。",
    importedFiles: "読み込みました: {names}。新しいセッションから使えます。",
    importShadowed: "（{names} は同名の標準/インポート済みスキルが優先されます）",
    confirmImportOverwrite: "同じ名前の自作スキルがあります: {names}。上書きしますか？",
    nothingToExport: "エクスポートできる自作スキルがありません。",
    zipFilter: "スキル（ZIP / SKILL.md）",
    noCatalogNote: "この環境には共有スキルカタログがありません。自分のスキルの作成・編集と、インストール済みスキルの管理ができます。",
    createWithAi: "🤖 AI と相談して作る",
    improveWithAi: "🤖 AI と相談して改善",
    needSession: "AI と相談するには、先にセッションを開始してください。",
    filterPlaceholder: "名前・作成者・説明で絞り込み（例: 経費、taro、PDF）",
    ownerAll: "すべての作成者",
    ownerDefault: "全員に配布",
    autoSyncTag: "全員に配布",
    count: "{n} 件",
    editorNew: "新しいスキル",
    editorEdit: "スキルを編集",
    editorView: "スキルの中身",
    fieldName: "スキル名",
    fieldNameHint: "半角英小文字・数字・ハイフン（例: weekly-report）。作成後は変更できません。",
    fieldDescription: "説明",
    fieldDescriptionHint: "何をするスキルか、どんな言葉で頼まれたら使うか。AI はこの説明を見てスキルを使うか判断します。",
    fieldBody: "手順（AI への指示）",
    fieldBodyHint: "Markdown で書けます。AI が上から順に読んで実行します。",
    save: "保存",
    create: "作成",
    cancel: "キャンセル",
    extraFiles: "同梱ファイル（この画面では編集できません）",
    readOnlyNote: "このスキルは編集できません（標準スキル・インポートしたスキル）。",
    problem_name: "スキル名は半角英小文字・数字・ハイフンで 2〜64 文字にしてください。",
    problem_description: "説明を入力してください。",
    problem_body: "手順を入力してください。",
    unsavedChanges: "保存していない変更があります。破棄しますか？",
    confirmDelete: "「{name}」をこの PC から削除しますか？元に戻せません。",
    confirmDeleteShared: "「{name}」はカタログに共有中です。共有を取り下げてから削除しますか？元に戻せません。",
    confirmUninstall: "インポートした「{name}」をアンインストールしますか？（カタログから再インポートできます）",
    confirmReshare: "「{name}」のカタログの版を、この PC の内容で更新しますか？",
    askReshareAfterSave: "保存しました。「{name}」はカタログに共有中です。カタログの版も更新しますか？",
    tabCatalog: "カタログ",
    tabMine: "マイスキル",
    searchPlaceholder: "キーワードで検索（例: 経費、PDF、slide）",
    search: "検索",
    clear: "すべて表示",
    import: "インポート",
    reimport: "更新を取り込む",
    builtin: "標準搭載",
    yours: "自作スキルあり",
    share: "カタログに共有",
    unshare: "共有を取り下げ",
    enable: "有効にする",
    disable: "無効にする",
    details: "詳細",
    hide: "閉じる",
    by: "作成",
    updated: "更新",
    mine: "自作",
    imported: "インポート済み",
    builtinTag: "標準",
    disabledTag: "無効",
    sharedTag: "共有中",
    empty: "該当するスキルはありません。",
    offline: "Drive に接続できないため、前回取得した一覧を表示しています。",
    working: "処理中です…",
    driveHint: "初回は Google のログイン画面がブラウザで開きます。ログインすると続行します。",
    rebuilding: "スキルを反映しています…",
    done: "完了しました。新しいセッションから使えます（実行中のセッションは「停止」→「セッション開始」で反映）。",
    confirmUnshare: "「{name}」をカタログから取り下げますか？（自分の PC のスキルは残ります）",
    confirmShare: "「{name}」をカタログに共有しますか？組織のメンバーが閲覧・インポートできるようになります。",
    err_no_catalog: "この環境では共有スキルカタログを使えません（組織向けの config.toml がありません）。",
    err_timeout: "時間内に完了しませんでした。ネットワークや Google のログインを確認してください。",
    err_python_missing: "Python を起動できませんでした。セットアップを確認してください。",
    err_ambiguous: "同じ名前のスキルが複数あります: {candidates}",
    err_not_found: "スキルが見つかりません。",
    err_other: "失敗しました: {message}",
  },
  en: {
    title: "Skill Catalog",
    view: "View",
    edit: "Edit",
    reshare: "Update shared copy",
    delete: "Delete",
    uninstall: "Uninstall",
    newSkill: "+ New skill",
    export: "Export",
    exportAll: "📤 Export all my skills",
    importFile: "📥 Import from file",
    exported: "Saved to {path}.",
    importedFiles: "Imported: {names}. Available in new sessions.",
    importShadowed: " ({names}: a built-in or imported skill of the same name takes precedence)",
    confirmImportOverwrite: "You already have: {names}. Overwrite?",
    nothingToExport: "You have no skills of your own to export.",
    zipFilter: "Skill (ZIP / SKILL.md)",
    noCatalogNote: "No shared skill catalog here. You can still create and edit your own skills and manage installed ones.",
    createWithAi: "🤖 Create with AI",
    improveWithAi: "🤖 Improve with AI",
    needSession: "Start a session first to work on it with the AI.",
    filterPlaceholder: "Filter by name, author or description (e.g. expense, taro, PDF)",
    ownerAll: "All authors",
    ownerDefault: "For everyone",
    autoSyncTag: "For everyone",
    count: "{n}",
    editorNew: "New skill",
    editorEdit: "Edit skill",
    editorView: "Skill contents",
    fieldName: "Name",
    fieldNameHint: "Lowercase letters, digits and hyphens (e.g. weekly-report). Can't be changed later.",
    fieldDescription: "Description",
    fieldDescriptionHint: "What it does and what requests should trigger it. The AI decides whether to use the skill from this.",
    fieldBody: "Instructions (for the AI)",
    fieldBodyHint: "Markdown. The AI reads and follows it top to bottom.",
    save: "Save",
    create: "Create",
    cancel: "Cancel",
    extraFiles: "Bundled files (not editable here)",
    readOnlyNote: "This skill can't be edited here (built-in or imported).",
    problem_name: "Use 2-64 lowercase letters, digits and hyphens for the name.",
    problem_description: "Enter a description.",
    problem_body: "Enter the instructions.",
    unsavedChanges: "Discard unsaved changes?",
    confirmDelete: "Delete \"{name}\" from this PC? This can't be undone.",
    confirmDeleteShared: "\"{name}\" is shared in the catalog. Unshare it and delete it? This can't be undone.",
    confirmUninstall: "Uninstall the imported \"{name}\"? (You can import it again from the catalog.)",
    confirmReshare: "Update the catalog's copy of \"{name}\" with the one on this PC?",
    askReshareAfterSave: "Saved. \"{name}\" is shared in the catalog; update the catalog's copy too?",
    tabCatalog: "Catalog",
    tabMine: "My Skills",
    searchPlaceholder: "Search by keyword (e.g. expense, PDF, slide)",
    search: "Search",
    clear: "Show all",
    import: "Import",
    reimport: "Get update",
    builtin: "Built-in",
    yours: "You have one",
    share: "Share to catalog",
    unshare: "Unshare",
    enable: "Enable",
    disable: "Disable",
    details: "Details",
    hide: "Hide",
    by: "by",
    updated: "updated",
    mine: "Yours",
    imported: "Imported",
    builtinTag: "Built-in",
    disabledTag: "Disabled",
    sharedTag: "Shared",
    empty: "No matching skills.",
    offline: "Can't reach Drive; showing the last list fetched.",
    working: "Working…",
    driveHint: "The first time, a Google sign-in page opens in your browser; it continues once you sign in.",
    rebuilding: "Applying skills…",
    done: "Done. Available in new sessions (Stop, then Start Session to use it in the current one).",
    confirmUnshare: "Remove \"{name}\" from the catalog? (Your local copy stays.)",
    confirmShare: "Share \"{name}\" to the catalog? Members of your organization will be able to see and import it.",
    err_no_catalog: "The shared skill catalog isn't available here (no organization config.toml).",
    err_timeout: "Timed out. Check the network or the Google sign-in.",
    err_python_missing: "Couldn't run Python. Check the setup.",
    err_ambiguous: "Several skills have that name: {candidates}",
    err_not_found: "Skill not found.",
    err_other: "Failed: {message}",
  },
} as const;

export type CatalogTextKey = keyof (typeof TEXT)["ja"];

export function catalogText(lang: Lang, key: CatalogTextKey, vars: Record<string, string> = {}): string {
  let s: string = TEXT[lang][key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

/** A user-facing message for a failed api result. */
export function describeError(lang: Lang, e: ApiError): string {
  switch (e.code) {
    case "no_catalog":
    case "timeout":
    case "python_missing":
    case "not_found":
      return catalogText(lang, `err_${e.code}` as CatalogTextKey);
    case "ambiguous":
      return catalogText(lang, "err_ambiguous", { candidates: (e.candidates ?? []).join(", ") });
    case "exists":
    case "shared":
    case "auto_sync":
    case "not_editable":
    case "invalid_name":
    case "invalid_description":
    case "invalid_body":
    case "too_large":
      return pickLang(e.message, lang);
    default:
      return catalogText(lang, "err_other", { message: e.message });
  }
}

/** The script's messages read "日本語 / English": show the reader's half. */
export function pickLang(message: string, lang: Lang): string {
  const i = message.indexOf(" / ");
  if (i < 0) return message;
  return lang === "ja" ? message.slice(0, i) : message.slice(i + 3);
}

/**
 * Yes/no question. The native dialog (plugin-dialog `ask`), since the
 * webview's window.confirm isn't reliable on every platform; plain
 * window.confirm outside Tauri (dev in a browser).
 */
export async function confirmDialog(message: string, lang: Lang): Promise<boolean> {
  try {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return await ask(message, {
      title: "agent-deck",
      kind: "warning",
      okLabel: lang === "ja" ? "はい" : "Yes",
      cancelLabel: lang === "ja" ? "いいえ" : "No",
    });
  } catch {
    return typeof window !== "undefined" && window.confirm(message);
  }
}

// ── Export / import as files ──

/** Default file name: the skill's name, or a dated bundle for several. */
export function exportFileName(names: readonly string[], now = new Date()): string {
  if (names.length === 1) return `${names[0]}.zip`;
  const p = (n: number) => String(n).padStart(2, "0");
  return `agent-deck-skills-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.zip`;
}

/** "Export all": your own skills (skills-personal/), disabled ones included. */
export function exportAllTargets(skills: readonly LocalSkill[]): { name: string; root: LocalSkill["root"] }[] {
  return skills.filter((s) => s.root === "personal").map((s) => ({ name: s.name, root: s.root }));
}

/** Save dialog for the ZIP; null if cancelled. */
export async function pickExportPath(defaultName: string, lang: Lang): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const p = await save({ defaultPath: defaultName, filters: [{ name: catalogText(lang, "zipFilter"), extensions: ["zip"] }] });
  return typeof p === "string" && p ? p : null;
}

/** Open dialog for a skill file; null if cancelled. */
export async function pickImportFile(lang: Lang): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ multiple: false, directory: false, filters: [{ name: catalogText(lang, "zipFilter"), extensions: ["zip", "md"] }] });
  return typeof p === "string" && p ? p : null;
}
