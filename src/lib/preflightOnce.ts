// The pre-launch step (preflight.sh / .bat: config check, Python setup,
// skill rebuild) works on the whole install, not on a tab's folder, so it
// runs once per app launch (app_specs.md 5.7.4): the first session start
// runs it; a start while it is running waits for that run; later starts skip
// it. A failed run isn't remembered -- the next start tries again.

export interface PreflightOutcome {
  /** This call ran it (false: skipped, or waited for another start's run). */
  ran: boolean;
  success: boolean;
  /** An exception from the run (couldn't even start it), if any. */
  error?: unknown;
}

export function createPreflightOnce() {
  let done = false;
  let running: Promise<PreflightOutcome> | null = null;

  async function run(task: () => Promise<boolean>): Promise<PreflightOutcome> {
    if (done) return { ran: false, success: true };
    if (running) {
      const r = await running;
      return { ...r, ran: false };
    }
    running = (async () => {
      try {
        const success = await task();
        if (success) done = true;
        return { ran: true, success };
      } catch (error) {
        return { ran: true, success: false, error };
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    run,
    get done() { return done; },
    get running() { return running !== null; },
    /** Forget a success (e.g. tests, or a deliberate full re-check). */
    reset() { done = false; },
  };
}

/** Shared by every session (tab) in this window. */
export const preflightOnce = createPreflightOnce();
