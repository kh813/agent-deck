import { describe, expect, it } from "vitest";
import { sameSet, tabShortcutTarget } from "./tabShortcuts";
import { lightOf, workingSessions } from "./sessionLights";

const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
const ids = ["a", "b", "c"];

describe("tab shortcuts", () => {
  it("Ctrl+Tab / Ctrl+Shift+Tab cycle", () => {
    expect(tabShortcutTarget(k("Tab", { ctrlKey: true }), ids, "c", true)).toBe("a");
    expect(tabShortcutTarget(k("Tab", { ctrlKey: true, shiftKey: true }), ids, "a", false)).toBe("c");
  });
  it("Cmd+N on macOS, Ctrl+N elsewhere; 9 = last; out of range = nothing", () => {
    expect(tabShortcutTarget(k("2", { metaKey: true }), ids, "a", true)).toBe("b");
    expect(tabShortcutTarget(k("2", { ctrlKey: true }), ids, "a", true)).toBeNull();
    expect(tabShortcutTarget(k("2", { ctrlKey: true }), ids, "a", false)).toBe("b");
    expect(tabShortcutTarget(k("9", { ctrlKey: true }), ids, "a", false)).toBe("c");
    expect(tabShortcutTarget(k("5", { ctrlKey: true }), ids, "a", false)).toBeNull();
  });
  it("plain keys and Alt combos pass through to the terminal", () => {
    expect(tabShortcutTarget(k("2"), ids, "a", false)).toBeNull();
    expect(tabShortcutTarget(k("Tab"), ids, "a", false)).toBeNull();
    expect(tabShortcutTarget(k("2", { ctrlKey: true, altKey: true }), ids, "a", false)).toBeNull();
    expect(tabShortcutTarget(k("Tab", { ctrlKey: true }), [], "a", false)).toBeNull();
  });
  it("sameSet", () => {
    expect(sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameSet(new Set([1]), new Set([1, 2]))).toBe(false);
  });
});

describe("status lights", () => {
  const st = (status: "idle" | "running" | "error", prompt: unknown = null) => ({ status, activePrompt: prompt });
  it("stopped / waiting / working / idle", () => {
    expect(lightOf(undefined, true)).toBe("stopped");
    expect(lightOf(st("idle"), true)).toBe("stopped");
    expect(lightOf(st("error"), false)).toBe("stopped");
    expect(lightOf(st("running", { message: "Allow?" }), true)).toBe("waiting");
    expect(lightOf(st("running"), true)).toBe("working");
    expect(lightOf(st("running"), false)).toBe("idle");
  });
  it("working = output within the window", () => {
    expect([...workingSessions({ a: 9000, b: 5000 }, 10000, 3000)]).toEqual(["a"]);
  });
});
