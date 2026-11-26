import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const m = await import("./skillCatalog");

const cat = (installed: m.Installed) => ({ name: "x", owner: "taro", modified: "", description: "", installed });
const loc = (o: Partial<m.LocalSkill>): m.LocalSkill => ({
  name: "x", description: "", root: "personal", enabled: true, owner: "", mine: true, shared: false, ...o,
});

describe("catalogCardAction", () => {
  it("not installed -> import; imported -> reimport", () => {
    expect(m.catalogCardAction(cat(null))).toEqual({ kind: "import" });
    expect(m.catalogCardAction(cat("catalog"))).toEqual({ kind: "reimport" });
  });
  it("built-in or your own same-named skill -> no button", () => {
    expect(m.catalogCardAction(cat("common"))).toEqual({ kind: "none", label: "builtin" });
    expect(m.catalogCardAction(cat("personal"))).toEqual({ kind: "none", label: "yours" });
  });
  it("imports by owner/name", () => {
    expect(m.importTarget({ owner: "taro", name: "expense" })).toBe("taro/expense");
  });
});

describe("localActions", () => {
  it("your enabled skill: edit, share, disable, delete", () => {
    expect(m.localActions(loc({}))).toEqual(["edit", "share", "disable", "export", "delete"]);
  });
  it("your shared skill: update the shared copy or unshare", () => {
    expect(m.localActions(loc({ shared: true }))).toEqual(["edit", "reshare", "unshare", "disable", "export", "delete"]);
    // still shared while disabled: unsharing stays possible (updating needs it enabled)
    expect(m.localActions(loc({ shared: true, enabled: false }))).toEqual(["edit", "unshare", "enable", "export", "delete"]);
  });
  it("disabled unshared skill: no share", () => {
    expect(m.localActions(loc({ enabled: false }))).toEqual(["edit", "enable", "export", "delete"]);
  });
  it("a personal skill someone else owns: edit/toggle/delete but never share", () => {
    expect(m.localActions(loc({ mine: false }))).toEqual(["edit", "disable", "export", "delete"]);
  });
  it("imported skills: view, toggle, uninstall (never share/edit someone else's)", () => {
    expect(m.localActions(loc({ root: "catalog", mine: false }))).toEqual(["view", "disable", "export", "uninstall"]);
    expect(m.localActions(loc({ root: "catalog", mine: false, enabled: false }))).toEqual(["view", "enable", "export", "uninstall"]);
  });
  it("org auto-installed skills can't be uninstalled (they'd come back)", () => {
    expect(m.localActions(loc({ root: "catalog", mine: false, auto_sync: true }))).toEqual(["view", "disable", "export"]);
  });
  it("built-in skills: view only", () => {
    expect(m.localActions(loc({ root: "common", mine: false }))).toEqual(["view"]);
  });
  it("every action has a label in both languages and a known op", () => {
    const all: m.LocalAction[] = ["view", "edit", "share", "reshare", "unshare", "enable", "disable", "export", "delete", "uninstall"];
    for (const a of all) {
      expect(m.catalogText("ja", a)).not.toBe(a);
      expect(m.catalogText("en", a)).not.toBe("");
    }
    expect(m.opForAction("view")).toBeNull();
    expect(m.opForAction("edit")).toBeNull();
    expect(m.opForAction("export")).toBeNull();
    expect(m.opForAction("reshare")).toBe("share");
    expect(m.opForAction("delete")).toBe("delete");
    expect(m.opForAction("uninstall")).toBe("uninstall");
  });
});

describe("drafts", () => {
  const d = (o: Partial<m.SkillDraft> = {}): m.SkillDraft => ({ name: "weekly-report", description: "d", body: "b", ...o });
  it("accepts a good draft", () => {
    expect(m.draftProblem(d(), true)).toBeNull();
  });
  it.each(["", "a", "Weekly", "週報", "has space", "../x", "-x", "disabled", "x".repeat(65)])("rejects name %j", (name) => {
    expect(m.draftProblem(d({ name }), true)).toBe("name");
  });
  it("name isn't checked when editing (it can't change)", () => {
    expect(m.draftProblem(d({ name: "Legacy_Name" }), false)).toBeNull();
  });
  it("requires description and body", () => {
    expect(m.draftProblem(d({ description: "  " }), true)).toBe("description");
    expect(m.draftProblem(d({ body: "\n \n" }), false)).toBe("body");
  });
  it("same name rule as the Python side", async () => {
    const fs = await import("node:fs");
    const py = fs.readFileSync(new URL("../../python/scripts/setup/skills_catalog.py", import.meta.url), "utf8");
    expect(py).toContain(`SKILL_NAME_RE = re.compile(r"${m.SKILL_NAME_RE.source}")`);
  });
  it("template and agent prompts", () => {
    expect(m.skillTemplate("ja")).toContain("## やること");
    expect(m.skillTemplate("en")).toContain("## Steps");
    expect(m.agentPrompt("create")).toBe("my-skills create");
    expect(m.agentPrompt("update", "weekly-report")).toBe("my-skills update weekly-report");
  });
});

