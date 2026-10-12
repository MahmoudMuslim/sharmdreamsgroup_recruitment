import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasAiProvider } from "@/lib/config.server";
import { getAiAutomationSettings } from "@/modules/screening/application/screen-application";
import {
  evaluateCaseStudy,
  evaluateExcelModel,
} from "@/modules/screening/infrastructure/openRouterEngine";
import type { QuestionEvaluation, SpreadsheetCellData } from "@/types";

/**
 * Post-submission AI grading for the response types the submit route leaves
 * unscored (case-study essays and spreadsheet models). Multiple-choice is
 * graded inline; video pitches have no transcript pipeline yet, so they stay
 * for manual review.
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
    expected_outputs?: { cell: string; formula_hint?: string; description: string }[];
  } | null;
}

interface ResponseRow {
  id: string;
  question_id: string;
  answer_text: string | null;
  spreadsheet_state: Record<string, SpreadsheetCellData> | null;
  score: number | null;
  max_score: number;
}

interface GradedEvaluation {
  score: number;
  rationale: string;
  strengths: string[];
  improvements: string[];
}

const clampPct = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export async function gradeAttemptResponses(
  attemptId: string
): Promise<{ graded: number; failed: number }> {
  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled || !hasAiProvider()) return { graded: 0, failed: 0 };

  const supabase = getSupabaseServiceClient();

  const { data: responses } = await supabase
    .from("candidate_responses")
    .select("id, question_id, answer_text, spreadsheet_state, score, max_score")
    .eq("attempt_id", attemptId)
    .is("score", null);

  const gradeable = ((responses ?? []) as ResponseRow[]).filter(
    (row) => Boolean(row.answer_text) || Boolean(row.spreadsheet_state)
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
      const evaluation = await gradeResponse(question, response);
      if (!evaluation) continue;

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
      failed += 1;
      console.error(`AI grading failed for response ${response.id} (${question.title}):`, error);
    }
  }

  await finalizeAttemptTotals(supabase, attemptId, failed === 0);
  return { graded, failed };
}

/** Dispatches by question type; returns null for types without a grading path. */
async function gradeResponse(
  question: QuestionRow,
  response: ResponseRow
): Promise<GradedEvaluation | null> {
  if (question.question_type === "CASE_STUDY" && response.answer_text) {
    const result = await evaluateCaseStudy(
      `${question.title}\n\n${question.prompt}`,
      question.config?.context ?? "",
      response.answer_text,
      []
    );
    return {
      score: clampPct(result.score),
      rationale: result.rationale,
      strengths: result.strengths ?? [],
      improvements: result.improvements ?? [],
    };
  }

  if (question.question_type === "EXCEL_MODEL" && response.spreadsheet_state) {
    const candidateCells = Object.fromEntries(
      Object.entries(response.spreadsheet_state).map(([ref, cell]) => [ref, cell?.value ?? null])
    );
    const result = await evaluateExcelModel(
      `${question.title}\n\n${question.prompt}`,
      candidateCells,
      question.config?.expected_outputs ?? []
    );
    const correct = result.breakdown.filter((b) => b.correct);
    const missed = result.breakdown.filter((b) => !b.correct);
    return {
      score: clampPct(result.score),
      rationale:
        `${correct.length} of ${result.breakdown.length} required model outputs verified.` +
        (missed.length > 0
          ? ` Missed: ${missed.slice(0, 3).map((b) => b.cell).join(", ")}${missed.length > 3 ? "…" : ""}.`
          : " All required cells check out."),
      strengths: correct.map((b) => `${b.cell}: ${b.expected}`),
      improvements: missed.map((b) => `${b.cell}: expected ${b.expected}, submitted ${b.actual}`),
    };
  }

  return null;
}

/** Recomputes attempt totals from the response rows and marks the attempt GRADED. */
async function finalizeAttemptTotals(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  attemptId: string,
  allGraded: boolean
): Promise<void> {
  const { data: rows } = await supabase
    .from("candidate_responses")
    .select("score, max_score")
    .eq("attempt_id", attemptId);

  const responses = (rows ?? []) as { score: number | null; max_score: number }[];
  const total = responses.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const max = responses.reduce((sum, row) => sum + (row.max_score ?? 0), 0);

  await supabase
    .from("candidate_attempts")
    .update({
      status: allGraded ? "GRADED" : "SUBMITTED",
      total_score: total,
      max_score: max,
    })
    .eq("id", attemptId);
}
