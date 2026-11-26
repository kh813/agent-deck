import { describe, expect, it } from "vitest";
import { TABS_STORAGE_KEY, defaultTabs, loadSavedTabs, sanitizeSavedTabs, saveTabs } from "./tabPersistence";
import { promptNotifications } from "./sessionNotify";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("tab restore", () => {
  it("round trip: names, folders, engines, order, active tab", () => {
    const st = mem();
    const saved = { tabs: [{ id: "main", name: "", cwd: "", engineId: "agy" }, { id: "tab-1", name: "レポート", cwd: "/p/a", engineId: "claude" }], activeId: "tab-1" };
    saveTabs(saved, st);
    expect(st.m.has(TABS_STORAGE_KEY)).toBe(true);
    expect(loadSavedTabs("agy", st)).toEqual(saved);
  });
  it("drops what can't be trusted", () => {
    const r = sanitizeSavedTabs({
      tabs: [
        { id: "../evil", cwd: "/x" }, { id: "ok", name: 5, cwd: 7 }, { id: "ok", cwd: "/dup" },
        null, { id: "two", name: "x".repeat(99), cwd: "/b", engineId: "" },
      ],
      activeId: "missing",
    }, "agy")!;
    expect(r.tabs.map((t) => t.id)).toEqual(["ok", "two"]);
    expect(r.tabs[0]).toEqual({ id: "ok", name: "", cwd: "", engineId: "agy" });
    expect(r.tabs[1].name.length).toBe(60);
    expect(r.tabs[1].engineId).toBe("agy");
    expect(r.activeId).toBe("ok");
  });
  it("never more than 6; garbage -> nothing", () => {
    const many = { tabs: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, cwd: `/p/dir-${i}` })), activeId: "t0" };
    expect(sanitizeSavedTabs(many, "agy")!.tabs).toHaveLength(6);
    for (const bad of [null, 1, "x", { tabs: "x" }, { tabs: [] }]) expect(sanitizeSavedTabs(bad, "agy")).toBeNull();
    expect(loadSavedTabs("agy", { getItem: () => "{not json" })).toBeNull();
    expect(loadSavedTabs("agy", null)).toBeNull();
  });
  it("drops overlapping or duplicate folders when restoring tabs", () => {
    const r = sanitizeSavedTabs({
      tabs: [
        { id: "main", cwd: "", engineId: "agy" },
        { id: "dup-default", cwd: "", engineId: "claude" },
        { id: "t1", cwd: "/work/proj", engineId: "agy" },
        { id: "t2", cwd: "/work/proj/sub", engineId: "claude" },
        { id: "t3", cwd: "/work/other", engineId: "claude" },
      ],
      activeId: "t2",
    }, "agy", true)!;
    expect(r.tabs.map((t) => t.id)).toEqual(["main", "t1", "t3"]);
    expect(r.activeId).toBe("main");
  });
  it("default is one main tab", () => {
    expect(defaultTabs("claude")).toEqual({ tabs: [{ id: "main", name: "", cwd: "", engineId: "claude" }], activeId: "main" });
  });
});

describe("'needs you' notifications", () => {
  const prompt = (message: string) => ({ activePrompt: { message } });
  it("hidden tab waiting -> notify once", () => {
    let r = promptNotifications({ a: prompt("Allow edit?"), b: { activePrompt: null } }, "b", true, {});
    expect(r.notify).toEqual([{ sessionId: "a", message: "Allow edit?" }]);
    r = promptNotifications({ a: prompt("Allow edit?") }, "b", true, r.notified);
    expect(r.notify).toEqual([]);
  });
  it("the visible tab notifies only while the app is in the background", () => {
    expect(promptNotifications({ a: prompt("x") }, "a", true, {}).notify).toEqual([]);
    expect(promptNotifications({ a: prompt("x") }, "a", false, {}).notify).toHaveLength(1);
  });
  it("a new prompt in the same tab notifies again; an answered one is forgotten", () => {
    let r = promptNotifications({ a: prompt("one") }, "b", true, {});
    r = promptNotifications({ a: prompt("two") }, "b", true, r.notified);
    expect(r.notify.map((n) => n.message)).toEqual(["two"]);
    r = promptNotifications({ a: { activePrompt: null } }, "b", true, r.notified);
    expect(r.notified).toEqual({});
    expect(promptNotifications({ a: prompt("two") }, "b", true, r.notified).notify).toHaveLength(1);
  });
});
