"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import {
  getNumberSetting,
  getOrganisationTimeZone,
} from "@/modules/settings/infrastructure/settingsReader";
import { DEFAULT_LINK_VALIDITY_HOURS } from "@/modules/assessment/application/linkValidity";
import { formatInZone } from "@/lib/timezone";
import { cvDisplayName, createCvLinks } from "@/modules/careers/cv-links";
import { attachmentRule } from "@/modules/careers/attachment-rules";
import {
  parseGateAnswers,
  type GateAnswer,
} from "@/modules/careers/gate-questions";

/**
 * The whole candidate record: what they submitted, what the gate asked, and
 * everything the pipeline has produced since.
 *
 * The candidates table deliberately carries only what a recruiter scans (score,
 * stage, attempt status). This is the heavy half — the CV text, the message
 * history, the attempts — fetched once when a profile drawer opens and kept for
 * as long as it stays open, because a CV is several thousand characters and
 * nobody needs fifty of them to render a table.
 */

/** The application exactly as the candidate left it. */
export interface DossierApplication {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  tracking_code: string;
  source: string;
  applied_at: string;
  job_title: string | null;
  job_department: string | null;
  job_location: string | null;
  cv_name: string | null;
  cv_text: string | null;
  /** Short-lived link that opens the original file in the browser. */
  cv_url: string | null;
  /** Same file with a `Content-Disposition`, so the browser saves it. */
  cv_download_url: string | null;
  /** Why no link could be minted, in recruiter language. */
  cv_error: string | null;
}

export interface DossierAttempt {
  id: string;
  access_token: string;
  template_name: string | null;
  status: string;
  score: number | null;
  max_score: number | null;
  time_limit_minutes: number;
  started_at: string | null;
  submitted_at: string | null;
  expires_at: string | null;
  created_at: string;
  /**
   * When this link stops working, already in the organisation's clock: the
   * recruiter's extension if there is one, otherwise issue time plus Settings →
   * Assessments → Link validity.
   */
  deadline: string;
}

/**
 * One thing the candidate was told, or told us.
 *
 * Merged from `communication_logs` (email, portal notices, WhatsApp once it
 * leaves the queue) and `scheduled_whatsapp_jobs` (WhatsApp still waiting), so a
 * queued notice is not shown as if it had been delivered.
 *
 * `status` is `written` for a portal notice: the row is an inbox entry the send
 * also leaves behind, so nothing went through a relay that could accept or
 * refuse it. Delivery is only a fact about email and WhatsApp.
 */
