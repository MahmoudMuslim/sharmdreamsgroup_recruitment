import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getFileStore } from "@/lib/files/store";
import { hasAiProvider } from "@/lib/config.server";
import { supabaseConfig } from "@/lib/config";
import {
  engineActivityActor,
  recordActivity,
  withActivityContext,
} from "@/modules/activity/application/record";
import type { ActivityEntry } from "@/modules/activity/domain/trail";
import { getAiAutomationSettings } from "@/modules/screening/application/screen-application";
import {
  evaluateCaseStudy,
  evaluateExcelModel,
  evaluateVideoPitch,
} from "@/modules/screening/infrastructure/openRouterEngine";
import {
  RecordingNotTranscribableError,
  TruncatedJsonResponseError,
  transcribeRecording,
} from "@/modules/screening/infrastructure/aiGateway";
import type { QuestionEvaluation, SpreadsheetCellData } from "@/types";

/**
 * Post-submission AI grading for the response types the submit route leaves
 * unscored: case-study essays, spreadsheet models and video pitches. Multiple
 * choice is graded inline by the submit route itself.
 *
 * A pitch is graded from its transcript — the recording is sent to a speech
 * model once, stored on the response, and only then scored, so a retry never
 * re-transcribes. Recordings that no model can transcribe (no speech, no
 * transcription key, too large) are flagged for manual review instead of
 * failing the pass forever.
 *
 * Failure-tolerant by design: the candidate's submission is already persisted
 * before grading runs, so an AI error just leaves that response ungraded and
 * the attempt in SUBMITTED rather than breaking the submission.
 */

interface QuestionRow {
  id: string;
  question_type: string;
  title: string;
  prompt: string;
  points: number;
  config: {
    context?: string;
    min_duration_seconds?: number;
    max_duration_seconds?: number;
    initial_sheet?: { data: (string | number | null)[][]; col_widths?: number[] };
    expected_outputs?: { cell: string; formula_hint?: string; description: string }[];
  } | null;
}

interface ResponseRow {
  id: string;
  question_id: string;
  answer_text: string | null;
  spreadsheet_state: Record<string, SpreadsheetCellData> | null;
  video_path: string | null;
  transcript: string | null;
  score: number | null;
  max_score: number;
}

interface GradedEvaluation {
  score: number;
  rationale: string;
  strengths: string[];
  improvements: string[];
}

/** GRADED carries a score; MANUAL leaves the row for a human with a reason. */
type GradeOutcome =
  | { status: "GRADED"; evaluation: GradedEvaluation }
  | { status: "MANUAL"; reason: string }
  | { status: "UNSUPPORTED" };

/** What an attempt's response rows add up to, as recomputed by {@link resyncAttemptTotals}. */
export interface AttemptTotals {
  total: number;
  max: number;
  responses: number;
  /** How many of them still carry no score — what keeps the attempt open. */
  unscored: number;
  /** Every response carries a score — the only thing that makes an attempt GRADED. */
  complete: boolean;
  error?: string;
}

const clampPct = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const GRADING_PASSES = 3;
const PASS_DELAY_MS = 20_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What one grading run's trail rows say.
 *
 * Read once per attempt: the grading engine writes several rows — a score per
 * response, a transcription, a parked-for-review note — and each of them has to
 * name the same candidate and the same engine without re-reading the join.
 */
interface GradingTrail {
  attemptId: string;
  candidateName: string;
  jobTitle: string;
  /** The attempt's status when this run started, so finishing is told from re-running. */
  wasGraded: boolean;
  actor: Pick<ActivityEntry, "actorKind" | "actorLabel" | "actorId" | "companyId" | "via">;
}

