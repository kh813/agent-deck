// Native skill catalog screen (app_specs.md 5.7.3): browse/search/import the
// shared catalog, and share/unshare/enable/disable your own skills. All work
// is done by `skills_catalog.py api` (lib/skillCatalog.ts callCatalog).
import { useCallback, useEffect, useState } from "react";
import type { Lang } from "../utils/i18n";
import {
  ApiResult,
  CatalogOp,
  CatalogSkill,
  DRIVE_OPS,
  LocalAction,
  LocalSkill,
  NEEDS_REBUILD,
  callCatalog,
  catalogCardAction,
  catalogText,
  describeError,
  importTarget,
  localActions,
  sortLocal,
} from "../lib/skillCatalog";

interface Props {
  lang: Lang;
  onClose: () => void;
  // Lets the app's quit guard know a catalog operation is running.
  onBusyChange?: (busy: boolean) => void;
}

type Notice = { kind: "info" | "error" | "ok"; text: string } | null;

export function SkillCatalogPanel({ lang, onClose, onBusyChange }: Props) {
  const T = useCallback((k: Parameters<typeof catalogText>[1], v?: Record<string, string>) => catalogText(lang, k, v), [lang]);
  const [tab, setTab] = useState<"catalog" | "mine">("catalog");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogSkill[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [local, setLocal] = useState<LocalSkill[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // op label while running
  const [notice, setNotice] = useState<Notice>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    onBusyChange?.(busy !== null);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // Runs one op with the busy/notice handling every button shares.
  const run = useCallback(
    async <T,>(op: CatalogOp, args: string[] = []): Promise<T | null> => {
      setBusy(op);
      setNotice(DRIVE_OPS.has(op) ? { kind: "info", text: `${T("working")} ${T("driveHint")}` } : { kind: "info", text: T("working") });
      try {
        const r: ApiResult<T> = await callCatalog<T>(op, args);
        if (!r.ok) {
          setNotice({ kind: "error", text: describeError(lang, r.error) });
          return null;
        }
        setNotice(null);
        return r.data;
      } catch (e) {
        setNotice({ kind: "error", text: describeError(lang, { code: "exception", message: String(e) }) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [T, lang],
  );

  const loadCatalog = useCallback(async (q: string) => {
    const words = q.trim();
    const data = await run<{ skills: CatalogSkill[]; offline: boolean }>(words ? "search" : "catalog", words ? words.split(/\s+/) : []);
    if (data) {
      setCatalog(data.skills);
      setOffline(data.offline);
    }
  }, [run]);

  const loadLocal = useCallback(async () => {
    const data = await run<{ skills: LocalSkill[] }>("local");
    if (data) setLocal(sortLocal(data.skills));
  }, [run]);

  useEffect(() => {
    if (tab === "catalog" && catalog === null) void loadCatalog("");
    if (tab === "mine" && local === null) void loadLocal();
  }, [tab, catalog, local, loadCatalog, loadLocal]);

  // An op that changes installed skills, followed by the rebuild that
  // makes them visible to the agents.
  const mutate = useCallback(async (op: CatalogOp, arg: string) => {
    const ok = await run(op, [arg]);
    if (ok === null) return;
    if (NEEDS_REBUILD.has(op)) {
      setBusy("rebuild");
      setNotice({ kind: "info", text: T("rebuilding") });
      const rebuilt = await run("rebuild");
      if (rebuilt === null) return;
    }
    setNotice({ kind: "ok", text: T("done") });
    // Refresh both views' install/share state.
    setLocal(null);
    if (tab === "catalog") void loadCatalog(query);
    else setCatalog(null);
  }, [run, T, tab, loadCatalog, query]);

  const onLocalAction = (s: LocalSkill, a: LocalAction) => {
    if (a === "unshare" && !window.confirm(T("confirmUnshare", { name: s.name }))) return;
    if (a === "share" && !window.confirm(T("confirmShare", { name: s.name }))) return;
    void mutate(a, s.name);
  };

  const disabled = busy !== null;
  const tagStyle = (bg: string, fg: string) => ({
    fontSize: "0.7rem", padding: "1px 6px", borderRadius: "4px", background: bg, color: fg, marginLeft: "6px",
  });

  return (
    <div className="skill-catalog-overlay" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 2000, backdropFilter: "blur(4px)",
    }}>
      <div role="dialog" aria-label={T("title")} style={{
        background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: "12px",
        width: "92%", maxWidth: "760px", height: "82vh", display: "flex", flexDirection: "column",
        boxShadow: "0 10px 25px rgba(0,0,0,0.4)", padding: "20px", color: "var(--text-color)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0 }}>📚 {T("title")}</h3>
          <button className="secondary" onClick={onClose} disabled={disabled} style={{ padding: "4px 10px" }}>
            {lang === "ja" ? "閉じる" : "Close"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          {(["catalog", "mine"] as const).map((k) => (
            <button key={k} className={tab === k ? "primary" : "secondary"} disabled={disabled}
              onClick={() => setTab(k)} style={{ padding: "6px 14px" }}>
              {T(k === "catalog" ? "tabCatalog" : "tabMine")}
            </button>
          ))}
        </div>

        {tab === "catalog" && (
          <form onSubmit={(e) => { e.preventDefault(); void loadCatalog(query); }}
            style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <input className="input-field" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={T("searchPlaceholder")} disabled={disabled} style={{ flex: 1 }} />
            <button type="submit" className="primary" disabled={disabled}>{T("search")}</button>
            {query && (
              <button type="button" className="secondary" disabled={disabled}
                onClick={() => { setQuery(""); void loadCatalog(""); }}>{T("clear")}</button>
            )}
          </form>
        )}

        {notice && (
          <div className={`catalog-notice catalog-notice-${notice.kind}`} style={{
            padding: "8px 12px", borderRadius: "8px", marginBottom: "10px", fontSize: "0.8rem",
            background: notice.kind === "error" ? "rgba(239,68,68,0.12)" : notice.kind === "ok" ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.1)",
            color: notice.kind === "error" ? "#ef4444" : notice.kind === "ok" ? "#10b981" : "var(--text-muted)",
          }}>
            {busy && "⏳ "}{notice.text}
          </div>
        )}
        {tab === "catalog" && offline && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px" }}>⚠ {T("offline")}</div>
        )}

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
          {tab === "catalog" && catalog?.length === 0 && <div style={{ color: "var(--text-muted)" }}>{T("empty")}</div>}
          {tab === "catalog" && catalog?.map((s) => {
            const action = catalogCardAction(s);
            const key = `${s.owner}/${s.name}`;
            return (
              <div key={key} className="catalog-card" style={{
                border: "1px solid var(--input-border)", borderRadius: "8px", padding: "10px 12px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{s.name}</strong>
                    {s.installed === "catalog" && <span style={tagStyle("rgba(16,185,129,0.15)", "#10b981")}>{T("imported")}</span>}
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "8px" }}>
                      {s.owner} · {T("updated")} {s.modified}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button className="secondary" style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                      onClick={() => setExpanded(expanded === key ? null : key)}>
                      {T(expanded === key ? "hide" : "details")}
                    </button>
                    {action.kind === "none" ? (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", alignSelf: "center" }}>{T(action.label)}</span>
                    ) : (
                      <button className="primary" disabled={disabled} style={{ padding: "4px 12px", fontSize: "0.75rem" }}
                        onClick={() => void mutate("import", importTarget(s))}>
                        {T(action.kind)}
                      </button>
                    )}
                  </div>
                </div>
                <div style={{
                  fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "6px",
                  ...(expanded === key ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }),
                }}>
                  {s.description}
                </div>
              </div>
            );
          })}

          {tab === "mine" && local?.map((s) => (
            <div key={`${s.root}/${s.name}`} className="catalog-card" style={{
              border: "1px solid var(--input-border)", borderRadius: "8px", padding: "10px 12px",
              opacity: s.enabled ? 1 : 0.6,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{s.name}</strong>
                  {s.mine && <span style={tagStyle("rgba(59,130,246,0.15)", "#3b82f6")}>{T("mine")}</span>}
                  {s.root === "catalog" && <span style={tagStyle("rgba(16,185,129,0.15)", "#10b981")}>{T("imported")}{s.owner ? ` · ${s.owner}` : ""}</span>}
                  {s.root === "common" && <span style={tagStyle("rgba(148,163,184,0.2)", "var(--text-muted)")}>{T("builtinTag")}</span>}
                  {s.shared && <span style={tagStyle("rgba(168,85,247,0.15)", "#a855f7")}>{T("sharedTag")}</span>}
                  {!s.enabled && <span style={tagStyle("rgba(239,68,68,0.12)", "#ef4444")}>{T("disabledTag")}</span>}
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  {localActions(s).map((a) => (
                    <button key={a} className={a === "share" ? "primary" : "secondary"} disabled={disabled}
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }} onClick={() => onLocalAction(s, a)}>
                      {T(a)}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{
                fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "6px",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>
                {s.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
