"use server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { supabaseConfig } from "@/lib/config";
import { createClient } from "@supabase/supabase-js";

export interface TrackedApplication {
  id: string;
  tracking_code: string;
  full_name: string;
  stage: string;
  source: string;
  created_at: string;
  job_title: string | null;
  company_name: string | null;
  ai_match_score: number | null;
  ai_feedback: string | null;
  /** null when no assessment has been assigned yet. */
  attempt: {
    access_token: string;
    status: string;
    started_at: string | null;
    expires_at: string | null;
    submitted_at: string | null;
    total_score: number | null;
    max_score: number | null;
  } | null;
}

/**
 * Looks a candidate up by the tracking code issued when they applied.
 *
 * Runs on the server and returns only the columns a candidate is entitled to
 * see — never other people's applications, CV text or internal notes.
 *
 * Row Level Security intentionally hides `applications` from anonymous callers
 * (only staff can read them), so the lookup uses the service-role client. That
 * is safe here because the query is keyed on the tracking code, which is an
 * unguessable per-candidate secret issued at application time — the same class
 * of secret that gates the assessment runner. No listing endpoint exists, so
 * the secret cannot be enumerated.
 */
export async function trackApplication(
  trackingCode: string
): Promise<{ ok: boolean; applications: TrackedApplication[]; error?: string }> {
  const code = trackingCode.trim().toUpperCase();

  if (code.length < 4) {
    return { ok: false, applications: [], error: "Enter the tracking code you were given when you applied." };
  }

  let supabase: ReturnType<typeof getSupabaseServiceClient>;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    // Service role not configured — fall back to the anon key.
    supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { persistSession: false },
    }) as unknown as ReturnType<typeof getSupabaseServiceClient>;
  }

  const { data, error } = await supabase
    .from("applications")
    .select(
      // No `!inner` on candidate_attempts: candidates without an assigned
      // assessment must still be findable (most are at screening stage).
      "id, tracking_code, full_name, stage, source, created_at, ai_match_score, ai_feedback, job_openings(title, tenants_and_companies(name)), candidate_attempts(access_token, status, started_at, expires_at, submitted_at, total_score, max_score)"
    )
    .eq("tracking_code", code)
    .limit(5);

  if (error) {
    return { ok: false, applications: [], error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      applications: [],
      error: "No application found for that tracking code. Check the code from your application confirmation.",
    };
  }

  const applications: TrackedApplication[] = data.map((row) => {
    const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
    const company = job?.tenants_and_companies as { name?: string } | undefined;
    const attempts = row.candidate_attempts as unknown;

    const attemptRow = Array.isArray(attempts)
      ? attempts[0]
      : (attempts as { access_token?: string } | null);

    return {
      id: row.id,
      tracking_code: row.tracking_code,
      full_name: row.full_name,
      stage: row.stage,
      source: row.source,
      created_at: row.created_at,
      job_title: job?.title ?? null,
      company_name: company?.name ?? null,
      ai_match_score: row.ai_match_score,
      ai_feedback: row.ai_feedback,
      attempt: attemptRow?.access_token
        ? {
            access_token: attemptRow.access_token,
            status: attemptRow.status ?? "NOT_STARTED",
            started_at: attemptRow.started_at ?? null,
            expires_at: attemptRow.expires_at ?? null,
            submitted_at: attemptRow.submitted_at ?? null,
            total_score: attemptRow.total_score ?? null,
            max_score: attemptRow.max_score ?? null,
          }
        : null,
    };
  });

  return { ok: true, applications };
}