export interface DossierAlert {
  id: string;
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

export interface DossierOnboarding {
  progress: number;
  tasks_total: number;
  tasks_done: number;
  risk_score: number | null;
  generated_by_ai: boolean;
  created_at: string;
}

/** Another opening the same person applied to. */
export interface DossierSibling {
  id: string;
  tracking_code: string;
  job_title: string | null;
  stage: string;
  applied_at: string;
}

/**
 * One file a recruiter attached to this record after the application landed.
 *
 * Opening and downloading go through /api/files/link like the File Manager does,
 * so the storage key never becomes a URL the browser can hand to someone else.
 */
export interface DossierAttachment {
  id: string;
  bucket: string;
  /** Which kind of file this is, in the words the upload control used. */
  label: string;
  name: string;
  path: string;
  mime_type: string | null;
  bytes: number | null;
  uploaded_at: string;
  /** The staff member who uploaded it, or null once their profile is gone. */
  uploaded_by: string | null;
}

export interface CandidateDossier {
  application: DossierApplication;
  /** Empty when the role asked no viability questions. */
  gate_answers: GateAnswer[];
  attempts: DossierAttempt[];
  alerts: DossierAlert[];
  onboarding: DossierOnboarding | null;
  other_applications: DossierSibling[];
  /** Files staff attached to this record, newest first. */
  attachments: DossierAttachment[];
  /** True when `security.mask_scores_for_reviewers` hid the scores in here. */
  scores_masked: boolean;
  /** Whether this recruiter may revoke, extend or re-issue an attempt link. */
  can_manage_links: boolean;
  /** Whether this recruiter may attach or remove a file on this record. */
  can_write: boolean;
}

export type DossierResult =
  | { ok: true; dossier: CandidateDossier }
  | { ok: false; error: string };

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** The instant the link dies, printed in the organisation's own timezone. */
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

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** PostgREST returns one-to-one embeds as an object, but arrays are possible. */
function one<T>(joined: unknown): T | null {
  const row = Array.isArray(joined) ? joined[0] : joined;
  return (row as T) ?? null;
}

function alertStatus(row: Record<string, unknown>): DossierAlert["status"] {
  if (row.status === "PENDING") return "queued";
  if (asString(row.channel) === "IN_APP") return "written";
  return row.delivered === true || row.status === "SENT" ? "delivered" : "failed";
}

export async function getCandidateDossier(
  applicationId: string
): Promise<DossierResult> {
  await requireStaff("/candidates");
  const [supabase, masked, zone, validityHours, canManageLinks, canWrite] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
    getOrganisationTimeZone(),
    getNumberSetting("assessment.link_validity_hours", DEFAULT_LINK_VALIDITY_HOURS),
    hasPermissionForUser("assessments.assign"),
    hasPermissionForUser("candidates.write"),
  ]);

  const { data: row, error } = await supabase
    .from("applications")
    .select(
      "id, full_name, email, phone, tracking_code, source, created_at, cv_file_path, cv_text, gate_answers, job_openings(title, department, location)"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (error) {
    console.error("[candidates] dossier query failed:", error.message);
    return { ok: false, error: "This candidate record could not be loaded. Please retry." };
  }
  if (!row) return { ok: false, error: "This candidate record no longer exists." };

  const path = asNullableString(row.cv_file_path);
  const job = one<{ title?: unknown; department?: unknown; location?: unknown }>(
    row.job_openings
  );

  // The links are short-lived and only this recruiter asked for them, so a CV
  // that cannot be signed degrades to a note rather than an empty drawer.
  const links = path
    ? await createCvLinks(supabase, path)
    : { cv_url: null, cv_download_url: null };

  const [attempts, logs, queued, planResponse, siblings, attached] = await Promise.all([
    supabase
      .from("candidate_attempts")
      .select(
        "id, access_token, status, total_score, max_score, time_limit_minutes, started_at, submitted_at, expires_at, created_at, assessment_templates(name)"
      )
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("communication_logs")
      .select(
        "id, channel, direction, recipient, subject, body, delivered, error_message, read_at, created_at"
      )
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("scheduled_whatsapp_jobs")
      .select("id, recipient_phone, payload, status, error_log, scheduled_for, sent_at, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("onboarding_plans")
      .select("progress, checklist, retention_risk_score, generated_by_ai, created_at")
      .eq("application_id", applicationId)
      .maybeSingle(),
    supabase
      .from("applications")
      .select("id, tracking_code, stage, created_at, job_openings(title)")
      .eq("email", row.email)
      .neq("id", applicationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("application_attachments")
      .select("id, bucket, storage_path, file_name, mime_type, bytes, created_at, user_profiles(full_name)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const alerts: DossierAlert[] = [
    ...(logs.data ?? []).map((log: Record<string, unknown>) => ({
      id: String(log.id),
      channel: asString(log.channel, "EMAIL") as DossierAlert["channel"],
      direction: asString(log.direction, "OUTBOUND") as DossierAlert["direction"],
      recipient: asString(log.recipient),
      subject: asNullableString(log.subject),
      body: asString(log.body),
      status: alertStatus(log),
      error: asNullableString(log.error_message),
      occurred_at: asString(log.created_at),
      read_at: asNullableString(log.read_at),
    })),
    // The queue row holds the rendered message, so the recruiter reads exactly
    // what the candidate will receive when a scheduler drains it.
    ...(queued.data ?? []).map((pending: Record<string, unknown>) => ({
      id: String(pending.id),
      channel: "WHATSAPP" as const,
      direction: "OUTBOUND" as const,
      recipient: asString(pending.recipient_phone),
      subject: null,
      body: asString(one<{ text?: unknown }>(pending.payload)?.text),
      status: alertStatus(pending),
      error: asNullableString(pending.error_log),
      occurred_at: asString(pending.sent_at ?? pending.scheduled_for ?? pending.created_at),
      read_at: null,
    })),
  ].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));

  const plan = planResponse.data;
  const checklist = Array.isArray(plan?.checklist) ? plan.checklist : [];

  return {
    ok: true,
    dossier: {
      application: {
        id: String(row.id),
        full_name: asString(row.full_name),
        email: asString(row.email),
        phone: asNullableString(row.phone),
        tracking_code: asString(row.tracking_code),
        source: asString(row.source, "CAREER_SITE"),
        applied_at: asString(row.created_at),
        job_title: asNullableString(job?.title),
        job_department: asNullableString(job?.department),
        job_location: asNullableString(job?.location),
        cv_name: cvDisplayName(path),
        cv_text: asNullableString(row.cv_text),
        cv_url: links.cv_url,
        cv_download_url: links.cv_download_url,
        cv_error:
          path && !links.cv_url
            ? "The attached CV could not be opened — the candidate may have uploaded it before CV storage was enabled."
            : null,
      },
      gate_answers: parseGateAnswers(row.gate_answers),
      attempts: (attempts.data ?? []).map((attempt: Record<string, unknown>) => ({
        id: String(attempt.id),
        access_token: asString(attempt.access_token),
        template_name: asNullableString(one<{ name?: unknown }>(attempt.assessment_templates)?.name),
        status: asString(attempt.status, "NOT_STARTED"),
        score: masked ? null : asNumber(attempt.total_score),
        max_score: asNumber(attempt.max_score),
        time_limit_minutes: asNumber(attempt.time_limit_minutes) ?? 0,
        started_at: asNullableString(attempt.started_at),
        submitted_at: asNullableString(attempt.submitted_at),
        expires_at: asNullableString(attempt.expires_at),
        created_at: asString(attempt.created_at),
        deadline: linkDeadline(
          asNullableString(attempt.expires_at),
          asString(attempt.created_at),
          validityHours,
          zone
        ),
      })),
      alerts,
      onboarding: plan
        ? {
            progress: asNumber(plan.progress) ?? 0,
            tasks_total: checklist.length,
            tasks_done: checklist.filter(
              (item: Record<string, unknown>) => item && item.completed === true
            ).length,
            risk_score: masked ? null : asNumber(plan.retention_risk_score),
            generated_by_ai: plan.generated_by_ai === true,
            created_at: asString(plan.created_at),
          }
        : null,
      other_applications: (siblings.data ?? []).map((sibling: Record<string, unknown>) => ({
        id: String(sibling.id),
        tracking_code: asString(sibling.tracking_code),
        job_title: asNullableString(one<{ title?: unknown }>(sibling.job_openings)?.title),
        stage: asString(sibling.stage, "NEW"),
        applied_at: asString(sibling.created_at),
      })),
      attachments: (attached.data ?? []).map((file: Record<string, unknown>) => ({
        id: String(file.id),
        bucket: asString(file.bucket),
        label: attachmentRule(asString(file.bucket))?.label ?? "Attached file",
        name: asString(file.file_name),
        path: asString(file.storage_path),
        mime_type: asNullableString(file.mime_type),
        bytes: asNumber(file.bytes),
        uploaded_at: asString(file.created_at),
        uploaded_by: asNullableString(one<{ full_name?: unknown }>(file.user_profiles)?.full_name),
      })),
      scores_masked: masked,
      can_manage_links: canManageLinks,
      can_write: canWrite,
    },
  };
}
