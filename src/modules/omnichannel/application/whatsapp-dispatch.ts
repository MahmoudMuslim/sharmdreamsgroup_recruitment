import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { appConfig } from "@/lib/config";
import { formatInZone } from "@/lib/timezone";
import { getSessionUser } from "@/lib/auth/session";
import { currentActivityContext, recordActivity } from "@/modules/activity/application/record";
import type { ActivityEntry } from "@/modules/activity/domain/trail";
import {
  getOrganisationTimeZone,
  getStringSetting,
} from "@/modules/settings/infrastructure/settingsReader";
import { WhatsAppConnector } from "@/modules/omnichannel/infrastructure/connectors";
import {
  ASSESSMENT_INVITE_TEMPLATE,
  STAGE_FALLBACK_TEMPLATE,
  TEMPLATE_DEFAULTS,
  WHATSAPP_INTERVIEW_TEMPLATES,
  WHATSAPP_STAGE_TEMPLATES,
  humanizeStage,
  renderTemplate,
  type TemplateVars,
} from "@/modules/settings/domain/templates";

/**
 * Timed WhatsApp dispatch for pipeline stage changes.
 *
 * The recruiter action only enqueues; sending happens through
 * `processDueWhatsAppJobs`, the same path the /api/cron/whatsapp route uses.
 * That keeps one code path responsible for talking to Meta and for writing
 * `communication_logs`, so the cron retry and the best-effort immediate pass
 * can never drift apart.
 *
 * Copy comes from `notification_templates` (Settings → Access & comms), falling
 * back to `TEMPLATE_DEFAULTS` when a row is missing or switched off, so the
 * queue can never emit a half-rendered template key.
 *
 * Runs on the service-role client because the cron route has no user session;
 * callers are server-side trust boundaries (staff actions, the secret-guarded
 * cron endpoint).
 */

/** Attempts before a job is parked as FAILED instead of retried forever. */
export const MAX_ATTEMPTS = 3;

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

/** First active WHATSAPP row among `keys`, else the shipped default. */
async function resolveTemplate(keys: string[]): Promise<{ body: string; key: string }> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("notification_templates")
    .select("key, body")
    .eq("channel", "WHATSAPP")
    .eq("is_active", true)
    .in("key", keys);

  const rows = (data ?? []) as { key: string; body: string }[];
  for (const key of keys) {
    const row = rows.find((candidate) => candidate.key === key);
    if (row?.body?.trim()) return { body: row.body, key };
  }

  const fallback = keys.find((key) => TEMPLATE_DEFAULTS[key]);
  if (!fallback) throw new Error(`No template or default for ${keys.join(", ")}`);
  return { body: TEMPLATE_DEFAULTS[fallback], key: fallback };
}

/** `{{company_name}}` reads the same setting the rest of the portals show. */
const getCompanyName = () =>
  getStringSetting("organisation.name", "Sharm Dreams Group");

/** Every token is always supplied; an unavailable value renders as nothing. */
async function buildVars(application: { full_name: string }, jobTitle: string, stage: string) {
  return {
    candidate_name: application.full_name,
    job_title: jobTitle,
    stage,
    company_name: await getCompanyName(),
    assessment_link: "",
    interview_when: "",
    interview_duration: "",
    interview_link: "",
  } satisfies TemplateVars;
}

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
  const templateKey = WHATSAPP_STAGE_TEMPLATES[stage];
  if (!templateKey) return { queued: false };

  const settings = await getNotificationSettings();
  if (!settings.whatsappEnabled || !settings.notifyOnStageChange) {
    return { queued: false };
  }

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, full_name, phone, job_openings(title), candidate_attempts(access_token)")
    .eq("id", applicationId)
    // A re-issued candidate has several attempts; the link must be the newest,
    // and an unordered embed is whichever row the database happened to read.
    .order("created_at", { referencedTable: "candidate_attempts", ascending: false })
    .maybeSingle();

  const application = data as ApplicationForAlert | null;
  if (!application?.phone) return { queued: false };

  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;
  const attempt = Array.isArray(application.candidate_attempts)
    ? application.candidate_attempts[0]
    : application.candidate_attempts;

  const siteUrl = appConfig.url;
  const { body, key } = await resolveTemplate([templateKey, STAGE_FALLBACK_TEMPLATE]);
  const vars = await buildVars(
    application,
    job?.title ?? "the role",
    humanizeStage(stage)
  );
  vars.assessment_link = attempt?.access_token
    ? `Start it here: ${siteUrl}/test/${attempt.access_token}`
    : "";

  const text = renderTemplate(body, vars).trim();

  const { error } = await supabase.from("scheduled_whatsapp_jobs").insert({
    application_id: applicationId,
    recipient_phone: application.phone,
    payload: { text, template: key },
    status: "PENDING",
  });

  return { queued: !error };
}

/**
 * Queues the invitation a candidate gets when a recruiter issues a test.
 *
 * The stage alert usually went out before any attempt existed, so its
 * `{{assessment_link}}` rendered as nothing. This message is the one that
 * carries a link which opens the test, and it takes the token the issuing
 * action just minted rather than looking one up.
 */
