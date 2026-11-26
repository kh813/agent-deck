// @vitest-environment jsdom
// The catalog screen driven like a user would, against an in-memory fake of
// `skills_catalog.py api` (the real script is covered by pytest). Checks
// which ops run, in what order, with what input -- so create/edit/share/
// delete flows don't need clicking through by hand on each OS.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type Call = { op: string; args: string[]; input: unknown };
const calls: Call[] = [];
let answers: boolean[] = [];
let failNext: Record<string, { code: string; message: string }> = {};

interface FakeLocal {
  name: string; description: string; root: "common" | "catalog" | "personal";
  enabled: boolean; owner: string; mine: boolean; shared: boolean; auto_sync?: boolean; body?: string;
}
let local: FakeLocal[] = [];
const catalog = [
  { name: "expense-check", owner: "taro", modified: "2026-10-01", description: "経費精算のチェック", installed: null },
  { name: "slide-generator", owner: "_default", modified: "2026-07-16", description: "Marp を PPTX に変換", installed: "catalog" },
  { name: "pdf-tools", owner: "hanako", modified: "2026-09-01", description: "PDF を結合", installed: null },
];

function fake(op: string, args: string[], input: unknown) {
  if (failNext[op]) {
    const error = failNext[op];
    delete failNext[op];
    return { ok: false, error, log: "" };
  }
  const ok = (data: unknown) => ({ ok: true, data, log: "" });
  const find = (n: string) => local.find((s) => s.name === n)!;
  switch (op) {
    case "catalog": return ok({ skills: catalog, offline: false });
    case "local": return ok({ skills: local.map(({ body: _b, ...s }) => s), me: "test" });
    case "read": {
      const s = local.find((x) => x.name === args[0] && (!args[1] || x.root === args[1]))!;
      return ok({ ...s, body: s.body ?? "body\n", content: "", editable: s.root === "personal", extra_files: s.name === "with-files" ? ["run.py"] : [] });
    }
    case "create": {
      const d = input as { name: string; description: string; body: string };
      local.push({ name: d.name, description: d.description, body: d.body, root: "personal", enabled: true, owner: "", mine: true, shared: false });
      return ok({ name: d.name });
    }
    case "save": {
      const d = input as { name: string; description: string; body: string };
      Object.assign(find(d.name), { description: d.description, body: d.body });
      return ok({ name: d.name, shared: find(d.name).shared });
    }
    case "delete": case "uninstall":
      local = local.filter((s) => s.name !== args[0]);
      return ok({ name: args[0] });
    case "export": {
      const d = input as { skills: { name: string }[]; path: string };
      return ok({ path: d.path, names: d.skills.map((x) => x.name) });
    }
    case "import-file": {
      const d = input as { path: string; overwrite: boolean };
      if (local.some((x) => x.name === "from-file") && !d.overwrite) {
        return { ok: false, error: { code: "exists", message: "x / x", names: ["from-file"] }, log: "" };
      }
      local = local.filter((x) => x.name !== "from-file");
      local.push({ name: "from-file", description: "imported file", root: "personal", enabled: true, owner: "", mine: true, shared: false });
      return ok({ names: ["from-file"], overwrote: [], shadowed: [] });
    }
    case "share": find(args[0]).shared = true; return ok({ name: args[0] });
    case "unshare": find(args[0]).shared = false; return ok({ name: args[0] });
    case "disable": find(args[0]).enabled = false; return ok({ name: args[0] });
    case "enable": find(args[0]).enabled = true; return ok({ name: args[0] });
    default: return ok({});
  }
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (_cmd: string, a: { op: string; args: string[]; input: string | null }) => {
    const input = a.input === null ? undefined : JSON.parse(a.input);
    calls.push({ op: a.op, args: a.args, input });
    return fake(a.op, a.args, input);
  },
}));
let savePath: string | null = "/out/x.zip";
let openPath: string | null = "/in/skill.zip";
const dialogCalls: { kind: string; opts: unknown }[] = [];
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: async () => (answers.length ? answers.shift()! : true),
  save: async (opts: unknown) => { dialogCalls.push({ kind: "save", opts }); return savePath; },
  open: async (opts: unknown) => { dialogCalls.push({ kind: "open", opts }); return openPath; },
}));

