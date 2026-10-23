"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  Scale,
  Search,
  Send,
  Sparkles,
  Table2,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { saveTemplate, assignTemplate, deleteTemplate, setTemplateActive } from "./assessment-actions";
import { searchSuites, suiteSearchWords } from "@/modules/assessment/domain/suiteSearch";
import { followUpBandText, readFollowUpRuleInput } from "@/modules/assessment/domain/followUp";
import type {
  FollowUpRulesRead,
  FollowUpSuiteOption,
  IssuedLinksRead,
  SuiteFollowUp,
  TemplateSummary,
} from "./actions";
import { IssuedLinksBoard } from "./IssuedLinksBoard";
import { ItemStatsDrawer } from "./ItemStatsDrawer";
import { QuestionEditorDrawer, type EditableQuestion } from "./QuestionEditorDrawer";
import { SuiteAuthoringDrawer } from "./SuiteAuthoringDrawer";
import { TestRecommendationDrawer } from "./TestRecommendationDrawer";
import { Badge, Card, EmptyState, StatTile } from "@/modules/analytics/presentation/ui";
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
  follow_up_template_id: "",
  follow_up_min_percent: "",
  follow_up_max_percent: "",
};

interface TypeMeta {
  singular: string;
  plural: string;
  icon: LucideIcon;
  chip: string;
}

const TYPE_META: Record<string, TypeMeta> = {
  EXCEL_MODEL: {
    singular: "Excel model",
    plural: "Excel models",
    icon: Table2,
    chip: "bg-emerald-500/12 text-emerald-700",
  },
  VIDEO_PITCH: {
    singular: "Video pitch",
    plural: "Video pitches",
    icon: Video,
    chip: "bg-rose-500/12 text-rose-700",
  },
  CASE_STUDY: {
    singular: "Case study",
    plural: "Case studies",
    icon: BookOpen,
    chip: "bg-sky-500/12 text-sky-700",
  },
  MULTIPLE_CHOICE: {
    singular: "Quiz",
    plural: "Quizzes",
    icon: CheckCircle2,
    chip: "bg-amber-500/15 text-amber-700",
  },
  SITUATIONAL_JUDGMENT: {
    singular: "Judgment scene",
    plural: "Judgment scenes",
    icon: Scale,
    chip: "bg-violet-500/12 text-violet-700",
  },
};

/**
 * Creates a new suite or edits an existing one.
 *
 * This drawer covers suite-level settings only; individual questions are
 * managed by the Questions drawer on each suite card.
 */
