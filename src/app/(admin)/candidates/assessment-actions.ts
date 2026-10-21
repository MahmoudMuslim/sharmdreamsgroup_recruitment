"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { supabaseConfig } from "@/lib/config";
import { getFileStore } from "@/lib/files/store";
import { hasAiProvider } from "@/lib/config.server";
import { getAiAutomationSettings } from "@/modules/screening/application/screen-application";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import {
  gradeAttemptResponses,
  resyncAttemptTotals,
} from "@/modules/assessment/application/gradeAttempt";

export interface QuestionGrade {
  id: string;
  /** The response row itself — what a hand-awarded mark is written to. */
  response_id: string;
  title: string;
  question_type: string;
  score: number | null;
  max_score: number | null;
  rationale: string | null;
  strengths: string[];
  improvements: string[];
  /** Whose verdict `rationale` is: the engine's, or a recruiter finishing its job. */
  awarded_by: "STAFF" | "AI" | null;
  answer_preview: string | null;
  /** Short-lived playback link, present only for recorded pitches. */
  video_url: string | null;
  transcript: string | null;
}

export interface AttemptGrades {
  attempt_id: string;
  /** What a chat answer can deep-link to; the drawer already knows the record. */
  application_id: string | null;
  template_name: string | null;
  status: string;
  total_score: number | null;
  max_score: number | null;
  /** `security.mask_scores_for_reviewers` — marks were dropped from these rows. */
  scores_masked: boolean;
  /**
   * Answers carrying no score.
   *
   * A count, not a mark, so it survives masking and can still tell a reviewer
   * the attempt is unfinished. Nothing else on this console closes that gap:
   * the grading engine is the only other writer, and no scheduler runs its
   * retry sweep — see `scoreAttemptResponse`.
   */
  unscored: number;
  /**
   * Whether this reviewer may award marks here.
   *
   * `assessments.grade` is the gate the permission console has always listed. A
   * masked reviewer is refused as well: every bound the editor would need —
   * each question's points and the attempt's total — is something the masking
   * rule deliberately hides, so it would be typing into the dark. `scoreAttemptResponse`
   * applies the same refusal, so this is the rule and not only the widget.
   */
  can_score: boolean;
  /**
   * Whether this reviewer may ask the engine for another try.
   *
   * `assessments.grade` alone: a retry lets the engine write the marks, so it
   * does not need the reader to see points the way the hand-editor does.
   */
  can_retry: boolean;
  /** Whether the engine can take another turn at the open answers, and if not, why. */
  ai_grading: "READY" | "OFF" | "NO_PROVIDER";
  grades: QuestionGrade[];
}

/**
 * Per-question AI grades for one attempt, found by the candidate's access
 * token — which is the only handle the invitation link carries, so it is how
 * the drawer reads the report.
 */
export async function getAttemptAiGrades(accessToken: string): Promise<AttemptGrades | null> {
  await requireStaff("/candidates");
  const supabase = await createSupabaseServerClient();

  const { data: found } = await supabase
    .from("candidate_attempts")
    .select("id")
    .eq("access_token", accessToken)
    .maybeSingle();

  if (!found) return null;
  return attemptGrades(found.id);
}

/**
 * The same report addressed by attempt id, which is how the assistant reads it.
 *
 * An access token is the candidate's start link, and a chat transcript is
 * stored — so the token never appears in a tool's arguments or result, and
 * every grading id the assistant works with comes from the dossier instead.
 */
export async function getAttemptGrades(attemptId: string): Promise<AttemptGrades | null> {
  await requireStaff("/candidates");
  return attemptGrades(attemptId);
}

/**
 * Per-question AI grades for one attempt, ordered by the template's question
 * position so the report reads like the exam. Rationale text is capped
 * client-side; the full answer stays in the database.
 *
 * The marks themselves follow the same rule as the candidate table: under
 * `security.mask_scores_for_reviewers` they are dropped here, so a reviewer
 * without `scores.view_unmasked` cannot recover them from this report either.
 * Answers, recordings and the AI's written feedback stay visible.
 */
