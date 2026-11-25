import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const { LANGUAGE_STORAGE_KEY, getLang, loadLangChoice, parseLangChoice, resolveLang, saveLangChoice, setCurrentLang } =
  await import("./language");

describe("resolveLang", () => {
  it("an explicit choice always wins", () => {
    expect(resolveLang("ja", ["en-US"], "en-US")).toBe("ja");
    expect(resolveLang("en", ["ja-JP"], "ja")).toBe("en");
  });

  it("Windows WebView2 saying en-US on a Japanese OS -> Japanese (the reported bug)", () => {
    expect(resolveLang("auto", ["ja-JP", "ja-JP"], "en-US")).toBe("ja");
  });

  it("Japanese regional format with an English display language -> Japanese", () => {
    expect(resolveLang("auto", ["en-US", "ja-JP"], "en-US")).toBe("ja");
  });

  it("an English OS stays English", () => {
    expect(resolveLang("auto", ["en-US", "en-GB"], "en-US")).toBe("en");
  });

  it("macOS (no OS locales reported) follows navigator.language", () => {
    expect(resolveLang("auto", [], "ja")).toBe("ja");
    expect(resolveLang("auto", [], "ja-JP")).toBe("ja");
    expect(resolveLang("auto", [], "en-US")).toBe("en");
    expect(resolveLang("auto", [], undefined)).toBe("en");
  });

  it("POSIX-style LANG values count", () => {
    expect(resolveLang("auto", ["ja_JP.UTF-8"], "en-US")).toBe("ja");
    expect(resolveLang("auto", ["ja"], "en-US")).toBe("ja");
  });

  it("does not mistake other languages that start with 'ja'-like letters", () => {
    expect(resolveLang("auto", ["jv-ID"], "en-US")).toBe("en"); // Javanese
    expect(resolveLang("auto", ["jam"], "en-US")).toBe("en");
  });
});

describe("choice persistence", () => {
  beforeEach(() => store.clear());

  it("defaults to auto", () => {
    expect(loadLangChoice()).toBe("auto");
  });

  it("round-trips ja/en, and auto clears the stored value", () => {
    saveLangChoice("ja");
    expect(loadLangChoice()).toBe("ja");
    saveLangChoice("en");
    expect(loadLangChoice()).toBe("en");
    saveLangChoice("auto");
    expect(store.has(LANGUAGE_STORAGE_KEY)).toBe(false);
    expect(loadLangChoice()).toBe("auto");
  });

  it("ignores garbage in storage", () => {
    store.set(LANGUAGE_STORAGE_KEY, "fr");
    expect(loadLangChoice()).toBe("auto");
  });

  it("parses menu payloads", () => {
    expect(parseLangChoice("ja")).toBe("ja");
    expect(parseLangChoice("auto")).toBe("auto");
    expect(parseLangChoice("de")).toBeNull();
    expect(parseLangChoice(undefined)).toBeNull();
  });
});

describe("current language for non-React code", () => {
  it("follows setCurrentLang", () => {
    setCurrentLang("ja");
    expect(getLang()).toBe("ja");
    setCurrentLang("en");
    expect(getLang()).toBe("en");
  });
});
