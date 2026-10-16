"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appConfig } from "@/lib/config";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getBoolSetting, getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { WhatsAppConnector } from "@/modules/omnichannel/infrastructure/connectors";
import {
  EmailConnector,
  type EmailOutboundMessage,
} from "@/modules/omnichannel/infrastructure/emailConnector";
import {
  humanizeStage,
  renderTemplate,
  type TemplateVars,
} from "@/modules/settings/domain/templates";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";
import { isApplicationSource } from "@/modules/candidates/domain/listFilters";
import { notifyStageChange } from "@/modules/omnichannel/application/candidate-notifications";
import {
  generateFeedbackForApplication,
  screenApplicationById,
} from "@/modules/screening/application/screen-application";
import { recordActivity } from "@/modules/activity/application/record";
import type { WhatsAppOutboundMessage } from "@/types";

export interface BulkWhatsAppResult {
  ok: boolean;
  error?: string;
  queued?: number;
  skipped?: number;
  failed?: number;
}

/**
 * Sends a templated WhatsApp message to a selected set of applications.
 *
 * Placeholders in double braces are substituted per recipient so each message
 * names the right person and role. Candidates with no phone number are counted
 * as skipped rather than silently dropped, and a failure on one recipient never
 * blocks the rest of the batch. Every attempt is written to `communication_logs`
 * so the campaign appears on the outbox beside the automatic alerts.
 */
export async function sendBulkWhatsApp(input: {
  applicationIds: string[];
  templateKey: string;
  message: string;
}): Promise<BulkWhatsAppResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("messages.send"))) {
    return { ok: false, error: "You need the Send messages permission." };
  }

  const ids = Array.from(new Set(input.applicationIds)).filter(Boolean);
  if (ids.length === 0) {
    return { ok: false, error: "Select at least one candidate." };
  }
  if (ids.length > 200) {
    return { ok: false, error: "Send to at most 200 candidates at a time." };
  }

  const body = input.message?.trim();
  if (!body) {
    return { ok: false, error: "The message cannot be empty." };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("applications")
    .select("id, full_name, phone, stage, job_openings(title), candidate_attempts(access_token)")
    .in("id", ids)
    .is("archived_at", null);

  if (error) {
    return { ok: false, error: error.message };
  }

  const messages: WhatsAppOutboundMessage[] = [];
  const copies = new Map<string, { applicationId: string; body: string }>();
  let skipped = 0;

  for (const row of data ?? []) {
    const application = row as {
      id: string;
      full_name: string;
      phone: string | null;
      stage: string;
      job_openings?: { title?: string } | { title?: string }[] | null;
      candidate_attempts?: { access_token?: string } | { access_token?: string }[] | null;
    };

    if (!application.phone) {
      skipped += 1;
      continue;
    }

    const job = Array.isArray(application.job_openings)
      ? application.job_openings[0]
      : application.job_openings;
    const attempt = Array.isArray(application.candidate_attempts)
      ? application.candidate_attempts[0]
      : application.candidate_attempts;

    const siteUrl = appConfig.url;
    const text = body
      .replace(/\{\{\s*candidate_name\s*\}\}/g, application.full_name)
      .replace(/\{\{\s*job_title\s*\}\}/g, job?.title ?? "the role")
      .replace(/\{\{\s*stage\s*\}\}/g, application.stage.replace(/_/g, " ").toLowerCase())
      .replace(
        /\{\{\s*assessment_link\s*\}\}/g,
        attempt?.access_token ? `${siteUrl}/test/${attempt.access_token}` : "your candidate portal"
      );

    messages.push({
      to: application.phone,
      text,
    });
    copies.set(application.phone, { applicationId: application.id, body: text });
  }

  if (messages.length === 0) {
    return {
      ok: false,
      error: `None of the selected candidates have a phone number on file (${skipped} skipped).`,
    };
  }

  const outcome = await WhatsAppConnector.sendBulk(messages);

  // A campaign that leaves no history row is invisible twice over: the outbox
  // cannot show or retry it, and the candidate's portal inbox never saw it. The
  // notice is written whether or not Meta accepted the message — the inbox copy
  // is what survives a refused send.
  const inAppEnabled = await getBoolSetting("notifications.in_app_enabled", true);

  const { error: logError } = await supabase.from("communication_logs").insert(
    outcome.results.flatMap((result) => {
      const copy = copies.get(result.to);
      const row = {
        application_id: copy?.applicationId ?? null,
        channel: "WHATSAPP",
        direction: "OUTBOUND",
        recipient: result.to,
        subject: null,
        body: copy?.body ?? "",
        delivered: result.success,
        error_message: result.error ?? null,
      };
      if (!inAppEnabled || !copy) return [row];
      return [row, { ...row, channel: "IN_APP", delivered: true, error_message: null }];
    })
  );

  if (logError) {
    console.error("[candidates] WhatsApp campaign could not be written to the send record:", logError.message);
  }

  await recordActivity({
    area: "messaging",
    action: "bulk_whatsapp",
    entity: "message",
    summary: `WhatsApp campaign to ${messages.length} candidate${messages.length === 1 ? "" : "s"} — ${outcome.success} accepted, ${outcome.failed} rejected${skipped ? `, ${skipped} without a number` : ""}${
      inAppEnabled ? `, ${messages.length} copied into the portal inbox` : ", no portal copy because in-app notices are switched off"
    }`,
    detail: {
      template_key: input.templateKey,
      recipients: messages.length,
      accepted: outcome.success,
      rejected: outcome.failed,
      skipped_no_phone: skipped,
      portal_copies: inAppEnabled ? messages.length : 0,
      body: "[withheld]",
    },
  });

  if (outcome.success === 0 && outcome.failed > 0) {
    return {
      ok: false,
      error: "WhatsApp rejected every message. Check the integration credentials.",
      failed: outcome.failed,
      skipped,
    };
  }

  return {
    ok: true,
    queued: outcome.success,
    failed: outcome.failed,
    skipped,
  };
}

