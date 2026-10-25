"use server";

import { revalidatePath, cacheLife } from "next/cache";
import { after } from "next/server";
import { getAnonRestClient } from "@/lib/data-api/anon";
import { getServiceRestClient } from "@/lib/data-api/service";
import { getFileStore } from "@/lib/files/store";
import { hasAiProvider } from "@/lib/config.server";
import { extractCvText, type ExtractedCv as _ExtractedCv } from "@/modules/screening/infrastructure/cvParser";
import { CV_TEXT_MIN_CHARS, profileLink } from "@/modules/careers/cv-rules";
import {
  getAiAutomationSettings,
  screenApplicationById,
} from "@/modules/screening/application/screen-application";
import { notifyStageChange } from "@/modules/omnichannel/application/candidate-notifications";
import { recordActivity } from "@/modules/activity/application/record";
import {
  evaluateGate,
  gateRejectionReason,
  parseGateRows,
  type GateQuestion,
} from "@/modules/careers/gate-questions";
import type { PublicJob } from "@/modules/careers/job-board";
import {
  isExperienceLevel,
  isMissingSchemaError,
} from "@/modules/jobs/domain/openingTerms";
import {
  toPublicCompany,
  type PublicCompany,
} from "@/modules/careers/company-profile";

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

// `experience_level` is deliberately absent: db/migrations/033_opening_terms.sql
// is authored but not applied, and naming the column here would fail the whole
// public board on every database that has not run it. It is read in its own
// probe below, which degrades to "not recorded".
const JOB_COLUMNS =
  "id, title, tenant_id, department, sector, location, employment_type, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, created_at, tenants_and_companies(name)";

/**
 * The company columns the public page prints, and nothing else.
 *
 * `contact_email`, `contact_phone` and `address` are deliberately not read here:
 * the policy that lets an anonymous visitor see a company row lets them see the
 * whole row, so the column list is what keeps a recruiting mailbox off a public
 * page rather than a rule written after the fact.
 */
const COMPANY_COLUMNS =
  `id, name, legal_name, slug, sector, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, website, is_active, sort_order, is_group_profile`;

/** Normalises the company join, which PostgREST returns as object or array. */
function companyName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (row && typeof row === "object" && "name" in row) {
    const name = (row as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

function toJob(row: Record<string, unknown>, experienceLevel: string | null = null): PublicJob {
  const requirements = row.requirements;
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    department: String(row.department ?? ""),
    sector: String(row.sector ?? ""),
    location: String(row.location ?? ""),
    employment_type: String(row.employment_type ?? ""),
    experience_level: experienceLevel,
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
    // The company's own id is what the board groups by; its name is what a role
    // card prints, so both are carried even when the row's company has no profile.
    company_id:
      typeof row.tenant_id === "string" && row.tenant_id ? row.tenant_id : null,
    company_name: companyName(row.tenants_and_companies),
    // `created_at` is `not null` in the database, so an absent value means the
    // read shape changed, not that the row has no date; it becomes "" and
    // `dateOf` treats "" as absent. The other two are nullable columns.
    posted_at: typeof row.posted_at === "string" ? row.posted_at : null,
    created_at: String(row.created_at ?? ""),
    closing_at: typeof row.closing_at === "string" ? row.closing_at : null,
  };
}

/**
 * The seniority map for the openings a public read returned.
 *
 * Read apart from the board's own columns so an unapplied 033 costs only the
 * tag: the row read still succeeds, every role keeps its card, and a missing
 * column reads as "not recorded" rather than throwing the board away. Only
 * stored codes the vocabulary recognises are carried — an unexpected value is
 * silence, the same as a null.
 */
async function experienceLevels(
  restClient: ReturnType<typeof getAnonRestClient>,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await restClient
    .from("job_openings")
    .select("id, experience_level")
    .in("id", ids);

  if (error) {
    // The missing column is the expected state until the owner applies 033, so
    // it is not logged on every cache revalidation; anything else is.
    if (!isMissingSchemaError(error)) {
      console.error("[careers] seniority levels unreadable:", error.message);
    }
    return new Map();
  }

  const levels = new Map<string, string>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const level = typeof row.experience_level === "string" ? row.experience_level : "";
    if (isExperienceLevel(level)) levels.set(String(row.id), level);
  }
  return levels;
}

/**
 * Every open role.
 *
 * Read through the anon client and cached, because a job board is the same for
 * every visitor. RLS still applies — an anonymous read cannot see anything but
 * PUBLISHED rows — but caching it here means the board is one read per
 * revalidation window instead of one per page view.
 *
 * Staleness is handled on both sides, because a cached list plus an uncached
 * write path is how a just-published job silently fails to appear:
 *   • the window is short — `minutes` revalidates every minute and expires in
 *     an hour — which bounds worst-case staleness;
 *   • `createJobOpening` calls revalidatePath("/careers"), so a role published
 *     through the app evicts the entry immediately.
 */
