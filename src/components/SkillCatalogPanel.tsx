// Native skill catalog screen (app_specs.md 5.7.3).
//  - Catalog: the shared catalog, filtered as you type (name / author /
//    description, kana- and width-insensitive) and by author; import.
//  - My Skills: everything installed. Your own skills: create, edit, share,
//    update the shared copy, unshare, enable/disable, delete. Imported ones:
//    view, enable/disable, uninstall. Built-ins: view.
// All work is done by `skills_catalog.py api` (lib/skillCatalog.ts callCatalog).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lang } from "../utils/i18n";
import {
  AUTO_SYNC_OWNER,
  ApiResult,
  CatalogOp,
  CatalogSkill,
  DRIVE_OPS,
  LocalAction,
  LocalSkill,
  NEEDS_REBUILD,
  SkillDoc,
  SkillDraft,
  agentPrompt,
  callCatalog,
  catalogCardAction,
  catalogOwners,
  catalogText,
  confirmDialog,
  describeError,
  exportAllTargets,
  exportFileName,
  filterByOwner,
  filterSkills,
  importTarget,
  localActions,
  opForAction,
  pickExportPath,
  pickImportFile,
  sortLocal,
  splitLocal,
} from "../lib/skillCatalog";
import { EditorMode, SkillEditor } from "./SkillEditor";

interface Props {
  lang: Lang;
  onClose: () => void;
  // Lets the app's quit guard know a catalog operation is running.
  onBusyChange?: (busy: boolean) => void;
  /** Sends a prompt to the running session; false if none is running. */
  onAskAgent?: (prompt: string) => boolean;
}

type Tab = "catalog" | "mine" | "installed";
const TAB_LABEL = { catalog: "tabCatalog", mine: "tabMine", installed: "tabInstalled" } as const;
type Notice = { kind: "info" | "error" | "ok"; text: string } | null;
type Editor = { mode: EditorMode; doc?: SkillDoc } | null;

const DANGER: ReadonlySet<LocalAction> = new Set(["delete", "uninstall", "unshare"]);
const CATALOG_ACTIONS: ReadonlySet<LocalAction> = new Set(["share", "reshare", "unshare"]);

