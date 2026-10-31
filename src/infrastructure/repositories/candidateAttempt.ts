import type { CandidateAttempt } from "@/core/entities";
import type { StaffReadClient } from "./restClient";

/**
 * `candidate_attempts` — reads about one sitting of one assessment suite.
 *
 * The paper a candidate sits is reached by its unguessable link, not by a
 * signed-in id, so this table is read from both sides of the front door. These
 * projections are the staff side; the runner keeps its own token-keyed read.
 */

/** A paper's score, in the shape the board wants: the application it belongs to, and the number. */
export type AttemptScoreRow = Pick<CandidateAttempt, "application_id" | "total_score">;

/**
 * The score of every paper sat against each of a set of applications.
 *
 * Bounded to the ids the caller already holds — a board of forty rows does not
 * pay for a read over every paper the group has ever issued. A masked caller
 * still gets the yes/no that a paper exists, so the read runs whether or not the
 * number is shown to the person looking.
 */
export async function readAttemptScoresByApplication(
  restClient: StaffReadClient,
  applicationIds: string[]
): Promise<{ ok: true; rows: AttemptScoreRow[] } | { ok: false; error: string }> {
  if (applicationIds.length === 0) return { ok: true, rows: [] };

  const { data, error } = await restClient
    .from("candidate_attempts")
    .select("application_id, total_score")
    .in("application_id", applicationIds);

  if (error) {
    return { ok: false, error: `These assessment scores could not be read: ${error.message}` };
  }
  return { ok: true, rows: (data ?? []) as unknown as AttemptScoreRow[] };
}
