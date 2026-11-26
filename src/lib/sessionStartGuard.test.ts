// Wiring checks for the "one session start at a time" guard (see
// lib/singleFlight.ts for the incident). The guard's logic is unit-tested in
// singleFlight.test.ts; these make sure it stays connected to the hook and
// to the controls that can trigger a second start, since a refactor that
// drops the wiring would otherwise only show up as a Windows-only failure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("session start guard wiring", () => {
  const hook = src("hooks/useChatSession.ts");
  const app = src("App.tsx");

  it("startSession goes through the single-flight guard", () => {
    expect(hook).toMatch(/const startSession = useCallback\([\s\S]*?flight\.running[\s\S]*?flight\.run\(\(\) => startSessionOnce\(/);
    expect(hook).toMatch(/setIsStarting\(true\)[\s\S]*?finally \{\s*setIsStarting\(false\)/);
  });

  it("the hook exposes isStarting and App consumes it", () => {
    expect(hook).toMatch(/return \{[\s\S]*?\bisStarting,/);
    // per tab: SessionRuntime reports it, App reads the active tab's
    const rt = readFileSync(join(__dirname, "..", "components", "SessionRuntime.tsx"), "utf8");
    expect(rt).toContain("isStarting: chat.isStarting");
    expect(app).toMatch(/const \{ cwd, status, isStarting, activePrompt, statusMessage \} = activeState;/);
  });

  it("the Start button is disabled while a start is in progress", () => {
    expect(app).toMatch(/onClick=\{handleStartPty\} disabled=\{isStarting\}/);
  });

  it("the engine selector is disabled while a start is in progress", () => {
    expect(app).toMatch(/disabled=\{status === "running" \|\| isStarting\}\s*className="agent-select-dropdown"/);
  });

  it("App only reaches the unguarded start through startSession", () => {
    // (App's own start_pty calls are the install/update runners, which hand
    // over the PTY themselves -- not session starts.)
    expect(app).not.toMatch(/startSessionOnce/);
  });
});

describe("periodic update check wiring", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");

  it("the poller remembers the last check across restarts (once a day)", () => {
    expect(app).toMatch(/store: lastCheckStore,/);
  });

  it("App starts the poller, gated on the auto-check setting", () => {
    expect(app).toMatch(/if \(!isTauri\(\) \|\| !autoCheckUpdate\) return;\s*return startUpdatePolling\(/);
  });

  it("the background check asks self_update for a non-interactive check", () => {
    expect(app).toMatch(/invoke<UpdateStatus>\("check_self_update", \{ kind, background: true \}\)/);
    expect(app).toMatch(/invoke<[^>]*>\("default_self_update_kind"\)/);
    expect(app).toMatch(/if \(kind === "none"\) return;/);
    expect(app).toMatch(/shouldApplyBackgroundResult\(shown\.status, shown\.kind, res, kind\)/);
  });

  it("the background check never starts an update by itself", () => {
    const start = app.indexOf("return startUpdatePolling(");
    const poll = app.slice(start, app.indexOf("}, [autoCheckUpdate]);", start));
    expect(start).toBeGreaterThan(0);
    expect(poll).not.toMatch(/handleUpdateSelf|get_self_update_command|start_pty/);
    expect(poll).toMatch(/shouldApplyBackgroundResult\(/);
  });

  it("the banner uses the Later-aware visibility and has both buttons", () => {
    expect(app).toMatch(/isUpdateBannerVisible\(selfUpdateStatus, dismissedSelfUpdateVersion\)/);
    expect(app).toMatch(/onClick=\{handleUpdateSelf\}/);
    expect(app).toMatch(/setDismissedSelfUpdateVersion\(selfUpdateStatus\.latest_version\)/);
  });

  it("an explicit menu check clears a previous Later", () => {
    expect(app).toMatch(/setDismissedSelfUpdateVersion\(null\);\s*checkSelfUpdateStatus\(kind\)/);
  });
});

describe("quit guard wiring", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");

  it("reports session start, self-update, engine update and install as busy", () => {
    expect(app).toMatch(/const anyTabStarting = Object\.values\(runtimeStates\)\.some\(\(s\) => s\.isStarting\);/);
    expect(app).toMatch(/const quitGuardBusy = anyTabStarting \|\| isSelfUpdating \|\| isUpdating \|\| isInstalling \|\| catalogBusy;/);
    expect(app).toMatch(/invoke\("set_quit_guard_busy", \{ busy: quitGuardBusy \}\)/);
  });
});

describe("language wiring", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
  const hook = readFileSync(join(__dirname, "..", "hooks", "useChatSession.ts"), "utf8");

  it("App resolves the language from the choice, OS locales and navigator", () => {
    expect(app).toMatch(/resolveLang\(langChoice, osLocales, navigator\.language\)/);
    expect(app).toMatch(/invoke<string\[\]>\("get_os_locales"\)/);
    expect(app).toMatch(/setCurrentLang\(lang\)/);
  });

  it("the View -> Language menu is wired both ways", () => {
    expect(app).toMatch(/listen<string>\("language-menu"/);
    expect(app).toMatch(/invoke\("set_language_menu_state", \{ choice: langChoice \}\)/);
  });

  it("nothing decides the language from navigator.language alone any more", () => {
    expect(app).not.toMatch(/navigator\.language\.startsWith/);
    expect(hook).not.toMatch(/navigator\.language/);
    expect(hook).toMatch(/getLang\(\) === "ja"/);
  });
});

describe("terminal contrast wiring", () => {
  const tv = readFileSync(join(__dirname, "..", "components", "TerminalView.tsx"), "utf8");
  it("TerminalView uses the shared MIN_CONTRAST_RATIO", () => {
    expect(tv).toMatch(/minimumContrastRatio: MIN_CONTRAST_RATIO/);
  });
});

describe("image attach wiring", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
  const tv = readFileSync(join(__dirname, "..", "components", "TerminalView.tsx"), "utf8");

  it("both TerminalViews get the image paste handlers", () => {
    expect(app.match(/onImagePaste=\{handleTerminalImagePaste\}/g)?.length).toBe(2);
    expect(app.match(/onNativeImagePaste=\{handleNativeImagePaste\}/g)?.length).toBe(2);
  });

  it("the input bar handles image paste, and window drops are wired", () => {
    expect(app).toMatch(/onPaste=\{handleInputPaste\}/);
    expect(app).toMatch(/getCurrentWebview\(\)\s*\.onDragDropEvent\(/);
  });

  it("paths are typed, never sent (no Enter appended)", () => {
    const block = app.slice(app.indexOf("── Images (screenshots)"), app.indexOf("getCurrentWebview()"));
    expect(block).not.toMatch(/\\r|sendMessage\(/);
    expect(block).toMatch(/promptTextForPaths\(/);
  });

  it("TerminalView: manual paste key + capture-phase paste listener, removed on cleanup", () => {
    expect(tv).toMatch(/if \(isManualPasteKey\(event, IS_MAC\)\)/);
    expect(tv).toMatch(/addEventListener\("paste", onPasteEvent, true\)/);
    expect(tv).toMatch(/removeEventListener\("paste", onPasteEvent, true\)/);
    expect(tv).toMatch(/term\.paste\(text\)/);
  });
});

describe("skill catalog wiring", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
  it("header button opens the panel; the panel reports busy to the quit guard", () => {
    expect(app).toMatch(/onClick=\{\(\) => setIsCatalogOpen\(true\)\}/);
    expect(app).toMatch(/<SkillCatalogPanel lang=\{lang\} onClose=\{\(\) => setIsCatalogOpen\(false\)\} onBusyChange=\{setCatalogBusy\}/);
  });
  it("'with AI' sends to the session only while one is running", () => {
    const m = app.match(/onAskAgent=\{\(prompt\) => \{([\s\S]*?)\}\} \/>/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/if \(status !== "running"\) return false;\s*sendMessage\(prompt\);\s*return true;/);
  });
});

describe("input bar: images sent with the text", () => {
  const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
  it("Send composes text + attached image paths and clears both", () => {
    const send = app.slice(app.indexOf("const handleSend = "), app.indexOf("const hasActivePrompt"));
    expect(send).toContain("canSend(input, attachments)");
    expect(send).toContain("sendMessage(composeMessage(input, attachments))");
    expect(send).toContain("setAttachments([])");
  });
  it("the Send button is enabled by text OR images", () => {
    expect(app).toMatch(/disabled=\{status !== "running" \|\| !canSend\(input, attachments\)\}/);
  });
  it("🖼 button sits before Send; chips above the input; pasting into the input attaches", () => {
    const form = app.slice(app.indexOf('<form onSubmit={handleSend} className="input-form">'));
    expect(form.indexOf("<AttachmentChips")).toBeLessThan(form.indexOf("<input"));
    expect(form.indexOf("<ImageAttachButton")).toBeLessThan(form.indexOf('type="submit"'));
    const paste = app.slice(app.indexOf("const handleInputPaste"), app.indexOf("const handleInputPaste") + 600);
    expect(paste).toContain('addInputAttachmentsForTab(targetTabId, [path], "pasted")');
  });
});
