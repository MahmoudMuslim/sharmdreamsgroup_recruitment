"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/modules/analytics/presentation/ui";
import { FormMessage, TextArea } from "@/modules/analytics/presentation/Form";
import { draftRejectionReason, updateApplicationStage } from "./candidate-actions";
import type { CandidateRow } from "./actions";

/**
 * The step every door into REJECTED shares.
 *
 * A rejection without a stored reason is refused by the action itself, and the
 * text is not the letter the candidate receives — it is the note on the file.
 * Two screens now ask a recruiter for it (the profile drawer's stage buttons and
 * a card dropped on the board's last column), so both read through this panel
 * instead of restating that distinction in two places.
 *
 * Nothing is written until Confirm: dropping a card here only opens this form,
 * so a cancelled drop leaves the candidate exactly where they were.
 */
export function RejectReasonForm({
  candidate,
  onCancel,
  onMoved,
}: {
  candidate: CandidateRow;
  onCancel: () => void;
  /** Called once the rejection is stored, with whether a feedback draft follows. */
  onMoved: (autoFeedback: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * Writes the model's reason into the textarea, replacing what is there.
   *
   * Overwrite is the honest behaviour for a button labelled "draft": a partially
   * typed reason is the recruiter's own words and they are about to read the
   * machine's beside the Confirm button, not have them silently merged.
   */
  async function draftReason() {
    setDrafting(true);
    setError(null);
    setDone(null);
    try {
      const result = await draftRejectionReason(candidate.id);
      if (result.ok && result.reason) {
        setReason(result.reason);
        setDone(
          "Drafted from this file's evidence. Read it and edit before confirming — nothing is saved yet."
        );
      } else {
        setError(result.error ?? "Could not draft a reason.");
      }
    } catch {
      setError("The portal did not answer, so no reason was drafted.");
    } finally {
      setDrafting(false);
    }
  }

  async function confirmReject() {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await updateApplicationStage({
        applicationId: candidate.id,
        stage: "REJECTED",
        reason,
      });
      if (result.ok) onMoved(Boolean(result.auto_feedback));
      else setError(result.error ?? "Could not reject the candidate.");
    } catch {
      setError("Something went wrong rejecting the candidate.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
      <label htmlFor="reject-reason" className="block text-xs font-bold text-rose-900">
        Rejection reason for {candidate.full_name}
      </label>
      <p className="text-[11px] leading-relaxed text-rose-900/70">
        For the file: this note shows on the candidate profile and in the reports export. The letter
        the candidate receives is written from Settings → Notifications and does not use it.
      </p>
      <TextArea
        id="reject-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this candidate not moving forward?"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void confirmReject()}
          disabled={pending || drafting}
          className="bg-rose-600 text-brand-on-accent hover:bg-rose-700"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Confirm rejection
        </Button>
        <Button variant="outline" size="sm" onClick={() => void draftReason()} disabled={drafting || pending}>
          {drafting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {!drafting && <Sparkles className="h-3.5 w-3.5" aria-hidden />}
          Draft from file
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
      <FormMessage error={error} success={done} />
    </div>
  );
}