export interface BulkEmailResult {
  ok: boolean;
  error?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
}

/**
 * Sends a written email campaign to a selected set of applications.
 *
 * Placeholders go through the same `renderTemplate` the Settings preview uses,
 * so what the recruiter reads in the drawer is what the candidate receives.
 * Every attempt lands in `communication_logs`, failures included — that is what
 * the outbox lists and re-sends from.
 */
export async function sendBulkEmail(input: {
  applicationIds: string[];
  subject: string;
  message: string;
}): Promise<BulkEmailResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("messages.send"))) {
    return { ok: false, error: "You need the Send messages permission." };
  }

  const ids = Array.from(new Set(input.applicationIds)).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Select at least one candidate." };
  if (ids.length > 200) return { ok: false, error: "Send to at most 200 candidates at a time." };

  const body = input.message?.trim();
  const subject = input.subject?.trim();
  if (!body) return { ok: false, error: "The message cannot be empty." };
  if (!subject) return { ok: false, error: "Email needs a subject line." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id, full_name, email, stage, job_openings(title), candidate_attempts(access_token)")
    .in("id", ids)
    .is("archived_at", null);

  if (error) return { ok: false, error: error.message };

  const companyName = await getStringSetting("organisation.name", "Sharm Dreams Group");
  const siteUrl = appConfig.url;
  const messages: EmailOutboundMessage[] = [];
  const copies = new Map<string, { applicationId: string; subject: string; body: string }>();
  let skipped = 0;

  for (const row of data ?? []) {
    const application = row as {
      id: string;
      full_name: string;
      email: string | null;
      stage: string;
      job_openings?: { title?: string } | { title?: string }[] | null;
      candidate_attempts?: { access_token?: string } | { access_token?: string }[] | null;
    };

    const to = application.email?.trim();
    if (!to) {
      skipped += 1;
      continue;
    }

    const job = Array.isArray(application.job_openings)
      ? application.job_openings[0]
      : application.job_openings;
    const attempt = Array.isArray(application.candidate_attempts)
      ? application.candidate_attempts[0]
      : application.candidate_attempts;

    const vars = {
      candidate_name: application.full_name,
      job_title: job?.title ?? "the role",
      stage: humanizeStage(application.stage),
      company_name: companyName,
      assessment_link: attempt?.access_token
        ? `${siteUrl}/test/${attempt.access_token}`
        : "your candidate portal",
      interview_when: "",
      interview_duration: "",
      interview_link: "",
    } satisfies TemplateVars;

    const renderedSubject = renderTemplate(subject, vars).trim();
    const renderedBody = renderTemplate(body, vars).trim();

    messages.push({ to, subject: renderedSubject, text: renderedBody });
    copies.set(to.toLowerCase(), {
      applicationId: application.id,
      subject: renderedSubject,
      body: renderedBody,
    });
  }

  if (messages.length === 0) {
    return {
      ok: false,
      error: `None of the selected candidates have an email address on file (${skipped} skipped).`,
    };
  }

  const outcome = await EmailConnector.sendBulk(messages);

  // The row must carry the copy that was actually sent, not the template the
  // recruiter typed — the outbox re-sends from this body, and the portal notice
  // is the copy the candidate keeps when the relay refuses the email.
  const inAppEnabled = await getBoolSetting("notifications.in_app_enabled", true);

  const { error: logError } = await supabase.from("communication_logs").insert(
    outcome.results.flatMap((result) => {
      const copy = copies.get(result.to.toLowerCase());
      const row = {
        application_id: copy?.applicationId ?? null,
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipient: result.to,
        subject: copy?.subject ?? subject,
        body: copy?.body ?? "",
        delivered: result.success,
        error_message: result.error ?? null,
      };
      if (!inAppEnabled || !copy) return [row];
      return [row, { ...row, channel: "IN_APP", delivered: true, error_message: null }];
    })
  );

  if (logError) {
    console.error("[candidates] Email campaign could not be written to the send record:", logError.message);
  }

  await recordActivity({
    area: "messaging",
    action: "bulk_email",
    entity: "message",
    summary: `Emailed ${messages.length} candidate${messages.length === 1 ? "" : "s"} — “${subject}” — ${outcome.success} delivered, ${outcome.failed} refused${skipped ? `, ${skipped} without an address` : ""}${
      inAppEnabled ? `, ${messages.length} copied into the portal inbox` : ", no portal copy because in-app notices are switched off"
    }`,
    detail: {
      subject,
      recipients: messages.length,
      delivered: outcome.success,
      refused: outcome.failed,
      skipped_no_email: skipped,
      portal_copies: inAppEnabled ? messages.length : 0,
      body: "[withheld]",
    },
  });

  if (outcome.success === 0) {
    return {
      ok: false,
      error: outcome.firstError ?? "The relay rejected every message.",
      failed: outcome.failed,
      skipped,
    };
  }

  return { ok: true, sent: outcome.success, failed: outcome.failed, skipped };
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

const PIPELINE_STAGES = [
  "NEW",
  "AI_SCREENING",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StageResult {
  ok: boolean;
  error?: string;
  stage?: PipelineStage;
  /** True when Settings asked for a feedback draft to be written after this move. */
  auto_feedback?: boolean;
}

/**
 * Moves an application to another pipeline stage.
 *
 * Transitions are intentionally unrestricted — a recruiter must be able to
 * reject from any stage and reopen a rejected candidate — but rejecting
 * requires a stored reason, and hiring stamps `hired_at` so time-to-hire
 * analytics stay honest. Leaving REJECTED clears the stale reason.
 */
export async function updateApplicationStage(input: {
  applicationId: string;
  stage: PipelineStage;
  reason?: string;
}): Promise<StageResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  if (!PIPELINE_STAGES.includes(input.stage)) {
    return { ok: false, error: "Unknown pipeline stage." };
  }

  const reason = input.reason?.trim() ?? "";
  if (input.stage === "REJECTED" && reason.length < 4) {
    return {
      ok: false,
      error: "Add a short rejection reason — it is shown on the candidate's profile.",
    };
  }

  const supabase = await createSupabaseServerClient();

  // Read before writing: the trail records the move as `Applied → Interview`,
  // and the row only holds the destination afterwards.
  const { data: before } = await supabase
    .from("applications")
    .select("stage, full_name")
    .eq("id", input.applicationId)
    .maybeSingle();

  const { error } = await supabase
    .from("applications")
    .update({
      stage: input.stage,
      rejection_reason: input.stage === "REJECTED" ? reason : null,
      hired_at: input.stage === "HIRED" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "candidates",
    action: "stage_move",
    entity: "application",
    entityId: input.applicationId,
    summary: `${before?.full_name ?? "A candidate"} moved from ${humanizeStage(before?.stage ?? "—")} to ${humanizeStage(input.stage)}${reason && input.stage === "REJECTED" ? ` — ${reason}` : ""}`,
    detail: {
      from: before?.stage ?? null,
      to: input.stage,
      ...(input.stage === "REJECTED" ? { reason } : {}),
    },
  });

  // The candidate is told about the move after the response is sent, on every
  // channel Settings → Notifications allows: WhatsApp goes through its queue and
  // is drained immediately, email is handed to the relay, and a portal notice is
  // recorded so the update survives a filtered inbox. A notification failure
  // never affects the stage move itself.
  after(async () => {
    const report = await notifyStageChange(input.applicationId, input.stage);
    if (report.whatsapp === "queued") await processDueWhatsAppJobs(5);
  });

  // Selection decisions get a feedback draft written after the response is
  // sent, so the recruiter is never kept waiting on a model call and a failed
  // generation never fails the stage move. Settings → AI & screening →
  // Personalised feedback switches this automation off; the "Draft feedback"
  // button stays available whatever the toggle says, because pressing it is a
  // deliberate request rather than an automatic follow-up.
  const autoFeedback =
    (input.stage === "REJECTED" || input.stage === "HIRED") &&
    (await getBoolSetting("ai.generate_feedback", true));

  if (autoFeedback) {
    after(() => generateFeedbackForApplication(input.applicationId).then(() => undefined));
  }

  /* The all-group table shows this row's stage and the dashboard counts where the
   * pipeline sits, so a move taken from anywhere has to invalidate both. Before
   * the opening's drawer wrote stages, only the table's own refresh hid the gap. */
  revalidatePath("/candidates");
  revalidatePath("/dashboard");

  return { ok: true, stage: input.stage, auto_feedback: autoFeedback };
}

export interface ScreenResult {
  ok: boolean;
  error?: string;
  score?: number;
  decision?: string;
  /** Present when the score thresholds moved the candidate on their own. */
  auto_stage?: "ASSESSMENT" | "REJECTED" | null;
}

/** Runs the AI screening engine on one application and stores the result. */
export async function screenApplication(applicationId: string): Promise<ScreenResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  return screenApplicationById(applicationId);
}

