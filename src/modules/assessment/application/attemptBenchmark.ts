import "server-only";

import { createServerRestClient } from "@/lib/data-api/server";
import { benchmarkOf, type AttemptBenchmark } from "@/modules/assessment/domain/benchmark";

/** The server client every read in this module is handed, rather than built twice. */
type ServerClient = Awaited<ReturnType<typeof createServerRestClient>>;

/** What the console already knows about the paper being ranked. */
export interface BenchmarkTarget {
  template_id: string;
  status: string;
  total_score: number | null;
  max_score: number | null;
}

/**
 * Rank one graded paper against every graded paper the same suite produced.
 *
 * Two exact counts, no rows: how many papers share this suite, this mark total and
 * a completed grade, and how many of those marked at or below this one. Both come
 * back on the `Content-Range` the gateway sends for a head request, so a suite with
 * four hundred graded papers costs the same as one with six — and the count is the
 * whole population, not a window that would make the rank a statement about the
 * newest rows instead of the suite.
 *
 * A filed-away candidate's paper stays in the population. The rank is a claim about
 * this test, not about the pipeline a recruiter is currently working through, and
 * quietly dropping old papers would move the percentile of everyone still on screen.
 *
 * Returns null when there is nothing to rank — a paper that has not been graded
 * yet, or one whose mark total is unknown, which would leave the population
 * undefined because there is no scale to compare on. The caller also skips this
 * under `security.mask_scores_for_reviewers`: a percentile is a statement about
 * other candidates' marks, and withholding those is the whole point of the setting.
 */
export async function readAttemptBenchmark(
  restClient: ServerClient,
  attempt: BenchmarkTarget
): Promise<AttemptBenchmark | null> {
  if (attempt.status !== "GRADED") return null;

  const score = attempt.total_score === null ? null : Number(attempt.total_score);
  const maxScore = attempt.max_score === null ? null : Number(attempt.max_score);
  // A graded paper worth nothing is not a scale, it is a missing number, and
  // counting papers "out of 0" would rank every candidate in it together.
  if (!maxScore) return null;

  const population = () =>
    restClient
      .from("candidate_attempts")
      .select("id", { count: "exact", head: true })
      .eq("template_id", attempt.template_id)
      .eq("status", "GRADED")
      .eq("max_score", maxScore)
      .not("total_score", "is", null);

  const [all, behind] = await Promise.all([population(), population().lte("total_score", score ?? 0)]);

  return benchmarkOf({
    score,
    max_score: maxScore,
    population: all.count,
    at_or_above: behind.count,
  });
}
