import { describe, expect, it } from "vitest";
import { ANSWERED_PROMPT_GRACE_MS, answersPrompt, isEchoOfAnswered, promptKey } from "./promptSync";

describe("answersPrompt", () => {
  it.each(["\r", "1", "2", "y", "N", "\x1b", "\x03", "yes\r"])("%j answers", (d) => {
    expect(answersPrompt(d)).toBe(true);
  });
  it.each(["\x1b[A", "\x1b[B", "a", "ab", " ", "\t"])("%j only navigates/edits", (d) => {
    expect(answersPrompt(d)).toBe(false);
  });
});

describe("isEchoOfAnswered", () => {
  const p = { prompt_type: "confirm", message: "Do you want to proceed?", options: ["Yes", "No"] };
  const answered = { key: promptKey(p), at: 1000 };

  it("ignores the same prompt reported again right after the answer", () => {
    expect(isEchoOfAnswered(p, answered, 1000 + 500)).toBe(true);
  });
  it("shows it again once the grace period is over (a real new prompt)", () => {
    expect(isEchoOfAnswered(p, answered, 1000 + ANSWERED_PROMPT_GRACE_MS + 1)).toBe(false);
  });
  it("shows a different prompt immediately", () => {
    expect(isEchoOfAnswered({ ...p, message: "Edit file?" }, answered, 1100)).toBe(false);
  });
  it("shows anything when nothing was answered", () => {
    expect(isEchoOfAnswered(p, null, 1100)).toBe(false);
  });
});
