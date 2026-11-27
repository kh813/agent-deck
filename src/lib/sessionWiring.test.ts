// Every PTY command the desktop app sends names its session, and nothing
// listens to the legacy single-session events any more (pty.rs sends those
// for the default session only, for the Web UI relay).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []);

const code = files(SRC).map((f) => ({ f, text: readFileSync(f, "utf8") }));

describe("session wiring", () => {
  it("every PTY invoke passes sessionId", () => {
    const bad: string[] = [];
    for (const { f, text } of code) {
      const re = /invoke(?:<[^>]*>)?\("(start_pty|write_to_pty|resize_pty|stop_pty|force_kill_pty)"([^)]*)\)/g;
      for (const m of text.matchAll(re)) if (!m[2].includes("sessionId")) bad.push(`${f.replace(SRC, "src")}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
  it("no listener on the legacy pty-output / pty-status / pty-prompt events", () => {
    const bad = code.filter(({ text }) => /listen<[^>]*>\("pty-(output|status|prompt)"/.test(text)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });
});
