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
