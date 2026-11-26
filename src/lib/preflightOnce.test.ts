import { describe, expect, it } from "vitest";
import { createPreflightOnce } from "./preflightOnce";

describe("pre-launch runs once per app launch", () => {
  it("first start runs it; later starts skip", async () => {
    const p = createPreflightOnce();
    let runs = 0;
    const task = async () => { runs++; return true; };
    expect(await p.run(task)).toEqual({ ran: true, success: true });
    expect(await p.run(task)).toEqual({ ran: false, success: true });
    expect(runs).toBe(1);
    expect(p.done).toBe(true);
  });

  it("a start during the run waits for it (no second run)", async () => {
    const p = createPreflightOnce();
    let runs = 0;
    let release!: (v: boolean) => void;
    const task = () => { runs++; return new Promise<boolean>((r) => (release = r)); };
    const first = p.run(task);
    expect(p.running).toBe(true);
    const second = p.run(task);
    release(true);
    expect(await first).toEqual({ ran: true, success: true });
    expect(await second).toEqual({ ran: false, success: true });
    expect(runs).toBe(1);
  });

  it("a failure isn't remembered: the next start tries again", async () => {
    const p = createPreflightOnce();
    let ok = false;
    const task = async () => ok;
    expect(await p.run(task)).toEqual({ ran: true, success: false });
    expect(p.done).toBe(false);
    ok = true;
    expect(await p.run(task)).toEqual({ ran: true, success: true });
  });

  it("waiters share the failure of the run they waited for", async () => {
    const p = createPreflightOnce();
    let release!: (v: boolean) => void;
    const first = p.run(() => new Promise<boolean>((r) => (release = r)));
    const second = p.run(async () => true);
    release(false);
    expect((await first).success).toBe(false);
    expect(await second).toEqual({ ran: false, success: false });
  });

  it("an exception is reported, not thrown, and isn't remembered", async () => {
    const p = createPreflightOnce();
    const r = await p.run(async () => { throw new Error("spawn failed"); });
    expect(r.ran).toBe(true);
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain("spawn failed");
    expect(p.running).toBe(false);
    expect((await p.run(async () => true)).ran).toBe(true);
  });

  it("reset forgets a success", async () => {
    const p = createPreflightOnce();
    await p.run(async () => true);
    p.reset();
    expect((await p.run(async () => true)).ran).toBe(true);
  });
});
