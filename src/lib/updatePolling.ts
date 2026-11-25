// Periodic update check (agent-deck itself + the selected engine).
//
// At most once per CHECK_INTERVAL_MS (a day; 2026-11-25: every 4 hours
// announced new builds too eagerly), and that day is counted across app
// restarts -- the time of the last check is remembered, so relaunching
// doesn't check again. Whether a check is due is looked at shortly after
// launch, every TICK_MS, and when the window regains focus (timers are
// suspended while a laptop sleeps, so focus is what catches "opened the lid
// the next morning"). It only ever *checks*: an update runs only when the
// user clicks the banner's button or the Settings menu.

export const INITIAL_DELAY_MS = 30 * 1000;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const TICK_MS = 60 * 60 * 1000;
export const LAST_CHECK_STORAGE_KEY = "agent-deck-last-update-check";

export interface UpdateStatusLike {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

export type SelfUpdateKind = "github" | "github-test" | "org-prod" | "org-test";
/** default_self_update_kind's answer: the channel this build came from, or
 *  "none" (an org install that doesn't publish it: no automatic check). */
export type BackgroundKind = SelfUpdateKind | "none";

export const isTestKind = (k: SelfUpdateKind) => k === "org-test" || k === "github-test";

/** Is a check due? A last-check time in the future (clock moved back) counts as due. */
export function isCheckDue(lastCheckedMs: number | null, nowMs: number, intervalMs = CHECK_INTERVAL_MS): boolean {
  if (lastCheckedMs === null || !Number.isFinite(lastCheckedMs)) return true;
  if (lastCheckedMs > nowMs) return true;
  return nowMs - lastCheckedMs >= intervalMs;
}

/** The remembered last-check time (localStorage; null if unknown/unavailable). */
export const lastCheckStore = {
  get(): number | null {
    try {
      const v = localStorage.getItem(LAST_CHECK_STORAGE_KEY);
      const n = v === null ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  },
  set(ms: number): void {
    try {
      localStorage.setItem(LAST_CHECK_STORAGE_KEY, String(ms));
    } catch {
      // storage unavailable: falls back to checking once per launch
    }
  },
};

/**
 * Starts the schedule; returns a stop function. `run` is never called
 * concurrently with itself, runs at most once per interval (across
 * restarts, via `store`), and an error in it never stops the schedule.
 */
export function startUpdatePolling(
  run: () => Promise<void>,
  opts: {
    initialDelayMs?: number;
    intervalMs?: number;
    tickMs?: number;
    now?: () => number;
    onFocus?: (cb: () => void) => () => void;
    store?: { get(): number | null; set(ms: number): void };
  } = {},
) {
  const initialDelayMs = opts.initialDelayMs ?? INITIAL_DELAY_MS;
  const intervalMs = opts.intervalMs ?? CHECK_INTERVAL_MS;
  const tickMs = opts.tickMs ?? TICK_MS;
  const now = opts.now ?? Date.now;
  let memory: number | null = null;
  const store = opts.store ?? { get: () => memory, set: (ms: number) => void (memory = ms) };
  let inFlight = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    if (!isCheckDue(store.get(), now(), intervalMs)) return;
    inFlight = true;
    store.set(now());
    try {
      await run();
    } catch (e) {
      console.warn("Periodic update check failed:", e);
    } finally {
      inFlight = false;
    }
  };

  const first = setTimeout(tick, initialDelayMs);
  const every = setInterval(tick, tickMs);
  const offFocus = opts.onFocus?.(() => void tick());

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(every);
    offFocus?.();
  };
}

/**
 * Should a background result replace what the banner currently shows?
 * The background check only looks at this build's own channel (test builds:
 * test channel; stable builds: stable). It never swaps out an offer from
 * the other channel that the user asked for explicitly from the menu, and
 * a failed/empty check (no update) never hides an offer already shown.
 */
export function shouldApplyBackgroundResult(
  shown: UpdateStatusLike,
  shownKind: SelfUpdateKind,
  incoming: UpdateStatusLike,
  incomingKind: SelfUpdateKind,
): boolean {
  if (!incoming.update_available) return false;
  if (shown.update_available && isTestKind(shownKind) !== isTestKind(incomingKind)) return false;
  return true;
}

/** Banner visible unless the user chose "Later" for this very version. */
export function isUpdateBannerVisible(status: UpdateStatusLike, dismissedVersion: string | null): boolean {
  return status.update_available && (dismissedVersion === null || status.latest_version !== dismissedVersion);
}
