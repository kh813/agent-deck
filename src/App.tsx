import { useState, useEffect, useRef, useCallback } from "react";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Terminal } from "@xterm/xterm";
import { TerminalView } from "./components/TerminalView";
import { SkillCatalogPanel } from "./components/SkillCatalogPanel";
import { subscribeToTauriEvent } from "./lib/tauriListener";
import { themes } from "./utils/themes";
import { Lang, translations } from "./utils/i18n";
import { isTauri, webClient } from "./lib/webClient";
import "./App.css";
import { loadSavedEngine, pickEngine, saveEngine } from "./lib/engineSelection";
import { isNewerInstalled, isTestKind, isUpdateBannerVisible, lastCheckStore, shouldApplyBackgroundResult, startUpdatePolling, type BackgroundKind, type SelfUpdateKind } from "./lib/updatePolling";
import { baseName, pickImageFile, promptTextForPaths, saveClipboardImage, saveImageBlob } from "./lib/imageAttach";
import { Attachment, AttachmentKind, MAX_ATTACHMENTS, addAttachments, canSend, composeMessage, removeAttachment } from "./lib/attachments";
import { AttachmentChips, ImageAttachButton } from "./components/ImageAttachButton";
import { RESTART_DELAY_MS, decideAfterSelfUpdate } from "./lib/selfUpdateRestart";
import {
  DEFAULT_SESSION_ID, MAX_TABS, SessionOutputEvent, SessionStatusEvent, Tab, addTab, canAddTab,
  findFolderConflict, isForSession, newSessionId, nextActiveAfterClose, removeTab, renameTab, tabLabel,
} from "./lib/sessions";
import { sameSet, tabShortcutTarget } from "./lib/tabShortcuts";
import { workingSessions } from "./lib/sessionLights";
import { TabSidebar } from "./components/TabSidebar";
import { NewTabDialog } from "./components/NewTabDialog";
import { IDLE_RUNTIME_STATE, RuntimeApi, RuntimeState, SessionRuntime } from "./components/SessionRuntime";
import { loadLangChoice, parseLangChoice, resolveLang, saveLangChoice, setCurrentLang, type LangChoice } from "./lib/language";
import { stopAndWaitForExit } from "./lib/ptyHandover";
import {
  applyFontAction,
  effectiveFont,
  FALLBACK_DEFAULTS,
  loadFontOverride,
  saveFontOverride,
  type FontMenuAction,
} from "./lib/terminalFont";

interface AgentStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

interface EngineConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
}

interface AppConfig {
  app_name: string;
  default_theme: string;
  font_family: string;
  font_size: number;
  engines: EngineConfig[];
  pre_launch_command?: string | null;
  pre_launch_args?: string[];
  pre_launch_required?: boolean;
}


interface UpdateStatus {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

function App() {

  const [input, setInput] = useState("");
  // Images attached from the input bar (🖼 button / paste), sent with the text.
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // CWD History State
  const [recentCwds, setRecentCwds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("recentCwds");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isRecentOpen, setIsRecentOpen] = useState(false);

  // SKILL.md State
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [skillPath, setSkillPath] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Theme State
  const [currentThemeId, setCurrentThemeId] = useState(() => {
    return localStorage.getItem("agent-ui-theme") || "light";
  });



  // Sync theme with body class
  useEffect(() => {
    localStorage.setItem("agent-ui-theme", currentThemeId);

    // Remove all theme classes first
    const classesToRemove = Array.from(document.body.classList).filter(c => c.startsWith("theme-"));
    classesToRemove.forEach(c => document.body.classList.remove(c));

    // Add specific theme class
    document.body.classList.add(`theme-${currentThemeId}`);

    // Also toggle generic theme-dark helper if needed
    const isDark = themes[currentThemeId]?.isDark ?? false;
    document.body.classList.toggle("theme-dark", isDark);

    // Keep the native app menu's Theme checkmarks in sync, and tell the
    // backend whether the terminal is dark (passed to sessions as COLORFGBG
    // so Claude Code's "auto" theme matches; takes effect on the next start).
    invoke("set_theme", { themeId: currentThemeId, isDark }).catch(() => {});
  }, [currentThemeId]);

  // Apply theme changes made from the native app menu
  useEffect(() => {
    const unsub = subscribeToTauriEvent(
      listen<string>("theme-changed", (event) => {
        setCurrentThemeId(event.payload);
      })
    );

    return unsub;
  }, []);

  // UI language: View -> Language choice, or the OS (lib/language.ts --
  // the Rust side reports the OS settings, since Windows' WebView2 can say
  // en-US on a Japanese setup).
  const [langChoice, setLangChoice] = useState<LangChoice>(loadLangChoice);
  const [osLocales, setOsLocales] = useState<string[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    invoke<string[]>("get_os_locales").then(setOsLocales).catch(() => {});
  }, []);
  const lang: Lang = resolveLang(langChoice, osLocales, navigator.language);
  setCurrentLang(lang);
  useEffect(() => {
    if (!isTauri()) return;
    invoke("set_language_menu_state", { choice: langChoice }).catch(() => {});
  }, [langChoice]);
  useEffect(() => {
    const unsub = subscribeToTauriEvent(
      listen<string>("language-menu", (event) => {
        const choice = parseLangChoice(event.payload);
        if (!choice) return;
        saveLangChoice(choice);
        setLangChoice(choice);
      })
    );
    return unsub;
  }, []);

  // Translation helper
  const t = (key: keyof typeof translations['ja']) => {
    return translations[lang][key];
  };

