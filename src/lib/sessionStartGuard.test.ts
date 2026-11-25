// Wiring checks for the "one session start at a time" guard (see
// lib/singleFlight.ts for the incident). The guard's logic is unit-tested in
// singleFlight.test.ts; these make sure it stays connected to the hook and
// to the controls that can trigger a second start, since a refactor that
// drops the wiring would otherwise only show up as a Windows-only failure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("session start guard wiring", () => {
  const hook = src("hooks/useChatSession.ts");
  const app = src("App.tsx");

  it("startSession goes through the single-flight guard", () => {
    expect(hook).toMatch(/const startSession = useCallback\([\s\S]*?flight\.running[\s\S]*?flight\.run\(\(\) => startSessionOnce\(/);
    expect(hook).toMatch(/setIsStarting\(true\)[\s\S]*?finally \{\s*setIsStarting\(false\)/);
  });

  it("the hook exposes isStarting and App consumes it", () => {
    expect(hook).toMatch(/return \{[\s\S]*?\bisStarting,/);
    expect(app).toMatch(/const \{[\s\S]*?\bisStarting,[\s\S]*?\} = useChatSession\(/);
  });

  it("the Start button is disabled while a start is in progress", () => {
    expect(app).toMatch(/onClick=\{handleStartPty\} disabled=\{isStarting\}/);
  });

  it("the engine selector is disabled while a start is in progress", () => {
    expect(app).toMatch(/disabled=\{status === "running" \|\| isStarting\}\s*className="agent-select-dropdown"/);
  });

  it("App only reaches the unguarded start through startSession", () => {
    // (App's own start_pty calls are the install/update runners, which hand
    // over the PTY themselves -- not session starts.)
    expect(app).not.toMatch(/startSessionOnce/);
  });
});

describe("periodic update check wiring", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");

  it("App starts the poller, gated on the auto-check setting", () => {
    expect(app).toMatch(/if \(!isTauri\(\) \|\| !autoCheckUpdate\) return;\s*return startUpdatePolling\(/);
  });

  it("the background check asks self_update for a non-interactive check", () => {
    expect(app).toMatch(/invoke<UpdateStatus>\("check_self_update", \{ kind, background: true \}\)/);
    expect(app).toMatch(/invoke<[^>]*>\("default_self_update_kind"\)/);
  });

  it("the background check never starts an update by itself", () => {
    const start = app.indexOf("return startUpdatePolling(");
    const poll = app.slice(start, app.indexOf("}, [autoCheckUpdate]);", start));
    expect(start).toBeGreaterThan(0);
    expect(poll).not.toMatch(/handleUpdateSelf|get_self_update_command|start_pty/);
    expect(poll).toMatch(/shouldApplyBackgroundResult\(/);
  });

  it("the banner uses the Later-aware visibility and has both buttons", () => {
    expect(app).toMatch(/isUpdateBannerVisible\(selfUpdateStatus, dismissedSelfUpdateVersion\)/);
    expect(app).toMatch(/onClick=\{handleUpdateSelf\}/);
    expect(app).toMatch(/setDismissedSelfUpdateVersion\(selfUpdateStatus\.latest_version\)/);
  });

  it("an explicit menu check clears a previous Later", () => {
    expect(app).toMatch(/setDismissedSelfUpdateVersion\(null\);\s*checkSelfUpdateStatus\(kind\)/);
  });
});
