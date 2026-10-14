"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getBoolSetting } from "@/modules/settings/infrastructure/settingsReader";
import { EmailConnector, missingSmtpFields } from "@/modules/omnichannel/infrastructure/emailConnector";
import {
  QUEUE_SELECT,
  firstOf,
  type DeliveryRow,
  type EmailFlags,
  type EmailLogRow,
  type NoticeRow,
  type OutboxJob,
  type RecipientOption,
} from "./outbox-model";

export interface OutboxResult {
  ok: boolean;
  error?: string;
}

/** Meta's cap for a plain text message body. */
const MAX_TEXT_LENGTH = 4096;

interface JobPayload {
  text?: string;
  template?: string;
}

/**
 * Every mutation below goes through the service-role client.
 *
 * `scheduled_whatsapp_jobs` only has a staff SELECT policy — by design, the
 * queue is written by the dispatcher, not from a browser session. So reads use
 * the RLS-scoped staff client and writes borrow the dispatcher's authority,
 * after the staff session and the `messages.send` permission are verified.
 */
async function guardOutboxWrite(): Promise<OutboxResult | null> {
  await requireStaff("/whatsapp");
  if (!(await hasPermissionForUser("messages.send"))) {
    return {
      ok: false,
      error: "You need the Send messages permission to change the outbound queue.",
    };
  }
  return null;
}

function toJob(row: Record<string, unknown>): OutboxJob {
  const payload = (row.payload ?? {}) as JobPayload;
  const application = firstOf(
    row.applications as { full_name?: string; job_openings?: { title?: string } | { title?: string }[] } | null
  );
  return {
    id: String(row.id),
    application_id: (row.application_id as string) ?? null,
    recipient_phone: String(row.recipient_phone ?? ""),
    candidate_name: application?.full_name ?? null,
    job_title: firstOf(application?.job_openings)?.title ?? null,
    template: payload.template ?? null,
    text: payload.text ?? "",
    status: String(row.status) as OutboxJob["status"],
    attempts: Number(row.attempts ?? 0),
    error_log: (row.error_log as string) ?? null,
    scheduled_for: String(row.scheduled_for ?? ""),
    sent_at: (row.sent_at as string) ?? null,
    created_at: String(row.created_at ?? ""),
  };
}

/** The queue, the delivery log, and everyone the outbox can address. */
export async function getOutbox(): Promise<{
  jobs: OutboxJob[];
  history: DeliveryRow[];
  recipients: RecipientOption[];
}> {
  const supabase = await createSupabaseServerClient();

  const [queue, log, roster] = await Promise.all([
    supabase
      .from("scheduled_whatsapp_jobs")
      .select(QUEUE_SELECT)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("communication_logs")
      .select("id, recipient, body, delivered, error_message, created_at, applications(full_name)")
      .eq("channel", "WHATSAPP")
      .eq("direction", "OUTBOUND")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("applications")
      .select("id, full_name, phone, job_openings(title)")
      .not("phone", "is", null)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  if (queue.error) console.error("[outbox] queue query failed:", queue.error.message);
  if (log.error) console.error("[outbox] delivery log query failed:", log.error.message);
  if (roster.error) console.error("[outbox] recipient query failed:", roster.error.message);

  const jobs = ((queue.data ?? []) as unknown as Record<string, unknown>[]).map(toJob);

  const history = ((log.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    recipient: String(row.recipient ?? ""),
    candidate_name: firstOf(row.applications as { full_name?: string } | null)?.full_name ?? null,
    body: String(row.body ?? ""),
    delivered: Boolean(row.delivered),
    error_message: (row.error_message as string) ?? null,
    created_at: String(row.created_at ?? ""),
  }));

  const recipients = ((roster.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    full_name: String(row.full_name ?? ""),
    phone: String(row.phone ?? ""),
    job_title: firstOf(row.job_openings as { title?: string } | null)?.title ?? null,
  }));

  return { jobs, history, recipients };
}

function normalizeText(raw: string): { text?: string; error?: string } {
  const text = raw.trim();
  if (!text) return { error: "The message cannot be empty." };
  if (text.length > MAX_TEXT_LENGTH) {
    return { error: `Keep the message under ${MAX_TEXT_LENGTH} characters.` };
  }
  return { text };
}

/** `""` means "as soon as the queue next runs"; anything else must parse. */
function normalizeSchedule(raw: string): { iso?: string; error?: string } {
  const value = raw.trim();
  if (!value) return {};
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: "That send time is not a valid date." };
  }
  return { iso: date.toISOString() };
}

