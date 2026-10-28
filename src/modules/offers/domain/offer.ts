/**
 * The rules an offer has to satisfy, with no database behind them.
 *
 * An offer is not a stage: it is a document with a deadline that a person
 * answers. These rules are shared by the drawer that issues it, the public page
 * that answers it and the proof that pins both, so "expired", "already answered"
 * and "one to sixty days" mean the same thing everywhere.
 *
 * Accepting records the answer and stops there. The stage stays OFFER until a
 * recruiter confirms the hire with a separate click, because an acceptance is a
 * person's word and a hire is a decision the company makes — and a mistyped
 * button on a mailed page should not be able to create an employment record.
 *
 * Pure by design — no `server-only`, no REST client — because the public page,
 * the drawer and the actions all read it.
 */

/** The file that has to be applied before any of this can store a row. */
export const OFFER_MIGRATION = "db/migrations/042_offers.sql";

/**
 * What a screen says when the table is not on the database it is reading.
 *
 * The offer letter itself still exists without this file — a stage move to
 * OFFER mails it — so what a database without the table costs is the answer and
 * the deadline, not the letter. This note says that rather than letting a panel
 * pretend it recorded something.
 *
 * The sentence names the file as a condition and never as this database's state.
 * It prints only behind a read that has already failed, so the failure is what
 * the recruiter is told; on a database that holds the table the sentence is
 * unreachable, and a copy that asserted either polarity there would be a claim
 * the code cannot support.
 */
export const OFFER_SCHEMA_NOTE =
  "The offers table is not on the database this screen is reading — " +
  `${OFFER_MIGRATION} has never run there. An offer can be written but ` +
  "not issued or answered until it has.";

/** The refusal a desk write returns while the table is missing. */
export const OFFER_WRITE_REFUSAL =
  `Offers cannot be issued until ${OFFER_MIGRATION} is applied to this database.`;

/** Where the mailed link opens. */
export const OFFER_NOTICE_PATH = "/offer";

/** The deadline a recruiter gets without typing one. */
export const OFFER_DEFAULT_DAYS = 7;

/** The shortest and longest deadlines the form will accept. */
export const OFFER_MIN_DAYS = 1;
export const OFFER_MAX_DAYS = 60;

/**
 * A deadline in days, or the default when the box held nonsense.
 *
 * Zero and negative numbers are treated as typos rather than instructions: an
 * offer that expires the moment it is sent is not a deadline anybody meant to
 * type. A number above the ceiling is clamped for the same reason in the other
 * direction — a mistyped `600` must not leave a link alive for two years.
 */
export function readOfferDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < OFFER_MIN_DAYS) {
    return OFFER_DEFAULT_DAYS;
  }
  return Math.min(n, OFFER_MAX_DAYS);
}

function parseInstant(value: unknown): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** When an offer sent at `issuedAt` stops accepting an answer. */
export function offerExpiry(issuedAt: unknown, days: number): Date | null {
  const issued = parseInstant(issuedAt);
  if (!issued) return null;
  return new Date(issued.getTime() + days * 86_400_000);
}

export type OfferState = "SENT" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";

export const OFFER_STATES: readonly OfferState[] = [
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
];

const STATE_LABELS: Record<OfferState, string> = {
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
};

export function offerStateLabel(state: OfferState): string {
  return STATE_LABELS[state] ?? state;
}

export function isOfferState(value: unknown): value is OfferState {
  return typeof value === "string" && (OFFER_STATES as readonly string[]).includes(value);
}

/**
 * Where an offer stands right now.
 *
 * An unreadable deadline reads as expired rather than open: the page's job is to
 * let somebody answer an offer that provably still holds, and a date it cannot
 * read does not prove that. An answer already recorded outlives the deadline —
 * an acceptance does not become expired at midnight.
 */
export type OfferStanding = "open" | "expired" | "accepted" | "declined" | "withdrawn";

export function offerStanding(input: {
  state: unknown;
  expiresAt: unknown;
  now: Date | string;
}): OfferStanding {
  const state = String(input.state ?? "").toUpperCase();
  if (state === "ACCEPTED" || state === "DECLINED" || state === "WITHDRAWN") {
    return state.toLowerCase() as OfferStanding;
  }
  if (state !== "SENT") return "expired";

  const expires = parseInstant(input.expiresAt);
  const now = parseInstant(input.now);
  if (!expires || !now) return "expired";
  return expires.getTime() <= now.getTime() ? "expired" : "open";
}

export type OfferDecision = "accept" | "decline";

export const OFFER_DECISIONS: readonly OfferDecision[] = ["accept", "decline"];

export type OfferDecisionPlan =
  | { ok: true; state: "ACCEPTED" | "DECLINED" }
  | { ok: false; error: string };

/**
 * What one of the two buttons does, or why it answers nothing.
 *
 * The sentences are the candidate's own copy: a second click, a withdrawn offer
 * and a missed deadline are three different facts, and telling them apart is the
 * difference between "we have your answer" and "we do not".
 */
export function decideOffer(input: {
  state: unknown;
  expiresAt: unknown;
  decision: unknown;
  now: Date | string;
}): OfferDecisionPlan {
  if (input.decision !== "accept" && input.decision !== "decline") {
    return { ok: false, error: "Choose whether to accept or decline the offer." };
  }

  if (!isOfferState(input.state)) {
    return { ok: false, error: "This offer cannot be answered. Please contact us." };
  }
  if (input.state === "WITHDRAWN") {
    return {
      ok: false,
      error:
        "This offer has been withdrawn. Contact us if you would like to be considered again.",
    };
  }
  if (input.state !== "SENT") {
    return { ok: false, error: "This offer has already been answered." };
  }
  if (offerStanding({ state: input.state, expiresAt: input.expiresAt, now: input.now }) === "expired") {
    return {
      ok: false,
      error: "This offer has expired. Contact us if you would still like to be considered.",
    };
  }

  return { ok: true, state: input.decision === "accept" ? "ACCEPTED" : "DECLINED" };
}

/**
 * Whether a role may be offered at this stage.
 *
 * A rejected or hired person is refused: one is a decision already made, the
 * other is a fact already recorded, and neither is reopened by writing an offer
 * underneath it. Every stage before OFFER can be offered — issuing an offer is
 * how a recruiter moves somebody there from the drawer.
 */
const ISSUABLE_STAGES = ["NEW", "AI_SCREENING", "ASSESSMENT", "INTERVIEW", "OFFER"];

export function canIssueOffer(stage: unknown): boolean {
  return ISSUABLE_STAGES.includes(String(stage ?? "").toUpperCase());
}
