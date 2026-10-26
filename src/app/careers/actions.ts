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
import { creditReferral, resolveReferralCode } from "@/modules/referrals/application/credit";
import { readReferralCode } from "@/modules/referrals/domain/referral";
import {
  PRIVACY_NOTICE_VERSION,
  planApplicationConsent,
  type ConsentEvent,
} from "@/modules/privacy/domain/privacy";
import {
  consentPurposeFor,
  personField,
  type PersonCollection,
  type PersonFieldGroup,
} from "@/modules/candidates/domain/person-fields";
import {
  applyPersonField,
  defaultConsentChecker,
  recordPersonConsent,
  resolveOrCreatePerson,
  type PersonFieldChange,
} from "@/modules/candidates/application/personWriter";
import {
  normaliseAnswer,
  type NormalisedValue,
} from "@/modules/form-builder/domain/field-types";
import { resolveFormForJob } from "@/modules/form-builder/application/publicForm";
import { encodeSnapshot } from "@/modules/form-builder/domain/snapshot";
import type { ResolvedField, ResolvedLayout } from "@/modules/form-builder/domain/resolveLayout";

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
  | {
      ok: false;
      error: string;
      /** Per-field sentences, keyed by form field key, for the dynamic wizard. */
      fieldErrors?: Record<string, string>;
    };

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
  /** The `?ref=` code on the link, if the applicant arrived through one. */
  referralCode: string;
  /** Viability answers, keyed by question id. Scored against the stored options. */
  gateAnswers: Record<string, string>;
  /**
   * The two consent boxes. Processing is required and is enforced here as well as
   * in the form; the talent pool is optional, and either answer is recorded.
   */
  processingConsent?: boolean;
  talentPoolConsent?: boolean;
  /**
   * The dynamic form's file/photo answers: one ledger id per attachment. The
   * submit checks each is unattached, for this job and for a field this layout
   * names before it attaches anything (spec §10).
   */
  formUploads?: { uploadId: string }[];
  /** Every authored answer, keyed by the form field's key. */
  customAnswers?: Record<string, unknown>;
  /**
   * The candidate's answer per consent group, keyed by `PersonFieldGroup`.
   * Absent means declined — a box that was not ticked is not a consent.
   */
  personConsents?: Record<string, boolean>;
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

/**
 * Keep the applicant's consent where the desk and the notice can read it.
 *
 * Best-effort and after the row exists: 041 is authored but not applied, so a
 * missing column or table costs the record of the decision, never the applicant.
 * The events go to `candidate_consents` — the append-only history — and, as two
 * stamps, onto the application row every list already reads. Returns whether the
 * record was written, which the trail repeats rather than asserting a save that
 * may not have happened.
 */
async function recordConsent(
  restClient: ReturnType<typeof getServiceRestClient>,
  applicationId: string,
  events: readonly ConsentEvent[]
): Promise<boolean> {
  const processing = events.find((event) => event.purpose === "processing") ?? null;
  const pool = events.find((event) => event.purpose === "talent_pool") ?? null;

  const { error: stampError } = await restClient
    .from("applications")
    .update({
      processing_consent_at: processing?.at ?? null,
      talent_pool_consent_at: pool?.granted ? pool.at : null,
      notice_version: PRIVACY_NOTICE_VERSION,
    })
    .eq("id", applicationId);

  if (stampError) {
    if (!isMissingSchemaError(stampError)) {
      console.error("[apply] consent stamps not written:", stampError.message);
    }
    return false;
  }

  const { error: historyError } = await restClient.from("candidate_consents").insert(
    events.map((event) => ({
      application_id: applicationId,
      purpose: event.purpose,
      granted: event.granted,
      notice_version: PRIVACY_NOTICE_VERSION,
      recorded_at: event.at,
    }))
  );

  if (historyError) {
    if (!isMissingSchemaError(historyError)) {
      console.error("[apply] consent history not written:", historyError.message);
    }
    return false;
  }

  return true;
}

/**
 * File one application, by the route the opening's layout decides (spec §5, §9).
 *
 * The layout is read first because the choice between the two write paths is
 * the layout's: a role with no published form files today's application exactly
 * as it always has, while a published layout that is broken or unreadable is a
 * refusal — never a quiet fall-in to a form the candidate was not shown.
 */
