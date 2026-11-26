import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS, addAttachments, canSend, composeMessage, isImagePath, removeAttachment } from "./attachments";

const a = (path: string, kind: "pasted" | "file" = "file") => ({ path, name: path.split(/[\\/]/).pop()!, kind });

describe("attachments", () => {
  it("adds with names, skips duplicates and blanks", () => {
    const { list } = addAttachments([a("/x/one.png")], ["/x/one.png", " ", "C:\\Users\\Taro Yamada\\two.jpg"], "file");
    expect(list.map((x) => [x.name, x.kind])).toEqual([["one.png", "file"], ["two.jpg", "file"]]);
  });
  it("caps the count and reports how many were dropped", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => `/p/${i}.png`);
    const r = addAttachments([], many, "pasted");
    expect(r.list).toHaveLength(MAX_ATTACHMENTS);
    expect(r.overLimit).toBe(3);
  });
  it("removes by path", () => {
    expect(removeAttachment([a("/a.png"), a("/b.png")], "/a.png").map((x) => x.path)).toEqual(["/b.png"]);
  });
  it("message = quoted paths then the text, one line", () => {
    const winPath = String.raw`C:\pics\e.png`.replace(/\\\\/g, "\\");
    const msg = composeMessage("エラーの原因を\n教えて ", [a("/tmp/screenshots/s 1.png", "pasted"), a(winPath)]);
    expect(msg).toBe(`"/tmp/screenshots/s 1.png" "${winPath}" エラーの原因を 教えて`);
    expect(msg.includes("\n")).toBe(false);
  });
  it("text only / images only", () => {
    expect(composeMessage("hi", [])).toBe("hi");
    expect(composeMessage("  ", [a("/a.png")])).toBe('"/a.png"');
  });
  it("send needs text or an image", () => {
    expect(canSend("", [])).toBe(false);
    expect(canSend("  ", [])).toBe(false);
    expect(canSend("x", [])).toBe(true);
    expect(canSend("", [a("/a.png")])).toBe(true);
  });
  it("image extensions", () => {
    expect(isImagePath("/a/B.PNG")).toBe(true);
    expect(isImagePath("/a/b.heic")).toBe(true);
    expect(isImagePath("/a/b.pdf")).toBe(false);
  });
});