const { SkillCatalogPanel } = await import("./SkillCatalogPanel");

const ops = () => calls.map((c) => c.op);
const opsSince = (n: number) => calls.slice(n).map((c) => c.op);
const card = (name: string) => screen.getByText(name, { selector: "strong" }).closest(".catalog-card") as HTMLElement;
const btnIn = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;
const idle = () => waitFor(() => expect(screen.queryByText(/⏳/)).toBeNull());

async function openMine() {
  await screen.findByText("expense-check"); // catalog tab loaded; tabs enabled again
  await idle();
  fireEvent.click(screen.getByRole("button", { name: "マイスキル" }));
  await screen.findByText("my-skill", { selector: "strong" });
  await idle();
}

async function openInstalled() {
  await openMine();
  fireEvent.click(screen.getByRole("button", { name: "インストール済み" }));
  await screen.findByText("expense-check", { selector: "strong" });
}

beforeEach(() => {
  calls.length = 0;
  dialogCalls.length = 0;
  savePath = "/out/x.zip";
  openPath = "/in/skill.zip";
  answers = [];
  failNext = {};
  local = [
    { name: "my-skill", description: "mine", root: "personal", enabled: true, owner: "", mine: true, shared: false, body: "old body\n" },
    { name: "my-shared", description: "shared one", root: "personal", enabled: true, owner: "test", mine: true, shared: true },
    { name: "expense-check", description: "imported", root: "catalog", enabled: true, owner: "taro", mine: false, shared: false },
    { name: "slide-generator", description: "org", root: "catalog", enabled: true, owner: "", mine: false, shared: false, auto_sync: true },
    { name: "setup", description: "builtin", root: "common", enabled: true, owner: "", mine: false, shared: false },
  ];
});
afterEach(cleanup);

describe("catalog tab", () => {
  it("loads once, then filters as you type without calling the script again", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await screen.findByText("expense-check");
    await idle();
    expect(ops()).toEqual(["catalog"]);
    const box = screen.getByPlaceholderText(/名前・作成者・説明/);
    fireEvent.change(box, { target: { value: "ぴーでぃーえふ" } }); // no match: kana is not romanized
    expect(screen.queryByText("expense-check")).toBeNull();
    fireEvent.change(box, { target: { value: "経費" } });
    expect(screen.getByText("expense-check")).toBeTruthy();
    expect(screen.queryByText("pdf-tools")).toBeNull();
    fireEvent.change(box, { target: { value: "hanako" } }); // by author
    expect(screen.getByText("pdf-tools")).toBeTruthy();
    expect(screen.getByText("1 件")).toBeTruthy();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("該当するスキルはありません。")).toBeTruthy();
    expect(ops()).toEqual(["catalog"]);
  });

  it("filters by author from the menu or by clicking an author", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await screen.findByText("expense-check");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["すべての作成者", "全員に配布", "hanako", "taro"]);
    fireEvent.change(select, { target: { value: "taro" } });
    expect(screen.getByText("expense-check")).toBeTruthy();
    expect(screen.queryByText("pdf-tools")).toBeNull();
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "hanako" }));
    expect(select.value).toBe("hanako");
    expect(screen.queryByText("expense-check")).toBeNull();
  });

  it("import runs import then rebuild, and keeps the done message after reloading", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await screen.findByText("expense-check");
    await idle();
    fireEvent.click(btnIn(card("expense-check"), "追加"));
    await screen.findByText(/完了しました/);
    await idle();
    expect(calls.find((c) => c.op === "import")!.args).toEqual(["taro/expense-check"]);
    expect(ops()).toEqual(["catalog", "import", "rebuild", "catalog"]);
    expect(screen.getByText(/完了しました/)).toBeTruthy();
  });
});

