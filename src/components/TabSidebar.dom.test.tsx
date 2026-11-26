// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TabSidebar } from "./TabSidebar";
import type { Tab } from "../lib/sessions";

afterEach(cleanup);

const tabs: Tab[] = [
  { id: "main", name: "", cwd: "", engineId: "agy" },
  { id: "tab-1", name: "", cwd: "/Users/me/proj", engineId: "claude" },
  { id: "tab-2", name: "レポート", cwd: "/Users/me/docs", engineId: "claude" },
];
const states = {
  main: { status: "running" as const, cwd: "", isStarting: false, activePrompt: null, statusMessage: null },
  "tab-1": { status: "running" as const, cwd: "/Users/me/proj", isStarting: false, activePrompt: { prompt_type: "confirm" as const, message: "Allow?" }, statusMessage: null },
  "tab-2": { status: "idle" as const, cwd: "/Users/me/docs", isStarting: false, activePrompt: null, statusMessage: null },
};

function setup(over: Partial<React.ComponentProps<typeof TabSidebar>> = {}) {
  const props = {
    lang: "ja" as const, tabs, activeId: "tab-1", states, engineNames: { agy: "Antigravity", claude: "Claude Code" },
    workingIds: new Set(["main"]), onSelect: vi.fn(), onNew: vi.fn(), onClose: vi.fn(), onRename: vi.fn(), ...over,
  };
  render(<TabSidebar {...props} />);
  return props;
}

describe("TabSidebar", () => {
  it("one row per tab: name (or folder / app location), number + engine, light", () => {
    setup();
    const rows = screen.getAllByRole("tab");
    expect(rows.map((r) => r.querySelector(".tab-name")!.textContent)).toEqual(["アプリの場所", "proj", "レポート"]);
    expect(rows.map((r) => r.querySelector(".tab-meta")!.textContent)).toEqual(["1 · Antigravity", "2 · Claude Code", "3 · Claude Code"]);
    expect(rows.map((r) => r.getAttribute("data-light"))).toEqual(["working", "waiting", "stopped"]);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
  });

  it("click selects; × closes without selecting", () => {
    const p = setup();
    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(p.onSelect).toHaveBeenCalledWith("tab-2");
    fireEvent.click(screen.getByRole("button", { name: /タブを閉じる.*: proj$/ }));
    expect(p.onClose).toHaveBeenCalledWith("tab-1");
    expect(p.onSelect).toHaveBeenCalledTimes(1);
  });

  it("double-click renames (Enter commits, Escape cancels)", () => {
    const p = setup();
    fireEvent.doubleClick(screen.getByText("proj"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("proj");
    fireEvent.change(input, { target: { value: "本番作業" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onRename).toHaveBeenCalledWith("tab-1", "本番作業");
    fireEvent.doubleClick(screen.getByText("レポート"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(p.onRename).toHaveBeenCalledTimes(1);
  });

  it("new tab button; disabled at the limit", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しいタブ" }));
    expect(p.onNew).toHaveBeenCalled();
    cleanup();
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: "", cwd: `/p/${i}`, engineId: "agy" }));
    setup({ tabs: six, activeId: "t0" });
    expect((screen.getByRole("button", { name: "＋ 新しいタブ" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a single tab has no close button; footer renders", () => {
    setup({ tabs: [tabs[0]], activeId: "main", footer: <button>📚 スキル</button> });
    expect(screen.queryByRole("button", { name: /タブを閉じる/ })).toBeNull();
    expect(screen.getByRole("button", { name: "📚 スキル" })).toBeTruthy();
  });

  it("English labels", () => {
    setup({ lang: "en" });
    expect(screen.getByRole("button", { name: "+ New tab" })).toBeTruthy();
    expect(screen.getAllByRole("tab")[0].querySelector(".tab-name")!.textContent).toBe("App location");
  });
});