async function attemptGrades(attemptId: string): Promise<AttemptGrades | null> {
  const [supabase, masked, mayGrade, automation] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
    hasPermissionForUser("assessments.grade"),
    getAiAutomationSettings(),
  ]);
  const files = await getFileStore();

  const { data: attempt } = await supabase
    .from("candidate_attempts")
    .select("id, application_id, status, total_score, max_score, assessment_templates(name)")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) return null;

  const { data: responses } = await supabase
    .from("candidate_responses")
    .select(
      "id, question_id, answer_text, video_path, transcript, score, max_score, ai_evaluation, assessment_questions(title, question_type, position)"
    )
    .eq("attempt_id", attempt.id)
    .order("position", { referencedTable: "assessment_questions", ascending: true });

  const grades: QuestionGrade[] = [];
  let unscored = 0;
  for (const row of (responses ?? []) as {
    id: string;
    question_id: string;
    answer_text: string | null;
    video_path: string | null;
    transcript: string | null;
    score: number | null;
    max_score: number;
    ai_evaluation: {
      score?: number;
      rationale?: string;
      strengths?: string[];
      improvements?: string[];
      graded_by?: string;
    } | null;
    assessment_questions?: { title?: string; question_type?: string } | null;
  }[]) {
    const question = row.assessment_questions;

    // Counted from the stored value, never the masked copy below, so an
    // unfinished attempt still reports that to a reviewer who cannot see marks.
    if (row.score === null) unscored += 1;

    // Recordings live in a private bucket. Staff may watch them, so mint a
    // short-lived playback link rather than exposing a public URL.
    let videoUrl: string | null = null;
    if (row.video_path) {
      const { url } = await files.signedUrl({
        bucket: supabaseConfig.buckets.candidateVideos,
        path: row.video_path,
        seconds: 60 * 60,
      });
      videoUrl = url ?? null;
    }

    grades.push({
      id: row.question_id,
      response_id: row.id,
      title: question?.title ?? "Question",
      question_type: question?.question_type ?? "MULTIPLE_CHOICE",
      score: masked ? null : row.score,
      max_score: masked ? null : row.max_score,
      rationale: row.ai_evaluation?.rationale ?? null,
      strengths: row.ai_evaluation?.strengths ?? [],
      improvements: row.ai_evaluation?.improvements ?? [],
      // Only a scored row has a verdict to attribute, and the engine's own rows
      // never carry `graded_by`, so anything else this writer left is the AI's.
      awarded_by:
        row.score === null
          ? null
          : row.ai_evaluation?.graded_by === "STAFF"
            ? "STAFF"
            : "AI",
      answer_preview: row.answer_text ? row.answer_text.slice(0, 400) : null,
      video_url: videoUrl,
      transcript: row.transcript ? row.transcript.slice(0, 1200) : null,
    });
  }

  const template = attempt.assessment_templates as { name?: string } | null;

  return {
    attempt_id: attempt.id,
    application_id: (attempt.application_id as string | null | undefined) ?? null,
    template_name: template?.name ?? "Assessment",
    status: attempt.status,
    total_score: masked || attempt.total_score === null ? null : Number(attempt.total_score),
    max_score: masked || attempt.max_score === null ? null : Number(attempt.max_score),
    scores_masked: masked,
    unscored,
    can_score: mayGrade && !masked,
    can_retry: mayGrade,
    ai_grading: !automation.aiEnabled
      ? "OFF"
      : !hasAiProvider()
        ? "NO_PROVIDER"
        : "READY",
    grades,
  };
}

export interface ManualScoreResult {
  ok: boolean;
  error?: string;
  /** Left when the mark was the last missing one, so the caller can say the test is now graded. */
  remaining_unscored?: number;
  /** The attempt's running totals, so the answer that finishes the paper can report the result. */
  total_score?: number;
  max_score?: number;
  /** So a chat answer can link back to the person whose marks it just changed. */
  application_id?: string | null;
}

/** Pulls a to-one embed out of whichever shape PostgREST returned. */
function one<T extends object>(value: T | T[] | null | undefined): T | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row ?? null;
}

/** PostgREST returns a to-one embed as an object or as a one-row array. */
type ApplicationsEmbed = { id?: string; full_name?: string } | { id?: string; full_name?: string }[];

