// "New tab" (app_specs.md 5.7.4): choose the agent (default: the one in use)
// and the working folder; a folder the same as / nested with another tab's
// is refused here, before any session starts.
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../utils/i18n";

const TEXT = {
  ja: {
    title: "新しいタブ",
    agent: "エージェント",
    folder: "作業フォルダ",
    choose: "選択…",
    notChosen: "（未選択）",
    create: "作成して開始",
    cancel: "キャンセル",
    hint: "フォルダは、ほかのタブと同じ・内側・外側のものは選べません。",
  },
  en: {
    title: "New tab",
    agent: "Agent",
    folder: "Working folder",
    choose: "Choose…",
    notChosen: "(not chosen)",
    create: "Create and start",
    cancel: "Cancel",
    hint: "A folder that is the same as, inside, or around another tab's can't be used.",
  },
} as const;

export interface EngineOption {
  id: string;
  name: string;
}

interface Props {
  lang: Lang;
  engines: readonly EngineOption[];
  defaultEngineId: string;
  /** Opens the folder picker; null = cancelled. */
  pickFolder: () => Promise<string | null>;
  /** Creates the tab; returns an error message to show (e.g. folder in use), or null on success. */
  onCreate: (folder: string, engineId: string) => Promise<string | null>;
  onCancel: () => void;
}

export function NewTabDialog({ lang, engines, defaultEngineId, pickFolder, onCreate, onCancel }: Props) {
  const T = TEXT[lang];
  const initial = engines.some((e) => e.id === defaultEngineId) ? defaultEngineId : engines[0]?.id ?? "";
  const [engineId, setEngineId] = useState(initial);
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => selectRef.current?.focus(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onCancel]);

  const choose = async () => {
    const picked = await pickFolder();
    if (picked) {
      setFolder(picked);
      setError(null);
    }
  };
  const create = async () => {
    if (!folder || !engineId) return;
    setBusy(true);
    try {
      const err = await onCreate(folder, engineId);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="new-tab-overlay" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 2100,
    }}>
      <div role="dialog" aria-modal="true" aria-label={T.title} style={{
        background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: "12px",
        width: "92%", maxWidth: "460px", padding: "20px", color: "var(--text-color)",
        boxShadow: "0 10px 25px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: "14px",
      }}>
        <h3 style={{ margin: 0 }}>{T.title}</h3>

        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem", fontWeight: 600 }}>
          {T.agent}
          <select ref={selectRef} className="dialog-field" value={engineId} disabled={busy}
            onChange={(e) => setEngineId(e.target.value)}>
            {engines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{T.folder}</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className="dialog-field" data-testid="new-tab-folder" style={{
              flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "var(--mono-font, monospace)", fontSize: "0.8rem",
              color: folder ? "var(--field-text)" : "var(--field-placeholder)",
            }} title={folder ?? ""}>
              {folder ?? T.notChosen}
            </span>
            <button type="button" className="secondary" disabled={busy} onClick={() => void choose()}>{T.choose}</button>
          </div>
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{T.hint}</span>
        </div>

        {error && (
          <div role="alert" style={{
            fontSize: "0.8rem", color: "#ef4444", background: "rgba(239,68,68,0.1)",
            borderRadius: "8px", padding: "8px 10px", whiteSpace: "pre-wrap",
          }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>{T.cancel}</button>
          <button type="button" className="primary" disabled={busy || !folder || !engineId} onClick={() => void create()}>
            {T.create}
          </button>
        </div>
      </div>
    </div>
  );
}
