/**
 * The agenda's vocabulary: how far it reads, what each range means, and which
 * bookings still owe an outcome.
 *
 * Lives outside the server-action module so the page render, the client view and
 * the app bar's alert count slice one window instead of three. The row that says
 * "Interviews still on the calendar" used to count every panel from now onwards
 * with no horizon while the agenda read 90 days and displayed at most 30 — the
 * number and the list it linked to were different sets, and both sides now ask
 * this file for the boundary.
 */

const DAY_MS = 86_400_000;

/** Days back from now the agenda reads. */
export const AGENDA_PAST_DAYS = 30;

/** Days forward from now the agenda reads — its horizon, and the widest range on offer. */
export const AGENDA_FUTURE_DAYS = 90;

/** The status a panel holds until a recruiter records what happened. */
export const PENDING_INTERVIEW_STATUS = "SCHEDULED";

/**
 * The embed that makes a head count mean "and its candidate is readable".
 *
 * The agenda drops a panel whose `applications` join comes back empty, so a count
 * of `interview_schedules` alone could claim a row the list refuses to show.
 * `!inner` asks the database for the same requirement, the way the grading alert
 * counts attempts.
 */
export const AGENDA_APPLICATION_EMBED = "applications!inner(id)";

/** `interview_status`, in the order the status rail offers them. */
export const INTERVIEW_STATUSES = ["SCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;

export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export type AgendaRange = "today" | "week" | "month" | "upcoming" | "past";

export interface AgendaRangeOption {
  id: AgendaRange;
  /** Days from this instant the range reaches; negative looks back, `null` is today's calendar day. */
  days: number | null;
  label: string;
}

export const AGENDA_RANGES: readonly AgendaRangeOption[] = [
  { id: "today", days: null, label: "Today" },
  { id: "week", days: 7, label: "Next 7 days" },
  { id: "month", days: 30, label: "Next 30 days" },
  { id: "upcoming", days: AGENDA_FUTURE_DAYS, label: `Next ${AGENDA_FUTURE_DAYS} days` },
  { id: "past", days: -AGENDA_PAST_DAYS, label: `Last ${AGENDA_PAST_DAYS} days` },
];

/** A range the agenda has never heard of narrows nothing rather than emptying the view. */
export function isAgendaRange(value: unknown): AgendaRange | null {
  return typeof value === "string" && AGENDA_RANGES.some((option) => option.id === value)
    ? (value as AgendaRange)
    : null;
}

/** The same guard for `?status=`: only a real `interview_status` filters. */
export function isInterviewStatus(value: unknown): InterviewStatus | null {
  return typeof value === "string" && (INTERVIEW_STATUSES as readonly string[]).includes(value)
    ? (value as InterviewStatus)
    : null;
}

/** The label a chip carries, for prose that has to name the range the recruiter is in. */
export function agendaRangeLabel(range: AgendaRange): string {
  return AGENDA_RANGES.find((option) => option.id === range)?.label ?? range;
}

/**
 * The absolute window a read covers.
 *
 * The server fetches this whole span and the browser slices it, so a range chip
 * costs no round trip — which is only honest while the widest chip stays inside
 * the span, the reason `upcoming` is the horizon itself rather than an arbitrary
 * longer number.
 */
export function agendaWindow(
  now = new Date(),
  pastDays = AGENDA_PAST_DAYS,
  futureDays = AGENDA_FUTURE_DAYS
): { now: string; past: string; future: string } {
  return {
    now: now.toISOString(),
    past: new Date(now.getTime() - pastDays * DAY_MS).toISOString(),
    future: new Date(now.getTime() + futureDays * DAY_MS).toISOString(),
  };
}

/**
 * Whether a booking falls in `range`, measured against absolute instants.
 *
 * Forward ranges start at *now*, not at midnight, because that is the predicate
 * the alert count sends to the database (`scheduled_at >= now`). A slice that
 * started at the day boundary would show panels the count never claimed; a slice
 * that stopped at midnight would hide the ones booked for later today. "Today" is
 * the exception — it is the organisation's calendar day, so its caller answers
 * for it with `sameDay`.
 */
export function inAgendaRange(
  scheduledMs: number,
  range: AgendaRange,
  nowMs: number,
  sameDay: boolean
): boolean {
  if (range === "today") return sameDay;
  const days = AGENDA_RANGES.find((option) => option.id === range)?.days ?? 0;
  return days < 0
    ? scheduledMs < nowMs && scheduledMs >= nowMs + days * DAY_MS
    : scheduledMs >= nowMs && scheduledMs <= nowMs + days * DAY_MS;
}
