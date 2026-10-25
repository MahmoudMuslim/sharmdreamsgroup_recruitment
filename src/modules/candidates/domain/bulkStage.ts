/**
 * The rules a bulk stage move has to satisfy before it touches a row.
 *
 * A stage move is not a quiet UPDATE: `updateApplicationStage` fans the change
 * out to the candidate over every channel Settings → Notifications allows. Doing
 * that forty times from one click needs a deliberate decision, so the decision
 * lives here as one flag with one default, and both the dialog and the server
 * action read it from the same place.
 *
 * Pure by design — no database, no `server-only` — so the client toolbar can
 * refuse a selection the same way the action will.
 */

import { PIPELINE_STAGES, isPipelineStage } from "./listFilters";
import { humanizeStage } from "@/modules/settings/domain/templates";

export type BulkStage = (typeof PIPELINE_STAGES)[number];

/**
 * How many rows one click may move.
 *
 * Lower than the 200 the bulk campaigns allow, because a campaign sends one
 * message the recruiter already wrote while a move rewrites the pipeline, the
 * activity trail and the candidate's inbox per row. A hire is not a migration,
 * and the cap is the one number the toolbar and the action must not disagree on.
 */
export const BULK_STAGE_LIMIT = 50;

export type BulkStagePlan =
  | { ok: true; ids: string[]; stage: BulkStage; reason: string | null; notify: boolean }
  | { ok: false; error: string };

/**
 * Read a selection as the move it is asking for, or say why it cannot have it.
 *
 * Every argument arrives from a browser, so nothing is trusted to already be the
 * right shape: the ids are cleaned and deduped, the stage is checked against the
 * closed vocabulary, and the notice is on only when the client sent a literal
 * `true` — a flag that went missing in a form serialization must not mail people.
 */
export function planBulkStageMove(input: {
  applicationIds: readonly unknown[];
  stage: unknown;
  reason?: unknown;
  notify?: unknown;
}): BulkStagePlan {
  const ids = [
    ...new Set(
      input.applicationIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];

  if (ids.length === 0) {
    return { ok: false, error: "Select at least one candidate." };
  }

  const stage = isPipelineStage(input.stage) as BulkStage | null;
  if (stage === null) {
    return { ok: false, error: "Unknown pipeline stage." };
  }

  const typed = typeof input.reason === "string" ? input.reason.trim() : "";
  if (stage === "REJECTED" && typed.length < 4) {
    return {
      ok: false,
      error: "Add a short rejection reason — it is shown on the candidate's profile.",
    };
  }

  if (ids.length > BULK_STAGE_LIMIT) {
    return {
      ok: false,
      error: `Move at most ${BULK_STAGE_LIMIT} candidates at a time.`,
    };
  }

  return {
    ok: true,
    ids,
    stage,
    reason: stage === "REJECTED" ? typed : null,
    notify: input.notify === true,
  };
}

/** What the opt-in checkbox promises, with the count in its own words. */
export function bulkStageNoticeLabel(count: number): string {
  return count === 1
    ? "Send the stage notice to this candidate"
    : `Send the stage notice to all ${count} candidates`;
}

/**
 * The sentence beside the checkbox, naming the channels.
 *
 * "Notification" is too small a word for what happens: the notice goes out over
 * email and WhatsApp on whichever channels are switched on, so the recruiter
 * reads which doors the click opens rather than guessing that one toggle means
 * one email.
 */
export function bulkStageNoticeNote(count: number): string {
  return `Sends the stage template by email and WhatsApp — whichever channels Settings → Notifications has switched on — to all ${count} candidates, plus a portal notice on each profile.`;
}

/**
 * A selected row the read did not return, in the words the panel shows.
 *
 * The plan is built from ids the browser holds, and a row can leave the pipeline
 * between the tick and the click — archived, deleted, or filed under a company
 * this recruiter cannot see. That is not a skip: nothing moved and nobody was
 * told, so it belongs in the failure list beside the writes that were refused.
 */
export const MISSING_ROW_ERROR = "This candidate is no longer in the pipeline.";

/** The reason shown when a refusal came back without one. */
const UNREPORTED_ERROR = "The move was refused and no reason came back.";

/** One row's answer, as the single-row writer leaves it. */
export interface BulkStageRowOutcome {
  id: string;
  /** Null when the row never came back, so the panel has no name to print. */
  name: string | null;
  ok: boolean;
  error?: string | null;
}

export interface BulkStageSummary {
  moved: number;
  failed: number;
  /** Every row the plan asked for, so a count can never go missing. */
  total: number;
  failures: { name: string | null; error: string }[];
}

/**
 * Tally a batch row by row.
 *
 * The recruiter's next decision depends on this number: a "done" that quietly
 * means "29 of 40" sends them off to interview eleven people who are still
 * sitting in New. So the total is the plan's own length, and a row that did not
 * succeed is named whether or not the database explained itself.
 */
export function summarizeBulkStageMoves(
  outcomes: readonly BulkStageRowOutcome[]
): BulkStageSummary {
  const moved = outcomes.filter((outcome) => outcome.ok).length;
  return {
    moved,
    failed: outcomes.length - moved,
    total: outcomes.length,
    failures: outcomes
      .filter((outcome) => !outcome.ok)
      .map((outcome) => ({
        name: outcome.name,
        error: outcome.error?.trim() || UNREPORTED_ERROR,
      })),
  };
}

/** What the batch did, in one sentence the panel prints above the list. */
export function bulkStageSummaryMessage(summary: BulkStageSummary, stage: string): string {
  const people = `${summary.moved} candidate${summary.moved === 1 ? "" : "s"}`;
  if (summary.failed === 0) {
    return `${people} moved to ${humanizeStage(stage)}.`;
  }
  if (summary.moved === 0) {
    return `No candidate moved to ${humanizeStage(stage)} — ${summary.failed} not moved.`;
  }
  return `${people} moved to ${humanizeStage(stage)}, ${summary.failed} not moved.`;
}

/**
 * One line per row the batch did not move.
 *
 * Names are printed when the read had one; a row that vanished has nobody to
 * name, and "A candidate" is the honest subject rather than a blank line.
 */
export function bulkStageFailureLines(summary: BulkStageSummary): string[] {
  return summary.failures.map(
    (failure) => `${failure.name ?? "A candidate"} — ${failure.error}`
  );
}
