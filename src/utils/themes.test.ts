import { describe, expect, it } from "vitest";
import { themes } from "./themes";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("light theme ANSI white", () => {
  const t = themes.light.terminal;

  it("is a neutral gray, so it can't be confused with (bright) blue", () => {
    // ANSI-palette CLIs draw unselected menu items in white and the selected
    // one in bright blue; a blue-tinted gray made them indistinguishable.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.white.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(8);
  });

  it("stays readable on the background (WCAG AA 4.5:1)", () => {
    expect(contrast(t.white, t.background)).toBeGreaterThanOrEqual(4.5);
  });
});