export function TemplateEditor({
  options,
  template,
  defaultDurationMinutes,
  followUp,
  suites,
  followUpEditable,
  followUpNote,
  onClose,
}: {
  options: TemplateOptions;
  template: TemplateSummary | null;
  /** `assessment.default_duration_minutes`, pre-filled on a new suite only. */
  defaultDurationMinutes: number;
  /** The stored second-test rule, when this suite has one. */
  followUp: SuiteFollowUp | null;
  /** Every suite a rule could name, already scoped by the server to the caller. */
  suites: FollowUpSuiteOption[];
  /** Both halves of migration 035 are on the database. */
  followUpEditable: boolean;
  /** Why the rule cannot be edited, when it cannot. */
  followUpNote: string | null;
  onClose: () => void;
}) {
  type DraftState = typeof EMPTY;

const [draft, setDraft] = useState<DraftState>(() =>
    template
      ? {
          ...EMPTY,
          id: template.id,
          tenant_id: template.tenant_id,
          name: template.name,
          description: template.description ?? "",
          role_family: template.role_family,
          time_limit_minutes: String(template.time_limit_minutes),
          randomize_questions: template.randomize_questions,
          randomize_options: template.randomize_options,
          block_copy_paste: template.block_copy_paste,
          follow_up_template_id: followUp?.target_id ?? "",
          follow_up_min_percent: followUp ? String(followUp.min_percent) : "",
          follow_up_max_percent: followUp ? String(followUp.max_percent) : "",
        }
      : {
          ...EMPTY,
          tenant_id: options.companies[0]?.id ?? "",
          role_family: options.roleFamilies[0]?.key ?? "GENERAL",
          time_limit_minutes: String(defaultDurationMinutes),
        }
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isEdit = draft.id !== "";

  // A rule may only name a suite in the same company, and never the suite it is
  // written on. The server checks both again — this list keeps the picker from
  // offering a choice that would be refused.
  const followUpTargets = suites.filter(
    (suite) => suite.tenant_id === draft.tenant_id && suite.id !== draft.id
  );
  const chosenTarget = followUpTargets.find(
    (suite) => suite.id === draft.follow_up_template_id
  );

  function set<K extends keyof typeof EMPTY>(field: K, value: (typeof EMPTY)[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (error) setError(null);
    if (saved) setSaved(false);
    if (warning) setWarning(null);
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

    const rule = readFollowUpRuleInput(
      {
        templateId: draft.follow_up_template_id,
        minPercent: draft.follow_up_min_percent,
        maxPercent: draft.follow_up_max_percent,
      },
      draft.id || null
    );
    if (!rule.ok) {
      setError(rule.error);
      return;
    }

    setPending(true);
    setWarning(null);
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
        follow_up: {
          templateId: draft.follow_up_template_id,
          minPercent: draft.follow_up_min_percent,
          maxPercent: draft.follow_up_max_percent,
        },
      });
      if (result.ok) {
        setSaved(true);
        setWarning(result.warning ?? null);
        // A warning is a sentence to read, not a toast to close through.
        if (!result.warning) setTimeout(onClose, 700);
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

        <fieldset className="rounded-xl border border-brand-line bg-brand-cream p-4">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
            Second test
          </legend>
          {followUpEditable ? (
            <div className="space-y-3">
              <Field
                label="Send candidates on to"
                htmlFor="tpl-follow-target"
                hint="When a fully marked paper lands inside the band, this suite is issued automatically."
              >
                <Select
                  id="tpl-follow-target"
                  value={draft.follow_up_template_id}
                  onChange={(e) => set("follow_up_template_id", e.target.value)}
                >
                  <option value="">No second test</option>
                  {followUpTargets.map((suite) => (
                    <option key={suite.id} value={suite.id}>
                      {suite.name}
                      {!suite.is_active ? " — paused" : ""}
                      {suite.question_count === 0 ? " — no questions" : ""}
                    </option>
                  ))}
                </Select>
              </Field>

              {draft.follow_up_template_id !== "" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From (%)" htmlFor="tpl-follow-min">
                    <TextInput
                      id="tpl-follow-min"
                      type="number"
                      min={0}
                      max={100}
                      value={draft.follow_up_min_percent}
                      onChange={(e) => set("follow_up_min_percent", e.target.value)}
                    />
                  </Field>
                  <Field label="To (%)" htmlFor="tpl-follow-max">
                    <TextInput
                      id="tpl-follow-max"
                      type="number"
                      min={0}
                      max={100}
                      value={draft.follow_up_max_percent}
                      onChange={(e) => set("follow_up_max_percent", e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {chosenTarget && (!chosenTarget.is_active || chosenTarget.question_count === 0) && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                  {!chosenTarget.is_active
                    ? "That suite is paused, so no link is issued until it is resumed."
                    : "That suite has no questions, so no link is issued until it has some."}
                </p>
              )}

              <p className="text-[11px] leading-relaxed text-brand-ink/45">
                Both ends of the band count. The link is issued once, as soon as every answer is
                marked, and says it came from this suite.
              </p>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-brand-ink/55">
              {followUpNote ??
                "Second-test routing is not available on this database yet."}
            </p>
          )}
        </fieldset>

        {isEdit && (
          <p className="rounded-xl border border-brand-line px-4 py-3 text-xs leading-relaxed text-brand-ink/55">
            This panel changes suite settings only. Close it and use{" "}
            <strong className="font-bold">Questions</strong> on the suite card to add, edit,
            re-order or delete individual questions.
          </p>
        )}

        {/* A refused rule is a sentence to read, so it sits beside the save
            confirmation rather than replacing it: the suite itself did save. */}
        <FormMessage
          error={error}
          success={saved ? "Suite saved." : null}
          notice={warning}
        />
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
        const count = result.created ?? selected.size;
        setDone(
          `${count} assessment link${count === 1 ? "" : "s"} issued — candidates are being invited on the channels that are switched on.`
        );
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
/* Suite card                                                                 */
/* -------------------------------------------------------------------------- */

function TemplateCard({
  template,
  questions,
  followUp,
  canEdit,
  onQuestions,
  onItemStats,
  onEdit,
  onAssign,
}: {
  template: TemplateSummary;
  questions: EditableQuestion[];
  /** The second-test rule stored on this suite, already resolved to its target. */
  followUp: SuiteFollowUp | null;
  canEdit: boolean;
  onQuestions: () => void;
  onItemStats: () => void;
  onEdit: () => void;
  onAssign: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const typeCounts = new Map<string, number>();
  for (const question of questions) {
    typeCounts.set(question.question_type, (typeCounts.get(question.question_type) ?? 0) + 1);
  }
  const presentTypes = Object.keys(TYPE_META).filter((type) => (typeCounts.get(type) ?? 0) > 0);

  const integrity = [
    template.randomize_questions && "Order randomised",
    template.randomize_options && "Options shuffled",
    template.block_copy_paste && "Copy-paste blocked",
  ].filter((entry): entry is string => Boolean(entry));

  const assignable = template.is_active && template.question_count > 0;
  const assignHint = !template.is_active
    ? "This suite is paused — resume it to assign"
    : "Add questions before assigning";

  async function run(action: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(action);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) setError(result.error ?? `Could not ${action.toLowerCase()}.`);
      else router.refresh();
    } catch {
      setError(`Something went wrong while trying to ${action.toLowerCase()}.`);
    } finally {
      setPending(null);
    }
  }

  function confirmDelete() {
    if (
      !window.confirm(
        `Delete “${template.name}”?\n\nThis removes the suite and its ${template.question_count} question${
          template.question_count === 1 ? "" : "s"
        }. Once candidates have links, the delete is refused and the suite should be paused instead.`
      )
    )
      return;
    run("Delete suite", () => deleteTemplate(template.id));
  }

  return (
    <Card className="group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-brand-gold/50 hover:shadow-lg">
      <div
        className={cn(
          "h-1 w-full",
          template.is_active
            ? "bg-gradient-to-r from-brand-gold-dark via-brand-gold to-brand-gold-light"
            : "bg-brand-line"
        )}
      />
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-snug">{template.name}</h2>
            {template.description && (
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-brand-ink/60">
                {template.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge tone={template.is_active ? "success" : "neutral"}>
              {template.is_active ? "Active" : "Paused"}
            </Badge>
            <span className="rounded-full bg-brand-sand px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-ink/60">
              {template.role_family}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-brand-cream px-4 py-3 sm:grid-cols-4">
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
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
              Assigned
            </dt>
            <dd className="mt-0.5 font-display text-sm font-bold">
              {template.attempts}
              {template.completed > 0 && (
                <span className="ml-1.5 text-[10px] font-bold text-emerald-700">
                  {template.completed} done
                </span>
              )}
            </dd>
          </div>
        </dl>

        {presentTypes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {presentTypes.map((type) => {
              const meta = TYPE_META[type];
              const count = typeCounts.get(type) ?? 0;
              return (
                <span
                  key={type}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold",
                    meta.chip
                  )}
                >
                  <meta.icon className="h-3.5 w-3.5" aria-hidden />
                  {count} {count === 1 ? meta.singular : meta.plural}
                </span>
              );
            })}
          </div>
        )}

        {integrity.length > 0 && (
          <p className="text-[11px] text-brand-ink/45">{integrity.join(" · ")}</p>
        )}

        {followUp && (
          <p className="text-[11px] leading-relaxed text-brand-ink/55">
            Second test:{" "}
            <span className="font-semibold text-brand-ink/75">
              {followUpBandText({
                minPercent: followUp.min_percent,
                maxPercent: followUp.max_percent,
              })}
            </span>{" "}
            moves on to {followUp.target_name}.
          </p>
        )}

        {followUp &&
          (!followUp.target_exists ||
            !followUp.target_active ||
            followUp.target_questions === 0) && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
              {!followUp.target_exists
                ? "The second suite this rule names is not one this page can see, so no link is issued to it."
                : !followUp.target_active
                  ? "The second suite is paused, so no link is issued until it is resumed."
                  : "The second suite has no questions, so no link is issued until it has some."}
            </p>
          )}

        {template.question_count === 0 && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            This suite has no questions yet, so candidates would see an empty test.
          </p>
        )}

        {error && (
          <p role="alert" className="text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}

        {!error && !template.is_active && template.attempts > 0 && (
          <p className="text-[11px] text-brand-ink/45">
            Paused: the {template.attempts} link{template.attempts === 1 ? "" : "s"} already issued
            stay{template.attempts === 1 ? "s" : ""} open, so nobody is locked out mid-test.
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 border-t border-brand-line pt-4">
          <button
            type="button"
            onClick={onQuestions}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cream px-2.5 py-1.5 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            Questions
          </button>
          <button
            type="button"
            onClick={onItemStats}
            title="How each question scored, across every graded paper of this suite"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cream px-2.5 py-1.5 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand"
          >
            <BarChart3 className="h-3.5 w-3.5" aria-hidden />
            Statistics
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit suite
          </button>
          <button
            type="button"
            onClick={onAssign}
            disabled={!assignable}
            title={assignable ? "Assign this suite to candidates" : assignHint}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
              assignable
                ? "bg-brand-gold/15 text-brand-gold-dark hover:bg-brand-gold/25"
                : "cursor-not-allowed bg-brand-sand text-brand-ink/40"
            )}
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            Assign
          </button>
          {canEdit && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() =>
                run(template.is_active ? "Pause suite" : "Resume suite", () =>
                  setTemplateActive(template.id, !template.is_active)
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50"
            >
              {template.is_active ? (
                <Pause className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden />
              )}
              {template.is_active
                ? pending === "Pause suite"
                  ? "Pausing…"
                  : "Pause"
                : pending === "Resume suite"
                  ? "Resuming…"
                  : "Resume"}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={confirmDelete}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Client wrapper                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Assessment template grid with working actions.
 *
 * Carries its own search, role-family and status filters plus an at-a-glance
 * summary; every card action opens a real drawer that persists to the database.
 */
export function AssessmentGrid({
  templates,
  candidates,
  options,
  questionsByTemplate,
  defaultDurationMinutes,
  canEdit,
  links,
  timeZone,
  situational,
  followUps,
}: {
  templates: TemplateSummary[];
  candidates: AssignableCandidate[];
  options: TemplateOptions;
  questionsByTemplate: Record<string, EditableQuestion[]>;
  defaultDurationMinutes: number;
  canEdit: boolean;
  /** Every link the pipeline holds, with the count the whole set carries. */
  links: IssuedLinksRead;
  /** `organisation.timezone` — the clock a link's deadline runs on for the group. */
  timeZone: string;
  /** Whether the database's enum accepts the situational judgment label yet. */
  situational: { situational: boolean; note: string | null };
  /** Second-test rules, or the reason they cannot be read or routed. */
  followUps: FollowUpRulesRead;
}) {
  // Both tables migration 035 adds have to be present for a rule to be worth
  // writing: columns without the attempt link would save a rule nothing can
  // ever act on, and the link without the columns has no rule to act on.
  const followUpEditable = followUps.rules_available && followUps.routing_available;
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [assigning, setAssigning] = useState<TemplateSummary | null>(null);
  const [questionEditing, setQuestionEditing] = useState<TemplateSummary | null>(null);
  // `?stats=` opens one suite's item table from the address bar, which is what
  // lets an assistant answer about difficulty and discrimination link to the
  // rows it counted. The id is matched against every suite the page holds, not
  // the filtered view: a chat answer may name a suite this grid's own box is
  // currently hiding, and a link that lands on nothing reads as a broken answer.
  const statsTarget = (id: string | null) =>
    id ? templates.find((template) => template.id === id) ?? null : null;
  const [statViewing, setStatViewing] = useState<TemplateSummary | null>(() =>
    statsTarget(params.get("stats")),
  );
  const incomingStats = params.get("stats");
  const [lastAppliedStats, setLastAppliedStats] = useState(incomingStats);
  if (incomingStats !== lastAppliedStats) {
    setLastAppliedStats(incomingStats);
    setStatViewing(statsTarget(incomingStats));
  }
  const [draftingSuite, setDraftingSuite] = useState(false);
  const [recommendingTests, setRecommendingTests] = useState(false);

  // `?q=` seeds the box so an assistant answer that searched the suites lands on
  // the suites it named, not on a grid holding the whole catalogue. Typing stays
  // local until the URL itself changes: arriving on this route again re-renders
  // rather than remounts, so the last value taken from the address bar is tracked
  // and applied here too.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const incomingQuery = params.get("q");
  const [lastAppliedQuery, setLastAppliedQuery] = useState(incomingQuery);
  if (incomingQuery !== lastAppliedQuery) {
    setLastAppliedQuery(incomingQuery);
    setQuery(incomingQuery ?? "");
  }

  const [family, setFamily] = useState("ALL");
  const [status, setStatus] = useState<"all" | "active" | "paused">("all");

  const families = useMemo(() => {
    const keys = new Set(templates.map((template) => template.role_family));
    return [...keys].sort();
  }, [templates]);

  const familyLabel = (key: string) => {
    const known = options.roleFamilies.find((entry) => entry.key === key)?.label;
    if (known) return known;
    // Master data may not cover every stored family — prettify the raw key.
    return key
      .toLowerCase()
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const filtered = useMemo(() => {
    // The words run through the same predicate the assistant's `query` uses, so
    // a suite the chat names is a suite this box finds. Family and status stay
    // here — they are this grid's own picklists, not something a search promises.
    return searchSuites(templates, query).filter((template) => {
      if (family !== "ALL" && template.role_family !== family) return false;
      if (status === "active" && !template.is_active) return false;
      if (status === "paused" && template.is_active) return false;
      return true;
    });
  }, [templates, query, family, status]);

  const activeCount = templates.filter((template) => template.is_active).length;
  const totalQuestions = templates.reduce((sum, template) => sum + template.question_count, 0);
  const totalAssigned = templates.reduce((sum, template) => sum + template.attempts, 0);
  const totalCompleted = templates.reduce((sum, template) => sum + template.completed, 0);
  const avgDuration = templates.length
    ? Math.round(
        templates.reduce((sum, template) => sum + template.time_limit_minutes, 0) /
          templates.length
      )
    : 0;

  const filtersActive = query.trim() !== "" || family !== "ALL" || status !== "all";

  function clearFilters() {
    setQuery("");
    setFamily("ALL");
    setStatus("all");
  }

  return (
    <>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile
            label="Suites"
            value={templates.length}
            hint={`${activeCount} active · ${templates.length - activeCount} paused`}
            icon={<ClipboardCheck className="h-5 w-5" aria-hidden />}
          />
          <StatTile
            label="Questions"
            value={totalQuestions}
            hint="Across every suite"
            icon={<ListChecks className="h-5 w-5" aria-hidden />}
          />
          <StatTile
            label="Assigned links"
            value={totalAssigned}
            hint={
              `${totalCompleted} completed run${totalCompleted === 1 ? "" : "s"}` +
              // The suites count every link ever issued; the board below refuses a
              // filed-away candidate's. Naming the difference stops the two numbers
              // reading like a mistake in one of them.
              (totalAssigned > links.total
                ? ` · ${links.total.toLocaleString()} of them belong to candidates still in the pipeline, and only those are listed below`
                : "")
            }
            icon={<Send className="h-5 w-5" aria-hidden />}
          />
          <StatTile
            label="Avg duration"
            value={`${avgDuration} min`}
            hint="Per attempt"
            icon={<Clock className="h-5 w-5" aria-hidden />}
          />
        </div>

        <div className="flex flex-col gap-3 2xl:flex-row 2xl:flex-wrap 2xl:items-center 2xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative sm:max-w-xs sm:flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/35"
                aria-hidden
              />
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search by ${suiteSearchWords()}…`}
                aria-label="Search suites"
                className="pl-9"
              />
            </div>
            <Select
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              aria-label="Filter by role family"
              className="sm:w-44"
            >
              <option value="ALL">All families</option>
              {families.map((key) => (
                <option key={key} value={key}>
                  {familyLabel(key)}
                </option>
              ))}
            </Select>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | "active" | "paused")}
              aria-label="Filter by status"
              className="sm:w-36"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </Select>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => setRecommendingTests(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-line bg-brand-cream px-4 py-2.5 text-sm font-semibold transition hover:bg-brand-sand"
              >
                <ListChecks className="h-4 w-4" aria-hidden />
                Recommend tests
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => setDraftingSuite(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-brand-sand"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Draft a suite
              </button>
            )}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New template
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              title={templates.length === 0 ? "No assessment suites yet" : "No suites match"}
              description={
                templates.length === 0
                  ? "Create a suite to start evaluating candidates with Excel models, video pitches and case studies. The New template button above opens a blank one."
                  : `Nothing matches the current search and filters (${templates.length} suite${
                      templates.length === 1 ? "" : "s"
                    } in total).`
              }
              icon={
                templates.length === 0 ? (
                  <ClipboardCheck className="h-8 w-8" aria-hidden />
                ) : (
                  <Search className="h-8 w-8" aria-hidden />
                )
              }
            />
            {filtersActive && (
              <div className="flex justify-center pb-8">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-brand-sand"
                >
                  Clear filters
                </button>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {filtered.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                questions={questionsByTemplate[template.id] ?? []}
                followUp={followUps.byTemplate[template.id] ?? null}
                canEdit={canEdit}
                onQuestions={() => setQuestionEditing(template)}
                onItemStats={() => setStatViewing(template)}
                onEdit={() => setEditing(template)}
                onAssign={() => setAssigning(template)}
              />
            ))}
          </div>
        )}

        <IssuedLinksBoard read={links} timeZone={timeZone} />
      </div>

      {creating && (
        <TemplateEditor
          options={options}
          template={null}
          defaultDurationMinutes={defaultDurationMinutes}
          followUp={null}
          suites={followUps.suites}
          followUpEditable={followUpEditable}
          followUpNote={followUps.note}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <TemplateEditor
          options={options}
          template={editing}
          defaultDurationMinutes={defaultDurationMinutes}
          followUp={followUps.byTemplate[editing.id] ?? null}
          suites={followUps.suites}
          followUpEditable={followUpEditable}
          followUpNote={followUps.note}
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
      {questionEditing && (
        <QuestionEditorDrawer
          open
          onClose={() => setQuestionEditing(null)}
          templateId={questionEditing.id}
          templateName={questionEditing.name}
          questions={questionsByTemplate[questionEditing.id] ?? []}
          editable={canEdit}
          situationalAvailable={situational.situational}
          situationalNote={situational.note}
          onChanged={router.refresh}
        />
      )}
      {statViewing && (
        <ItemStatsDrawer
          templateId={statViewing.id}
          templateName={statViewing.name}
          onClose={() => setStatViewing(null)}
        />
      )}
      {draftingSuite && (
        <SuiteAuthoringDrawer
          open
          onClose={() => setDraftingSuite(false)}
          options={options}
          defaultDurationMinutes={defaultDurationMinutes}
          onCreated={router.refresh}
        />
      )}
      {canEdit && recommendingTests && (
        <TestRecommendationDrawer
          onClose={() => setRecommendingTests(false)}
          defaultDurationMinutes={defaultDurationMinutes}
        />
      )}
    </>
  );
}