/** Queue a message by hand, addressed to one candidate. */
export async function queueWhatsAppMessage(input: {
  applicationId: string;
  text: string;
  scheduledFor: string;
}): Promise<OutboxResult> {
  const denied = await guardOutboxWrite();
  if (denied) return denied;

  if (!input.applicationId) return { ok: false, error: "Choose a candidate." };

  const { text, error } = normalizeText(input.text);
  if (error || !text) return { ok: false, error };

  const when = normalizeSchedule(input.scheduledFor);
  if (when.error) return { ok: false, error: when.error };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, phone")
    .eq("id", input.applicationId)
    .maybeSingle();

  const phone = (data as { phone?: string } | null)?.phone?.trim();
  if (!phone) {
    return { ok: false, error: "This candidate has no phone number on file." };
  }

  const { error: insertError } = await supabase.from("scheduled_whatsapp_jobs").insert({
    application_id: input.applicationId,
    recipient_phone: phone,
    payload: { text, template: "manual" },
    status: "PENDING",
    scheduled_for: when.iso ?? new Date().toISOString(),
  });

  if (insertError) {
    console.error("[outbox] manual enqueue failed:", insertError.message);
    return { ok: false, error: "The message could not be queued." };
  }

  revalidatePath("/whatsapp");
  return { ok: true };
}

