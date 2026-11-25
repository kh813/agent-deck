// Per-user terminal (xterm.js) font override, chosen from the native Font
// menu (src-tauri/src/menu.rs). The defaults come from agent_config.json
// (font_family / font_size, org-configurable); the override only stores what
// the user changed, so "Reset Font to Default" simply clears it.

export interface FontOverride {
  family: string | null; // CSS font-family stack; null = agent_config.json's
  size: number | null; // px; null = agent_config.json's
}

export interface FontDefaults {
  family: string;
  size: number;
}

// Payload of the "font-menu" event (FontMenuAction in menu.rs).
export type FontMenuAction =
  | { action: "family"; value: string | null }
  | { action: "size"; value: number }
  | { action: "size-increase" }
  | { action: "size-decrease" }
  | { action: "reset" };

// Keep in sync with FONT_SIZES' range in menu.rs.
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const FALLBACK_DEFAULTS: FontDefaults = {
  family: "Menlo, Monaco, 'Courier New', monospace",
  size: 13,
};
export const FONT_STORAGE_KEY = "agent-deck-terminal-font";

const NO_OVERRIDE: FontOverride = { family: null, size: null };

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return FALLBACK_DEFAULTS.size;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

export function effectiveFont(override: FontOverride, defaults: FontDefaults): FontDefaults {
  return {
    family: override.family || defaults.family,
    size: clampFontSize(override.size ?? defaults.size),
  };
}

export function applyFontAction(
  current: FontOverride,
  action: FontMenuAction,
  defaults: FontDefaults,
): FontOverride {
  const size = effectiveFont(current, defaults).size;
  switch (action.action) {
    case "family":
      return { ...current, family: action.value || null };
    case "size":
      return { ...current, size: clampFontSize(action.value) };
    case "size-increase":
      return { ...current, size: clampFontSize(size + 1) };
    case "size-decrease":
      return { ...current, size: clampFontSize(size - 1) };
    case "reset":
      return { ...NO_OVERRIDE };
    default:
      return current;
  }
}

export function loadFontOverride(): FontOverride {
  try {
    const raw = localStorage.getItem(FONT_STORAGE_KEY);
    if (!raw) return { ...NO_OVERRIDE };
    const parsed = JSON.parse(raw);
    return {
      family: typeof parsed?.family === "string" && parsed.family.trim() ? parsed.family : null,
      size: typeof parsed?.size === "number" && Number.isFinite(parsed.size) ? clampFontSize(parsed.size) : null,
    };
  } catch {
    return { ...NO_OVERRIDE };
  }
}

export function saveFontOverride(override: FontOverride): void {
  try {
    if (override.family === null && override.size === null) {
      localStorage.removeItem(FONT_STORAGE_KEY);
    } else {
      localStorage.setItem(FONT_STORAGE_KEY, JSON.stringify(override));
    }
  } catch {
    // Storage unavailable: the choice just won't survive a restart.
  }
}
