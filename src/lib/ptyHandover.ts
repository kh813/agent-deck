// Hands the single PTY over from a running session (e.g. Claude Code) to an
// update command.
//
// Confirmed for real: clicking "Update" while a session was running showed
// "update complete, please restart" the moment the update STARTED. start_pty
// stops the old session first, and that old session's "terminated" event
// arrives asynchronously -- after the update had already been flagged as in
// progress -- so it was taken as the update's own completion.
//
// Stopping the session ourselves and waiting for its "terminated" (or
// "error") before flagging the update means the only "terminated" seen
// afterwards belongs to the update command.
export async function stopAndWaitForExit(opts: {
  isRunning: boolean;
  stop: () => Promise<unknown>;
  // Registers a listener for the PTY status; returns (a promise of) its
  // cleanup. It is awaited before stopping, so the event can't slip past.
  onStatus: (cb: (status: string) => void) => (() => void) | Promise<() => void>;
  timeoutMs?: number;
}): Promise<void> {
  if (!opts.isRunning) return;
  let fire: () => void = () => {};
  const cleanup = await opts.onStatus((status) => {
    if (status === "terminated" || status === "error") fire();
  });
  await new Promise<void>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      cleanup();
      resolve();
    };
    fire = finish;
    timer = setTimeout(finish, opts.timeoutMs ?? 3000);
    opts.stop().catch(finish);
  });
}
