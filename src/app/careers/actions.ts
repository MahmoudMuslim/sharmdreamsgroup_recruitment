"use server";

import { revalidatePath, cacheLife } from "next/cache";
import { after } from "next/server";
import { getSupabaseAnonClient } from "@/lib/supabase/anon";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasAiProvider } from "@/lib/config.server";
import { extractCvText, type ExtractedCv as _ExtractedCv } from "@/modules/screening/infrastructure/cvParser";
import {
  getAiAutomationSettings,
  screenApplicationById,
} from "@/modules/screening/application/screen-application";

/**
 * Public careers site.
 *
 * Everything here runs without a session. `jobs_public_read` exposes only
 * PUBLISHED openings and `applications_public_insert` allows submission, so the
 * RLS layer — not this file — is what keeps drafts and other candidates'
 * applications private.
 *
 * Nothing here may return another applicant's data.
 */

export interface PublicJob {
  id: string;
  title: string;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  description: string;
  requirements: string[];
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string;
  company_name: string | null;
}

const JOB_COLUMNS =
  "id, title, department, sector, location, employment_type, description, requirements, min_salary_usd, max_salary_usd, salary_currency, tenants_and_companies(name)";

/** Normalises the company join, which PostgREST returns as object or array. */
function companyName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (row && typeof row === "object" && "name" in row) {
    const name = (row as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

function toJob(row: Record<string, unknown>): PublicJob {
  const requirements = row.requirements;
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    department: String(row.department ?? ""),
    sector: String(row.sector ?? ""),
    location: String(row.location ?? ""),
    employment_type: String(row.employment_type ?? ""),
    description: String(row.description ?? ""),
    // Seeded rows carry a JSON array, but a hand-edited row could hold a string,
    // so both shapes are accepted rather than rendering "[object Object]".
    requirements: Array.isArray(requirements)
      ? requirements.map((item) => String(item))
      : typeof requirements === "string" && requirements
        ? [requirements]
        : [],
    min_salary_usd: row.min_salary_usd === null ? null : Number(row.min_salary_usd),
    max_salary_usd: row.max_salary_usd === null ? null : Number(row.max_salary_usd),
    salary_currency: String(row.salary_currency ?? "USD"),
    company_name: companyName(row.tenants_and_companies),
  };
}

/**
 * Every open role.
 *
 * Read through the anon client and cached, because a job board is the same for
 * every visitor. RLS still applies — an anonymous read cannot see anything but
 * PUBLISHED rows — but caching it here means the page renders as a static shell
 * instead of hitting the database per request.
 *
 * Staleness is handled on both sides, because a cached list plus an uncached
 * write path is how a just-published job silently fails to appear:
 *   • the window is short (`minutes`), bounding worst-case staleness;
 *   • `createJobOpening` calls revalidatePath("/careers"), so a role published
 *     through the app evicts the entry immediately.
 */
export async function getPublicJobs(): Promise<PublicJob[]> {
  "use cache";
  cacheLife("minutes");

  const supabase = getSupabaseAnonClient();

  try {
    const { data, error } = await supabase
      .from("job_openings")
      .select(JOB_COLUMNS)
      .eq("status", "PUBLISHED")
      .order("posted_at", { ascending: false });

    if (error) {
      // During build without valid credentials, return empty array
      console.warn("[getPublicJobs] Supabase error (likely build time):", error.message);
      return [];
    }
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toJob);
  } catch (e) {
    // Handle network/auth errors during build
    console.warn("[getPublicJobs] Build-time error, returning empty:", e);
    return [];
  }
}

/**
 * One published role, or null. Drafts are invisible even by direct URL.
 *
 * Cached briefly so the detail page can be prerendered. The staleness cost is
 * bounded and stated rather than hidden: a role published in the last few
 * minutes may briefly 404, and a role closed in the last few minutes may briefly
 * still resolve. `cacheLife("minutes")` keeps both windows to roughly one
 * revalidation cycle instead of the hours the list page uses.
 */