  // Config & Selection States
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});
  // False until the first detection pass has finished. Until then an empty
  // agentStatuses means "not checked yet", NOT "not installed" -- showing the
  // "X is required / Install X" panel during that window made it look like
  // agy/Claude Code was missing on every launch.
  const [agentStatusChecked, setAgentStatusChecked] = useState(false);

  // Terminal font: agent_config.json's font_family/font_size are the
  // defaults; the native Font menu stores a per-user override on top
  // (lib/terminalFont.ts).
  const [fontOverride, setFontOverride] = useState(loadFontOverride);
  const fontDefaults = {
    family: appConfig?.font_family || FALLBACK_DEFAULTS.family,
    size: appConfig?.font_size || FALLBACK_DEFAULTS.size,
  };
  const terminalFont = effectiveFont(fontOverride, fontDefaults);
  const fontDefaultsRef = useRef(fontDefaults);
  fontDefaultsRef.current = fontDefaults;

  useEffect(() => {
    saveFontOverride(fontOverride);
    if (isTauri()) {
      invoke("set_font_menu_state", { family: fontOverride.family, size: terminalFont.size }).catch(() => {});
    }
  }, [fontOverride, terminalFont.size]);

  useEffect(() => {
    const unsub = subscribeToTauriEvent(
      listen<FontMenuAction>("font-menu", (event) => {
        setFontOverride((cur) => applyFontAction(cur, event.payload, fontDefaultsRef.current));
      })
    );
    return unsub;
  }, []);
  const [selectedAgentId, setSelectedAgentId] = useState(() => loadSavedEngine() ?? "agy");

  const currentAgentStatus = agentStatuses[selectedAgentId] || {
    installed: false,
    path: null,
    version: null,
  };

  // Derived from selectedAgentId so this naturally becomes "the active
  // tab's engine" once multiple concurrent sessions/tabs are supported.
  const selectedEngine = appConfig?.engines.find((e) => e.id === selectedAgentId);

  // Update States
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    current_version: null,
    latest_version: null,
    update_available: false,
  });
  // agent-deck's own update status, distinct from updateStatus above (which
  // is about the agy engine). Checked from the native menu on demand, and
  // periodically in the background (lib/updatePolling.ts) -- which only
  // shows the banner; nothing is installed until its button is clicked.
  const [selfUpdateStatus, setSelfUpdateStatus] = useState<UpdateStatus>({
    current_version: null,
    latest_version: null,
    update_available: false,
  });
  // Which of the 3 Update submenu items (see menu.rs) selfUpdateStatus/
  // handleUpdateSelf refer to -- set whenever a check happens, so applying
  // always targets the item that was just checked. "github" only appears
  // when neither org Drive channel is configured in config.toml; otherwise
  // only "org-prod"/"org-test" are ever offered.
  const [selfUpdateKind, setSelfUpdateKind] = useState<SelfUpdateKind>("github");
  // "Later" on the banner: hides it for that version until a newer one
  // appears or the user checks explicitly from the menu (not persisted, so
  // the reminder comes back on the next launch).
  const [dismissedSelfUpdateVersion, setDismissedSelfUpdateVersion] = useState<string | null>(null);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState(() => {
    const saved = localStorage.getItem("autoCheckUpdate");
    return saved !== "false"; // Default to true
  });

  // Keep the native app menu's "Check for Updates on Startup" checkmark in sync
  useEffect(() => {
    localStorage.setItem("autoCheckUpdate", autoCheckUpdate.toString());
    invoke("set_auto_check_update", { enabled: autoCheckUpdate }).catch(() => {});
  }, [autoCheckUpdate]);

  // Apply changes made from the native app menu
  useEffect(() => {
    const unsub = subscribeToTauriEvent(
      listen<boolean>("auto-check-update-changed", (event) => {
        setAutoCheckUpdate(event.payload);
      })
    );

    return unsub;
  }, []);

  const [isInstalling, setIsInstalling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSelfUpdating, setIsSelfUpdating] = useState(false);
  // Set only once the update command itself owns the PTY (see
  // lib/ptyHandover.ts): the "terminated" handler below must ignore the
  // previous session's exit, which used to be taken as "update complete".
  const agentUpdateActiveRef = useRef(false);
  const selfUpdateActiveRef = useRef(false);
  const selfUpdateStartedAtRef = useRef(0);
  const [isInstallTerminalOpen, setIsInstallTerminalOpen] = useState(false);

  // Web UI Server State (Desktop & Browser)
  const [webServerStatus, setWebServerStatus] = useState<{
    running: boolean;
    port: number;
    local_ip?: string | null;
    url?: string | null;
    qr_code_base64?: string | null;
    password_set: boolean;
  }>({
    running: false,
    port: 8443,
    local_ip: null,
    url: null,
    qr_code_base64: null,
    password_set: false,
  });
  const [isWebUiModalOpen, setIsWebUiModalOpen] = useState(false);
  // Not persisted any more: it used to sit in localStorage in plain text.
  const [webUiPasswordInput, setWebUiPasswordInput] = useState("");
  useEffect(() => {
    try {
      localStorage.removeItem("agent_deck_web_password");
    } catch {
      // storage unavailable: nothing stored either
    }
  }, []);
  // Web UI is switched off in releases until its security is reviewed
  // (web_server.rs web_ui_available; AGENT_DECK_WEB_UI=1 for development).
  const [webUiAvailable, setWebUiAvailable] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    invoke<boolean>("web_ui_available").then(setWebUiAvailable).catch(() => setWebUiAvailable(false));
  }, []);
  const [webUiPortInput, setWebUiPortInput] = useState<number>(8443);
  const [isWebLoginRequired, setIsWebLoginRequired] = useState(false);
  const [browserLoginPassword, setBrowserLoginPassword] = useState("");
  const [browserLoginError, setBrowserLoginError] = useState(false);

  // Custom SSL Configuration State
  const [sslConfig, setSslConfig] = useState<{
    use_custom_ssl: boolean;
    custom_cert_filename?: string | null;
    custom_key_filename?: string | null;
  }>({
    use_custom_ssl: false,
    custom_cert_filename: null,
    custom_key_filename: null,
  });
  const [selectedCertPath, setSelectedCertPath] = useState("");
  const [selectedKeyPath, setSelectedKeyPath] = useState("");
  const [sslImportError, setSslImportError] = useState<string | null>(null);
  const [sslImportSuccessMsg, setSslImportSuccessMsg] = useState<string | null>(null);

  const terminalRef = useRef<Terminal | null>(null);
  const terminalSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const hasAutoStartedRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True once the terminal's size has stopped changing for a short while.
  const [terminalSizeSettled, setTerminalSizeSettled] = useState(false);

  // Raw PTY output handler to write directly to xterm.js.
  const handleRawOutput = useCallback((raw: Uint8Array) => {
    if (terminalRef.current) {
      terminalRef.current.write(raw);
    }
  }, []);

  // Forwards keys typed directly into the terminal to the PTY.
  // (Assigned below, once useChatSession has run.) Lets a prompt answered
  // in the terminal also dismiss the GUI's prompt panel.
  const noteTerminalInputRef = useRef<(data: string) => void>(() => {});
  // ── Tabs (app_specs.md 5.7.4) ──
  // One tab = one session. The terminal, input bar, prompt panel and the
  // install/update flows act on the active tab. Each tab's live session is a
  // SessionRuntime (always mounted); its state is reported into
  // runtimeStates and its controls registered in runtimesRef.
  const [tabs, setTabs] = useState<Tab[]>(() => [
    { id: DEFAULT_SESSION_ID, name: "", cwd: "", engineId: selectedAgentId },
  ]);
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_SESSION_ID);
  const [startOnMountIds, setStartOnMountIds] = useState<ReadonlySet<string>>(() => new Set());
  const runtimesRef = useRef<Record<string, RuntimeApi>>({});
  const [runtimeStates, setRuntimeStates] = useState<Record<string, RuntimeState>>({});
  const registerRuntime = useCallback((id: string, api: RuntimeApi | null) => {
    if (api) runtimesRef.current[id] = api;
    else delete runtimesRef.current[id];
  }, []);
  const handleRuntimeState = useCallback((id: string, state: RuntimeState) => {
    setRuntimeStates((prev) => ({ ...prev, [id]: state }));
    // the tab remembers its folder once its session has one
    if (state.cwd) setTabs((prev) => prev.map((t) => (t.id === id && t.cwd !== state.cwd ? { ...t, cwd: state.cwd } : t)));
  }, []);
  const activeRuntime = useCallback(() => runtimesRef.current[activeSessionId], [activeSessionId]);
  const handleTerminalInput = useCallback((data: string) => {
    noteTerminalInputRef.current(data);
    invoke("write_to_pty", { input: data, sessionId: activeSessionId });
  }, [activeSessionId]);

  // Keeps the PTY's reported window size in sync with what xterm.js is actually rendering.
  const handleTerminalResize = useCallback((size: { rows: number; cols: number }) => {
    terminalSizeRef.current = size;
    invoke("resize_pty", { ...size, sessionId: activeSessionId }).catch(() => {
      // No active session yet - the size will be used when one starts.
    });

    setTerminalSizeSettled(false);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      setTerminalSizeSettled(true);
    }, 300);
  }, []);


  // The active tab's session, as the rest of the screen sees it.
  const activeState = runtimeStates[activeSessionId] ?? IDLE_RUNTIME_STATE;
  const { cwd, status, isStarting, activePrompt, statusMessage } = activeState;
  const startSession = useCallback(
    async (targetCwd?: string, command?: string, args?: string[]) => {
      await activeRuntime()?.startSession(targetCwd, command, args);
    },
    [activeRuntime],
  );
  const stopSession = useCallback(async () => { await activeRuntime()?.stopSession(); }, [activeRuntime]);
  const sendMessage = useCallback(async (text: string) => { await activeRuntime()?.sendMessage(text); }, [activeRuntime]);
  const respondToPrompt = useCallback(
    async (text: string, raw?: string) => { await activeRuntime()?.respondToPrompt(text, raw); },
    [activeRuntime],
  );
  const changeCwdUnchecked = useCallback(async (dir: string) => { await activeRuntime()?.changeCwd(dir); }, [activeRuntime]);
  // Platform folder-name case rule for the "same or nested folder" check.
  const caseInsensitiveFs = typeof navigator !== "undefined" && /Mac|Win/i.test(navigator.userAgent);
  // Resolve a folder (and every other tab's) and refuse one already in use
  // by another tab, or nested with one (5.7.4). Returns the resolved path.
  const resolveFolderFor = useCallback(async (dir: string, forTabId?: string): Promise<{ folder: string; error: string | null }> => {
    if (!isTauri()) return { folder: dir, error: null };
    const resolve = (p: string) => invoke<string>("resolve_session_folder", { path: p }).catch(() => p);
    const folder = await resolve(dir);
    const others = await Promise.all(tabs.filter((tb) => tb.id !== forTabId).map(async (tb) => ({ ...tb, cwd: await resolve(tb.cwd) })));
    const conflict = findFolderConflict(others, folder, caseInsensitiveFs);
    const error = conflict
      ? t("folderInUse").replace("{tab}", tabLabel(conflict, t("appLocationShort"))).replace("{folder}", folder)
      : null;
    return { folder, error };
  }, [tabs, caseInsensitiveFs, lang]);
  const checkFolderFree = useCallback(async (dir: string, forTabId?: string): Promise<string | null> => {
    const { folder, error } = await resolveFolderFor(dir, forTabId);
    if (error) {
      await message(error, { title: "agent-deck", kind: "warning" });
      return null;
    }
    return folder;
  }, [resolveFolderFor]);
  const changeCwd = useCallback(async (dir: string) => {
    const folder = await checkFolderFree(dir, activeSessionId);
    if (folder) await changeCwdUnchecked(dir);
  }, [checkFolderFree, activeSessionId, changeCwdUnchecked]);
  const showStatusMessage = useCallback((text: string, autoClear = true) => {
    const rt = activeRuntime();
    if (rt) rt.showStatusMessage(text, autoClear);
    else console.info(text);
  }, [activeRuntime]);
  noteTerminalInputRef.current = (data: string) => activeRuntime()?.noteTerminalInput(data);

  // Load SKILL.md content when CWD changes
  useEffect(() => {
    const loadSkillFile = async () => {
      if (!cwd) {
        setSkillContent(null);
        setSkillPath(null);
        return;
      }
      try {
        const content = await invoke<string>("read_skill_file", { cwd });
        setSkillContent(content);
        setSkillPath(`${cwd}/SKILL.md`);
      } catch (e) {
        setSkillContent(null);
        setSkillPath(null);
      }
    };
    loadSkillFile();
  }, [cwd]);

  // Update CWD history list
  const updateRecentCwds = useCallback((newCwd: string) => {
    if (!newCwd) return;
    setRecentCwds((prev) => {
      const list = [newCwd, ...prev.filter((x) => x !== newCwd)].slice(0, 5);
      localStorage.setItem("recentCwds", JSON.stringify(list));
      return list;
    });
  }, []);

  // Update history on CWD change
  useEffect(() => {
    if (cwd) {
      updateRecentCwds(cwd);
    }
  }, [cwd, updateRecentCwds]);

  // Subscribe to Native Force Kill Session menu event
  useEffect(() => {
    const unsub = subscribeToTauriEvent(
      listen("menu-force-kill-requested", async () => {
        try {
          await invoke("force_kill_pty", { sessionId: activeSessionId });
        } catch (e) {
          console.error("Failed to force kill PTY:", e);
        }
      })
    );
    return unsub;
  }, []);

  // Auto-inject SKILL.md content as a metaprompt for non-agy engines on session start
  const hasAutoInjectedRef = useRef(false);
  useEffect(() => {
    if (status === "running") {
      if (!hasAutoInjectedRef.current) {
        hasAutoInjectedRef.current = true;
        if (selectedAgentId !== "agy" && skillContent) {
          // Delay to ensure the PTY process has initialized and is ready
          setTimeout(() => {
            sendMessage(`[SYSTEM: SKILL RUNNER MODE]\nPlease follow the instructions in the SKILL.md content below:\n\n${skillContent}`);
          }, 1500);
        }
      }
    } else {
      hasAutoInjectedRef.current = false;
    }
  }, [status, selectedAgentId, skillContent, sendMessage]);

  // Detect installer CLI path and version for all configured engines
  const checkAgentStatus = useCallback(async () => {
    if (!appConfig) return;
    try {
      // All engines in parallel: each detection runs `<cli> --version`, which
      // can take seconds, so sequential checks added up on startup.
      const entries = await Promise.all(
        appConfig.engines.map(async (engine): Promise<[string, AgentStatus]> => {
          try {
            return [engine.id, await invoke<AgentStatus>("detect_agent", { agentId: engine.id })];
          } catch (e) {
            console.error(`Failed to detect agent ${engine.id}:`, e);
            return [engine.id, { installed: false, path: null, version: null }];
          }
        })
      );
      setAgentStatuses(Object.fromEntries(entries));
    } catch (e) {
      console.error("Failed to detect agent status:", e);
    } finally {
      setAgentStatusChecked(true);
    }
  }, [appConfig]);

  // Check for updates
  const checkUpdateStatus = useCallback(async () => {
    try {
      const res = await invoke<UpdateStatus>("check_agent_update", { agentId: selectedAgentId });
      setUpdateStatus(res);
    } catch (e) {
      console.error("Failed to check agent update:", e);
    }
  }, [selectedAgentId]);

  // Check for agent-deck's own update. Returns the result (unlike
  // checkUpdateStatus above) so an explicit, user-triggered check can report
  // "already up to date" -- there's no startup auto-check for this one to
  // silently fall back to.
  const checkSelfUpdateStatus = useCallback(async (kind: SelfUpdateKind) => {
    try {
      const res = await invoke<UpdateStatus>("check_self_update", { kind });
      setSelfUpdateStatus(res);
      setSelfUpdateKind(kind);
      return res;
    } catch (e) {
      console.error("Failed to check agent-deck update:", e);
      return null;
    }
  }, []);

  // The Update submenu's items (see menu.rs -- exactly one of "github" or
  // both org items is ever shown, depending on config.toml). Unlike the agy
  // auto-check above, this is always an explicit user action, so an
  // "already up to date" result needs its own feedback rather than
  // silently doing nothing.
  useEffect(() => {
    const unsub = subscribeToTauriEvent(
      listen<string>("check-self-update-requested", (event) => {
        const kind = event.payload === "org-prod" || event.payload === "org-test"
          ? event.payload
          : "github";
        setDismissedSelfUpdateVersion(null);
        checkSelfUpdateStatus(kind).then((res) => {
          if (res && !res.update_available) {
            // e.g. "Update to Latest..." on a newer test build: say so
            // rather than a bare "up to date" (and never downgrade).
            if (isNewerInstalled(res)) {
              alert(t("selfUpdateNewerInstalled").replace("{current}", res.current_version || "").replace("{latest}", res.latest_version || ""));
              return;
            }
            alert(t("selfUpdateUpToDate"));
          }
        });
      })
    );

    return unsub;
  }, [checkSelfUpdateStatus]);

  // Periodic background check (launch + every few hours + on focus after a
  // long gap) for agent-deck itself and the selected engine, gated on the
  // "Check for Updates Automatically" setting. Only ever shows the banners.
  const selfUpdateShownRef = useRef({ status: selfUpdateStatus, kind: selfUpdateKind });
  selfUpdateShownRef.current = { status: selfUpdateStatus, kind: selfUpdateKind };
  const checkUpdateStatusRef = useRef<() => Promise<void>>(async () => {});
  const engineInstalledRef = useRef(false);
  useEffect(() => {
    if (!isTauri() || !autoCheckUpdate) return;
    return startUpdatePolling(async () => {
      if (engineInstalledRef.current) void checkUpdateStatusRef.current();
      if (selfUpdateActiveRef.current) return;
      // This build's own channel only: test builds hear about new test
      // builds, stable builds about new stable releases ("none": an org
      // install that doesn't publish this channel -> no automatic check).
      const kind = await invoke<BackgroundKind>("default_self_update_kind");
      if (kind === "none") return;
      const res = await invoke<UpdateStatus>("check_self_update", { kind, background: true });
      const shown = selfUpdateShownRef.current;
      if (shouldApplyBackgroundResult(shown.status, shown.kind, res, kind)) {
        setSelfUpdateStatus(res);
        setSelfUpdateKind(kind);
      }
    }, {
      store: lastCheckStore,
      onFocus: (cb) => {
        window.addEventListener("focus", cb);
        return () => window.removeEventListener("focus", cb);
      },
    });
  }, [autoCheckUpdate]);

  // 1. Load dynamic configuration
  useEffect(() => {
    const loadAppConfig = async () => {
      try {
        const cfg = await invoke<AppConfig>("get_app_config", { cwd: cwd || null });
        setAppConfig(cfg);
        
        const savedTheme = localStorage.getItem("agent-ui-theme");
        if (!savedTheme && cfg.default_theme) {
          setCurrentThemeId(cfg.default_theme);
        }
      } catch (e) {
        console.error("Failed to load app config:", e);
      }
    };
    loadAppConfig();
  }, [cwd]);

  // 2. Trigger status detection when configuration loads or refreshes
  useEffect(() => {
    if (!appConfig) return;
    checkAgentStatus();

  }, [appConfig, checkAgentStatus]);

  // Keep the selection on a configured engine, and once detection results are
  // in, move off an engine that isn't installed onto the first one that is
  // (so a Claude-Code-only machine doesn't get stuck on the agy installer).
  useEffect(() => {
    if (!appConfig) return;
    const next = pickEngine(appConfig.engines.map(e => e.id), agentStatuses, selectedAgentId);
    if (next && next !== selectedAgentId) {
      setSelectedAgentId(next);
    }
  }, [appConfig, agentStatuses, selectedAgentId]);

  // Remember the user's engine choice across launches.
  useEffect(() => {
    saveEngine(selectedAgentId);
  }, [selectedAgentId]);

  // An update banner belongs to the engine it was checked for -- drop it when
  // the selection changes (the check effect below re-runs for the new one).
  useEffect(() => {
    setUpdateStatus({ current_version: null, latest_version: null, update_available: false });
  }, [selectedAgentId]);


  // Quit guard (src-tauri/src/quit_guard.rs): while any of these runs,
  // Cmd/Ctrl+Q or closing the window asks before quitting. (A working
  // agent/skill is detected on the Rust side from terminal output.)
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const quitGuardBusy = isStarting || isSelfUpdating || isUpdating || isInstalling || catalogBusy;
  useEffect(() => {
    if (!isTauri()) return;
    invoke("set_quit_guard_busy", { busy: quitGuardBusy }).catch(() => {});
  }, [quitGuardBusy]);

  checkUpdateStatusRef.current = checkUpdateStatus;
  engineInstalledRef.current = currentAgentStatus.installed;

  // Check updates if installed and enabled
  useEffect(() => {
    if (currentAgentStatus.installed && autoCheckUpdate) {
      checkUpdateStatus();
    }
  }, [currentAgentStatus.installed, autoCheckUpdate, checkUpdateStatus]);

  // Auto-start a session as soon as the selected agent is detected as installed and terminal size settled
  //
  // Passes the engine's command/args explicitly (same reason as the
  // engine-change effect below): on first launch the selection can be moved
  // onto a different installed engine (pickEngine) in the very render this
  // fires, when shellPath state still holds the previous engine's command.
  // Also syncs previousAgentIdRef so the engine-change effect doesn't treat
  // that same automatic switch as a user change and start a second session.
  const previousAgentIdRef = useRef(selectedAgentId);
  useEffect(() => {
    if (currentAgentStatus.installed && status === "idle" && terminalSizeSettled && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      previousAgentIdRef.current = selectedAgentId;
      const engine = appConfig?.engines.find(e => e.id === selectedAgentId);
      if (engine && currentAgentStatus.path) {
        startSession(undefined, currentAgentStatus.path, engine.args || []);
      } else {
        startSession();
      }
    }
  }, [currentAgentStatus.installed, currentAgentStatus.path, status, terminalSizeSettled, startSession, appConfig, selectedAgentId]);

  // Start a fresh session when the engine selection actually changes while
  // idle (e.g. switching from agy to Claude Code after Stop). Without this,
  // picking a different engine only updated shellPath/shellArgs -- nothing
  // launched it, which read as "nothing happens" (confirmed for real: the
  // dropdown and the native menu it used to mirror both had this same gap).
  // Guarded on a real *change* (not the initial value) so it never fights
  // with the one-shot auto-start above or re-launches the same engine
  // immediately after a plain Stop.
  //
  // Passes the new engine's command/args as explicit startSession overrides
  // rather than relying on shellPath/shellArgs state: effect #3 above (which
  // sets that state) runs in the same pass, and a state update doesn't take
  // effect until next render -- calling startSession() here with no
  // overrides would still capture the *previous* engine's command (confirmed
  // for real).
  useEffect(() => {
    const changed = previousAgentIdRef.current !== selectedAgentId;
    previousAgentIdRef.current = selectedAgentId;
    if (!changed || !appConfig || status !== "idle" || !terminalSizeSettled) return;

    const engine = appConfig.engines.find(e => e.id === selectedAgentId);
    const engineStatus = agentStatuses[selectedAgentId];
    if (engine && engineStatus?.installed && engineStatus.path) {
      hasAutoStartedRef.current = true;
      startSession(undefined, engineStatus.path, engine.args || []);
    }
  }, [selectedAgentId, appConfig, agentStatuses, status, terminalSizeSettled, startSession]);

  // After "Update to ...": restart into the new version when the update
  // really installed one (lib/selfUpdateRestart.ts); otherwise say why not.
  const finishSelfUpdate = useCallback(async (startedAtMs: number) => {
    const outcome = await decideAfterSelfUpdate(
      () => invoke<boolean>("self_update_applied", { startedAtMs }),
    );
    if (outcome === "restart") {
      showStatusMessage(t("selfUpdateRestarting"), false);
      await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
      try {
        await invoke("restart_after_update");
      } catch {
        // Couldn't relaunch (e.g. a dev build): fall back to asking.
        showStatusMessage(t("selfUpdateAppliedRestart"), false);
        alert(t("selfUpdateAppliedRestart"));
      }
    } else {
      showStatusMessage(t("selfUpdateNotApplied"));
    }
  }, [showStatusMessage, lang]);

  // Listen to PTY termination during installation and updates
  useEffect(() => {
    const unsubStatus = subscribeToTauriEvent(
      listen<SessionStatusEvent>("session-status", (raw) => {
        if (!isForSession(raw.payload, activeSessionId)) return;
        const event = { payload: raw.payload.status };
        // An agent-deck update's session can also end with "error" (the
        // pipe broke instead of closing, Windows): it's over either way --
        // check whether it installed and restart.
        if (event.payload === "error" && isSelfUpdating && selfUpdateActiveRef.current) {
          selfUpdateActiveRef.current = false;
          setIsSelfUpdating(false);
          void finishSelfUpdate(selfUpdateStartedAtRef.current);
          return;
        }
        if (event.payload === "terminated") {
          if (isInstalling) {
            setIsInstalling(false);
            checkAgentStatus();
          }
          if (isUpdating && agentUpdateActiveRef.current) {
            agentUpdateActiveRef.current = false;
            setIsUpdating(false);
            checkAgentStatus().then(() => {
              checkUpdateStatus();
            });
          }
          if (isSelfUpdating && selfUpdateActiveRef.current) {
            selfUpdateActiveRef.current = false;
            // Unlike agy above, there's no "re-detect" step that makes sense
            // here: the running process's own version can't change without
            // an actual restart, so self_update.py apply's own completion
            // (this process exiting) is the whole signal -- just relay it.
            setIsSelfUpdating(false);
            void finishSelfUpdate(selfUpdateStartedAtRef.current);
          }
        }
      })
    );

    return unsubStatus;
  }, [isInstalling, isUpdating, isSelfUpdating, checkAgentStatus, checkUpdateStatus, showStatusMessage, finishSelfUpdate]);

  // Poll for install/update completion independent of the PTY session ever
  // reporting "terminated".
  //
  // Confirmed for real (2026-07-21): agy's own installer can finish all of
  // its visible work (binary placed, PATH registry updated, checkmark
  // printed) while the underlying PTY/ConPTY pipe never reaches EOF -- most
  // likely because the installer (or a helper/updater process it spawns)
  // keeps a handle to the console open. Since "terminated" above is the
  // ONLY thing that clears isInstalling/isUpdating, the UI was left stuck
  // on "Installing..." forever despite the install having actually
  // succeeded. Polling detect_agent directly sidesteps the problem
  // entirely: the moment the binary is actually found on disk, we know the
  // install succeeded, regardless of whether its process/console has
  // technically exited yet.
  useEffect(() => {
    if (!isInstalling && !isUpdating) return;

    const interval = setInterval(() => {
      checkAgentStatus();
      if (isUpdating) {
        checkUpdateStatus();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isInstalling, isUpdating, checkAgentStatus, checkUpdateStatus]);

  useEffect(() => {
    if (isInstalling && currentAgentStatus.installed) {
      setIsInstalling(false);
    }
  }, [isInstalling, currentAgentStatus.installed]);

  useEffect(() => {
    if (isUpdating && updateStatus && !updateStatus.update_available) {
      setIsUpdating(false);
    }
  }, [isUpdating, updateStatus]);

  // Trigger installation via PTY
  const handleInstallAgent = async () => {
    try {
      setIsInstalling(true);
      setIsInstallTerminalOpen(true); // Open console automatically to show progress logs

      const installCmd = await invoke<{ command: string; args: string[] }>("get_install_command", {
        agentId: selectedAgentId,
      });

      const appBundleDir = await invoke<string>("get_app_bundle_dir");

      await invoke("start_pty", {
        command: installCmd.command,
        args: installCmd.args,
        cwd: appBundleDir,
        rows: terminalSizeRef.current?.rows,
        cols: terminalSizeRef.current?.cols,
        sessionId: activeSessionId,
      });
    } catch (e: any) {
      setIsInstalling(false);
      console.error("Installation failed to launch:", e);
      alert(`${t("failedToInstall")}: ${e.toString()}`);
    }
  };

  // Stop the running session (if any) and wait until its exit has been
  // reported, so that exit isn't mistaken for the update's own completion.
  const handOverPty = () =>
    stopAndWaitForExit({
      isRunning: status === "running",
      stop: () => invoke("stop_pty", { sessionId: activeSessionId }),
      onStatus: (cb) => listen<SessionStatusEvent>("session-status", (e) => {
        if (isForSession(e.payload, activeSessionId)) cb(e.payload.status);
      }),
    });

  // Trigger update via PTY. This reuses the same always-visible main
  // terminal (the backend only ever runs one PTY session at a time), so no
  // separate terminal instance is needed here.
  const handleUpdateAgent = async () => {
    try {
      setIsUpdating(true);

      const updateCmd = await invoke<{ command: string; args: string[] }>("get_update_command", {
        agentId: selectedAgentId,
      });

      const appBundleDir = await invoke<string>("get_app_bundle_dir");

      await handOverPty();
      agentUpdateActiveRef.current = true;
      await invoke("start_pty", {
        command: updateCmd.command,
        args: updateCmd.args,
        cwd: appBundleDir,
        rows: terminalSizeRef.current?.rows,
        cols: terminalSizeRef.current?.cols,
        sessionId: activeSessionId,
      });
    } catch (e: any) {
      agentUpdateActiveRef.current = false;
      setIsUpdating(false);
      console.error("Update failed to launch:", e);
      alert(`${t("failedToUpdate")}: ${e.toString()}`);
    }
  };

  // Trigger agent-deck's own self-update via PTY, same reused-terminal
  // pattern as handleUpdateAgent above. self_update.py resolves its own
  // project root from its file path, so no explicit cwd is needed here --
  // start_pty falls back to the project root on its own.
  const handleUpdateSelf = async () => {
    try {
      setIsSelfUpdating(true);

      const updateCmd = await invoke<{ command: string; args: string[] }>("get_self_update_command", {
        kind: selfUpdateKind,
      });

      await handOverPty();
      selfUpdateActiveRef.current = true;
      selfUpdateStartedAtRef.current = Date.now();
      showStatusMessage(t("selfUpdateStarted"), false);
      await invoke("start_pty", {
        command: updateCmd.command,
        args: updateCmd.args,
        rows: terminalSizeRef.current?.rows,
        cols: terminalSizeRef.current?.cols,
        sessionId: activeSessionId,
      });
    } catch (e: any) {
      selfUpdateActiveRef.current = false;
      setIsSelfUpdating(false);
      showStatusMessage("", true);
      console.error("agent-deck update failed to launch:", e);
      alert(`${t("failedToUpdate")}: ${e.toString()}`);
    }
  };

  // Check Web UI server status on desktop
  const refreshWebServerStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const status = await invoke<any>("get_web_server_status");
      setWebServerStatus(status);
    } catch (e) {
      console.error("Failed to get web server status:", e);
    }
  }, []);

  const loadSslConfig = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const cfg = await invoke<any>("get_ssl_configuration");
      setSslConfig(cfg);
    } catch (e) {
      console.error("Failed to load SSL config:", e);
    }
  }, []);

  const handleSelectCertFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: t("sslSelectCert"),
        filters: [{ name: "Certificate", extensions: ["pem", "crt", "cer"] }],
      });
      if (selected && typeof selected === "string") {
        setSelectedCertPath(selected);
      }
    } catch (e) {
      console.error("Failed to select cert file:", e);
    }
  };

  const handleSelectKeyFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: t("sslSelectKey"),
        filters: [{ name: "Private Key", extensions: ["key", "pem"] }],
      });
      if (selected && typeof selected === "string") {
        setSelectedKeyPath(selected);
      }
    } catch (e) {
      console.error("Failed to select key file:", e);
    }
  };

  const handleImportSsl = async () => {
    setSslImportError(null);
    setSslImportSuccessMsg(null);
    if (!selectedCertPath || !selectedKeyPath) {
      setSslImportError("Please select both certificate and private key files.");
      return;
    }
    try {
      const updated = await invoke<any>("import_ssl_certificate", {
        certPath: selectedCertPath,
        keyPath: selectedKeyPath,
      });
      setSslConfig(updated);
      setSslImportSuccessMsg(t("sslImportSuccess"));
      setSelectedCertPath("");
      setSelectedKeyPath("");
    } catch (e: any) {
      setSslImportError(`${t("sslImportFailed")}: ${e.toString()}`);
    }
  };

  const handleResetSsl = async () => {
    try {
      const updated = await invoke<any>("reset_ssl_to_self_signed");
      setSslConfig(updated);
      setSslImportSuccessMsg(null);
      setSslImportError(null);
    } catch (e: any) {
      console.error("Failed to reset SSL config:", e);
    }
  };

  useEffect(() => {
    if (isTauri()) {
      refreshWebServerStatus();
      loadSslConfig();
    } else {
      // Connect WebSocket in browser mode
      webClient.connect(() => {
        setIsWebLoginRequired(true);
      });
      const unsubAuthOk = webClient.on("auth_ok", () => {
        setIsWebLoginRequired(false);
        setBrowserLoginError(false);
      });
      return () => {
        unsubAuthOk();
      };
    }
  }, [refreshWebServerStatus]);

  const handleStartWebServer = async () => {
    if (!webUiAvailable) return;
    if (!webUiPasswordInput.trim()) {
      alert(t("webUiPasswordRequiredAlert"));
      return;
    }
    try {
      const res = await invoke<any>("start_web_server", {
        port: Number(webUiPortInput) || 8443,
        password: webUiPasswordInput,
      });
      setWebServerStatus(res);
    } catch (e: any) {
      alert(`Failed to start Web UI server: ${e.toString()}`);
    }
  };

  const handleStopWebServer = async () => {
    try {
      await invoke("stop_web_server");
      await refreshWebServerStatus();
    } catch (e: any) {
      console.error("Failed to stop web server:", e);
    }
  };

  const handleBrowserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: browserLoginPassword }),
      });
      if (res.ok) {
        const data = await res.json();
        webClient.setToken(data.token);
        webClient.connect();
        setIsWebLoginRequired(false);
        setBrowserLoginError(false);
      } else {
        setBrowserLoginError(true);
      }
    } catch (e) {
      setBrowserLoginError(true);
    }
  };

  // Open directory selection dialog using Tauri Dialog API
  const handleSelectDirectory = async () => {
    if (!isTauri()) {
      const newPath = prompt("Enter working directory path:", cwd || "");
      if (newPath) {
        changeCwd(newPath);
      }
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: cwd || undefined,
        title: t("selectWorkingDir"),
      });

      if (selected && typeof selected === "string") {
        changeCwd(selected);
      }
    } catch (e) {
      console.error("Failed to open directory dialog:", e);
    }
  };

  const handleStartPty = () => {
    startSession();
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend(input, attachments) || status !== "running") return;
    sendMessage(composeMessage(input, attachments));
    setInput("");
    setAttachments([]);
  };

  const hasActivePrompt = activePrompt !== null;

  // ── Images (screenshots) -> a file path in the prompt (lib/imageAttach.ts) ──
  // Saved under <working folder>/tmp/screenshots/ by the Rust side; the
  // quoted path is typed into the terminal (not sent), so the user can add
  // the instruction and press Enter.
  const reportAttached = useCallback((path: string) => {
    showStatusMessage(t("imageAttached").replace("{name}", baseName(path)));
  }, [showStatusMessage, lang]);
  const reportAttachError = useCallback((e: unknown) => {
    showStatusMessage(t("imageAttachFailed").replace("{error}", String(e)), false);
  }, [showStatusMessage, lang]);
  const typeIntoTerminal = useCallback((text: string) => {
    const term = activeRuntime()?.terminal();
    if (term) term.paste(text);
    else handleTerminalInput(text);
  }, [handleTerminalInput]);
  const requireRunning = useCallback(() => {
    if (status === "running") return true;
    showStatusMessage(t("imageNeedsSession"));
    return false;
  }, [status, showStatusMessage, lang]);
  const handleTerminalImagePaste = useCallback(async (file: File) => {
    if (!requireRunning()) return;
    try {
      const path = await saveImageBlob(file, cwd);
      typeIntoTerminal(promptTextForPaths([path]));
      reportAttached(path);
    } catch (e) {
      reportAttachError(e);
    }
  }, [requireRunning, cwd, typeIntoTerminal, reportAttached, reportAttachError]);
  const handleNativeImagePaste = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return false;
    try {
      const path = await saveClipboardImage(cwd);
      if (!path) return false;
      if (!requireRunning()) return true;
      typeIntoTerminal(promptTextForPaths([path]));
      reportAttached(path);
      return true;
    } catch (e) {
      reportAttachError(e);
      return true;
    }
  }, [cwd, requireRunning, typeIntoTerminal, reportAttached, reportAttachError]);
  // Images for the next message (🖼 button, or pasted into the input bar).
  const addInputAttachments = useCallback((paths: string[], kind: AttachmentKind) => {
    setAttachments((cur) => {
      const { list, overLimit } = addAttachments(cur, paths, kind);
      if (overLimit) showStatusMessage(t("attachLimit").replace("{max}", String(MAX_ATTACHMENTS)));
      return list;
    });
  }, [showStatusMessage, lang]);
  // Paste into the input bar: an image becomes an attachment chip.
  const handleInputPaste = useCallback(async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const file = pickImageFile(e.clipboardData?.items);
    if (!file || !isTauri()) return;
    e.preventDefault();
    try {
      const path = await saveImageBlob(file, cwd);
      addInputAttachments([path], "pasted");
    } catch (err) {
      reportAttachError(err);
    }
  }, [cwd, addInputAttachments, reportAttachError]);
  // Files dropped on the window: their paths are typed into the terminal
  // (any file type -- the CLIs read files by path; images aren't copied).
  const dropHandlerRef = useRef<(paths: string[]) => void>(() => {});
  dropHandlerRef.current = (paths: string[]) => {
    if (!paths.length || !requireRunning()) return;
    typeIntoTerminal(promptTextForPaths(paths));
    showStatusMessage(t("filesAttached").replace("{count}", String(paths.length)));
  };
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") dropHandlerRef.current(event.payload.paths);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ── Tab operations ──
  const switchToTab = useCallback((id: string) => {
    const tab = tabs.find((tb) => tb.id === id);
    if (!tab) return;
    // Not an engine *change* for the engine-change auto-start effect.
    previousAgentIdRef.current = tab.engineId;
    setSelectedAgentId(tab.engineId);
    setActiveSessionId(id);
  }, [tabs]);

  // The engine picked in the header belongs to the active tab.
  useEffect(() => {
    setTabs((prev) => prev.map((tb) => (tb.id === activeSessionId && tb.engineId !== selectedAgentId ? { ...tb, engineId: selectedAgentId } : tb)));
  }, [selectedAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // "New tab" opens a dialog: agent (default: the one in use) + folder.
  const [isNewTabOpen, setIsNewTabOpen] = useState(false);
  const handleNewTab = useCallback(async () => {
    if (!isTauri()) return;
    if (!canAddTab(tabs)) {
      showStatusMessage(t("tabLimit").replace("{max}", String(MAX_TABS)));
      return;
    }
    setIsNewTabOpen(true);
  }, [tabs, showStatusMessage, lang]);

  const pickNewTabFolder = useCallback(async (): Promise<string | null> => {
    try {
      const picked = await open({ directory: true, multiple: false, title: t("newTabPickFolder") });
      return typeof picked === "string" ? picked : null;
    } catch (e) {
      console.error("Failed to open directory dialog:", e);
      return null;
    }
  }, [lang]);

  // Returns an error to show in the dialog, or null once the tab exists.
  const createTab = useCallback(async (dir: string, engineId: string): Promise<string | null> => {
    if (!canAddTab(tabs)) return t("tabLimit").replace("{max}", String(MAX_TABS));
    const { folder, error } = await resolveFolderFor(dir);
    if (error) return error;
    const id = newSessionId(tabs.map((tb) => tb.id));
    setTabs((prev) => addTab(prev, { id, name: "", cwd: folder, engineId }));
    setStartOnMountIds((prev) => new Set(prev).add(id));
    // Not an engine *change* (no auto-start effect): the new tab starts itself.
    previousAgentIdRef.current = engineId;
    setSelectedAgentId(engineId);
    setActiveSessionId(id);
    setIsNewTabOpen(false);
    return null;
  }, [tabs, resolveFolderFor, lang]);

  const handleCloseTab = useCallback(async (id: string = activeSessionId) => {
    if (tabs.length <= 1) {
      showStatusMessage(t("lastTabCantClose"));
      return;
    }
    const tab = tabs.find((tb) => tb.id === id);
    if (!tab) return;
    if (runtimeStates[id]?.status === "running") {
      const ok = await ask(t("closeTabConfirm").replace("{tab}", tabLabel(tab, t("appLocationShort"))), {
        title: "agent-deck", kind: "warning", okLabel: t("closeTabOk"), cancelLabel: t("cancel"),
      });
      if (!ok) return;
    }
    await invoke("close_pty_session", { sessionId: id }).catch(() => {});
    const next = nextActiveAfterClose(tabs, id, activeSessionId);
    if (next && next !== activeSessionId) switchToTab(next);
    setTabs((prev) => removeTab(prev, id));
    setRuntimeStates((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    delete lastOutputAtRef.current[id];
  }, [tabs, activeSessionId, runtimeStates, switchToTab, showStatusMessage, lang]);

  // Shortcuts: New Tab / Close Tab come from the File menu (CmdOrCtrl+T/W);
  // Ctrl+Tab / Ctrl+Shift+Tab / CmdOrCtrl+1..9 are handled here, before
  // the terminal sees them.
  const tabActionsRef = useRef({ handleNewTab, handleCloseTab, switchToTab, tabs, activeSessionId });
  tabActionsRef.current = { handleNewTab, handleCloseTab, switchToTab, tabs, activeSessionId };
  useEffect(() => {
    if (!isTauri()) return;
    const offNew = subscribeToTauriEvent(listen("menu-new-tab", () => void tabActionsRef.current.handleNewTab()));
    const offClose = subscribeToTauriEvent(listen("menu-close-tab", () => void tabActionsRef.current.handleCloseTab()));
    const onKey = (e: KeyboardEvent) => {
      const { tabs: list, activeSessionId: cur, switchToTab: go } = tabActionsRef.current;
      const target = tabShortcutTarget(e, list.map((tb) => tb.id), cur);
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        go(target);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      offNew();
      offClose();
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // Which tabs are working (output in the last few seconds), for the lights.
  const lastOutputAtRef = useRef<Record<string, number>>({});
  const [workingIds, setWorkingIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!isTauri()) return;
    const off = subscribeToTauriEvent(listen<SessionOutputEvent>("session-output", (e) => {
      lastOutputAtRef.current[e.payload.session_id] = Date.now();
    }));
    const timer = setInterval(() => {
      const next = workingSessions(lastOutputAtRef.current, Date.now());
      setWorkingIds((prev) => (sameSet(prev, next) ? prev : next));
    }, 1000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  // The engine install screen shows the active tab's install output.
  useEffect(() => {
    if (!isTauri() || !isInstallTerminalOpen) return;
    const off = subscribeToTauriEvent(listen<SessionOutputEvent>("session-output", (e) => {
      if (isForSession(e.payload, activeSessionId)) handleRawOutput(new Uint8Array(e.payload.data));
    }));
    return off;
  }, [isInstallTerminalOpen, activeSessionId, handleRawOutput]);

  const showCheckingPanel = !agentStatusChecked ||
    !!(appConfig && pickEngine(appConfig.engines.map(e => e.id), agentStatuses, selectedAgentId) !== selectedAgentId);
  const showOnboardingPanel = !showCheckingPanel && !currentAgentStatus.installed;
  const showMainView = !showCheckingPanel && !showOnboardingPanel;

  return (
    <div className="app-shell">
    {showMainView && (
      <TabSidebar
        lang={lang}
        tabs={tabs}
        activeId={activeSessionId}
        states={runtimeStates}
        engineNames={Object.fromEntries((appConfig?.engines ?? []).map((e) => [e.id, e.name]))}
        workingIds={workingIds}
        onSelect={switchToTab}
        onNew={() => void handleNewTab()}
        onClose={(id) => void handleCloseTab(id)}
        onRename={(id, name) => setTabs((prev) => renameTab(prev, id, name))}
        footer={isTauri() ? (<>
                <button
                  className="secondary header-btn"
                  onClick={() => setIsCatalogOpen(true)}
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                  title={lang === "ja" ? "スキルカタログ" : "Skill Catalog"}
                >
                  📚 {lang === "ja" ? "スキル" : "Skills"}
                </button>
                <button
                  className="secondary header-btn"
                  onClick={() => {
                    refreshWebServerStatus();
                    setIsWebUiModalOpen(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: webServerStatus.running ? "rgba(16, 185, 129, 0.15)" : undefined,
                    borderColor: webServerStatus.running ? "#10b981" : undefined,
                    color: webServerStatus.running ? "#10b981" : undefined,
                  }}
                  title="Web UI Remote Access"
                >
                  🌐 Web UI {webServerStatus.running ? "● ON" : ""}
                </button>
</>) : undefined}
      />
    )}
    {isNewTabOpen && (
      <NewTabDialog
        lang={lang}
        engines={(appConfig?.engines ?? []).filter((e) => agentStatuses[e.id]?.installed).map((e) => ({ id: e.id, name: e.name }))}
        defaultEngineId={selectedAgentId}
        pickFolder={pickNewTabFolder}
        onCreate={createTab}
        onCancel={() => setIsNewTabOpen(false)}
      />
    )}
    <div className="app-container">
      {/* Header and Connection Panel */}
      <header className="app-header">
        <div className="controls-group">
          {currentAgentStatus.installed && (
            <>
              {/* Agent Select Dropdown */}
              {/* Never shrinks: the engine name ("Claude Code") must stay
                  fully visible -- the working-folder chip is the one that
                  gives up width (ellipsized) when the header is tight. */}
              <div className="cwd-display agent-type-display" title={selectedEngine?.name}>
                <span className="cwd-label">{t("agentLabel")}:</span>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  disabled={status === "running" || isStarting}
                  className="agent-select-dropdown"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    fontWeight: "600",
                    cursor: status === "running" || isStarting ? "not-allowed" : "pointer",
                    outline: "none",
                    paddingRight: "4px"
                  }}
                >
                  {Object.entries(agentStatuses)
                    .filter(([_, info]) => info.installed)
                    .map(([id]) => (
                      <option key={id} value={id} style={{ background: "var(--input-bg)", color: "var(--text-color)" }}>
                        {appConfig?.engines.find(e => e.id === id)?.name || id}
                      </option>
                    ))}
                </select>
              </div>

              {/* Working folder: the chip itself opens the folder picker
                  (no separate "Change Dir" button); ▼ keeps the recent list. */}
              <div className="cwd-display-container">
                <button
                  type="button"
                  className="cwd-display cwd-button"
                  onClick={handleSelectDirectory}
                  disabled={status === "running"}
                  title={`${cwd || t("appLocationDefault")}\n${t("clickToChangeFolder")}`}
                >
                  <span className="cwd-label">{t("workingFolder")}:</span>
                  <span className="cwd-path">{cwd || t("appLocationDefault")}</span>
                </button>
                
                {recentCwds.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <button
                      className="secondary"
                      onClick={() => setIsRecentOpen(!isRecentOpen)}
                      style={{ padding: "2px 6px", fontSize: "0.7rem", display: "flex", alignItems: "center", justifyContent: "center" }}
                      disabled={status === "running"}
                    >
                      ▼
                    </button>
                    {isRecentOpen && (
                      <div className="recent-cwds-dropdown" style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        background: "var(--input-bg)",
                        border: "1px solid var(--input-border)",
                        borderRadius: "6px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        zIndex: 1000,
                        minWidth: "250px",
                        marginTop: "4px",
                        padding: "4px 0"
                      }}>
                        <div style={{ padding: "6px 12px", fontSize: "0.75rem", color: "#94a3b8", borderBottom: "1px solid var(--input-border)" }}>
                          {t("recentCwds")}
                        </div>
                        {recentCwds.map((path) => (
                          <button
                            key={path}
                            onClick={() => {
                              changeCwd(path);
                              setIsRecentOpen(false);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "8px 12px",
                              background: "none",
                              border: "none",
                              color: "var(--text-color)",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                          >
                            {path}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SKILL.md Actions */}
              {skillContent && (
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="secondary"
                    onClick={() => setIsPreviewOpen(true)}
                    style={{ background: "rgba(16, 185, 129, 0.1)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.2)" }}
                  >
                    {t("previewSkill")}
                  </button>
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (skillPath) {
                        try {
                          await invoke("open_file_in_editor", { path: skillPath });
                        } catch (e) {
                          console.error("Failed to open file in editor:", e);
                        }
                      }
                    }}
                  >
                    {t("editSkill")}
                  </button>
                </div>
              )}

              <div className={`status-badge ${status}`}>
                {status}
              </div>

              {status === "running" ? (
                <button className="danger header-btn" onClick={stopSession}>
                  {t("stop")}
                </button>
              ) : (
                <button className="primary header-btn" onClick={handleStartPty} disabled={isStarting}>
                  {t("startSession")}
                </button>
              )}


            </>
          )}
        </div>
      </header>

      {/* Update Alert Notification Banner */}
      {updateStatus.update_available && currentAgentStatus.installed && (
        <div className="update-banner" style={{
          background: "rgba(245, 158, 11, 0.15)",
          borderBottom: "1px solid rgba(245, 158, 11, 0.25)",
          padding: "10px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.85rem",
          color: "#f59e0b",
          backdropFilter: "blur(8px)"
        }}>
          <div>
            {t("updateAvailableMsg")
              .replace("{name}", selectedEngine?.name || selectedAgentId)
              .replace("{latest}", updateStatus.latest_version || "")
              .replace("{current}", updateStatus.current_version || "")}
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", marginLeft: "12px" }}>
              {t("updateNote")}
            </span>
          </div>
          <button
            className="primary"
            onClick={handleUpdateAgent}
            disabled={isUpdating}
            style={{
              background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
              border: "none",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "6px",
              fontWeight: "600",
              cursor: "pointer",
              fontSize: "0.8rem"
            }}
          >
            {isUpdating ? t("updating") : t("updateNow")}
          </button>
        </div>
      )}

      {/* agent-deck Self-Update Alert Banner (distinct color from the agy
          banner above so the two are never mistaken for each other) */}
      {isUpdateBannerVisible(selfUpdateStatus, dismissedSelfUpdateVersion) && (
        <div className="update-banner" style={{
          background: "rgba(59, 130, 246, 0.15)",
          borderBottom: "1px solid rgba(59, 130, 246, 0.25)",
          padding: "10px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.85rem",
          color: "#3b82f6",
          backdropFilter: "blur(8px)"
        }}>
          <div>
            {t("selfUpdateAvailableMsg").replace("{latest}", selfUpdateStatus.latest_version || "").replace("{current}", selfUpdateStatus.current_version || "")}
            {isTestKind(selfUpdateKind) && (
              <span style={{ fontSize: "0.75rem", color: "#94a3b8", marginLeft: "12px" }}>
                {t("selfUpdateTestChannelNote")}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <button
            className="primary"
            onClick={handleUpdateSelf}
            disabled={isSelfUpdating}
            style={{
              background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              border: "none",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "6px",
              fontWeight: "600",
              cursor: "pointer",
              fontSize: "0.8rem"
            }}
          >
            {isSelfUpdating ? t("updating") : t("updateNow")}
          </button>
          {!isSelfUpdating && (
            <button
              className="update-later"
              onClick={() => setDismissedSelfUpdateVersion(selfUpdateStatus.latest_version)}
              style={{
                background: "transparent",
                border: "1px solid rgba(59, 130, 246, 0.4)",
                color: "#3b82f6",
                padding: "6px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.8rem",
                marginLeft: "8px",
              }}
            >
              {t("updateLater")}
            </button>
          )}
          </div>
        </div>
      )}

      {/* Session status banner (former system messages: session start, skill
          rebuild progress, stop, errors). Always rendered at the same size
          (padding/border/margin never change, only color/content do) so
          it appearing or disappearing can never resize the terminal below
          it - that used to cause a real PTY resize a few seconds into a
          session, which could race with agy's own async UI updates (e.g.
          its account-quota badge) and leave the screen looking corrupted. */}
      <div style={{
        background: statusMessage ? "rgba(59, 130, 246, 0.1)" : "transparent",
        border: statusMessage ? "1px solid rgba(59, 130, 246, 0.2)" : "1px solid transparent",
        borderRadius: "8px",
        padding: "8px 16px",
        marginBottom: "12px",
        fontSize: "0.8rem",
        color: "#475569",
        whiteSpace: "pre-wrap",
        minHeight: "1.2em",
      }}>
        {statusMessage || " "}
      </div>

      {/* Main Body Layout (sidebar removed - agent info lives in the header now,
          and "check updates on startup" moved to the native app menu, so the
          main panel can use the full width) */}
      <div className="app-body-layout">
        {/* Main Panel View (live terminal OR Onboarding installer) */}
        {showCheckingPanel && (
          /* First detection still running, or the selection is about to move
             to an installed engine: don't claim anything is missing yet */
          <div className="onboarding-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
            <p className="onboarding-desc">{t("checkingAgents")}</p>
          </div>
        )}
        {showOnboardingPanel && (
          /* Onboarding Panel */
          <div className="onboarding-panel" style={{ display: "flex", flexDirection: isInstallTerminalOpen ? "row" : "column", gap: "24px", width: "100%" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div className="onboarding-icon">
                {selectedAgentId === "claude" ? "🤖" : "🌌"}
              </div>
              <h2 className="onboarding-title">
                {t("installAgentRequired").replace("{name}", selectedEngine?.name || selectedAgentId)}
              </h2>
              <p className="onboarding-desc">
                {t("installAgentDesc").replace("{name}", selectedEngine?.name || selectedAgentId)}
              </p>

              {isInstalling ? (
                <button className="primary" disabled style={{ background: "#64748b" }}>
                  {t("installingAgent")}
                </button>
              ) : (
                <button className="primary" onClick={handleInstallAgent} style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", fontSize: "1.1rem", padding: "12px 24px" }}>
                  {t("installButton").replace("{name}", selectedEngine?.name || selectedAgentId)}
                </button>
              )}
            </div>

            {/* Embedded Live Console for Installer Logs */}
            {isInstallTerminalOpen && (
              <div className="terminal-panel" style={{ flex: 1, minHeight: "350px", height: "100%" }}>
                <div className="terminal-header">
                  <span>{t("installLogs")}</span>
                  <span style={{ color: "#ef4444" }}>{t("running").toUpperCase()}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                  <TerminalView
                    terminalRef={terminalRef}
                    onData={handleTerminalInput}
                    onResize={handleTerminalResize}
                    theme={themes[currentThemeId].terminal}
                    fontFamily={terminalFont.family}
                    fontSize={terminalFont.size}
                    onImagePaste={handleTerminalImagePaste}
                    onNativeImagePaste={handleNativeImagePaste}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {/* Live sessions: always mounted (hidden while the panels above
            show) so every tab's terminal keeps its output (5.7.4). */}
          <div className="main-view-layout" style={{ flex: 1, display: showMainView ? undefined : "none" }}>
            <div className="chat-panel">
              <div className="terminal-panel" style={{ flex: 1 }}>
                <div className="terminal-header">
                  <span>{isUpdating || isSelfUpdating ? t("updateLogs") : ""}</span>
                  <span style={{ color: status === "running" ? "#4caf50" : "#94a3b8" }}>
                    {status.toUpperCase()}
                  </span>
                </div>
                <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
                  {tabs.map((tab) => {
                    const engine = appConfig?.engines.find((e) => e.id === tab.engineId);
                    return (
                      <SessionRuntime
                        key={tab.id}
                        sessionId={tab.id}
                        active={tab.id === activeSessionId}
                        initialCwd={tab.cwd}
                        command={agentStatuses[tab.engineId]?.path ?? ""}
                        args={engine?.args ?? []}
                        preLaunchCommand={appConfig?.pre_launch_command ?? undefined}
                        preLaunchArgs={appConfig?.pre_launch_args}
                        preLaunchRequired={appConfig?.pre_launch_required}
                        theme={themes[currentThemeId].terminal}
                        fontFamily={terminalFont.family}
                        fontSize={terminalFont.size}
                        startOnMount={startOnMountIds.has(tab.id)}
                        onState={handleRuntimeState}
                        register={registerRuntime}
                        onResize={handleTerminalResize}
                        onImagePaste={handleTerminalImagePaste}
                        onNativeImagePaste={handleNativeImagePaste}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Structured, clickable UI for interactive prompts (folder
                  trust, tool permission, login link) so novice users don't
                  have to navigate agy's own arrow-key prompts by hand. */}
              {activePrompt && (
                <div style={{
                  marginTop: "12px",
                  padding: "12px",
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px"
                }}>
                  <div style={{ fontSize: "0.85rem", color: "#475569", fontWeight: "600" }}>
                    {activePrompt.message}
                  </div>

                  {activePrompt.prompt_type === "confirm" && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {activePrompt.options ? (
                        activePrompt.options.map((opt: string, idx: number) => (
                          <button
                            key={opt}
                            className={/^(\d+\.\s*)?no\b/i.test(opt) || opt.toLowerCase().includes("exit") ? "secondary" : "primary"}
                            onClick={() => respondToPrompt(opt, activePrompt.inputs?.[idx])}
                            style={{ padding: "6px 16px" }}
                          >
                            {opt}
                          </button>
                        ))
                      ) : (
                        <>
                          <button
                            className="primary"
                            onClick={() => respondToPrompt("y")}
                            style={{ padding: "6px 16px" }}
                          >
                            {t("yes")}
                          </button>
                          <button
                            className="secondary"
                            onClick={() => respondToPrompt("n")}
                            style={{ padding: "6px 16px" }}
                          >
                            {t("no")}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {activePrompt.prompt_type === "path" && (
                    <div>
                      <button
                        className="primary"
                        onClick={async () => {
                          const selected = await open({
                            directory: true,
                            multiple: false,
                            title: t("selectPromptPath"),
                          });
                          if (selected && typeof selected === "string") {
                            respondToPrompt(selected);
                          }
                        }}
                        style={{ padding: "6px 16px" }}
                      >
                        {t("selectFolder")}
                      </button>
                    </div>
                  )}

                  {activePrompt.prompt_type === "login" && activePrompt.url && (
                    <div>
                      <a
                        href={activePrompt.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "8px 16px",
                          background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                          color: "#fff",
                          textDecoration: "none",
                          borderRadius: "8px",
                          fontWeight: "600",
                          fontSize: "0.9rem",
                          boxShadow: "0 2px 8px rgba(16, 185, 129, 0.4)"
                        }}
                      >
                        {t("openLoginBrowser")}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Form Input Bar */}
              <form onSubmit={handleSend} className="input-form">
                <AttachmentChips lang={lang} attachments={attachments} disabled={status !== "running"}
                  onRemove={(path) => setAttachments((cur) => removeAttachment(cur, path))} />
                <input
                  className="input-field"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handleInputPaste}
                  placeholder={
                    status !== "running"
                      ? t("placeholderStartSession")
                      : hasActivePrompt
                      ? t("placeholderRespondPrompt")
                      : t("placeholderSendInput")
                  }
                  disabled={status !== "running" || hasActivePrompt}
                />
                {isTauri() && (
                  <ImageAttachButton lang={lang} cwd={cwd} disabled={status !== "running" || hasActivePrompt}
                    onAdd={addInputAttachments}
                    onError={(msg) => showStatusMessage(msg)} />
                )}
                <button
                  type="submit"
                  className="primary"
                  disabled={status !== "running" || !canSend(input, attachments)}
                >
                  {t("send")}
                </button>
              </form>
            </div>
          </div>

        {/* SKILL.md Preview Modal */}
        {isPreviewOpen && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            backdropFilter: "blur(4px)"
          }}>
            <div style={{
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
              borderRadius: "12px",
              width: "80%",
              maxWidth: "800px",
              maxHeight: "80%",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 25px rgba(0,0,0,0.3)"
            }}>
              <div style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--input-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <h3 style={{ margin: 0, color: "var(--text-color)" }}>{t("skillFile")}</h3>
                <button
                  className="secondary"
                  onClick={() => setIsPreviewOpen(false)}
                  style={{ padding: "6px 12px" }}
                >
                  {t("close")}
                </button>
              </div>
              <div style={{
                padding: "20px",
                overflowY: "auto",
                flex: 1,
                color: "var(--text-color)",
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: "0.9rem"
              }}>
                {skillContent}
              </div>
            </div>
          </div>
        )}

        {/* Web UI Management Modal (Desktop) */}
        {isCatalogOpen && isTauri() && (
          <SkillCatalogPanel lang={lang} onClose={() => setIsCatalogOpen(false)} onBusyChange={setCatalogBusy}
            onAskAgent={(prompt) => {
              // "Create/Improve with AI": hand it to the running agent (my-skills skill).
              if (status !== "running") return false;
              sendMessage(prompt);
              return true;
            }} />
        )}

        {isWebUiModalOpen && isTauri() && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            backdropFilter: "blur(4px)"
          }}>
            <div style={{
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
              borderRadius: "12px",
              width: "90%",
              maxWidth: "520px",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
              padding: "24px"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, color: "var(--text-color)", display: "flex", alignItems: "center", gap: "8px" }}>
                  🌐 {t("webUiTitle")}
                </h3>
                <button
                  className="secondary"
                  onClick={() => setIsWebUiModalOpen(false)}
                  style={{ padding: "4px 10px" }}
                >
                  {t("close")}
                </button>
              </div>

              <>
                {!webUiAvailable && (
                  <div role="status" className="webui-unavailable" style={{
                    padding: "12px 16px", borderRadius: "8px", marginBottom: "16px",
                    background: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.45)",
                    color: "var(--text-color)", fontSize: "0.85rem", lineHeight: 1.6,
                  }}>
                    <strong>🚧 {t("webUiUnavailableTitle")}</strong>
                    <div>{t("webUiUnavailableBody")}</div>
                  </div>
                )}
                <fieldset disabled={!webUiAvailable} aria-disabled={!webUiAvailable} style={{
                  border: "none", padding: 0, margin: 0, minWidth: 0,
                  opacity: webUiAvailable ? 1 : 0.45, pointerEvents: webUiAvailable ? undefined : "none",
                }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: webServerStatus.running ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                  border: `1px solid ${webServerStatus.running ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                  color: webServerStatus.running ? "#10b981" : "#ef4444",
                  fontWeight: "600",
                  fontSize: "0.9rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <span>状態: {webServerStatus.running ? t("webUiStatusRunning") : t("webUiStatusStopped")}</span>
                  {webServerStatus.running ? (
                    <button className="danger" onClick={handleStopWebServer} style={{ padding: "6px 14px", fontSize: "0.85rem" }}>
                      {t("webUiStop")}
                    </button>
                  ) : (
                    <button className="primary" onClick={handleStartWebServer} style={{ padding: "6px 14px", fontSize: "0.85rem" }}>
                      {t("webUiStart")}
                    </button>
                  )}
                </div>

                {!webServerStatus.running && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-color)", fontWeight: "500" }}>
                        {t("webUiPassword")}
                      </label>
                      <input
                        type="password"
                        value={webUiPasswordInput}
                        onChange={(e) => setWebUiPasswordInput(e.target.value)}
                        placeholder={t("webUiPasswordPlaceholder")}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid var(--input-border)",
                          background: "var(--main-bg)",
                          color: "var(--text-color)",
                          outline: "none"
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-color)", fontWeight: "500" }}>
                        {t("webUiPort")}
                      </label>
                      <input
                        type="number"
                        value={webUiPortInput}
                        onChange={(e) => setWebUiPortInput(Number(e.target.value))}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid var(--input-border)",
                          background: "var(--main-bg)",
                          color: "var(--text-color)",
                          outline: "none"
                        }}
                      />
                    </div>

                    {/* Custom SSL Certificate Settings */}
                    <div style={{
                      marginTop: "8px",
                      padding: "14px",
                      borderRadius: "8px",
                      border: "1px solid var(--input-border)",
                      background: "rgba(0,0,0,0.15)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--text-color)" }}>
                          🔒 SSL証明書: {sslConfig.use_custom_ssl ? t("sslModeCustom") : t("sslModeSelfSigned")}
                        </span>
                        {sslConfig.use_custom_ssl && (
                          <button
                            className="secondary"
                            onClick={handleResetSsl}
                            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          >
                            {t("sslResetToSelfSigned")}
                          </button>
                        )}
                      </div>

                      {sslImportSuccessMsg && (
                        <div style={{ padding: "8px 10px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontSize: "0.8rem" }}>
                          ✓ {sslImportSuccessMsg}
                        </div>
                      )}

                      {sslImportError && (
                        <div style={{ padding: "8px 10px", borderRadius: "6px", background: "rgba(239, 68, 68, 0.15)", color: "#ef4444", fontSize: "0.8rem" }}>
                          ⚠️ {sslImportError}
                        </div>
                      )}

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <button className="secondary" onClick={handleSelectCertFile} style={{ padding: "6px 10px", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                            {t("sslSelectCert")}
                          </button>
                          <span style={{ fontSize: "0.75rem", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {selectedCertPath || (sslConfig.custom_cert_filename ? `config/${sslConfig.custom_cert_filename}` : "(未選択)")}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <button className="secondary" onClick={handleSelectKeyFile} style={{ padding: "6px 10px", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                            {t("sslSelectKey")}
                          </button>
                          <span style={{ fontSize: "0.75rem", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {selectedKeyPath || (sslConfig.custom_key_filename ? `config/${sslConfig.custom_key_filename}` : "(未選択)")}
                          </span>
                        </div>

                        {selectedCertPath && selectedKeyPath && (
                          <button
                            className="primary"
                            onClick={handleImportSsl}
                            style={{ marginTop: "4px", padding: "6px 12px", fontSize: "0.8rem" }}
                          >
                            {t("sslImportButton")}
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {webServerStatus.running && webServerStatus.url && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "4px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{t("webUiUrl")}</span>
                      <a
                        href={webServerStatus.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "#38bdf8",
                          wordBreak: "break-all",
                          fontSize: "0.95rem",
                          fontWeight: "600",
                          textDecoration: "underline"
                        }}
                      >
                        {webServerStatus.url}
                      </a>
                    </div>

                    {webServerStatus.qr_code_base64 && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                        <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{t("webUiQrCode")}</span>
                        <div style={{
                          padding: "12px",
                          background: "#ffffff",
                          borderRadius: "8px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                        }}>
                          <img
                            src={webServerStatus.qr_code_base64}
                            alt="Web UI QR Code"
                            style={{ width: "160px", height: "160px", display: "block" }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
                </fieldset>
              </>
            </div>
          </div>
        )}

        {/* Browser Remote Login Modal (Non-Tauri environment) */}
        {isWebLoginRequired && !isTauri() && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3000,
            backdropFilter: "blur(6px)"
          }}>
            <form onSubmit={handleBrowserLogin} style={{
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
              borderRadius: "12px",
              width: "90%",
              maxWidth: "400px",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
            }}>
              <h3 style={{ margin: 0, color: "var(--text-color)" }}>{t("webUiLoginTitle")}</h3>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8" }}>
                {t("webUiLoginDesc")}
              </p>

              {browserLoginError && (
                <div style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#ef4444",
                  fontSize: "0.85rem"
                }}>
                  {t("webUiLoginFailed")}
                </div>
              )}

              <input
                type="password"
                value={browserLoginPassword}
                onChange={(e) => setBrowserLoginPassword(e.target.value)}
                placeholder={t("webUiPasswordPlaceholder")}
                autoFocus
                style={{
                  padding: "10px 14px",
                  borderRadius: "6px",
                  border: "1px solid var(--input-border)",
                  background: "var(--main-bg)",
                  color: "var(--text-color)",
                  outline: "none",
                  fontSize: "1rem"
                }}
              />

              <button type="submit" className="primary" style={{ padding: "10px", fontSize: "0.95rem" }}>
                {t("webUiLoginButton")}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

export default App;
