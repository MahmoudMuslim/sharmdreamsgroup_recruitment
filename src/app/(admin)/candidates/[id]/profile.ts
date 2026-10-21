/**
 * Everything one candidate is, read in one go.
 *
 * The candidates table is one row per person *per opening*, so a recruiter who
 * clicks a name twice in a list is looking at the same human being twice. This is
 * the read behind the page that stops that: it takes any of a person's row ids,
 * finds every row that belongs to the same address, and returns the whole of them
 * — what they applied for, what the AI made of them, every test link, interview,
 * file, message and change on any of their records.
 *
 * Two rules shape it, and both come from the standing programme that the console
 * must not promise what the code does not do:
 *
 *   - **Nothing is invented.** A score the caller is not allowed to read arrives
 *     as null with `scores_masked` set, a CV that cannot be signed says why, and a
 *     change trail that has not been created yet says that rather than showing an
 *     empty list that reads as "nothing has changed".
 *   - **Every list says what it left out.** Each read is bounded, and the bound
 *     travels with the rows, so a profile of four applications never looks like a
 *     profile of four hundred.
 *
 * Not `"use server"`: this is only ever called from the page itself. The desk
 * keeps the write actions, so the profile can stay a server render with no client
 * data fetch of its own.
 */

import { requireStaff } from "@/lib/auth/session";
import { formatInZone } from "@/lib/timezone";
import { createSupabaseServerClient } from "@/lib/data-api/server";
import type { SoftSkillReport } from "@/types";
import { DEFAULT_LINK_VALIDITY_HOURS } from "@/modules/assessment/application/linkValidity";
import { attachmentRule } from "@/modules/careers/attachment-rules";
import { cvDisplayName, createCvLinks } from "@/modules/careers/cv-links";
import { parseGateAnswers, type GateAnswer } from "@/modules/careers/gate-questions";
import { emailSpellings, summarizePerson } from "@/modules/candidates/domain/personIdentity";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import {
  getNumberSetting,
  getOrganisationTimeZone,
} from "@/modules/settings/infrastructure/settingsReader";
import {
  INTERVIEW_SELECT,
  toInterviewRecord,
  type InterviewRecord,
} from "../interviews-model";

/**
 * How many of a person's own rows are read.
 *
 * An applicant who has tried every opening in the group is rare and a recruiter
 * who meets one still gets the newest `PERSON_LIMIT` plus a count saying how many
 * were left. Higher would mean a page nobody can scroll.
 */
const PERSON_LIMIT = 20;
const ATTEMPT_LIMIT = 40;
const MESSAGE_LIMIT = 60;
const FILE_LIMIT = 40;
const CHANGE_LIMIT = 40;

/** The trail rows are read per application id, so one person's set is bounded. */
const TRAIL_ENTITY = "application";

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

/** One opening this person is in play for, with the AI's opinion of them. */
export interface ProfileApplication {
  id: string;
  tracking_code: string;
  stage: string;
  source: string;
  applied_at: string;
  updated_at: string;
  hired_at: string | null;
  /** Set means filed out of the pipeline; it is still on this profile. */
  archived_at: string | null;
  /** The row the URL named, so the page can say which one it opened on. */
  opened: boolean;
  full_name: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  job_department: string | null;
  job_location: string | null;
  company_name: string | null;
  screening: {
    /** Null when never scored *or* when this caller may not read it. */
    score: number | null;
    scored: boolean;
    summary: string | null;
    strengths: string[];
    gaps: string[];
    soft_skills: SoftSkillReport | null;
    feedback: string | null;
    rejection_reason: string | null;
  };
  /** Empty when the role asked no viability questions. */
  gate_answers: GateAnswer[];
  /** Skills the screening engine matched from the catalogue, by name. */
  skills: string[];
  cv: {
    name: string | null;
    /** Present at all means a file was stored for this application. */
    stored: boolean;
    url: string | null;
    download_url: string | null;
    /** Why there is no link, in recruiter language. */
    error: string | null;
  };
}

