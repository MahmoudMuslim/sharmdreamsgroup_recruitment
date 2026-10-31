import { getServiceRestClient } from "@/lib/data-api/service";
import { after } from "next/server";
import { gradeAttemptResponses } from "@/modules/assessment/application/gradeAttempt";
import { recordActivity } from "@/modules/activity/application/record";
import { APPLICATION_EMBED, attemptContext, runnerActor } from "@/modules/assessment/application/runner-trail";
import { NextResponse } from "next/server";
import { judgeChoice } from "@/modules/assessment/domain/situational";
import { codeAnswerOverCapMessage, codeAnswersOverCap } from "@/modules/assessment/domain/coding";
import type { QuestionConfig, SpreadsheetCellData } from "@/types";

interface SubmitBody {
  spreadsheet_data_map?: Record<string, Record<string, SpreadsheetCellData>>;
  case_study_answers_map?: Record<string, string>;
  code_answers_map?: Record<string, string>;
  choice_answers_map?: Record<string, string>;
  video_paths_map?: Record<string, string>;
  time_remaining_seconds?: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json().catch(() => ({}))) as SubmitBody;

  const restClient = getServiceRestClient();
  const { data: attempt, error } = await restClient
    .from("candidate_attempts")
    .select(`id, status, template_id, application_id, ${APPLICATION_EMBED}`)
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

  const { data: questions } = await restClient
    .from("assessment_questions")
    .select("id, question_type, points, title, config")
    .eq("template_id", attempt.template_id);
  const questionById = new Map((questions ?? []).map((q) => [q.id, q]));

  // The store refuses an over-cap answer before it leaves the browser, but a
  // stale client must not be trusted: the refusal is repeated before any write.
  const overCapTitle = codeAnswersOverCap(
    body.code_answers_map ?? {},
    new Map((questions ?? []).map((q) => [q.id, q.title]))
  );
  if (overCapTitle) {
    return NextResponse.json({ error: codeAnswerOverCapMessage(overCapTitle) }, { status: 400 });
  }

  const responseRows: Record<string, unknown>[] = [];
  let totalScore = 0;
  let maxScore = 0;

  // Quizzes have one key; judgment scenes carry a percentage per response and
  // are marked against it below. Both types are auto-graded server-side, so
  // their scores are final before the background grader sees the attempt.
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
    if (!question || question.question_type !== "CASE_STUDY" || handled.has(questionId)) continue;
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

  for (const [questionId, answerText] of Object.entries(body.code_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || question.question_type !== "CODING" || handled.has(questionId)) continue;
    maxScore += question.points;
    responseRows.push({
      attempt_id: attempt.id,
      question_id: questionId,
      answer_text: answerText,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
    handled.add(questionId);
  }

  for (const [questionId, label] of Object.entries(body.choice_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || handled.has(questionId)) continue;

    if (question.question_type === "SITUATIONAL_JUDGMENT") {
      // The pick earns the response's own percentage of the question's marks,
      // rounded once. A stored row that carries no usable score yields 0 and a
      // rationale that says so, rather than silently crediting the question.
      const verdict = judgeChoice(
        question.points,
        question.config as QuestionConfig,
        label
      );
      totalScore += verdict.score;
      maxScore += question.points;
      responseRows.push({
        attempt_id: attempt.id,
        question_id: questionId,
        answer_text: label,
        score: verdict.score,
        max_score: question.points,
        ai_evaluation: {
          score: verdict.score,
          rationale: verdict.rationale,
          strengths: verdict.strengths,
          improvements: verdict.improvements,
        },
        updated_at: new Date().toISOString(),
      });
      handled.add(questionId);
      continue;
    }

    if (question.question_type !== "MULTIPLE_CHOICE") continue;

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
    const { error: upsertError } = await restClient
      .from("candidate_responses")
      .upsert(responseRows, { onConflict: "attempt_id,question_id" });
    if (upsertError) {
      return NextResponse.json({ error: "Failed to save responses" }, { status: 500 });
    }
  }

  const submittedAt = new Date().toISOString();
  const { error: updateError } = await restClient
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
  await restClient
    .from("applications")
    .update({ stage: "ASSESSMENT" })
    .eq("id", attempt.application_id);

  const { candidateName, jobTitle, applicationStage } = attemptContext(attempt);
  const actor = runnerActor(candidateName);

  await recordActivity({
    ...actor,
    area: "assessments",
    action: "attempt_submitted",
    entity: "attempt",
    entityId: attempt.id,
    summary: `${candidateName} submitted the ${jobTitle} test — ${responseRows.length} answer${responseRows.length === 1 ? "" : "s"} stored, ${totalScore} of ${maxScore} points on what grades itself`,
    detail: {
      responses: responseRows.length,
      auto_scored_points: totalScore,
      submitted_points: maxScore,
      videos: Object.keys(body.video_paths_map ?? {}).length,
      seconds_left_on_clock: body.time_remaining_seconds ?? null,
      note: "Essays, models and pitches wait for the grading engine behind this request.",
    },
  });

  if (attempt.application_id && applicationStage && applicationStage !== "ASSESSMENT") {
    await recordActivity({
      ...actor,
      area: "candidates",
      action: "stage_move",
      entity: "application",
      entityId: attempt.application_id,
      summary: `${candidateName}'s application for ${jobTitle} moved to Assessment on their own submission`,
      detail: { from: applicationStage, to: "ASSESSMENT" },
    });
  }

  // Grade essays and models in the background; the candidate's confirmation
  // must not wait on AI latency, and grading errors never lose their answers.
  after(async () => {
    try {
      await gradeAttemptResponses(attempt.id);
    } catch (error) {
      console.error("Background attempt grading failed:", error);
    }
  });

  return NextResponse.json({ ok: true, submitted_at: submittedAt, total_score: totalScore, max_score: maxScore });
}
