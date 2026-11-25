import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_INTERVAL_MS,
  INITIAL_DELAY_MS,
  LAST_CHECK_STORAGE_KEY,
  TICK_MS,
  isCheckDue,
  lastCheckStore,
  isNewerInstalled,
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
    clock = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  const advance = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  const memStore = (initial: number | null = null) => {
    let v = initial;
    return { get: () => v, set: (ms: number) => void (v = ms), peek: () => v };
  };
  const H = 3600_000;

  it("defaults: looked at 30s after launch and hourly, but runs at most once a day", () => {
    expect(INITIAL_DELAY_MS).toBe(30_000);
    expect(TICK_MS).toBe(H);
    expect(CHECK_INTERVAL_MS).toBe(24 * H);
  });

  it("first launch: checks 30s in, then not again until a day has passed", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const store = memStore();
    const stop = startUpdatePolling(run, { now: () => clock, store });
    await advance(29_999);
    expect(run).toHaveBeenCalledTimes(0);
    await advance(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.peek()).toBe(clock);
    await advance(23 * H);
    expect(run).toHaveBeenCalledTimes(1);
    await advance(H);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("a relaunch within the day does not check again (the last check is remembered)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const store = memStore(clock - 2 * H); // checked 2h ago in a previous run
    const stop = startUpdatePolling(run, { now: () => clock, store });
    await advance(30_000);
    expect(run).not.toHaveBeenCalled();
    await advance(21 * H);
    expect(run).not.toHaveBeenCalled();
    await advance(H); // 24h since the last check (the hourly tick lands on it)
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a relaunch after more than a day checks 30s in", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startUpdatePolling(run, { now: () => clock, store: memStore(clock - 25 * H) });
    await advance(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it("focus after waking from sleep checks if due, not otherwise", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    let focus!: () => void;
    const off = vi.fn();
    const stop = startUpdatePolling(run, {
      now: () => clock,
      store: memStore(),
      onFocus: (cb) => {
        focus = cb;
        return off;
      },
    });
    await advance(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    clock += 5 * H; // focus later the same day: nothing
    focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    clock += 30 * H; // laptop slept overnight: timers didn't fire, the clock moved
    focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    expect(off).toHaveBeenCalled();
  });

  it("never runs while stopped", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startUpdatePolling(run, { now: () => clock, store: memStore() });
    stop();
    await advance(48 * H);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not overlap a slow check with the next one", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    const stop = startUpdatePolling(run, { initialDelayMs: 0, intervalMs: 1000, tickMs: 1000, now: () => clock, store: memStore() });
    await advance(0);
    await advance(5000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await advance(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps going after a failed check (and still counts it, so offline doesn't retry hourly)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const stop = startUpdatePolling(run, { now: () => clock, store: memStore() });
    await advance(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    await advance(23 * H);
    expect(run).toHaveBeenCalledTimes(1);
    await advance(H);
    expect(run).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    stop();
    warn.mockRestore();
  });
});

describe("isCheckDue / lastCheckStore", () => {
  it("due when never checked, a day has passed, or the clock went backwards", () => {
    expect(isCheckDue(null, 1000)).toBe(true);
    expect(isCheckDue(0, CHECK_INTERVAL_MS)).toBe(true);
    expect(isCheckDue(1, CHECK_INTERVAL_MS)).toBe(false);
    expect(isCheckDue(5000, 1000)).toBe(true);
    expect(isCheckDue(NaN, 1000)).toBe(true);
  });

  it("persists in localStorage and tolerates garbage / no storage", () => {
    const map = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(lastCheckStore.get()).toBeNull();
    lastCheckStore.set(123);
    expect(map.get(LAST_CHECK_STORAGE_KEY)).toBe("123");
    expect(lastCheckStore.get()).toBe(123);
    map.set(LAST_CHECK_STORAGE_KEY, "garbage");
    expect(lastCheckStore.get()).toBeNull();
    (globalThis as any).localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(lastCheckStore.get()).toBeNull();
    expect(() => lastCheckStore.set(1)).not.toThrow();
    delete (globalThis as any).localStorage;
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

describe("isNewerInstalled", () => {
  const st = (c: string | null, l: string | null, a = false) => ({ current_version: c, latest_version: l, update_available: a });
  it("a test build checking the stable channel", () => {
    expect(isNewerInstalled(st("0.2.8-rc4", "v0.2.7"))).toBe(true);
  });
  it("not when up to date, when an update exists, or for timestamp-only answers", () => {
    expect(isNewerInstalled(st("0.2.7", "v0.2.7"))).toBe(false);
    expect(isNewerInstalled(st("0.2.7", "v0.2.8", true))).toBe(false);
    expect(isNewerInstalled(st("", "2026-11-25T00:00:00Z"))).toBe(false);
    expect(isNewerInstalled(st(null, null))).toBe(false);
  });
});
