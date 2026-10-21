"use server";

import { getSupabaseServiceClient } from "@/lib/data-api/service";

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

/** A message the hiring team left in this candidate's portal inbox. */
export interface PortalNotice {
  id: string;
  application_id: string;
  subject: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface TrackResult {
  ok: boolean;
  applications: TrackedApplication[];
  /** Portal notices for the returned applications, newest first. */
  notices: PortalNotice[];
  error?: string;
}

/**
 * Messages the candidate was never emailed or messaged? No — this is a copy of
 * every alert the platform recorded for their applications on the IN_APP
 * channel. `communication_logs` is hidden from anonymous callers by RLS, so the
 * read goes through the service-role client and is keyed on the applications the
 * tracking code resolves to. A candidate can only ever list their own inbox.
 */
async function loadNotices(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  applicationIds: string[]
): Promise<PortalNotice[]> {
  if (applicationIds.length === 0) return [];

  const { data } = await supabase
    .from("communication_logs")
    .select("id, application_id, subject, body, created_at, read_at")
    .eq("channel", "IN_APP")
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false })
    .limit(30);

  return ((data ?? []) as PortalNotice[]).map((row) => ({
    id: row.id,
    application_id: row.application_id,
    subject: row.subject ?? null,
    body: row.body,
    created_at: row.created_at,
    read_at: row.read_at ?? null,
  }));
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
export async function trackApplication(trackingCode: string): Promise<TrackResult> {
  const code = trackingCode.trim().toUpperCase();

  if (code.length < 4) {
    return { ok: false, applications: [], notices: [], error: "Enter the tracking code you were given when you applied." };
  }

  const supabase = getSupabaseServiceClient();

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
    return { ok: false, applications: [], notices: [], error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      applications: [],
      notices: [],
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

  const notices = await loadNotices(supabase, data.map((row) => row.id));

  return { ok: true, applications, notices };
}

/**
 * Stamps `read_at` on the candidate's unread portal notices.
 *
 * Keyed on the tracking code rather than the notice ids the page happens to
 * show, so a crafted request cannot mark another candidate's inbox as read.
 */
export async function markPortalNoticesRead(
  trackingCode: string
): Promise<{ ok: boolean; unread: number }> {
  const code = trackingCode.trim().toUpperCase();
  if (code.length < 4) return { ok: false, unread: 0 };

  let supabase: ReturnType<typeof getSupabaseServiceClient>;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    return { ok: false, unread: 0 };
  }

  const { data } = await supabase
    .from("applications")
    .select("id")
    .eq("tracking_code", code);

  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return { ok: false, unread: 0 };

  const { data: unread } = await supabase
    .from("communication_logs")
    .select("id")
    .eq("channel", "IN_APP")
    .in("application_id", ids)
    .is("read_at", null);

  if (unread && unread.length > 0) {
    await supabase
      .from("communication_logs")
      .update({ read_at: new Date().toISOString() })
      .in("id", unread.map((row) => row.id));
  }

  return { ok: true, unread: unread?.length ?? 0 };
}