describe("search", () => {
  const S = [
    { name: "expense-check", owner: "taro", description: "経費精算のチェック" },
    { name: "slide-generator", owner: "_default", description: "Marp を PPTX に変換" },
    { name: "pdf-tools", owner: "hanako", description: "PDF を結合する" },
    { name: "taro-notes", owner: "jiro", description: "メモ" },
  ];
  const names = (q: string) => m.filterSkills(S, q).map((s) => s.name);
  it("empty query keeps everything in order", () => {
    expect(names("")).toEqual(S.map((s) => s.name));
    expect(names("  \u3000 ")).toEqual(S.map((s) => s.name));
  });
  it("matches name, owner and description", () => {
    expect(names("slide")).toEqual(["slide-generator"]);
    expect(names("hanako")).toEqual(["pdf-tools"]);
    expect(names("経費")).toEqual(["expense-check"]);
  });
  it("name hits rank above owner hits", () => {
    expect(names("taro")).toEqual(["taro-notes", "expense-check"]);
  });
  it("AND across keywords, full-width space too", () => {
    expect(names("pdf 結合")).toEqual(["pdf-tools"]);
    expect(names("pdf\u3000経費")).toEqual([]);
  });
  it("case, width and kana insensitive", () => {
    expect(names("ＰＤＦ")).toEqual(["pdf-tools"]);
    expect(names("pptx")).toEqual(["slide-generator"]);
    expect(m.normalizeForSearch("けいひ")).toBe(m.normalizeForSearch("ケイヒ"));
    expect(m.normalizeForSearch("ｽｷﾙ")).toBe("スキル");
  });
  it("author field counts as owner", () => {
    expect(m.filterSkills([{ name: "x", owner: "t", author: "Taro Yamada" }], "yamada")).toHaveLength(1);
  });
  it("owners: org set first, then A-Z; owner filter", () => {
    const cs = S.map((s) => ({ ...s, modified: "", installed: null }));
    expect(m.catalogOwners(cs)).toEqual(["_default", "hanako", "jiro", "taro"]);
    expect(m.filterByOwner(cs, "taro").map((s) => s.name)).toEqual(["expense-check"]);
    expect(m.filterByOwner(cs, "")).toHaveLength(4);
  });
});

describe("sortLocal", () => {
  it("yours, then imported, then built-in; by name within", () => {
    const s = m.sortLocal([
      loc({ name: "b-builtin", root: "common", mine: false }),
      loc({ name: "z-mine" }),
      loc({ name: "c-imported", root: "catalog", mine: false }),
      loc({ name: "a-mine" }),
    ]);
    expect(s.map((x) => x.name)).toEqual(["a-mine", "z-mine", "c-imported", "b-builtin"]);
  });
});

describe("op sets", () => {
  it("Drive ops warn about the browser login; install-changing ops rebuild", () => {
    expect(m.DRIVE_OPS.has("import") && m.DRIVE_OPS.has("share") && !m.DRIVE_OPS.has("local")).toBe(true);
    expect([...m.NEEDS_REBUILD].sort()).toEqual(["create", "delete", "disable", "enable", "import", "import-file", "save", "uninstall"]);
    for (const op of ["read", "create", "save", "delete", "uninstall", "local", "export", "import-file"] as const) expect(m.DRIVE_OPS.has(op)).toBe(false);
  });
});

