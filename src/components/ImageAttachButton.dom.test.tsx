// @vitest-environment jsdom
// The input bar's 🖼 button: menu, clipboard screenshot, file picker, chips.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

let clipboardPath: string | null = "/proj/tmp/screenshots/screenshot-1.png";
let picked: string | string[] | null = ["/pics/a.png", "/pics/b.jpg"];
const invokeCalls: { cmd: string; args: unknown }[] = [];
const dialogCalls: unknown[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    invokeCalls.push({ cmd, args });
    if (cmd === "save_clipboard_image") return clipboardPath;
    return null;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async (opts: unknown) => { dialogCalls.push(opts); return picked; },
}));

const { ImageAttachButton, AttachmentChips } = await import("./ImageAttachButton");

beforeEach(() => {
  clipboardPath = "/proj/tmp/screenshots/screenshot-1.png";
  picked = ["/pics/a.png", "/pics/b.jpg"];
  invokeCalls.length = 0;
  dialogCalls.length = 0;
});
afterEach(cleanup);

function setup(disabled = false) {
  const onAdd = vi.fn();
  const onError = vi.fn();
  render(<ImageAttachButton lang="ja" cwd="/proj" disabled={disabled} onAdd={onAdd} onError={onError} />);
  return { onAdd, onError };
}

describe("ImageAttachButton", () => {
  it("opens a menu with paste / choose", () => {
    setup();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "📋 スクリーンショットを貼り付け", "📁 画像ファイルを選択…"]);
  });

  it("paste: saves the clipboard image under the working folder, adds it as 'pasted'", async () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /貼り付け/ })));
    expect(invokeCalls[0].cmd).toBe("save_clipboard_image");
    expect((invokeCalls[0].args as { cwd: string }).cwd).toBe("/proj");
    expect(onAdd).toHaveBeenCalledWith(["/proj/tmp/screenshots/screenshot-1.png"], "pasted");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("paste with no image on the clipboard explains how to take one", async () => {
    clipboardPath = null;
    const { onAdd, onError } = setup();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /貼り付け/ })));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toContain("クリップボードに画像がありません");
  });

  it("choose: multiple image files, used in place (no save/copy)", async () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /選択/ })));
    expect(onAdd).toHaveBeenCalledWith(["/pics/a.png", "/pics/b.jpg"], "file");
    expect(invokeCalls.filter((c) => c.cmd.startsWith("save_"))).toEqual([]);
    const opts = dialogCalls[0] as { multiple: boolean; filters: { extensions: string[] }[] };
    expect(opts.multiple).toBe(true);
    expect(opts.filters[0].extensions).toContain("png");
  });

  it("choose: cancelled -> nothing; single string result works", async () => {
    picked = null;
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /選択/ })));
    expect(onAdd).not.toHaveBeenCalled();
    cleanup();
    picked = "/pics/one.png";
    const r = setup();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /選択/ })));
    expect(r.onAdd).toHaveBeenCalledWith(["/pics/one.png"], "file");
  });

  it("Escape and outside clicks close the menu; disabled button doesn't open", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /画像/ }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    cleanup();
    setup(true);
    expect((screen.getByRole("button", { name: /画像/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AttachmentChips", () => {
  it("shows each image, marks screenshots, removes one", () => {
    const onRemove = vi.fn();
    render(<AttachmentChips lang="ja" disabled={false} onRemove={onRemove} attachments={[
      { path: "/proj/tmp/screenshots/screenshot-1.png", name: "screenshot-1.png", kind: "pasted" },
      { path: "/pics/a.png", name: "a.png", kind: "file" },
    ]} />);
    expect(screen.getByText(/スクリーンショット · screenshot-1.png/)).toBeTruthy();
    expect(screen.getByText(/a\.png/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添付を外す: a.png" }));
    expect(onRemove).toHaveBeenCalledWith("/pics/a.png");
  });
  it("renders nothing without attachments", () => {
    const { container } = render(<AttachmentChips lang="en" disabled={false} onRemove={() => {}} attachments={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