describe("tabs: マイスキル = yours only, インストール済み = added + built-in", () => {
  const labels = (n: string) => [...card(n).querySelectorAll("button")].map((b) => b.textContent);
  it("three tabs in order", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await screen.findByText("expense-check");
    const tabs = screen.getAllByRole("button").map((b) => b.textContent).filter((t) => ["カタログ", "マイスキル", "インストール済み"].includes(t!));
    expect(tabs).toEqual(["カタログ", "マイスキル", "インストール済み"]);
  });
  it("マイスキル: only skills-personal/, with its toolbar", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    expect(labels("my-skill")).toEqual(["編集", "カタログに共有", "無効にする", "エクスポート", "削除"]);
    expect(labels("my-shared")).toEqual(["編集", "カタログの版を更新", "共有を取り下げ", "無効にする", "エクスポート", "削除"]);
    for (const other of ["expense-check", "slide-generator", "setup"]) {
      expect(screen.queryByText(other, { selector: "strong" })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "＋ 新しいスキル" })).toBeTruthy();
    expect(screen.getByText("2 件")).toBeTruthy();
  });
  it("someone else's skill in マイスキル shows its author", async () => {
    local.push({ name: "from-taro", description: "x", root: "personal", enabled: true, owner: "taro", mine: false, shared: false });
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    expect(card("from-taro").textContent).toContain("作成: taro");
    expect(card("my-skill").textContent).not.toContain("作成:");
  });
  it("empty マイスキル explains how to start", async () => {
    local = local.filter((x) => x.root !== "personal");
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await screen.findByText("expense-check");
    await idle();
    fireEvent.click(screen.getByRole("button", { name: "マイスキル" }));
    await screen.findByText(/まだ自分のスキルはありません/);
  });
  it("インストール済み: sections, buttons; no own skills, no toolbar", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openInstalled();
    expect(screen.getByText("カタログから追加したスキル (2)")).toBeTruthy();
    expect(screen.getByText("標準スキル (1)")).toBeTruthy();
    expect(screen.queryByText("my-skill", { selector: "strong" })).toBeNull();
    expect(screen.queryByRole("button", { name: "＋ 新しいスキル" })).toBeNull();
    expect(card("expense-check").textContent).toContain("作成: taro");
    expect(card("setup").closest("details")).not.toBeNull(); // built-ins folded
    expect(screen.getByText("3 件")).toBeTruthy();
    expect(labels("expense-check")).toEqual(["中身を見る", "無効にする", "エクスポート", "アンインストール"]);
    expect(labels("slide-generator")).toEqual(["中身を見る", "無効にする", "エクスポート"]);
    expect(labels("setup")).toEqual(["中身を見る"]);
    expect(card("slide-generator").textContent).toContain("全員に配布");
  });

  it("the filter box works on these tabs too", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.change(screen.getByPlaceholderText(/名前・作成者・説明/), { target: { value: "shared" } });
    expect(screen.getByText("my-shared")).toBeTruthy();
    expect(screen.queryByText("my-skill", { selector: "strong" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "インストール済み" }));
    fireEvent.change(screen.getByPlaceholderText(/名前・作成者・説明/), { target: { value: "taro" } });
    expect(screen.getByText("expense-check", { selector: "strong" })).toBeTruthy();
    expect(screen.queryByText("setup", { selector: "strong" })).toBeNull();
  });

  it("a search opens the folded built-in section", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openInstalled();
    const det = () => card("setup").closest("details") as HTMLDetailsElement;
    expect(det().open).toBe(false);
    fireEvent.change(screen.getByPlaceholderText(/名前・作成者・説明/), { target: { value: "setup" } });
    expect(det().open).toBe(true);
  });
});