/** A test link on any of this person's records. */
export interface ProfileAttempt {
  id: string;
  application_id: string;
  job_title: string | null;
  template_name: string | null;
  status: string;
  score: number | null;
  max_score: number | null;
  time_limit_minutes: number;
  started_at: string | null;
  submitted_at: string | null;
  /** When the link dies, already in the organisation's clock. */
  deadline: string;
  /** Focus-change counters the integrity monitor stored, if any. */
  integrity_flags: number;
  integrity_score: number | null;
}

/** An interview on any of this person's records, tagged with the opening. */
export interface ProfileInterview extends InterviewRecord {
  job_title: string | null;
}

/**
 * One thing this person was told, or told us.
 *
 * `written` is a portal notice: the row is an inbox entry the send leaves behind,
 * so nothing passed through a relay that could accept or refuse it. Delivery is
 * only ever a fact about email and WhatsApp, and the profile says so instead of
 * counting a notice as a message that arrived.
 */
export interface ProfileMessage {
  id: string;
  application_id: string;
  job_title: string | null;
  channel: "WHATSAPP" | "EMAIL" | "IN_APP";
  direction: "INBOUND" | "OUTBOUND";
  recipient: string;
  subject: string | null;
  body: string;
  status: "delivered" | "failed" | "queued" | "written";
  error: string | null;
  occurred_at: string;
  read_at: string | null;
}

/** A file a recruiter attached to one of this person's records. */
export interface ProfileFile {
  id: string;
  application_id: string;
  bucket: string;
  label: string;
  name: string;
  path: string;
  mime_type: string | null;
  bytes: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

/** The onboarding plan a hired candidate was given, if one exists. */
export interface ProfilePlan {
  application_id: string;
  job_title: string | null;
  progress: number;
  tasks_total: number;
  tasks_done: number;
  risk_score: number | null;
  generated_by_ai: boolean;
  created_at: string;
}

/** One change from the trail that names this person. */
export interface ProfileChange {
  id: string;
  created_at: string;
  summary: string;
  area: string;
  actor: string;
  job_title: string | null;
}

/** Who the profile belongs to, counted across every row that is theirs. */
export interface ProfilePerson {
  /** The row whose id this profile's address carries — their oldest live record. */
  canonical_id: string;
  /** The row the URL named, which is not always the canonical one. */
  opened_id: string;
  full_name: string;
  /** Other spellings of the name on file, so a profile admits its own duplicates. */
  other_names: string[];
  email: string;
  phone: string | null;
  other_phones: string[];
  tracking_codes: string[];
  sources: string[];
  openings: string[];
  /** The database's own count of rows carrying this address. */
  applications: number;
  /** How many of them this read actually took, so a clipped page can say so. */
  rows_read: number;
  /** Live / filed-away counts are taken from the rows read, not from all of them. */
  live: number;
  archived: number;
  /** More than one live row: the same person sitting in more than one pipeline. */
  repeated: boolean;
  first_seen: string | null;
  last_seen: string | null;
}

export interface CandidateProfile {
  person: ProfilePerson;
  applications: ProfileApplication[];
  attempts: ProfileAttempt[];
  interviews: ProfileInterview[];
  messages: ProfileMessage[];
  files: ProfileFile[];
  plans: ProfilePlan[];
  changes: { rows: ProfileChange[]; note: string | null };
  /** Which of the bounded reads actually hit their bound. */
  clipped: { applications: boolean; attempts: boolean; messages: boolean; files: boolean };
  scores_masked: boolean;
  can_write: boolean;
  time_zone: string;
}

export type ProfileFailure = "invalid_id" | "not_found";

export type ProfileResult =
  | { ok: true; profile: CandidateProfile; canonicalId: string }
  | { ok: false; reason: ProfileFailure };

/* -------------------------------------------------------------------------- */
/* Coercion                                                                    */
/* -------------------------------------------------------------------------- */

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** PostgREST returns a to-one embed as an object, but an array is possible. */
function one<T>(joined: unknown): T | null {
  const row = Array.isArray(joined) ? joined[0] : joined;
  return (row as T) ?? null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/** The instant a link dies, in the clock the recruiter works to. */
function linkDeadline(
  stamped: string | null,
  issuedAt: string,
  validityHours: number,
  timeZone: string
): string {
  const fallback = new Date(
    new Date(issuedAt).getTime() + Math.max(1, validityHours) * 3_600_000
  ).toISOString();
  return formatInZone(stamped ?? fallback, timeZone, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function messageStatus(row: Record<string, unknown>): ProfileMessage["status"] {
  if (row.status === "PENDING") return "queued";
  if (asText(row.channel, "EMAIL") === "IN_APP") return "written";
  return row.delivered === true || row.status === "SENT" ? "delivered" : "failed";
}

/** Distinct values, in first-seen order, with blanks and a chosen spelling gone. */
function distinct(values: readonly string[], drop?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === drop) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The read                                                                    */
/* -------------------------------------------------------------------------- */

/** A row of `applications` as this reader asks for it. */
interface PersonRow {
  id: string;
  email: string;
  archived_at: string | null;
  created_at: string;
}

/**
 * A row of `applications` as this reader sees it.
 *
 * The four columns identity is built on are typed, because a person match that
 * gets them wrong is a person split in two; the rest arrives as it is stored and
 * is coerced at the point of use, so a column the page has never heard of cannot
 * break the render.
 */
interface ApplicationRow extends PersonRow {
  [key: string]: unknown;
}

/**
 * Reads one person's whole record.
 *
 * `applicationId` may be any row the candidate has: the reader finds the others
 * by the same email address, and the page redirects to the canonical id when a
 * link named a newer row, so the same human being cannot end up with two
 * addresses.
 */
export async function getCandidateProfile(applicationId: string): Promise<ProfileResult> {
  await requireStaff(`/candidates/${applicationId}`);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)) {
    return { ok: false, reason: "invalid_id" };
  }

  const [supabase, masked, timeZone, validityHours, canWrite] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
    getOrganisationTimeZone(),
    getNumberSetting("assessment.link_validity_hours", DEFAULT_LINK_VALIDITY_HOURS),
    hasPermissionForUser("candidates.write"),
  ]);

