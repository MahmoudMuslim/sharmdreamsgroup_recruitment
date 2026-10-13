"use server";

import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
import { notifyStageChange } from "@/modules/omnichannel/application/candidate-notifications";
import {
  generateFeedbackForApplication,
  screenApplicationById,
} from "@/modules/screening/application/screen-application";
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
 * blocks the rest of the batch.
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
    .in("id", ids);

  if (error) {
    return { ok: false, error: error.message };
  }

  const messages: WhatsAppOutboundMessage[] = [];
  let skipped = 0;

  for (const row of data ?? []) {
    const application = row as {
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

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
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
  }

  if (messages.length === 0) {
    return {
      ok: false,
      error: `None of the selected candidates have a phone number on file (${skipped} skipped).`,
    };
  }

  const outcome = await WhatsAppConnector.sendBulk(messages);

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
    .in("id", ids);

  if (error) return { ok: false, error: error.message };

  const companyName = await getStringSetting("organisation.name", "Sharm Dreams Group");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const messages: EmailOutboundMessage[] = [];
  const applicationFor = new Map<string, string>();
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

    messages.push({
      to,
      subject: renderTemplate(subject, vars).trim(),
      text: renderTemplate(body, vars).trim(),
    });
    applicationFor.set(to.toLowerCase(), application.id);
  }

  if (messages.length === 0) {
    return {
      ok: false,
      error: `None of the selected candidates have an email address on file (${skipped} skipped).`,
    };
  }

  const outcome = await EmailConnector.sendBulk(messages);

  await supabase.from("communication_logs").insert(
    outcome.results.map((result) => ({
      application_id: applicationFor.get(result.to.toLowerCase()) ?? null,
      channel: "EMAIL",
      direction: "OUTBOUND",
      recipient: result.to,
      subject,
      body: messages.find((message) => message.to === result.to)?.text ?? "",
      delivered: result.success,
      error_message: result.error ?? null,
    }))
  );

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