export async function getPublicJobs(): Promise<PublicJob[]> {
  "use cache";
  cacheLife("minutes");

  const restClient = getAnonRestClient();
  const { data, error } = await restClient
    .from("job_openings")
    .select(JOB_COLUMNS)
    .eq("status", "PUBLISHED")
    .order("posted_at", { ascending: false });

  if (error) throw new Error(`[getPublicJobs] ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const levels = await experienceLevels(
    restClient,
    rows.map((row) => String(row.id))
  );
  return rows.map((row) => toJob(row, levels.get(String(row.id)) ?? null));
}

/**
 * The companies behind the board, with the careers copy written for them.
 *
 * `is_active` is filtered here rather than trusted to the policy: `tenants_read`
 * lets an anonymous caller see every company row, retired ones included, and a
 * retired company still has the openings written while it was in use. Those rows
 * keep resolving inside the portal — and are not the group's story to tell
 * publicly.
 *
 * Cached like the board it heads, for the same reason: the words are the same for
 * every visitor, and a Settings → Master data edit revalidates this path.
 */
export async function getPublicCompanies(): Promise<PublicCompany[]> {
  "use cache";
  cacheLife("minutes");

  const restClient = getAnonRestClient();
  const { data, error } = await restClient
    .from("tenants_and_companies")
    .select(COMPANY_COLUMNS)
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw new Error(`[getPublicCompanies] ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toPublicCompany);
}

/**
 * One published role, or null. Drafts are invisible even by direct URL.
 *
 * Cached briefly so a wave of visitors to one role is one read, not one per
 * page view. The staleness cost is bounded and stated rather than hidden: a
 * role published within the last minute may briefly 404, and a role closed
 * within the last minute may briefly still resolve — `revalidate: 60` keeps
 * both windows to about one revalidation cycle.
 */
