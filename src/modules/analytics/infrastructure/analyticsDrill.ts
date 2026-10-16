/**
 * The rows behind one Analytics figure.
 *
 * Every number on the Analytics page answers a question, and the next question
 * is always "which ones?". This reads the same rows the page was built from —
 * same window, same row budget, same predicates, straight out of
 * `readAnalyticsRows` — so a popup cannot name a total its card does not show.
 * A second implementation of "what counts as opened" is how a figure and its
 * list drift apart, so the predicates come from the report domain instead of
 * being re-written here.
 *
 * A scope arrives from a clicked client component, which makes this a public
 * endpoint: every field is shape-checked before it filters anything, and a
 * scope that is not one of the page's own figures is refused rather than
 * treated as "everything".
 */

import "server-only";

import { LIMITS, readAnalyticsRows, type AnalyticsRows } from "./reportReader";
import {
  SCORE_BANDS,
  attemptGraded,
  attemptOpened,
  attemptPercent,
  attemptScored,
  attemptSubmitted,
  bandOf,
  interviewDecided,
  interviewUpcoming,
  messageRead,
  prospectConverted,
  type AnalyticsWindow,
  type AttemptRow,
  type InterviewRow,
  type LogRow,
  type ProspectRow,
} from "@/modules/analytics/domain/report";
import { dayKeyInZone } from "@/lib/timezone";

/** Rows one popup lists — enough to scan, small enough to stay a panel. */
const DRILL_LIMIT = 250;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** A value that came from a database enum column: upper snake case, bounded. */
const TOKEN = /^[A-Z][A-Z0-9_]{0,31}$/;

export interface DayRange {
  fromKey: string;
  toKey: string;
}

export type AttemptPredicate =
  | "issued"
  | "opened"
  | "not_opened"
  | "submitted"
  | "graded"
  | "scored"
  | "invite_lag"
  | "time_on_test"
  | "status"
  | "band";

export type ProspectPredicate = "pool" | "stage" | "converted" | "messaged";

export type MessageState = "sent" | "delivered" | "undelivered" | "read";

/** The channel every message read is compared against; `ALL` lists across them. */
export const ANY_CHANNEL = "ALL";

export type InterviewPredicate = "booked" | "upcoming" | "decided" | "lead" | "status" | "interviewer";

/** Which figure was clicked, and which bucket of it. */
export type AnalyticsDrillScope =
  | {
      table: "attempts";
      predicate: AttemptPredicate;
      status?: string;
      band?: string;
      range?: DayRange;
    }
  | { table: "prospects"; predicate: ProspectPredicate; stage?: string; range?: DayRange }
  | { table: "messages"; channel: string; state: MessageState; range?: DayRange }
  | {
      table: "interviews";
      predicate: InterviewPredicate;
      status?: string;
      interviewer?: string;
      range?: DayRange;
    };

const ATTEMPT_PREDICATES: AttemptPredicate[] = [
  "issued",
  "opened",
  "not_opened",
  "submitted",
  "graded",
  "scored",
  "invite_lag",
  "time_on_test",
  "status",
  "band",
];
const PROSPECT_PREDICATES: ProspectPredicate[] = ["pool", "stage", "converted", "messaged"];
const MESSAGE_STATES: MessageState[] = ["sent", "delivered", "undelivered", "read"];
const INTERVIEW_PREDICATES: InterviewPredicate[] = [
  "booked",
  "upcoming",
  "decided",
  "lead",
  "status",
  "interviewer",
];

/* --------------------------------------------------------------- shapes --- */

export interface DrillAttempt {
  id: string;
  application_id: string | null;
  candidate: string;
  opening: string | null;
  suite: string | null;
  status: string;
  invited_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  /** Null when unscored — and always null when scores are masked for this account. */
  score_percent: number | null;
  minutes_on_test: number | null;
  invite_to_open_hours: number | null;
}