async function gradingTrail(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  attemptId: string
): Promise<GradingTrail> {
  const { data } = await supabase
    .from("candidate_attempts")
    .select("status, applications ( full_name, job_openings ( title ) )")
    .eq("id", attemptId)
    .maybeSingle();

  const row = data as unknown as {
    status?: string;
    applications?:
      | { full_name?: string | null; job_openings?: { title?: string } | { title?: string }[] | null }
      | { full_name?: string | null; job_openings?: { title?: string } | { title?: string }[] }[]
      | null;
  } | null;

  const application = Array.isArray(row?.applications) ? row?.applications[0] : row?.applications;
  const job = Array.isArray(application?.job_openings)
    ? application.job_openings[0]
    : application?.job_openings;

  return {
    attemptId,
    candidateName: application?.full_name ?? "The candidate",
    jobTitle: job?.title ?? "the role",
    wasGraded: row?.status === "GRADED",
    actor: await engineActivityActor("AI grading engine", "assessment runner"),
  };
}

export async function gradeAttemptResponses(
  attemptId: string,
  options: { passes?: number } = {}
): Promise<{ graded: number; failed: number }> {
  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled || !hasAiProvider()) return { graded: 0, failed: 0 };

  // A recruiter watching a button wait wants one try and an answer; the submit
  // route and the cron sweep get the full retry budget for free.
  const passes = Math.max(1, options.passes ?? GRADING_PASSES);

  const supabase = getSupabaseServiceClient();
  const trail = await gradingTrail(supabase, attemptId);

  let graded = 0;
  let failed = 0;
  // Provider capacity flaps (free-tier daily 429s, transient 503s), so failed
  // responses are retried in later passes instead of leaving the attempt
  // permanently half-graded — resubmission is blocked once SUBMITTED.
  for (let pass = 0; pass < passes; pass += 1) {
    if (pass > 0) await delay(PASS_DELAY_MS);
    const result = await gradePendingResponses(supabase, attemptId, trail);
    graded += result.graded;
    failed = result.failed;
    if (failed === 0) break;
  }

  await finalizeAttemptTotals(attemptId, trail);

  if (failed > 0) {
    await recordActivity({
      ...trail.actor,
      area: "assessments",
      action: "grading_incomplete",
      entity: "attempt",
      entityId: attemptId,
      summary: `${passes} grading pass${passes === 1 ? "" : "es"} left ${failed} response${failed === 1 ? "" : "s"} of ${trail.candidateName}'s ${trail.jobTitle} test unscored, so the attempt stays submitted and ungraded`,
      detail: { responses_unscored: failed, passes },
    });
  }

  return { graded, failed };
}

/**
 * Re-grades submitted attempts that still have unscored written/model
 * responses — the recovery path for attempts whose grading ran during a
 * provider outage. A cron sweep calls this; each attempt reuses the same
 * gated, pass-based grading as fresh submissions.
 */
export async function regradeStuckAttempts(
  limit: number
): Promise<{ swept: number; graded: number; failed: number }> {
  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled || !hasAiProvider()) return { swept: 0, graded: 0, failed: 0 };

  const supabase = getSupabaseServiceClient();

  // Inner join on null-score responses: only attempts with at least one
  // response the submit route left for AI grading.
  const { data } = await supabase
    .from("candidate_attempts")
    .select("id, candidate_responses!inner(score)")
    .eq("status", "SUBMITTED")
    .is("candidate_responses.score", null)
    .limit(limit);

  const attemptIds = [...new Set(((data ?? []) as { id: string }[]).map((row) => row.id))];

  // The sweep is the scheduler's own work: everything it grades is recorded as
  // arriving through cron, with no recruiter behind it.
  return withActivityContext({ via: "cron" }, async () => {
    let graded = 0;
    let failed = 0;
    for (const attemptId of attemptIds) {
      const result = await gradeAttemptResponses(attemptId);
      graded += result.graded;
      failed += result.failed;
    }

    if (attemptIds.length > 0) {
      await recordActivity({
        actorKind: "SYSTEM",
        actorLabel: "Re-grade sweep",
        via: "cron",
        area: "assessments",
        action: "grading_sweep",
        entity: "attempt",
        summary: `Re-grade sweep revisited ${attemptIds.length} submitted attempt${attemptIds.length === 1 ? "" : "s"} — ${graded} response${graded === 1 ? "" : "s"} scored${failed ? `, ${failed} still unscored` : ""}`,
        detail: { attempts: attemptIds.length, graded, failed },
      });
    }

    return { swept: attemptIds.length, graded, failed };
  });
}

