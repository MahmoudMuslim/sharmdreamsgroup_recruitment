"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Info,
  ListChecks,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  X,
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
import { Badge, Button, Card, EmptyState } from "@/modules/analytics/presentation/ui";
import {
  deleteGateQuestion,
  moveGateQuestion,
  saveGateQuestion,
  setGateQuestionActive,
  type GateDraft,
  type GateResult,
} from "./actions";
import type { GateOption, GateQuestion } from "@/modules/careers/gate-questions";

/**
 * Authoring console for the no-points questions on the public apply form.
 *
 * The whole point of this screen is that an answer can end an application, so
 * every part of it states what a "rules out" answer does rather than leaving it
 * implied — a recruiter who sets one by accident has just closed the door on
 * every candidate who picks it.
 */

interface JobOption {
  id: string;
  title: string;
}

/** A new question starts as Yes / No, because that is what most of them are. */
function blankDraft(): GateDraft {
  return {
    id: null,
    job_id: null,
    question: "",
    help_text: "",
    options: [
      { label: "Yes", passes: true },
      { label: "No", passes: false },
    ],
    is_active: true,
    position: 0,
  };
}

function draftFrom(question: GateQuestion): GateDraft {
  return {
    id: question.id,
    job_id: question.jobId,
    question: question.question,
    help_text: question.helpText ?? "",
    options: question.options.map((option) => ({ ...option })),
    is_active: question.isActive,
    position: question.position,
  };
}

