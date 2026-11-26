// What to do when "Update to ..." (self_update.py apply) has finished: the
// Rust side says whether it actually installed a new version (marker files
// written only on success). Then the app restarts into it by itself --
// no "close and restart" instructions, no quit confirmation.

export const RESTART_DELAY_MS = 1500;

export type AfterSelfUpdate = "restart" | "not-applied";

export async function decideAfterSelfUpdate(applied: () => Promise<boolean>): Promise<AfterSelfUpdate> {
  try {
    return (await applied()) ? "restart" : "not-applied";
  } catch {
    // Can't tell -> don't restart under the user unexpectedly.
    return "not-applied";
  }
}