/** Grades every not-yet-scored written/model response of the attempt. */
async function gradePendingResponses(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  attemptId: string,
  trail: GradingTrail
): Promise<{ graded: number; failed: number }> {
  const { data: responses } = await supabase
    .from("candidate_responses")
    .select("id, question_id, answer_text, spreadsheet_state, video_path, transcript, score, max_score")
    .eq("attempt_id", attemptId)
    .is("score", null);

  const gradeable = ((responses ?? []) as ResponseRow[]).filter(
    (row) =>
      Boolean(row.answer_text) || Boolean(row.spreadsheet_state) || Boolean(row.video_path)
  );
  if (gradeable.length === 0) return { graded: 0, failed: 0 };

  const questionIds = [...new Set(gradeable.map((row) => row.question_id))];
  const { data: questions } = await supabase
    .from("assessment_questions")
    .select("id, question_type, title, prompt, points, config")
    .in("id", questionIds);
  const questionById = new Map(((questions ?? []) as QuestionRow[]).map((q) => [q.id, q]));

  let graded = 0;
  let failed = 0;

  for (const response of gradeable) {
    const question = questionById.get(response.question_id);
    if (!question) continue;

    try {
      const outcome = await gradeResponse(supabase, question, response, trail);
      if (outcome.status === "UNSUPPORTED") continue;

      if (outcome.status === "MANUAL") {
        await writeManualNote(supabase, response.id, outcome.reason, trail, question.title);
        continue;
      }

      const evaluation = outcome.evaluation;
      const awarded = Math.round((question.points * evaluation.score) / 100);
      const payload: QuestionEvaluation = {
        score: awarded,
        rationale: evaluation.rationale,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
      };
      const { error } = await supabase
        .from("candidate_responses")
        .update({ score: awarded, ai_evaluation: payload })
        .eq("id", response.id);
      if (error) throw new Error(error.message);
      graded += 1;

      await recordActivity({
        ...trail.actor,
        area: "assessments",
        action: "response_graded",
        entity: "attempt",
        entityId: attemptId,
        summary: `Graded ${trail.candidateName}'s “${question.title}” for ${trail.jobTitle}: ${evaluation.score}% of ${question.points} points, so ${awarded} awarded`,
        detail: {
          response_id: response.id,
          question_type: question.question_type,
          percent: evaluation.score,
          points_awarded: awarded,
          points_possible: question.points,
          strengths: evaluation.strengths.length,
          improvements: evaluation.improvements.length,
          verdict_characters: evaluation.rationale.length,
          note: "The answer and the model's verdict stay on the response row, not in the trail.",
        },
      });
    } catch (error) {
      if (error instanceof ManualReviewRequiredError) {
        // A blocker no retry can clear — hand the row to the reviewer.
        await writeManualNote(supabase, response.id, error.message, trail, question.title);
        continue;
      }
      if (error instanceof TruncatedJsonResponseError) {
        // Explain the blank in the report rather than leaving it unremarked, but
        // still count it as failed: a later pass may reach a model with enough
        // output room to finish the verdict.
        await writeManualNote(supabase, response.id, error.message, trail, question.title);
        failed += 1;
        console.error(
          `AI grading truncated for response ${response.id} (${question.title}): ${error.message}`
        );
        continue;
      }
      failed += 1;
      console.error(`AI grading failed for response ${response.id} (${question.title}):`, error);
    }
  }

  return { graded, failed };
}

/** Raised when a recording can only be judged by a human. */
class ManualReviewRequiredError extends Error {}

