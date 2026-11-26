// @vitest-environment jsdom
// Two sessions (tabs) at once: each useChatSession hears only its own
// session's events and sends only to its own session.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

type Handler = (e: { payload: unknown }) => void;
const handlers: Record<string, Handler[]> = {};
const invokes: { cmd: string; args: any }[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: Handler) => {
    (handlers[name] ??= []).push(cb);
    return () => { handlers[name] = (handlers[name] ?? []).filter((h) => h !== cb); };
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: any) => { invokes.push({ cmd, args }); return false; },
}));
vi.mock("../lib/webClient", () => ({ isTauri: () => true, webClient: { on: () => () => {}, sendAction: () => {} } }));

const { useChatSession } = await import("./useChatSession");

const emit = async (name: string, payload: unknown) => {
  await act(async () => { for (const h of handlers[name] ?? []) h({ payload }); });
};

afterEach(() => { cleanup(); invokes.length = 0; for (const k of Object.keys(handlers)) delete handlers[k]; });

describe("useChatSession with session ids", () => {
  it("routes output, prompts and status by session", async () => {
    const outA = vi.fn(), outB = vi.fn();
    const a = renderHook(() => useChatSession({ sessionId: "tab-a", command: "agy", onRawOutput: outA }));
    const b = renderHook(() => useChatSession({ sessionId: "tab-b", command: "agy", onRawOutput: outB }));
    await act(async () => {});

    await emit("session-output", { session_id: "tab-a", data: [65] });
    expect(outA).toHaveBeenCalledTimes(1);
    expect(outB).not.toHaveBeenCalled();

    await emit("session-prompt", { session_id: "tab-b", prompt: { prompt_type: "confirm", message: "Allow?", options: ["Yes", "No"] } });
    expect(b.result.current.activePrompt?.message).toBe("Allow?");
    expect(a.result.current.activePrompt).toBeNull();

    // legacy single-session events are ignored now
    await emit("pty-output", { data: [66] });
    expect(outA).toHaveBeenCalledTimes(1);
  });

  it("start / send / stop carry the hook's own session id", async () => {
    const a = renderHook(() => useChatSession({ sessionId: "tab-a", command: "agy" }));
    await act(async () => { await a.result.current.startSession("/proj"); });
    expect(a.result.current.status).toBe("running");
    await act(async () => { await a.result.current.sendMessage("hello"); });
    await act(async () => { await a.result.current.stopSession(); });
    const pty = invokes.filter((i) => ["start_pty", "write_to_pty", "stop_pty"].includes(i.cmd));
    expect(pty.map((i) => i.cmd)).toEqual(["start_pty", "write_to_pty", "stop_pty"]);
    for (const i of pty) expect(i.args.sessionId).toBe("tab-a");
  });

  it("a session ending in another tab doesn't stop this one", async () => {
    const a = renderHook(() => useChatSession({ sessionId: "tab-a", command: "agy" }));
    await act(async () => { await a.result.current.startSession("/proj"); });
    await emit("session-status", { session_id: "tab-b", status: "terminated" });
    expect(a.result.current.status).toBe("running");
    await emit("session-status", { session_id: "tab-a", status: "terminated" });
    expect(a.result.current.status).toBe("idle");
  });

  it("defaults to the main session", async () => {
    const m = renderHook(() => useChatSession({ command: "agy" }));
    await act(async () => { await m.result.current.startSession("/proj"); });
    expect(invokes.find((i) => i.cmd === "start_pty")!.args.sessionId).toBe("main");
    expect(m.result.current.sessionId).toBe("main");
  });
});
