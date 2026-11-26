import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolvePromptResponseInput } from "../lib/promptResponse";
import { answersPrompt, isEchoOfAnswered, promptKey } from "../lib/promptSync";
import { createSingleFlight } from "../lib/singleFlight";
import { preflightOnce } from "../lib/preflightOnce";
import { getLang } from "../lib/language";
import { subscribeToTauriEvent } from "../lib/tauriListener";
import { isTauri, webClient } from "../lib/webClient";
import { DEFAULT_SESSION_ID, SessionOutputEvent, SessionPromptEvent, SessionStatusEvent, isForSession } from "../lib/sessions";

export interface PtyPrompt {
  prompt_type: "confirm" | "path" | "login";
  message: string;
  options?: string[];
  url?: string;
  // Literal PTY input for each entry of `options` (same index), when the
  // backend knows the menu's layout (see PtyPromptPayload.inputs in pty.rs).
  inputs?: string[];
}

export interface UseChatSessionOptions {
  /** Which backend session (tab) this hook drives; "main" = the default
   *  single session (lib/sessions.ts). */
  sessionId?: string;
  command: string;
  defaultArgs?: string[];
  initialCwd?: string;
  onRawOutput?: (raw: Uint8Array) => void;
  // Reports the terminal's actual fitted size so the PTY can be spawned at
  // the right size from the start, rather than a guessed default that agy's
  // cursor-relative redraws could then target incorrectly.
  getTerminalSize?: () => { rows: number; cols: number } | undefined;
  // Config-driven command run before every session start (AppConfig.
  // pre_launch_command). Takes priority over the skill-folder auto-rebuild
  // fallback below when set.
  preLaunchCommand?: string;
  preLaunchArgs?: string[];
  preLaunchRequired?: boolean;
}

