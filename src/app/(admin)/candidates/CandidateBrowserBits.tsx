"use client";

import { Archive, ArchiveRestore, Loader2, Lock } from "lucide-react";
import type { PipelineStage } from "./candidate-actions";
import type { CandidateRow } from "./actions";

/**
 * The small presentational pieces the candidate table and the profile drawer
 * both use, so a stage badge, an AI score or an archive button cannot drift
 * into meaning two different things in the two places a recruiter sees them.
 */

/** Badge tone for a pipeline stage, read off the stage itself. */
export function stageTone(stage: string) {
  if (stage === "HIRED") return "success" as const;
  if (stage === "REJECTED") return "danger" as const;
  if (stage === "OFFER" || stage === "INTERVIEW") return "gold" as const;
  return "info" as const;
}

/** Badge tone for the state of an issued assessment link. */
export function attemptTone(status: string) {
  if (status === "GRADED") return "success" as const;
  if (status === "EXPIRED") return "danger" as const;
  if (status === "SUBMITTED") return "info" as const;
  if (status === "IN_PROGRESS") return "gold" as const;
  return "neutral" as const;
}

/** Stands in for an AI score the signed-in staff member may not read. */
export function LockedScore() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-ink/35">
      <Lock className="h-3 w-3" aria-hidden />
      Hidden
    </span>
  );
}

/**
 * Files a candidate out of the pipeline, or brings them back.
 *
 * One control for both directions so its label always states what pressing it
 * does; the row it acts on is never removed by the click itself, only by the
 * view it belongs to.
 */
export function ArchiveButton({
  candidate,
  pending,
  onToggle,
}: {
  candidate: CandidateRow;
  pending: boolean;
  onToggle: () => void;
}) {
  const archived = Boolean(candidate.archived_at);
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      title={
        archived
          ? "Return this candidate to the pipeline"
          : "File this candidate away — the record and everything on it stays"
      }
      className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : archived ? (
        <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Archive className="h-3.5 w-3.5" aria-hidden />
      )}
      {archived ? "Restore" : "Archive"}
    </button>
  );
}

/** Forward move used by the one-click "Advance" buttons. */
export const NEXT_STAGE: Record<string, PipelineStage | null> = {
  NEW: "AI_SCREENING",
  AI_SCREENING: "ASSESSMENT",
  ASSESSMENT: "INTERVIEW",
  INTERVIEW: "OFFER",
  OFFER: "HIRED",
  HIRED: null,
  REJECTED: null,
};