export async function submitApplication(input: ApplyInput): Promise<ApplyResult> {
  const resolution = await resolveFormForJob(input.jobId);
  if ("fallback" in resolution) {
    if (resolution.cause === "no-layout") return submitLegacy(input);
    return { ok: false, error: resolution.reason };
  }
  return submitDynamic(input, resolution);
}

async function submitLegacy(input: ApplyInput): Promise<ApplyResult> {
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

  // Consent is a condition of taking the application, not a stored preference:
  // without it there is no basis for processing the file at all. The same planner
  // the form calls decides it here, so the browser's refusal and this one are one
  // sentence. The talent pool is optional, and an answer either way is kept.
  const consent = planApplicationConsent({
    processing: input.processingConsent,
    talentPool: input.talentPoolConsent,
  });
  if (!consent.ok) return { ok: false, error: consent.error };

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
  // REFERRAL is deliberately absent: it is earned by a code that resolves to a
  // member of staff, not asserted by the form. A code that names nobody, or names
  // a candidate, leaves the source exactly as the applicant chose it.
  const allowedSources = new Set(["CAREER_SITE", "JOB_BOARD"]);
  const referralCode = readReferralCode(input.referralCode);
  const claimant = referralCode ? await resolveReferralCode(referralCode) : null;
  const source = claimant
    ? "REFERRAL"
    : allowedSources.has(input.source)
      ? input.source
      : "CAREER_SITE";

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

  const applicationId = created?.id ? String(created.id) : "";
  const trackingCode = created?.tracking_code ?? "";

  await settleApplication({
    restClient,
    applicationId,
    trackingCode,
    job,
    input,
    consentEvents: consent.events,
    referralCode,
    source,
    email,
    fullName,
    finalCvText,
    cvAttached: Boolean(input.cvFilePath),
    gateAnswerCount: verdict.answers.length,
    filteredOut,
    failedGateCount: verdict.failed.length,
  });

  return { ok: true, outcome: "received", trackingCode };
}

/**
 * Everything that follows a stored application, shared by both write paths.
 *
 * None of it can turn a filed application into a refused one: the consent
 * record, the referral credit, the activity row, the rejection letter and the
 * auto-screening call each degrade on their own, exactly as they did before the
 * dynamic path existed.
 */
interface ApplicationSettlement {
  restClient: ReturnType<typeof getServiceRestClient>;
  applicationId: string;
  trackingCode: string;
  job: { title?: string | null; tenant_id?: string | null } | null;
  input: ApplyInput;
  consentEvents: readonly ConsentEvent[];
  /** Null when the ad was opened directly, or the code was malformed. */
  referralCode: string | null;
  source: string;
  email: string;
  fullName: string;
  finalCvText: string;
  cvAttached: boolean;
  gateAnswerCount: number;
  filteredOut: boolean;
  failedGateCount: number;
}

async function settleApplication(settlement: ApplicationSettlement): Promise<void> {
  const {
    restClient,
    applicationId,
    trackingCode,
    job,
    input,
    consentEvents,
    referralCode,
    source,
    email,
    fullName,
    finalCvText,
    cvAttached,
    gateAnswerCount,
    filteredOut,
    failedGateCount,
  } = settlement;

  // The recruiter's job list shows application counts, so refresh it.
  revalidatePath("/careers");
  revalidatePath("/jobs");

  // The decision is enforced above either way; this only records it, so an
  // unapplied 041 changes whether the answer can be proved, never whether the
  // application stands.
  const consentRecorded = applicationId
    ? await recordConsent(restClient, applicationId, consentEvents)
    : false;

  // Best-effort, and after the row exists: the application is already stored, so
  // an unapplied migration, an unknown code or a claim somebody else filed first
  // changes what is recorded here and never whether the application stands.
  const referral =
    applicationId && referralCode
      ? await creditReferral({
          applicationId,
          jobId: input.jobId,
          email,
          fullName,
          code: referralCode,
        })
      : null;

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
        referral_code: referralCode,
        referral: referral?.reason ?? null,
        tracking_code: trackingCode,
        stage: filteredOut ? "REJECTED" : "NEW",
        cv_attached: cvAttached,
        cv_characters: finalCvText.length,
        gate_questions: gateAnswerCount,
        failed_gate: failedGateCount,
        notice_version: PRIVACY_NOTICE_VERSION,
        consent_recorded: consentRecorded,
        talent_pool: input.talentPoolConsent === true,
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
    return;
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
}