/** Writes (or refreshes) the personalized feedback draft for a candidate. */
export async function draftCandidateFeedback(applicationId: string): Promise<ScreenResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  return generateFeedbackForApplication(applicationId);
}

/* -------------------------------------------------------------------------- */
/* Manual entry                                                                */
/* -------------------------------------------------------------------------- */

export interface ManualOpeningOption {
  id: string;
  title: string;
  department: string;
  status: string;
}

export interface ManualOpeningsResult {
  ok: boolean;
  error?: string;
  openings: ManualOpeningOption[];
}

/**
 * The openings a walk-in can be filed under.
 *
 * Read when the drawer opens rather than in the page render: recording someone
 * by hand is rare next to the table, and an extra query on every Candidates
 * load would tax it for everyone.
 *
 * The failure is reported rather than folded into an empty list — a recruiter
 * who saw no options would otherwise conclude the group has no openings.
 */
export async function listManualOpenings(): Promise<ManualOpeningsResult> {
  await requireStaff("/candidates");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("job_openings")
    .select("id, title, department, status")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[candidates] manual entry openings failed:", error.message);
    return { ok: false, error: error.message, openings: [] };
  }

  return {
    ok: true,
    openings: (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      department: String(row.department ?? ""),
      status: String(row.status ?? "DRAFT"),
    })),
  };
}

