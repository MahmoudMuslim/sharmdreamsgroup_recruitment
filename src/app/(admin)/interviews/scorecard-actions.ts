"use server";

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { formatInZone } from "@/lib/timezone";
import { recordActivity } from "@/modules/activity/application/record";
import {
  SCORECARD_SCHEMA_NOTE,
  SCORECARD_WRITE_REFUSAL,
  isMissingSchemaError,
  readScorecardFeedback,
  readScorecardRatings,
  scorecardSummary,
} from "@/modules/interviews/domain/interviewScorecard";
import {
  readInterviewScorecardLayer,
  type InterviewScorecardLayer,
} from "@/modules/interviews/infrastructure/scorecardReader";

/**
 * Round support and scorecards, behind the same staff door as the agenda.
 *
 * Writing a scorecard needs no permission beyond a staff session, on purpose.
 * The person who sat the panel is often a hiring manager with no candidate-editing
 * grant, and their judgement is the thing the feature exists to record — requiring
 * `candidates.write` would mean the interviewer has to dictate their opinion to
 * someone else. What the action *does* enforce is ownership: the author is the
 * session's profile, never a name sent by the browser, and the database's RLS
 * policy repeats that check.
 */

export interface ScorecardMutation {
  ok: boolean;
  error?: string;
}

export interface RoundSupport {
  /** True when `interview_schedules.round` can be read. */
  available: boolean;
  /** The sentence to show when it cannot, naming the migration. */
  note: string | null;
}

/**
 * Whether the booking form may offer a round at all.
 *
 * Read on first open rather than in the candidate page render: the panel is a
 * secondary surface, and a probe on every profile view would spend a query to
 * decide whether to draw one select.
 */
export async function getInterviewRoundSupport(): Promise<RoundSupport> {
  await requireStaff("/candidates");
  const restClient = await createServerRestClient();

  const { error } = await restClient
    .from("interview_schedules")
    .select("id, round")
    .limit(1);

  if (!error) return { available: true, note: null };
  return {
    available: false,
    note: isMissingSchemaError(error)
      ? SCORECARD_SCHEMA_NOTE
      : `Rounds could not be read: ${error.message}`,
  };
}

/** The rounds and scorecards for the panels the page is about to draw. */
export async function getInterviewScorecardLayer(
  interviewIds: readonly string[]
): Promise<InterviewScorecardLayer> {
  await requireStaff("/interviews");
  const restClient = await createServerRestClient();
  return readInterviewScorecardLayer(restClient, interviewIds);
}

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

/**
 * Saves the signed-in interviewer's scorecard, creating it the first time and
 * editing their own row after that.
 *
 * The read-then-write is not the race protection — two tabs can both find
 * nothing and both insert, and the unique constraint answers the second with
 * 23505, which is reported as "you already have one" rather than as a database
 * error. The panel must not be CANCELLED or a NO_SHOW: there was no interview
 * to have an opinion about, and a scorecard on one would read as evidence that
 * a conversation happened.
 */
export async function saveInterviewScorecard(input: {
  interviewId: string;
  technical: number;
  communication: number;
  problemSolving: number;
  culture: number;
  feedback?: string | null;
}): Promise<ScorecardMutation> {
  const user = await requireStaff("/interviews");

  const ratings = readScorecardRatings(input as unknown as Record<string, unknown>);
  if (!ratings.ok) return { ok: false, error: ratings.error };
  const feedback = readScorecardFeedback(input.feedback);
  if (!feedback.ok) return { ok: false, error: feedback.error };

  const restClient = await createServerRestClient();
  const { data: interview } = await restClient
    .from("interview_schedules")
    .select("id, application_id, status, scheduled_at, applications(full_name)")
    .eq("id", input.interviewId)
    .maybeSingle();

  if (!interview) return { ok: false, error: "That interview no longer exists." };
  if (interview.status === "CANCELLED") {
    return { ok: false, error: "This panel was cancelled, so there is nothing to score." };
  }
  if (interview.status === "NO_SHOW") {
    return { ok: false, error: "This panel was a no-show, so there is nothing to score." };
  }

  const { data: existing, error: readError } = await restClient
    .from("interview_scorecards")
    .select("id")
    .eq("interview_id", input.interviewId)
    .eq("author_profile_id", user.profileId)
    .maybeSingle();

  if (readError) {
    return {
      ok: false,
      error: isMissingSchemaError(readError)
        ? SCORECARD_WRITE_REFUSAL
        : `The scorecard could not be read: ${readError.message}`,
    };
  }

  const row = {
    interview_id: input.interviewId,
    author_profile_id: user.profileId,
    technical: ratings.ratings.technical,
    communication: ratings.ratings.communication,
    problem_solving: ratings.ratings.problemSolving,
    culture: ratings.ratings.culture,
    feedback: feedback.feedback,
  };

  const { error } = existing
    ? await restClient
        .from("interview_scorecards")
        .update({
          technical: row.technical,
          communication: row.communication,
          problem_solving: row.problem_solving,
          culture: row.culture,
          feedback: row.feedback,
        })
        .eq("id", existing.id)
    : await restClient.from("interview_scorecards").insert(row);

  if (error) {
    if (isMissingSchemaError(error)) return { ok: false, error: SCORECARD_WRITE_REFUSAL };
    if (error.code === "23505") {
      return {
        ok: false,
        error: "You already have a scorecard for this panel. Reopen it to change your marks.",
      };
    }
    return { ok: false, error: error.message };
  }

  const candidate = nested<{ full_name?: string }>(
    (interview as Record<string, unknown>).applications
  );
  const when = formatInZone(
    String(interview.scheduled_at),
    await getOrganisationTimeZone(),
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }
  );

  await recordActivity({
    area: "interviews",
    action: "interview_scorecard",
    entity: "interview",
    entityId: input.interviewId,
    summary: `${existing ? "Updated" : "Wrote"} a scorecard on ${candidate?.full_name ?? "a candidate"}'s panel of ${when}: ${scorecardSummary(ratings.ratings)}`,
    detail: {
      application_id: interview.application_id,
      scheduled_at: interview.scheduled_at,
      interview_status: interview.status,
      technical: ratings.ratings.technical,
      communication: ratings.ratings.communication,
      problem_solving: ratings.ratings.problemSolving,
      culture: ratings.ratings.culture,
      has_feedback: feedback.feedback !== null,
      edited: Boolean(existing),
    },
  });

  revalidatePath("/interviews");
  revalidatePath("/candidates");
  return { ok: true };
}
