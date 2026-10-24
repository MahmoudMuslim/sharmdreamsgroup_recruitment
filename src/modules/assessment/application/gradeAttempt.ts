import "server-only";

import { getServiceRestClient } from "@/lib/data-api/service";
import { getFileStore } from "@/lib/files/store";
import { hasAiProvider } from "@/lib/config.server";
import { storageConfig } from "@/lib/config";
import {
  engineActivityActor,
  recordActivity,
  withActivityContext,
} from "@/modules/activity/application/record";
import type { ActivityEntry } from "@/modules/activity/domain/trail";
import { getAiAutomationSettings } from "@/modules/screening/application/screen-application";
import { routeFollowUp } from "@/modules/assessment/application/routeFollowUp";
import {
  attemptTotalsFrom,
  type AttemptTotals as ResponseTotals,
} from "@/modules/assessment/domain/attemptTotals";
import {
  sweepCandidates,
  type SweepCandidate,
} from "@/modules/assessment/domain/sweepSelection";
import {
  evaluateCaseStudy,
  evaluateCodeSubmission,
  evaluateExcelModel,
  evaluateVideoPitch,
  gradeAgainstRubric,
} from "@/modules/screening/infrastructure/openRouterEngine";
import {
  rubricCriteriaOf,
  rubricEvaluation,
  scoreRubric,
} from "@/modules/assessment/domain/rubric";
import { codingLanguageOf } from "@/modules/assessment/domain/coding";
import {
  RecordingNotTranscribableError,
  TruncatedJsonResponseError,
  transcribeRecording,
} from "@/modules/screening/infrastructure/aiGateway";
import type {
  QuestionEvaluation,
  RubricCriterion,
  RubricLine,
  SpreadsheetCellData,
} from "@/types";

/**
 * Post-submission AI grading for the response types the submit route leaves
 * unscored: case-study essays, spreadsheet models, video pitches and coding
 * answers. Quizzes and situational judgment scenes are scored inline by the
 * submit route itself — their response rows already carry a score, so the
 * `score IS NULL` read below never hands them to a model.
 *
 * The finalize step runs even when AI is switched off or no provider is
 * configured: nothing is sent to a model, but a paper whose every answer was
 * marked on submit is finished, and that crossing is what the trail and a
 * suite's second-test rule read.
 *
 * A pitch is graded from its transcript — the recording is sent to a speech
 * model once, stored on the response, and only then scored, so a retry never
 * re-transcribes. Recordings that no model can transcribe (no speech, no
 * transcription key, too large) are parked for manual review instead of
 * failing the pass forever; the scheduled sweep leaves a parked answer alone,
 * while a recruiter asking again may re-offer it.
 *
 * A case study, pitch or coding answer that carries a rubric is marked on the
 * recruiter's own criteria: the model is asked for one band per criterion, the
 * domain module adds up the marks, and the criteria travel with the response so
 * editing them later cannot reinterpret a mark already given. A question with no
 * rubric keeps the grading prompt's own judgement, exactly as it did before
 * rubrics existed; a coding answer without one is read as source text, never
 * carried out.
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
    rubric?: RubricCriterion[];
    language?: string;
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
  /** A parked note names a blocker no retry can clear. */
  ai_evaluation: { parked?: boolean } | null;
}

interface GradedEvaluation {
  score: number;
  rationale: string;
  strengths: string[];
  improvements: string[];
  /**
   * The marks actually awarded.
   *
   * A rubric sets this from the criteria's own arithmetic, so the question's
   * points and a percentage never have to meet; every other question type leaves
   * it unset and {@link gradePendingResponses} converts the percentage as it
   * always did.
   */
  awarded?: number;
  /** The criteria that produced the mark, stored beside it. */
  criteria?: RubricLine[];
}

/** GRADED carries a score; MANUAL leaves the row for a human with a reason. */
type GradeOutcome =
  | { status: "GRADED"; evaluation: GradedEvaluation }
  | { status: "MANUAL"; reason: string }
  | { status: "UNSUPPORTED" };