export interface CreatedCandidate {
  id: string;
  full_name: string;
  email: string;
  tracking_code: string;
  job_title: string;
}

export interface CreateCandidateResult {
  ok: boolean;
  error?: string;
  candidate?: CreatedCandidate;
}

/**
 * Records an applicant who never came through the career site.
 *
 * A CV a candidate mailed, a name taken during a phone screen, a row from an
 * old spreadsheet — until now the only doors into `applications` were the
 * public form and converting a sourced prospect, so a walk-in could not be
 * worked as a candidate at all.
 *
 * Nothing is messaged. The recruiter wrote this record; the candidate never
 * applied, so an auto-confirmed "thanks for your application" would be a lie.
 * Screening waits for a CV to be attached on the record.
 */
export async function createCandidate(input: {
  jobId: string;
  fullName: string;
  email: string;
  phone?: string;
  source: string;
}): Promise<CreateCandidateResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() ?? "";
  const source = isApplicationSource(input.source);

  if (fullName.length < 2) return { ok: false, error: "The name needs at least two characters." };
  if (fullName.length > 160) return { ok: false, error: "The name is too long." };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (email.length > 254) return { ok: false, error: "The email address is too long." };
  if (phone.length > 40) return { ok: false, error: "The phone number is too long." };
  if (!source) return { ok: false, error: "Pick where this applicant came from." };

  const supabase = await createSupabaseServerClient();

  // The opening is read through RLS before anything is written, so a recruiter
  // can only file someone under a role their own scope reaches.
  const { data: opening, error: openingError } = await supabase
    .from("job_openings")
    .select("id, title")
    .eq("id", input.jobId)
    .maybeSingle();

  if (openingError?.code === "22P02" || !opening) {
    return { ok: false, error: "Pick the opening this applicant is being recorded against." };
  }

  const { error } = await supabase.from("applications").insert({
    job_id: opening.id,
    full_name: fullName,
    email,
    phone: phone || null,
    source,
  });

  if (error) {
    // The same live-application-per-address rule the contact edit maps: a second
    // record for someone already in this opening's pipeline is refused by the
    // database, not by a check that could race.
    if (error.code === "23505") {
      return {
        ok: false,
        error: `${fullName} already has a live application for ${opening.title} — open that record instead of adding a second.`,
      };
    }
    return { ok: false, error: error.message };
  }

  // Read back what landed: PostgREST reports a write an RLS policy refused as a
  // success with no rows, so an insert that nothing answered is reported as a
  // failure rather than as a candidate the list never shows.
  const { data: created } = await supabase
    .from("applications")
    .select("id, full_name, email, tracking_code")
    .eq("job_id", opening.id)
    .eq("email", email)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!created) {
    return {
      ok: false,
      error: "The record was refused — this opening may sit outside your company's scope.",
    };
  }

  const candidate: CreatedCandidate = {
    id: String(created.id),
    full_name: String(created.full_name),
    email: String(created.email),
    tracking_code: String(created.tracking_code),
    job_title: opening.title,
  };

  await recordActivity({
    area: "candidates",
    action: "candidate_create",
    entity: "application",
    entityId: candidate.id,
    summary: `Recorded ${candidate.full_name} by hand for ${opening.title} (${source.replace(/_/g, " ").toLowerCase()})`,
    detail: {
      job_id: opening.id,
      email: candidate.email,
      phone: phone || null,
      source,
      stage: "NEW",
      tracking_code: candidate.tracking_code,
    },
  });

  // Three consoles read this row: the table, the openings' applicant counts and
  // the pipeline figures on the dashboard.
  revalidatePath("/candidates");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");

  return { ok: true, candidate };
}

