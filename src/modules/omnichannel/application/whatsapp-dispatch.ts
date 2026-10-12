import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { WhatsAppConnector } from "@/modules/omnichannel/infrastructure/connectors";

/**
 * Timed WhatsApp dispatch for pipeline stage changes.
 *
 * The recruiter action only enqueues; sending happens through
 * `processDueWhatsAppJobs`, the same path the /api/cron/whatsapp route uses.
 * That keeps one code path responsible for talking to Meta and for writing
 * `communication_logs`, so the cron retry and the best-effort immediate pass
 * can never drift apart.
 *
 * Runs on the service-role client because the cron route has no user session;
 * callers are server-side trust boundaries (staff actions, the secret-guarded
 * cron endpoint).
 */

/** Attempts before a job is parked as FAILED instead of retried forever. */
const MAX_ATTEMPTS = 3;

export interface StageChangeNotificationOutcome {
  queued: boolean;
}

interface NotificationSettings {
  whatsappEnabled: boolean;
  notifyOnStageChange: boolean;
}

/**
 * Reads the two toggles from Settings → Notifications. Defaults mirror the
 * seeded values: WhatsApp off until credentials are set up, stage alerts on.
 */
async function getNotificationSettings(): Promise<NotificationSettings> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("scope", "GLOBAL")
    .in("key", ["notifications.whatsapp_enabled", "notifications.notify_on_stage_change"]);

  const map = new Map((data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
  const asBool = (value: unknown, fallback: boolean): boolean =>
    value === true || value === "true" ? true : value === false || value === "false" ? false : fallback;

  return {
    whatsappEnabled: asBool(map.get("notifications.whatsapp_enabled"), false),
    notifyOnStageChange: asBool(map.get("notifications.notify_on_stage_change"), true),
  };
}

/**
 * Candidate-facing copy per stage. Placeholders match the bulk-send templates
 * in the candidates toolbar so recruiters see one consistent message style.
 * Rejections deliberately carry no internal detail — the stored reason is
 * recruiter-facing only.
 */
const STAGE_MESSAGES: Record<string, string> = {
  NEW: "Hi {{candidate_name}}, your application for {{job_title}} is active in our pipeline again. We will keep you updated here.",
  AI_SCREENING:
    "Hi {{candidate_name}}, your application for {{job_title}} is now being reviewed by our screening team.",
  ASSESSMENT:
    "Hi {{candidate_name}}, good news — you have moved to the assessment stage for {{job_title}}. {{assessment_link}}",
  INTERVIEW:
    "Hi {{candidate_name}}, you have reached the interview stage for {{job_title}}. We will be in touch shortly to arrange a time.",
  OFFER:
    "Hi {{candidate_name}}, we are excited to move forward with an offer for {{job_title}}. The details are on their way.",
  HIRED:
    "Welcome aboard, {{candidate_name}}! The {{job_title}} team is looking forward to having you.",
  REJECTED:
    "Hi {{candidate_name}}, thank you for your interest in {{job_title}}. After careful review we will not be progressing your application this time. We appreciate the time you invested and wish you every success.",
};

interface ApplicationForAlert {
  id: string;
  full_name: string;
  phone: string | null;
  job_openings?: { title?: string } | { title?: string }[] | null;
  candidate_attempts?: { access_token?: string } | { access_token?: string }[] | null;
}

/**
 * Queues a stage-change alert for the candidate. Returns false — no row — when
 * the toggle is off, the candidate has no phone number, or the stage has no
 * copy. Never throws for a missing phone: the stage move already succeeded and
 * a notification hiccup must not surface to the recruiter.
 */
export async function enqueueStageChangeWhatsApp(
  applicationId: string,
  stage: string
): Promise<StageChangeNotificationOutcome> {
  const template = STAGE_MESSAGES[stage];
  if (!template) return { queued: false };

  const settings = await getNotificationSettings();
  if (!settings.whatsappEnabled || !settings.notifyOnStageChange) {
    return { queued: false };
  }

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, full_name, phone, job_openings(title), candidate_attempts(access_token)")
    .eq("id", applicationId)
    .maybeSingle();

  const application = data as ApplicationForAlert | null;
  if (!application?.phone) return { queued: false };

  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;
  const attempt = Array.isArray(application.candidate_attempts)
    ? application.candidate_attempts[0]
    : application.candidate_attempts;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const body = template
    .replace(/\{\{\s*candidate_name\s*\}\}/g, application.full_name)
    .replace(/\{\{\s*job_title\s*\}\}/g, job?.title ?? "the role")
    .replace(
      /\{\{\s*assessment_link\s*\}\}/g,
      attempt?.access_token ? `Start it here: ${siteUrl}/test/${attempt.access_token}` : ""
    )
    .trim();

  const { error } = await supabase.from("scheduled_whatsapp_jobs").insert({
    application_id: applicationId,
    recipient_phone: application.phone,
    payload: { text: body },
    status: "PENDING",
  });

  return { queued: !error };
}

export type InterviewNoticeKind = "SCHEDULED" | "CHANGED" | "CANCELLED";

const INTERVIEW_MESSAGES: Record<InterviewNoticeKind, string> = {
  SCHEDULED:
    "Hi {{candidate_name}}, your interview for {{job_title}} is confirmed for {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}",
  CHANGED:
    "Hi {{candidate_name}}, we have moved your interview for {{job_title}} to {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}",
  CANCELLED:
    "Hi {{candidate_name}}, we have cancelled your interview for {{job_title}} that was set for {{interview_when}}. We will be in touch to arrange another time.",
};

/**
 * Renders an interview slot for a candidate who reads it on their phone.
 *
 * The server does not know the candidate's timezone, so the string names UTC
 * out loud instead of printing a local time that would be wrong for them.
 */
function formatInterviewWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the agreed time";
  const stamped = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  return `${stamped} UTC`;
}

