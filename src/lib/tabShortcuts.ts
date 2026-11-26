// Keyboard tab switching (app_specs.md 5.7.4): Ctrl+Tab / Ctrl+Shift+Tab
// cycle; Cmd (macOS) or Ctrl (others) + 1..9 jump to that tab (9 = last,
// like browsers). New/Close Tab are menu accelerators (menu.rs).

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function tabShortcutTarget(e: KeyLike, ids: readonly string[], activeId: string, isMac = /Mac/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "")): string | null {
  if (!ids.length || e.altKey) return null;
  if (e.key === "Tab" && e.ctrlKey && !e.metaKey) {
    const i = Math.max(0, ids.indexOf(activeId));
    const n = ids.length;
    return ids[(i + (e.shiftKey ? n - 1 : 1)) % n];
  }
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    const k = Number(e.key);
    return k === 9 ? ids[ids.length - 1] : ids[k - 1] ?? null;
  }
  return null;
}

export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