describe("create", () => {
  it("validates in the form, then create + rebuild, and the new skill shows up", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しいスキル" }));
    const body = screen.getByLabelText("手順（AI への指示）") as HTMLTextAreaElement;
    expect(body.value).toContain("## やること"); // template
    const n = calls.length;
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(screen.getByRole("alert").textContent).toContain("スキル名は");
    fireEvent.change(screen.getByLabelText("スキル名"), { target: { value: " Weekly-Report " } });
    expect((screen.getByLabelText("スキル名") as HTMLInputElement).value).toBe("weekly-report");
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(screen.getByRole("alert").textContent).toContain("説明を入力");
    expect(calls.length).toBe(n); // nothing sent while invalid
    fireEvent.change(screen.getByLabelText("説明"), { target: { value: "週報を作る" } });
    fireEvent.change(body, { target: { value: "1. 予定を集める\n2. まとめる" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    await screen.findByText("weekly-report", { selector: "strong" });
    await idle();
    expect(opsSince(n)).toEqual(["create", "rebuild", "local"]);
    expect(calls[n].input).toEqual({ name: "weekly-report", description: "週報を作る", body: "1. 予定を集める\n2. まとめる" });
    expect(screen.getByText(/完了しました/)).toBeTruthy();
  });

  it("a refused create keeps the form and what was typed", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しいスキル" }));
    fireEvent.change(screen.getByLabelText("スキル名"), { target: { value: "setup" } });
    fireEvent.change(screen.getByLabelText("説明"), { target: { value: "d" } });
    failNext.create = { code: "exists", message: "同じ名前のスキルがあります（標準スキル / built-in）/ A skill named setup already exists" };
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    await screen.findByText(/同じ名前のスキルがあります/);
    expect((screen.getByLabelText("スキル名") as HTMLInputElement).value).toBe("setup");
    expect(ops()).not.toContain("rebuild");
  });

  it("'Create with AI' sends my-skills create to the session and closes", async () => {
    const onAskAgent = vi.fn(() => true);
    const onClose = vi.fn();
    render(<SkillCatalogPanel lang="ja" onClose={onClose} onAskAgent={onAskAgent} />);
    await openMine();
    fireEvent.click(screen.getByRole("button", { name: "🤖 AI と相談して作る" }));
    expect(onAskAgent).toHaveBeenCalledWith("my-skills create");
    expect(onClose).toHaveBeenCalled();
  });

  it("without a running session it says so and stays open", async () => {
    const onClose = vi.fn();
    render(<SkillCatalogPanel lang="ja" onClose={onClose} onAskAgent={() => false} />);
    await openMine();
    fireEvent.click(screen.getByRole("button", { name: "🤖 AI と相談して作る" }));
    expect(screen.getByText(/先にセッションを開始/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("edit", () => {
  it("reads the personal copy, saves description+body, rebuilds", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.click(btnIn(card("my-skill"), "編集"));
    const body = (await screen.findByLabelText("手順（AI への指示）")) as HTMLTextAreaElement;
    expect(calls.find((c) => c.op === "read")!.args).toEqual(["my-skill", "personal"]);
    expect(body.value).toBe("old body\n");
    expect(screen.queryByLabelText("スキル名")).toBeNull(); // name is fixed
    const n = calls.length;
    fireEvent.change(body, { target: { value: "new body" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/完了しました/);
    await idle();
    expect(opsSince(n)).toEqual(["save", "rebuild", "local"]);
    expect(calls[n].input).toEqual({ name: "my-skill", description: "mine", body: "new body" });
  });

  it("saving a shared skill offers to update the catalog copy", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.click(btnIn(card("my-shared"), "編集"));
    await screen.findByLabelText("説明");
    fireEvent.change(screen.getByLabelText("説明"), { target: { value: "better" } });
    const n = calls.length;
    answers = [true];
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(opsSince(n)).toEqual(["save", "rebuild", "share", "local"]));
    expect(calls.find((c) => c.op === "share")!.args).toEqual(["my-shared"]);
  });

  it("declining the catalog update leaves the catalog alone", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.click(btnIn(card("my-shared"), "編集"));
    await screen.findByLabelText("説明");
    const n = calls.length;
    answers = [false];
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(opsSince(n)).toEqual(["save", "rebuild", "local"]));
  });

  it("cancel with unsaved changes asks; 'no' keeps editing", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.click(btnIn(card("my-skill"), "編集"));
    const body = await screen.findByLabelText("手順（AI への指示）");
    fireEvent.change(body, { target: { value: "changed" } });
    answers = [false];
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "キャンセル" })));
    expect(screen.getByLabelText("手順（AI への指示）")).toBeTruthy();
    answers = [true];
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "キャンセル" })));
    expect(screen.queryByLabelText("手順（AI への指示）")).toBeNull();
    expect(ops()).not.toContain("save");
  });

  it("imported/built-in skills open read-only", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openInstalled();
    fireEvent.click(btnIn(card("expense-check"), "中身を見る"));
    const body = (await screen.findByLabelText("手順（AI への指示）")) as HTMLTextAreaElement;
    expect(body.readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.getByText(/編集できません/)).toBeTruthy();
  });

  it("'Improve with AI' sends my-skills update <name>", async () => {
    const onAskAgent = vi.fn(() => true);
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} onAskAgent={onAskAgent} />);
    await openMine();
    fireEvent.click(btnIn(card("my-skill"), "編集"));
    fireEvent.click(await screen.findByRole("button", { name: "🤖 AI と相談して改善" }));
    expect(onAskAgent).toHaveBeenCalledWith("my-skills update my-skill");
  });
});

