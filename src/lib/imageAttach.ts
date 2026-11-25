// Pasted / dropped images -> a file path in the prompt (app_specs.md 5.7.2).
// The Rust side saves the image under <working folder>/tmp/screenshots/;
// these helpers decide what to save and what text to type into the CLI.
import { invoke } from "@tauri-apps/api/core";

const pad = (n: number) => String(n).padStart(2, "0");

/** "screenshot-YYYYMMDD-HHMMSS" in local time. */
export function screenshotNameHint(d: Date = new Date()): string {
  return (
    `screenshot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * A path as prompt text. Always double-quoted so spaces (e.g. Windows'
 * "C:\Users\Taro Yamada\...") never split it; both agy and Claude Code read
 * a quoted path. Double quotes can't appear in Windows paths and are
 * vanishingly rare elsewhere; they're escaped just in case.
 */
export function quotePathForPrompt(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

/** Text to type for one or more attached paths: quoted, space-separated,
 *  with a trailing space so the user can keep typing the instruction. */
export function promptTextForPaths(paths: readonly string[]): string {
  const clean = paths.map((p) => p.trim()).filter(Boolean);
  return clean.length ? clean.map(quotePathForPrompt).join(" ") + " " : "";
}

interface ItemLike {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

/** The first image among clipboard/drag items, if any. */
export function pickImageFile(items: ArrayLike<ItemLike> | null | undefined): File | null {
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** Whether clipboard data offers any plain text (then it's a text paste). */
export function hasText(data: { types: ArrayLike<string> } | null | undefined): boolean {
  if (!data) return false;
  return Array.from(data.types).some((t) => t === "text/plain" || t === "text");
}

/** File name part of a path, for status messages. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Saves image bytes via the raw-body save_pasted_image command; returns the path. */
export async function saveImageBlob(blob: Blob, cwd: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<string>("save_pasted_image", bytes, {
    headers: {
      "x-cwd": encodeURIComponent(cwd),
      "x-mime": encodeURIComponent(blob.type || "image/png"),
      "x-name": encodeURIComponent(screenshotNameHint()),
    },
  });
}

/** Saves the OS clipboard's image, if any (null = no image on the clipboard). */
export function saveClipboardImage(cwd: string): Promise<string | null> {
  return invoke<string | null>("save_clipboard_image", { cwd, nameHint: screenshotNameHint() });
}

/** Where a keyboard paste in the terminal should go through the OS
 *  clipboard (async) instead of the webview's own paste event. */
export function isManualPasteKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, isMac: boolean): boolean {
  if (e.key.toLowerCase() !== "v" || e.altKey) return false;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey) return true; // explicit paste, every platform
  // Windows/Linux: xterm.js would send Ctrl+V as a ^V keystroke and no paste
  // event would ever fire, so paste ourselves. (macOS Cmd+V fires a real
  // paste event, handled there.)
  return !isMac && e.ctrlKey && !e.metaKey && !e.shiftKey;
}