export function GateQuestionBoard({
  questions,
  jobs,
  canManage,
}: {
  questions: GateQuestion[];
  jobs: JobOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<GateDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const titles = useMemo(() => new Map(jobs.map((job) => [job.id, job.title])), [jobs]);

  /** Where a question is asked, in words a recruiter can trust. */
  const askWhere = (jobId: string | null): string => {
    if (!jobId) return "Every open role";
    return titles.get(jobId) ?? "A role that is no longer published";
  };

  const groups = useMemo(() => {
    const shared: GateQuestion[] = [];
    const perJob = new Map<string, GateQuestion[]>();

    for (const question of questions) {
      if (!question.jobId) {
        shared.push(question);
        continue;
      }
      const existing = perJob.get(question.jobId);
      if (existing) existing.push(question);
      else perJob.set(question.jobId, [question]);
    }

    return { shared, perJob: [...perJob.entries()] };
  }, [questions]);

  async function apply(action: () => Promise<GateResult>, done: string): Promise<boolean> {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const result = await action();
      if (result.ok) {
        setNotice(done);
        // The list comes from the database rather than local state, so a saved
        // question shows up in the order the server put it.
        router.refresh();
      } else {
        setError(result.error ?? "That change could not be saved.");
      }
      return result.ok;
    } finally {
      setPending(false);
    }
  }

  async function submitDraft() {
    if (!draft) return;
    const saved = await apply(
      () => saveGateQuestion(draft),
      draft.id ? "Question updated." : "Question added to the apply form."
    );
    if (saved) setDraft(null);
  }

  function edit(question: GateQuestion) {
    setError(null);
    setNotice(null);
    setDraft(draftFrom(question));
  }

  function toggleActive(question: GateQuestion) {
    void apply(
      () => setGateQuestionActive(question.id, !question.isActive),
      question.isActive ? "Question is no longer asked." : "Question is asked again."
    );
  }

  function remove(question: GateQuestion) {
    // Deleting cannot un-answer a question that has already been put to
    // somebody, because the answer is stored as text on the application.
    const confirmed = window.confirm(
      `Stop asking “${question.question}”?\n\n` +
        "Applications that already answered it keep their answers and their stage."
    );
    if (!confirmed) return;
    void apply(() => deleteGateQuestion(question.id), "Question deleted.");
  }

  function move(question: GateQuestion, direction: "up" | "down") {
    void apply(() => moveGateQuestion(question.id, direction), "Order updated.");
  }

  /* ------------------------------------------------------------ draft editing */

  function patchDraft(patch: Partial<GateDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function patchOption(index: number, patch: Partial<GateOption>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option, at) =>
              at === index ? { ...option, ...patch } : option
            ),
          }
        : current
    );
  }

  function removeOption(index: number) {
    setDraft((current) =>
      current
        ? { ...current, options: current.options.filter((_, at) => at !== index) }
        : current
    );
  }

  function addOption() {
    setDraft((current) =>
      current
        ? {
            ...current,
            // Rules out by default: an answer that quietly admits someone nobody
            // can hire is harder to notice than one that wrongly turns them away.
            options: [...current.options, { label: "", passes: false }],
          }
        : current
    );
  }

  /* ------------------------------------------------------------- row renderer */

  const renderRow = (question: GateQuestion, index: number, groupSize: number) => (
    <GateRow
      key={question.id}
      question={question}
      askWhere={askWhere(question.jobId)}
      order={index + 1}
      isFirst={index === 0}
      isLast={index === groupSize - 1}
      disabled={pending}
      onEdit={() => edit(question)}
      onMove={move}
      onToggleActive={toggleActive}
      onDelete={remove}
    />
  );

  /* -------------------------------------------------------------------- view */

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-dark" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">What these questions do</h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-brand-ink/65">
              <li>
                They carry no points and are not part of the assessment. Each one is a requirement
                the applicant answers about themselves.
              </li>
              <li>
                An answer marked <strong>Rules out</strong> rejects the application the moment it is
                submitted: it is stored as Rejected, with the question and the answer recorded as the
                reason, and the AI screening step is skipped.
              </li>
              <li>
                The candidate is told politely on the form, and the rejection also runs through the
                standard stage-change notice path that the automatic screening rejection uses.
              </li>
              <li>
                Candidates see the question and its possible answers. Which answer the role accepts
                is never sent to their browser — it is scored on the server.
              </li>
              <li>An applicant turned down this way can apply again; the rejection does not block them.</li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-brand-ink/55">
          {questions.length === 0
            ? "No questions yet — every application reaches the pipeline unanswered."
            : `${questions.filter((question) => question.isActive).length} of ${questions.length} asked on the apply form.`}
        </p>
        {canManage && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setError(null);
              setNotice(null);
              setDraft(blankDraft());
            }}
            disabled={pending}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add question
          </Button>
        )}
      </div>

      <FormMessage error={error} success={notice} />

      {questions.length === 0 ? (
        <Card>
          <EmptyState
            title="No viability questions"
            description="Ask the questions that decide whether a role is even open to an applicant — work eligibility, shift acceptance, a licence, minimum experience. Anything that saves a recruiter from reading a CV that cannot be hired."
            icon={<ListChecks className="h-8 w-8" aria-hidden />}
          />
        </Card>
      ) : (
        <>
          {groups.shared.length > 0 && (
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45">
                Every open role
              </h2>
              <div className="space-y-2">
                {groups.shared.map((question, index) =>
                  renderRow(question, index, groups.shared.length)
                )}
              </div>
            </section>
          )}

          {groups.perJob.map(([jobId, rows]) => (
            <section key={jobId}>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45">
                {askWhere(jobId)}
              </h2>
              <div className="space-y-2">
                {rows.map((question, index) => renderRow(question, index, rows.length))}
              </div>
            </section>
          ))}
        </>
      )}

      {/* --------------------------------------------------------------- drawer */}
      {draft && (
        <Drawer
          open
          onClose={() => setDraft(null)}
          eyebrow={draft.id ? "Edit question" : "New question"}
          title="On the apply form"
          subtitle="No points. A ruling-out answer rejects the application on arrival."
          onSubmit={submitDraft}
          width="max-w-lg"
          footer={
            <DrawerActions
              onCancel={() => setDraft(null)}
              submitLabel={draft.id ? "Save changes" : "Add question"}
              pending={pending}
              note="Candidates are told they were not selected in polite terms, without being shown which answer decided it."
            />
          }
        >
          <div className="space-y-4">
            <Field label="Ask it for" htmlFor="gq-scope">
              <Select
                id="gq-scope"
                value={draft.job_id ?? ""}
                onChange={(event) => patchDraft({ job_id: event.target.value || null })}
              >
                <option value="">Every open role</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Question" htmlFor="gq-question" required>
              <TextArea
                id="gq-question"
                rows={2}
                value={draft.question}
                onChange={(event) => patchDraft({ question: event.target.value })}
                placeholder="Are you legally eligible to work in Egypt?"
              />
            </Field>

            <Field
              label="Guidance under the question"
              htmlFor="gq-help"
              hint="Optional. Useful when an answer needs a definition — “rotating shifts”, “minimum experience”."
            >
              <TextInput
                id="gq-help"
                value={draft.help_text}
                onChange={(event) => patchDraft({ help_text: event.target.value })}
                placeholder="Including shifts that change week to week."
              />
            </Field>

            <div>
              <span className="mb-1.5 block text-xs font-bold">
                Answers <span className="ml-1 text-rose-600">*</span>
              </span>
              <div className="space-y-2">
                {draft.options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <TextInput
                      value={option.label}
                      aria-label={`Answer ${index + 1}`}
                      onChange={(event) =>
                        patchOption(index, { label: event.target.value })
                      }
                      placeholder={`Answer ${index + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => patchOption(index, { passes: !option.passes })}
                      className={`shrink-0 rounded-xl border px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide transition ${
                        option.passes
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                      }`}
                      title="Toggle whether this answer keeps the application in the running"
                    >
                      {option.passes ? "Accepts" : "Rules out"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      disabled={draft.options.length <= 2}
                      aria-label={`Remove answer ${index + 1}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/45 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => addOption()}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-brand-ink/60 underline"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add another answer
              </button>
              <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-brand-ink/45">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                A new answer starts as Rules out, so check the green one is the answer you accept.
              </p>
            </div>

            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) =>
                  patchDraft({ is_active: event.target.checked })
                }
                className="h-4 w-4 accent-brand-gold-dark"
              />
              Ask this question on the apply form
            </label>
          </div>
        </Drawer>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* One question row                                                           */
/* ------------------------------------------------------------------------- */

function GateRow({
  question,
  askWhere,
  order,
  isFirst,
  isLast,
  disabled,
  onEdit,
  onMove,
  onToggleActive,
  onDelete,
}: {
  question: GateQuestion;
  askWhere: string;
  order: number;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onEdit: () => void;
  onMove: (question: GateQuestion, direction: "up" | "down") => void;
  onToggleActive: (question: GateQuestion) => void;
  onDelete: (question: GateQuestion) => void;
}) {
  return (
    <div
      className={`rounded-2xl border border-brand-line bg-white p-4 shadow-soft sm:p-5 ${
        question.isActive ? "" : "opacity-60"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-sand text-xs font-bold text-brand-ink/60">
          {order}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{question.question}</p>
          {question.helpText && (
            <p className="mt-1 text-xs leading-relaxed text-brand-ink/50">{question.helpText}</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={question.jobId ? "info" : "gold"}>{askWhere}</Badge>
            {!question.isActive && <Badge tone="neutral">Not asked</Badge>}
            {question.options.map((option) => (
              <Badge key={option.label} tone={option.passes ? "success" : "danger"}>
                {option.label} · {option.passes ? "accepts" : "rules out"}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onMove(question, "up")}
            disabled={disabled || isFirst}
            aria-label={`Move “${question.question}” up`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line text-brand-ink/50 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onMove(question, "down")}
            disabled={disabled || isLast}
            aria-label={`Move “${question.question}” down`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line text-brand-ink/50 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} disabled={disabled}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onToggleActive(question)} disabled={disabled}>
            {question.isActive ? "Stop asking" : "Ask again"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(question)} disabled={disabled}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
