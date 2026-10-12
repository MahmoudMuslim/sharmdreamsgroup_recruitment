import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";
import type { SpreadsheetCellData } from "@/types";

interface SubmitBody {
  spreadsheet_data_map?: Record<string, Record<string, SpreadsheetCellData>>;
  case_study_answers_map?: Record<string, string>;
  choice_answers_map?: Record<string, string>;
  video_paths_map?: Record<string, string>;
  time_remaining_seconds?: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json().catch(() => ({}))) as SubmitBody;

  const supabase = getSupabaseServiceClient();
  const { data: attempt, error } = await supabase
    .from("candidate_attempts")
    .select("id, status, template_id, application_id")
    .eq("access_token", token)
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }
  if (attempt.status === "SUBMITTED" || attempt.status === "GRADED") {
    return NextResponse.json({ ok: true, alreadySubmitted: true });
  }
  if (attempt.status === "EXPIRED") {
    return NextResponse.json({ error: "Assessment has expired" }, { status: 409 });
  }

  const { data: questions } = await supabase
    .from("assessment_questions")
    .select("id, question_type, points, config")
    .eq("template_id", attempt.template_id);
  const questionById = new Map((questions ?? []).map((q) => [q.id, q]));

  const responseRows: Record<string, unknown>[] = [];
  let totalScore = 0;
  let maxScore = 0;

  // Multiple-choice questions are auto-graded server-side.
  const choiceQuestions = (questions ?? []).filter((q) => q.question_type === "MULTIPLE_CHOICE");
  const correctByQuestion = new Map<string, string | null>();
  for (const question of choiceQuestions) {
    const options = ((question.config as { options?: { label: string; is_correct?: boolean }[] }).options ?? []);
    const correct = options.find((option) => option.is_correct);
    correctByQuestion.set(question.id, correct?.label ?? null);
  }

  const handled = new Set<string>();

  for (const [questionId, cells] of Object.entries(body.spreadsheet_data_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question) continue;
    maxScore += question.points;
    responseRows.push({
      attempt_id: attempt.id,
      question_id: questionId,
      spreadsheet_state: cells,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
    handled.add(questionId);
  }

  for (const [questionId, text] of Object.entries(body.case_study_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || handled.has(questionId)) continue;
    maxScore += question.points;
    responseRows.push({
      attempt_id: attempt.id,
      question_id: questionId,
      answer_text: text,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
    handled.add(questionId);
  }

  for (const [questionId, label] of Object.entries(body.choice_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || handled.has(questionId)) continue;
    const correct = correctByQuestion.get(questionId);
    const score = correct !== null && correct === label ? question.points : 0;
    totalScore += score;
    maxScore += question.points;
    responseRows.push({
      attempt_id: attempt.id,
      question_id: questionId,
      answer_text: label,
      score,
      max_score: question.points,
      ai_evaluation: {
        score,
        rationale:
          score > 0
            ? "Correct answer selected."
            : correct
              ? `Incorrect — the correct answer was ${correct}.`
              : "No correct answer recorded for this question.",
        strengths: score > 0 ? ["Accurate financial reasoning"] : [],
        improvements: score > 0 ? [] : ["Review core concepts tested by this quiz"],
      },
      updated_at: new Date().toISOString(),
    });
    handled.add(questionId);
  }

  for (const [questionId, path] of Object.entries(body.video_paths_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || handled.has(questionId)) continue;
    maxScore += question.points;
    responseRows.push({
      attempt_id: attempt.id,
      question_id: questionId,
      video_path: path,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
    handled.add(questionId);
  }

  if (responseRows.length > 0) {
    const { error: upsertError } = await supabase
      .from("candidate_responses")
      .upsert(responseRows, { onConflict: "attempt_id,question_id" });
    if (upsertError) {
      return NextResponse.json({ error: "Failed to save responses" }, { status: 500 });
    }
  }

  const submittedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("candidate_attempts")
    .update({
      status: "SUBMITTED",
      submitted_at: submittedAt,
      total_score: totalScore,
      max_score: maxScore,
    })
    .eq("id", attempt.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to finalize submission" }, { status: 500 });
  }

  // Advance the application pipeline to ASSESSMENT review.
  await supabase
    .from("applications")
    .update({ stage: "ASSESSMENT" })
    .eq("id", attempt.application_id);

  return NextResponse.json({ ok: true, submitted_at: submittedAt, total_score: totalScore, max_score: maxScore });
}
