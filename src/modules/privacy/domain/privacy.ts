/**
 * The rules a privacy request has to satisfy, with no database behind them.
 *
 * Three things live here because every screen and every action has to agree
 * about them: what a consent is, when a record's retention window has run out,
 * and what erasure means. The database owns the facts this module cannot — the
 * consent events themselves, the request's row, and the one function that
 * anonymises an application — but a browser's refusal and an action's refusal
 * are the same sentence because both call this file.
 *
 * Pure by design — no `server-only`, no REST client — because the public page,
 * the apply form and the staff desk all read it.
 */

/** The file that has to be applied before any of this can store a row. */
export const PRIVACY_MIGRATION = "db/migrations/041_privacy.sql";

/**
 * What a screen says when the tables are not on the database it is reading.
 *
 * Consent is enforced in code as well as stored here, so an unapplied 041 costs
 * the record of a decision and never an applicant: the application is still
 * accepted, and this note is what says so rather than a screen pretending it
 * saved something.
 */
export const PRIVACY_SCHEMA_NOTE =
  "The privacy tables have not been created on this database yet — " +
  `${PRIVACY_MIGRATION} is authored but not applied. Requests cannot be filed, ` +
  "and a consent is enforced but not stored, until it is.";

/** The refusal a staff write returns while the tables are missing. */
export const PRIVACY_WRITE_REFUSAL =
  "Privacy requests cannot be saved until " +
  `${PRIVACY_MIGRATION} is applied to this database.`;

/** How far the desk reads before it says it stopped. */
export const PRIVACY_READ_LIMIT = 500;

/** The request note's own bound, stated in the migration as well. */
export const PRIVACY_NOTE_MAX = 400;

/**
 * The notice the applicant agreed to, as a date.
 *
 * Stored on the application beside the consent stamp so a later change to the
 * wording cannot be read back as if the candidate had agreed to it.
 */
export const PRIVACY_NOTICE_VERSION = "2026-10-25";

/** Where the notice lives. The mailed link opens this page. */
export const PRIVACY_NOTICE_PATH = "/privacy";

/** Retention defaults. A setting overrides each one; none of them is a promise. */
export const RETENTION_DEFAULT_MONTHS = 12;
export const TALENT_POOL_DEFAULT_MONTHS = 24;
export const RETENTION_WARNING_DAYS = 30;

/** The ceilings a mistyped setting is clamped to, so a typo cannot delete. */
export const MAX_RETENTION_MONTHS = 60;
export const MAX_WARNING_DAYS = 90;

/* -------------------------------------------------------------------------- */
/* Consent                                                                     */
/* -------------------------------------------------------------------------- */

export type ConsentPurpose = "processing" | "talent_pool";

export const CONSENT_PURPOSES: readonly ConsentPurpose[] = ["processing", "talent_pool"];

export interface ConsentEvent {
  purpose: ConsentPurpose;
  granted: boolean;
  /** ISO instant, so the latest event is a comparison rather than a row order. */
  at: string;
}

export type ConsentState = "granted" | "withdrawn" | "unknown";

export type ConsentPlan =
  | { ok: true; events: ConsentEvent[] }
  | { ok: false; error: string };

/**
 * Read the two checkboxes as the events they record, or say why not.
 *
 * Processing is required: without it there is no lawful basis for the
 * application itself, so a submission that leaves it unticked is refused rather
 * than stored with a hole. The talent pool is optional, and an answer either way
 * is recorded — a candidate declining the pool is a decision the record should
 * be able to show, not the same blank as never being asked. An unclear answer
 * (a string where a boolean belongs) is refused instead of guessed into the
 * candidate's favour.
 */
export function planApplicationConsent(
  input: { processing: unknown; talentPool?: unknown },
  now: Date | string = new Date()
): ConsentPlan {
  if (input.processing !== true) {
    return {
      ok: false,
      error: "Agree to us processing your application before submitting it.",
    };
  }
  if (input.talentPool !== undefined && typeof input.talentPool !== "boolean") {
    return { ok: false, error: "Choose whether we may keep your details for future roles." };
  }

  const at = new Date(now).toISOString();
  const events: ConsentEvent[] = [{ purpose: "processing", granted: true, at }];
  if (typeof input.talentPool === "boolean") {
    events.push({ purpose: "talent_pool", granted: input.talentPool, at });
  }
  return { ok: true, events };
}

