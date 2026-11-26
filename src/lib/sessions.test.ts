import { describe, expect, it } from "vitest";
import * as s from "./sessions";

const tab = (id: string, cwd = `/p/${id}`, name = ""): s.Tab => ({ id, name, cwd, engineId: "agy" });

describe("session ids", () => {
  it("fresh ids are unique, valid and never the default", () => {
    const seen: string[] = [s.DEFAULT_SESSION_ID];
    for (let i = 0; i < 200; i++) {
      const id = s.newSessionId(seen);
      expect(s.SESSION_ID_RE.test(id)).toBe(true);
      expect(seen).not.toContain(id);
      seen.push(id);
    }
  });
  it("retries on a collision", () => {
    let n = 0;
    const rand = () => (n++ === 0 ? 0 : 0.5);
    const first = s.newSessionId([], () => 0);
    expect(s.newSessionId([first], rand)).not.toBe(first);
  });
  it("same rule as pty.rs valid_session_id", () => {
    expect(s.SESSION_ID_RE.test("main")).toBe(true);
    for (const bad of ["", "../x", "a b", "x".repeat(65)]) expect(s.SESSION_ID_RE.test(bad)).toBe(false);
  });
  it("events are matched to their own session only", () => {
    expect(s.isForSession({ session_id: "tab-a" }, "tab-a")).toBe(true);
    expect(s.isForSession({ session_id: "tab-b" }, "tab-a")).toBe(false);
    expect(s.isForSession(null, "tab-a")).toBe(false);
    expect(s.isForSession({}, "main")).toBe(false);
  });
});

describe("tabs", () => {
  it("label: own name, else folder name, else fallback", () => {
    expect(s.tabLabel(tab("a", "/Users/me/proj", "  レポート "), "x")).toBe("レポート");
    expect(s.tabLabel(tab("a", "C:\\Users\\me\\proj\\"), "x")).toBe("proj");
    expect(s.tabLabel(tab("a", ""), "アプリの場所")).toBe("アプリの場所");
  });
  it("adds up to the limit, no duplicate ids", () => {
    let t: s.Tab[] = [];
    for (let i = 0; i < s.MAX_TABS; i++) t = s.addTab(t, tab(`t${i}`));
    expect(s.canAddTab(t)).toBe(false);
    expect(() => s.addTab(t, tab("extra"))).toThrow();
    expect(() => s.addTab([tab("a")], tab("a"))).toThrow();
    expect(s.MAX_TABS).toBe(6);
  });
  it("rename trims, single line, max 60 chars; others untouched", () => {
    const t = s.renameTab([tab("a"), tab("b", "/q", "keep")], "a", "  new\nname\t" + "x".repeat(80));
    expect(t[0].name.includes("\n")).toBe(false);
    expect(t[0].name.length).toBeLessThanOrEqual(60);
    expect(t[0].name.startsWith("new name")).toBe(true);
    expect(t[1].name).toBe("keep");
  });
  it("update and remove", () => {
    const t = s.updateTab([tab("a"), tab("b")], "b", { engineId: "claude" });
    expect(t[1].engineId).toBe("claude");
    expect(s.removeTab(t, "a").map((x) => x.id)).toEqual(["b"]);
  });
  it("after closing: keep the active tab, else the next, else the previous", () => {
    const t = [tab("a"), tab("b"), tab("c")];
    expect(s.nextActiveAfterClose(t, "a", "c")).toBe("c");
    expect(s.nextActiveAfterClose(t, "b", "b")).toBe("c");
    expect(s.nextActiveAfterClose(t, "c", "c")).toBe("b");
    expect(s.nextActiveAfterClose([tab("a")], "a", "a")).toBeNull();
  });
});

describe("folder conflicts (same or nested folder)", () => {
  it("same folder, trailing slashes and separators", () => {
    expect(s.foldersOverlap("/Users/me/proj", "/Users/me/proj/", false)).toBe(true);
    expect(s.foldersOverlap("C:\\work\\proj", "C:/work/proj", true)).toBe(true);
  });
  it("nested either way", () => {
    expect(s.foldersOverlap("/Users/me/proj", "/Users/me/proj/docs", false)).toBe(true);
    expect(s.foldersOverlap("/Users/me/proj/docs", "/Users/me/proj", false)).toBe(true);
  });
  it("siblings with a shared prefix are not nested", () => {
    expect(s.foldersOverlap("/Users/me/proj", "/Users/me/project", false)).toBe(false);
    expect(s.foldersOverlap("/a/b", "/a/c", false)).toBe(false);
  });
  it("case: ignored on Windows/default macOS volumes, respected otherwise", () => {
    expect(s.foldersOverlap("C:\\Work\\Proj", "c:\\work\\proj\\x", true)).toBe(true);
    expect(s.foldersOverlap("/Users/me/Proj", "/Users/me/proj", false)).toBe(false);
  });
  it("roots and empty paths", () => {
    expect(s.foldersOverlap("/", "/anything", false)).toBe(true);
    expect(s.foldersOverlap("C:\\", "C:\\x", true)).toBe(true);
    expect(s.foldersOverlap("", "/x", false)).toBe(false);
  });
  it("finds the conflicting tab, ignoring the tab being changed", () => {
    const tabs = [tab("a", "/p/proj"), tab("b", "/p/other")];
    expect(s.findFolderConflict(tabs, "/p/proj/sub", false)?.id).toBe("a");
    expect(s.findFolderConflict(tabs, "/p/new", false)).toBeNull();
    expect(s.findFolderConflict(tabs, "/p/proj", false, "a")).toBeNull();
  });
});