  // The row the link named. Read through the caller's own session, so Row Level
  // Security decides whether this recruiter may see this person at all.
  const { data: anchor, error: anchorError } = await supabase
    .from("applications")
    .select("id, email")
    .eq("id", applicationId)
    .maybeSingle();

  if (anchorError) {
    console.error("[candidate-profile] anchor read refused:", anchorError.message);
    return { ok: false, reason: "not_found" };
  }
  if (!anchor) return { ok: false, reason: "not_found" };

  const email = asText(anchor.email);
  if (!email) return { ok: false, reason: "not_found" };

  const { data: rowSet, count: rowCount, error: rowsError } = await supabase
    .from("applications")
    .select(
      "*, job_openings(title, department, location, tenants_and_companies(name)), candidate_skills(skill_id, skills(name))",
      { count: "exact" }
    )
    .in("email", emailSpellings(email))
    .order("created_at", { ascending: false })
    .limit(PERSON_LIMIT);

  if (rowsError) {
    console.error("[candidate-profile] person rows refused:", rowsError.message);
    return { ok: false, reason: "not_found" };
  }

  const rows = (rowSet ?? []) as unknown as ApplicationRow[];
  if (rows.length === 0) return { ok: false, reason: "not_found" };

  const summary = summarizePerson(rows, email);
  const ids = summary.rows.map((row) => row.id);
  const titleOf = new Map<string, string | null>();
  for (const row of summary.rows) {
    const job = one<{ title?: unknown }>(row.job_openings);
    titleOf.set(row.id, asNullableText(job?.title));
  }

