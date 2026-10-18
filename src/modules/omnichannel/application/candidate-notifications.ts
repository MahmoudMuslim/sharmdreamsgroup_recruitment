import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { assessmentUrl } from "@/lib/public-url";
import { getBoolSetting, getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";
import {
  enqueueAssessmentInvite,
  enqueueInterviewNotice,
  enqueueStageChangeWhatsApp,
  formatInterviewWhen,
  type InterviewNoticeInput,
} from "@/modules/omnichannel/application/whatsapp-dispatch";
import {
  ASSESSMENT_INVITE_TEMPLATE,
  CANDIDATE_FEEDBACK_SUBJECT,
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

/** The sentence both channels put in front of a test link. */
async function startTestLink(accessToken: string): Promise<string> {
  return `Start it here: ${await assessmentUrl(accessToken)}`;
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
  return startTestLink(token);
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
  vars.interview_when = await formatInterviewWhen(input.scheduledAt);
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

/**
 * Posts one letter and writes its history row.
 *
 * Kept separate from `notifyStageChange` because those flows grew their own
 * ordering; new notices should call this so a refused relay reports the same way.
 */
async function deliverEmail(input: {
  applicationId: string;
  candidate: Candidate;
  subject: string;
  body: string;
  emailEnabled: boolean;
}): Promise<{ email: ChannelOutcome; error?: string }> {
  if (!input.emailEnabled) return { email: "off" };
  if (!input.candidate.email) return { email: "skipped" };
  if (!(await EmailConnector.isConfigured())) {
    return {
      email: "off",
      error: "Email is switched on but no SMTP relay is configured (Settings → API keys).",
    };
  }

  const outcome = await EmailConnector.send({
    to: input.candidate.email,
    subject: input.subject,
    text: input.body,
  });
  await record({
    applicationId: input.applicationId,
    channel: "EMAIL",
    recipient: input.candidate.email,
    subject: input.subject,
    body: input.body,
    delivered: outcome.success,
    error: outcome.error,
  });

  return { email: outcome.success ? "sent" : "failed", error: outcome.error };
}

/**
 * Tells a candidate that a test has been issued for them.
 *
 * This is the notice whose link definitely opens: it is minted in the same
 * action that inserts the attempt, whereas the stage alert fired earlier, often
 * while no attempt existed yet and `{{assessment_link}}` rendered as nothing.
 */
export async function notifyAssessmentInvite(input: {
  applicationId: string;
  accessToken: string;
}): Promise<MessagingReport> {
  const [emailEnabled, inAppEnabled] = await Promise.all([
    getBoolSetting("notifications.email_enabled", true),
    getBoolSetting("notifications.in_app_enabled", true),
  ]);

  const whatsapp = (await enqueueAssessmentInvite(input)).queued ? "queued" : "skipped";
  const report: MessagingReport = { whatsapp, email: "skipped", inApp: "skipped" };

  const candidate = await loadCandidate(input.applicationId);
  if (!candidate) return report;

  const copy = await resolveEmailCopy([ASSESSMENT_INVITE_TEMPLATE, STAGE_FALLBACK_TEMPLATE]);
  if (!copy) return { ...report, email: "off", inApp: "off" };

  const vars = await buildVars(candidate, "assessment");
  vars.assessment_link = await startTestLink(input.accessToken);

  const body = renderTemplate(copy.body, vars).trim();
  const subject = renderTemplate(copy.subject, vars).trim();

  const email = await deliverEmail({
    applicationId: input.applicationId,
    candidate,
    subject,
    body,
    emailEnabled,
  });
  report.email = email.email;
  if (email.error) report.error = email.error;

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

export interface FeedbackLetterResult {
  ok: boolean;
  error?: string;
  /** Echoed back so the click reports the address the letter actually went to. */
  recipient?: string;
  characters?: number;
  /** Whether the same text also landed in the candidate's portal inbox. */
  inApp?: "sent" | "off";
}

/**
 * Posts the feedback letter the screening engine already wrote.
 *
 * `generateFeedbackForApplication` stores the letter on the candidate record and
 * its own trail row says it is "waiting on a recruiter to send it". That was the
 * end of the road: nothing sent it, so the promise of personalized feedback for
 * applicants stopped as a draft on a staff screen — the drawer showed a letter
 * nobody could deliver.
 *
 * It goes out exactly as drafted. The drawer renders this same stored text, so
 * what the recruiter reads is what the candidate receives, and rewording stays
 * the Draft feedback action's job rather than a template row that would make the
 * preview a lie.
 *
 * WhatsApp is deliberately not offered: this is a multi-paragraph letter, and the
 * same text clipped to a chat bubble is a different document than the one shown
 * on screen.
 */
export async function sendCandidateFeedbackLetter(
  applicationId: string
): Promise<FeedbackLetterResult> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, full_name, email, stage, ai_feedback, job_openings(title)")
    .eq("id", applicationId)
    .maybeSingle();

  const row = data as
    | {
        id: string;
        full_name: string;
        email: string | null;
        stage: string;
        ai_feedback: string | null;
        job_openings?: { title?: string } | { title?: string }[] | null;
      }
    | null;

  if (!row) return { ok: false, error: "No candidate record matches that id." };

  const letter = row.ai_feedback?.trim() ?? "";
  if (!letter) {
    return {
      ok: false,
      error:
        "There is nothing to send yet — the feedback letter is written from the screening result, so run Draft feedback first.",
    };
  }

  if (!row.email?.trim()) {
    return {
      ok: false,
      error: `${row.full_name} has no email address on the record, so there is nowhere to send the letter.`,
    };
  }

  const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
  const candidate: Candidate = {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    job_title: job?.title ?? "the role",
  };

  const emailEnabled = await getBoolSetting("notifications.email_enabled", true);
  const vars = await buildVars(candidate, humanizeStage(row.stage));
  const subject = renderTemplate(CANDIDATE_FEEDBACK_SUBJECT, vars).trim();

  const sent = await deliverEmail({
    applicationId,
    candidate,
    subject,
    body: letter,
    emailEnabled,
  });

  if (sent.email !== "sent") {
    return {
      ok: false,
      recipient: candidate.email ?? undefined,
      error:
        sent.error ??
        (sent.email === "off"
          ? "Email is switched off in Settings → Access & comms, so the letter stayed on the profile."
          : "The letter was not sent."),
    };
  }

  const inAppEnabled = await getBoolSetting("notifications.in_app_enabled", true);
  if (inAppEnabled) {
    await record({
      applicationId,
      channel: "IN_APP",
      recipient: candidate.email ?? "portal",
      subject,
      body: letter,
      delivered: true,
    });
  }

  return {
    ok: true,
    recipient: candidate.email ?? undefined,
    characters: letter.length,
    inApp: inAppEnabled ? "sent" : "off",
  };
}
