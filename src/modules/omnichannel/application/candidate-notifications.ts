import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getBoolSetting, getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";
import {
  enqueueInterviewNotice,
  enqueueStageChangeWhatsApp,
  formatInterviewWhen,
  type InterviewNoticeInput,
} from "@/modules/omnichannel/application/whatsapp-dispatch";
import {
  EMAIL_INTERVIEW_TEMPLATES,
  EMAIL_STAGE_TEMPLATES,
  EMAIL_SUBJECT_DEFAULTS,
  EMAIL_TEMPLATE_DEFAULTS,
  STAGE_FALLBACK_TEMPLATE,
  TEMPLATE_DEFAULTS,
  humanizeStage,
  renderTemplate,
  type TemplateVars,
} from "@/modules/settings/domain/templates";

/**
 * Candidate messaging on every channel the platform can actually send on.
 *
 * WhatsApp keeps its queue — Meta rate-limits, and a reminder has to land at a
 * time rather than at click time. Email and in-app notices are written as the
 * event happens and recorded in `communication_logs`, the history table the
 * WhatsApp dispatcher already writes to, so the admin outbox stays one list of
 * "what have we told this candidate, and by which route".
 *
 * A candidate is normally told twice on purpose: a filtered inbox still leaves
 * the portal notice, and a portal they never open still leaves the email.
 */

export type ChannelOutcome = "sent" | "queued" | "skipped" | "failed" | "off";

export interface MessagingReport {
  whatsapp: ChannelOutcome;
  email: ChannelOutcome;
  inApp: ChannelOutcome;
  /** Why a channel did not deliver, phrased for the recruiter who clicked. */
  error?: string;
}

interface Candidate {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string;
}

async function loadCandidate(applicationId: string): Promise<Candidate | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, full_name, email, job_openings(title)")
    .eq("id", applicationId)
    .maybeSingle();

  const row = data as
    | {
        id: string;
        full_name: string;
        email: string | null;
        job_openings?: { title?: string } | { title?: string }[] | null;
      }
    | null;

  if (!row) return null;

  const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
  return { id: row.id, full_name: row.full_name, email: row.email, job_title: job?.title ?? "the role" };
}

/** Same link the WhatsApp path builds, so one template reads correctly on both. */
async function assessmentLink(applicationId: string): Promise<string> {
  const { data } = await getSupabaseServiceClient()
    .from("candidate_attempts")
    .select("access_token")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const token = (data as { access_token?: string } | null)?.access_token;
  if (!token) return "";
  return `Start it here: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/test/${token}`;
}

/**
 * First active EMAIL row among `keys`, else the copy shipped in code.
 *
 * `TEMPLATE_DEFAULTS` is the last resort: its chat-style sentence is worse
 * letter copy, but a missing row must never turn into a missing notification.
 */
async function resolveEmailCopy(
  keys: string[]
): Promise<{ key: string; subject: string; body: string } | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("notification_templates")
    .select("key, subject, body")
    .eq("channel", "EMAIL")
    .eq("is_active", true)
    .in("key", keys);

  const rows = (data ?? []) as { key: string; subject: string | null; body: string }[];

  for (const key of keys) {
    const row = rows.find((candidate) => candidate.key === key);
    if (row?.body?.trim()) {
      return {
        key,
        subject: row.subject?.trim() || EMAIL_SUBJECT_DEFAULTS[key] || "An update on your application",
        body: row.body,
      };
    }
  }

  for (const key of keys) {
    const body = EMAIL_TEMPLATE_DEFAULTS[key] ?? TEMPLATE_DEFAULTS[key];
    if (body) {
      return {
        key,
        subject: EMAIL_SUBJECT_DEFAULTS[key] || "An update on your application",
        body,
      };
    }
  }

  return null;
}

async function buildVars(
  candidate: Candidate,
  stage: string
): Promise<TemplateVars> {
  return {
    candidate_name: candidate.full_name,
    job_title: candidate.job_title,
    stage,
    company_name: await getStringSetting("organisation.name", "Sharm Dreams Group"),
    assessment_link: await assessmentLink(candidate.id),
    interview_when: "",
    interview_duration: "",
    interview_link: "",
  };
}

/** One history row per attempt — the outbox reads this table, so it stays terse. */
async function record(input: {
  applicationId: string;
  channel: "EMAIL" | "IN_APP";
  recipient: string;
  subject?: string | null;
  body: string;
  delivered: boolean;
  error?: string | null;
}): Promise<void> {
  await getSupabaseServiceClient().from("communication_logs").insert({
    application_id: input.applicationId,
    channel: input.channel,
    direction: "OUTBOUND",
    recipient: input.recipient,
    subject: input.subject ?? null,
    body: input.body,
    delivered: input.delivered,
    error_message: input.error ?? null,
  });
}