/**
 * What the candidate last said about one purpose.
 *
 * The latest event wins, by its own timestamp rather than by the order rows
 * arrive — a consent history read back from a database has no guaranteed order,
 * and a withdrawal that sorted above a grant would read as permission forever.
 */
export function consentState(
  events: readonly ConsentEvent[],
  purpose: string
): ConsentState {
  let state: ConsentState = "unknown";
  const ordered = [...events].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  for (const event of ordered) {
    if (event.purpose !== purpose) continue;
    state = event.granted ? "granted" : "withdrawn";
  }
  return state;
}

/** Whether a talent-pool grant is in force right now. */
export function consentAllowsPool(events: readonly ConsentEvent[]): boolean {
  return consentState(events, "talent_pool") === "granted";
}

/* -------------------------------------------------------------------------- */
/* Retention windows                                                           */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function parseInstant(value: unknown): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Add whole months without rolling into the next one.
 *
 * The obvious `setUTCMonth` turns 31 January plus a month into 3 March, which
 * would silently shorten or lengthen a retention window depending on the month
 * it was read in. The day is clamped to the target month's last day instead.
 */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/**
 * A setting's number, or the fallback when it is missing or nonsense.
 *
 * A zero is treated as a typo rather than an instruction: "delete immediately"
 * is not a retention policy anybody meant to type, and reading `0` literally
 * would make a mis-saved field erase the whole book on the next tick. The value
 * is clamped at the ceiling for the same reason in the other direction.
 */
export function readMonths(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, MAX_RETENTION_MONTHS);
}

export function readWarningDays(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, MAX_WARNING_DAYS);
}

export type RetentionStatus = "held" | "warning" | "due";

/** When a record's window ends, or null when the date cannot be read. */
export function retentionDueAt(lastActivityAt: unknown, months: number): Date | null {
  const last = parseInstant(lastActivityAt);
  return last ? addMonths(last, months) : null;
}

/** A talent-pool grant's end, measured from the grant rather than activity. */
export function poolDueAt(grantedAt: unknown, months: number): Date | null {
  const granted = parseInstant(grantedAt);
  return granted ? addMonths(granted, months) : null;
}

/**
 * Where a record stands against its window.
 *
 * An unreadable date is `held`: the sweep's job is to erase records whose
 * window provably ran out, and a record it cannot date is not provably stale.
 */
export function retentionStatus(input: {
  lastActivityAt: unknown;
  months: number;
  warningDays: number;
  now: Date | string;
}): RetentionStatus {
  return statusAgainst(
    retentionDueAt(input.lastActivityAt, input.months),
    input.warningDays,
    parseInstant(input.now)
  );
}

/** Where a date stands, which is the one arithmetic both windows share. */
function statusAgainst(
  due: Date | null,
  warningDays: number,
  now: Date | null
): RetentionStatus {
  if (!due || !now) return "held";
  const remaining = due.getTime() - now.getTime();
  if (remaining <= 0) return "due";
  if (remaining <= warningDays * DAY_MS) return "warning";
  return "held";
}

/**
 * Why a record must not be erased yet, or null when nothing blocks it.
 *
 * Being hired is a hold rather than a deletion: the hiring record is the
 * company's own history of employing someone, and erasing it on a timer would
 * rewrite payroll and legal facts. An open assessment or interview is a hold
 * because erasing under a live evaluation would destroy the paper being graded
 * and the person on the other side of it.
 */
export function erasureBlocker(input: {
  stage: unknown;
  openAssessments: number;
  openInterviews: number;
}): string | null {
  if (String(input.stage ?? "").toUpperCase() === "HIRED") {
    return "This person was hired, so the hiring record is kept.";
  }
  if (input.openAssessments > 0) {
    return "An assessment is still open, so the record is held until it closes.";
  }
  if (input.openInterviews > 0) {
    return "An interview is still scheduled, so the record is held until it is recorded.";
  }
  return null;
}

export interface RetentionRow {
  applicationId: string;
  lastActivityAt: string | null;
  stage: string;
  openAssessments: number;
  openInterviews: number;
  /** When the candidate granted the talent pool, if they did. */
  poolGrantedAt?: string | null;
}

export interface RetentionDecision {
  applicationId: string;
  /** ISO, or "" when the row carries no readable activity date. */
  dueAt: string;
  status: RetentionStatus;
  blockedBy: string | null;
}

