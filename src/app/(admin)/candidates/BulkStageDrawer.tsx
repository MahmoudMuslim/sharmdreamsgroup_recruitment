"use client";

import { useState } from "react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
} from "@/modules/analytics/presentation/Form";
import { humanizeStage } from "@/modules/settings/domain/templates";
import {
  BULK_STAGE_LIMIT,
  bulkStageFailureLines,
  bulkStageNoticeLabel,
  bulkStageNoticeNote,
} from "@/modules/candidates/domain/bulkStage";
import { PIPELINE_STAGES } from "@/modules/candidates/domain/listFilters";
import { moveApplicationsStageBulk, type BulkStageResult } from "./candidate-actions";
import type { CandidateRow } from "./actions";

/* The bulk stage move the candidates toolbar opens — see ./CandidateBrowser.tsx.
   One selection, one destination stage, one row-by-row answer. */

export function BulkStageDrawer({
  open,
  recipients,
  onClose,
  onMoved,
}: {
  open: boolean;
  recipients: CandidateRow[];
  onClose: () => void;
  /** Called after any batch that wrote at least one row, so the list re-reads. */
  onMoved: () => void;
}) {
  const [stage, setStage] = useState<string>("INTERVIEW");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkStageResult | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * The next click is a next decision: the answer, the reason and the opt-in all
   * belong to the selection this batch was typed for, so none of them travels.
   */
  function dismiss() {
    setResult(null);
    setError(null);
    setReason("");
    setNotify(false);
    onClose();
  }

  const overCap = recipients.length > BULK_STAGE_LIMIT;

  async function move() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const answer = await moveApplicationsStageBulk({
        applicationIds: recipients.map((recipient) => recipient.id),
        stage,
        reason: reason.trim() || undefined,
        notify,
      });
      setResult(answer);
      if (!answer.ok) {
        setError(answer.error ?? "The move did not run.");
        setPending(false);
        return;
      }
      if (answer.failed === 0) {
        setTimeout(() => {
          dismiss();
          onMoved();
        }, 2200);
      } else {
        onMoved();
      }
    } catch {
      setError("Something went wrong moving the selection.");
    } finally {
      setPending(false);
    }
  }

  const failures = result?.ok ? bulkStageFailureLines(resultMessage(result)) : [];

  return (
    <Drawer
      open={open}
      onClose={dismiss}
      eyebrow="Pipeline"
      title="Bulk stage move"
      subtitle={`${recipients.length} candidate${recipients.length === 1 ? "" : "s"} selected`}
      onSubmit={move}
      footer={
        <DrawerActions
          onCancel={dismiss}
          submitLabel={`Move ${recipients.length} to ${humanizeStage(stage)}`}
          pending={pending}
          note={`Up to ${BULK_STAGE_LIMIT} rows per click, moved one at a time.`}
        />
      }
    >
      <div className="space-y-4">
        <Field
          label="Move every selected candidate to"
          htmlFor="bulk-stage"
          hint="A reopened rejected candidate keeps its stored reason only if you reject again."
        >
          <Select id="bulk-stage" value={stage} onChange={(event) => setStage(event.target.value)}>
            {PIPELINE_STAGES.map((option) => (
              <option key={option} value={option}>
                {humanizeStage(option)}
              </option>
            ))}
          </Select>
        </Field>

        {stage === "REJECTED" && (
          <Field
            label="Rejection reason"
            htmlFor="bulk-reason"
            required
            hint="One reason, stored on all of them and shown on each profile."
          >
            <TextArea
              id="bulk-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}

        <label className="block cursor-pointer rounded-xl border border-brand-line bg-brand-cream px-3.5 py-3">
          <span className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-brand-line"
            />
            <span className="text-sm">
              {bulkStageNoticeLabel(recipients.length)}
              <span className="mt-1 block text-[11px] leading-relaxed font-normal text-brand-ink/60">
                {bulkStageNoticeNote(recipients.length)}
              </span>
            </span>
          </span>
        </label>

        {overCap && (
          <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-rose-700">
            {recipients.length} rows are selected and one click moves at most {BULK_STAGE_LIMIT}.
            Clear the selection and tick the next {BULK_STAGE_LIMIT}.
          </p>
        )}

        {failures.length > 0 && (
          <div className="rounded-xl bg-brand-cream p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
              Not moved
            </p>
            <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-[11px] leading-relaxed text-brand-ink/70">
              {failures.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <FormMessage error={error} success={result?.ok ? (result.message ?? null) : null} />
      </div>
    </Drawer>
  );
}

/**
 * The summary the failure list is drawn from.
 *
 * `summarizeBulkStageMoves` owns that shape in the domain, and the action already
 * returns the same counts, so the panel rebuilds it from the answer rather than
 * trusting a second tally of its own.
 */
function resultMessage(result: BulkStageResult) {
  const failures = result.failures ?? [];
  return {
    moved: result.moved ?? 0,
    failed: failures.length,
    total: result.total ?? failures.length,
    failures,
  };
}