export interface DrillProspect {
  id: string;
  candidate: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  origin: string;
  stage: string;
  added_at: string | null;
  first_message_at: string | null;
  last_contacted_at: string | null;
  messages: number;
  converted: boolean;
  application_id: string | null;
}

export interface DrillMessage {
  id: string;
  channel: string;
  direction: string;
  recipient: string;
  subject: string | null;
  delivered: boolean;
  read_at: string | null;
  error_message: string | null;
  sent_at: string | null;
  candidate: string | null;
  application_id: string | null;
  prospect_id: string | null;
}

export interface DrillPanel {
  id: string;
  candidate: string | null;
  opening: string | null;
  interviewer: string | null;
  status: string;
  scheduled_at: string | null;
  booked_at: string | null;
  duration_minutes: number | null;
  lead_days: number | null;
  meeting_link: string | null;
  application_id: string | null;
}

export interface DrillHeading {
  eyebrow: string;
  title: string;
  subtitle: string;
}

interface DrillBody {
  window: AnalyticsWindow;
  heading: DrillHeading;
  total: number;
  shown: number;
  /** Why this list is not the whole table — a read that ran out of budget. */
  note: string | null;
  read_at: string;
}

export type AnalyticsDrillResult =
  | (DrillBody & { ok: true; kind: "attempts"; rows: DrillAttempt[] })
  | (DrillBody & { ok: true; kind: "prospects"; rows: DrillProspect[] })
  | (DrillBody & { ok: true; kind: "messages"; rows: DrillMessage[] })
  | (DrillBody & { ok: true; kind: "interviews"; rows: DrillPanel[] })
  | { ok: false; error: string };

/* ------------------------------------------------------------ validation -- */

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function token(value: unknown): string | null {
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

function rangeOf(value: unknown): DayRange | null {
  const range = record(value);
  if (!range) return null;
  const { fromKey, toKey } = range;
  if (typeof fromKey !== "string" || typeof toKey !== "string") return null;
  if (!DAY_KEY.test(fromKey) || !DAY_KEY.test(toKey)) return null;
  return fromKey <= toKey ? { fromKey, toKey } : null;
}

/**
 * A client-supplied scope, checked against the figures this page draws.
 *
 * Returns null for anything else. There is no "everything" fallback: an unknown
 * scope must not quietly widen into a read of a whole table.
 */
export function parseDrillScope(value: unknown): AnalyticsDrillScope | null {
  const input = record(value);
  if (!input) return null;

  if (input.range !== undefined) {
    const checked = rangeOf(input.range);
    if (!checked) return null;
    return withScope(input, checked);
  }
  return withScope(input);
}

function withScope(input: Record<string, unknown>, range?: DayRange): AnalyticsDrillScope | null {
  const tail = range ? { range } : {};

  if (input.table === "messages") {
    const channel = token(input.channel);
    const state = MESSAGE_STATES.includes(input.state as MessageState)
      ? (input.state as MessageState)
      : null;
    return channel && state ? { table: "messages", channel, state, ...tail } : null;
  }

  if (input.table === "attempts") {
    const predicate = ATTEMPT_PREDICATES.includes(input.predicate as AttemptPredicate)
      ? (input.predicate as AttemptPredicate)
      : null;
    if (!predicate) return null;
    if (predicate === "status") {
      const status = token(input.status);
      return status ? { table: "attempts", predicate, status, ...tail } : null;
    }
    if (predicate === "band") {
      const band = typeof input.band === "string" ? input.band : null;
      return band && SCORE_BANDS.some((option) => option.label === band)
        ? { table: "attempts", predicate, band, ...tail }
        : null;
    }
    return { table: "attempts", predicate, ...tail };
  }

  if (input.table === "prospects") {
    const predicate = PROSPECT_PREDICATES.includes(input.predicate as ProspectPredicate)
      ? (input.predicate as ProspectPredicate)
      : null;
    if (!predicate) return null;
    if (predicate === "stage") {
      const stage = token(input.stage);
      return stage ? { table: "prospects", predicate, stage, ...tail } : null;
    }
    return { table: "prospects", predicate, ...tail };
  }

  if (input.table === "interviews") {
    const predicate = INTERVIEW_PREDICATES.includes(input.predicate as InterviewPredicate)
      ? (input.predicate as InterviewPredicate)
      : null;
    if (!predicate) return null;
    if (predicate === "status") {
      const status = token(input.status);
      return status ? { table: "interviews", predicate, status, ...tail } : null;
    }
    if (predicate === "interviewer") {
      const name = typeof input.interviewer === "string" ? input.interviewer.trim() : "";
      return name.length > 0 && name.length <= 120
        ? { table: "interviews", predicate, interviewer: name, ...tail }
        : null;
    }
    return { table: "interviews", predicate, ...tail };
  }

  return null;
}

/* ----------------------------------------------------------------- maths -- */

function hoursBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 3_600_000;
}

