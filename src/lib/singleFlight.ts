// Runs an async task at most once at a time: a call made while a previous
// one is still in flight is dropped (returns false) instead of starting a
// second copy.
//
// Used for session start (confirmed for real on Windows, 2026-11-25):
// switching engines after Stop auto-starts the new engine, but status stays
// "idle" through the pre-launch step (preflight: config check + skill
// rebuild), so the Start button was still clickable. Clicking it ran a
// second preflight concurrently -- two build-skills.ps1 runs fighting over
// the same skills\*.zip / *.skill files ("used by another process",
// access denied) -- and failed the start.
export function createSingleFlight() {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run(task: () => Promise<void>): Promise<boolean> {
      if (running) return false;
      running = true;
      try {
        await task();
      } finally {
        running = false;
      }
      return true;
    },
  };
}