  const [attempts, interviews, logs, queued, plans, files, changes] = await Promise.all([
    supabase
      .from("candidate_attempts")
      .select(
        "id, application_id, access_token, status, total_score, max_score, time_limit_minutes, started_at, submitted_at, expires_at, created_at, integrity_flags, integrity_score, assessment_templates(name)"
      )
      .in("application_id", ids)
      .order("created_at", { ascending: false })
      .limit(ATTEMPT_LIMIT),
    supabase
      .from("interview_schedules")
      .select(INTERVIEW_SELECT)
      .in("application_id", ids)
      .order("scheduled_at", { ascending: true })
      .limit(ATTEMPT_LIMIT),
    supabase
      .from("communication_logs")
      .select(
        "id, application_id, channel, direction, recipient, subject, body, delivered, error_message, read_at, created_at"
      )
      .in("application_id", ids)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
    supabase
      .from("scheduled_whatsapp_jobs")
      .select("id, application_id, recipient_phone, payload, status, error_log, scheduled_for, sent_at, created_at")
      .in("application_id", ids)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
    supabase
      .from("onboarding_plans")
      .select("application_id, progress, checklist, retention_risk_score, generated_by_ai, created_at")
      .in("application_id", ids)
      .limit(10),
    supabase
      .from("application_attachments")
      .select("id, application_id, bucket, storage_path, file_name, mime_type, bytes, created_at, user_profiles(full_name)")
      .in("application_id", ids)
      .order("created_at", { ascending: false })
      .limit(FILE_LIMIT),
    supabase
      .from("activity_log")
      .select("id, created_at, area, summary, actor_kind, actor_label, actor_name, entity_id")
      .eq("entity", TRAIL_ENTITY)
      .in("entity_id", ids)
      .order("created_at", { ascending: false })
      .limit(CHANGE_LIMIT),
  ]);

  // A CV link is signed per record, so a person with four applications has four
  // files to open. Signing is a round trip, and the file is only worth a link for
  // a row that actually has one.
  const cvLinks = await Promise.all(
    summary.rows.map(async (row) => {
      const path = asNullableText(row.cv_file_path);
      if (!path) return { stored: false, url: null, download_url: null } as const;
      const links = await createCvLinks(path);
      return {
        stored: true,
        url: links.cv_url,
        download_url: links.cv_download_url,
      } as const;
    })
  );

  const applications: ProfileApplication[] = summary.rows.map((row, index) => {
    const job = one<{
      title?: unknown;
      department?: unknown;
      location?: unknown;
      tenants_and_companies?: unknown;
    }>(row.job_openings);
    const company = one<{ name?: unknown }>(job?.tenants_and_companies);
    const links = cvLinks[index];
    const score = masked ? null : asNumber(row.ai_match_score);
    const cvError = links.stored && !links.url
      ? "The attached CV could not be opened — the candidate may have uploaded it before CV storage was enabled."
      : null;

    return {
      id: row.id,
      tracking_code: asText(row.tracking_code),
      stage: asText(row.stage, "NEW"),
      source: asText(row.source, "CAREER_SITE"),
      applied_at: asText(row.created_at),
      updated_at: asText(row.updated_at),
      hired_at: asNullableText(row.hired_at),
      archived_at: row.archived_at ? asText(row.archived_at) : null,
      opened: row.id === applicationId,
      full_name: asText(row.full_name),
      email: asText(row.email),
      phone: asNullableText(row.phone),
      job_title: asNullableText(job?.title),
      job_department: asNullableText(job?.department),
      job_location: asNullableText(job?.location),
      company_name: asNullableText(company?.name),
      screening: {
        score,
        // A score exists even when this caller may not read its value — the
        // difference is what the page prints instead of a bare "—".
        scored: asNumber(row.ai_match_score) !== null,
        summary: asNullableText(row.ai_screening_summary),
        strengths: stringList(row.ai_strengths),
        gaps: stringList(row.ai_gaps),
        soft_skills: (row.ai_soft_skills as SoftSkillReport | null) ?? null,
        feedback: asNullableText(row.ai_feedback),
        rejection_reason: asNullableText(row.rejection_reason),
      },
      gate_answers: parseGateAnswers(row.gate_answers),
      skills: (
        (row.candidate_skills ?? []) as
          | { skill_id?: string; skills?: { name?: unknown } | { name?: unknown }[] }[]
          | null
      )
        ?.map((entry) => asNullableText(one<{ name?: unknown }>(entry.skills)?.name))
        .filter((name): name is string => name !== null) ?? [],
      cv: {
        name: cvDisplayName(asNullableText(row.cv_file_path)),
        stored: links.stored,
        url: links.url,
        download_url: links.download_url,
        error: cvError,
      },
    };
  });

