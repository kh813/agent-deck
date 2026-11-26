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