/* -------------------------------------------------------------------------- */
/* The dynamic path — 044 applied, and a layout resolved for this opening      */
/* -------------------------------------------------------------------------- */

const FORM_CHANGED =
  "The form changed while this page was open. Reload it and fill it in again.";

interface FormUploadRow {
  id: string;
  application_id: string | null;
  job_id: string;
  field_key: string;
  bucket: string;
  storage_path: string;
  mime: string | null;
}

/** The leaf behind the `<uuid>-` prefix the upload door writes ahead of it. */
function storedLeaf(storagePath: string): string {
  const leaf = storagePath.split("/").pop() ?? "";
  const match =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i.exec(leaf);
  return match ? match[1] : leaf;
}

function missingAnswer(field: ResolvedField["field"]): ApplyResult {
  const error =
    field.type === "checkbox"
      ? `Please tick “${field.label}”.`
      : field.type === "photo"
        ? `Please attach a photo for “${field.label}”.`
        : field.type === "file"
          ? `Please attach a file for “${field.label}”.`
          : `Please answer “${field.label}”.`;
  return { ok: false, error, fieldErrors: { [field.key]: error } };
}

function invalidAnswer(field: ResolvedField["field"], reason: string): ApplyResult {
  const error = `“${field.label}”: ${reason}.`;
  return { ok: false, error, fieldErrors: { [field.key]: error } };
}

/**
 * One label per collection, as spec §4.1 states: a skill's answer becomes
 * `skill` and a certificate's becomes `title`, each keeping the candidate's own
 * words in `as_written` where the table carries that column.
 *
 * `emergency_contacts` has no single-column shape — 043 wants a name *and* a
 * phone, and a multi_select label is only one of the two — so the form leaves
 * that row to a staff hand rather than inventing the other half. The answer is
 * still on the application's snapshot either way.
 */
const COLLECTION_LABEL_COLUMN: Record<PersonCollection, string | null> = {
  education: "institution",
  employment: "employer",
  languages: "language",
  skills: "skill",
  certifications: "title",
  dependants: "name",
  emergency_contacts: null,
};

const COLLECTIONS_WITH_AS_WRITTEN: ReadonlySet<PersonCollection> = new Set<PersonCollection>([
  "education",
  "employment",
  "skills",
  "certifications",
]);

function collectionItem(
  collection: PersonCollection | undefined,
  label: string,
): Record<string, unknown> | null {
  if (!collection) return null;
  const column = COLLECTION_LABEL_COLUMN[collection];
  if (!column) return null;
  const item: Record<string, unknown> = { [column]: label };
  if (COLLECTIONS_WITH_AS_WRITTEN.has(collection)) item.as_written = label;
  return item;
}

/** Read a submitted CV's text; any failure is a blank reading, never a refusal. */
async function extractStoredCv(row: FormUploadRow): Promise<string> {
  try {
    const files = await getFileStore();
    const { bytes, error } = await files.download({
      bucket: row.bucket,
      path: row.storage_path,
    });
    if (error || !bytes) {
      if (error) console.error("[apply] CV download failed:", error);
      return "";
    }

    const buffer = Buffer.from(bytes);
    const ext = row.storage_path.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      row.mime ??
      (ext === "pdf"
        ? "application/pdf"
        : ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === "doc"
            ? "application/msword"
            : ext === "txt"
              ? "text/plain"
              : "application/pdf");

    const extracted = await extractCvText(buffer, mime);
    return extracted.empty ? "" : extracted.text;
  } catch (extractionError) {
    console.error("[apply] CV extraction failed:", extractionError);
    return "";
  }
}

/**
 * The person write, last and unable to break the application (spec §5, §9).
 *
 * Consent is recorded first because the writer's checker reads the newest
 * `person_consents` row and has to find the one this submit just made. Every
 * refusal and every failure below is logged and swallowed: the application is
 * filed, the snapshot keeps the candidate's words, and the profile is merely
 * behind.
 */
