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
}

export interface ApiError {
  code: string;
  message: string;
  candidates?: string[];
}

export type ApiResult<T> = { ok: true; data: T; log: string } | { ok: false; error: ApiError; log: string };

export type CatalogOp = "catalog" | "search" | "info" | "local" | "import" | "share" | "unshare" | "enable" | "disable" | "rebuild";

export function callCatalog<T>(op: CatalogOp, args: string[] = []): Promise<ApiResult<T>> {
  return invoke<ApiResult<T>>("catalog_api", { op, args });
}

/** Ops that may need the Google login in a browser (Drive access). */
export const DRIVE_OPS: ReadonlySet<CatalogOp> = new Set(["catalog", "search", "info", "import", "share", "unshare"]);

/** Ops that change installed skills -> run `rebuild` afterwards. */
export const NEEDS_REBUILD: ReadonlySet<CatalogOp> = new Set(["import", "enable", "disable"]);

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

export type LocalAction = "share" | "unshare" | "enable" | "disable";

/** Buttons for a skill on the "My skills" tab. Built-in skills get none. */
export function localActions(s: LocalSkill): LocalAction[] {
  if (s.root === "common") return [];
  const out: LocalAction[] = [];
  if (s.mine && s.enabled) out.push(s.shared ? "unshare" : "share");
  out.push(s.enabled ? "disable" : "enable");
  return out;
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
    default:
      return catalogText(lang, "err_other", { message: e.message });
  }
}