describe("text", () => {
  it("both languages define every key", () => {
    const keys = ["title", "import", "err_no_catalog", "confirmUnshare"] as const;
    for (const k of keys) {
      expect(m.catalogText("ja", k)).not.toBe("");
      expect(m.catalogText("en", k)).not.toBe("");
    }
  });
  it("fills variables", () => {
    expect(m.catalogText("ja", "confirmUnshare", { name: "経費" })).toContain("「経費」");
    expect(m.catalogText("en", "confirmShare", { name: "x" })).toContain('"x"');
  });
  it("describeError maps codes, with candidates and fallback", () => {
    expect(m.describeError("ja", { code: "no_catalog", message: "" })).toContain("config.toml");
    expect(m.describeError("en", { code: "ambiguous", message: "", candidates: ["a/x", "b/x"] })).toContain("a/x, b/x");
    expect(m.describeError("en", { code: "exception", message: "OSError: down" })).toBe("Failed: OSError: down");
    expect(m.describeError("ja", { code: "timeout", message: "" })).toContain("時間内");
  });
  it("script messages show the reader's language half", () => {
    const e = { code: "exists", message: "同じ名前のスキルがあります / A skill named x already exists" };
    expect(m.describeError("ja", e)).toBe("同じ名前のスキルがあります");
    expect(m.describeError("en", e)).toBe("A skill named x already exists");
    expect(m.pickLang("no separator", "en")).toBe("no separator");
    for (const code of ["shared", "auto_sync", "not_editable", "invalid_name", "invalid_description", "invalid_body", "too_large"]) {
      expect(m.describeError("en", { code, message: "日 / En" })).toBe("En");
    }
  });
});

describe("callCatalog", () => {
  it("invokes catalog_api with op and args", async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { skills: [] }, log: "" });
    const r = await m.callCatalog("search", ["経費"]);
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith("catalog_api", { op: "search", args: ["経費"], input: null });
  });
  it("sends a draft as JSON input", async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { name: "x" }, log: "" });
    await m.callCatalog("create", [], { name: "x", description: "説明", body: "1行目\n2行目" });
    const sent = invoke.mock.lastCall![1] as { input: string };
    expect(JSON.parse(sent.input)).toEqual({ name: "x", description: "説明", body: "1行目\n2行目" });
  });
});

describe("export / import helpers", () => {
  it("file name: the skill, or a dated bundle", () => {
    expect(m.exportFileName(["weekly-report"])).toBe("weekly-report.zip");
    expect(m.exportFileName(["a", "b"], new Date(2026, 0, 5))).toBe("agent-deck-skills-20260105.zip");
  });
  it("export all = your own skills only, disabled included", () => {
    const t = m.exportAllTargets([
      loc({ name: "a" }), loc({ name: "b", enabled: false }),
      loc({ name: "c", root: "catalog", mine: false }), loc({ name: "d", root: "common", mine: false }),
    ]);
    expect(t).toEqual([{ name: "a", root: "personal" }, { name: "b", root: "personal" }]);
  });
});

describe("splitLocal", () => {
  it("My Skills = personal; Installed = added from catalog + built-in", () => {
    const r = m.splitLocal([
      loc({ name: "b" }), loc({ name: "a", mine: false, owner: "taro" }),
      loc({ name: "c", root: "catalog", mine: false }), loc({ name: "d", root: "common", mine: false }),
    ]);
    expect(r.mine.map((s) => s.name)).toEqual(["b", "a"]); // yours first, then others' files
    expect(r.added.map((s) => s.name)).toEqual(["c"]);
    expect(r.builtin.map((s) => s.name)).toEqual(["d"]);
  });
  it("catalog button wording: 追加 / 最新版に更新", () => {
    expect(m.catalogText("ja", "import")).toBe("追加");
    expect(m.catalogText("ja", "reimport")).toBe("最新版に更新");
    expect(m.catalogText("en", "tabInstalled")).toBe("Installed");
  });
});

describe("scale: 100 authors, 2000 skills", () => {
  const big = Array.from({ length: 2000 }, (_, i) => ({
    name: `skill-${i}`, owner: `user${i % 100}`, modified: "2026-11-01",
    description: `経費 PDF レポート 説明 ${i}`, installed: null,
  }));
  it("author menu: every author once, org set and you pinned", () => {
    const owners = m.catalogOwners([...big, { ...big[0], name: "x", owner: "_default" }], "user42");
    expect(owners).toHaveLength(101);
    expect(owners.slice(0, 2)).toEqual(["_default", "user42"]);
    expect(new Set(owners).size).toBe(101);
  });
  it("you aren't pinned if you have no skills there", () => {
    expect(m.catalogOwners(big.slice(0, 5), "nobody")).not.toContain("nobody");
  });
  it("filtering every keystroke stays fast", () => {
    const t = performance.now();
    for (const q of ["け", "けい", "経費", "経費 p", "経費 pdf", "user4"]) m.filterSkills(m.filterByOwner(big, ""), q);
    m.catalogOwners(big);
    expect(performance.now() - t).toBeLessThan(500); // ~a few ms in practice
  });
});
