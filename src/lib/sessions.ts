// Multi-session tabs (app_specs.md 5.7.4): the tab model and the shapes of
// the per-session events pty.rs emits. Pure -- no Tauri calls here.

/** The session a call without an id means (pty.rs DEFAULT_SESSION). */
export const DEFAULT_SESSION_ID = "main";

export const MAX_TABS = 6;

/** Same rule as pty.rs valid_session_id. */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface SessionOutputEvent {
  session_id: string;
  data: number[];
}

export interface SessionStatusEvent {
  session_id: string;
  status: "terminated" | "error" | string;
}

export interface SessionPromptEvent<P> {
  session_id: string;
  prompt: P;
}

export function isForSession(payload: { session_id?: string } | null | undefined, sessionId: string): boolean {
  return !!payload && payload.session_id === sessionId;
}

/** A fresh, unique tab/session id (never "main"). */
export function newSessionId(existing: readonly string[], rand: () => number = Math.random): string {
  for (;;) {
    const id = `tab-${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!existing.includes(id) && SESSION_ID_RE.test(id)) return id;
  }
}

export interface Tab {
  id: string;
  /** User-chosen name; empty = use the folder name. */
  name: string;
  cwd: string;
  engineId: string;
}

/** What the tab shows: its own name, else the folder's last segment. */
export function tabLabel(tab: Pick<Tab, "name" | "cwd">, fallback: string): string {
  const name = tab.name.trim();
  if (name) return name;
  const seg = tab.cwd.split(/[\\/]/).filter(Boolean).pop();
  return seg || fallback;
}

export function canAddTab(tabs: readonly Tab[]): boolean {
  return tabs.length < MAX_TABS;
}

export function addTab(tabs: readonly Tab[], tab: Tab): Tab[] {
  if (!canAddTab(tabs)) throw new Error(`at most ${MAX_TABS} tabs`);
  if (tabs.some((t) => t.id === tab.id)) throw new Error(`duplicate tab id ${tab.id}`);
  return [...tabs, tab];
}

export function removeTab(tabs: readonly Tab[], id: string): Tab[] {
  return tabs.filter((t) => t.id !== id);
}

export function renameTab(tabs: readonly Tab[], id: string, name: string): Tab[] {
  const clean = name.replace(/[\r\n\t]/g, " ").trim().slice(0, 60);
  return tabs.map((t) => (t.id === id ? { ...t, name: clean } : t));
}

export function updateTab(tabs: readonly Tab[], id: string, patch: Partial<Omit<Tab, "id">>): Tab[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/** Which tab to show after closing `closedId`: the next one, else the previous. */
export function nextActiveAfterClose(tabs: readonly Tab[], closedId: string, activeId: string): string | null {
  const rest = tabs.filter((t) => t.id !== closedId);
  if (!rest.length) return null;
  if (closedId !== activeId && rest.some((t) => t.id === activeId)) return activeId;
  const i = tabs.findIndex((t) => t.id === closedId);
  return (rest[Math.min(i, rest.length - 1)] ?? rest[0]).id;
}

// ── Working folders: never the same or nested folder in two tabs ──
// Paths are the canonical ones from resolve_session_folder (symlinks
// resolved); here only separators, a trailing slash and -- on Windows /
// default macOS volumes -- letter case are evened out.

export function normalizeFolder(path: string, caseInsensitive: boolean): string {
  let p = path.replace(/\\/g, "/");
  while (p.length > 1 && p.endsWith("/") && !/^[A-Za-z]:\/$/.test(p)) p = p.slice(0, -1);
  return caseInsensitive ? p.toLowerCase() : p;
}

/** Same folder, or one inside the other. */
export function foldersOverlap(a: string, b: string, caseInsensitive: boolean): boolean {
  const x = normalizeFolder(a, caseInsensitive);
  const y = normalizeFolder(b, caseInsensitive);
  if (!x || !y) return false;
  if (x === y) return true;
  const within = (inner: string, outer: string) => inner.startsWith(outer.endsWith("/") ? outer : outer + "/");
  return within(x, y) || within(y, x);
}

/** The tab already using `folder` (or a folder nested with it), if any. */
export function findFolderConflict(
  tabs: readonly Tab[],
  folder: string,
  caseInsensitive: boolean,
  ignoreTabId?: string,
): Tab | null {
  return tabs.find((t) => t.id !== ignoreTabId && t.cwd && foldersOverlap(t.cwd, folder, caseInsensitive)) ?? null;
}

/**
 * Should a tab's session start by itself now? (5.7.4)
 *  - a tab the user just created (startOnMount): right away;
 *  - a tab restored after a relaunch (startWhenShown): the first time it is
 *    shown -- not all at launch, so several agents don't start at once;
 * never twice, never while it's already running/starting, and only once its
 * engine's command is known. A tab the user stopped isn't restarted.
 */
export function shouldAutoStart(o: {
  startOnMount?: boolean;
  startWhenShown?: boolean;
  active: boolean;
  alreadyStarted: boolean;
  command: string;
  status: "idle" | "running" | "error";
  isStarting: boolean;
}): boolean {
  if (o.alreadyStarted || !o.command || o.status === "running" || o.isStarting) return false;
  if (o.startOnMount) return true;
  return !!o.startWhenShown && o.active;
}
