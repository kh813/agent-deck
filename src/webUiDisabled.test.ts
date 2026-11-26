// The Web UI (remote access) is switched off in releases until its
// security is reviewed: the settings screen opens, says so, and nothing in
// it can be used; the backend refuses to start the server as well.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(__dirname, "App.tsx"), "utf8");
const rs = readFileSync(join(__dirname, "..", "src-tauri", "src", "web_server.rs"), "utf8");

describe("Web UI is disabled for now", () => {
  it("availability comes from the backend and defaults to off", () => {
    expect(app).toContain('const [webUiAvailable, setWebUiAvailable] = useState(false);');
    expect(app).toContain('invoke<boolean>("web_ui_available")');
  });
  it("the screen shows the notice and disables every control", () => {
    expect(app).toMatch(/\{!webUiAvailable && \([\s\S]{0,400}webUiUnavailableTitle/);
    expect(app).toContain("<fieldset disabled={!webUiAvailable}");
  });
  it("the start handler does nothing while unavailable", () => {
    const h = app.slice(app.indexOf("const handleStartWebServer"), app.indexOf("const handleStopWebServer"));
    expect(h.indexOf("if (!webUiAvailable) return;")).toBeGreaterThan(-1);
    expect(h.indexOf("if (!webUiAvailable) return;")).toBeLessThan(h.indexOf('invoke<any>("start_web_server"'));
  });
  it("the password is never stored in plain text, and an old copy is deleted", () => {
    expect(app).not.toContain('localStorage.setItem("agent_deck_web_password"');
    expect(app).not.toContain('localStorage.getItem("agent_deck_web_password")');
    expect(app).toContain('localStorage.removeItem("agent_deck_web_password")');
  });
  it("the backend refuses too (not only greyed out)", () => {
    expect(rs).toContain("if !web_ui_enabled()");
    expect(rs).toContain('pub(crate) const WEB_UI_ENV: &str = "AGENT_DECK_WEB_UI";');
  });
});
