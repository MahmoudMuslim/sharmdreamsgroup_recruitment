/**
 * What an attempt's stored responses add up to.
 *
 * One reduce, because the question is asked at several points and the answers
 * must agree: the submit route writes a running total while the candidate is
 * still answering, `resyncAttemptTotals` rewrites it from the stored rows after
 * every grading pass and after a recruiter's last hand mark, and the report
 * reads the attempt row. This module owns the second — the rows decide both the
 * marks and whether the paper is finished.
 *
 * A null score is zero marks *and* an unfinished paper. Those are different
 * facts: the total may already be complete for display while one written answer
 * waits, which is exactly the state that must stay SUBMITTED. `complete` is
 * therefore judged by the rows themselves — there is at least one, and none of
 * them is unmarked — never by whether a grading pass happened to error. A
 * recording parked for review, a provider outage, and an AI switch turned off
 * all leave the same honest answer.
 *
 * No rows is not "complete": an attempt whose responses failed to save must not
 * be reported as a perfect zero-mark paper.
 */

/** One stored mark, as the responses table returns it. */
export interface ResponseMark {
  score: number | null;
  max_score?: number | null;
}

export interface AttemptTotals {
  total: number;
  max: number;
  responses: number;
  unscored: number;
  complete: boolean;
}

export function attemptTotalsFrom(responses: readonly ResponseMark[]): AttemptTotals {
  const total = responses.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const max = responses.reduce((sum, row) => sum + (row.max_score ?? 0), 0);
  const unscored = responses.filter((row) => row.score === null).length;

  return {
    total,
    max,
    responses: responses.length,
    unscored,
    complete: responses.length > 0 && unscored === 0,
  };
}