/* -------------------------------------------------------------------------- */
/* Contact details                                                             */
/* -------------------------------------------------------------------------- */

/** The same pattern the public apply form enforces, so an edit cannot store
 *  an address the candidate could never have submitted. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface CandidateContact {
  full_name: string;
  email: string;
  phone: string | null;
}

export interface ContactResult {
  ok: boolean;
  error?: string;
  /** What the row now holds, after trimming and lowercasing. */
  contact?: CandidateContact;
}

/**
 * Corrects the name, email or phone a candidate arrived with.
 *
 * A typo in a CV upload or a changed number is the one thing a recruiter must
 * be able to fix before the first call goes out, because every notice, bulk
 * message and portal sign-in reads these columns. Normalising here matches the
 * apply flow: name trimmed, email trimmed and lowercased, blank phone stored as
 * null so "no number on file" stays one value rather than two. Only these three
 * columns are touched — stage, job, tracking code and the AI columns each have
 * an action with the right side effects.
 */
export async function updateCandidateContact(input: {
  applicationId: string;
  fullName: string;
  email: string;
  phone?: string;
}): Promise<ContactResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() ?? "";

  if (fullName.length < 2) return { ok: false, error: "The name needs at least two characters." };
  if (fullName.length > 160) return { ok: false, error: "The name is too long." };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (email.length > 254) return { ok: false, error: "The email address is too long." };
  if (phone.length > 40) return { ok: false, error: "The phone number is too long." };

  const supabase = await createSupabaseServerClient();

  const { data: contactBefore } = await supabase
    .from("applications")
    .select("full_name, email, phone")
    .eq("id", input.applicationId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("applications")
    .update({
      full_name: fullName,
      email,
      phone: phone || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId)
    .select("full_name, email, phone");

  if (error) {
    // `applications_one_live_per_job` keeps one live application per address per
    // opening, so a merge of two duplicate rows surfaces here rather than as a
    // raw constraint name.
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That email already has a live application for this opening.",
      };
    }
    return { ok: false, error: error.message };
  }

  const stored = data?.[0] as CandidateContact | undefined;
  if (!stored) {
    return { ok: false, error: "This candidate record is no longer here." };
  }

  const previous = {
    name: contactBefore?.full_name ?? null,
    email: contactBefore?.email ?? null,
    phone: contactBefore?.phone ?? null,
  };
  const current = { name: stored.full_name, email: stored.email, phone: stored.phone ?? null };

  const edits: Record<string, string> = {};
  for (const field of ["name", "email", "phone"] as const) {
    if ((previous[field] ?? "") !== (current[field] ?? "")) {
      edits[field] = `${previous[field] ?? "—"} → ${current[field] ?? "—"}`;
    }
  }

  await recordActivity({
    area: "candidates",
    action: "contact_edit",
    entity: "application",
    entityId: input.applicationId,
    summary: `Contact details corrected on ${stored.full_name}${
      Object.keys(edits).length ? ` (${Object.keys(edits).join(", ")})` : " — nothing actually changed"
    }`,
    detail: edits,
  });

  revalidatePath("/candidates");
  return { ok: true, contact: stored };
}

