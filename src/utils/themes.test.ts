import { describe, expect, it } from "vitest";
import { MIN_CONTRAST_RATIO, themes } from "./themes";

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

// AI "thinking" and other secondary text must look secondary on every theme.
// agy prints its thinking summary/hints in ANSI bright black (SGR 90) and
// "Thought for Ns" in white (37); Claude Code prints its notes in white+dim
// (37;2). Captured from the real CLIs on 2026-11-25.
describe("secondary text (AI thinking) is visibly lighter than the answer", () => {
  // What xterm actually renders: a color below MIN_CONTRAST_RATIO is pushed
  // up to it (minimumContrastRatio), never further.
  const rendered = (c: string, bg: string) => Math.max(contrast(c, bg), MIN_CONTRAST_RATIO);

  for (const [id, { terminal: t }] of Object.entries(themes)) {
    describe(id, () => {
      const answer = contrast(t.foreground, t.background);

      it("bright black (agy thinking) is clearly fainter than the foreground", () => {
        expect(answer / rendered(t.brightBlack, t.background)).toBeGreaterThanOrEqual(1.3);
      });

      it("bright black is still readable", () => {
        expect(rendered(t.brightBlack, t.background)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
        expect(contrast(t.brightBlack, t.background)).toBeGreaterThanOrEqual(2);
      });

      it("the answer text itself meets the minimum on its own", () => {
        expect(answer).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO + 1);
      });

      if (!themes[id].isDark) {
        it("white (secondary on light themes) is a mid gray, not near the background", () => {
          expect(contrast(t.white, t.background)).toBeGreaterThanOrEqual(2.5);
          expect(answer / rendered(t.white, t.background)).toBeGreaterThanOrEqual(1.3);
        });
      }
    });
  }

  it("minimum contrast leaves room below typical answer text", () => {
    expect(MIN_CONTRAST_RATIO).toBeGreaterThanOrEqual(3);
    expect(MIN_CONTRAST_RATIO).toBeLessThan(4.5);
  });
});