export function useChatSession({
  sessionId = DEFAULT_SESSION_ID,
  command,
  defaultArgs = [],
  initialCwd = "",
  onRawOutput,
  getTerminalSize,
  preLaunchCommand,
  preLaunchArgs = [],
  preLaunchRequired = true,
}: UseChatSessionOptions) {
  const [cwd, setCwd] = useState(initialCwd);
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [activePrompt, setActivePromptState] = useState<PtyPrompt | null>(null);
  // Mirrors for event handlers (see lib/promptSync.ts).
  const activePromptRef = useRef<PtyPrompt | null>(null);
  const answeredPromptRef = useRef<{ key: string; at: number } | null>(null);
  const setActivePrompt = useCallback((p: PtyPrompt | null) => {
    activePromptRef.current = p;
    setActivePromptState(p);
  }, []);
  // A prompt was answered (GUI button or terminal key): drop the panel and
  // ignore the CLI re-reporting the same prompt while it redraws.
  const markPromptAnswered = useCallback(() => {
    const p = activePromptRef.current;
    if (p) answeredPromptRef.current = { key: promptKey(p), at: Date.now() };
    setActivePrompt(null);
  }, [setActivePrompt]);
  const showPromptUnlessEcho = useCallback((p: PtyPrompt) => {
    if (isEchoOfAnswered(p, answeredPromptRef.current, Date.now())) return;
    setActivePrompt(p);
  }, [setActivePrompt]);
  // Called with every keystroke typed into the terminal itself.
  const noteTerminalInput = useCallback((data: string) => {
    if (activePromptRef.current && answersPrompt(data)) markPromptAnswered();
  }, [markPromptAnswered]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // True from a start request until the session is running (or failed):
  // status is still "idle" through the pre-launch step, so this is what
  // keeps a second start (Start button, engine-switch auto-start) from
  // launching a concurrent preflight. See lib/singleFlight.ts.
  const [isStarting, setIsStarting] = useState(false);
  const startFlightRef = useRef(createSingleFlight());

  const statusRef = useRef(status);
  const cwdRef = useRef(cwd);
  const statusMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  const showStatusMessage = useCallback((text: string, autoClear = true) => {
    if (statusMessageTimerRef.current) {
      clearTimeout(statusMessageTimerRef.current);
      statusMessageTimerRef.current = null;
    }
    setStatusMessage(text);
    if (autoClear) {
      statusMessageTimerRef.current = setTimeout(() => setStatusMessage(null), 4000);
    }
  }, []);

  // Start PTY Session. overrideCommand/overrideArgs let a caller start with
  // a command/args pair that hasn't propagated into the `command`/
  // `defaultArgs` props yet
  const startSessionOnce = useCallback(
    async (targetCwd: string = cwdRef.current, overrideCommand?: string, overrideArgs?: string[]) => {
      const isJa = getLang() === "ja";
      setStatus("idle");
      setActivePrompt(null);
      showStatusMessage(
        isJa
          ? `ディレクトリでセッションを開始しています: ${targetCwd || "デフォルト"}`
          : `Starting session in directory: ${targetCwd || "default"}`
      );

      if (!isTauri()) {
        const size = getTerminalSize?.();
        webClient.sendAction("start_session", {
          command: overrideCommand ?? command,
          args: overrideArgs ?? defaultArgs,
          cwd: targetCwd || null,
          rows: size?.rows,
          cols: size?.cols,
        });
        setStatus("running");
        setCwd(targetCwd);
        return;
      }

      try {
        if (preLaunchCommand) {
          // Config-driven pre-launch check (AppConfig.pre_launch_command):
          // once per app launch, shared by every tab (lib/preflightOnce.ts).
          const runPreLaunch = async (): Promise<boolean> => {
            showStatusMessage(
              isJa ? "起動前処理を実行しています..." : "Running pre-launch checks...",
              false
            );
            const unlistenOutput = subscribeToTauriEvent(
              listen<{ data: number[] }>("pre-launch-output", (event) => {
                onRawOutput?.(new Uint8Array(event.payload.data));
              })
            );
            let resolveStatus: (success: boolean) => void = () => {};
            const statusPromise = new Promise<boolean>((resolve) => {
              resolveStatus = resolve;
            });
            const unlistenStatus = subscribeToTauriEvent(
              listen<{ success: boolean }>("pre-launch-status", (event) => {
                resolveStatus(event.payload.success);
              })
            );
            try {
              await invoke("start_pre_launch_command", {
                cwd: targetCwd || "",
                command: preLaunchCommand,
                args: preLaunchArgs,
              });
              const timeoutMs = 10 * 60 * 1000;
              const timeoutPromise = new Promise<boolean>((resolve) =>
                setTimeout(() => resolve(false), timeoutMs)
              );
              return await Promise.race([statusPromise, timeoutPromise]);
            } finally {
              unlistenOutput();
              unlistenStatus();
            }
          };

          if (preflightOnce.running) {
            showStatusMessage(
              isJa ? "別のタブの起動前処理が終わるのを待っています..." : "Waiting for another tab's pre-launch checks...",
              false
            );
          }
          const outcome = await preflightOnce.run(runPreLaunch);

          if (outcome.error !== undefined) {
            const errText = String(outcome.error);
            if (preLaunchRequired) {
              setStatus("error");
              showStatusMessage(
                isJa
                  ? `起動前処理を実行できませんでした。セッションを開始できません。\n${errText}`
                  : `Failed to run pre-launch command. Session was not started.\n${errText}`,
                false
              );
              return;
            }
            showStatusMessage(
              isJa
                ? `⚠️ 起動前処理を実行できませんでした。セッションをそのまま開始します。\n${errText}`
                : `⚠️ Failed to run pre-launch command. Starting session anyway.\n${errText}`,
              false
            );
          } else if (!outcome.success) {
            if (preLaunchRequired) {
              setStatus("error");
              showStatusMessage(
                isJa
                  ? "起動前処理に失敗しました。セッションを開始できません（詳細は上のログを参照）。"
                  : "Pre-launch check failed. Session was not started (see the log above for details).",
                false
              );
              return;
            }
            showStatusMessage(
              isJa
                ? "⚠️ 起動前処理に失敗しましたが、セッションをそのまま開始します（詳細は上のログを参照）。"
                : "⚠️ Pre-launch check failed. Starting session anyway (see the log above for details).",
              false
            );
          } else if (outcome.ran) {
            showStatusMessage(
              isJa ? "✓ 起動前処理が完了しました" : "✓ Pre-launch checks complete"
            );
          }
        } else {
          // Fallback (Task 9-5 & 9-6): check and auto-rebuild a `skill` folder
          const hasSkill = await invoke<boolean>("check_skill_folder", { cwd: targetCwd || "" });
          if (hasSkill) {
            showStatusMessage(
              isJa
                ? "🛠️ skill フォルダを検出しました。セッション開始前にスキルをリビルドしています..."
                : "🛠️ Skill folder detected. Rebuilding skill before starting session...",
              false
            );

            try {
              await invoke<string>("build_skill", {
                cwd: targetCwd || "",
                agentId: "agy",
              });
              showStatusMessage(
                isJa ? "✓ スキルのリビルドが成功しました！" : "✓ Skill rebuild succeeded!"
              );
            } catch (buildErr: any) {
              showStatusMessage(
                isJa
                  ? `⚠️ スキルのリビルドに失敗しました。セッションをそのまま開始します。\n${buildErr.toString()}`
                  : `⚠️ Skill rebuild failed. Starting session anyway.\n${buildErr.toString()}`,
                false
              );
            }
          }
        }

        const size = getTerminalSize?.();
        await invoke("start_pty", {
          command: overrideCommand ?? command,
          args: overrideArgs ?? defaultArgs,
          cwd: targetCwd || null,
          rows: size?.rows,
          cols: size?.cols,
          sessionId,
        });
        setStatus("running");
        setCwd(targetCwd);
      } catch (e: any) {
        setStatus("error");
        showStatusMessage(
          isJa
            ? `セッションの開始に失敗しました: ${e.toString()}`
            : `Failed to start session: ${e.toString()}`,
          false
        );
      }
    },
    [sessionId, command, defaultArgs, showStatusMessage, getTerminalSize, preLaunchCommand, preLaunchArgs, preLaunchRequired]
  );

  const startSession = useCallback(
    async (targetCwd?: string, overrideCommand?: string, overrideArgs?: string[]) => {
      const flight = startFlightRef.current;
      if (flight.running) {
        console.warn("startSession ignored: a session start is already in progress");
        return;
      }
      setIsStarting(true);
      try {
        await flight.run(() => startSessionOnce(targetCwd, overrideCommand, overrideArgs));
      } finally {
        setIsStarting(false);
      }
    },
    [startSessionOnce]
  );

  // Stop PTY Session
  const stopSession = useCallback(async () => {
    const isJa = getLang() === "ja";
    if (!isTauri()) {
      webClient.sendAction("stop_session");
      setStatus("idle");
      return;
    }
    try {
      await invoke("stop_pty", { sessionId });
      setStatus("idle");
      showStatusMessage(
        isJa ? "ユーザーによってセッションが停止されました。" : "Session stopped by user."
      );
    } catch (e: any) {
      console.error("Failed to stop PTY:", e);
    }
  }, [sessionId, showStatusMessage]);

  // Send input query to PTY
  const sendMessage = useCallback(async (text: string) => {
    if (statusRef.current !== "running") return;
    if (!isTauri()) {
      webClient.sendAction("write_pty", { input: text + "\r" });
      return;
    }
    try {
      await invoke("write_to_pty", { input: text + "\r", sessionId });
    } catch (e: any) {
      console.error("Failed to send message to PTY:", e);
    }
  }, [sessionId]);

  // Respond to an interactive PTY prompt (button clicks or path selection)
  const respondToPrompt = useCallback(async (responseText: string, rawInput?: string) => {
    if (statusRef.current !== "running") return;

    markPromptAnswered();
    const inputToSend = rawInput ?? resolvePromptResponseInput(responseText);

    if (!isTauri()) {
      webClient.sendAction("respond_prompt", { input: inputToSend });
      return;
    }

    try {
      await invoke("write_to_pty", { input: inputToSend, sessionId });
    } catch (e: any) {
      console.error("Failed to write response to PTY:", e);
    }
  }, [sessionId, markPromptAnswered]);

  // Change working directory and restart PTY
  const changeCwd = useCallback(
    async (newCwd: string) => {
      setCwd(newCwd);
      await startSession(newCwd);
    },
    [startSession]
  );

  // Listen to PTY outputs, status changes, and prompt detections
  useEffect(() => {
    if (!isTauri()) {
      const offOutput = webClient.on("output", (data: number[]) => {
        onRawOutput?.(new Uint8Array(data));
      });
      const offPreLaunch = webClient.on("pre_launch_output", (data: number[]) => {
        onRawOutput?.(new Uint8Array(data));
      });
      const offPrompt = webClient.on("prompt", (prompt: PtyPrompt) => {
        showPromptUnlessEcho(prompt);
      });
      const offStatus = webClient.on("status", (s: string) => {
        if (s === "terminated" || s === "idle") {
          setStatus("idle");
        } else if (s === "running") {
          setStatus("running");
        }
      });
      const offCwd = webClient.on("cwd_changed", (newCwd: string) => {
        setCwd(newCwd);
      });

      return () => {
        offOutput();
        offPreLaunch();
        offPrompt();
        offStatus();
        offCwd();
      };
    }

    // Tauri Desktop Listeners: this session's events only (pty.rs
    // session-output / session-prompt / session-status carry the id).
    const unsubOutput = subscribeToTauriEvent(
      listen<SessionOutputEvent>("session-output", (event) => {
        if (!isForSession(event.payload, sessionId)) return;
        onRawOutput?.(new Uint8Array(event.payload.data));
      })
    );

    const unsubPrompt = subscribeToTauriEvent(
      listen<SessionPromptEvent<PtyPrompt>>("session-prompt", (event) => {
        if (!isForSession(event.payload, sessionId)) return;
        showPromptUnlessEcho(event.payload.prompt);
      })
    );

    const unsubStatus = subscribeToTauriEvent(
      listen<SessionStatusEvent>("session-status", (event) => {
        if (!isForSession(event.payload, sessionId)) return;
        if (event.payload.status === "terminated") {
          setStatus("idle");
        }
      })
    );

    return () => {
      unsubOutput();
      unsubStatus();
      unsubPrompt();
    };
  }, [sessionId, onRawOutput, showPromptUnlessEcho]);

  return {
    sessionId,
    cwd,
    status,
    isStarting,
    activePrompt,
    noteTerminalInput,
    statusMessage,
    showStatusMessage,
    startSession,
    stopSession,
    sendMessage,
    respondToPrompt,
    changeCwd,
  };
}
