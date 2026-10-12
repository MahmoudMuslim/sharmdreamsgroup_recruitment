"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";

export interface QuestionGrade {
  id: string;
  title: string;
  question_type: string;
  score: number | null;
  max_score: number;
  rationale: string | null;
  strengths: string[];
  improvements: string[];
  answer_preview: string | null;
}

export interface AttemptGrades {
  attempt_id: string;
  template_name: string | null;
  status: string;
  total_score: number | null;
  max_score: number | null;
  grades: QuestionGrade[];
}

/**
 * Per-question AI grades for one attempt, newest structure aside — ordered by
 * the template's question position so the recruiter reads it like the exam.
 * Rationale text is capped client-side; the full answer stays in the database.
 */
export async function getAttemptAiGrades(accessToken: string): Promise<AttemptGrades | null> {
  await requireStaff("/candidates");
  const supabase = await createSupabaseServerClient();

  const { data: attempt } = await supabase
    .from("candidate_attempts")
    .select("id, status, total_score, max_score, assessment_templates(name)")
    .eq("access_token", accessToken)
    .maybeSingle();

  if (!attempt) return null;

  const { data: responses } = await supabase
    .from("candidate_responses")
    .select(
      "question_id, answer_text, score, max_score, ai_evaluation, assessment_questions(title, question_type, position)"
    )
    .eq("attempt_id", attempt.id)
    .order("position", { referencedTable: "assessment_questions", ascending: true });

  const grades = ((responses ?? []) as unknown[]).map((row) => {
    const response = row as {
      question_id: string;
      answer_text: string | null;
      score: number | null;
      max_score: number;
      ai_evaluation: {
        score?: number;
        rationale?: string;
        strengths?: string[];
        improvements?: string[];
      } | null;
      assessment_questions?: { title?: string; question_type?: string } | null;
    };
    const question = response.assessment_questions;
    return {
      id: response.question_id,
      title: question?.title ?? "Question",
      question_type: question?.question_type ?? "MULTIPLE_CHOICE",
      score: response.score,
      max_score: response.max_score,
      rationale: response.ai_evaluation?.rationale ?? null,
      strengths: response.ai_evaluation?.strengths ?? [],
      improvements: response.ai_evaluation?.improvements ?? [],
      answer_preview: response.answer_text ? response.answer_text.slice(0, 400) : null,
    } satisfies QuestionGrade;
  });

  const template = attempt.assessment_templates as { name?: string } | null;

  return {
    attempt_id: attempt.id,
    template_name: template?.name ?? "Assessment",
    status: attempt.status,
    total_score: attempt.total_score === null ? null : Number(attempt.total_score),
    max_score: attempt.max_score === null ? null : Number(attempt.max_score),
    grades,
  };
}
