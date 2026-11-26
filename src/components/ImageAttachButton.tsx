// The input bar's 🖼 button and the chips of attached images
// (lib/attachments.ts). The button opens a small menu: paste a screenshot
// from the clipboard (saved under tmp/screenshots/), or pick image files
// (used in place, not copied).
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../utils/i18n";
import { Attachment, AttachmentKind, IMAGE_EXTENSIONS } from "../lib/attachments";
import { saveClipboardImage } from "../lib/imageAttach";

const TEXT = {
  ja: {
    button: "画像",
    title: "画像を添付（スクリーンショットの貼り付け / ファイルを選択）",
    paste: "📋 スクリーンショットを貼り付け",
    pick: "📁 画像ファイルを選択…",
    noImage: "クリップボードに画像がありません。スクリーンショットをコピーしてから選んでください（Mac: Ctrl+Shift+Cmd+4、Windows: Win+Shift+S）。",
    filter: "画像",
    remove: "添付を外す",
    screenshot: "スクリーンショット",
  },
  en: {
    button: "Image",
    title: "Attach images (paste a screenshot / choose files)",
    paste: "📋 Paste screenshot",
    pick: "📁 Choose image files…",
    noImage: "No image on the clipboard. Copy a screenshot first (Mac: Ctrl+Shift+Cmd+4, Windows: Win+Shift+S).",
    filter: "Images",
    remove: "Remove attachment",
    screenshot: "Screenshot",
  },
} as const;

interface ButtonProps {
  lang: Lang;
  cwd: string;
  disabled: boolean;
  onAdd: (paths: string[], kind: AttachmentKind) => void;
  onError: (message: string) => void;
}

export function ImageAttachButton({ lang, cwd, disabled, onAdd, onError }: ButtonProps) {
  const T = TEXT[lang];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const paste = async () => {
    setOpen(false);
    try {
      const path = await saveClipboardImage(cwd);
      if (path) onAdd([path], "pasted");
      else onError(T.noImage);
    } catch (e) {
      onError(String(e));
    }
  };

  const pick = async () => {
    setOpen(false);
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({
        multiple: true,
        directory: false,
        filters: [{ name: T.filter, extensions: [...IMAGE_EXTENSIONS] }],
      });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (paths.length) onAdd(paths, "file");
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <div ref={wrapRef} className="attach-wrap">
      <button type="button" className="secondary attach-button" disabled={disabled} title={T.title}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        🖼 {T.button}
      </button>
      {open && (
        <div role="menu" className="attach-menu">
          <button type="button" role="menuitem" className="attach-menu-item" onClick={() => void paste()}>{T.paste}</button>
          <button type="button" role="menuitem" className="attach-menu-item" onClick={() => void pick()}>{T.pick}</button>
        </div>
      )}
    </div>
  );
}

interface ChipsProps {
  lang: Lang;
  attachments: readonly Attachment[];
  disabled: boolean;
  onRemove: (path: string) => void;
}

export function AttachmentChips({ lang, attachments, disabled, onRemove }: ChipsProps) {
  const T = TEXT[lang];
  if (!attachments.length) return null;
  return (
    <div className="attach-chips" aria-label={T.title}>
      {attachments.map((a) => (
        <span key={a.path} className="attach-chip" title={a.path}>
          <span className="attach-chip-name">🖼 {a.kind === "pasted" ? `${T.screenshot} · ` : ""}{a.name}</span>
          <button type="button" className="attach-chip-remove" disabled={disabled}
            aria-label={`${T.remove}: ${a.name}`} onClick={() => onRemove(a.path)}>×</button>
        </span>
      ))}
    </div>
  );
}
