"use client";

import { useState } from "react";
import { Pencil, Plus, Target } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { saveTemplate, assignTemplate } from "./assessment-actions";
import type { TemplateSummary } from "./actions";
import { Badge, Card } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";

export interface TemplateOptions {
  roleFamilies: { id: string; key: string; label: string }[];
  /** Default company for a newly created suite. */
  companies: { id: string; name: string }[];
}

/* -------------------------------------------------------------------------- */
/* Create + edit                                                              */
/* -------------------------------------------------------------------------- */

const EMPTY = {
  id: "",
  tenant_id: "",
  name: "",
  description: "",
  role_family: "GENERAL",
  time_limit_minutes: "60",
  randomize_questions: false,
  randomize_options: false,
  block_copy_paste: true,
};

const TYPE_LABEL: Record<string, string> = {
  EXCEL_MODEL: "Excel model",
  VIDEO_PITCH: "Video pitch",
  CASE_STUDY: "Case study",
  MULTIPLE_CHOICE: "Quiz",
};

/**
 * Creates a new suite or edits an existing one.
 *
 * Editing is settings-only — the question editor itself is still not built, so
 * the copy says so plainly rather than implying a full builder.
 */
export function TemplateEditor({
  options,
  template,
  onClose,
}: {
  options: TemplateOptions;
  template: TemplateSummary | null;
  onClose: () => void;
}) {
  type DraftState = typeof EMPTY;

const [draft, setDraft] = useState<DraftState>(() =>
    template
      ? {
          ...EMPTY,
          id: template.id,
          name: template.name,
          description: template.description ?? "",
          role_family: template.role_family,
          time_limit_minutes: String(template.time_limit_minutes),
          randomize_questions: template.randomize_questions,
          randomize_options: template.randomize_options,
          block_copy_paste: template.block_copy_paste,
        }
      : {
          ...EMPTY,
          tenant_id: options.companies[0]?.id ?? "",
          role_family: options.roleFamilies[0]?.key ?? "GENERAL",
        }
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const isEdit = draft.id !== "";

  function set<K extends keyof typeof EMPTY>(field: K, value: (typeof EMPTY)[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (error) setError(null);
    if (saved) setSaved(false);
  }

  async function submit() {
    if (!draft.name.trim()) {
      setError("A suite name is required.");
      return;
    }
    const minutes = Number(draft.time_limit_minutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      setError("Duration must be between 5 and 480 minutes.");
      return;
    }

    setPending(true);
    try {
      const result = await saveTemplate({
        id: draft.id || null,
        tenant_id: draft.tenant_id,
        name: draft.name,
        description: draft.description,
        role_family: draft.role_family,
        time_limit_minutes: minutes,
        randomize_questions: draft.randomize_questions,
        randomize_options: draft.randomize_options,
        block_copy_paste: draft.block_copy_paste,
      });
      if (result.ok) {
        setSaved(true);
        setTimeout(onClose, 700);
      } else {
        setError(result.error ?? "Could not save the suite.");
      }
    } catch {
      setError("Something went wrong saving the suite.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Assessment engine"
      title={isEdit ? `Edit ${draft.name || "suite"}` : "New assessment suite"}
      subtitle={isEdit ? "Settings apply to every future attempt." : "Create the shell, then add questions."}
      onSubmit={submit}
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={isEdit ? "Save changes" : "Create suite"}
          pending={pending}
          note={isEdit ? `${draft.role_family} · ${draft.time_limit_minutes} min` : "Questions are added after creation."}
        />
      }
    >
      <div className="space-y-4">
        <Field label="Suite name" htmlFor="tpl-name" required>
          <TextInput
            id="tpl-name"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Finance & Investment Excellence Suite"
          />
        </Field>

        <Field label="Description" htmlFor="tpl-desc">
          <TextArea
            id="tpl-desc"
            rows={3}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What this suite measures and who it is for."
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Role family" htmlFor="tpl-family">
            <Select
              id="tpl-family"
              value={draft.role_family}
              onChange={(e) => set("role_family", e.target.value)}
            >
              {options.roleFamilies.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Duration (minutes)" htmlFor="tpl-duration" required>
            <TextInput
              id="tpl-duration"
              type="number"
              min={5}
              max={480}
              value={draft.time_limit_minutes}
              onChange={(e) => set("time_limit_minutes", e.target.value)}
            />
          </Field>
        </div>

        {!isEdit && (
          <Field label="Company" htmlFor="tpl-company" required>
            <Select
              id="tpl-company"
              value={draft.tenant_id}
              onChange={(e) => set("tenant_id", e.target.value)}
            >
              {options.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <fieldset className="rounded-xl border border-brand-line bg-brand-cream p-4">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
            Integrity
          </legend>
          <div className="space-y-2.5">
            {(
              [
                ["randomize_questions", "Randomise question order per candidate"],
                ["randomize_options", "Randomise multiple-choice options"],
                ["block_copy_paste", "Block copy and paste during the test"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-brand-line"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-brand-ink/45">
            Candidates are always told when something is recorded.
          </p>
        </fieldset>

        {isEdit && (
          <p className="rounded-xl border border-brand-line px-4 py-3 text-xs leading-relaxed text-brand-ink/55">
            This suite already has questions. Editing questions individually is not
            available yet — this panel changes suite settings only.
          </p>
        )}

        <FormMessage error={error} success={saved ? "Suite saved." : null} />
      </div>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Assign                                                                     */
/* -------------------------------------------------------------------------- */

interface AssignableCandidate {
  id: string;
  full_name: string;
  stage: string;
  job_title: string | null;
}

/**
 * Assigns a suite to candidates.
 *
 * Creates one assessment attempt per selected application with a unique,
 * unguessable access token — the same token the candidate portal uses.
 */
export function AssignDrawer({
  template,
  candidates,
  onClose,
}: {
  template: TemplateSummary;
  candidates: AssignableCandidate[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState(String(template.time_limit_minutes));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function submit() {
    if (selected.size === 0) {
      setError("Select at least one candidate.");
      return;
    }
    setPending(true);
    try {
      const result = await assignTemplate({
        templateId: template.id,
        applicationIds: [...selected],
        timeLimitMinutes: Number(minutes),
      });
      if (result.ok) {
        setDone(`${result.created ?? selected.size} assessment link${(result.created ?? 0) === 1 ? "" : "s"} issued.`);
        setTimeout(onClose, 1200);
      } else {
        setError(result.error ?? "Could not assign the suite.");
      }
    } catch {
      setError("Something went wrong assigning the suite.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Assessment engine"
      title={`Assign “${template.name}”`}
      subtitle="Each candidate gets a private, unguessable link."
      onSubmit={submit}
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={`Assign to ${selected.size}`}
          pending={pending}
          note="Links expire with the time limit."
        />
      }
    >
      <div className="space-y-4">
        <Field label="Time limit (minutes)" htmlFor="assign-duration" required>
          <TextInput
            id="assign-duration"
            type="number"
            min={5}
            max={480}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-bold">
            Candidates <span className="text-brand-ink/45">({selected.size} selected)</span>
          </p>
          <ul className="max-h-64 divide-y divide-brand-line overflow-y-auto rounded-xl border border-brand-line">
            {candidates.length === 0 && (
              <li className="px-3.5 py-4 text-sm text-brand-ink/45">No candidates available.</li>
            )}
            {candidates.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 hover:bg-brand-cream">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-0.5 h-4 w-4 rounded border-brand-line"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{c.full_name}</span>
                    <span className="block truncate text-xs text-brand-ink/50">
                      {c.job_title ?? "No role"} · {c.stage.replace("_", " ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <FormMessage error={error} success={done} />
      </div>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Client wrapper                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Assessment template grid with working actions.
 *
 * "Edit suite" and "Assign" were previously inert buttons; they now open real
 * drawers that persist to the database.
 */
export function AssessmentGrid({
  templates,
  candidates,
  options,
}: {
  templates: TemplateSummary[];
  candidates: AssignableCandidate[];
  options: TemplateOptions;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [assigning, setAssigning] = useState<TemplateSummary | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
      >
        <Plus className="h-4 w-4" aria-hidden />
        New template
      </button>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {templates.map((template) => (
          <Card key={template.id} className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold leading-snug">{template.name}</h2>
                {template.description && (
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-brand-ink/60">
                    {template.description}
                  </p>
                )}
              </div>
              <Badge tone={template.is_active ? "success" : "neutral"}>
                {template.is_active ? "Active" : "Paused"}
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-brand-cream px-4 py-3 sm:grid-cols-4">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                  Family
                </dt>
                <dd className="mt-0.5 truncate text-xs font-bold">{template.role_family}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                  Duration
                </dt>
                <dd className="mt-0.5 font-display text-sm font-bold">
                  {template.time_limit_minutes} min
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                  Questions
                </dt>
                <dd className="mt-0.5 font-display text-sm font-bold">{template.question_count}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                  Points
                </dt>
                <dd className="mt-0.5 font-display text-sm font-bold">{template.total_points}</dd>
              </div>
            </dl>

            {template.question_count === 0 && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                This suite has no questions yet, so candidates would see an empty test.
              </p>
            )}

            <div className="mt-auto flex flex-wrap gap-2 border-t border-brand-line pt-4">
              <button
                type="button"
                onClick={() => setEditing(template)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit suite
              </button>
              <button
                type="button"
                onClick={() => setAssigning(template)}
                disabled={template.question_count === 0}
                title={
                  template.question_count === 0
                    ? "Add questions before assigning"
                    : "Assign this suite to candidates"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                  template.question_count === 0
                    ? "cursor-not-allowed bg-brand-sand text-brand-ink/40"
                    : "bg-brand-cream text-brand-ink/70 hover:bg-brand-sand"
                )}
              >
                <Target className="h-3.5 w-3.5" aria-hidden />
                Assign
              </button>
            </div>
          </Card>
        ))}
      </div>

      {creating && (
        <TemplateEditor
          options={options}
          template={null}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <TemplateEditor
          options={options}
          template={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {assigning && (
        <AssignDrawer
          template={assigning}
          candidates={candidates}
          onClose={() => setAssigning(null)}
        />
      )}
    </>
  );
}

export { TYPE_LABEL };