/**
 * The date a record's window ends, whichever window is the longer one.
 *
 * A talent-pool grant is a promise of its own length, counted from the grant
 * rather than from activity, so a person who last wrote fourteen months ago but
 * granted the pool last month is still inside a pool window and must not fall
 * into the twelve-month one. Once the pool window ends the ordinary window
 * decides again. An unreadable activity date is still no date at all: the grant
 * proves when the promise began, not that nothing happened since.
 */
function effectiveDueAt(
  row: RetentionRow,
  months: number,
  talentPoolMonths: number
): Date | null {
  const ordinary = retentionDueAt(row.lastActivityAt, months);
  if (!ordinary) return null;
  const pool = row.poolGrantedAt ? poolDueAt(row.poolGrantedAt, talentPoolMonths) : null;
  return pool && pool.getTime() > ordinary.getTime() ? pool : ordinary;
}

/**
 * Plan what the sweep would do, one row at a time.
 *
 * Nothing here writes. The caller reads the rows, hands them over, and acts only
 * on `shouldErase`, which is what keeps "is this due?" and "may this run?" one
 * decision instead of two that can disagree.
 *
 * The pool window defaults to the shipped figure when the caller does not name
 * one, so forgetting the argument cannot quietly erase somebody who was promised
 * the longer window.
 */
export function planRetention(
  rows: readonly RetentionRow[],
  options: {
    months: number;
    warningDays: number;
    talentPoolMonths?: number;
    now: Date | string;
  }
): RetentionDecision[] {
  const poolMonths = options.talentPoolMonths ?? TALENT_POOL_DEFAULT_MONTHS;
  const now = parseInstant(options.now);

  return rows.map((row) => {
    const due = effectiveDueAt(row, options.months, poolMonths);
    const status = statusAgainst(due, options.warningDays, now);
    const blockedBy = erasureBlocker(row);
    if (!due) {
      return {
        applicationId: row.applicationId,
        dueAt: "",
        status: "held",
        blockedBy: blockedBy ?? "No activity date on record, so the window cannot be read.",
      };
    }
    return {
      applicationId: row.applicationId,
      dueAt: due.toISOString(),
      status,
      blockedBy,
    };
  });
}

/** The one row of a decision the sweep acts on. */
export function shouldErase(decision: RetentionDecision): boolean {
  return decision.status === "due" && decision.blockedBy === null;
}

export type RetentionAction = "none" | "warn" | "erase";

/**
 * What the nightly sweep does with one row, warning before it ever erases.
 *
 * The public notice promises a stated number of days between the warning letter
 * and the removal. That promise decides the order here: a due record with no
 * warning is warned and left alone, a warning younger than the promised window
 * is left alone, and only a record the candidate has been warned about for at
 * least that long is erased. A held or blocked row is never either.
 */