export function SkillCatalogPanel({ lang, onClose, onBusyChange, onAskAgent }: Props) {
  const T = useCallback((k: Parameters<typeof catalogText>[1], v?: Record<string, string>) => catalogText(lang, k, v), [lang]);
  const [tab, setTab] = useState<Tab>("catalog");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [catalog, setCatalog] = useState<CatalogSkill[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [local, setLocal] = useState<LocalSkill[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // op label while running
  const [notice, setNotice] = useState<Notice>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  // A public install (no org config.toml): no shared catalog, but your own
  // and installed skills are still managed here.
  const [noCatalog, setNoCatalog] = useState(false);

  useEffect(() => {
    onBusyChange?.(busy !== null);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // Runs one op with the busy/notice handling every button shares.
  const run = useCallback(
    // keepOk: a list refresh after an action leaves its "done" message up.
    async <R,>(op: CatalogOp, args: string[] = [], input?: unknown, keepOk = false): Promise<R | null> => {
      setBusy(op);
      const working: Notice = DRIVE_OPS.has(op) ? { kind: "info", text: `${T("working")} ${T("driveHint")}` } : { kind: "info", text: T("working") };
      setNotice((n) => (keepOk && n?.kind === "ok" ? n : working));
      try {
        const r: ApiResult<R> = await callCatalog<R>(op, args, input);
        if (!r.ok) {
          if (r.error.code === "no_catalog") {
            setNoCatalog(true);
            setTab("mine");
            setNotice(null);
            return null;
          }
          setNotice({ kind: "error", text: describeError(lang, r.error) });
          return null;
        }
        setNotice((n) => (keepOk && n?.kind === "ok" ? n : null));
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

  const loadCatalog = useCallback(async () => {
    const data = await run<{ skills: CatalogSkill[]; offline: boolean }>("catalog", [], undefined, true);
    if (data) {
      setCatalog(data.skills);
      setOffline(data.offline);
    }
  }, [run]);

  const loadLocal = useCallback(async () => {
    const data = await run<{ skills: LocalSkill[] }>("local", [], undefined, true);
    if (data) setLocal(sortLocal(data.skills));
  }, [run]);

  useEffect(() => {
    if (tab === "catalog" && catalog === null && !noCatalog) void loadCatalog();
    if (tab !== "catalog" && local === null) void loadLocal();
  }, [tab, catalog, local, noCatalog, loadCatalog, loadLocal]);

  // Rebuild so the agents see the change, then refresh both lists.
  const finish = useCallback(async (op: CatalogOp, okText = T("done")) => {
    if (NEEDS_REBUILD.has(op)) {
      setNotice({ kind: "info", text: T("rebuilding") });
      if ((await run("rebuild")) === null) return false;
    }
    setNotice({ kind: "ok", text: okText });
    return true;
  }, [run, T]);
  // Re-fetch both lists (the open tab reloads right away, the other on visit).
  const refresh = useCallback(() => {
    setLocal(null);
    setCatalog(null);
  }, []);

  // An op on one skill, followed by the rebuild that makes it visible.
  const mutate = useCallback(async (op: CatalogOp, arg: string) => {
    if ((await run(op, [arg])) === null) return false;
    const ok = await finish(op);
    refresh();
    return ok;
  }, [run, finish, refresh]);

  const confirmFor = (a: LocalAction, s: LocalSkill): string | null => {
    switch (a) {
      case "share": return T("confirmShare", { name: s.name });
      case "reshare": return T("confirmReshare", { name: s.name });
      case "unshare": return T("confirmUnshare", { name: s.name });
      case "uninstall": return T("confirmUninstall", { name: s.name });
      case "delete": return T(s.shared ? "confirmDeleteShared" : "confirmDelete", { name: s.name });
      default: return null;
    }
  };

  const exportSkills = async (targets: { name: string; root: string }[]) => {
    if (!targets.length) {
      setNotice({ kind: "info", text: T("nothingToExport") });
      return;
    }
    const path = await pickExportPath(exportFileName(targets.map((t) => t.name)), lang);
    if (!path) return;
    const r = await run<{ path: string }>("export", [], { skills: targets, path });
    if (r) setNotice({ kind: "ok", text: T("exported", { path: r.path }) });
  };

  const importFromFile = async () => {
    const path = await pickImportFile(lang);
    if (!path) return;
    let r = await callImport(path, false);
    if (r && "exists" in r) {
      if (!(await confirmDialog(T("confirmImportOverwrite", { names: r.exists.join(", ") }), lang))) {
        setNotice(null);
        return;
      }
      r = await callImport(path, true);
    }
    if (!r || "exists" in r) return;
    setTab("mine");
    if (!(await finish("import-file"))) return;
    const shadowed = r.shadowed.length ? T("importShadowed", { names: r.shadowed.join(", ") }) : "";
    setNotice({ kind: "ok", text: T("importedFiles", { names: r.names.join(", ") }) + shadowed });
    refresh();
  };

  // import-file, with "already have it" turned into a question instead of an error.
  const callImport = async (path: string, overwrite: boolean)
    : Promise<{ names: string[]; shadowed: string[] } | { exists: string[] } | null> => {
    setBusy("import-file");
    setNotice({ kind: "info", text: T("working") });
    try {
      const r = await callCatalog<{ names: string[]; shadowed: string[] }>("import-file", [], { path, overwrite });
      if (r.ok) return r.data;
      if (r.error.code === "exists" && !overwrite) return { exists: (r.error as { names?: string[] }).names ?? [] };
      setNotice({ kind: "error", text: describeError(lang, r.error) });
      return null;
    } catch (e) {
      setNotice({ kind: "error", text: describeError(lang, { code: "exception", message: String(e) }) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const onLocalAction = async (s: LocalSkill, a: LocalAction) => {
    if (a === "export") {
      await exportSkills([{ name: s.name, root: s.root }]);
      return;
    }
    if (a === "view" || a === "edit") {
      const doc = await run<SkillDoc>("read", [s.name, s.root]);
      if (doc) setEditor({ mode: a === "edit" && doc.editable ? "edit" : "view", doc });
      return;
    }
    const question = confirmFor(a, s);
    if (question && !(await confirmDialog(question, lang))) return;
    if (a === "delete" && s.shared && (await run("unshare", [s.name])) === null) return;
    const op = opForAction(a);
    if (op) await mutate(op, s.name);
  };

  const saveDraft = async (draft: SkillDraft) => {
    if (!editor) return;
    const isNew = editor.mode === "new";
    const r = await run<{ name: string; shared?: boolean }>(isNew ? "create" : "save", [], draft);
    if (r === null) return; // stay in the editor with the error shown
    setEditor(null);
    setTab("mine");
    if (await finish(isNew ? "create" : "save")) {
      if (r.shared && (await confirmDialog(T("askReshareAfterSave", { name: r.name }), lang))) {
        if ((await run("share", [r.name])) !== null) setNotice({ kind: "ok", text: T("done") });
      }
    }
    refresh();
  };

  const askAgent = (prompt: string) => {
    if (!onAskAgent?.(prompt)) {
      setNotice({ kind: "error", text: T("needSession") });
      return;
    }
    onClose();
  };

  const owners = useMemo(() => catalogOwners(catalog ?? []), [catalog]);
  const shownCatalog = useMemo(
    () => (catalog ? filterSkills(filterByOwner(catalog, owner), query) : null),
    [catalog, owner, query],
  );
  const shownLocal = useMemo(() => (local ? splitLocal(filterSkills(local, query)) : null), [local, query]);
  const ownerLabel = (o: string) => (o === AUTO_SYNC_OWNER ? T("ownerDefault") : o);

  const disabled = busy !== null;
  const tagStyle = (bg: string, fg: string) => ({
    fontSize: "0.7rem", padding: "1px 6px", borderRadius: "4px", background: bg, color: fg, marginLeft: "6px",
  });
  const smallBtn = { padding: "4px 10px", fontSize: "0.75rem" } as const;
  const listCount = tab === "catalog" ? shownCatalog?.length
    : tab === "mine" ? shownLocal?.mine.length
    : shownLocal ? shownLocal.added.length + shownLocal.builtin.length : undefined;

  const sectionHead = { fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", margin: "6px 0 2px" } as const;
  const localCard = (s: LocalSkill) => (
    <div key={`${s.root}/${s.name}`} className="catalog-card" style={{
      border: "1px solid var(--input-border)", borderRadius: "8px", padding: "10px 12px",
      opacity: s.enabled ? 1 : 0.6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <strong>{s.name}</strong>
          {s.owner && (s.root === "catalog" || !s.mine) && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "8px" }}>{T("authorBy", { owner: s.owner })}</span>
          )}
          {s.auto_sync && <span style={tagStyle("rgba(148,163,184,0.2)", "var(--text-muted)")}>{T("autoSyncTag")}</span>}
          {s.shared && <span style={tagStyle("rgba(168,85,247,0.15)", "#a855f7")}>{T("sharedTag")}</span>}
          {!s.enabled && <span style={tagStyle("rgba(239,68,68,0.12)", "#ef4444")}>{T("disabledTag")}</span>}
        </div>
        <div style={{ display: "flex", gap: "6px", flexShrink: 0, flexWrap: "wrap" }}>
          {localActions(s).filter((a) => !noCatalog || !CATALOG_ACTIONS.has(a)).map((a) => (
            <button key={a} className={a === "share" || a === "edit" ? "primary" : "secondary"} disabled={disabled}
              style={{ ...smallBtn, ...(DANGER.has(a) ? { color: "#ef4444" } : {}) }}
              onClick={() => void onLocalAction(s, a)}>
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
  );

  return (
    <div className="skill-catalog-overlay" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 2000, backdropFilter: "blur(4px)",
    }}>
      <div role="dialog" aria-label={T("title")} style={{
        background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: "12px",
        width: "92%", maxWidth: "820px", height: "86vh", display: "flex", flexDirection: "column",
        boxShadow: "0 10px 25px rgba(0,0,0,0.4)", padding: "20px", color: "var(--text-color)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0 }}>📚 {T("title")}</h3>
          <button className="secondary" onClick={onClose} disabled={disabled} style={{ padding: "4px 10px" }}>
            {lang === "ja" ? "閉じる" : "Close"}
          </button>
        </div>

        {notice && (
          <div className={`catalog-notice catalog-notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} style={{
            padding: "8px 12px", borderRadius: "8px", marginBottom: "10px", fontSize: "0.8rem", whiteSpace: "pre-wrap",
            background: notice.kind === "error" ? "rgba(239,68,68,0.12)" : notice.kind === "ok" ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.1)",
            color: notice.kind === "error" ? "#ef4444" : notice.kind === "ok" ? "#10b981" : "var(--text-muted)",
          }}>
            {busy && "⏳ "}{notice.text}
          </div>
        )}

        {editor ? (
          <SkillEditor
            key={`${editor.mode}:${editor.doc?.name ?? ""}`}
            lang={lang}
            mode={editor.mode}
            doc={editor.doc}
            busy={disabled}
            onSave={(d) => void saveDraft(d)}
            onCancel={() => { setEditor(null); setNotice(null); }}
            onAskAgent={editor.doc ? () => askAgent(agentPrompt("update", editor.doc!.name)) : undefined}
          />
        ) : (
          <>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
              {((noCatalog ? ["mine", "installed"] : ["catalog", "mine", "installed"]) as Tab[]).map((k) => (
                <button key={k} className={tab === k ? "primary" : "secondary"} disabled={disabled}
                  onClick={() => setTab(k)} style={{ padding: "6px 14px" }}>
                  {T(TAB_LABEL[k])}
                </button>
              ))}
              {tab === "mine" && (
                <div style={{ marginLeft: "auto", display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="primary" disabled={disabled} onClick={() => setEditor({ mode: "new" })} style={{ padding: "6px 12px" }}>
                    {T("newSkill")}
                  </button>
                  {onAskAgent && (
                    <button className="secondary" disabled={disabled} onClick={() => askAgent(agentPrompt("create"))} style={{ padding: "6px 12px" }}>
                      {T("createWithAi")}
                    </button>
                  )}
                  <button className="secondary" disabled={disabled} onClick={() => void importFromFile()} style={{ padding: "6px 12px" }}>
                    {T("importFile")}
                  </button>
                  <button className="secondary" disabled={disabled || !local}
                    onClick={() => void exportSkills(exportAllTargets(local ?? []))} style={{ padding: "6px 12px" }}>
                    {T("exportAll")}
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "10px", alignItems: "center" }}>
              <input className="input-field" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={T("filterPlaceholder")} aria-label={T("search")} style={{ flex: 1, minWidth: 0 }} />
              {tab === "catalog" && owners.length > 1 && (
                <select className="input-field" value={owner} onChange={(e) => setOwner(e.target.value)}
                  aria-label={T("ownerAll")} style={{ maxWidth: "180px" }}>
                  <option value="">{T("ownerAll")}</option>
                  {owners.map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}
                </select>
              )}
              {listCount !== undefined && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {T("count", { n: String(listCount) })}
                </span>
              )}
            </div>
            {noCatalog && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px" }}>ℹ {T("noCatalogNote")}</div>
            )}
            {tab === "catalog" && offline && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px" }}>⚠ {T("offline")}</div>
            )}

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {listCount === 0 && (tab !== "mine" || query) && <div style={{ color: "var(--text-muted)" }}>{T("empty")}</div>}
              {tab === "catalog" && shownCatalog?.map((s) => {
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
                          <button type="button" className="link-button" onClick={() => setOwner(s.owner)}
                            title={T("ownerAll")} style={{
                              background: "none", border: "none", padding: 0, color: "inherit",
                              textDecoration: "underline dotted", cursor: "pointer", font: "inherit",
                            }}>
                            {ownerLabel(s.owner)}
                          </button>
                          {" · "}{T("updated")} {s.modified}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                        <button className="secondary" style={smallBtn}
                          onClick={() => setExpanded(expanded === key ? null : key)}>
                          {T(expanded === key ? "hide" : "details")}
                        </button>
                        {action.kind === "none" ? (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", alignSelf: "center" }}>{T(action.label)}</span>
                        ) : (
                          <button className="primary" disabled={disabled} style={{ ...smallBtn, padding: "4px 12px" }}
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

              {tab === "mine" && shownLocal && (
                shownLocal.mine.length ? shownLocal.mine.map(localCard)
                  : !query && <div style={{ color: "var(--text-muted)" }}>{T("mineEmpty")}</div>
              )}

              {tab === "installed" && shownLocal && (
                <>
                  {shownLocal.added.length > 0 && (
                    <section aria-label={T("sectionAdded")} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={sectionHead}>{T("sectionAdded")} ({shownLocal.added.length})</div>
                      {shownLocal.added.map(localCard)}
                    </section>
                  )}
                  {shownLocal.builtin.length > 0 && (
                    // Many and read-only: folded unless you're searching.
                    <details open={!!query} aria-label={T("sectionBuiltin")}>
                      <summary style={{ ...sectionHead, cursor: "pointer" }}>{T("sectionBuiltin")} ({shownLocal.builtin.length})</summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                        {shownLocal.builtin.map(localCard)}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
