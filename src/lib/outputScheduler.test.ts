import { afterEach, describe, expect, it, vi } from "vitest";
import { concatChunks, createOutputScheduler } from "./outputScheduler";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

afterEach(() => {
  vi.useRealTimers();
});

describe("concatChunks", () => {
  it("returns empty array for no chunks and avoids copying a single chunk", () => {
    expect(concatChunks([]).byteLength).toBe(0);
    const single = enc("hello");
    expect(concatChunks([single])).toBe(single);
  });

  it("merges multiple chunks in order", () => {
    const merged = concatChunks([enc("foo"), enc("-"), enc("bar")]);
    expect(dec(merged)).toBe("foo-bar");
  });
});

describe("createOutputScheduler", () => {
  it("flushes active tab output immediately with zero delay", () => {
    const received: string[] = [];
    const s = createOutputScheduler({
      active: true,
      onFlush: (d) => received.push(dec(d)),
    });
    s.push(enc("frame-1"));
    s.push(enc("frame-2"));
    expect(received).toEqual(["frame-1", "frame-2"]);
    expect(s.pendingBytes()).toBe(0);
    s.dispose();
  });

  it("coalesces hidden tab output until the batch interval elapses", () => {
    vi.useFakeTimers();
    const received: string[] = [];
    const s = createOutputScheduler({
      active: false,
      hiddenIntervalMs: 120,
      hiddenMaxBytes: 1024,
      onFlush: (d) => received.push(dec(d)),
    });

    s.push(enc("aaa"));
    s.push(enc("bbb"));
    expect(received).toEqual([]);
    expect(s.pendingBytes()).toBe(6);

    vi.advanceTimersByTime(119);
    expect(received).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(received).toEqual(["aaabbb"]);
    expect(s.pendingBytes()).toBe(0);
    s.dispose();
  });

  it("flushes hidden tab immediately when buffered bytes exceed hiddenMaxBytes", () => {
    vi.useFakeTimers();
    const received: string[] = [];
    const s = createOutputScheduler({
      active: false,
      hiddenIntervalMs: 120,
      hiddenMaxBytes: 8,
      onFlush: (d) => received.push(dec(d)),
    });

    s.push(enc("1234"));
    expect(received).toEqual([]);
    s.push(enc("5678"));
    expect(received).toEqual(["12345678"]);
    expect(s.pendingBytes()).toBe(0);
    s.dispose();
  });

  it("flushes queued hidden chunks immediately when switching to active", () => {
    vi.useFakeTimers();
    const received: string[] = [];
    const s = createOutputScheduler({
      active: false,
      hiddenIntervalMs: 120,
      onFlush: (d) => received.push(dec(d)),
    });

    s.push(enc("back"));
    s.push(enc("ground"));
    expect(received).toEqual([]);

    s.setActive(true);
    expect(received).toEqual(["background"]);
    expect(s.pendingBytes()).toBe(0);

    // Subsequent chunks while active write immediately.
    s.push(enc("!"));
    expect(received).toEqual(["background", "!"]);
    s.dispose();
  });

  it("drops pending work cleanly on dispose", () => {
    vi.useFakeTimers();
    const received: string[] = [];
    const s = createOutputScheduler({
      active: false,
      hiddenIntervalMs: 100,
      onFlush: (d) => received.push(dec(d)),
    });
    s.push(enc("pending"));
    s.dispose();
    vi.advanceTimersByTime(500);
    expect(received).toEqual([]);
    expect(s.pendingBytes()).toBe(0);
  });
});
