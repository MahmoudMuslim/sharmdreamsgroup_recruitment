import "server-only";

import type { createServerRestClient } from "@/lib/data-api/server";
import {
  SCORECARD_SCHEMA_NOTE,
  isInterviewRound,
  isMissingSchemaError,
  type InterviewRound,
  type InterviewScorecard,
  type InterviewScorecardLayer,
} from "@/modules/interviews/domain/interviewScorecard";

/**
 * The panel's rounds and scorecards, read beside the agenda rather than in it.
 *
 * `interview_schedules` is selected by the agenda, the candidate list embed and
 * the profile page through one shared column list. Adding `round` there would
 * break every one of those reads while migration 032 is unapplied — one missing
 * column fails the whole select, not the one field. So rounds are read here, in
 * their own query, and a failure downgrades to "no round recorded" instead of
 * emptying the calendar. The same separation makes the unapplied state visible:
 * the layer says which half could not be read instead of showing a blank.
 */

export type { InterviewScorecard, InterviewScorecardLayer } from "@/modules/interviews/domain/interviewScorecard";

export const SCORECARD_SELECT =
  "id, interview_id, author_profile_id, technical, communication, problem_solving, culture, feedback, created_at, updated_at, user_profiles ( full_name )";

type RestClient = Awaited<ReturnType<typeof createServerRestClient>>;

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function toScorecard(row: Record<string, unknown>): InterviewScorecard {
  const author = nested<{ full_name?: string }>(row.user_profiles);
  return {
    id: String(row.id),
    interviewId: String(row.interview_id),
    authorProfileId: (row.author_profile_id as string | null) ?? null,
    authorName: author?.full_name ?? null,
    technical: Number(row.technical),
    communication: Number(row.communication),
    problemSolving: Number(row.problem_solving),
    culture: Number(row.culture),
    feedback: (row.feedback as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function why(error: { code?: string | null; message?: string | null }): string {
  return isMissingSchemaError(error)
    ? SCORECARD_SCHEMA_NOTE
    : `The scorecards could not be read: ${error.message ?? "the database did not answer"}.`;
}

/**
 * Reads both halves for the panels named.
 *
 * An empty list still probes: a calendar with nothing booked must be able to
 * say whether scorecards exist at all, otherwise an empty week would silently
 * claim the feature works.
 */
export async function readInterviewScorecardLayer(
  restClient: RestClient,
  interviewIds: readonly string[]
): Promise<InterviewScorecardLayer> {
  const ids = [...new Set(interviewIds.filter((id) => typeof id === "string" && id.length > 0))];

  const roundsQuery = restClient.from("interview_schedules").select("id, round");
  const cardsQuery = restClient.from("interview_scorecards").select(SCORECARD_SELECT);
  const [roundRows, cardRows] = await Promise.all([
    ids.length > 0 ? roundsQuery.in("id", ids) : roundsQuery.limit(1),
    ids.length > 0
      ? cardsQuery.in("interview_id", ids).order("created_at", { ascending: true })
      : cardsQuery.limit(1),
  ]);

  const notes = new Set<string>();
  if (roundRows.error) notes.add(why(roundRows.error));
  if (cardRows.error) notes.add(why(cardRows.error));

  const rounds: Record<string, InterviewRound> = {};
  const roundData = (roundRows.data ?? []) as Record<string, unknown>[];
  for (const row of roundData) {
    const id = String(row.id);
    if (isInterviewRound(row.round)) rounds[id] = row.round;
  }
  // A failed query proves nothing about which panels exist, so the list is left
  // empty rather than guessed from the ids that were asked for.
  const foundIds = roundRows.error ? [] : roundData.map((row) => String(row.id));

  const scorecards = ((cardRows.data ?? []) as Record<string, unknown>[]).map(toScorecard);

  return {
    rounds,
    scorecards,
    foundIds,
    roundsAvailable: !roundRows.error,
    scorecardsAvailable: !cardRows.error,
    note: notes.size > 0 ? [...notes].join(" ") : null,
  };
}