export async function getPublicJob(id: string): Promise<PublicJob | null> {
  "use cache";
  cacheLife("minutes");

  const restClient = getAnonRestClient();
  const { data, error } = await restClient
    .from("job_openings")
    .select(JOB_COLUMNS)
    .eq("id", id)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  // A failed read is not a missing role: the page turns `null` into a 404, and a
  // REST blip would then tell a candidate that a live opening does not exist.
  if (error) throw new Error(`[getPublicJob] ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const levels = await experienceLevels(restClient, [id]);
  return toJob(row, levels.get(id) ?? null);
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

export type ApplyResult =
  /**
   * Stored and waiting for review — the only outcome a candidate is ever shown.
   *
   * An application a viability question rules out returns through this same
   * branch, so the submit screen cannot be read as a verdict. The rejection
   * letter does follow, on the same channels and in the same words a recruiter's
   * own rejection uses — the templates carry no token for a reason, so being
   * told they were not accepted never tells them which answer decided it.
   */
  | { ok: true; outcome: "received"; trackingCode: string }
  | { ok: false; error: string };

export interface ApplyInput {
  jobId: string;
  fullName: string;
  email: string;
  phone: string;
  /** Pasted CV text, used for AI screening when no file is attached. */
  cvText: string;
  /** The candidate's own profile link, optional and validated before it is kept. */
  linkedinUrl: string;
  /** Storage path of an uploaded CV, if one was attached. */
  cvFilePath: string | null;
  source: string;
  /** Viability answers, keyed by question id. Scored against the stored options. */
  gateAnswers: Record<string, string>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The viability questions this role asks.
 *
 * Read with the service role, because the caller is anonymous and RLS scopes
 * `applications` reads to staff — so `is_active` has to be part of the query
 * rather than left to a policy. Job-scoped questions come back alongside the
 * ones asked for every role, which is exactly the set `/api/careers/questions`
 * rendered for the candidate, so the verdict always matches the form they saw.
 */
async function activeGateQuestions(
  jobId: string
): Promise<{ questions: GateQuestion[] } | { error: string }> {
  // The id arrives from the public form and is interpolated into an OR filter,
  // so its shape is checked rather than assumed.
  if (!UUID_PATTERN.test(jobId)) {
    return { error: "This role is no longer accepting applications." };
  }

  const { data, error } = await getServiceRestClient()
    .from("application_gate_questions")
    .select("id, job_id, question, help_text, options, position, is_active")
    .eq("is_active", true)
    .or(`job_id.is.null,job_id.eq.${jobId}`)
    .order("position", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[apply] viability questions unreadable:", error.message);
    // Failing open would admit the one applicant the questions exist to filter
    // out, so the submission is refused and the candidate can retry.
    return { error: "We could not load the application questions. Please try again." };
  }

  return { questions: parseGateRows((data ?? []) as unknown as Record<string, unknown>[]) };
}

export async function submitApplication(input: ApplyInput): Promise<ApplyResult> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const cvText = input.cvText.trim().slice(0, 20_000);

  // The field is optional; a value in it has to be the thing the field is named,
  // and it is cleaned the same way the step and the reader check it, so a link the
  // candidate was allowed to leave is never refused here.
  const typedLink = input.linkedinUrl?.trim() ?? "";
  const linkedinUrl = typedLink ? profileLink(typedLink) : null;
  if (typedLink && !linkedinUrl) {
    return { ok: false, error: "Enter your linkedin.com profile link, or leave it empty." };
  }

  if (fullName.length < 2) return { ok: false, error: "Enter your full name." };
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (cvText.length < CV_TEXT_MIN_CHARS && !input.cvFilePath) {
    return {
      ok: false,
      error: "Attach a CV or paste its text so we can review your application.",
    };
  }

  const restClient = getServiceRestClient();

  // Re-checked server-side: a role could have been closed between the page
  // rendering and the form being submitted.
  const { data: job } = await restClient
    .from("job_openings")
    .select("id, title, tenant_id")
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

  // Viability gate: scored here, server-side, from the stored options rather
  // than from anything the browser asserts. A blank answer and an answer that
  // was never on offer are both treated as unanswered, which refuses the
  // submission rather than rejecting someone for a form glitch — the form
  // reloads its questions after a refusal, so a question added mid-fill shows up
  // on the candidate's next attempt.
  const gate = await activeGateQuestions(input.jobId);
  if ("error" in gate) return { ok: false, error: gate.error };

  const verdict = evaluateGate(gate.questions, input.gateAnswers);

  if (verdict.missing.length) {
    return {
      ok: false,
      error:
        verdict.missing.length === 1
          ? `Please answer “${verdict.missing[0]}” before submitting.`
          : `Please answer all ${verdict.missing.length} application questions before submitting.`,
    };
  }

  // One disqualifying answer is enough, and it is enough immediately: the role
  // has a stated requirement this person does not meet.
  const filteredOut = verdict.failed.length > 0;

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
    const files = await getFileStore();
    const { bytes: fileData, error: downloadError } = await files.download({
      bucket: "candidate-cvs",
      path: input.cvFilePath,
    });

    if (!downloadError && fileData) {
      const buffer = Buffer.from(fileData);

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

  const { data: created, error } = await restClient
    .from("applications")
    .insert({
      job_id: input.jobId,
      full_name: fullName,
      email,
      phone: phone || null,
      // An application row has no link column, so the profile link is filed at the
      // head of the application text — the one place the dossier and the applicants
      // drawer already print what the candidate wrote. The form says this in the
      // words under the field, rather than implying a record of its own.
      cv_text: (linkedinUrl
        ? `LinkedIn profile: ${linkedinUrl}\n\n${finalCvText}`
        : finalCvText
      ) || null,
      cv_file_path: input.cvFilePath,
      source,
      // A gated application is stored rather than discarded: a recruiter can
      // reopen it when the candidate calls to say they mis-clicked, and a
      // rejection nobody can point to later is not reviewable. REJECTED sits
      // outside `applications_one_live_per_job`, so re-applying stays possible.
      stage: filteredOut ? "REJECTED" : "NEW",
      ...(filteredOut ? { rejection_reason: gateRejectionReason(verdict.failed) } : {}),
      gate_answers: verdict.answers.length ? verdict.answers : null,
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

  const applicationId = created?.id ? String(created.id) : "";
  const trackingCode = created?.tracking_code ?? "";

  if (applicationId) {
    await recordActivity({
      actorKind: "CANDIDATE",
      actorLabel: fullName,
      companyId: job?.tenant_id ?? null,
      via: "career site",
      area: "candidates",
      action: "applied",
      entity: "application",
      entityId: applicationId,
      summary: `${fullName} applied for ${job?.title ?? "a role"} through the career site${
        filteredOut ? ", and the viability questions rejected the application on arrival" : ""
      }`,
      detail: {
        email,
        source,
        tracking_code: trackingCode,
        stage: filteredOut ? "REJECTED" : "NEW",
        cv_attached: Boolean(input.cvFilePath),
        cv_characters: finalCvText.length,
        gate_questions: verdict.answers.length,
        failed_gate: filteredOut ? verdict.failed.length : 0,
      },
    });
  }

  if (filteredOut) {
    // The row is stored REJECTED with the disqualifying answer named in
    // `rejection_reason`, and that wording is recruiter-only: the letter below
    // is rendered from the stage templates, which have no token for a reason,
    // so nothing in it can point back at a question or an answer.
    //
    // The candidate is still told, politely, on every channel a rejection
    // normally travels. What they receive is word-for-word what a recruiter's
    // own rejection sends, which is the part that matters: the message says they
    // were not accepted, never that an answer decided it.
    if (applicationId) {
      after(() => notifyStageChange(applicationId, "REJECTED").then(() => undefined));
    }
    return { ok: true, outcome: "received", trackingCode };
  }

  // Auto-screening runs after the candidate's response is sent, so submitting
  // an application never waits on a model call. Honour the Settings toggle —
  // recruiters can also screen any application on demand from the profile
  // drawer.
  if (applicationId && hasAiProvider()) {
    const settings = await getAiAutomationSettings();
    if (settings.aiEnabled && settings.autoScreen) {
      after(() => screenApplicationById(applicationId).then(() => undefined));
    }
  }

  return { ok: true, outcome: "received", trackingCode };
}