async function writePersonFromForm(args: {
  personId: string;
  layout: ResolvedLayout;
  normalised: ReadonlyMap<string, NormalisedValue>;
  uploadsByField: ReadonlyMap<string, FormUploadRow>;
  consented: Record<string, boolean>;
}): Promise<void> {
  try {
    const groups = new Set<PersonFieldGroup>();
    for (const { field } of args.layout.fields) {
      const systemKey = field.systemKey;
      if (systemKey?.startsWith("person:")) {
        groups.add(consentPurposeFor(systemKey.slice("person:".length)));
      }
    }

    const granted = new Set<PersonFieldGroup>();
    for (const group of groups) {
      const agreed = args.consented[group] === true;
      if (agreed) granted.add(group);
      // A refusal is recorded too: the newest row wins, so a changed mind is a
      // later answer rather than an edit of this one.
      const recorded = await recordPersonConsent(
        args.personId,
        group,
        agreed,
        "candidate_form",
      );
      if ("error" in recorded) {
        console.error("[apply] person consent not recorded:", group, recorded.error);
      }
    }

    const changes: PersonFieldChange[] = [];
    for (const { field } of args.layout.fields) {
      const systemKey = field.systemKey;
      if (!systemKey?.startsWith("person:")) continue;
      const registryKey = systemKey.slice("person:".length);
      const registry = personField(registryKey);
      if (!registry || !granted.has(registry.group)) continue;

      if (registry.input === "photo") {
        const upload = args.uploadsByField.get(field.key);
        if (upload) {
          changes.push({
            key: registryKey,
            value: upload.storage_path,
            door: "candidate_form",
            actorId: null,
            actorKind: "candidate",
          });
        }
        continue;
      }

      if (registry.input === "list") {
        const picked = args.normalised.get(field.key);
        if (!Array.isArray(picked) || picked.length === 0) continue;
        const items: Record<string, unknown>[] = [];
        for (const label of picked) {
          const item = collectionItem(registry.collection, label);
          if (item) items.push(item);
        }
        if (items.length > 0) {
          changes.push({
            key: registryKey,
            value: items,
            door: "candidate_form",
            actorId: null,
            actorKind: "candidate",
          });
        }
        continue;
      }

      const value = args.normalised.get(field.key);
      if (value === undefined) continue;
      changes.push({
        key: registryKey,
        value,
        door: "candidate_form",
        actorId: null,
        actorKind: "candidate",
      });
    }

    if (changes.length === 0) return;

    const result = await applyPersonField(
      args.personId,
      changes,
      await defaultConsentChecker(),
    );
    if ("error" in result) {
      console.error("[apply] the person write failed:", result.error);
      return;
    }
    for (const refusal of result.refused) {
      console.error("[apply] person field refused:", refusal.key, refusal.reason);
    }
    for (const conflict of result.conflicts) {
      console.error("[apply] person field held:", conflict.key, conflict.held);
    }
  } catch (error) {
    console.error(
      "[apply] the person write threw:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * File an application against a resolved layout (spec §5's fixed order).
 *
 * The layout is re-read by the caller, every answer is normalised here — never
 * in the browser — and the snapshot is built from those normalised values. A
 * submitted key the layout no longer asks is refused rather than filed, which is
 * the mid-form republish case spec §9 names.
 */
async function submitDynamic(
  input: ApplyInput,
  layout: ResolvedLayout,
): Promise<ApplyResult> {
  const restClient = getServiceRestClient();
  const answers = input.customAnswers ?? {};
  const answerable = layout.fields.filter(
    (entry) => entry.field.type !== "section_heading",
  );
  const byKey = new Map(answerable.map((entry) => [entry.field.key, entry]));

  for (const key of Object.keys(answers)) {
    if (!byKey.has(key)) return { ok: false, error: FORM_CHANGED };
  }

  const boundBySystem = new Map<string, ResolvedField>();
  for (const entry of answerable) {
    const systemKey = entry.field.systemKey;
    if (!systemKey || systemKey.startsWith("person:")) continue;
    boundBySystem.set(systemKey, entry);
  }

  const normalised = new Map<string, NormalisedValue>();
  const fileFields = new Map<string, ResolvedField>();

  for (const entry of answerable) {
    const { field } = entry;
    if (field.type === "file" || field.type === "photo") {
      fileFields.set(field.key, entry);
      continue;
    }

    const raw = answers[field.key];

    if (field.type === "checkbox") {
      if (raw === undefined || raw === null) {
        if (field.required) return missingAnswer(field);
        continue;
      }
      const result = normaliseAnswer(field.type, field.config, raw);
      if (!result.ok) return invalidAnswer(field, result.reason);
      // `required` on a tick box means it has to be ticked, the same rule a
      // field's own `mustBeTrue` states in copy.
      if (field.required && result.value !== "true") return missingAnswer(field);
      normalised.set(field.key, result.value);
      continue;
    }

    const blank =
      raw === undefined ||
      raw === null ||
      raw === "" ||
      (Array.isArray(raw) && raw.length === 0) ||
      (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0);
    if (blank) {
      if (field.required) return missingAnswer(field);
      continue;
    }

    const result = normaliseAnswer(field.type, field.config, raw);
    if (!result.ok) return invalidAnswer(field, result.reason);
    normalised.set(field.key, result.value);
  }

  // Upload ownership (spec §10): every id must name an unattached ledger row for
  // this job, at a file/photo field this layout asks, and no field may carry two.
  const requested = (input.formUploads ?? []).map((upload) => upload.uploadId);
  const uploadIds = [...new Set(requested)];
  if (
    uploadIds.length !== requested.length ||
    uploadIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    return { ok: false, error: FORM_CHANGED };
  }

  const uploadsByField = new Map<string, FormUploadRow>();
  if (uploadIds.length > 0) {
    const { data, error } = await restClient
      .from("application_form_files")
      .select("id, application_id, job_id, field_key, bucket, storage_path, mime")
      .in("id", uploadIds);

    if (error) {
      console.error("[apply] the form upload ledger was unreadable:", error.message);
      return { ok: false, error: "We could not check the attached files. Please try again." };
    }

    const rows = (data ?? []) as unknown as FormUploadRow[];
    if (rows.length !== uploadIds.length) return { ok: false, error: FORM_CHANGED };

    for (const row of rows) {
      if (row.application_id !== null || row.job_id !== input.jobId) {
        return { ok: false, error: FORM_CHANGED };
      }
      const resolved = fileFields.get(row.field_key);
      if (!resolved) return { ok: false, error: FORM_CHANGED };
      if (uploadsByField.has(row.field_key)) {
        const sentence = `Only one file can be attached to “${resolved.field.label}”.`;
        return {
          ok: false,
          error: sentence,
          fieldErrors: { [resolved.field.key]: sentence },
        };
      }
      uploadsByField.set(row.field_key, row);
    }
  }

  for (const [key, resolved] of fileFields) {
    if (!uploadsByField.has(key) && resolved.field.required) {
      return missingAnswer(resolved.field);
    }
  }

  const fieldText = (resolved: ResolvedField | null): string =>
    resolved ? String(normalised.get(resolved.field.key) ?? "").trim() : "";

  const nameField = boundBySystem.get("name") ?? null;
  const emailField = boundBySystem.get("email") ?? null;
  const phoneField = boundBySystem.get("phone") ?? null;
  const aboutField = boundBySystem.get("about") ?? null;
  const cvField = boundBySystem.get("cv") ?? null;
  const linkedinField = boundBySystem.get("linkedin") ?? null;

  const fullName = fieldText(nameField);
  const email = fieldText(emailField).toLowerCase();
  const phone = fieldText(phoneField);
  const about = fieldText(aboutField);

  if (fullName.length < 2) return { ok: false, error: "Enter your full name." };
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const typedLink = fieldText(linkedinField);
  const linkedinUrl = typedLink ? profileLink(typedLink) : null;
  if (typedLink && !linkedinUrl) {
    return { ok: false, error: "Enter your linkedin.com profile link, or leave it empty." };
  }

  const cvUpload = cvField ? uploadsByField.get(cvField.field.key) ?? null : null;
  const extractedCv = cvUpload ? await extractStoredCv(cvUpload) : "";
  const linkedinLine = linkedinUrl ? `LinkedIn profile: ${linkedinUrl}` : "";

  // Spec §4: a form may bind both, and then the CV text carries both. The About
  // answer is not overwritten by the extraction the way the legacy path's
  // `actions.ts:507` line still does — that path is left exactly as it was.
  const cvParts =
    aboutField && cvField
      ? [about, linkedinLine, extractedCv]
      : aboutField
        ? [about, linkedinLine]
        : [linkedinLine, extractedCv];
  const finalCvText = cvParts.filter((part) => part.length > 0).join("\n\n");

  if (!cvUpload && about.length < CV_TEXT_MIN_CHARS) {
    return {
      ok: false,
      error: "Attach a CV or paste its text so we can review your application.",
    };
  }

  const consent = planApplicationConsent({
    processing: input.processingConsent,
    talentPool: input.talentPoolConsent,
  });
  if (!consent.ok) return { ok: false, error: consent.error };

  // Re-read for the insert and the activity row; the layout read proved this a
  // moment ago, and a role can close between that read and this one.
  const { data: job } = await restClient
    .from("job_openings")
    .select("id, title, tenant_id")
    .eq("id", input.jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!job) {
    return { ok: false, error: "This role is no longer accepting applications." };
  }

  const allowedSources = new Set(["CAREER_SITE", "JOB_BOARD"]);
  const referralCode = readReferralCode(input.referralCode);
  const claimant = referralCode ? await resolveReferralCode(referralCode) : null;
  const source = claimant
    ? "REFERRAL"
    : allowedSources.has(input.source)
      ? input.source
      : "CAREER_SITE";

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

  const filteredOut = verdict.failed.length > 0;

  // Resolve-or-create before the insert, so `applications.person_id` names the
  // profile this application belongs to. A missing spine is not a refusal: the
  // application is filed unlinked and the profile lags (spec §9).
  let personId: string | null = null;
  try {
    const person = await resolveOrCreatePerson(email, fullName, phone || null);
    if ("personId" in person) personId = person.personId;
    else console.error("[apply] the person was not resolved:", person.error);
  } catch (error) {
    console.error(
      "[apply] the person store could not be reached:",
      error instanceof Error ? error.message : error,
    );
  }

  const snapshotAnswers: Record<string, unknown> = {};
  for (const [key, value] of normalised) snapshotAnswers[key] = value;
  for (const [key, upload] of uploadsByField) {
    snapshotAnswers[key] = { name: storedLeaf(upload.storage_path) };
  }

  const snapshot = encodeSnapshot(
    layout.fields,
    snapshotAnswers,
    new Date().toISOString(),
  );

  const { data: created, error } = await restClient
    .from("applications")
    .insert({
      job_id: input.jobId,
      full_name: fullName,
      email,
      phone: phone || null,
      cv_text: finalCvText || null,
      cv_file_path: cvUpload?.storage_path ?? null,
      source,
      stage: filteredOut ? "REJECTED" : "NEW",
      ...(filteredOut ? { rejection_reason: gateRejectionReason(verdict.failed) } : {}),
      gate_answers: verdict.answers.length ? verdict.answers : null,
      form_answers: snapshot,
      ...(personId ? { person_id: personId } : {}),
    })
    .select("id, tracking_code")
    .single();

  if (error) {
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

  const applicationId = created?.id ? String(created.id) : "";
  const trackingCode = created?.tracking_code ?? "";

  if (applicationId && uploadsByField.size > 0) {
    const ids = [...uploadsByField.values()].map((upload) => upload.id);
    const { data: attached, error: attachError } = await restClient
      .from("application_form_files")
      .update({ application_id: applicationId })
      .in("id", ids)
      .is("application_id", null)
      .select("id");

    if (attachError) {
      console.error("[apply] the form uploads were not attached:", attachError.message);
    } else if ((attached?.length ?? 0) !== ids.length) {
      // A row was claimed while this form was open. The application stands; the
      // unattached byte is the orphan sweep's.
      console.error(
        "[apply] some form uploads were claimed before attach:",
        `${attached?.length ?? 0} of ${ids.length}`,
      );
    }
  }

  // Last, and after the row exists: a person write may be refused or fail and
  // the application still stands (spec §5, §9).
  if (personId) {
    await writePersonFromForm({
      personId,
      layout,
      normalised,
      uploadsByField,
      consented: input.personConsents ?? {},
    });
  }

  await settleApplication({
    restClient,
    applicationId,
    trackingCode,
    job,
    input,
    consentEvents: consent.events,
    referralCode,
    source,
    email,
    fullName,
    finalCvText,
    cvAttached: cvUpload !== null,
    gateAnswerCount: verdict.answers.length,
    filteredOut,
    failedGateCount: verdict.failed.length,
  });

  return { ok: true, outcome: "received", trackingCode };
}