describe("share / delete / uninstall", () => {
  it.each([
    ["my-skill", "カタログに共有", ["share", "local"]],
    ["my-shared", "カタログの版を更新", ["share", "local"]],
    ["my-shared", "共有を取り下げ", ["unshare", "local"]],
    ["my-skill", "削除", ["delete", "rebuild", "local"]],
    ["my-shared", "削除", ["unshare", "delete", "rebuild", "local"]],
    ["expense-check", "アンインストール", ["uninstall", "rebuild", "local"]],
    ["my-skill", "無効にする", ["disable", "rebuild", "local"]],
  ])("%s: %s -> %j after confirming", async (name, label, expected) => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await (name === "expense-check" ? openInstalled() : openMine());
    const n = calls.length;
    fireEvent.click(btnIn(card(name), label));
    await waitFor(() => expect(opsSince(n)).toEqual(expected));
    for (const c of calls.slice(n)) if (c.op !== "local" && c.op !== "rebuild") expect(c.args).toEqual([name]);
  });

  it.each([
    ["my-skill", "削除"],
    ["my-shared", "共有を取り下げ"],
    ["expense-check", "アンインストール"],
    ["my-skill", "カタログに共有"],
  ])("%s: %s does nothing when not confirmed", async (name, label) => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await (name === "expense-check" ? openInstalled() : openMine());
    const n = calls.length;
    answers = [false];
    await act(async () => fireEvent.click(btnIn(card(name), label)));
    await idle();
    expect(opsSince(n)).toEqual([]);
  });

  it("a failed unshare stops the delete", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    const n = calls.length;
    failNext.unshare = { code: "exception", message: "HttpError 500" };
    fireEvent.click(btnIn(card("my-shared"), "削除"));
    await screen.findByText(/HttpError 500/);
    expect(opsSince(n)).toEqual(["unshare"]);
  });

  it("buttons are disabled while an op runs (and the quit guard is told)", async () => {
    const busy: boolean[] = [];
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} onBusyChange={(b) => busy.push(b)} />);
    await openMine();
    expect(busy).toContain(true);
    expect(busy[busy.length - 1]).toBe(false);
  });
});

describe("English", () => {
  it("labels and script messages in English", async () => {
    render(<SkillCatalogPanel lang="en" onClose={() => {}} />);
    await screen.findByText("expense-check");
    await idle();
    fireEvent.click(screen.getByRole("button", { name: "My Skills" }));
    await screen.findByText("my-skill", { selector: "strong" });
    await idle();
    expect(btnIn(card("my-skill"), "Edit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ New skill" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "setup" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "d" } });
    failNext.create = { code: "exists", message: "同じ名前のスキルがあります / A skill named setup already exists" };
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("A skill named setup already exists");
  });
});

