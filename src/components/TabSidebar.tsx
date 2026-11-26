// Vertical tab list (app_specs.md 5.7.4, herdr-style): one row per session
// with a status light, its name (double-click to rename), engine and folder.
// App-wide buttons (Skills, Web UI) sit at the bottom.
import { ReactNode, useEffect, useRef, useState } from "react";
import type { Lang } from "../utils/i18n";
import { MAX_TABS, Tab, tabLabel } from "../lib/sessions";
import { SessionLight, lightOf } from "../lib/sessionLights";
import type { RuntimeState } from "./SessionRuntime";

const TEXT = {
  ja: {
    newTab: "＋ 新しいタブ",
    newTabTitle: "新しいタブ（Cmd/Ctrl+T）: 作業フォルダを選んでセッションを開始",
    close: "タブを閉じる（Cmd/Ctrl+W）",
    rename: "ダブルクリックで名前を変更",
    limit: "タブは {max} 個までです",
    appLocation: "アプリの場所",
    light: { working: "実行中", waiting: "あなたの操作待ち", idle: "待機中", stopped: "停止" } as Record<SessionLight, string>,
    tabs: "セッション",
  },
  en: {
    newTab: "+ New tab",
    newTabTitle: "New tab (Cmd/Ctrl+T): choose a working folder and start a session",
    close: "Close tab (Cmd/Ctrl+W)",
    rename: "Double-click to rename",
    limit: "Up to {max} tabs",
    appLocation: "App location",
    light: { working: "Working", waiting: "Waiting for you", idle: "Idle", stopped: "Stopped" } as Record<SessionLight, string>,
    tabs: "Sessions",
  },
} as const;

interface Props {
  lang: Lang;
  tabs: readonly Tab[];
  activeId: string;
  states: Record<string, RuntimeState | undefined>;
  engineNames: Record<string, string>;
  /** Tabs with recent output (working) -- see lib/sessionLights. */
  workingIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
  footer?: ReactNode;
}

const LIGHT_COLOR: Record<SessionLight, string> = {
  working: "#22c55e",
  waiting: "#eab308",
  idle: "#94a3b8",
  stopped: "#ef4444",
};

export function TabSidebar(p: Props) {
  const T = TEXT[p.lang];
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    if (editing) p.onRename(editing, draft);
    setEditing(null);
  };
  const full = p.tabs.length >= MAX_TABS;

  return (
    <aside className="tab-sidebar" aria-label={T.tabs}>
      <button type="button" className="secondary tab-new" onClick={p.onNew} disabled={full}
        title={full ? T.limit.replace("{max}", String(MAX_TABS)) : T.newTabTitle}>
        {T.newTab}
      </button>
      <div className="tab-list" role="tablist" aria-orientation="vertical">
        {p.tabs.map((tab, i) => {
          const state = p.states[tab.id];
          const light = lightOf(state, p.workingIds.has(tab.id));
          const active = tab.id === p.activeId;
          const label = tabLabel(tab, T.appLocation);
          return (
            <div key={tab.id} role="tab" aria-selected={active} tabIndex={0}
              className={`tab-row${active ? " active" : ""}`}
              data-light={light}
              onClick={() => p.onSelect(tab.id)}
              onKeyDown={(e) => { if (e.key === "Enter" && editing !== tab.id) p.onSelect(tab.id); }}
              title={`${label} — ${T.light[light]}${tab.cwd ? `\n${tab.cwd}` : ""}`}>
              <span className="tab-light" aria-label={T.light[light]} style={{ background: LIGHT_COLOR[light] }} />
              <div className="tab-text">
                {editing === tab.id ? (
                  <input ref={inputRef} className="tab-rename" value={draft} maxLength={60}
                    aria-label={T.rename}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") commit();
                      if (e.key === "Escape") setEditing(null);
                    }} />
                ) : (
                  <span className="tab-name" title={T.rename}
                    onDoubleClick={(e) => { e.stopPropagation(); setDraft(tab.name || label); setEditing(tab.id); }}>
                    {label}
                  </span>
                )}
                <span className="tab-meta">
                  {i < 9 ? `${i + 1} · ` : ""}{p.engineNames[tab.engineId] ?? tab.engineId}
                </span>
              </div>
              {p.tabs.length > 1 && (
                <button type="button" className="tab-close" aria-label={`${T.close}: ${label}`} title={T.close}
                  onClick={(e) => { e.stopPropagation(); p.onClose(tab.id); }}>×</button>
              )}
            </div>
          );
        })}
      </div>
      {p.footer && <div className="tab-sidebar-footer">{p.footer}</div>}
    </aside>
  );
}
