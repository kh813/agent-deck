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

// Syntax highlighting as the CLIs draw it should come through on every
// theme. Claude Code colors code blocks with ANSI 16 colors (captured
// 2026-11-25: keywords 94 bright blue, function names 33 yellow, numbers 32
// green, builtins 36 cyan); agy's TUI likewise relies on the ANSI palette.
function lab(hex: string): [number, number, number] {
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92));
  const [r, g, b] = lin;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: string, b: string) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

describe("ANSI accent colors (syntax highlighting)", () => {
  const ACCENTS = ["red", "green", "yellow", "blue", "magenta", "cyan",
    "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan"] as const;
  // What Claude Code's code blocks use, in the same line next to each other.
  const CLAUDE_CODE_SYNTAX = ["brightBlue", "yellow", "green", "cyan"] as const;

  for (const [id, { terminal: t }] of Object.entries(themes)) {
    describe(id, () => {
      it("every accent is clearly different from plain text", () => {
        for (const k of ACCENTS) expect(deltaE(t[k], t.foreground), k).toBeGreaterThanOrEqual(15);
      });

      it("accents are readable as designed (at most a tiny contrast-floor nudge)", () => {
        for (const k of ACCENTS) expect(contrast(t[k], t.background), k).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO - 0.15);
      });

      it("Claude Code's keyword / function / number / builtin colors are mutually distinct", () => {
        for (let i = 0; i < CLAUDE_CODE_SYNTAX.length; i++)
          for (let j = i + 1; j < CLAUDE_CODE_SYNTAX.length; j++) {
            const [a, b] = [CLAUDE_CODE_SYNTAX[i], CLAUDE_CODE_SYNTAX[j]];
            expect(deltaE(t[a], t[b]), `${a} vs ${b}`).toBeGreaterThanOrEqual(20);
          }
      });

      it("the six base hues are mutually distinct", () => {
        const base = ACCENTS.slice(0, 6);
        for (let i = 0; i < base.length; i++)
          for (let j = i + 1; j < base.length; j++)
            expect(deltaE(t[base[i]], t[base[j]]), `${base[i]} vs ${base[j]}`).toBeGreaterThanOrEqual(20);
      });
    });
  }
});