/** The three channels a pipeline move can take, each gated on its own switch. */
export async function notifyStageChange(
  applicationId: string,
  stage: string
): Promise<MessagingReport> {
  const [emailEnabled, inAppEnabled, notifyOnStageChange] = await Promise.all([
    getBoolSetting("notifications.email_enabled", true),
    getBoolSetting("notifications.in_app_enabled", true),
    getBoolSetting("notifications.notify_on_stage_change", true),
  ]);

  const whatsapp = (await enqueueStageChangeWhatsApp(applicationId, stage)).queued
    ? "queued"
    : "skipped";

  const report: MessagingReport = { whatsapp, email: "skipped", inApp: "skipped" };

  const emailKey = EMAIL_STAGE_TEMPLATES[stage];
  const keys = emailKey ? [emailKey, STAGE_FALLBACK_TEMPLATE] : [STAGE_FALLBACK_TEMPLATE];

  const candidate = await loadCandidate(applicationId);
  if (!candidate) return report;

  const copy = await resolveEmailCopy(keys);
  if (!copy) return { ...report, email: "off", inApp: "off" };

  const vars = await buildVars(candidate, humanizeStage(stage));
  const body = renderTemplate(copy.body, vars).trim();
  const subject = renderTemplate(copy.subject, vars).trim();

  if (!notifyOnStageChange) {
    report.email = "off";
  } else if (!emailEnabled) {
    report.email = "off";
  } else if (!candidate.email) {
    report.email = "skipped";
  } else if (!(await EmailConnector.isConfigured())) {
    report.email = "off";
    report.error = "Email is switched on but no SMTP relay is configured (Settings → API keys).";
  } else {
    const outcome = await EmailConnector.send({ to: candidate.email, subject, text: body });
    report.email = outcome.success ? "sent" : "failed";
    if (!outcome.success) report.error = outcome.error;
    await record({
      applicationId,
      channel: "EMAIL",
      recipient: candidate.email,
      subject,
      body,
      delivered: outcome.success,
      error: outcome.error,
    });
  }

  if (inAppEnabled && notifyOnStageChange) {
    await record({ applicationId, channel: "IN_APP", recipient: candidate.email ?? "portal", subject, body, delivered: true });
    report.inApp = "sent";
  }

  return report;
}

/** An interview being booked, moved or cancelled is news on all three channels. */
export async function notifyInterviewUpdate(input: InterviewNoticeInput): Promise<MessagingReport> {
  const [emailEnabled, inAppEnabled] = await Promise.all([
    getBoolSetting("notifications.email_enabled", true),
    getBoolSetting("notifications.in_app_enabled", true),
  ]);

  const whatsapp = (await enqueueInterviewNotice(input)).queued ? "queued" : "skipped";
  const report: MessagingReport = { whatsapp, email: "skipped", inApp: "skipped" };

  const candidate = await loadCandidate(input.applicationId);
  if (!candidate) return report;

  const keys = [EMAIL_INTERVIEW_TEMPLATES[input.kind], STAGE_FALLBACK_TEMPLATE];
  const copy = await resolveEmailCopy(keys);
  if (!copy) return { ...report, email: "off", inApp: "off" };

  const vars = await buildVars(candidate, "interview");
  vars.interview_when = formatInterviewWhen(input.scheduledAt);
  vars.interview_duration = String(input.durationMinutes);
  vars.interview_link =
    input.kind === "CANCELLED"
      ? ""
      : input.meetingLink?.trim()
        ? ` Join here: ${input.meetingLink.trim()}`
        : "";

  const body = renderTemplate(copy.body, vars).trim();
  const subject = renderTemplate(copy.subject, vars).trim();

  if (!emailEnabled) {
    report.email = "off";
  } else if (!candidate.email) {
    report.email = "skipped";
  } else if (!(await EmailConnector.isConfigured())) {
    report.email = "off";
    report.error = "Email is switched on but no SMTP relay is configured (Settings → API keys).";
  } else {
    const outcome = await EmailConnector.send({ to: candidate.email, subject, text: body });
    report.email = outcome.success ? "sent" : "failed";
    if (!outcome.success) report.error = outcome.error;
    await record({
      applicationId: input.applicationId,
      channel: "EMAIL",
      recipient: candidate.email,
      subject,
      body,
      delivered: outcome.success,
      error: outcome.error,
    });
  }

  if (inAppEnabled) {
    await record({
      applicationId: input.applicationId,
      channel: "IN_APP",
      recipient: candidate.email ?? "portal",
      subject,
      body,
      delivered: true,
    });
    report.inApp = "sent";
  }

  return report;
}
