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
  it("your enabled skill: share or unshare, and disable", () => {
    expect(m.localActions(loc({}))).toEqual(["share", "disable"]);
    expect(m.localActions(loc({ shared: true }))).toEqual(["unshare", "disable"]);
  });
  it("disabled skills can only be enabled", () => {
    expect(m.localActions(loc({ enabled: false }))).toEqual(["enable"]);
  });
  it("imported skills: enable/disable only (never share someone else's)", () => {
    expect(m.localActions(loc({ root: "catalog", mine: false }))).toEqual(["disable"]);
  });
  it("built-in skills: nothing", () => {
    expect(m.localActions(loc({ root: "common", mine: false }))).toEqual([]);
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
    expect([...m.NEEDS_REBUILD].sort()).toEqual(["disable", "enable", "import"]);
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
});

describe("callCatalog", () => {
  it("invokes catalog_api with op and args", async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { skills: [] }, log: "" });
    const r = await m.callCatalog("search", ["経費"]);
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith("catalog_api", { op: "search", args: ["経費"] });
  });
});
