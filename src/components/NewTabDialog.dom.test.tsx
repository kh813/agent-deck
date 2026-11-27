// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NewTabDialog } from "./NewTabDialog";

afterEach(cleanup);
const engines = [{ id: "agy", name: "Antigravity" }, { id: "claude", name: "Claude Code" }];

function setup(over: Partial<React.ComponentProps<typeof NewTabDialog>> = {}) {
  const props = {
    lang: "ja" as const, engines, defaultEngineId: "claude",
    pickFolder: vi.fn(async () => "/Users/me/proj"),
    onCreate: vi.fn(async () => null as string | null),
    onCancel: vi.fn(), ...over,
  };
  render(<NewTabDialog {...props} />);
  return props;
}
const select = () => screen.getByRole("combobox") as HTMLSelectElement;
const createBtn = () => screen.getByRole("button", { name: "作成して開始" }) as HTMLButtonElement;

describe("NewTabDialog", () => {
  it("defaults to the agent in use; lists the installed ones", () => {
    setup();
    expect(select().value).toBe("claude");
    expect([...select().options].map((o) => o.textContent)).toEqual(["Antigravity", "Claude Code"]);
  });
  it("falls back to the first engine if the default isn't available", () => {
    setup({ defaultEngineId: "codex" });
    expect(select().value).toBe("agy");
  });
  it("needs a folder; creates with the chosen agent and folder", async () => {
    const p = setup();
    expect(createBtn().disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "選択…" })));
    expect(screen.getByTestId("new-tab-folder").textContent).toBe("/Users/me/proj");
    fireEvent.change(select(), { target: { value: "agy" } });
    await act(async () => fireEvent.click(createBtn()));
    expect(p.onCreate).toHaveBeenCalledWith("/Users/me/proj", "agy");
  });
  it("a refused folder shows the reason and keeps the dialog open", async () => {
    setup({ onCreate: vi.fn(async () => "このフォルダは、タブ「proj」が使っているフォルダと同じか…") });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "選択…" })));
    await act(async () => fireEvent.click(createBtn()));
    expect(screen.getByRole("alert").textContent).toContain("タブ「proj」");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("cancelling the folder picker keeps the previous choice", async () => {
    const pick = vi.fn().mockResolvedValueOnce("/a").mockResolvedValueOnce(null);
    setup({ pickFolder: pick });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "選択…" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "選択…" })));
    expect(screen.getByTestId("new-tab-folder").textContent).toBe("/a");
  });
  it("Cancel and Escape close it", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onCancel).toHaveBeenCalledTimes(2);
  });
  it("English", () => {
    setup({ lang: "en" });
    expect(screen.getByRole("dialog", { name: "New tab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create and start" })).toBeTruthy();
  });
});
