// Status light of a session (app_specs.md 5.7.4). agy / Claude Code don't
// announce their state (herdr's OSC 7501), so it's inferred:
//   waiting  -- an approval prompt is showing (needs you)
//   working  -- output in the last WORKING_WINDOW_MS
//   idle     -- running, quiet (at its prompt)
//   stopped  -- not running (never started, exited, or failed)

export type SessionLight = "working" | "waiting" | "idle" | "stopped";

export const WORKING_WINDOW_MS = 3000;

interface StateLike {
  status: "idle" | "running" | "error";
  activePrompt: unknown;
}

export function lightOf(state: StateLike | undefined, recentlyOutput: boolean): SessionLight {
  if (!state || state.status !== "running") return "stopped";
  if (state.activePrompt) return "waiting";
  return recentlyOutput ? "working" : "idle";
}

/** Session ids whose last output is within the window. */
export function workingSessions(lastOutputAt: Record<string, number>, now: number, windowMs = WORKING_WINDOW_MS): Set<string> {
  return new Set(Object.entries(lastOutputAt).filter(([, t]) => now - t < windowMs).map(([id]) => id));
}