/**
 * Award a response's marks by hand.
 *
 * Before this, the grading engine was the only writer of
 * `candidate_responses.score` in the whole portal, so an answer it parked — a
 * pitch nothing could transcribe, a verdict no retry produced — stayed unscored
 * forever and held its attempt at SUBMITTED with it. This is the desk action that
 * finishes that job, and the first thing to read the `assessments.grade`
 * permission the roles console has always listed.
 *
 * The mark itself is written with the session client, so RLS decides it too
 * (`responses_staff_all`), and the attempt's totals go back through the engine's
 * own rule so a hand-awarded score cannot leave a state the AI disagrees about.
 * The engine's written verdict is carried along rather than thrown away, and
 * every pass of this is one trail row naming the person behind it.
 */
export async function scoreAttemptResponse(input: {
  responseId: string;
  score: number;
  note: string;
}): Promise<ManualScoreResult> {
  await requireStaff("/candidates");

  const [mayGrade, masked] = await Promise.all([
    hasPermissionForUser("assessments.grade"),
    scoresAreMaskedForCurrentUser(),
  ]);

  if (!mayGrade) {
    return {
      ok: false,
      error: "Awarding marks needs the Grade assessments permission.",
    };
  }

  // Checked here as well as through `can_score`, which is what hides the editor
  // on the report: a reviewer whose marks are withheld is refused the same way
  // at every door, including a chat that never renders that drawer.
  if (masked) {
    return {
      ok: false,
      error:
        "Your role has its marks withheld, so it cannot award them either. Grading by hand needs “View unmasked scores”, or “Mask scores for interviewers” switched off.",
    };
  }

  const awarded = Number(input.score);
  if (!Number.isInteger(awarded) || awarded < 0) {
    return { ok: false, error: "Award a whole number of points, 0 included." };
  }
  const note = (input.note ?? "").trim().slice(0, 500);

  const supabase = await createSupabaseServerClient();

  const { data: found } = await supabase
    .from("candidate_responses")
    .select(
      "id, attempt_id, score, max_score, ai_evaluation, assessment_questions(title), candidate_attempts(status, applications(id, full_name))"
    )
    .eq("id", input.responseId)
    .maybeSingle();

  if (!found) return { ok: false, error: "That answer is no longer on file." };

  const row = found as unknown as {
    id: string;
    attempt_id: string;
    score: number | null;
    max_score: number | null;
    ai_evaluation: { rationale?: string } | null;
    assessment_questions?: { title?: string } | { title?: string }[] | null;
    candidate_attempts?:
      | { status?: string; applications?: ApplicationsEmbed }
      | null
      | {
          status?: string;
          applications?: ApplicationsEmbed;
        }[];
  };

  const points = Number(row.max_score ?? 0);
  if (points > 0 && awarded > points) {
    return {
      ok: false,
      error: `This answer is worth ${points} point${points === 1 ? "" : "s"}, so ${awarded} is more than it can carry.`,
    };
  }

  const attempt = one(row.candidate_attempts ?? null);
  const candidateName = one(attempt?.applications)?.full_name ?? "the candidate";
  const questionTitle = one(row.assessment_questions)?.title ?? "the question";

  const { error } = await supabase
    .from("candidate_responses")
    .update({
      score: awarded,
      ai_evaluation: {
        score: awarded,
        rationale: note.length > 0 ? note : "Awarded by hand.",
        strengths: [],
        improvements: [],
        graded_by: "STAFF",
        // A re-mark must not cost the AI's reasoning: it stays readable under
        // the staff verdict, including when it was the parked-for-review note.
        ai_rationale: row.ai_evaluation?.rationale ?? null,
      },
    })
    .eq("id", row.id);

  if (error) return { ok: false, error: error.message };

  const totals = await resyncAttemptTotals(row.attempt_id);
  if (totals.error) {
    // The mark is saved — say so rather than reporting a clean failure.
    return {
      ok: false,
      error: `The mark was saved, but the attempt's totals could not be recomputed: ${totals.error}`,
      remaining_unscored: totals.unscored,
    };
  }

  const wasReMark = row.score !== null;
  const completedIt = totals.complete && attempt?.status !== "GRADED";

  await recordActivity({
    area: "assessments",
    action: wasReMark ? "response_rescored" : "response_scored",
    entity: "attempt",
    entityId: row.attempt_id,
    summary: `Awarded ${awarded} of ${points || "?"} on ${questionTitle} for ${candidateName}${
      wasReMark ? `, replacing the ${row.score} already on it` : ""
    }${
      completedIt
        ? ` — the last unscored answer, so the test is now GRADED at ${totals.total} of ${totals.max}`
        : `, leaving ${totals.unscored} answer${totals.unscored === 1 ? "" : "s"} still unscored`
    }`,
    detail: {
      response_id: row.id,
      question: questionTitle,
      from_score: row.score,
      to_score: awarded,
      max_score: points,
      reason: note,
      attempt_total: totals.total,
      attempt_max: totals.max,
      unscored_left: totals.unscored,
    },
  });

  revalidatePath("/candidates");

  return {
    ok: true,
    remaining_unscored: totals.unscored,
    total_score: totals.total,
    max_score: totals.max,
    application_id: one(attempt?.applications)?.id ?? null,
  };
}

