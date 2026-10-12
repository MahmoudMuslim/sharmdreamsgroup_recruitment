"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";

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
  events: IntegrityFlag[];
}

/**
 * Integrity report for a single attempt, newest events first.
 *
 * These are advisory signals for human review, never an automatic rejection
 * basis — the recruiter weighs them alongside the rest of the application.
 */
export async function getAttemptIntegrity(
  accessToken: string
): Promise<AttemptIntegrity | null> {
  await requireStaff("/candidates");
  const supabase = await createSupabaseServerClient();

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
    score: attempt.total_score ?? null,
    max_score: attempt.max_score ?? null,
    candidate_name: application?.full_name ?? "Unknown",
    job_title: job?.title ?? null,
    integrity_score: attempt.integrity_score ?? null,
    integrity_flags: attempt.integrity_flags ?? 0,
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

/** Attempt-level integrity rollup across all candidates, for the candidates table. */
export async function getIntegritySummary(): Promise<
  Record<string, { score: number | null; flags: number }>
> {
  await requireStaff("/candidates");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("candidate_attempts")
    .select("application_id, integrity_score, integrity_flags");

  const summary: Record<string, { score: number | null; flags: number }> = {};
  for (const row of data ?? []) {
    if (!row.application_id) continue;
    summary[row.application_id] = {
      score: row.integrity_score ?? null,
      flags: row.integrity_flags ?? 0,
    };
  }
  return summary;
}