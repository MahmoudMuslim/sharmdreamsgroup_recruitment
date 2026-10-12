import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasAiProvider } from "@/lib/config.server";
import { supabaseConfig } from "@/lib/config";
import { getAiAutomationSettings } from "@/modules/screening/application/screen-application";
import {
  evaluateCaseStudy,
  evaluateExcelModel,
  evaluateVideoPitch,
} from "@/modules/screening/infrastructure/openRouterEngine";
import {
  RecordingNotTranscribableError,
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

const clampPct = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const GRADING_PASSES = 3;
const PASS_DELAY_MS = 20_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function gradeAttemptResponses(
  attemptId: string
): Promise<{ graded: number; failed: number }> {
  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled || !hasAiProvider()) return { graded: 0, failed: 0 };

  const supabase = getSupabaseServiceClient();

  let graded = 0;
  let failed = 0;
  // Provider capacity flaps (free-tier daily 429s, transient 503s), so failed
  // responses are retried in later passes instead of leaving the attempt
  // permanently half-graded — resubmission is blocked once SUBMITTED.
  for (let pass = 0; pass < GRADING_PASSES; pass += 1) {
    if (pass > 0) await delay(PASS_DELAY_MS);
    const result = await gradePendingResponses(supabase, attemptId);
    graded += result.graded;
    failed = result.failed;
    if (failed === 0) break;
  }

  await finalizeAttemptTotals(supabase, attemptId);
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

  let graded = 0;
  let failed = 0;
  for (const attemptId of attemptIds) {
    const result = await gradeAttemptResponses(attemptId);
    graded += result.graded;
    failed += result.failed;
  }
  return { swept: attemptIds.length, graded, failed };
}

/** Grades every not-yet-scored written/model response of the attempt. */
async function gradePendingResponses(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  attemptId: string
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
      const outcome = await gradeResponse(supabase, question, response);
      if (outcome.status === "UNSUPPORTED") continue;

      if (outcome.status === "MANUAL") {
        await writeManualNote(supabase, response.id, outcome.reason);
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
    } catch (error) {
      if (error instanceof ManualReviewRequiredError) {
        // A blocker no retry can clear — hand the row to the reviewer.
        await writeManualNote(supabase, response.id, error.message);
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
  reason: string
): Promise<void> {
  await supabase
    .from("candidate_responses")
    .update({
      ai_evaluation: { score: null, rationale: reason, strengths: [], improvements: [] },
    })
    .eq("id", responseId);
}

/** Dispatches by question type; UNSUPPORTED means no AI path exists for it. */
async function gradeResponse(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  question: QuestionRow,
  response: ResponseRow
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
    const transcript = await ensureTranscript(supabase, response);
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
  response: ResponseRow
): Promise<string> {
  if (response.transcript?.trim()) return response.transcript.trim();
  if (!response.video_path) return "";

  const { data: file, error: downloadError } = await supabase.storage
    .from(supabaseConfig.buckets.candidateVideos)
    .download(response.video_path);

  if (downloadError || !file) {
    throw new Error(
      `Could not read the recording at ${response.video_path}: ${downloadError?.message ?? "empty response"}`
    );
  }

  let transcript: string;
  try {
    transcript = await transcribeRecording(
      new Uint8Array(await file.arrayBuffer()),
      file.type || "video/webm"
    );
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
  }
  return transcript;
}


/** Recomputes attempt totals from the response rows and marks the attempt GRADED. */
async function finalizeAttemptTotals(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  attemptId: string
): Promise<void> {
  const { data: rows } = await supabase
    .from("candidate_responses")
    .select("score, max_score")
    .eq("attempt_id", attemptId);

  const responses = (rows ?? []) as { score: number | null; max_score: number }[];
  const total = responses.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const max = responses.reduce((sum, row) => sum + (row.max_score ?? 0), 0);
  // Judged by the rows themselves, not by whether this pass errored: a
  // recording parked for manual review keeps the attempt honestly SUBMITTED.
  const complete = responses.length > 0 && responses.every((row) => row.score !== null);

  await supabase
    .from("candidate_attempts")
    .update({
      status: complete ? "GRADED" : "SUBMITTED",
      total_score: total,
      max_score: max,
    })
    .eq("id", attemptId);
}