export async function getPublicJob(id: string): Promise<PublicJob | null> {
  "use cache";
  cacheLife("minutes");

  const supabase = getSupabaseAnonClient();

  try {
    const { data, error } = await supabase
      .from("job_openings")
      .select(JOB_COLUMNS)
      .eq("id", id)
      .eq("status", "PUBLISHED")
      .maybeSingle();

    if (error) {
      console.warn("[getPublicJob] Supabase error (likely build time):", error.message);
      return null;
    }
    if (!data) return null;
    return toJob(data as unknown as Record<string, unknown>);
  } catch (e) {
    console.warn("[getPublicJob] Build-time error, returning null:", e);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

export interface ApplyResult {
  ok: boolean;
  /** Tracking code the candidate uses to follow their application. */
  trackingCode?: string;
  error?: string;
}

export interface ApplyInput {
  jobId: string;
  fullName: string;
  email: string;
  phone: string;
  /** Pasted CV text, used for AI screening when no file is attached. */
  cvText: string;
  /** Storage path of an uploaded CV, if one was attached. */
  cvFilePath: string | null;
  source: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function submitApplication(input: ApplyInput): Promise<ApplyResult> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const cvText = input.cvText.trim().slice(0, 20_000);

  if (fullName.length < 2) return { ok: false, error: "Enter your full name." };
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (cvText.length < 40 && !input.cvFilePath) {
    return {
      ok: false,
      error: "Attach a CV or paste its text so we can review your application.",
    };
  }

  const supabase = getSupabaseServiceClient();

  // Re-checked server-side: a role could have been closed between the page
  // rendering and the form being submitted.
  const { data: job } = await supabase
    .from("job_openings")
    .select("id")
    .eq("id", input.jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!job) {
    return { ok: false, error: "This role is no longer accepting applications." };
  }

  // Candidate-set sources only. Anything else (LINKEDIN, ATS_IMPORT…) describes
  // how staff imported a record, and must not be forgeable from a public form.
  const allowedSources = new Set(["CAREER_SITE", "JOB_BOARD", "REFERRAL"]);
  const source = allowedSources.has(input.source) ? input.source : "CAREER_SITE";

  // The database owns tracking-code generation, so a public caller cannot
  // choose — or collide — a code.
  //
  // Inserted with the service role rather than anon. `applications_public_insert`
  // permits anon to submit, but reading the row back needs a SELECT policy that
  // deliberately does not extend to anonymous callers — so PostgREST's
  // `RETURNING tracking_code` is refused with 42501. The candidate must be told
  // their code, so the row has to be readable, and this server action is the
  // trust boundary: it validates the inputs and checks the role is still open
  // before writing.
  // If a file was uploaded, download it, extract text, and use that as cv_text.
  // This is the trust boundary: the candidate uploads, we parse, the parsed text
  // goes into the database where the AI screening reads it.
  let finalCvText = cvText;

  if (input.cvFilePath) {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("candidate-cvs")
      .download(input.cvFilePath);

    if (!downloadError && fileData) {
      const arrayBuffer = await fileData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Detect mime from the stored path extension (we control the upload).
      const ext = input.cvFilePath.split(".").pop()?.toLowerCase() ?? "";
      const mime =
        ext === "pdf"
          ? "application/pdf"
          : ext === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : ext === "doc"
              ? "application/msword"
              : ext === "txt"
                ? "text/plain"
                : "application/pdf";

      try {
        const extracted = await extractCvText(buffer, mime);
        if (!extracted.empty) {
          finalCvText = extracted.text;
        }
      } catch (extractionError) {
        // Log but don't fail the application — the pasted text (if any) is still valid.
        console.error("[apply] CV extraction failed:", extractionError);
      }
    }
  }

  const { data: created, error } = await supabase
    .from("applications")
    .insert({
      job_id: input.jobId,
      full_name: fullName,
      email,
      phone: phone || null,
      cv_text: finalCvText || null,
      cv_file_path: input.cvFilePath,
      source,
      stage: "NEW",
    })
    .select("id, tracking_code")
    .single();

  if (error) {
    // 23505 is the partial unique index: this person already has a live
    // application for this role.
    if (error.code === "23505") {
      if (error.message.includes("applications_one_live_per_job")) {
        return {
          ok: false,
          error:
            "You already have an application in progress for this role. Check your tracking code, or contact the HR team to update your details.",
        };
      }
      return { ok: false, error: "That tracking code is already in use. Try again." };
    }
    if (error.code === "42501") {
      return { ok: false, error: "Your application could not be accepted. Please try again." };
    }
    return { ok: false, error: "Your application could not be submitted. Please try again." };
  }

  // The recruiter's job list shows application counts, so refresh it.
  revalidatePath("/careers");
  revalidatePath("/jobs");

  // Auto-screening runs after the candidate's response is sent, so submitting
  // an application never waits on a model call. Honour the Settings toggle —
  // recruiters can also screen any application on demand from the profile
  // drawer.
  if (created?.id && hasAiProvider()) {
    const applicationId = String(created.id);
    const settings = await getAiAutomationSettings();
    if (settings.aiEnabled && settings.autoScreen) {
      after(() => screenApplicationById(applicationId).then(() => undefined));
    }
  }

  return { ok: true, trackingCode: created?.tracking_code ?? "" };
}