describe("public install (no org catalog)", () => {
  it("opens on My Skills, no catalog tab, no share buttons, local ops still work", async () => {
    failNext.catalog = { code: "no_catalog", message: "x" };
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await screen.findByText("my-skill", { selector: "strong" });
    await idle();
    expect(screen.queryByRole("button", { name: "カタログ" })).toBeNull();
    expect(screen.getByRole("button", { name: "インストール済み" })).toBeTruthy();
    expect(screen.getByText(/共有スキルカタログがありません/)).toBeTruthy();
    const labels = (n: string) => [...card(n).querySelectorAll("button")].map((b) => b.textContent);
    expect(labels("my-skill")).toEqual(["編集", "無効にする", "エクスポート", "削除"]);
    expect(labels("my-shared")).toEqual(["編集", "無効にする", "エクスポート", "削除"]);
    expect(ops()).toEqual(["catalog", "local"]);
    const n = calls.length;
    fireEvent.click(btnIn(card("my-skill"), "無効にする"));
    await waitFor(() => expect(opsSince(n)).toEqual(["disable", "rebuild", "local"]));
  });
});

describe("export / import files", () => {
  it("exports one skill to the chosen file (name suggested)", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    const n = calls.length;
    fireEvent.click(btnIn(card("my-skill"), "エクスポート"));
    await screen.findByText(/\/out\/x\.zip に保存しました/);
    expect((dialogCalls[0].opts as { defaultPath: string }).defaultPath).toBe("my-skill.zip");
    expect(opsSince(n)).toEqual(["export"]);
    expect(calls[n].input).toEqual({ skills: [{ name: "my-skill", root: "personal" }], path: "/out/x.zip" });
  });

  it("export all = your own skills in one file", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    fireEvent.click(screen.getByRole("button", { name: "📤 マイスキルをすべてエクスポート" }));
    await screen.findByText(/保存しました/);
    const exp = calls.find((c) => c.op === "export")!;
    expect((exp.input as { skills: { name: string }[] }).skills.map((x) => x.name)).toEqual(["my-shared", "my-skill"]);
    expect((dialogCalls[0].opts as { defaultPath: string }).defaultPath).toMatch(/^agent-deck-skills-\d{8}\.zip$/);
  });

  it("cancelling the save dialog does nothing", async () => {
    savePath = null;
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    const n = calls.length;
    await act(async () => fireEvent.click(btnIn(card("my-skill"), "エクスポート")));
    expect(opsSince(n)).toEqual([]);
  });

  it("imports a file, rebuilds, shows it", async () => {
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    const n = calls.length;
    fireEvent.click(screen.getByRole("button", { name: "📥 ファイルから読み込む" }));
    await screen.findByText("from-file", { selector: "strong" });
    await idle();
    expect(opsSince(n)).toEqual(["import-file", "rebuild", "local"]);
    expect(calls[n].input).toEqual({ path: "/in/skill.zip", overwrite: false });
    expect(screen.getByText(/読み込みました: from-file/)).toBeTruthy();
    expect((dialogCalls[0].opts as { filters: { extensions: string[] }[] }).filters[0].extensions).toEqual(["zip", "md"]);
  });

  it("same name: asks, then overwrites; 'no' changes nothing", async () => {
    local.push({ name: "from-file", description: "old", root: "personal", enabled: true, owner: "", mine: true, shared: false });
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    let n = calls.length;
    answers = [false];
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "📥 ファイルから読み込む" })));
    await idle();
    expect(opsSince(n)).toEqual(["import-file"]);
    n = calls.length;
    answers = [true];
    fireEvent.click(screen.getByRole("button", { name: "📥 ファイルから読み込む" }));
    await waitFor(() => expect(opsSince(n)).toEqual(["import-file", "import-file", "rebuild", "local"]));
    expect(calls[n + 1].input).toEqual({ path: "/in/skill.zip", overwrite: true });
  });

  it("cancelling the open dialog does nothing", async () => {
    openPath = null;
    render(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    await openMine();
    const n = calls.length;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "📥 ファイルから読み込む" })));
    expect(opsSince(n)).toEqual([]);
  });
});