export function nextRetentionAction(input: {
  decision: RetentionDecision;
  warnedAt: unknown;
  warningDays: number;
  now: Date | string;
}): RetentionAction {
  const { decision } = input;
  if (decision.status === "held" || decision.blockedBy !== null) return "none";

  const now = parseInstant(input.now);
  if (!now) return "none";

  const warned = parseInstant(input.warnedAt);
  if (!warned) return "warn";

  const age = now.getTime() - warned.getTime();
  if (age < input.warningDays * DAY_MS) return "none";
  return decision.status === "due" ? "erase" : "none";
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

export type PrivacyRequestKind = "access" | "erasure";

export const PRIVACY_REQUEST_KINDS: readonly PrivacyRequestKind[] = ["access", "erasure"];

export const PRIVACY_REQUEST_LABELS: Record<PrivacyRequestKind, string> = {
  access: "Copy of my data",
  erasure: "Erase my data",
};

export type PrivacyRequestState =
  | "RECEIVED"
  | "VERIFIED"
  | "APPROVED"
  | "EXECUTED"
  | "DECLINED";

export const PRIVACY_REQUEST_STATES: readonly PrivacyRequestState[] = [
  "RECEIVED",
  "VERIFIED",
  "APPROVED",
  "EXECUTED",
  "DECLINED",
];

const STATE_LABELS: Record<PrivacyRequestState, string> = {
  RECEIVED: "Received",
  VERIFIED: "Verified",
  APPROVED: "Approved",
  EXECUTED: "Executed",
  DECLINED: "Declined",
};

export function privacyStateLabel(state: PrivacyRequestState): string {
  return STATE_LABELS[state] ?? state;
}

export function isPrivacyRequestKind(value: unknown): value is PrivacyRequestKind {
  return typeof value === "string" && (PRIVACY_REQUEST_KINDS as readonly string[]).includes(value);
}

export function isPrivacyRequestState(value: unknown): value is PrivacyRequestState {
  return typeof value === "string" && (PRIVACY_REQUEST_STATES as readonly string[]).includes(value);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type PrivacyRequestPlan =
  | { ok: true; kind: PrivacyRequestKind; email: string; note: string | null }
  | { ok: false; error: string };

/**
 * Read the public form as the request it asks to file.
 *
 * The email is folded because it is how the desk finds the rows: an address
 * typed with a capital letter is the same person. A note is optional and capped,
 * because it is the one free-text field a stranger can write.
 */
export function planPrivacyRequest(input: {
  kind: unknown;
  email: unknown;
  note?: unknown;
}): PrivacyRequestPlan {
  if (!isPrivacyRequestKind(input.kind)) {
    return { ok: false, error: "Choose whether you want a copy of your data or want it erased." };
  }
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "Enter the email address you applied with." };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "That email address is not valid." };

  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > PRIVACY_NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${PRIVACY_NOTE_MAX} characters.` };
  }
  return { ok: true, kind: input.kind, email, note: note || null };
}

export type PrivacyRequestAction = "verify" | "approve" | "decline" | "execute";

const TRANSITIONS: Record<
  PrivacyRequestState,
  Partial<Record<PrivacyRequestAction, PrivacyRequestState>>
> = {
  RECEIVED: { verify: "VERIFIED", decline: "DECLINED" },
  VERIFIED: { approve: "APPROVED", decline: "DECLINED" },
  APPROVED: { execute: "EXECUTED" },
  EXECUTED: {},
  DECLINED: {},
};

/**
 * The state an action leads to, or null when the action is not allowed now.
 *
 * Approval and execution are deliberately two steps: verifying that the person
 * asking is the person on the record is a recruiter's job, while approving and
 * running a destructive erasure is the owner's. A request cannot skip the step
 * between them, and an executed or declined request is terminal.
 */
export function nextRequestState(
  current: PrivacyRequestState,
  action: PrivacyRequestAction
): PrivacyRequestState | null {
  return TRANSITIONS[current]?.[action] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Erasure                                                                     */
/* -------------------------------------------------------------------------- */

/** What an erased record says instead of a name. */
export const ERASED_NAME = "Erased candidate";

/**
 * A per-row address on the reserved `.invalid` domain.
 *
 * The address has to stay unique — other rows and the database's own indexes
 * still expect one — and it must never be deliverable, so nothing can be mailed
 * to a placeholder that looks like a person. It is built from the row id, not
 * from the address it replaces, so nothing of the original survives.
 */
export function erasedEmail(applicationId: string): string {
  const tail = applicationId.replace(/[^0-9a-z]/gi, "").slice(0, 8).toLowerCase();
  return `erased+${tail || "unknown"}@erased.invalid`;
}

/** The columns erasure blanks. Named once so the function and the copy agree. */
export const ERASURE_CLEARED_COLUMNS = [
  "full_name",
  "email",
  "phone",
  "cv_text",
  "cv_file_path",
] as const;

/**
 * The columns that stay. The row, its stage, its score and its dates are the
 * company's record that an application was judged; none of them names a person.
 */
export const ERASURE_KEPT_COLUMNS = [
  "id",
  "tenant_id",
  "job_id",
  "stage",
  "tracking_code",
  "ai_score",
  "created_at",
  "updated_at",
  "stage_changed_at",
] as const;

/** Whether a row has already been through erasure. */
export function isErased(row: { erased_at?: unknown }): boolean {
  return typeof row.erased_at === "string" && row.erased_at.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Who may see or decide                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The desk is read by the people who run the pipeline.
 *
 * A hiring manager does not see it: a request names a person's address and what
 * they asked for, and the desk is not part of a hiring manager's job.
 */
export function canReadPrivacyDesk(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "RECRUITER";
}

/** Checking that the requester is the person on the record is a recruiter's job. */
export function canVerifyPrivacyRequest(role: string): boolean {
  return canReadPrivacyDesk(role);
}

/** Approving or declining is the owner's, because it decides what happens next. */
export function canDecidePrivacyRequest(role: string): boolean {
  return role === "SUPER_ADMIN";
}

/** Running the erasure is the same door as approving it. */
export function canExecuteErasure(role: string): boolean {
  return role === "SUPER_ADMIN";
}