/** What an attempt's response rows add up to, as recomputed by {@link resyncAttemptTotals}. */
export interface AttemptTotals extends ResponseTotals {
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
  restClient: ReturnType<typeof getServiceRestClient>,
  attemptId: string
): Promise<GradingTrail> {
  const { data } = await restClient
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
  options: { passes?: number; skipParked?: boolean } = {}
): Promise<{ graded: number; failed: number }> {
  // A recruiter watching a button wait wants one try and an answer; the submit
  // route and the cron sweep get the full retry budget for free. Only the sweep
  // skips parked answers: its next pass comes on its own in five minutes, while
  // a person asking may deliberately be re-offering one after fixing its cause.
  const passes = Math.max(1, options.passes ?? GRADING_PASSES);
  const skipParked = options.skipParked ?? false;

  const restClient = getServiceRestClient();
  const trail = await gradingTrail(restClient, attemptId);

  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled || !hasAiProvider()) {
    // No model may mark anything, but the engine is still the door that decides
    // a paper is finished: every quiz, judgment and gate answer was marked by
    // the submit route itself. Returning here without finalizing would leave a
    // fully marked paper SUBMITTED forever on an AI-off deployment — and a
    // suite's second-test rule, which fires on the crossing into GRADED, would
    // never run. An unfinished paper is written back as SUBMITTED, unchanged.
    await finalizeAttemptTotals(attemptId, trail, false);
    return { graded: 0, failed: 0 };
  }

  let graded = 0;
  let failed = 0;
  // Provider capacity flaps (free-tier daily 429s, transient 503s), so failed
  // responses are retried in later passes instead of leaving the attempt
  // permanently half-graded — resubmission is blocked once SUBMITTED.
  for (let pass = 0; pass < passes; pass += 1) {
    if (pass > 0) await delay(PASS_DELAY_MS);
    const result = await gradePendingResponses(restClient, attemptId, trail, skipParked);
    graded += result.graded;
    failed = result.failed;
    if (failed === 0) break;
  }

  await finalizeAttemptTotals(attemptId, trail, graded > 0);

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
 * Re-grades submitted attempts that still have work a pass can do — the
 * recovery path for attempts whose grading ran during a provider outage, and
 * the close-out for a paper whose finalize write never landed.
 *
 * A cron sweep calls this. Fully marked papers are closed by the same finalize
 * step a fresh submission gets, with no model involved; papers with open answers
 * are sent through the gated, pass-based grading only while AI is available, and
 * an answer the engine parked for a person is left for that person.
 */
export async function regradeStuckAttempts(
  limit: number
): Promise<{ swept: number; graded: number; failed: number; closed: number }> {
  const { aiEnabled } = await getAiAutomationSettings();
  const aiReady = aiEnabled && hasAiProvider();

  const restClient = getServiceRestClient();

  // Every submitted paper with at least one stored answer. The old query asked
  // only for a null-score answer, which cannot see a paper whose finalize write
  // failed after the last mark: no model is needed to close that one, and with
  // AI off it is the only kind of paper this sweep can help.
  const { data } = await restClient
    .from("candidate_attempts")
    .select("id, candidate_responses!inner(score, ai_evaluation)")
    .eq("status", "SUBMITTED")
    .limit(limit);

  const attemptIds = sweepCandidates(
    (data ?? []) as unknown as SweepCandidate[],
    aiReady
  );

  // The sweep is the scheduler's own work: everything it grades is recorded as
  // arriving through cron, with no recruiter behind it.
  return withActivityContext({ via: "cron" }, async () => {
    let graded = 0;
    let failed = 0;
    for (const attemptId of attemptIds) {
      const result = await gradeAttemptResponses(attemptId, { skipParked: true });
      graded += result.graded;
      failed += result.failed;
    }

    // A paper the sweep finished is worth counting separately: when every mark
    // was already on the rows, `graded` is zero and the summary would otherwise
    // read as if the pass did nothing.
    let closed = 0;
    if (attemptIds.length > 0) {
      const { data: after } = await restClient
        .from("candidate_attempts")
        .select("id, status")
        .in("id", attemptIds);
      closed = ((after ?? []) as { status?: string }[]).filter(
        (row) => row.status === "GRADED"
      ).length;
    }

    if (attemptIds.length > 0) {
      const parts = [`${graded} response${graded === 1 ? "" : "s"} scored`];
      if (closed > 0) parts.push(`${closed} paper${closed === 1 ? "" : "s"} now graded`);
      if (failed > 0) parts.push(`${failed} still unscored`);

      await recordActivity({
        actorKind: "SYSTEM",
        actorLabel: "Re-grade sweep",
        via: "cron",
        area: "assessments",
        action: "grading_sweep",
        entity: "attempt",
        summary: `Re-grade sweep revisited ${attemptIds.length} submitted attempt${attemptIds.length === 1 ? "" : "s"} — ${parts.join(", ")}`,
        detail: { attempts: attemptIds.length, graded, failed, closed },
      });
    }

    return { swept: attemptIds.length, graded, failed, closed };
  });
}

