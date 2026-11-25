import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { SkillCatalogPanel } = await import("./SkillCatalogPanel");

describe("SkillCatalogPanel renders", () => {
  it("Japanese: title, tabs, search, close", () => {
    const html = renderToStaticMarkup(<SkillCatalogPanel lang="ja" onClose={() => {}} />);
    expect(html).toContain("スキルカタログ");
    expect(html).toContain("カタログ");
    expect(html).toContain("マイスキル");
    expect(html).toContain("名前・作成者・説明で絞り込み");
    expect(html).toContain("閉じる");
    expect(html).toContain('role="dialog"');
  });
  it("English", () => {
    const html = renderToStaticMarkup(<SkillCatalogPanel lang="en" onClose={() => {}} />);
    expect(html).toContain("Skill Catalog");
    expect(html).toContain("My Skills");
    expect(html).toContain("Close");
  });
});
