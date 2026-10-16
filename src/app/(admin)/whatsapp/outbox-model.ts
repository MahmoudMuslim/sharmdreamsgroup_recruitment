/**
 * Shared shapes for the WhatsApp outbox.
 *
 * Lives apart from `actions.ts` so the client view can import these types
 * without pulling a `"use server"` module into the browser bundle.
 */

export type QueueStatus = "PENDING" | "SENT" | "FAILED";

/** Which column of the queue a job sits in, from the admin's point of view. */
export type OutboxBucket = "ALL" | "DUE" | "WAITING" | "SENT" | "FAILED";

/**
 * Every queue row the outbox reads, and every delivery-log or email row.
 *
 * A cap is only honest if the page says it exists, so the readers return the
 * all-time counts alongside the capped rows and the view compares them.
 */
export const QUEUE_PAGE_LIMIT = 200;
export const LOG_PAGE_LIMIT = 60;

export interface OutboxJob {
  id: string;
  application_id: string | null;
  recipient_phone: string;
  candidate_name: string | null;
  job_title: string | null;
  template: string | null;
  text: string;
  status: QueueStatus;
  attempts: number;
  error_log: string | null;
  scheduled_for: string;
  sent_at: string | null;
  created_at: string;
}

export interface DeliveryRow {
  id: string;
  recipient: string;
  candidate_name: string | null;
  body: string;
  delivered: boolean;
  error_message: string | null;
  created_at: string;
}

/** A candidate the outbox can address, i.e. one with a phone number on file. */
export interface RecipientOption {
  id: string;
  full_name: string;
  phone: string;
  job_title: string | null;
}

/** One email the platform handed to the SMTP relay, with its outcome. */
export interface EmailLogRow {
  id: string;
  application_id: string | null;
  recipient: string;
  candidate_name: string | null;
  job_title: string | null;
  subject: string | null;
  body: string;
  delivered: boolean;
  error_message: string | null;
  created_at: string;
}

/** One portal notice, i.e. a message that only lives in the candidate's inbox. */
export interface NoticeRow {
  id: string;
  application_id: string | null;
  candidate_name: string | null;
  subject: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface EmailFlags {
  /** `notifications.email_enabled` as the dispatcher reads it. */
  emailEnabled: boolean;
  /** `notifications.in_app_enabled`. */
  inAppEnabled: boolean;
  /** Whether the SMTP relay has every field it needs — never the credentials. */
  smtpConfigured: boolean;
  /** Which relay fields are missing, for the honest empty state. */
  smtpMissing: string[];
}

export interface OutboxFlags {
  /** `notifications.whatsapp_enabled` as the dispatcher reads it. */
  whatsappEnabled: boolean;
  /** Whether CRON_SECRET exists — never the value itself. */
  cronArmed: boolean;
  /** Jobs the cron pass takes per run. */
  batchSize: number;
  /** Attempts before the dispatcher parks a job as FAILED. */
  maxAttempts: number;
}

export const QUEUE_SELECT =
  "id, application_id, recipient_phone, payload, status, attempts, error_log, scheduled_for, sent_at, created_at, applications(full_name, job_openings(title))";

/** PostgREST returns to-one embeds as an object or a one-item array. */
export function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/* -------------------------------------------------------------------------- */
/* URL state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The queue's own columns, in the order the rail shows them.
 *
 * `DUE` and `WAITING` are both `PENDING` rows, split by whether their send time
 * has arrived, so a server-side filter can only ever narrow to `PENDING` — the
 * view then puts each row in the column it belongs to.
 */
export const OUTBOX_BUCKETS = ["ALL", "DUE", "WAITING", "SENT", "FAILED"] as const;

/** The `status` a bucket narrows the queue read to, or `null` for "read it all". */
export const QUEUE_STATUS_BY_BUCKET: Record<OutboxBucket, QueueStatus | null> = {
  ALL: null,
  DUE: "PENDING",
  WAITING: "PENDING",
  SENT: "SENT",
  FAILED: "FAILED",
};

export function isOutboxBucket(value: unknown): OutboxBucket | null {
  return typeof value === "string" && (OUTBOX_BUCKETS as readonly string[]).includes(value)
    ? (value as OutboxBucket)
    : null;
}

/**
 * `?failed=1` — the delivery log and the email panel read undelivered rows only.
 *
 * Anything other than "1" leaves the view unfiltered, so a hand-typed `?failed`
 * cannot silently empty the page.
 */
export function isFailedView(value: unknown): boolean {
  return value === "1";
}

/**
 * The two channels whose rows the attention feed counts as "did not reach".
 *
 * `IN_APP` is deliberately absent: a portal notice is written to an inbox rather
 * than relayed, so its rows always carry `delivered: true` and counting them here
 * would repeat the mistake `src/modules/analytics/domain/report.ts` documents.
 */
export const DELIVERED_LOG_CHANNELS = ["WHATSAPP", "EMAIL"] as const;