  const attemptRows = (attempts.data ?? []) as unknown as Record<string, unknown>[];
  const interviewRows = (interviews.data ?? []) as unknown as Record<string, unknown>[];
  const logRows = (logs.data ?? []) as unknown as Record<string, unknown>[];
  const pendingRows = (queued.data ?? []) as unknown as Record<string, unknown>[];
  const planRows = (plans.data ?? []) as unknown as Record<string, unknown>[];
  const fileRows = (files.data ?? []) as unknown as Record<string, unknown>[];

  const messages: ProfileMessage[] = [
    ...logRows.map((row) => ({
      id: asText(row.id),
      application_id: asText(row.application_id),
      job_title: titleOf.get(asText(row.application_id)) ?? null,
      channel: asText(row.channel, "EMAIL") as ProfileMessage["channel"],
      direction: asText(row.direction, "OUTBOUND") as ProfileMessage["direction"],
      recipient: asText(row.recipient),
      subject: asNullableText(row.subject),
      body: asText(row.body),
      status: messageStatus(row),
      error: asNullableText(row.error_message),
      occurred_at: asText(row.created_at),
      read_at: asNullableText(row.read_at),
    })),
    // The queue row holds the rendered message, so the recruiter reads exactly
    // what the candidate will receive when a scheduler drains it.
    ...pendingRows.map((row) => ({
      id: asText(row.id),
      application_id: asText(row.application_id),
      job_title: titleOf.get(asText(row.application_id)) ?? null,
      channel: "WHATSAPP" as const,
      direction: "OUTBOUND" as const,
      recipient: asText(row.recipient_phone),
      subject: null,
      body: asText(one<{ text?: unknown }>(row.payload)?.text),
      status: messageStatus(row),
      error: asNullableText(row.error_log),
      occurred_at: asText(row.sent_at ?? row.scheduled_for ?? row.created_at),
      read_at: null,
    })),
  ].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  const opened = applications.find((app) => app.opened) ?? applications[0];
  const dates = applications.map((app) => app.applied_at).filter(Boolean).sort();

