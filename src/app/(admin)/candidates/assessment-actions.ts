"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { supabaseConfig } from "@/lib/config";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";

export interface QuestionGrade {
  id: string;
  title: string;
  question_type: string;
  score: number | null;
  max_score: number | null;
  rationale: string | null;
  strengths: string[];
  improvements: string[];
  answer_preview: string | null;
  /** Short-lived playback link, present only for recorded pitches. */
  video_url: string | null;
  transcript: string | null;
}

export interface AttemptGrades {
  attempt_id: string;
  template_name: string | null;
  status: string;
  total_score: number | null;
  max_score: number | null;
  /** `security.mask_scores_for_reviewers` — marks were dropped from these rows. */
  scores_masked: boolean;
  grades: QuestionGrade[];
}

/**
 * Per-question AI grades for one attempt, newest structure aside — ordered by
 * the template's question position so the recruiter reads it like the exam.
 * Rationale text is capped client-side; the full answer stays in the database.
 *
 * The marks themselves follow the same rule as the candidate table: under
 * `security.mask_scores_for_reviewers` they are dropped here, so a reviewer
 * without `scores.view_unmasked` cannot recover them from this report either.
 * Answers, recordings and the AI's written feedback stay visible.
 */
export async function getAttemptAiGrades(accessToken: string): Promise<AttemptGrades | null> {
  await requireStaff("/candidates");
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);

  const { data: attempt } = await supabase
    .from("candidate_attempts")
    .select("id, status, total_score, max_score, assessment_templates(name)")
    .eq("access_token", accessToken)
    .maybeSingle();

  if (!attempt) return null;

  const { data: responses } = await supabase
    .from("candidate_responses")
    .select(
      "question_id, answer_text, video_path, transcript, score, max_score, ai_evaluation, assessment_questions(title, question_type, position)"
    )
    .eq("attempt_id", attempt.id)
    .order("position", { referencedTable: "assessment_questions", ascending: true });

  const grades: QuestionGrade[] = [];
  for (const row of (responses ?? []) as {
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
    } | null;
    assessment_questions?: { title?: string; question_type?: string } | null;
  }[]) {
    const question = row.assessment_questions;

    // Recordings live in a private bucket. Staff may watch them, so mint a
    // short-lived playback link rather than exposing a public URL.
    let videoUrl: string | null = null;
    if (row.video_path) {
      const { data: signed } = await supabase.storage
        .from(supabaseConfig.buckets.candidateVideos)
        .createSignedUrl(row.video_path, 60 * 60);
      videoUrl = signed?.signedUrl ?? null;
    }

    grades.push({
      id: row.question_id,
      title: question?.title ?? "Question",
      question_type: question?.question_type ?? "MULTIPLE_CHOICE",
      score: masked ? null : row.score,
      max_score: masked ? null : row.max_score,
      rationale: row.ai_evaluation?.rationale ?? null,
      strengths: row.ai_evaluation?.strengths ?? [],
      improvements: row.ai_evaluation?.improvements ?? [],
      answer_preview: row.answer_text ? row.answer_text.slice(0, 400) : null,
      video_url: videoUrl,
      transcript: row.transcript ? row.transcript.slice(0, 1200) : null,
    });
  }

  const template = attempt.assessment_templates as { name?: string } | null;

  return {
    attempt_id: attempt.id,
    template_name: template?.name ?? "Assessment",
    status: attempt.status,
    total_score: masked || attempt.total_score === null ? null : Number(attempt.total_score),
    max_score: masked || attempt.max_score === null ? null : Number(attempt.max_score),
    scores_masked: masked,
    grades,
  };
}
