"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";

/**
 * Applicants of one job opening, and what each of them actually submitted.
 *
 * The list deliberately omits `cv_text` and the screening summary: a CV is
 * several thousand characters and a recruiter opens one applicant at a time, so
 * the heavy fields are fetched on demand by `getApplicantSubmission`.
 *
 * CVs live in the private `candidate-cvs` bucket, readable only by staff
 * (migration 010). These actions run on the session client, so the storage
 * policy is what authorises a link — a signed URL handed to a non-staff browser
 * is never minted, and the URL itself expires.
 */

/** Every applicant for one opening, newest first, with their attempt if assigned. */
export interface JobApplicant {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  tracking_code: string;
  stage: string;
  source: string;
  applied_at: string;
  cv_name: string | null;
  ai_match_score: number | null;
  attempt_status: string | null;
  attempt_token: string | null;
  attempt_score: number | null;
  attempt_max: number | null;
  template_name: string | null;
}

/** The bulk of one application: the CV as submitted and the AI screening report. */
export interface ApplicantSubmission {
  /** Extracted text of the uploaded CV, or the text the candidate pasted. */
  cv_text: string | null;
  /** Short-lived link that opens the original file in the browser. */
  cv_url: string | null;
  /** Same file with a `Content-Disposition`, so the browser saves it. */
  cv_download_url: string | null;
  screening_summary: string | null;
}

export type ApplicantsResult = { ok: true; applicants: JobApplicant[] } | { ok: false; error: string };

export type SubmissionResult = { ok: true; submission: ApplicantSubmission } | { ok: false; error: string };

/** Signed links are read once, immediately after opening the panel. */
const CV_URL_LIFETIME_SECONDS = 15 * 60;

/**
 * The upload route stores `applications/<jobId>/<uuid>-<original name>`; the
 * random prefix is ours, so it is stripped to show the candidate their own
 * filename rather than a storage key.
 */
function cvDisplayName(path: string | null): string | null {
  if (!path) return null;
  const leaf = path.split("/").pop() ?? "";
  const stripped = leaf.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    ""
  );
  return stripped || leaf || null;
}

function attemptTemplate(attempt: Record<string, unknown> | null): string | null {
  const joined = attempt?.assessment_templates;
  const row = Array.isArray(joined) ? joined[0] : joined;
  if (row && typeof row === "object" && "name" in row) {
    const name = (row as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return null;
}

export async function getJobApplicants(jobId: string): Promise<ApplicantsResult> {
  await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, full_name, email, phone, tracking_code, stage, source, created_at, cv_file_path, ai_match_score, candidate_attempts(access_token, status, total_score, max_score, assessment_templates(name))"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[jobs] applicants query failed:", error.message);
    return { ok: false, error: "The applicant list could not be loaded. Please retry." };
  }

  const applicants = (data ?? []).map(
    (row: Record<string, unknown>) => {
      const embedded = row.candidate_attempts;
      const attempt = (Array.isArray(embedded) ? embedded[0] : embedded) as Record<
        string,
        unknown
      > | null;

      return {
        id: String(row.id),
        full_name: String(row.full_name ?? ""),
        email: String(row.email ?? ""),
        phone: row.phone ? String(row.phone) : null,
        tracking_code: String(row.tracking_code ?? ""),
        stage: String(row.stage ?? "NEW"),
        source: String(row.source ?? "CAREER_SITE"),
        applied_at: String(row.created_at ?? ""),
        cv_name: cvDisplayName(typeof row.cv_file_path === "string" ? row.cv_file_path : null),
        ai_match_score: row.ai_match_score === null ? null : Number(row.ai_match_score),
        attempt_status: attempt?.status ? String(attempt.status) : null,
        attempt_token: attempt?.access_token ? String(attempt.access_token) : null,
        attempt_score: attempt?.total_score == null ? null : Number(attempt.total_score),
        attempt_max: attempt?.max_score == null ? null : Number(attempt.max_score),
        template_name: attemptTemplate(attempt),
      } satisfies JobApplicant;
    }
  );

  return { ok: true, applicants };
}

/**
 * Everything too heavy for the list: the CV text and the screening summary,
 * plus the signed links for the stored file.
 */
export async function getApplicantSubmission(
  applicationId: string
): Promise<SubmissionResult> {
  await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const { data: row, error } = await supabase
    .from("applications")
    .select("id, cv_file_path, cv_text, ai_screening_summary")
    .eq("id", applicationId)
    .maybeSingle();

  if (error) {
    console.error("[jobs] submission query failed:", error.message);
    return { ok: false, error: "This application could not be opened. Please retry." };
  }
  if (!row) return { ok: false, error: "This application no longer exists." };

  const path = typeof row.cv_file_path === "string" ? row.cv_file_path : null;
  const name = cvDisplayName(path) ?? "cv";

  let cvUrl: string | null = null;
  let cvDownloadUrl: string | null = null;

  if (path) {
    const [view, download] = await Promise.all([
      supabase.storage
        .from("candidate-cvs")
        .createSignedUrl(path, CV_URL_LIFETIME_SECONDS),
      supabase.storage
        .from("candidate-cvs")
        .createSignedUrl(path, CV_URL_LIFETIME_SECONDS, { download: name }),
    ]);

    if (!view.data?.signedUrl) {
      const reason = view.error?.message ?? download.error?.message ?? "unknown";
      console.error("[jobs] CV link failed:", reason);
      return {
        ok: false,
        error: "The attached CV could not be opened — the candidate may have uploaded it before CV storage was enabled.",
      };
    }

    cvUrl = view.data.signedUrl;
    cvDownloadUrl = download.data?.signedUrl ?? null;
  }

  return {
    ok: true,
    submission: {
      cv_text: row.cv_text ? String(row.cv_text) : null,
      cv_url: cvUrl,
      cv_download_url: cvDownloadUrl,
      screening_summary: row.ai_screening_summary ? String(row.ai_screening_summary) : null,
    },
  };
}
