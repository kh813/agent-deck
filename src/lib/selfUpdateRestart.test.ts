import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESTART_DELAY_MS, decideAfterSelfUpdate } from "./selfUpdateRestart";

describe("after an agent-deck update", () => {
  it("restarts only when a new version was really installed", async () => {
    expect(await decideAfterSelfUpdate(async () => true)).toBe("restart");
    expect(await decideAfterSelfUpdate(async () => false)).toBe("not-applied");
  });
  it("never restarts when it can't tell", async () => {
    expect(await decideAfterSelfUpdate(async () => { throw new Error("ipc"); })).toBe("not-applied");
  });
  it("leaves a moment to read the message", () => {
    expect(RESTART_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(RESTART_DELAY_MS).toBeLessThanOrEqual(5000);
  });
});

describe("App wiring", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
  it("update end -> check -> restart (no 'close and restart' alert on success)", () => {
    const fn = app.slice(app.indexOf("const finishSelfUpdate"), app.indexOf("// Listen to PTY termination"));
    expect(fn).toContain('invoke<boolean>("self_update_applied", { startedAtMs })');
    expect(fn).toContain('invoke("restart_after_update")');
    const restartIdx = fn.indexOf('invoke("restart_after_update")');
    const alertIdx = fn.indexOf("alert(");
    expect(alertIdx).toBeGreaterThan(restartIdx); // alert only in the fallback
    expect(app).toContain("void finishSelfUpdate(selfUpdateStartedAtRef.current);");
    expect(app).toContain("selfUpdateStartedAtRef.current = Date.now();");
  });
});
