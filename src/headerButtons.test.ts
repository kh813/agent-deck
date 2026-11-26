// The header's buttons (Stop / Start Session / Skills / Web UI) must share
// one fixed height: sized by padding alone, each followed its own text's
// line box (Japanese vs emoji fonts), so they came out 1-3px apart.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(__dirname, "App.tsx"), "utf8");
const css = readFileSync(join(__dirname, "App.css"), "utf8");

describe("header buttons share one height", () => {
  it("every header button uses .header-btn", () => {
    expect(app).toMatch(/className="danger header-btn" onClick=\{stopSession\}/);
    expect(app).toMatch(/className="primary header-btn" onClick=\{handleStartPty\}/);
    expect(app).toMatch(/className="secondary header-btn"\s+onClick=\{\(\) => setIsCatalogOpen\(true\)\}/);
    expect(app).toMatch(/className="secondary header-btn"\s+onClick=\{\(\) => \{\s+refreshWebServerStatus\(\);/);
  });
  it(".header-btn fixes the height (not just padding)", () => {
    const rule = css.slice(css.indexOf(".header-btn {"), css.indexOf("}", css.indexOf(".header-btn {")));
    expect(rule).toMatch(/height: \d+px;/);
    expect(rule).toContain("box-sizing: border-box");
    expect(rule).toContain("line-height: 1");
  });
});
