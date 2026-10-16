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
 * `DUE` and `WAITING` are both `PENDING` rows, split by whether the send time has
 * arrived. Status alone cannot tell them apart, so `getOutbox` carries the
 * `scheduled_for` line into the read too and `bucketOf` draws the same line per
 * row for its badge: an answer that asked for the due column and got the
 * scheduled alerts with it would name rows that are not in the column it claims.
 */
export const OUTBOX_BUCKETS = ["ALL", "DUE", "WAITING", "SENT", "FAILED"] as const;

/**
 * The `status` a bucket narrows the queue read to, or `null` for "read it all".
 *
 * `DUE` and `WAITING` share the one status, so their read adds the send-time
 * filter beside this — see `getOutbox`.
 */
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

/* -------------------------------------------------------------------------- */
/* Scope notes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What an outbox read is standing on, in the words the answer quotes back.
 *
 * The queue and the delivery log are two tables with two different notions of
 * "failed": a `FAILED` job is one the relay gave up on, a refused log row is a
 * send the channel wrote down as undelivered, and the same trouble usually makes
 * both. So a read that narrows one of them has to say it narrowed only one —
 * otherwise `failed` reads as if it trimmed the queue as well as the log. The
 * chips keep counting the whole queue on purpose, the way the candidates' rails
 * do: a lit column that re-counted its neighbours' sets could not be compared
 * with them, which is the only reason to click one.
 */
export function outboxScopeNote(input: {
  bucket: OutboxBucket;
  failed: boolean;
  shown: number;
  loaded: number;
  logShown: number;
  logLoaded: number;
  buckets: Record<OutboxBucket, number>;
  failedLogTotal: number;
}): string {
  const { bucket, failed, shown, loaded, logShown, logLoaded, buckets: counts, failedLogTotal } = input;
  const apps = (n: number) => n.toLocaleString();
  const queue =
    bucket === "ALL"
      ? `The queue chips count ${apps(counts.ALL)} jobs in all, and this read carries ${apps(loaded)}.`
      : `The ${bucket} column holds ${apps(counts[bucket])} of the ${apps(
          counts.ALL
        )} jobs the chips count, and this read carries ${apps(loaded)}. Those chip numbers stay whole on purpose so a lit column is still comparable with its neighbours.`;
  const window =
    loaded === 0
      ? "Nothing is in the set this read asks for, so this answer names none."
      : shown === loaded
        ? `This answer names every one of the ${apps(shown)}.`
        : `This answer names ${apps(shown)} of the ${apps(loaded)} the read carries.`;
  const cap =
    loaded >= QUEUE_PAGE_LIMIT
      ? ` The queue read stops at the newest ${apps(QUEUE_PAGE_LIMIT)}, so a job older than that window is out of reach from here.`
      : "";
  // Only say a row is outside the window when the read actually filled it — the
  // live log holds fewer rows than the cap, and a note that claimed a window
  // nobody reached would be the sort of hedge this console is meant to stop.
  const logCap =
    logLoaded >= LOG_PAGE_LIMIT
      ? ` The log read stops at the newest ${apps(LOG_PAGE_LIMIT)}, so an older outcome is out of reach from here.`
      : "";
  const log = failed
    ? `The ${apps(logShown)} delivery rows below are refused sends only: the whole log holds ${apps(
        failedLogTotal
      )} undelivered rows and this read carried ${apps(logLoaded)} of them.${logCap} A refused log row and a FAILED job are two counts of the same trouble, not twice the work.`
    : `The ${apps(logShown)} delivery rows below are the newest of the ${apps(
        logLoaded
      )} outcomes the channel wrote down, refused or not, and ${apps(
        failedLogTotal
      )} rows in the whole log are undelivered.${logCap}`;
  return `${queue} ${window}${cap} ${log}`;
}

/**
 * What an email log read is standing on.
 *
 * Same trap, different table: the panel's tiles count every attempt on the
 * channel, while the rows are a capped window and `failed` narrows only the
 * emails. Portal notices are inbox rows, not relayed sends, so they are never in
 * this answer at all — the note names them rather than letting a notice count
 * look like a mail the relay refused.
 */
export function emailScopeNote(input: {
  failed: boolean;
  shown: number;
  loaded: number;
  totals: { emailsDelivered: number; emailsFailed: number; noticesUnread: number; noticesRead: number };
}): string {
  const { failed, shown, loaded, totals } = input;
  const apps = (n: number) => n.toLocaleString();
  const attempts = totals.emailsDelivered + totals.emailsFailed;
  const held = `The email log holds ${apps(attempts)} send${
    attempts === 1 ? "" : "s"
  }: ${apps(totals.emailsDelivered)} accepted, ${apps(totals.emailsFailed)} refused.`;
  // One sentence per case: a note that states the same number twice reads as two
  // different counts, and "1 of the 1" is not a sentence anybody can quote back.
  const newest = `carries the newest ${apps(loaded)} attempt${loaded === 1 ? "" : "s"}, delivered or not`;
  const listed =
    loaded === 0
      ? `Nothing is left once this read ${failed ? "keeps only refused sends" : "takes the newest attempts"}, so it names none.`
      : shown < loaded
        ? `This read ${
            failed
              ? `carries ${apps(loaded)} of the ${apps(totals.emailsFailed)} refused sends the log holds`
              : newest
          }; this answer names ${apps(shown)} of them.`
        : `This read ${
            failed
              ? `carries every one of the ${apps(totals.emailsFailed)} refused sends the log holds`
              : newest
          }, and this answer names all ${apps(shown)}.`;
  // What the read was asking for, so the window is measured against the right
  // half of the log: a refused-only read cannot be short of *every* attempt.
  const askedFor = failed ? totals.emailsFailed : attempts;
  const hidden =
    askedFor > loaded
      ? ` The other ${apps(askedFor - loaded)} are older than what this read carries and cannot be named from here.`
      : "";
  const notices = ` The ${apps(totals.noticesUnread)} unread and ${apps(
    totals.noticesRead
  )} opened portal notices are inbox rows, not relayed sends, and are not listed here.`;
  return `${held} ${listed}${hidden}${notices}`;
}