export async function enqueueAssessmentInvite(input: {
  applicationId: string;
  accessToken: string;
}): Promise<{ queued: boolean }> {
  const settings = await getNotificationSettings();
  if (!settings.whatsappEnabled) return { queued: false };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, full_name, phone, job_openings(title)")
    .eq("id", input.applicationId)
    .maybeSingle();

  const application = data as ApplicationForAlert | null;
  if (!application?.phone) return { queued: false };

  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;

  const siteUrl = appConfig.url;
  const { body, key } = await resolveTemplate([ASSESSMENT_INVITE_TEMPLATE]);
  const vars = await buildVars(application, job?.title ?? "the role", "assessment");
  vars.assessment_link = `Start it here: ${siteUrl}/test/${input.accessToken}`;

  const { error } = await supabase.from("scheduled_whatsapp_jobs").insert({
    application_id: input.applicationId,
    recipient_phone: application.phone,
    payload: { text: renderTemplate(body, vars).trim(), template: key },
    status: "PENDING",
  });

  return { queued: !error };
}

export type InterviewNoticeKind = "SCHEDULED" | "CHANGED" | "CANCELLED";

/**
 * Renders an interview slot for a candidate who reads it on their phone.
 *
 * The group's operating timezone (`organisation.timezone`) is the only one it
 * can name credibly, and it is printed as an abbreviation so a candidate in a
 * different zone can still convert it.
 */
export async function formatInterviewWhen(iso: string): Promise<string> {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the agreed time";
  const zone = await getOrganisationTimeZone();
  // `dateStyle`/`timeStyle` cannot be mixed with `timeZoneName`, so the fields
  // are asked for explicitly — and h23 keeps midnight printing as 00, not 24.
  return formatInZone(iso, zone, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
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

  const link =
    input.kind === "CANCELLED"
      ? ""
      : input.meetingLink?.trim()
        ? ` Join here: ${input.meetingLink.trim()}`
        : "";

  const templateKey = WHATSAPP_INTERVIEW_TEMPLATES[input.kind];
  const { body, key } = await resolveTemplate([templateKey]);
  const vars = await buildVars(application, job?.title ?? "the role", "interview");
  vars.interview_when = await formatInterviewWhen(input.scheduledAt);
  vars.interview_duration = String(input.durationMinutes);
  vars.interview_link = link;

  const text = renderTemplate(body, vars).trim();

  const { error } = await supabase.from("scheduled_whatsapp_jobs").insert({
    application_id: input.applicationId,
    recipient_phone: application.phone,
    payload: { text, template: key },
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
 * Who the trail says drained the queue.
 *
 * A dispatcher is never a person's judgement, but it runs on someone's request:
 * the cron sweep has no session, a recruiter's action does. The surface is
 * whichever of the two actually called, so a message sent because a recruiter
 * moved a candidate is not filed under the scheduler.
 */
async function dispatchActor(): Promise<
  Pick<ActivityEntry, "actorKind" | "actorLabel" | "via">
> {
  const session = await getSessionUser();
  return {
    actorKind: "SYSTEM",
    actorLabel: "WhatsApp dispatcher",
    via: currentActivityContext().via ?? (session ? "console" : "cron"),
  };
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
  const deadLetters: { jobId: string; recipient: string; error: string }[] = [];

  for (const job of jobs) {
    const text = job.payload?.text?.trim();
    if (!text) {
      await supabase
        .from("scheduled_whatsapp_jobs")
        .update({ status: "FAILED", error_log: "Job payload has no text body" })
        .eq("id", job.id);
      summary.processed += 1;
      summary.failed += 1;
      deadLetters.push({ jobId: job.id, recipient: job.recipient_phone, error: "Job payload has no text body" });
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
    if (parked) {
      deadLetters.push({
        jobId: job.id,
        recipient: job.recipient_phone,
        error: result.error ?? "Unknown WhatsApp error",
      });
    }
  }

  if (jobs.length > 0) {
    const actor = await dispatchActor();

    // A parked message is the one nobody would otherwise notice: the queue is
    // empty, the outbox says refused, and the candidate was never told.
    for (const dead of deadLetters) {
      await recordActivity({
        ...actor,
        area: "messaging",
        action: "message_parked",
        entity: "scheduled message",
        entityId: dead.jobId,
        summary: `Gave up sending the queued WhatsApp message to ${dead.recipient} after ${MAX_ATTEMPTS} attempts — ${dead.error}`,
        detail: { attempts: MAX_ATTEMPTS, error: dead.error.slice(0, 200), body: "[withheld]" },
      });
    }

    await recordActivity({
      ...actor,
      area: "messaging",
      action: "whatsapp_dispatch",
      entity: "scheduled message",
      summary: `WhatsApp dispatcher drained ${summary.processed} queued message${summary.processed === 1 ? "" : "s"} — ${summary.sent} delivered${summary.failed ? `, ${summary.failed} refused${deadLetters.length ? ` (${deadLetters.length} parked)` : ""}` : ""}`,
      detail: {
        processed: summary.processed,
        sent: summary.sent,
        refused: summary.failed,
        parked: deadLetters.length,
      },
    });
  }

  return summary;
}
