"use client";

import { useState } from "react";
import { Info, Plus, X } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import {
  saveGateQuestion,
  type GateDraft,
  type GateResult,
} from "./actions";
import type { GateOption, GateQuestion } from "@/modules/careers/gate-questions";

/**
 * The apply-form question editor, ported from the console this page replaced.
 *
 * Its rules travel with it: the same `jobs.manage` write, the same field limits,
 * the same two answers minimum with at least one accepted, and the same promise
 * that an applicant is never told which answer ended their application. The
 * questions carry no points and a "Rules out" answer rejects on arrival, so the
 * drawer states that rather than leaving it implied — a recruiter who sets one by
 * accident has closed the door on every candidate who picks it.
 */

/** A published role the form can be asked on. */
export interface JobChoice {
  id: string;
  label: string;
}

/** What the drawer was opened for: an existing row, or a new question in a place. */
export type GateDrawerOpen =
  | { mode: "edit"; question: GateQuestion }
  | { mode: "new"; jobId: string | null };

/** A new question starts as Yes / No, because that is what most of them are. */
function blankDraft(jobId: string | null): GateDraft {
  return {
    id: null,
    job_id: jobId,
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

/**
 * The role options, plus the one this question is already asked on.
 *
 * Only published roles are offered, because a question parked on a role nobody can
 * apply to is asked by nobody — the board refuses that drop for the same reason.
 * An edit keeps its own role listed even once that role is closed: dropping it from
 * the list would leave the select showing "Every open role" over a question scoped
 * to one, so a save that changed nothing else would silently re-scope it.
 */
function roleOptions(
  jobs: readonly JobChoice[],
  jobId: string | null,
  heldLabel: string | null
): { value: string; label: string }[] {
  const list = jobs.map((job) => ({ value: job.id, label: job.label }));
  if (jobId && !jobs.some((job) => job.id === jobId)) {
    list.unshift({
      value: jobId,
      label: `${heldLabel ?? "A role no longer on file"} — not published`,
    });
  }
  return list;
}

export function GateQuestionDrawer({
  open,
  initial,
  jobs,
  heldLabel,
  onClose,
  onWritten,
}: {
  open: boolean;
  initial: GateDrawerOpen;
  jobs: readonly JobChoice[];
  /** The name of the role an edited question is asked on, when it is not published. */
  heldLabel: string | null;
  onClose: () => void;
  /** Called with the sentence to print, after the row is in the database. */
  onWritten: (message: string) => void;
}) {
  const [draft, setDraft] = useState<GateDraft>(() =>
    initial.mode === "edit" ? draftFrom(initial.question) : blankDraft(initial.jobId)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<GateDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  }

  function patchOption(index: number, next: Partial<GateOption>) {
    setDraft((current) => ({
      ...current,
      options: current.options.map((option, at) =>
        at === index ? { ...option, ...next } : option
      ),
    }));
    setError(null);
  }

  function removeOption(index: number) {
    setDraft((current) => ({
      ...current,
      options: current.options.filter((_, at) => at !== index),
    }));
  }

  function addOption() {
    setDraft((current) => ({
      ...current,
      // Rules out by default: an answer that quietly admits someone nobody
      // can hire is harder to notice than one that wrongly turns them away.
      options: [...current.options, { label: "", passes: false }],
    }));
  }

  async function submit() {
    setPending(true);
    setError(null);
    let result: GateResult;
    try {
      result = await saveGateQuestion(draft);
    } catch {
      result = { ok: false, error: "The portal did not answer, so the question was not saved." };
    }
    setPending(false);

    if (!result.ok) {
      setError(result.error ?? "That question could not be saved.");
      return;
    }
    onWritten(draft.id ? "Question updated." : "Question added to the apply form.");
    onClose();
  }

  const options = roleOptions(jobs, draft.job_id, heldLabel);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={draft.id ? "Edit question" : "New question"}
      title="On the apply form"
      subtitle="No points. A ruling-out answer rejects the application on arrival."
      onSubmit={submit}
      width="max-w-lg"
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={draft.id ? "Save changes" : "Add question"}
          pending={pending}
          note="An applicant is never told that an answer ruled them out — that would show them which answer to change."
        />
      }
    >
      <div className="space-y-4">
        <Field label="Ask it for" htmlFor="gq-scope">
          <Select
            id="gq-scope"
            value={draft.job_id ?? ""}
            onChange={(event) => patch({ job_id: event.target.value || null })}
          >
            <option value="">Every open role</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Question" htmlFor="gq-question" required>
          <TextArea
            id="gq-question"
            rows={2}
            value={draft.question}
            onChange={(event) => patch({ question: event.target.value })}
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
            onChange={(event) => patch({ help_text: event.target.value })}
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
                  onChange={(event) => patchOption(index, { label: event.target.value })}
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
            onClick={addOption}
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
            onChange={(event) => patch({ is_active: event.target.checked })}
            className="h-4 w-4 accent-brand-gold-dark"
          />
          Ask this question on the apply form
        </label>

        <FormMessage error={error} />
      </div>
    </Drawer>
  );
}