  return {
    ok: true,
    canonicalId: summary.canonicalId ?? opened.id,
    profile: {
      person: {
        canonical_id: summary.canonicalId ?? opened.id,
        opened_id: opened.id,
        full_name: opened.full_name,
        other_names: distinct(
          applications.map((app) => app.full_name),
          opened.full_name
        ),
        email: opened.email,
        phone: opened.phone,
        other_phones: distinct(
          applications.map((app) => app.phone ?? ""),
          opened.phone ?? ""
        ),
        tracking_codes: applications.map((app) => app.tracking_code).filter(Boolean),
        sources: distinct(applications.map((app) => app.source)),
        openings: distinct(
          applications.map((app) => app.job_title ?? "")
        ),
        applications: rowCount ?? summary.applications,
        rows_read: summary.applications,
        live: summary.live.length,
        archived: summary.archived,
        repeated: summary.repeated,
        first_seen: dates[0] ?? null,
        last_seen: dates[dates.length - 1] ?? null,
      },
      applications,
      attempts: attemptRows.map((row) => ({
        id: asText(row.id),
        application_id: asText(row.application_id),
        job_title: titleOf.get(asText(row.application_id)) ?? null,
        template_name: asNullableText(one<{ name?: unknown }>(row.assessment_templates)?.name),
        status: asText(row.status, "NOT_STARTED"),
        score: masked ? null : asNumber(row.total_score),
        max_score: asNumber(row.max_score),
        time_limit_minutes: asNumber(row.time_limit_minutes) ?? 0,
        started_at: asNullableText(row.started_at),
        submitted_at: asNullableText(row.submitted_at),
        deadline: linkDeadline(
          asNullableText(row.expires_at),
          asText(row.created_at),
          validityHours,
          timeZone
        ),
        integrity_flags: asNumber(row.integrity_flags) ?? 0,
        integrity_score: masked ? null : asNumber(row.integrity_score),
      })),
      interviews: interviewRows.map((row) => ({
        ...toInterviewRecord(row),
        job_title: titleOf.get(String(row.application_id)) ?? null,
      })),
      messages,
      files: fileRows.map((row) => ({
        id: asText(row.id),
        application_id: asText(row.application_id),
        bucket: asText(row.bucket),
        label: attachmentRule(asText(row.bucket))?.label ?? "Attached file",
        name: asText(row.file_name),
        path: asText(row.storage_path),
        mime_type: asNullableText(row.mime_type),
        bytes: asNumber(row.bytes),
        uploaded_at: asText(row.created_at),
        uploaded_by: asNullableText(one<{ full_name?: unknown }>(row.user_profiles)?.full_name),
      })),
      plans: planRows.map((row) => {
        const checklist = Array.isArray(row.checklist) ? row.checklist : [];
        return {
          application_id: asText(row.application_id),
          job_title: titleOf.get(asText(row.application_id)) ?? null,
          progress: asNumber(row.progress) ?? 0,
          tasks_total: checklist.length,
          tasks_done: checklist.filter(
            (item: Record<string, unknown>) => item && item.completed === true
          ).length,
          risk_score: masked ? null : asNumber(row.retention_risk_score),
          generated_by_ai: row.generated_by_ai === true,
          created_at: asText(row.created_at),
        };
      }),
      changes: trailChanges(changes, titleOf),
      clipped: {
        applications: (rowCount ?? 0) > summary.applications,
        attempts: attemptRows.length >= ATTEMPT_LIMIT,
        // Two reads feed this list, so the bound that matters is each one's own —
        // a merged total would claim clipping on any person with 60+ rows.
        messages: logRows.length >= MESSAGE_LIMIT || pendingRows.length >= MESSAGE_LIMIT,
        files: fileRows.length >= FILE_LIMIT,
      },
      scores_masked: masked,
      can_write: canWrite,
      time_zone: timeZone,
    },
  };
}

/**
 * The trail over every row this person holds, or the reason there is none.
 *
 * `activity_log` is migration 024, which is not applied on every environment.
 * An empty list and an unreadable table look identical, and only one of them
 * means nothing has changed about this candidate — so the reason travels with the
 * rows and the page prints it.
 */
function trailChanges(
  result: { data: unknown[] | null; error: { message: string } | null },
  titleOf: Map<string, string | null>
): { rows: ProfileChange[]; note: string | null } {
  if (result.error) {
    const message = result.error.message;
    console.error("[candidate-profile] trail read refused:", message);
    const missing = /activity_log|does not exist|PGRST205/i.test(message);
    return {
      rows: [],
      note: missing
        ? "The change trail has not been created yet. Apply db/migrations/024_activity_log.sql, then reload this page."
        : `The change trail could not be read: ${message}`,
    };
  }

  const rows = (result.data ?? []) as unknown as Record<string, unknown>[];
  return {
    rows: rows.map((row) => ({
      id: asText(row.id),
      created_at: asText(row.created_at),
      summary: asText(row.summary),
      area: asText(row.area),
      actor:
        asText(row.actor_name) ||
        asText(row.actor_label) ||
        asText(row.actor_kind, "SYSTEM"),
      job_title: titleOf.get(asText(row.entity_id)) ?? null,
    })),
    note: null,
  };
}