export interface GradingRetryResult {
  ok: boolean;
  error?: string;
  /** What this run moved, so the report can say it out loud instead of reloading in silence. */
  scored?: number;
  still_unscored?: number;
  /** So a chat answer can link back to the person whose answers it just graded. */
  application_id?: string | null;
}

/** How many of an attempt's answers carry no mark, as the caller's session sees them. */
async function openAnswers(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  attemptId: string
): Promise<number> {
  const { count } = await supabase
    .from("candidate_responses")
    .select("id", { count: "exact", head: true })
    .eq("attempt_id", attemptId)
    .is("score", null);
  return count ?? 0;
}

/**
 * Ask the engine to try this attempt's open answers again.
 *
 * The retry path lived only in `/api/cron/grading`, and nothing schedules that
 * route — so an answer the AI failed to score at submit had no way of ever
 * getting a mark except from a person. One pass, deliberately: whoever asks is
 * watching a spinner or waiting on a reply, and the engine's three-pass budget
 * with its twenty-second waits is for callers nobody is waiting on.
 *
 * The marks the engine writes are recorded as the engine's own. This row is the
 * separate fact that a person asked for the run — from the report's button or
 * from the assistant, which calls this same action.
 */
export async function retryAttemptGrading(attemptId: string): Promise<GradingRetryResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("assessments.grade"))) {
    return {
      ok: false,
      error: "Re-running grading needs the Grade assessments permission.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const { data: found } = await supabase
    .from("candidate_attempts")
    .select("id, applications ( id, full_name )")
    .eq("id", attemptId)
    .maybeSingle();

  if (!found) return { ok: false, error: "That attempt is no longer on file." };

  const openBefore = await openAnswers(supabase, attemptId);
  if (openBefore === 0) {
    // Nothing for the engine to do — saying so beats spending a provider call.
    return {
      ok: true,
      scored: 0,
      still_unscored: 0,
      application_id: one(found.applications)?.id ?? null,
    };
  }

  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled || !hasAiProvider()) {
    return {
      ok: false,
      error: !aiEnabled
        ? "AI grading is switched off in Settings → AI, so there is nothing to re-run."
        : "No AI provider is configured, so there is nothing to re-run.",
    };
  }

  await gradeAttemptResponses(attemptId, { passes: 1 });

  const openAfter = await openAnswers(supabase, attemptId);
  const scored = Math.max(0, openBefore - openAfter);
  const candidateName = one(found.applications)?.full_name ?? "the candidate";
  const outcome =
    openAfter === 0
      ? `it scored all ${openBefore} and the test is now graded`
      : `it scored ${scored}, ${openAfter} still open`;

  await recordActivity({
    area: "assessments",
    action: "grading_retried",
    entity: "attempt",
    entityId: attemptId,
    summary: `Asked the AI to grade ${candidateName}'s ${openBefore} open answer${
      openBefore === 1 ? "" : "s"
    } — ${outcome}`,
    detail: { open_before: openBefore, scored, open_after: openAfter, passes: 1 },
  });

  revalidatePath("/candidates");

  return {
    ok: true,
    scored,
    still_unscored: openAfter,
    application_id: one(found.applications)?.id ?? null,
  };
}
