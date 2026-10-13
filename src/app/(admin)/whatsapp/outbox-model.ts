/**
 * Shared shapes for the WhatsApp outbox.
 *
 * Lives apart from `actions.ts` so the client view can import these types
 * without pulling a `"use server"` module into the browser bundle.
 */

export type QueueStatus = "PENDING" | "SENT" | "FAILED";

/** Which column of the queue a job sits in, from the admin's point of view. */
export type OutboxBucket = "ALL" | "DUE" | "WAITING" | "SENT" | "FAILED";

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