/**
 * Leaves the row unscored but explains itself — the reason surfaces in the
 * assessment report so nobody has to guess why grading stopped there.
 */
async function writeManualNote(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  responseId: string,
  reason: string,
  trail: GradingTrail,
  questionTitle: string
): Promise<void> {
  await supabase
    .from("candidate_responses")
    .update({
      ai_evaluation: { score: null, rationale: reason, strengths: [], improvements: [] },
    })
    .eq("id", responseId);

  await recordActivity({
    ...trail.actor,
    area: "assessments",
    action: "manual_review",
    entity: "attempt",
    entityId: trail.attemptId,
    summary: `Left ${trail.candidateName}'s “${questionTitle}” for a recruiter to grade: ${reason}`,
    detail: { response_id: responseId, reason },
  });
}

/** Dispatches by question type; UNSUPPORTED means no AI path exists for it. */
async function gradeResponse(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  question: QuestionRow,
  response: ResponseRow,
  trail: GradingTrail
): Promise<GradeOutcome> {
  if (question.question_type === "CASE_STUDY" && response.answer_text) {
    const result = await evaluateCaseStudy(
      `${question.title}\n\n${question.prompt}`,
      question.config?.context ?? "",
      response.answer_text,
      []
    );
    return {
      status: "GRADED",
      evaluation: {
        score: clampPct(result.score),
        rationale: result.rationale,
        strengths: result.strengths ?? [],
        improvements: result.improvements ?? [],
      },
    };
  }

  if (question.question_type === "EXCEL_MODEL" && response.spreadsheet_state) {
    const candidateCells = Object.fromEntries(
      Object.entries(response.spreadsheet_state).map(([ref, cell]) => [ref, cell?.value ?? null])
    );
    const result = await evaluateExcelModel(
      `${question.title}\n\n${question.prompt}`,
      candidateCells,
      question.config?.expected_outputs ?? [],
      question.config?.initial_sheet?.data
    );
    const correct = result.breakdown.filter((b) => b.correct);
    const missed = result.breakdown.filter((b) => !b.correct);
    return {
      status: "GRADED",
      evaluation: {
        score: clampPct(result.score),
        rationale:
          `${correct.length} of ${result.breakdown.length} required model outputs verified.` +
          (missed.length > 0
            ? ` Missed: ${missed.slice(0, 3).map((b) => b.cell).join(", ")}${missed.length > 3 ? "…" : ""}.`
            : " All required cells check out."),
        strengths: correct.map((b) => `${b.cell}: ${b.expected}`),
        improvements: missed.map((b) => `${b.cell}: expected ${b.expected}, submitted ${b.actual}`),
      },
    };
  }

  if (question.question_type === "VIDEO_PITCH" && response.video_path) {
    const transcript = await ensureTranscript(supabase, response, trail);
    if (!transcript) {
      return {
        status: "MANUAL",
        reason:
          "Nothing intelligible was transcribed from this recording. Play it to grade the pitch.",
      };
    }

    const result = await evaluateVideoPitch(
      `${question.title}\n\n${question.prompt}`,
      transcript,
      {
        minDurationSeconds: question.config?.min_duration_seconds,
        maxDurationSeconds: question.config?.max_duration_seconds,
      }
    );
    return {
      status: "GRADED",
      evaluation: {
        score: clampPct(result.score),
        rationale: result.rationale,
        strengths: result.strengths ?? [],
        improvements: result.improvements ?? [],
      },
    };
  }

  return { status: "UNSUPPORTED" };
}

/**
 * Returns the pitch transcript, transcribing and storing it on first use so a
 * retry never pays for the same call twice.
 *
 * Empty string means the model heard no speech. A provider that is merely
 * unavailable throws an ordinary error, which the pass counts as a failure and
 * retries later; only a blocker no retry can clear (no transcription key, file
 * over the inline limit) surfaces as ManualReviewRequiredError.
 */