/* -------------------------------------------------------------------------- */
/* Archive                                                                     */
/* -------------------------------------------------------------------------- */

export interface ArchiveResult {
  ok: boolean;
  error?: string;
  /** What `archived_at` holds after the write — null means restored. */
  archived_at?: string | null;
}

/**
 * Files a candidate out of the pipeline, or brings them back.
 *
 * This is the only way a candidate record leaves the console, and it is
 * deliberately not a delete. The row keeps its answers, its scores and every
 * notice already sent to that person, so the group can still account for a real
 * applicant — and a recruiter who filed the wrong person restores them with one
 * click. `updated_at` moves with the write so the audit trail shows when.
 *
 * Two things stop an archive, because both would otherwise leave a live door
 * attached to an invisible record: an open assessment link the candidate can
 * still click (submitting it would write into a hidden pipeline), and an
 * interview still on the calendar (it would vanish from the agenda while the
 * candidate is told about it). Both already have their own controls — revoke
 * the link, cancel the interview — so the refusal names them.
 */
export async function setCandidateArchive(input: {
  applicationId: string;
  archived: boolean;
}): Promise<ArchiveResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: application } = await supabase
    .from("applications")
    .select("id, archived_at, full_name")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application) return { ok: false, error: "This candidate no longer exists." };

  if (input.archived && !application.archived_at) {
    const [{ count: openAttempts }, { count: bookedInterviews }] = await Promise.all([
      supabase
        .from("candidate_attempts")
        .select("id", { count: "exact", head: true })
        .eq("application_id", input.applicationId)
        .in("status", ["NOT_STARTED", "IN_PROGRESS"]),
      supabase
        .from("interview_schedules")
        .select("id", { count: "exact", head: true })
        .eq("application_id", input.applicationId)
        .eq("status", "SCHEDULED"),
    ]);

    if (openAttempts) {
      return {
        ok: false,
        error:
          "This candidate holds an open assessment link. Revoke it in the drawer first, so the link cannot write into a hidden record.",
      };
    }
    if (bookedInterviews) {
      return {
        ok: false,
        error:
          "This candidate has an interview on the calendar. Record its outcome or cancel it first.",
      };
    }
  }

  const archivedAt = input.archived ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("applications")
    .update({ archived_at: archivedAt, updated_at: new Date().toISOString() })
    .eq("id", input.applicationId)
    .select("archived_at")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "This candidate record is no longer here." };

  await recordActivity({
    area: "candidates",
    action: input.archived ? "archive" : "restore",
    entity: "application",
    entityId: input.applicationId,
    summary: `${application.full_name ?? "A candidate"} ${
      input.archived
        ? "filed out of the pipeline — hidden from the boards and the dashboard, still on record"
        : "brought back into the pipeline"
    }`,
    detail: { archived_at: archivedAt, previous_archived_at: application.archived_at },
  });

  // The filed row leaves the dashboard KPIs, the job boards and the candidate
  // table in the same breath, so all three re-render.
  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  revalidatePath("/jobs");

  return { ok: true, archived_at: data.archived_at ?? null };
}