import { beforeEach, describe, expect, it } from "vitest";
import {
  applyFontAction,
  clampFontSize,
  effectiveFont,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_STORAGE_KEY,
  loadFontOverride,
  saveFontOverride,
  type FontOverride,
} from "./terminalFont";

// vitest runs in "node" (no DOM): give the module an in-memory localStorage.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const defaults = { family: "Menlo, monospace", size: 13 };
const none: FontOverride = { family: null, size: null };

describe("effectiveFont", () => {
  it("falls back to the agent_config.json defaults", () => {
    expect(effectiveFont(none, defaults)).toEqual(defaults);
  });
  it("uses the override where set", () => {
    expect(effectiveFont({ family: "Consolas, monospace", size: 16 }, defaults)).toEqual({
      family: "Consolas, monospace",
      size: 16,
    });
  });
});

describe("applyFontAction", () => {
  it("sets and clears the family", () => {
    const a = applyFontAction(none, { action: "family", value: "Monaco, monospace" }, defaults);
    expect(a.family).toBe("Monaco, monospace");
    expect(applyFontAction(a, { action: "family", value: null }, defaults).family).toBeNull();
  });

  it("increases/decreases from the effective size", () => {
    expect(applyFontAction(none, { action: "size-increase" }, defaults).size).toBe(14);
    expect(applyFontAction({ family: null, size: 20 }, { action: "size-decrease" }, defaults).size).toBe(19);
  });

  it("clamps sizes to the allowed range", () => {
    expect(applyFontAction({ family: null, size: FONT_SIZE_MAX }, { action: "size-increase" }, defaults).size).toBe(FONT_SIZE_MAX);
    expect(applyFontAction({ family: null, size: FONT_SIZE_MIN }, { action: "size-decrease" }, defaults).size).toBe(FONT_SIZE_MIN);
    expect(applyFontAction(none, { action: "size", value: 999 }, defaults).size).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(NaN)).toBe(13);
  });

  it("keeps the other half of the override", () => {
    const cur = { family: "Monaco, monospace", size: 18 };
    expect(applyFontAction(cur, { action: "size", value: 12 }, defaults)).toEqual({ family: "Monaco, monospace", size: 12 });
  });

  it("reset clears everything", () => {
    expect(applyFontAction({ family: "X", size: 20 }, { action: "reset" }, defaults)).toEqual(none);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips an override", () => {
    saveFontOverride({ family: "Monaco, monospace", size: 15 });
    expect(loadFontOverride()).toEqual({ family: "Monaco, monospace", size: 15 });
  });

  it("removes the key on reset so defaults apply again", () => {
    saveFontOverride({ family: "X", size: 15 });
    saveFontOverride(none);
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBeNull();
    expect(loadFontOverride()).toEqual(none);
  });

  it("ignores corrupt or out-of-range stored values", () => {
    localStorage.setItem(FONT_STORAGE_KEY, "{not json");
    expect(loadFontOverride()).toEqual(none);
    localStorage.setItem(FONT_STORAGE_KEY, JSON.stringify({ family: 42, size: 500 }));
    expect(loadFontOverride()).toEqual({ family: null, size: FONT_SIZE_MAX });
  });
});
