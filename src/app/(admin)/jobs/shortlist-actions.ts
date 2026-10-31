"use server";

import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { getOpeningsRequiredSkills } from "@/modules/jobs/application/openingSkillsRead";
import {
  SHORTLIST_LIMIT,
  rankApplicants,
  shortlistBasisNote,
  shortlistSignals,
  type ShortlistLine,
  type ShortlistRow,
} from "@/modules/jobs/domain/shortlist";

/**
 * One opening's applicants, ordered by what their own record says.
 *
 * This is the reading half of the shortlist: it fetches, it masks, and it hands the
 * rows to the pure ranker, which owns the arithmetic. Three things are decided here
 * rather than in the domain module because they are facts about the *database*, not
 * about the ranking:
 *
 *   • Which columns the signals live in. A `candidate_attempts` array is ordered by
 *     nothing in particular, so `created_at` is read to find the newest graded
 *     paper; the panel's marks come through the schedule embed, and an applicant
 *     with no interview returns an empty array rather than a missing key.
 *   • What this account may see. `scoresAreMaskedForCurrentUser()` is asked once
 *     and passed to every row, so a masked reviewer's screen never receives the
 *     figures it is not allowed to read — not "received and hidden", which is the
 *     kind of claim a later edit could quietly make untrue.
 *   • Whether the read reached everyone. The list is bounded, and a bound that
 *     discloses itself is the rule every capped read in this portal follows: an
 *     order over the 200 most recent applicants is not an order over the queue.
 *
 * The requisition's skill list is read apart from the row select, for the reason
 * `openingSkillsRead.ts` gives: while migration 037 is unapplied the table is not
 * there, and naming it inside the row select would cost the recruiter their whole
 * applicant list for one component of a ranking.
 */

/** The newest applicants a shortlist is built from; `SHORTLIST_LIMIT` says it back. */
const READ_CEILING = SHORTLIST_LIMIT + 1;

const SHORTLIST_SELECT =
  "id, full_name, stage, created_at, ai_match_score, gate_answers, " +
  "candidate_skills(skill_id, proficiency), " +
  "candidate_attempts(created_at, status, total_score, max_score), " +
  "interview_schedules(id, interview_scorecards(technical, communication, problem_solving, culture))";

export interface JobShortlist {
  /** The ranked lines, best first, each carrying its own reason. */
  lines: ShortlistLine[];
  /** The header: whether the ranking is possible, and what the account may not read. */
  basis_note: string;
  /** True when the mask predicate withheld the scores from this read. */
  scores_hidden: boolean;
  /**
   * What the read itself left out — more applicants than the bound, or a component
   * this database cannot offer. Null when the read was complete.
   */
  note: string | null;
}

export type ShortlistResult = { ok: true; shortlist: JobShortlist } | { ok: false; error: string };

export async function getJobShortlist(jobId: string): Promise<ShortlistResult> {
  await requireStaff("/jobs");
  const [restClient, scoresHidden] = await Promise.all([
    createServerRestClient(),
    scoresAreMaskedForCurrentUser(),
  ]);

  const [{ data, error }, requiredRead] = await Promise.all([
    restClient
      .from("applications")
      .select(SHORTLIST_SELECT)
      .eq("job_id", jobId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(READ_CEILING),
    getOpeningsRequiredSkills(restClient, [jobId]),
  ]);

  if (error) {
    console.error("[jobs] shortlist read failed:", error.message);
    return { ok: false, error: "The shortlist could not be loaded. Please retry." };
  }

  const rows = (data ?? []) as ShortlistRow[];
  const capped = rows.length > SHORTLIST_LIMIT;
  const required = requiredRead.requiredById.get(jobId) ?? [];

  const lines = rankApplicants(
    (capped ? rows.slice(0, SHORTLIST_LIMIT) : rows).map((row) =>
      shortlistSignals(row, required, { scoresHidden })
    ),
    { scoresHidden }
  );

  const notes: string[] = [];
  if (capped) {
    notes.push(
      `This ranking covers the ${SHORTLIST_LIMIT} most recent applicants; this opening has more.`
    );
  }
  if (!requiredRead.available) {
    notes.push(requiredRead.note ?? "The requisition's skill list could not be read.");
  }

  return {
    ok: true,
    shortlist: {
      lines,
      basis_note: shortlistBasisNote(lines),
      scores_hidden: scoresHidden,
      note: notes.length > 0 ? notes.join(" ") : null,
    },
  };
}
