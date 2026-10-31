import { getServiceRestClient } from "@/lib/data-api/service";
import { NextResponse } from "next/server";
import type { SpreadsheetCellData } from "@/types";

interface DraftBody {
  current_question_index?: number;
  time_remaining_seconds?: number;
  spreadsheet_data_map?: Record<string, Record<string, SpreadsheetCellData>>;
  case_study_answers_map?: Record<string, string>;
  code_answers_map?: Record<string, string>;
  choice_answers_map?: Record<string, string>;
  video_paths_map?: Record<string, string>;
}

export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as DraftBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid draft payload" }, { status: 400 });
  }

  const restClient = getServiceRestClient();
  const { data: attempt, error } = await restClient
    .from("candidate_attempts")
    .select("id, status, template_id, expires_at")
    .eq("access_token", token)
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }
  if (attempt.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "Assessment is not in progress" }, { status: 409 });
  }

  const { data: questions } = await restClient
    .from("assessment_questions")
    .select("id, question_type, points")
    .eq("template_id", attempt.template_id);
  const questionById = new Map((questions ?? []).map((q) => [q.id, q]));

  // Upsert each answered question as a candidate_response row.
  const upserts: Record<string, unknown>[] = [];
  for (const [questionId, cells] of Object.entries(body.spreadsheet_data_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question) continue;
    upserts.push({
      attempt_id: attempt.id,
      question_id: questionId,
      spreadsheet_state: cells,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
  }
  for (const [questionId, text] of Object.entries(body.case_study_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || question.question_type !== "CASE_STUDY") continue;
    upserts.push({
      attempt_id: attempt.id,
      question_id: questionId,
      answer_text: text,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
  }
  for (const [questionId, answerText] of Object.entries(body.code_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || question.question_type !== "CODING") continue;
    upserts.push({
      attempt_id: attempt.id,
      question_id: questionId,
      answer_text: answerText,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
  }
  for (const [questionId, label] of Object.entries(body.choice_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question) continue;
    upserts.push({
      attempt_id: attempt.id,
      question_id: questionId,
      answer_text: label,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
  }
  for (const [questionId, path] of Object.entries(body.video_paths_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question) continue;
    upserts.push({
      attempt_id: attempt.id,
      question_id: questionId,
      video_path: path,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    const { error: upsertError } = await restClient
      .from("candidate_responses")
      .upsert(upserts, { onConflict: "attempt_id,question_id" });
    if (upsertError) {
      return NextResponse.json({ error: "Draft save failed" }, { status: 500 });
    }
  }

  // Keep the timer authoritative server-side.
  const remaining = body.time_remaining_seconds;
  const expiresAt =
    typeof remaining === "number" && remaining > 0
      ? new Date(Date.now() + remaining * 1000).toISOString()
      : attempt.expires_at;

  const { error: updateError } = await restClient
    .from("candidate_attempts")
    .update({ draft_saved_at: new Date().toISOString(), current_index_hint: body.current_question_index ?? 0, expires_at: expiresAt })
    .eq("id", attempt.id);

  if (updateError) {
    // Non-fatal: draft_saved_at is cosmetic; responses were persisted.
  }

  return NextResponse.json({ ok: true, saved_at: new Date().toISOString() });
}
