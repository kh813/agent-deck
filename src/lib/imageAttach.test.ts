import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const m = await import("./imageAttach");

const item = (kind: string, type: string, file: File | null = new File(["x"], "f", { type })) => ({
  kind,
  type,
  getAsFile: () => file,
});

describe("screenshotNameHint", () => {
  it("is local time, zero-padded, filename-safe", () => {
    expect(m.screenshotNameHint(new Date(2026, 0, 5, 7, 8, 9))).toBe("screenshot-20260105-070809");
    expect(m.screenshotNameHint()).toMatch(/^screenshot-\d{8}-\d{6}$/);
  });
});

describe("prompt text", () => {
  it("quotes paths so spaces never split them", () => {
    expect(m.quotePathForPrompt("C:\\Users\\Taro Yamada\\a.png")).toBe('"C:\\Users\\Taro Yamada\\a.png"');
    expect(m.quotePathForPrompt('/tmp/we"ird.png')).toBe('"/tmp/we\\"ird.png"');
  });
  it("joins several paths and leaves a trailing space for the instruction", () => {
    expect(m.promptTextForPaths(["/a/1.png", "/b/2 x.png"])).toBe('"/a/1.png" "/b/2 x.png" ');
  });
  it("nothing to attach -> empty text", () => {
    expect(m.promptTextForPaths([])).toBe("");
    expect(m.promptTextForPaths(["", "  "])).toBe("");
  });
  it("baseName handles both separators", () => {
    expect(m.baseName("C:\\x\\tmp\\screenshots\\s.png")).toBe("s.png");
    expect(m.baseName("/p/tmp/screenshots/s.png")).toBe("s.png");
  });
});

describe("pickImageFile / hasText", () => {
  it("finds the first image file", () => {
    const img = new File(["i"], "s.png", { type: "image/png" });
    expect(m.pickImageFile([item("string", "text/plain"), item("file", "image/png", img)])).toBe(img);
  });
  it("ignores non-image files and missing data", () => {
    expect(m.pickImageFile([item("file", "application/pdf")])).toBeNull();
    expect(m.pickImageFile([item("file", "image/png", null)])).toBeNull();
    expect(m.pickImageFile(null)).toBeNull();
  });
  it("detects plain text", () => {
    expect(m.hasText({ types: ["text/plain"] })).toBe(true);
    expect(m.hasText({ types: ["Files"] })).toBe(false);
    expect(m.hasText(null)).toBe(false);
  });
});

describe("isManualPasteKey", () => {
  const k = (o: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
    key: "v", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o,
  });
  it("Windows/Linux Ctrl+V is handled by the app (xterm would send ^V)", () => {
    expect(m.isManualPasteKey(k({ ctrlKey: true }), false)).toBe(true);
  });
  it("macOS Cmd+V is left to the native paste event", () => {
    expect(m.isManualPasteKey(k({ metaKey: true }), true)).toBe(false);
    expect(m.isManualPasteKey(k({ ctrlKey: true }), true)).toBe(false); // ^V stays a keystroke on macOS
  });
  it("Ctrl/Cmd+Shift+V is explicit paste everywhere", () => {
    expect(m.isManualPasteKey(k({ ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(m.isManualPasteKey(k({ metaKey: true, shiftKey: true }), true)).toBe(true);
  });
  it("other keys and Alt combos are not pastes", () => {
    expect(m.isManualPasteKey(k({ key: "c", ctrlKey: true }), false)).toBe(false);
    expect(m.isManualPasteKey(k({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(m.isManualPasteKey(k({}), false)).toBe(false);
  });
});

describe("Tauri calls", () => {
  it("saveImageBlob sends raw bytes with percent-encoded headers", async () => {
    invoke.mockResolvedValueOnce("/p/tmp/screenshots/s.png");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    await expect(m.saveImageBlob(blob, "/Users/小林/work")).resolves.toBe("/p/tmp/screenshots/s.png");
    const [cmd, body, opts] = invoke.mock.calls.at(-1)!;
    expect(cmd).toBe("save_pasted_image");
    expect(Array.from(body as Uint8Array)).toEqual([1, 2, 3]);
    const h = (opts as { headers: Record<string, string> }).headers;
    expect(decodeURIComponent(h["x-cwd"])).toBe("/Users/小林/work");
    expect(h["x-cwd"]).toMatch(/^[\x20-\x7e]*$/); // header-safe ASCII
    expect(h["x-mime"]).toBe("image%2Fpng");
    expect(decodeURIComponent(h["x-name"])).toMatch(/^screenshot-/);
  });
  it("saveClipboardImage passes cwd and a name hint", async () => {
    invoke.mockResolvedValueOnce(null);
    await expect(m.saveClipboardImage("")).resolves.toBeNull();
    const [cmd, args] = invoke.mock.calls.at(-1)!;
    expect(cmd).toBe("save_clipboard_image");
    expect(args).toMatchObject({ cwd: "" });
    expect((args as { nameHint: string }).nameHint).toMatch(/^screenshot-/);
  });
});
