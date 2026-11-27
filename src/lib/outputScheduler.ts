// Per-tab terminal output scheduler (app_specs.md 5.7.5).
// Active tab: writes immediately (0 ms frontend delay) for 120/144 Hz rendering.
// Hidden tabs: coalesces chunks into coarser batches so background log floods
// don't steal frame budget from the visible tab, then flushes immediately the
// instant the tab becomes active.

export const HIDDEN_TAB_FLUSH_MS = 120;
export const HIDDEN_TAB_MAX_BYTES = 64 * 1024;

export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

export interface OutputSchedulerOptions {
  onFlush: (data: Uint8Array) => void;
  active?: boolean;
  hiddenIntervalMs?: number;
  hiddenMaxBytes?: number;
}

export interface OutputScheduler {
  push: (chunk: Uint8Array) => void;
  setActive: (active: boolean) => void;
  flush: () => void;
  dispose: () => void;
  pendingBytes: () => number;
}

export function createOutputScheduler(options: OutputSchedulerOptions): OutputScheduler {
  const hiddenIntervalMs = options.hiddenIntervalMs ?? HIDDEN_TAB_FLUSH_MS;
  const hiddenMaxBytes = options.hiddenMaxBytes ?? HIDDEN_TAB_MAX_BYTES;
  let active = options.active ?? true;
  let disposed = false;
  let queue: Uint8Array[] = [];
  let queuedBytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (disposed || queue.length === 0) return;
    const merged = concatChunks(queue);
    queue = [];
    queuedBytes = 0;
    options.onFlush(merged);
  };

  const push = (chunk: Uint8Array) => {
    if (disposed || chunk.byteLength === 0) return;
    if (active) {
      if (queue.length === 0) {
        options.onFlush(chunk);
      } else {
        queue.push(chunk);
        queuedBytes += chunk.byteLength;
        flush();
      }
      return;
    }
    queue.push(chunk);
    queuedBytes += chunk.byteLength;
    if (queuedBytes >= hiddenMaxBytes) {
      flush();
      return;
    }
    if (timer === null) {
      timer = setTimeout(flush, hiddenIntervalMs);
    }
  };

  const setActive = (next: boolean) => {
    if (disposed) return;
    const wasActive = active;
    active = next;
    if (active && !wasActive) {
      flush();
    }
  };

  const dispose = () => {
    disposed = true;
    clearTimer();
    queue = [];
    queuedBytes = 0;
  };

  return {
    push,
    setActive,
    flush,
    dispose,
    pendingBytes: () => queuedBytes,
  };
}