async function ensureTranscript(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  response: ResponseRow,
  trail: GradingTrail
): Promise<string> {
  if (response.transcript?.trim()) return response.transcript.trim();
  if (!response.video_path) return "";

  const files = await getFileStore();
  const { bytes, contentType, error: downloadError } = await files.download({
    bucket: supabaseConfig.buckets.candidateVideos,
    path: response.video_path,
  });

  if (downloadError || !bytes) {
    throw new Error(
      `Could not read the recording at ${response.video_path}: ${downloadError ?? "empty response"}`
    );
  }

  let transcript: string;
  try {
    transcript = await transcribeRecording(bytes, contentType ?? "video/webm");
  } catch (error) {
    if (error instanceof RecordingNotTranscribableError) {
      // No retry can help, so hand it to the reviewer with the reason.
      throw new ManualReviewRequiredError(error.message);
    }
    throw error;
  }

  if (transcript) {
    const { error } = await supabase
      .from("candidate_responses")
      .update({ transcript })
      .eq("id", response.id);
    if (error) throw new Error(error.message);

    await recordActivity({
      ...trail.actor,
      area: "assessments",
      action: "pitch_transcribed",
      entity: "attempt",
      entityId: trail.attemptId,
      summary: `Transcribed ${trail.candidateName}'s video pitch for ${trail.jobTitle} — ${transcript.length} characters of speech written to the response`,
      detail: {
        response_id: response.id,
        characters: transcript.length,
        recording: response.video_path ?? "",
        note: "The words the candidate spoke are kept on the response, not in the trail.",
      },
    });
  }
  return transcript;
}


/**
 * Recomputes an attempt's totals from its own response rows.
 *
 * The single rule both graders go through: an attempt crosses into GRADED only
 * when every one of its responses carries a score, so a mark awarded by hand
 * lands the attempt in exactly the state the AI passes would have put it in.
 * Returns what the rows added up to and never writes the trail — the caller
 * knows whether it was a machine or a person, and says so itself.
 */
export async function resyncAttemptTotals(
  attemptId: string
): Promise<AttemptTotals> {
  const supabase = getSupabaseServiceClient();

  const { data: rows } = await supabase
    .from("candidate_responses")
    .select("score, max_score")
    .eq("attempt_id", attemptId);

  const responses = (rows ?? []) as { score: number | null; max_score: number }[];
  const total = responses.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const max = responses.reduce((sum, row) => sum + (row.max_score ?? 0), 0);
  const unscored = responses.filter((row) => row.score === null).length;
  // Judged by the rows themselves, not by whether a grading pass errored: a
  // recording parked for review keeps the attempt honestly SUBMITTED.
  const complete = responses.length > 0 && unscored === 0;

  const { error } = await supabase
    .from("candidate_attempts")
    .update({
      status: complete ? "GRADED" : "SUBMITTED",
      total_score: total,
      max_score: max,
    })
    .eq("id", attemptId);

  return {
    total,
    max,
    responses: responses.length,
    unscored,
    complete,
    error: error?.message,
  };
}

/** Recomputes attempt totals and records the crossing into GRADED, if this pass caused it. */
async function finalizeAttemptTotals(
  attemptId: string,
  trail: GradingTrail
): Promise<void> {
  const totals = await resyncAttemptTotals(attemptId);

  // Only the crossing into GRADED is recorded: a sweep that re-adds the same
  // totals to an already-graded attempt would otherwise repeat the same row.
  if (totals.complete && !totals.error && !trail.wasGraded) {
    await recordActivity({
      ...trail.actor,
      area: "assessments",
      action: "attempt_graded",
      entity: "attempt",
      entityId: attemptId,
      summary: `Graded ${trail.candidateName}'s ${trail.jobTitle} test — ${totals.total} of ${totals.max} points across ${totals.responses} response${totals.responses === 1 ? "" : "s"}`,
      detail: {
        total_score: totals.total,
        max_score: totals.max,
        responses: totals.responses,
        status: "SUBMITTED → GRADED",
      },
    });
  }
}
