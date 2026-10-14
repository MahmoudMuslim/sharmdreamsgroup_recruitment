"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";

export interface IntegrityFlag {
  id: string;
  event_type: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  detail: string | null;
  device_label: string | null;
  occurred_at: string;
  question_title: string | null;
}

export interface AttemptIntegrity {
  attempt_id: string;
  access_token: string;
  status: string;
  score: number | null;
  max_score: number | null;
  candidate_name: string;
  job_title: string | null;
  integrity_score: number | null;
  integrity_flags: number;
  /** `security.mask_scores_for_reviewers` — the numbers above were dropped, not absent. */
  scores_masked: boolean;
  events: IntegrityFlag[];
}

/**
 * Integrity report for a single attempt, newest events first.
 *
 * These are advisory signals for human review, never an automatic rejection
 * basis — the recruiter weighs them alongside the rest of the application.
 *
 * With `security.mask_scores_for_reviewers` on and no `scores.view_unmasked`
 * grant, the three numbers are replaced by nulls here rather than hidden in
 * JSX, so a masked score never travels to the browser at all. The recorded
 * events stay: they describe what happened, not how the candidate scored.
 */
export async function getAttemptIntegrity(
  accessToken: string
): Promise<AttemptIntegrity | null> {
  await requireStaff("/candidates");
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);

  const { data: attempt } = await supabase
    .from("candidate_attempts")
    .select(
      "id, access_token, status, total_score, max_score, integrity_score, integrity_flags, applications(full_name, job_openings(title))"
    )
    .eq("access_token", accessToken)
    .maybeSingle();

  if (!attempt) return null;

  const application = Array.isArray(attempt.applications)
    ? attempt.applications[0]
    : attempt.applications;
  const job = application?.job_openings as { title?: string } | null;

  const { data: events } = await supabase
    .from("integrity_events")
    .select(
      "id, event_type, severity, detail, device_label, occurred_at, assessment_questions(title)"
    )
    .eq("attempt_id", attempt.id)
    .order("occurred_at", { ascending: false })
    .limit(100);

  return {
    attempt_id: attempt.id,
    access_token: attempt.access_token,
    status: attempt.status,
    score: masked ? null : (attempt.total_score ?? null),
    max_score: masked ? null : (attempt.max_score ?? null),
    candidate_name: application?.full_name ?? "Unknown",
    job_title: job?.title ?? null,
    integrity_score: masked ? null : (attempt.integrity_score ?? null),
    integrity_flags: attempt.integrity_flags ?? 0,
    scores_masked: masked,
    events: ((events ?? []) as unknown[]).map((row) => {
      const event = row as {
        id: string;
        event_type: string;
        severity: IntegrityFlag["severity"];
        detail: string | null;
        device_label: string | null;
        occurred_at: string;
        assessment_questions?: { title?: string } | { title?: string }[] | null;
      };
      const question = Array.isArray(event.assessment_questions)
        ? event.assessment_questions[0]
        : event.assessment_questions;
      return {
        id: event.id,
        event_type: event.event_type,
        severity: event.severity,
        detail: event.detail,
        device_label: event.device_label,
        occurred_at: event.occurred_at,
        question_title: question?.title ?? null,
      };
    }),
  };
}