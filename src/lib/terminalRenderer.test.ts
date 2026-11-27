import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  WEBGL_STORAGE_KEY,
  attachWebglRenderer,
  computePerfSnapshot,
  loadWebglEnabled,
  saveWebglEnabled,
  WebglAddonLike,
} from "./terminalRenderer";

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("WebGL preference persistence", () => {
  it("defaults to enabled and persists disable/enable choices", () => {
    const store = memStorage();
    expect(loadWebglEnabled(store)).toBe(true);
    saveWebglEnabled(false, store);
    expect(store.getItem(WEBGL_STORAGE_KEY)).toBe("false");
    expect(loadWebglEnabled(store)).toBe(false);
    saveWebglEnabled(true, store);
    expect(loadWebglEnabled(store)).toBe(true);
  });
});

describe("attachWebglRenderer", () => {
  it("loads WebGL addon and disposes cleanly on deactivation", () => {
    const disposeAddon = vi.fn();
    const disposeLossSub = vi.fn();
    const loadAddon = vi.fn();
    const fakeTerm = { loadAddon } as unknown as Terminal;

    const fakeAddon: WebglAddonLike = {
      activate: vi.fn(),
      dispose: disposeAddon,
      onContextLoss: () => ({ dispose: disposeLossSub }),
    };

    const handle = attachWebglRenderer(fakeTerm, { createAddon: () => fakeAddon });
    expect(handle.kind).toBe("webgl");
    expect(loadAddon).toHaveBeenCalledWith(fakeAddon);

    handle.dispose();
    // Second dispose is a safe no-op.
    handle.dispose();
    expect(disposeLossSub).toHaveBeenCalledTimes(1);
    expect(disposeAddon).toHaveBeenCalledTimes(1);
  });

  it("falls back to DOM renderer when WebGL init throws", () => {
    const onFallback = vi.fn();
    const fakeTerm = {
      loadAddon: () => {
        throw new Error("WebGL2 not supported");
      },
    } as unknown as Terminal;

    const disposeAddon = vi.fn();
    const fakeAddon: WebglAddonLike = {
      activate: vi.fn(),
      dispose: disposeAddon,
      onContextLoss: () => ({ dispose: vi.fn() }),
    };

    const handle = attachWebglRenderer(fakeTerm, {
      createAddon: () => fakeAddon,
      onFallback,
    });
    expect(handle.kind).toBe("dom");
    expect(disposeAddon).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith("init-error", expect.any(Error));
  });

  it("auto-disposes and notifies on WebGL context loss", () => {
    const onFallback = vi.fn();
    let fireLoss: (() => void) | null = null;
    const disposeAddon = vi.fn();
    const fakeAddon: WebglAddonLike = {
      activate: vi.fn(),
      dispose: disposeAddon,
      onContextLoss: (cb) => {
        fireLoss = cb;
        return { dispose: vi.fn() };
      },
    };
    const fakeTerm = { loadAddon: vi.fn() } as unknown as Terminal;

    const handle = attachWebglRenderer(fakeTerm, {
      createAddon: () => fakeAddon,
      onFallback,
    });
    expect(handle.kind).toBe("webgl");

    fireLoss?.();
    expect(disposeAddon).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith("context-loss");
  });
});

describe("computePerfSnapshot", () => {
  it("computes fps, p95 frame time, and 60/120 Hz drop counts", () => {
    const deltas = [8.0, 8.2, 8.3, 8.1, 10.5, 18.0];
    const snap = computePerfSnapshot(deltas, 61.1, {
      running: false,
      renderer: "webgl",
      xtermRenders: 6,
      outputChunks: 12,
      outputBytes: 4096,
    });
    expect(snap.renderer).toBe("webgl");
    expect(snap.frames).toBe(6);
    expect(snap.avgFps).toBeGreaterThan(90);
    expect(snap.droppedOver8ms).toBe(2);
    expect(snap.droppedOver16ms).toBe(1);
    expect(snap.maxFrameMs).toBe(18);
    expect(snap.outputBytes).toBe(4096);
  });
});
