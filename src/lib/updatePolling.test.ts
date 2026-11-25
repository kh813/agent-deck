import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_INTERVAL_MS,
  INITIAL_DELAY_MS,
  isTestKind,
  isUpdateBannerVisible,
  shouldApplyBackgroundResult,
  startUpdatePolling,
} from "./updatePolling";

const none = { current_version: "v0.2.6", latest_version: "v0.2.6", update_available: false };
const avail = (v: string) => ({ current_version: "v0.2.6", latest_version: v, update_available: true });

describe("startUpdatePolling", () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
  });
  afterEach(() => vi.useRealTimers());

  const advance = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };

  it("defaults: first check 30s after launch, then every 4h", () => {
    expect(INITIAL_DELAY_MS).toBe(30_000);
    expect(CHECK_INTERVAL_MS).toBe(4 * 3600_000);
  });

  it("checks after the initial delay, then on every interval", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startUpdatePolling(run, { initialDelayMs: 1000, intervalMs: 10_000, now: () => clock });
    await advance(999);
    expect(run).toHaveBeenCalledTimes(0);
    await advance(1);
    expect(run).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(run).toHaveBeenCalledTimes(2);
    await advance(20_000);
    expect(run).toHaveBeenCalledTimes(4);
    stop();
  });

  it("never runs while stopped", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startUpdatePolling(run, { initialDelayMs: 1000, intervalMs: 10_000, now: () => clock });
    stop();
    await advance(100_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not overlap a slow check with the next one", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    const stop = startUpdatePolling(run, { initialDelayMs: 0, intervalMs: 1000, now: () => clock });
    await advance(0);
    await advance(5000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await advance(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps going after a failed check", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const stop = startUpdatePolling(run, { initialDelayMs: 0, intervalMs: 1000, now: () => clock });
    await advance(0);
    await advance(1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    stop();
    warn.mockRestore();
  });

  it("checks on focus only once the interval has passed (catches wake from sleep)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    let focus!: () => void;
    const off = vi.fn();
    const stop = startUpdatePolling(run, {
      initialDelayMs: 0,
      intervalMs: 10_000,
      now: () => clock,
      onFocus: (cb) => {
        focus = cb;
        return off;
      },
    });
    await advance(0);
    expect(run).toHaveBeenCalledTimes(1);
    clock += 5000; // focus soon after: no extra check
    focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    clock += 20_000; // laptop slept: timers didn't fire, but the clock moved
    focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    expect(off).toHaveBeenCalled();
  });
});

describe("shouldApplyBackgroundResult", () => {
  it("shows a newly found update", () => {
    expect(shouldApplyBackgroundResult(none, "github", avail("v0.2.7"), "github")).toBe(true);
    expect(shouldApplyBackgroundResult(none, "org-prod", avail("x"), "org-test")).toBe(true);
  });
  it("replaces an older offer from the same channel with a newer one", () => {
    expect(shouldApplyBackgroundResult(avail("v0.2.7"), "org-prod", avail("v0.2.8"), "org-prod")).toBe(true);
    expect(shouldApplyBackgroundResult(avail("v0.2.8-rc1"), "github-test", avail("v0.2.8-rc2"), "github-test")).toBe(true);
  });
  it("never hides an offer because a later check failed or found nothing", () => {
    expect(shouldApplyBackgroundResult(avail("v0.2.7"), "github", none, "github")).toBe(false);
  });
  it("leaves an explicitly requested offer from the other channel alone", () => {
    expect(shouldApplyBackgroundResult(avail("rc"), "org-test", avail("v0.2.7"), "org-prod")).toBe(false);
    expect(shouldApplyBackgroundResult(avail("v0.2.7"), "org-prod", avail("rc"), "org-test")).toBe(false);
  });
});

describe("isTestKind", () => {
  it("org-test and github-test are the test channels", () => {
    expect(isTestKind("org-test") && isTestKind("github-test")).toBe(true);
    expect(isTestKind("org-prod") || isTestKind("github")).toBe(false);
  });
});

describe("isUpdateBannerVisible", () => {
  it("hidden when there is no update", () => {
    expect(isUpdateBannerVisible(none, null)).toBe(false);
  });
  it("visible for an available update", () => {
    expect(isUpdateBannerVisible(avail("v0.2.7"), null)).toBe(true);
  });
  it("'Later' hides that version only; a newer one shows again", () => {
    expect(isUpdateBannerVisible(avail("v0.2.7"), "v0.2.7")).toBe(false);
    expect(isUpdateBannerVisible(avail("v0.2.8"), "v0.2.7")).toBe(true);
  });
});
