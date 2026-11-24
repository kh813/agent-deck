import { describe, expect, it } from "vitest";
import { pickEngine } from "./engineSelection";

const ids = ["agy", "claude", "codex"];
const inst = (installed: boolean) => ({ installed });

describe("pickEngine", () => {
  it("keeps current before detection has run", () => {
    expect(pickEngine(ids, {}, "claude")).toBe("claude");
  });

  it("falls back to the first configured engine when current is unknown", () => {
    expect(pickEngine(ids, {}, "gone")).toBe("agy");
    expect(pickEngine(ids, {}, null)).toBe("agy");
  });

  it("keeps the current engine when it is installed", () => {
    expect(pickEngine(ids, { agy: inst(true), claude: inst(true) }, "claude")).toBe("claude");
  });

  it("switches to the first installed engine when current is not installed", () => {
    expect(pickEngine(ids, { agy: inst(false), claude: inst(true), codex: inst(true) }, "agy")).toBe("claude");
  });

  it("stays on current when nothing is installed (onboarding)", () => {
    expect(pickEngine(ids, { agy: inst(false), claude: inst(false), codex: inst(false) }, "agy")).toBe("agy");
  });

  it("handles an empty engine list", () => {
    expect(pickEngine([], {}, "agy")).toBe("agy");
  });
});
