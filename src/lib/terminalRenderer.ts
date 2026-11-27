// Terminal renderer management & lightweight performance diagnostics (app_specs.md 5.7.5).
//
// - Hardware acceleration (WebGL) is enabled by default for the active tab only,
//   keeping WebGL context count <= 1 across up to 6 concurrent tabs.
// - Context loss or WebGL initialization failure automatically falls back to
//   xterm.js's built-in DOM renderer without losing terminal state.
// - Users can disable WebGL from View -> Hardware Acceleration (WebGL) if a
//   GPU driver misbehaves; the preference persists in localStorage.
import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

export const WEBGL_STORAGE_KEY = "agent_deck_webgl_renderer";

export type RendererKind = "webgl" | "dom";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadWebglEnabled(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    const raw = storage?.getItem(WEBGL_STORAGE_KEY);
    if (raw === "false" || raw === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function saveWebglEnabled(enabled: boolean, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(WEBGL_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage quota/access errors.
  }
}

export interface WebglAddonLike extends ITerminalAddon {
  onContextLoss: (listener: () => void) => IDisposable;
}

export interface AttachWebglOptions {
  createAddon?: () => WebglAddonLike;
  onFallback?: (reason: "init-error" | "context-loss", error?: unknown) => void;
}

export interface RendererHandle {
  kind: RendererKind;
  dispose: () => void;
}

/**
 * Attach the WebGL renderer to an open xterm.js Terminal.
 * Returns a handle that disposes cleanly back to the DOM renderer, or falls
 * back immediately if WebGL is unavailable (e.g. jsdom, headless, broken GPU).
 */
export function attachWebglRenderer(
  term: Terminal,
  options: AttachWebglOptions = {},
): RendererHandle {
  const create = options.createAddon ?? (() => new WebglAddon());
  let addon: WebglAddonLike | null = null;
  let contextLossSub: IDisposable | null = null;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      contextLossSub?.dispose();
    } catch {
      // ignore
    }
    contextLossSub = null;
    try {
      addon?.dispose();
    } catch {
      // ignore
    }
    addon = null;
  };

  try {
    addon = create();
    contextLossSub = addon.onContextLoss(() => {
      dispose();
      options.onFallback?.("context-loss");
    });
    term.loadAddon(addon);
    return { kind: "webgl", dispose };
  } catch (err) {
    dispose();
    options.onFallback?.("init-error", err);
    return { kind: "dom", dispose: () => {} };
  }
}

// ── Lightweight on-demand performance profiler (window.__agentDeckPerf) ──
// Zero overhead while idle: only samples rAF frames when `start()` is invoked
// from DevTools (task 18-1 / 18-8 baseline & before/after verification).

export interface PerfSnapshot {
  running: boolean;
  renderer: RendererKind;
  elapsedMs: number;
  frames: number;
  avgFps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  droppedOver16ms: number;
  droppedOver8ms: number;
  xtermRenders: number;
  outputChunks: number;
  outputBytes: number;
}

let activeRendererKind: RendererKind = "dom";
let measuring = false;
let rafId: number | null = null;
let startedAt = 0;
let lastFrameAt = 0;
let frameDeltas: number[] = [];
let xtermRenders = 0;
let outputChunks = 0;
let outputBytes = 0;

export function reportActiveRenderer(kind: RendererKind): void {
  activeRendererKind = kind;
}

export function recordTerminalRender(): void {
  if (!measuring) return;
  xtermRenders += 1;
}

export function recordOutputChunk(byteLength: number): void {
  if (!measuring) return;
  outputChunks += 1;
  outputBytes += byteLength;
}

export function computePerfSnapshot(
  deltas: readonly number[],
  elapsedMs: number,
  extra: { running: boolean; renderer: RendererKind; xtermRenders: number; outputChunks: number; outputBytes: number },
): PerfSnapshot {
  const frames = deltas.length;
  const sorted = [...deltas].sort((a, b) => a - b);
  const sum = deltas.reduce((acc, v) => acc + v, 0);
  const avgFrameMs = frames > 0 ? sum / frames : 0;
  const avgFps = elapsedMs > 0 ? (frames * 1000) / elapsedMs : 0;
  const p95Idx = frames > 0 ? Math.min(frames - 1, Math.floor(frames * 0.95)) : 0;
  const p95FrameMs = frames > 0 ? sorted[p95Idx] : 0;
  const maxFrameMs = frames > 0 ? sorted[frames - 1] : 0;
  let droppedOver16ms = 0;
  let droppedOver8ms = 0;
  for (const d of deltas) {
    if (d > 16.7) droppedOver16ms += 1;
    if (d > 8.4) droppedOver8ms += 1;
  }
  return {
    running: extra.running,
    renderer: extra.renderer,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    frames,
    avgFps: Math.round(avgFps * 10) / 10,
    avgFrameMs: Math.round(avgFrameMs * 100) / 100,
    p95FrameMs: Math.round(p95FrameMs * 100) / 100,
    maxFrameMs: Math.round(maxFrameMs * 100) / 100,
    droppedOver16ms,
    droppedOver8ms,
    xtermRenders: extra.xtermRenders,
    outputChunks: extra.outputChunks,
    outputBytes: extra.outputBytes,
  };
}

function stopPerfInternal(): PerfSnapshot {
  const elapsed = startedAt > 0 ? performance.now() - startedAt : 0;
  measuring = false;
  if (rafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
  }
  rafId = null;
  return computePerfSnapshot(frameDeltas, elapsed, {
    running: false,
    renderer: activeRendererKind,
    xtermRenders,
    outputChunks,
    outputBytes,
  });
}

export interface AgentDeckPerfApi {
  start: (durationMs?: number) => Promise<PerfSnapshot>;
  stop: () => PerfSnapshot;
  status: () => PerfSnapshot;
}

export function installPerfBridge(): void {
  if (typeof window === "undefined") return;
  const api: AgentDeckPerfApi = {
    start: (durationMs = 5000) => {
      if (measuring) stopPerfInternal();
      frameDeltas = [];
      xtermRenders = 0;
      outputChunks = 0;
      outputBytes = 0;
      measuring = true;
      startedAt = performance.now();
      lastFrameAt = startedAt;

      return new Promise<PerfSnapshot>((resolve) => {
        const tick = (now: number) => {
          if (!measuring) return;
          const dt = now - lastFrameAt;
          lastFrameAt = now;
          if (dt > 0) frameDeltas.push(dt);
          if (now - startedAt >= durationMs) {
            resolve(stopPerfInternal());
            return;
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      });
    },
    stop: () => stopPerfInternal(),
    status: () =>
      computePerfSnapshot(frameDeltas, startedAt > 0 ? performance.now() - startedAt : 0, {
        running: measuring,
        renderer: activeRendererKind,
        xtermRenders,
        outputChunks,
        outputBytes,
      }),
  };
  (window as unknown as { __agentDeckPerf?: AgentDeckPerfApi }).__agentDeckPerf = api;
}