/** Grades every not-yet-scored written/model response of the attempt. */
async function gradePendingResponses(
  restClient: ReturnType<typeof getServiceRestClient>,
  attemptId: string,
  trail: GradingTrail,
  skipParked: boolean
): Promise<{ graded: number; failed: number }> {
  const { data: responses } = await restClient
    .from("candidate_responses")
    .select(
      "id, question_id, answer_text, spreadsheet_state, video_path, transcript, score, max_score, ai_evaluation"
    )
    .eq("attempt_id", attemptId)
    .is("score", null);

  const gradeable = ((responses ?? []) as ResponseRow[]).filter(
    (row) =>
      (Boolean(row.answer_text) || Boolean(row.spreadsheet_state) || Boolean(row.video_path)) &&
      !(skipParked && row.ai_evaluation?.parked === true)
  );
  if (gradeable.length === 0) return { graded: 0, failed: 0 };

  const questionIds = [...new Set(gradeable.map((row) => row.question_id))];
  const { data: questions } = await restClient
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
      const outcome = await gradeResponse(restClient, question, response, trail);
      if (outcome.status === "UNSUPPORTED") continue;

      if (outcome.status === "MANUAL") {
        await writeManualNote(restClient, response.id, outcome.reason, trail, question.title, true);
        continue;
      }

      const evaluation = outcome.evaluation;
      const awarded =
        evaluation.awarded ?? Math.round((question.points * evaluation.score) / 100);
      const payload: QuestionEvaluation = {
        score: awarded,
        rationale: evaluation.rationale,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
        // The scheme that produced this mark, kept with the mark rather than read
        // back from the question, so a later edit cannot reinterpret it.
        ...(evaluation.criteria ? { criteria: evaluation.criteria } : {}),
      };
      const { error } = await restClient
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
        // A blocker no retry can clear — hand the row to the reviewer, and mark
        // it so the scheduled sweep does not pay for the same call every pass.
        await writeManualNote(restClient, response.id, error.message, trail, question.title, true);
        continue;
      }
      if (error instanceof TruncatedJsonResponseError) {
        // Explain the blank in the report rather than leaving it unremarked, but
        // still count it as failed: a later pass may reach a model with enough
        // output room to finish the verdict. Not parked — the sweep may retry it.
        await writeManualNote(restClient, response.id, error.message, trail, question.title, false);
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
 *
 * `parked` says the blocker survives another pass: the scheduled sweep skips
 * those rows instead of re-running an impossible call every five minutes.
 * A truncation is not parked — a later pass may fit the verdict.
 */
async function writeManualNote(
  restClient: ReturnType<typeof getServiceRestClient>,
  responseId: string,
  reason: string,
  trail: GradingTrail,
  questionTitle: string,
  parked: boolean
): Promise<void> {
  await restClient
    .from("candidate_responses")
    .update({
      ai_evaluation: {
        score: null,
        rationale: reason,
        strengths: [],
        improvements: [],
        parked,
      },
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
  restClient: ReturnType<typeof getServiceRestClient>,
  question: QuestionRow,
  response: ResponseRow,
  trail: GradingTrail
): Promise<GradeOutcome> {
  if (question.question_type === "CASE_STUDY" && response.answer_text) {
    const criteria = rubricCriteriaOf(question.config);
    if (criteria.length > 0) {
      return gradeByRubric(question, criteria, response.answer_text, {
        capability: "case_reasoning",
        context: question.config?.context ?? "",
      });
    }

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

  if (question.question_type === "CODING") {
    const material = response.answer_text ?? "";
    const language = codingLanguageOf(question.config);
    const criteria = rubricCriteriaOf(question.config);
    if (criteria.length > 0) {
      return gradeByRubric(question, criteria, material, {
        capability: "case_reasoning",
        context: question.config?.context ?? "",
        code: true,
        language: language ?? undefined,
      });
    }

    const result = await evaluateCodeSubmission(
      `${question.title}\n\n${question.prompt}`,
      language,
      material
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
    const transcript = await ensureTranscript(restClient, response, trail);
    if (!transcript) {
      return {
        status: "MANUAL",
        reason:
          "Nothing intelligible was transcribed from this recording. Play it to grade the pitch.",
      };
    }

    const criteria = rubricCriteriaOf(question.config);
    if (criteria.length > 0) {
      return gradeByRubric(question, criteria, transcript, {
        capability: "soft_skills",
        transcriptOnly: true,
        limits: {
          minDurationSeconds: question.config?.min_duration_seconds,
          maxDurationSeconds: question.config?.max_duration_seconds,
        },
      });
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
 * Mark an answer on the question's own criteria.
 *
 * The model is asked for one band per criterion and no total: `scoreRubric` does
 * the arithmetic, so the marks a candidate is awarded are the ones the recruiter's
 * weights produce rather than a number a model felt. The criteria that produced
 * the mark are returned with it, and stored on the response — a rubric edited
 * next month cannot reinterpret a mark given today.
 *
 * A rubric that cannot be added up (a criterion the model skipped, a name the
 * question never set, a band with no number in it) is a `MANUAL` outcome, not a
 * failed pass: parked rows tell the reviewer the scheme needs a human, and the
 * sweep leaves them alone instead of re-paying for the same call.
 */
async function gradeByRubric(
  question: QuestionRow,
  criteria: RubricCriterion[],
  material: string,
  options: {
    capability: "case_reasoning" | "soft_skills";
    transcriptOnly?: boolean;
    context?: string;
    limits?: { minDurationSeconds?: number; maxDurationSeconds?: number };
    /** The material is source text, so the engine fences it under its language. */
    code?: boolean;
    language?: string;
  }
): Promise<GradeOutcome> {
  const bands = await gradeAgainstRubric(
    `${question.title}\n\n${question.prompt}`,
    material,
    criteria,
    options
  );

  const score = scoreRubric(question.points, criteria, bands);
  if (!score.ok) return { status: "MANUAL", reason: score.error };

  const copy = rubricEvaluation(score, { transcriptOnly: options.transcriptOnly });
  return {
    status: "GRADED",
    evaluation: {
      // Only for the trail, which speaks in percentages; the mark itself is
      // `awarded`, which is what lands on the response row.
      score: score.max > 0 ? clampPct((score.total / score.max) * 100) : 0,
      rationale: copy.rationale,
      strengths: copy.strengths,
      improvements: copy.improvements,
      awarded: score.total,
      criteria: score.lines,
    },
  };
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
  restClient: ReturnType<typeof getServiceRestClient>,
  response: ResponseRow,
  trail: GradingTrail
): Promise<string> {
  if (response.transcript?.trim()) return response.transcript.trim();
  if (!response.video_path) return "";

  const files = await getFileStore();
  const { bytes, contentType, error: downloadError } = await files.download({
    bucket: storageConfig.buckets.candidateVideos,
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
    const { error } = await restClient
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
  const restClient = getServiceRestClient();

  const { data: rows } = await restClient
    .from("candidate_responses")
    .select("score, max_score")
    .eq("attempt_id", attemptId);

  const responses = (rows ?? []) as { score: number | null; max_score: number }[];
  const totals = attemptTotalsFrom(responses);

  const { error } = await restClient
    .from("candidate_attempts")
    .update({
      status: totals.complete ? "GRADED" : "SUBMITTED",
      total_score: totals.total,
      max_score: totals.max,
    })
    .eq("id", attemptId);

  return { ...totals, error: error?.message };
}

/**
 * Who a run's closing row names.
 *
 * Only a run that actually sent an answer to a model may say an AI graded the
 * paper. A finalize that merely writes totals for marks already on the rows —
 * the AI-off path, or a sweep closing a fully marked paper — names the grading
 * engine with no model behind it.
 */
function closingActor(
  trail: GradingTrail,
  usedModel: boolean
): GradingTrail["actor"] {
  if (usedModel) return trail.actor;
  return {
    actorKind: "SYSTEM",
    actorLabel: "Grading engine",
    actorId: trail.actor.actorId,
    companyId: trail.actor.companyId,
    via: trail.actor.via,
  };
}

/** Recomputes attempt totals and records the crossing into GRADED, if this pass caused it. */
async function finalizeAttemptTotals(
  attemptId: string,
  trail: GradingTrail,
  usedModel: boolean
): Promise<void> {
  const totals = await resyncAttemptTotals(attemptId);

  // Only the crossing into GRADED is recorded: a sweep that re-adds the same
  // totals to an already-graded attempt would otherwise repeat the same row.
  if (totals.complete && !totals.error && !trail.wasGraded) {
    await recordActivity({
      ...closingActor(trail, usedModel),
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

    // A suite's second-test rule fires on the same crossing the trail records.
    // The router answers rather than throws — a rule is not worth a failed
    // grading pass — and does nothing while 035 is unapplied.
    await routeFollowUp(attemptId);
  }
}
