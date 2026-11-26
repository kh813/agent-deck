// Tabs are restored on relaunch (app_specs.md 5.7.4): names, folders,
// engines and order come back; sessions are NOT started (only the visible
// tab auto-starts, as a single session always has). Stored per machine in
// localStorage; anything malformed is dropped rather than trusted.
import { DEFAULT_SESSION_ID, MAX_TABS, SESSION_ID_RE, Tab } from "./sessions";

export const TABS_STORAGE_KEY = "agent-deck-tabs";

export interface SavedTabs {
  tabs: Tab[];
  activeId: string;
}

export function sanitizeSavedTabs(raw: unknown, fallbackEngine: string): SavedTabs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { tabs?: unknown; activeId?: unknown };
  if (!Array.isArray(r.tabs)) return null;
  const seen = new Set<string>();
  const tabs: Tab[] = [];
  for (const t of r.tabs) {
    if (!t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id : "";
    if (!SESSION_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    tabs.push({
      id,
      name: typeof x.name === "string" ? x.name.slice(0, 60) : "",
      cwd: typeof x.cwd === "string" ? x.cwd : "",
      engineId: typeof x.engineId === "string" && x.engineId ? x.engineId : fallbackEngine,
    });
    if (tabs.length >= MAX_TABS) break;
  }
  if (!tabs.length) return null;
  const activeId = typeof r.activeId === "string" && tabs.some((t) => t.id === r.activeId) ? r.activeId : tabs[0].id;
  return { tabs, activeId };
}

export function loadSavedTabs(fallbackEngine: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedTabs | null {
  try {
    const text = storage?.getItem(TABS_STORAGE_KEY);
    return text ? sanitizeSavedTabs(JSON.parse(text), fallbackEngine) : null;
  } catch {
    return null;
  }
}

export function saveTabs(saved: SavedTabs, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(TABS_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // storage unavailable: tabs just aren't remembered
  }
}

export function defaultTabs(engineId: string): SavedTabs {
  return { tabs: [{ id: DEFAULT_SESSION_ID, name: "", cwd: "", engineId }], activeId: DEFAULT_SESSION_ID };
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
