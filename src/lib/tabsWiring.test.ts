// App's tab wiring (5.7.4) -- the parts that only show in the real app.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
const slice = (from: string, to: string) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

describe("tabs wiring", () => {
  it("switching tabs is not an engine change (no surprise auto-start)", () => {
    const f = slice("const switchToTab = useCallback", "}, [tabs]);");
    expect(f.indexOf("previousAgentIdRef.current = tab.engineId")).toBeLessThan(f.indexOf("setSelectedAgentId(tab.engineId)"));
  });
  it("new tab: limit check, then the dialog (agent + folder)", () => {
    const f = slice("const handleNewTab = useCallback", "const pickNewTabFolder");
    expect(f).toContain("canAddTab(tabs)");
    expect(f).toContain("setIsNewTabOpen(true)");
    expect(app).toMatch(/<NewTabDialog[\s\S]{0,400}defaultEngineId=\{selectedAgentId\}/);
    expect(app).toMatch(/engines=\{\(appConfig\?\.engines \?\? \[\]\)\.filter\(\(e\) => agentStatuses\[e\.id\]\?\.installed\)/);
  });
  it("creating: conflict check first, then the tab starts with the chosen agent (not an engine-change auto-start)", () => {
    const f = slice("const createTab = useCallback", "const handleCloseTab");
    expect(f.indexOf("resolveFolderFor(dir)")).toBeLessThan(f.indexOf("addTab("));
    expect(f).toContain("engineId }));");
    expect(f).toContain("setStartOnMountIds");
    expect(f.indexOf("previousAgentIdRef.current = engineId")).toBeLessThan(f.indexOf("setSelectedAgentId(engineId)"));
  });
  it("changing a tab's folder is checked too (ignoring that tab)", () => {
    const f = slice("const changeCwd = useCallback", "]);");
    expect(f).toContain("checkFolderFree(dir, activeSessionId)");
  });
  it("closing: confirm if running, end the backend session, pick the next tab", () => {
    const f = slice("const handleCloseTab = useCallback", "// Shortcuts:");
    expect(f).toContain('runtimeStates[id]?.status === "running"');
    expect(f).toContain("await ask(");
    expect(f).toContain('invoke("close_pty_session", { sessionId: id })');
    expect(f).toContain("nextActiveAfterClose(");
  });
  it("menu New/Close Tab and keyboard switching are wired", () => {
    expect(app).toContain('listen("menu-new-tab"');
    expect(app).toContain('listen("menu-close-tab"');
    expect(app).toContain('window.addEventListener("keydown", onKey, true)');
  });
  it("every tab has a mounted runtime; the main view stays mounted", () => {
    expect(app).toMatch(/tabs\.map\(\(tab\) => \{[\s\S]{0,200}<SessionRuntime/);
    expect(app).toContain('display: showMainView ? undefined : "none"');
  });
});
