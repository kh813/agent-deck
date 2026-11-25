import { describe, expect, it, vi } from "vitest";
import { stopAndWaitForExit } from "./ptyHandover";

function fakeBus() {
  const listeners = new Set<(s: string) => void>();
  return {
    onStatus: (cb: (s: string) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit: (s: string) => [...listeners].forEach((cb) => cb(s)),
    count: () => listeners.size,
  };
}

describe("stopAndWaitForExit", () => {
  it("does nothing when no session is running", async () => {
    const stop = vi.fn(async () => {});
    await stopAndWaitForExit({ isRunning: false, stop, onStatus: fakeBus().onStatus });
    expect(stop).not.toHaveBeenCalled();
  });

  it("resolves only after the old session's terminated event", async () => {
    const bus = fakeBus();
    let resolved = false;
    const p = stopAndWaitForExit({
      isRunning: true,
      stop: async () => {},
      onStatus: bus.onStatus,
    }).then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    bus.emit("terminated");
    await p;
    expect(resolved).toBe(true);
    expect(bus.count()).toBe(0); // listener removed, so the update's own exit isn't swallowed
  });

  it("gives up after the timeout if no event comes", async () => {
    vi.useFakeTimers();
    const bus = fakeBus();
    const p = stopAndWaitForExit({ isRunning: true, stop: async () => {}, onStatus: bus.onStatus, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(bus.count()).toBe(0);
    vi.useRealTimers();
  });
});