export interface InterviewNoticeInput {
  applicationId: string;
  kind: InterviewNoticeKind;
  scheduledAt: string;
  durationMinutes: number;
  meetingLink?: string | null;
}

/**
 * Queues an interview notice for the candidate.
 *
 * Unlike a stage change this is gated only on WhatsApp being enabled — an
 * interview moving is not a pipeline move. Returns false without touching the
 * queue when the channel is off or the candidate has no phone on file, so the
 * scheduling action can report honestly rather than claim a send.
 */
export async function enqueueInterviewNotice(
  input: InterviewNoticeInput
): Promise<{ queued: boolean }> {
  const settings = await getNotificationSettings();
  if (!settings.whatsappEnabled) return { queued: false };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, full_name, phone, job_openings(title)")
    .eq("id", input.applicationId)
    .maybeSingle();

  const application = data as {
    full_name: string;
    phone: string | null;
    job_openings?: { title?: string } | { title?: string }[] | null;
  } | null;
  if (!application?.phone) return { queued: false };

  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;

  const link = input.kind === "CANCELLED" ? "" : input.meetingLink?.trim() ? ` Join here: ${input.meetingLink.trim()}` : "";

  const body = INTERVIEW_MESSAGES[input.kind]
    .replace(/\{\{\s*candidate_name\s*\}\}/g, application.full_name)
    .replace(/\{\{\s*job_title\s*\}\}/g, job?.title ?? "the role")
    .replace(/\{\{\s*interview_when\s*\}\}/g, formatInterviewWhen(input.scheduledAt))
    .replace(/\{\{\s*interview_duration\s*\}\}/g, String(input.durationMinutes))
    .replace(/\{\{\s*interview_link\s*\}\}/g, link)
    .trim();

  const { error } = await supabase.from("scheduled_whatsapp_jobs").insert({
    application_id: input.applicationId,
    recipient_phone: application.phone,
    payload: { text: body },
    status: "PENDING",
  });

  return { queued: !error };
}

export interface WhatsAppDispatchSummary {
  processed: number;
  sent: number;
  failed: number;
}
interface QueuedJob {
  id: string;
  application_id: string | null;
  recipient_phone: string;
  payload: { text?: string } | null;
  attempts: number;
}

/**
 * Sends due PENDING jobs, up to `limit`, oldest first. One failure never
 * blocks the rest of the batch. Failures stay PENDING for the next cron pass
 * until MAX_ATTEMPTS, then park as FAILED.
 */
export async function processDueWhatsAppJobs(limit: number): Promise<WhatsAppDispatchSummary> {
  const supabase = getSupabaseServiceClient();

  const { data } = await supabase
    .from("scheduled_whatsapp_jobs")
    .select("id, application_id, recipient_phone, payload, attempts")
    .eq("status", "PENDING")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  const jobs = (data ?? []) as QueuedJob[];
  const summary: WhatsAppDispatchSummary = { processed: 0, sent: 0, failed: 0 };

  for (const job of jobs) {
    const text = job.payload?.text?.trim();
    if (!text) {
      await supabase
        .from("scheduled_whatsapp_jobs")
        .update({ status: "FAILED", error_log: "Job payload has no text body" })
        .eq("id", job.id);
      summary.processed += 1;
      summary.failed += 1;
      continue;
    }

    const result = await WhatsAppConnector.sendMessage(job.recipient_phone, { text });
    summary.processed += 1;

    if (result.success) {
      summary.sent += 1;
      await supabase
        .from("scheduled_whatsapp_jobs")
        .update({ status: "SENT", sent_at: new Date().toISOString(), error_log: null })
        .eq("id", job.id);
    } else {
      summary.failed += 1;
      const attempts = job.attempts + 1;
      const parked = attempts >= MAX_ATTEMPTS;

      await supabase
        .from("scheduled_whatsapp_jobs")
        .update({
          attempts,
          status: parked ? "FAILED" : "PENDING",
          error_log: result.error ?? "Unknown WhatsApp error",
        })
        .eq("id", job.id);
    }

    // History row per delivered message or per final failure — intermediate
    // retries are visible on the job itself, so the log stays one row per
    // outcome rather than one per attempt.
    const parked = !result.success && job.attempts + 1 >= MAX_ATTEMPTS;
    if (result.success || parked) {
      await supabase.from("communication_logs").insert({
        application_id: job.application_id,
        channel: "WHATSAPP",
        direction: "OUTBOUND",
        recipient: job.recipient_phone,
        body: text,
        delivered: result.success,
        error_message: result.success ? null : (result.error ?? "Unknown WhatsApp error"),
      });
    }
  }

  return summary;
}