/** Re-arm a parked job so the dispatcher tries it again from attempt one. */
export async function retryWhatsAppJob(id: string): Promise<OutboxResult> {
  const denied = await guardOutboxWrite();
  if (denied) return denied;
  if (!id) return { ok: false, error: "No message selected." };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("scheduled_whatsapp_jobs")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  const row = data as { status: string } | null;
  if (!row) return { ok: false, error: "This message is no longer in the queue." };
  if (row.status === "SENT") {
    return {
      ok: false,
      error: "Already delivered. Retrying would message the candidate twice.",
    };
  }

  const { error } = await supabase
    .from("scheduled_whatsapp_jobs")
    .update({
      status: "PENDING",
      attempts: 0,
      error_log: null,
      sent_at: null,
      scheduled_for: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", row.status);

  if (error) {
    console.error("[outbox] retry failed:", error.message);
    return { ok: false, error: "The message could not be re-queued." };
  }

  revalidatePath("/whatsapp");
  return { ok: true };
}

/** Edit the copy and/or the send time of a message that has not gone out. */
export async function updateWhatsAppJob(
  id: string,
  input: { text: string; scheduledFor: string }
): Promise<OutboxResult> {
  const denied = await guardOutboxWrite();
  if (denied) return denied;
  if (!id) return { ok: false, error: "No message selected." };

  const { text, error } = normalizeText(input.text);
  if (error || !text) return { ok: false, error };

  const when = normalizeSchedule(input.scheduledFor);
  if (when.error) return { ok: false, error: when.error };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("scheduled_whatsapp_jobs")
    .select("id, status, payload, scheduled_for")
    .eq("id", id)
    .maybeSingle();

  const row = data as { status: string; payload?: JobPayload; scheduled_for?: string } | null;
  if (!row) return { ok: false, error: "This message is no longer in the queue." };
  if (row.status === "SENT") {
    return { ok: false, error: "Delivered messages are history and cannot be edited." };
  }

  const { error: updateError } = await supabase
    .from("scheduled_whatsapp_jobs")
    .update({
      payload: { ...row.payload, text },
      // Editing the copy keeps its place in time unless the admin set a new one.
      scheduled_for: when.iso ?? row.scheduled_for ?? new Date().toISOString(),
      status: "PENDING",
      attempts: 0,
      error_log: null,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[outbox] edit failed:", updateError.message);
    return { ok: false, error: "The message could not be updated." };
  }

  revalidatePath("/whatsapp");
  return { ok: true };
}

/** Drop a message from the queue. Delivered rows stay for the audit trail. */
export async function cancelWhatsAppJob(id: string): Promise<OutboxResult> {
  const denied = await guardOutboxWrite();
  if (denied) return denied;
  if (!id) return { ok: false, error: "No message selected." };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("scheduled_whatsapp_jobs")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  const row = data as { status: string } | null;
  if (!row) return { ok: false, error: "This message is no longer in the queue." };
  if (row.status === "SENT") {
    return {
      ok: false,
      error: "This one was delivered. The queue row is the record of that — cancel the candidate's next alert instead.",
    };
  }

  const { error } = await supabase.from("scheduled_whatsapp_jobs").delete().eq("id", id);
  if (error) {
    console.error("[outbox] cancel failed:", error.message);
    return { ok: false, error: "The message could not be removed from the queue." };
  }

  revalidatePath("/whatsapp");
  return { ok: true };
}

/**
 * Columns both message tables share; `read_at` only means something to the
 * in-app channel and `subject` only to email.
 */
const MESSAGE_SELECT =
  "id, application_id, recipient, subject, body, delivered, error_message, created_at, read_at, applications(full_name, job_openings(title))";

interface MessageRow {
  id: string;
  application_id: string | null;
  recipient: string;
  subject: string | null;
  body: string;
  delivered: boolean;
  error_message: string | null;
  created_at: string;
  read_at: string | null;
  applications?: { full_name?: string; job_openings?: { title?: string } | { title?: string }[] } | null;
}

function toMessageRow(row: MessageRow) {
  const application = firstOf(row.applications);
  return {
    id: row.id,
    application_id: row.application_id ?? null,
    recipient: row.recipient ?? "",
    candidate_name: application?.full_name ?? null,
    job_title: firstOf(application?.job_openings)?.title ?? null,
    subject: row.subject ?? null,
    body: row.body ?? "",
    delivered: Boolean(row.delivered),
    error_message: row.error_message ?? null,
    created_at: row.created_at,
    read_at: row.read_at ?? null,
  };
}

/**
 * Email and portal notices, with the switches that produced them.
 *
 * These channels send inline, so there is no queue to show — what the admin
 * needs is what went out, what the relay refused, and whether the candidate has
 * read their notice yet.
 */
export async function getEmailOutbox(): Promise<{
  emails: EmailLogRow[];
  notices: NoticeRow[];
  flags: EmailFlags;
}> {
  const supabase = await createSupabaseServerClient();

  const [emailResult, noticeResult, missing, emailEnabled, inAppEnabled] = await Promise.all([
    supabase
      .from("communication_logs")
      .select(MESSAGE_SELECT)
      .eq("channel", "EMAIL")
      .eq("direction", "OUTBOUND")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("communication_logs")
      .select(MESSAGE_SELECT)
      .eq("channel", "IN_APP")
      .eq("direction", "OUTBOUND")
      .order("created_at", { ascending: false })
      .limit(60),
    missingSmtpFields(),
    getBoolSetting("notifications.email_enabled", true),
    getBoolSetting("notifications.in_app_enabled", true),
  ]);

  if (emailResult.error) console.error("[outbox] email log query failed:", emailResult.error.message);
  if (noticeResult.error) console.error("[outbox] notice query failed:", noticeResult.error.message);

  const emails: EmailLogRow[] = ((emailResult.data ?? []) as unknown as MessageRow[]).map(toMessageRow);
  const notices: NoticeRow[] = ((noticeResult.data ?? []) as unknown as MessageRow[]).map(toMessageRow);

  return {
    emails,
    notices,
    flags: {
      emailEnabled,
      inAppEnabled,
      smtpConfigured: missing === null,
      smtpMissing: missing ?? [],
    },
  };
}

/**
 * Re-sends one stored email using the copy that is already on the row.
 *
 * Only a failed row can be retried: a delivered message re-sent from here would
 * mail the candidate twice with nothing in the log to explain it. The row keeps
 * its place in history and records the newest attempt, the same way a re-armed
 * WhatsApp job keeps its queue row.
 */
export async function resendEmailMessage(id: string): Promise<OutboxResult> {
  const denied = await guardOutboxWrite();
  if (denied) return denied;
  if (!id) return { ok: false, error: "No message selected." };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("communication_logs")
    .select("id, channel, recipient, subject, body, delivered")
    .eq("id", id)
    .maybeSingle();

  const row = data as
    | { channel: string; recipient: string; subject: string | null; body: string; delivered: boolean }
    | null;

  if (!row) return { ok: false, error: "This message is no longer in the log." };
  if (row.channel !== "EMAIL") {
    return { ok: false, error: "Only emails leave the relay from here — portal notices are already in the candidate's inbox." };
  }
  if (row.delivered) {
    return {
      ok: false,
      error: "Already delivered. Sending again would mail the candidate twice; write them a new message instead.",
    };
  }
  if (!(await EmailConnector.isConfigured())) {
    return { ok: false, error: "No SMTP relay is configured, so there is nothing to send through (Settings → API keys)." };
  }

  const outcome = await EmailConnector.send({
    to: row.recipient,
    subject: row.subject?.trim() || "An update on your application",
    text: row.body,
  });

  const { error } = await supabase
    .from("communication_logs")
    .update({ delivered: outcome.success, error_message: outcome.error ?? null })
    .eq("id", id);

  if (error) {
    console.error("[outbox] email retry log update failed:", error.message);
    return {
      ok: false,
      error: outcome.success
        ? "The relay accepted the message but its delivery could not be recorded."
        : outcome.error ?? "The message could not be sent.",
    };
  }

  if (!outcome.success) {
    return { ok: false, error: outcome.error ?? "The relay refused this message." };
  }

  revalidatePath("/whatsapp");
  return { ok: true };
}