function minutesBetween(from: string | null, to: string | null): number | null {
  const hours = hoursBetween(from, to);
  return hours === null ? null : hours * 60;
}

function daysBetween(from: string | null, to: string | null): number | null {
  const hours = hoursBetween(from, to);
  return hours === null ? null : hours / 24;
}

function round(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

const plural = (count: number, word: string): string => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

/** A trend bucket arrives as calendar days in the organisation zone. */
function inRange(row: { created_at: string | null }, range: DayRange | undefined, timeZone: string): boolean {
  if (!range) return true;
  if (!row.created_at) return false;
  const day = dayKeyInZone(row.created_at, timeZone);
  return DAY_KEY.test(day) && day >= range.fromKey && day <= range.toKey;
}

function rangeWords(range: DayRange | undefined): string {
  if (!range) return "";
  return range.fromKey === range.toKey
    ? ` between ${range.fromKey}`
    : ` between ${range.fromKey} and ${range.toKey}`;
}

/** Printed whenever the report's read ran out of budget, so a floor is never mistaken for a total. */
function floorNote(floored: boolean, limit: number, what: string): string | null {
  return floored
    ? `Only the newest ${limit.toLocaleString()} ${what} in this window were read, so both this list and the figure it came from are floors, not totals.`
    : null;
}

/* ------------------------------------------------------------------ read -- */

export async function readAnalyticsDrill(
  scope: AnalyticsDrillScope,
  window: AnalyticsWindow
): Promise<AnalyticsDrillResult> {
  const read = await readAnalyticsRows(window);
  if (!read.rows) return { ok: false, error: read.error };

  const rows = read.rows;
  const scopeLabel = rows.context.scope;

  if (scope.table === "attempts") return attemptsDrill(scope, window, rows, scopeLabel);
  if (scope.table === "prospects") return prospectsDrill(scope, window, rows, scopeLabel);
  if (scope.table === "messages") return messagesDrill(scope, window, rows, scopeLabel);
  return interviewsDrill(scope, window, rows, scopeLabel);
}

/* ------------------------------------------------------------- attempts -- */

function attemptsDrill(
  scope: Extract<AnalyticsDrillScope, { table: "attempts" }>,
  window: AnalyticsWindow,
  rows: AnalyticsRows,
  scopeLabel: string
): AnalyticsDrillResult {
  const { context, floored } = rows;

  const keep = (row: AttemptRow): boolean => {
    switch (scope.predicate) {
      case "issued":
        return true;
      case "opened":
      case "invite_lag":
        return attemptOpened(row);
      case "not_opened":
        return !attemptOpened(row);
      case "submitted":
        return attemptSubmitted(row);
      case "graded":
        return attemptGraded(row);
      case "scored":
        return attemptScored(row);
      case "time_on_test":
        return attemptOpened(row) && attemptSubmitted(row);
      case "status":
        return row.status === scope.status;
      case "band":
        return attemptScored(row) && bandOf(attemptPercent(row)) === scope.band;
    }
  };

  const inScope = rows.attempts.filter((row) => inRange(row, scope.range, context.timeZone));
  const matched = inScope.filter(keep);

  const titles: Record<AttemptPredicate, string> = {
    issued: "Invites issued",
    opened: "Tests that were opened",
    not_opened: "Invites nobody opened",
    submitted: "Tests submitted",
    graded: "Tests the engine scored",
    scored: "Attempts carrying a score",
    invite_lag: "Hours from invite to first question",
    time_on_test: "Minutes spent on the test",
    status: (scope.status ?? "Attempts").replace(/_/g, " "),
    band: `Scores in the ${scope.band ?? ""} band`,
  };

  const lag = (row: AttemptRow): number => hoursBetween(row.created_at, row.started_at) ?? -1;
  const sitting = (row: AttemptRow): number => hoursBetween(row.started_at, row.submitted_at) ?? -1;

  const ordered = [...matched].sort((a, b) => {
    if (scope.predicate === "invite_lag") return lag(b) - lag(a);
    if (scope.predicate === "time_on_test") return sitting(b) - sitting(a);
    if (scope.predicate === "band" || scope.predicate === "scored")
      return attemptScored(a) && attemptScored(b) ? attemptPercent(b) - attemptPercent(a) : 0;
    return 0;
  });

  const list: DrillAttempt[] = ordered.slice(0, DRILL_LIMIT).map((row) => ({
    id: row.id,
    application_id: row.application_id,
    candidate: row.candidate,
    opening: row.opening,
    suite: row.suite,
    status: row.status || "UNKNOWN",
    invited_at: row.created_at,
    opened_at: row.started_at,
    submitted_at: row.submitted_at,
    score_percent: attemptScored(row) ? round(attemptPercent(row)) : null,
    minutes_on_test: round(minutesBetween(row.started_at, row.submitted_at)),
    invite_to_open_hours: round(lag(row)),
  }));

  return {
    ok: true,
    kind: "attempts",
    window,
    heading: {
      eyebrow: `Assessments · ${scopeLabel}`,
      title: titles[scope.predicate],
      subtitle: `${plural(matched.length, "attempt")} of ${plural(inScope.length, "invite")} read${rangeWords(scope.range)}`,
    },
    rows: list,
    total: matched.length,
    shown: list.length,
    note:
      floorNote(floored.attempts, LIMITS.attempts, "assessment attempts") ??
      (context.scoresHidden
        ? "Test scores are withheld from your account, so no score is listed here either."
        : scope.predicate === "graded"
          ? "Graded is the status the attempt carries now; a re-grade overwrites the earlier score."
          : scope.predicate === "scored"
            ? "A score is listed only when the attempt was graded against a suite that sets a maximum, so every percentage is of that test's own total."
            : scope.predicate === "time_on_test"
            ? "Minutes run from the first question opened to the submit, so a candidate who starts, leaves and returns shows the whole span."
            : null),
    read_at: context.generatedAt,
  };
}

/* ------------------------------------------------------------ prospects -- */

function prospectsDrill(
  scope: Extract<AnalyticsDrillScope, { table: "prospects" }>,
  window: AnalyticsWindow,
  rows: AnalyticsRows,
  scopeLabel: string
): AnalyticsDrillResult {
  const { context, floored } = rows;

  const firstTouch = new Map<string, string>();
  const tallies = new Map<string, number>();
  for (const log of rows.logs) {
    if (!log.prospect_id || !log.created_at) continue;
    tallies.set(log.prospect_id, (tallies.get(log.prospect_id) ?? 0) + 1);
    const known = firstTouch.get(log.prospect_id);
    if (!known || log.created_at < known) firstTouch.set(log.prospect_id, log.created_at);
  }

  const keep = (row: ProspectRow): boolean => {
    switch (scope.predicate) {
      case "pool":
        return true;
      case "stage":
        return row.stage === scope.stage;
      case "converted":
        return prospectConverted(row);
      case "messaged":
        return firstTouch.has(row.id);
    }
  };

  const inScope = rows.prospects.filter((row) => inRange(row, scope.range, context.timeZone));
  const matched = inScope.filter(keep);

  const titles: Record<ProspectPredicate, string> = {
    pool: "Prospects in the pool",
    stage: (scope.stage ?? "Prospects").replace(/_/g, " "),
    converted: "Prospects that became applications",
    messaged: "Prospects with a logged message",
  };

  const list: DrillProspect[] = matched.slice(0, DRILL_LIMIT).map((row) => ({
    id: row.id,
    candidate: row.candidate,
    headline: row.headline,
    company: row.company,
    location: row.location,
    email: row.email,
    origin: row.origin,
    stage: row.stage,
    added_at: row.created_at,
    first_message_at: firstTouch.get(row.id) ?? null,
    last_contacted_at: row.last_contacted_at,
    messages: tallies.get(row.id) ?? 0,
    converted: prospectConverted(row),
    application_id: row.application_id,
  }));

  return {
    ok: true,
    kind: "prospects",
    window,
    heading: {
      eyebrow: `Sourcing · ${scopeLabel}`,
      title: titles[scope.predicate],
      subtitle: `${plural(matched.length, "prospect")} of ${plural(inScope.length, "prospect")} added${rangeWords(scope.range)}`,
    },
    rows: list,
    total: matched.length,
    shown: list.length,
    note:
      floorNote(floored.prospects, LIMITS.prospects, "sourced prospects") ??
      (scope.predicate === "converted"
        ? "A prospect counts as converted when it reached the CONVERTED stage or an application was made from it."
        : scope.predicate === "messaged"
          ? "Message counts come from the same log read as the figures, so a prospect outside the newest messages shows fewer than it was sent."
          : null),
    read_at: context.generatedAt,
  };
}

/* -------------------------------------------------------------- messages -- */

function messagesDrill(
  scope: Extract<AnalyticsDrillScope, { table: "messages" }>,
  window: AnalyticsWindow,
  rows: AnalyticsRows,
  scopeLabel: string
): AnalyticsDrillResult {
  const { context, floored } = rows;
  const everyChannel = scope.channel === ANY_CHANNEL;

  // The card prints a dash for a channel that keeps no read marker, so a
  // request for that list is answered with the reason, never with an empty panel.
  if (scope.state === "read" && !everyChannel && scope.channel !== "IN_APP") {
    return {
      ok: false,
      error: `${scope.channel.replace(/_/g, " ")} reports no read signal to this portal, which is why the card prints a dash.`,
    };
  }

  const inScope = rows.logs.filter((row) => inRange(row, scope.range, context.timeZone));

  const keep = (row: LogRow): boolean => {
    if (!everyChannel && row.channel !== scope.channel) return false;
    switch (scope.state) {
      case "sent":
        return true;
      case "delivered":
        return row.delivered;
      case "undelivered":
        return !row.delivered;
      case "read":
        return messageRead(row);
    }
  };

  const matched = inScope.filter(keep);
  const stateWords: Record<MessageState, string> = {
    sent: "sent",
    delivered: "delivered",
    undelivered: "not delivered",
    read: "read",
  };

  const list: DrillMessage[] = matched.slice(0, DRILL_LIMIT).map((row) => ({
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    recipient: row.recipient,
    subject: row.subject,
    delivered: row.delivered,
    read_at: row.read_at,
    error_message: row.error_message,
    sent_at: row.created_at,
    candidate: row.candidate,
    application_id: row.application_id,
    prospect_id: row.prospect_id,
  }));

  return {
    ok: true,
    kind: "messages",
    window,
    heading: {
      eyebrow: `Candidate messages · ${scopeLabel}`,
      title: `${
        everyChannel ? "Every channel" : scope.channel.replace(/_/g, " ")
      } · ${stateWords[scope.state]}`,
      subtitle: `${plural(matched.length, "message")} of ${plural(inScope.length, "message")} logged${rangeWords(scope.range)}`,
    },
    rows: list,
    total: matched.length,
    shown: list.length,
    note:
      floorNote(floored.logs, LIMITS.logs, "messages") ??
      (scope.state === "read"
        ? "Only the portal notice stores a read marker, so a WhatsApp or email row can never appear in this list — that is why the card prints a dash for those channels."
        : scope.state === "delivered" || scope.state === "undelivered"
          ? "Delivered is the state the row holds now, not a record of every attempt: a message that failed twice then went through reads as delivered."
          : null),
    read_at: context.generatedAt,
  };
}

/* ------------------------------------------------------------ interviews -- */

function interviewsDrill(
  scope: Extract<AnalyticsDrillScope, { table: "interviews" }>,
  window: AnalyticsWindow,
  rows: AnalyticsRows,
  scopeLabel: string
): AnalyticsDrillResult {
  const { context, floored } = rows;
  const now = Date.parse(context.generatedAt) || Date.now();

  const keep = (row: InterviewRow): boolean => {
    switch (scope.predicate) {
      case "booked":
        return true;
      case "upcoming":
        return interviewUpcoming(row, now);
      case "decided":
        return interviewDecided(row);
      case "lead":
        return daysBetween(row.application_created_at, row.scheduled_at) !== null;
      case "status":
        return row.status === scope.status;
      case "interviewer":
        return row.interviewer === scope.interviewer;
    }
  };

  const inScope = rows.interviews.filter((row) => inRange(row, scope.range, context.timeZone));
  const matched = inScope.filter(keep);

  const titles: Record<InterviewPredicate, string> = {
    booked: "Panels booked",
    upcoming: "Panels still to come",
    decided: "Panels that ended in a decision",
    lead: "Days from application to the slot",
    status: (scope.status ?? "Panels").replace(/_/g, " "),
    interviewer: scope.interviewer ?? "Panels by interviewer",
  };

  const ordered = [...matched].sort((a, b) => {
    if (scope.predicate === "upcoming")
      return String(a.scheduled_at ?? "").localeCompare(String(b.scheduled_at ?? ""));
    if (scope.predicate === "lead")
      return (
        (daysBetween(b.application_created_at, b.scheduled_at) ?? -1) -
        (daysBetween(a.application_created_at, a.scheduled_at) ?? -1)
      );
    return 0;
  });

  const list: DrillPanel[] = ordered.slice(0, DRILL_LIMIT).map((row) => ({
    id: row.id,
    candidate: row.candidate,
    opening: row.opening,
    interviewer: row.interviewer,
    status: row.status || "UNKNOWN",
    scheduled_at: row.scheduled_at,
    booked_at: row.created_at,
    duration_minutes: row.duration_minutes,
    lead_days: round(daysBetween(row.application_created_at, row.scheduled_at)),
    meeting_link: row.meeting_link,
    application_id: row.application_id,
  }));

  return {
    ok: true,
    kind: "interviews",
    window,
    heading: {
      eyebrow: `Interview panels · ${scopeLabel}`,
      title: titles[scope.predicate],
      subtitle: `${plural(matched.length, "panel")} of ${plural(inScope.length, "panel")} booked${rangeWords(scope.range)}`,
    },
    rows: list,
    total: matched.length,
    shown: list.length,
    note:
      floorNote(floored.interviews, LIMITS.interviews, "interview panels") ??
      (scope.predicate === "interviewer"
        ? "Only panels booked inside the portal name an interviewer; a call arranged straight in a calendar is invisible here."
        : scope.predicate === "upcoming"
          ? "Upcoming means still marked scheduled with a slot in the future. An outcome is only ever what a recruiter wrote back."
          : scope.predicate === "lead"
            ? "Lead days runs from the application to the slot, not from the invite."
            : null),
    read_at: context.generatedAt,
  };
}
