// Inputs inside dialogs (skill catalog search box, editor fields) must be
// recognizable as inputs on every theme: their own fill, a border with at
// least 3:1 contrast to the dialog (WCAG 1.4.11 non-text contrast), and a
// readable placeholder. Read straight from App.css.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "App.css"), "utf8");
const SELECTORS = [":root", "body.theme-dark", "body.theme-dracula", "body.theme-oneDark",
  "body.theme-solarizedLight", "body.theme-solarizedDark"];

function block(sel: string): string {
  const i = css.indexOf(`${sel} {`);
  expect(i, sel).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("\n}", i));
}
function rgb(value: string): [number, number, number] {
  const hex = value.match(/#([0-9a-f]{6})/i);
  if (hex) return [0, 2, 4].map((k) => parseInt(hex[1].slice(k, k + 2), 16)) as [number, number, number];
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!; // dialog bg: alpha 0.95, treated as opaque
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function v(sel: string, name: string): [number, number, number] {
  const m = block(sel).match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(m, `${sel} --${name}`).not.toBeNull();
  return rgb(m![1]);
}
const lum = (c: [number, number, number]) => {
  const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe.each(SELECTORS)("dialog fields on %s", (sel) => {
  const dialog = v(sel, "input-bg"); // the catalog dialog's background
  it("border stands out from the dialog (>= 3:1)", () => {
    expect(contrast(v(sel, "field-border"), dialog)).toBeGreaterThanOrEqual(3);
  });
  it("fill differs from the dialog", () => {
    expect(v(sel, "field-bg")).not.toEqual(dialog);
  });
  it("focus color is clearly visible on the fill (>= 3:1)", () => {
    expect(contrast(v(sel, "field-focus"), v(sel, "field-bg"))).toBeGreaterThanOrEqual(3);
  });
  it("typed text is readable (>= 4.5:1)", () => {
    expect(contrast(v(sel, "field-text"), v(sel, "field-bg"))).toBeGreaterThanOrEqual(4.5);
  });
  it("placeholder is readable (>= 3:1)", () => {
    expect(contrast(v(sel, "field-placeholder"), v(sel, "field-bg"))).toBeGreaterThanOrEqual(3);
  });
});

describe("catalog uses the dialog field style", () => {
  const panel = readFileSync(join(__dirname, "components", "SkillCatalogPanel.tsx"), "utf8");
  const editor = readFileSync(join(__dirname, "components", "SkillEditor.tsx"), "utf8");
  it("search box, author menu and editor fields", () => {
    expect(panel).toContain('className="dialog-field dialog-search" type="search"');
    expect(panel).toMatch(/<select className="dialog-field"/);
    expect(editor.match(/className="dialog-field"/g)).toHaveLength(3);
    expect(panel + editor).not.toContain('className="input-field"'); // the chat box's borderless style
  });
  it("the style has a border and a focus ring", () => {
    const rule = css.slice(css.indexOf(".dialog-field {"), css.indexOf("}", css.indexOf(".dialog-field {")));
    expect(rule).toContain("border: 1px solid var(--field-border)");
    expect(rule).toContain("background: var(--field-bg)");
    expect(rule).toContain("color: var(--field-text)");
    expect(css).toMatch(/\.dialog-field::placeholder \{[^}]*var\(--field-placeholder\)/);
    expect(css).toMatch(/\.dialog-field:focus \{[^}]*var\(--field-focus\)/);
  });
});
