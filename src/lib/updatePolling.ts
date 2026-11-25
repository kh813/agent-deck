// Periodic update check (agent-deck itself + the selected engine).
//
// Checks shortly after launch, then every CHECK_INTERVAL_MS, and again when
// the window comes back into focus after the interval has passed (timers are
// suspended while a laptop sleeps, so focus is what catches "opened the lid
// the next morning"). It only ever *checks*: an update runs only when the
// user clicks the banner's button or the Update menu.

export const INITIAL_DELAY_MS = 30 * 1000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdateStatusLike {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

export type SelfUpdateKind = "github" | "org-prod" | "org-test";

/**
 * Starts the schedule; returns a stop function. `run` is never called
 * concurrently with itself, and an error in it never stops the schedule.
 */
export function startUpdatePolling(
  run: () => Promise<void>,
  opts: {
    initialDelayMs?: number;
    intervalMs?: number;
    now?: () => number;
    onFocus?: (cb: () => void) => () => void;
  } = {},
) {
  const initialDelayMs = opts.initialDelayMs ?? INITIAL_DELAY_MS;
  const intervalMs = opts.intervalMs ?? CHECK_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  let lastStarted = -Infinity;
  let inFlight = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    lastStarted = now();
    try {
      await run();
    } catch (e) {
      console.warn("Periodic update check failed:", e);
    } finally {
      inFlight = false;
    }
  };

  const first = setTimeout(tick, initialDelayMs);
  const every = setInterval(tick, intervalMs);
  const offFocus = opts.onFocus?.(() => {
    if (now() - lastStarted >= intervalMs) void tick();
  });

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(every);
    offFocus?.();
  };
}

/**
 * Should a background result replace what the banner currently shows?
 * Not while an explicit test-channel check's offer is on screen (the user
 * asked for that one; the periodic prod check must not swap it out), and
 * a failed/empty check (no update) never hides an offer already shown.
 */
export function shouldApplyBackgroundResult(
  shown: UpdateStatusLike,
  shownKind: SelfUpdateKind,
  incoming: UpdateStatusLike,
): boolean {
  if (shown.update_available && shownKind === "org-test") return false;
  if (!incoming.update_available) return false;
  return true;
}

/** Banner visible unless the user chose "Later" for this very version. */
export function isUpdateBannerVisible(status: UpdateStatusLike, dismissedVersion: string | null): boolean {
  return status.update_available && (dismissedVersion === null || status.latest_version !== dismissedVersion);
}
