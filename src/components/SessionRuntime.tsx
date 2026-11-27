// One tab's live session (app_specs.md 5.7.4): its own useChatSession and
// its own terminal. Every tab's runtime stays mounted -- hidden ones keep
// receiving output -- and they are stacked in the same box at the same size
// (visibility, not display:none, so a hidden terminal never refits to 0x0).
// App drives the active tab through the registered API and shows its state.
import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { TerminalView } from "./TerminalView";
import { PtyPrompt, useChatSession } from "../hooks/useChatSession";
import type { TerminalTheme } from "../utils/themes";
import { shouldAutoStart } from "../lib/sessions";

export interface RuntimeState {
  status: "idle" | "running" | "error";
  cwd: string;
  isStarting: boolean;
  activePrompt: PtyPrompt | null;
  statusMessage: string | null;
}

export const IDLE_RUNTIME_STATE: RuntimeState = {
  status: "idle",
  cwd: "",
  isStarting: false,
  activePrompt: null,
  statusMessage: null,
};

export interface RuntimeApi {
  startSession: (cwd?: string, command?: string, args?: string[]) => Promise<void>;
  stopSession: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  respondToPrompt: (text: string, rawInput?: string) => Promise<void>;
  changeCwd: (cwd: string) => Promise<void>;
  showStatusMessage: (text: string, autoClear?: boolean) => void;
  noteTerminalInput: (data: string) => void;
  terminal: () => Terminal | null;
}

interface Props {
  sessionId: string;
  active: boolean;
  initialCwd: string;
  command: string;
  args: string[];
  preLaunchCommand?: string;
  preLaunchArgs?: string[];
  preLaunchRequired?: boolean;
  theme: TerminalTheme;
  fontFamily?: string;
  fontSize?: number;
  /** Start right after mounting (a tab the user just created). */
  startOnMount?: boolean;
  /** Start the first time this tab is shown (a tab restored after a relaunch). */
  startWhenShown?: boolean;
  /** Told once this tab has started by itself (startOnMount / startWhenShown). */
  onAutoStarted?: (sessionId: string) => void;
  onState: (sessionId: string, state: RuntimeState) => void;
  register: (sessionId: string, api: RuntimeApi | null) => void;
  /** Terminal size reports (shared by every tab: same box). */
  onResize: (size: { rows: number; cols: number }) => void;
  onImagePaste?: (file: File) => void;
  onNativeImagePaste?: () => Promise<boolean>;
}

export function SessionRuntime(props: Props) {
  const { sessionId, active, onState, register } = props;
  const terminalRef = useRef<Terminal | null>(null);
  const sizeRef = useRef<{ rows: number; cols: number } | null>(null);

  const onRawOutput = useCallback((raw: Uint8Array) => {
    terminalRef.current?.write(raw);
  }, []);
  const getTerminalSize = useCallback(() => sizeRef.current ?? undefined, []);

  const chat = useChatSession({
    sessionId,
    command: props.command,
    defaultArgs: props.args,
    initialCwd: props.initialCwd,
    onRawOutput,
    getTerminalSize,
    preLaunchCommand: props.preLaunchCommand,
    preLaunchArgs: props.preLaunchArgs,
    preLaunchRequired: props.preLaunchRequired,
  });

  // Report state up (App shows the active tab's; the tab list shows all).
  useEffect(() => {
    onState(sessionId, {
      status: chat.status,
      cwd: chat.cwd,
      isStarting: chat.isStarting,
      activePrompt: chat.activePrompt,
      statusMessage: chat.statusMessage,
    });
  }, [sessionId, onState, chat.status, chat.cwd, chat.isStarting, chat.activePrompt, chat.statusMessage]);

  // Register the API (latest closures every render).
  const chatRef = useRef(chat);
  chatRef.current = chat;
  useEffect(() => {
    register(sessionId, {
      startSession: (...a) => chatRef.current.startSession(...a),
      stopSession: () => chatRef.current.stopSession(),
      sendMessage: (t) => chatRef.current.sendMessage(t),
      respondToPrompt: (t, r) => chatRef.current.respondToPrompt(t, r),
      changeCwd: (c) => chatRef.current.changeCwd(c),
      showStatusMessage: (t, a) => chatRef.current.showStatusMessage(t, a),
      noteTerminalInput: (d) => chatRef.current.noteTerminalInput(d),
      terminal: () => terminalRef.current,
    });
    return () => register(sessionId, null);
  }, [sessionId, register]);

  // A tab the user just created starts in its folder right away; a tab
  // restored after a relaunch starts the first time it's shown
  // (lib/sessions.ts shouldAutoStart).
  const startedRef = useRef(false);
  const { onAutoStarted } = props;
  useEffect(() => {
    if (!shouldAutoStart({
      startOnMount: props.startOnMount,
      startWhenShown: props.startWhenShown,
      active,
      alreadyStarted: startedRef.current,
      command: props.command,
      status: chat.status,
      isStarting: chat.isStarting,
    })) return;
    startedRef.current = true;
    onAutoStarted?.(sessionId);
    void chatRef.current.startSession(props.initialCwd, props.command, props.args);
  }, [props.startOnMount, props.startWhenShown, active, props.command, props.args, props.initialCwd,
      chat.status, chat.isStarting, sessionId, onAutoStarted]);

  const onData = useCallback((data: string) => {
    chatRef.current.noteTerminalInput(data);
    invoke("write_to_pty", { input: data, sessionId }).catch(() => {});
  }, [sessionId]);

  const { onResize } = props;
  const onTerminalResize = useCallback((size: { rows: number; cols: number }) => {
    sizeRef.current = size;
    invoke("resize_pty", { ...size, sessionId }).catch(() => {
      // not started yet: the size is used when it starts
    });
    onResize(size);
  }, [sessionId, onResize]);

  // Focus the terminal when this tab becomes the visible one.
  useEffect(() => {
    if (active) terminalRef.current?.focus();
  }, [active]);

  return (
    <div
      className="session-runtime"
      data-session-id={sessionId}
      aria-hidden={!active}
      style={{
        position: "absolute",
        inset: 0,
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
      }}
    >
      <TerminalView
        terminalRef={terminalRef}
        onData={onData}
        onResize={onTerminalResize}
        theme={props.theme}
        fontFamily={props.fontFamily}
        fontSize={props.fontSize}
        onImagePaste={active ? props.onImagePaste : undefined}
        onNativeImagePaste={active ? props.onNativeImagePaste : undefined}
      />
    </div>
  );
}
