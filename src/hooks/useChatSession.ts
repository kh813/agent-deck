import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolvePromptResponseInput } from "../lib/promptResponse";
import { subscribeToTauriEvent } from "../lib/tauriListener";
import { isTauri, webClient } from "../lib/webClient";

export interface PtyPrompt {
  prompt_type: "confirm" | "path" | "login";
  message: string;
  options?: string[];
  url?: string;
}

export interface UseChatSessionOptions {
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
  const [activePrompt, setActivePrompt] = useState<PtyPrompt | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
  const startSession = useCallback(
    async (targetCwd: string = cwdRef.current, overrideCommand?: string, overrideArgs?: string[]) => {
      const isJa = navigator.language.startsWith("ja");
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
          // Config-driven pre-launch check (AppConfig.pre_launch_command)
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
            const success = await Promise.race([statusPromise, timeoutPromise]);

            if (!success) {
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
            } else {
              showStatusMessage(
                isJa ? "✓ 起動前処理が完了しました" : "✓ Pre-launch checks complete"
              );
            }
          } catch (preLaunchErr: any) {
            if (preLaunchRequired) {
              setStatus("error");
              showStatusMessage(
                isJa
                  ? `起動前処理を実行できませんでした。セッションを開始できません。\n${preLaunchErr.toString()}`
                  : `Failed to run pre-launch command. Session was not started.\n${preLaunchErr.toString()}`,
                false
              );
              return;
            }
            showStatusMessage(
              isJa
                ? `⚠️ 起動前処理を実行できませんでした。セッションをそのまま開始します。\n${preLaunchErr.toString()}`
                : `⚠️ Failed to run pre-launch command. Starting session anyway.\n${preLaunchErr.toString()}`,
              false
            );
          } finally {
            unlistenOutput();
            unlistenStatus();
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
    [command, defaultArgs, showStatusMessage, getTerminalSize, preLaunchCommand, preLaunchArgs, preLaunchRequired]
  );

  // Stop PTY Session
  const stopSession = useCallback(async () => {
    const isJa = navigator.language.startsWith("ja");
    if (!isTauri()) {
      webClient.sendAction("stop_session");
      setStatus("idle");
      return;
    }
    try {
      await invoke("stop_pty");
      setStatus("idle");
      showStatusMessage(
        isJa ? "ユーザーによってセッションが停止されました。" : "Session stopped by user."
      );
    } catch (e: any) {
      console.error("Failed to stop PTY:", e);
    }
  }, [showStatusMessage]);

  // Send input query to PTY
  const sendMessage = useCallback(async (text: string) => {
    if (statusRef.current !== "running") return;
    if (!isTauri()) {
      webClient.sendAction("write_pty", { input: text + "\r" });
      return;
    }
    try {
      await invoke("write_to_pty", { input: text + "\r" });
    } catch (e: any) {
      console.error("Failed to send message to PTY:", e);
    }
  }, []);

  // Respond to an interactive PTY prompt (button clicks or path selection)
  const respondToPrompt = useCallback(async (responseText: string) => {
    if (statusRef.current !== "running") return;

    setActivePrompt(null);
    const inputToSend = resolvePromptResponseInput(responseText);

    if (!isTauri()) {
      webClient.sendAction("respond_prompt", { input: inputToSend });
      return;
    }

    try {
      await invoke("write_to_pty", { input: inputToSend });
    } catch (e: any) {
      console.error("Failed to write response to PTY:", e);
    }
  }, []);

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
        setActivePrompt(prompt);
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

    // Tauri Desktop Listeners
    const unsubOutput = subscribeToTauriEvent(
      listen<{ data: number[] }>("pty-output", (event) => {
        onRawOutput?.(new Uint8Array(event.payload.data));
      })
    );

    const unsubPrompt = subscribeToTauriEvent(
      listen<PtyPrompt>("pty-prompt", (event) => {
        setActivePrompt(event.payload);
      })
    );

    const unsubStatus = subscribeToTauriEvent(
      listen<string>("pty-status", (event) => {
        if (event.payload === "terminated") {
          setStatus("idle");
        }
      })
    );

    return () => {
      unsubOutput();
      unsubStatus();
      unsubPrompt();
    };
  }, [onRawOutput]);

  return {
    cwd,
    status,
    activePrompt,
    statusMessage,
    startSession,
    stopSession,
    sendMessage,
    respondToPrompt,
    changeCwd,
  };
}
