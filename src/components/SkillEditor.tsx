// Create / edit / view one skill's SKILL.md (app_specs.md 5.7.3). A form, not
// a raw file editor: name (new skills only), description (the frontmatter
// line the AI uses to decide when to run the skill) and the instructions
// body. Other frontmatter (author/email) is kept by the script on save.
import { useMemo, useState } from "react";
import type { Lang } from "../utils/i18n";
import {
  DraftProblem,
  SkillDoc,
  SkillDraft,
  catalogText,
  confirmDialog,
  draftProblem,
  skillTemplate,
} from "../lib/skillCatalog";

export type EditorMode = "new" | "edit" | "view";

interface Props {
  lang: Lang;
  mode: EditorMode;
  doc?: SkillDoc;
  busy: boolean;
  onSave: (draft: SkillDraft) => void;
  onCancel: () => void;
  /** "Improve with AI": hands the skill to the session (my-skills update). */
  onAskAgent?: () => void;
}

export function initialDraft(mode: EditorMode, lang: Lang, doc?: SkillDoc): SkillDraft {
  if (mode === "new" || !doc) return { name: "", description: "", body: skillTemplate(lang) };
  return { name: doc.name, description: doc.description, body: doc.body };
}

export function isDirty(a: SkillDraft, b: SkillDraft): boolean {
  return a.name !== b.name || a.description !== b.description || a.body !== b.body;
}

const label = { display: "block", fontSize: "0.8rem", fontWeight: 600, margin: "10px 0 4px" } as const;
const hint = { fontSize: "0.72rem", color: "var(--text-muted)", margin: "2px 0 0" } as const;

export function SkillEditor({ lang, mode, doc, busy, onSave, onCancel, onAskAgent }: Props) {
  const T = (k: Parameters<typeof catalogText>[1], v?: Record<string, string>) => catalogText(lang, k, v);
  const start = useMemo(() => initialDraft(mode, lang, doc), [mode, lang, doc]);
  const [draft, setDraft] = useState<SkillDraft>(start);
  const [problem, setProblem] = useState<DraftProblem>(null);
  const readOnly = mode === "view";
  const set = (k: keyof SkillDraft) => (e: { target: { value: string } }) => {
    setDraft({ ...draft, [k]: k === "name" ? e.target.value.trim().toLowerCase() : e.target.value });
    setProblem(null);
  };

  const submit = () => {
    const p = draftProblem(draft, mode === "new");
    if (p) {
      setProblem(p);
      return;
    }
    onSave(draft);
  };
  const cancel = async () => {
    if (!readOnly && isDirty(draft, start) && !(await confirmDialog(T("unsavedChanges"), lang))) return;
    onCancel();
  };

  const field = (bad: boolean) => ({
    width: "100%", boxSizing: "border-box" as const,
    ...(bad ? { borderColor: "#ef4444" } : {}),
  });

  return (
    <div className="skill-editor" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <h4 style={{ margin: 0 }}>
          {T(mode === "new" ? "editorNew" : mode === "edit" ? "editorEdit" : "editorView")}
          {doc && mode !== "new" && <span style={{ fontWeight: 400, marginLeft: "8px" }}>{doc.name}</span>}
        </h4>
        {mode === "edit" && onAskAgent && (
          <button className="secondary" disabled={busy} onClick={onAskAgent} style={{ padding: "4px 10px", fontSize: "0.75rem" }}>
            {T("improveWithAi")}
          </button>
        )}
      </div>
      {readOnly && <p style={hint}>{T("readOnlyNote")}</p>}

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: "4px" }}>
        {mode === "new" && (
          <>
            <label style={label} htmlFor="skill-name">{T("fieldName")}</label>
            <input id="skill-name" className="dialog-field" value={draft.name} onChange={set("name")}
              disabled={busy} placeholder="weekly-report" autoFocus spellCheck={false}
              style={field(problem === "name")} />
            <p style={hint}>{T("fieldNameHint")}</p>
          </>
        )}

        <label style={label} htmlFor="skill-description">{T("fieldDescription")}</label>
        <textarea id="skill-description" className="dialog-field" value={draft.description} onChange={set("description")}
          disabled={busy} readOnly={readOnly} rows={3}
          style={{ ...field(problem === "description"), resize: "vertical" }} />
        {!readOnly && <p style={hint}>{T("fieldDescriptionHint")}</p>}

        <label style={label} htmlFor="skill-body">{T("fieldBody")}</label>
        <textarea id="skill-body" className="dialog-field" value={draft.body} onChange={set("body")}
          disabled={busy} readOnly={readOnly} rows={16} spellCheck={false}
          style={{ ...field(problem === "body"), fontFamily: "var(--mono-font, monospace)", fontSize: "0.8rem", resize: "vertical" }} />
        {!readOnly && <p style={hint}>{T("fieldBodyHint")}</p>}

        {doc && doc.extra_files.length > 0 && (
          <>
            <div style={label}>{T("extraFiles")}</div>
            <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {doc.extra_files.map((f) => <li key={f}><code>{f}</code></li>)}
            </ul>
          </>
        )}
      </div>

      {problem && (
        <div role="alert" style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "8px" }}>{T(`problem_${problem}`)}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
        <button className="secondary" onClick={() => void cancel()} disabled={busy}>
          {readOnly ? T("hide") : T("cancel")}
        </button>
        {!readOnly && (
          <button className="primary" onClick={submit} disabled={busy}>
            {T(mode === "new" ? "create" : "save")}
          </button>
        )}
      </div>
    </div>
  );
}
