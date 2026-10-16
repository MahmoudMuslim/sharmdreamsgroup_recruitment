/**
 * Hiring analytics computed from rows the portal already stores.
 *
 * Pure by design — no database and no `server-only` — so the numbers on the
 * page and the numbers in the CSV export come from one implementation, and so
 * a figure can be traced back to the column it was read from without a running
 * server.
 *
 * What is deliberately absent matters as much as what is present. A pipeline
 * move is stored by overwriting `applications.stage`, and only `HIRED` keeps a
 * timestamp, so this module contains no per-stage duration, no stage
 * conversion over time, and no cohort funnel: the data to compute them honestly
 * does not exist, and an analytics page that drew the shape anyway would be the
 * most convincing lie in the portal.
 */

import { dayKeyInZone } from "@/lib/timezone";

export type AnalyticsWindow = "30" | "90" | "365" | "all";

export const ANALYTICS_WINDOWS: {
  key: AnalyticsWindow;
  label: string;
  days: number | null;
}[] = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
  { key: "all", label: "All time", days: null },
];

/** Start of the window as an ISO instant, or null for "All time". */
export function windowCutoff(window: AnalyticsWindow, now: Date): string | null {
  const days = ANALYTICS_WINDOWS.find((option) => option.key === window)?.days ?? null;
  return days === null ? null : new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function windowLabel(window: AnalyticsWindow): string {
  return ANALYTICS_WINDOWS.find((option) => option.key === window)?.label ?? window;
}

/** A counted label on a card — a status, a stage — that the page can click. */
export interface CountBucket {
  label: string;
  count: number;
}

/** How wide one bar on a trend strip is. */
export type TrendGrain = "day" | "week" | "month";

/**
 * One bar on a card's trend strip.
 *
 * `fromKey`/`toKey` are inclusive calendar days in the organisation zone, which
 * is what makes a bar clickable: a popup can filter the same rows by the very
 * bucket the bar was counted from, so clicking the bar and counting it by hand
 * cannot give different answers.
 */
export interface TrendBucket {
  key: string;
  label: string;
  fromKey: string;
  toKey: string;
  count: number;
}

/** A 30-day window reads day by day; a year is only legible month by month. */
export function trendGrain(window: AnalyticsWindow): TrendGrain {
  return window === "30" ? "day" : window === "90" ? "week" : "month";
}

/**
 * One `candidate_attempts` row.
 *
 * The timing and status columns are what the aggregates count; the name,
 * opening and suite are only used when a figure on the page is clicked and the
 * rows behind it are listed. They ride along on the same read because a popup
 * must be built from exactly the rows the figure was counted from — a second
 * query with its own budget is how a list starts disagreeing with its number.
 */
export interface AttemptRow {
  id: string;
  application_id: string | null;
  candidate: string;
  opening: string | null;
  suite: string | null;
  status: string;
  created_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  total_score: number | null;
  max_score: number | null;
}

/** One `sourced_prospects` row. `application_id` is the conversion link. */
export interface ProspectRow {
  id: string;
  candidate: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  origin: string;
  stage: string;
  created_at: string | null;
  last_contacted_at: string | null;
  application_id: string | null;
}

/** One `communication_logs` row. `delivered` is current state, not attempt history. */
export interface LogRow {
  id: string;
  channel: string;
  direction: string;
  recipient: string;
  subject: string | null;
  delivered: boolean;
  read_at: string | null;
  error_message: string | null;
  created_at: string | null;
  prospect_id: string | null;
  application_id: string | null;
  candidate: string | null;
}

/** One `interview_schedules` row with the owning application's start date. */
export interface InterviewRow {
  id: string;
  status: string;
  scheduled_at: string | null;
  created_at: string | null;
  interviewer: string | null;
  candidate: string | null;
  opening: string | null;
  application_id: string | null;
  duration_minutes: number | null;
  meeting_link: string | null;
  application_created_at: string | null;
}

/* ------------------------------------------------------------- predicates -- */

/**
 * What each figure counts, in one place.
 *
 * `buildAnalyticsReport` and the drill-down popups both run these, so the rows
 * a click lists are the rows the number on the screen added up. Writing a
 * second copy of "opened means it has a start time" in the popup is how a
 * figure and its list drift apart.
 */
export const attemptOpened = (row: AttemptRow): boolean => Boolean(row.started_at);
export const attemptSubmitted = (row: AttemptRow): boolean => Boolean(row.submitted_at);
export const attemptGraded = (row: AttemptRow): boolean => row.status === "GRADED";
export const attemptNotStarted = (row: AttemptRow): boolean => row.status === "NOT_STARTED";
export const attemptInProgress = (row: AttemptRow): boolean => row.status === "IN_PROGRESS";
export const attemptExpired = (row: AttemptRow): boolean => row.status === "EXPIRED";

/** An attempt whose score can be compared to its own maximum. */
export const attemptScored = (row: AttemptRow): boolean =>
  row.total_score !== null && row.max_score !== null && Number(row.max_score) > 0;

/** A graded result as a share of the suite it was sat against. */
export const attemptPercent = (row: AttemptRow): number =>
  (Number(row.total_score) / Number(row.max_score)) * 100;

export const prospectConverted = (row: ProspectRow): boolean =>
  row.stage === "CONVERTED" || row.application_id !== null;

/** Only the portal notice stores a read marker, so no other channel has one. */
export const messageRead = (row: LogRow): boolean =>
  row.channel === "IN_APP" && Boolean(row.read_at);

/**
 * A portal notice is written, not delivered.
 *
 * Every email and campaign also mirrors into the inbox, and that copy is always
 * there — so counting it as a delivery would lift the figure while the relay is
 * refusing messages. Only a transport can fail, so only a transport is measured.
 */
export const measuresDelivery = (channel: string): boolean => channel !== "IN_APP";

export const messageDelivered = (row: LogRow): boolean =>
  measuresDelivery(row.channel) && row.delivered;

export const messageUndelivered = (row: LogRow): boolean =>
  measuresDelivery(row.channel) && !row.delivered;

export const interviewUpcoming = (row: InterviewRow, now: number): boolean =>
  row.status === "SCHEDULED" && row.scheduled_at !== null && Date.parse(row.scheduled_at) > now;

/** Panels that ended with a decision about a person attending. */
export const interviewDecided = (row: InterviewRow): boolean =>
  row.status === "COMPLETED" || row.status === "NO_SHOW";

export interface AnalyticsInput {
  window: AnalyticsWindow;
  timeZone: string;
  generatedAt: string;
  attempts: AttemptRow[];
  prospects: ProspectRow[];
  logs: LogRow[];
  interviews: InterviewRow[];
  /** False when a read hit its row budget, so every count is a floor. */
  complete: boolean;
  /** Set when `security.mask_scores_for_reviewers` withholds scores from this user. */
  scoresHidden: boolean;
  /**
   * Every reason a figure on the page is not the whole picture — a read that
   * hit its row budget, a table that could not be fetched, scores that were
   * withheld. Rendered, not swallowed, because a silent shortfall in an
   * analytics page reads exactly like a real number.
   */
  limitations: string[];
}

export interface AnalyticsReport {
  window: AnalyticsWindow;
  windowLabel: string;
  timeZone: string;
  generatedAt: string;
  complete: boolean;
  scoresHidden: boolean;
  limitations: string[];
  assessments: {
    issued: number;
    opened: number;
    submitted: number;
    graded: number;
    inProgress: number;
    notStarted: number;
    expired: number;
    openRate: number | null;
    finishRate: number | null;
    medianInviteToOpenHours: number | null;
    medianTimeOnTestMinutes: number | null;
    scoredAttempts: number;
    medianScorePercent: number | null;
    scoreBands: { label: string; count: number }[];
    /** Every status the rows actually carry, including the ones no badge names. */
    statusMix: CountBucket[];
    /** Invites issued per bucket, oldest first. */
    trend: TrendBucket[];
    trendGrain: TrendGrain;
  };
  sourcing: {
    total: number;
    contacted: number;
    replied: number;
    interviewing: number;
    converted: number;
    passed: number;
    replyRate: number | null;
    conversionRate: number | null;
    medianHoursToFirstContact: number | null;
    prospectsWithMessages: number;
    stages: CountBucket[];
    trend: TrendBucket[];
    trendGrain: TrendGrain;
  };
  messages: {
    scanned: number;
    delivered: number;
    undelivered: number;
    read: number;
    byChannel: {
      channel: string;
      sent: number;
      /** `null` for the inbox copy: a notice is written, never delivered. */
      delivered: number | null;
      undelivered: number | null;
      read: number;
    }[];
    trend: TrendBucket[];
    trendGrain: TrendGrain;
  };
  interviews: {
    booked: number;
    completed: number;
    cancelled: number;
    noShow: number;
    upcoming: number;
    decided: number;
    noShowRate: number | null;
    medianLeadDays: number | null;
    panelsWithLead: number;
    byInterviewer: { name: string; panels: number }[];
    statusMix: CountBucket[];
    trend: TrendBucket[];
    trendGrain: TrendGrain;
  };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Positive elapsed milliseconds between two instants, or null if either is missing. */
function elapsed(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

function median(values: number[]): number | null {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const middle = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[middle] : (nums[middle - 1] + nums[middle]) / 2;
}

function round(value: number | null, places = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** A share of two counts as a percentage, or null when there is nothing to divide by. */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round((numerator / denominator) * 100, 0);
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = key(row);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** A tally as the sorted chips the cards draw, largest first. */
export function mixOf<T>(rows: T[], key: (row: T) => string): CountBucket[] {
  return [...countBy(rows, key).entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TREND_BUCKETS = 16;

function dayKeyParts(key: string): [number, number, number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))];
}

function keyFromUtc(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = dayKeyParts(key);
  return keyFromUtc(new Date(Date.UTC(y, m, d + days)));
}

function addMonthsToKey(key: string, months: number): string {
  const [y, m] = dayKeyParts(key);
  return keyFromUtc(new Date(Date.UTC(y, m + months, 1)));
}

/** The Monday-start week a calendar day belongs to. */
function weekStartKey(key: string): string {
  const [y, m, d] = dayKeyParts(key);
  const weekday = new Date(Date.UTC(y, m, d)).getUTCDay();
  return addDaysToKey(key, -((weekday + 6) % 7));
}

function lastDayOfMonth(key: string): string {
  const [y, m] = dayKeyParts(key);
  return keyFromUtc(new Date(Date.UTC(y, m + 1, 0)));
}

/** Labels are built from the calendar key itself, so no clock is re-interpreted. */
function dayLabel(key: string): string {
  return `${Number(key.slice(8, 10))} ${MONTH_NAMES[Number(key.slice(5, 7)) - 1]}`;
}

function bucketLabel(key: string, grain: TrendGrain): string {
  if (grain === "month") return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
  return dayLabel(key);
}

/**
 * Event dates grouped into clickable bars, counted in the organisation's calendar.
 *
 * Buckets are continuous: a week with nothing in it is drawn as a zero bar
 * rather than skipped, because a strip that only shows the busy weeks reads as
 * steady activity. A long window keeps the newest buckets and merges the older
 * ones into one bar that says how many it stands for.
 */
export function buildTrend(
  dates: (string | null)[],
  window: AnalyticsWindow,
  timeZone: string,
  nowIso: string
): TrendBucket[] {
  const grain = trendGrain(window);
  const counts = new Map<string, number>();
  let oldest: string | null = null;

  for (const value of dates) {
    if (!value || Number.isNaN(Date.parse(value))) continue;
    const day = dayKeyInZone(value, timeZone);
    if (!DAY_KEY.test(day)) continue;
    const start =
      grain === "day" ? day : grain === "week" ? weekStartKey(day) : `${day.slice(0, 7)}-01`;
    counts.set(start, (counts.get(start) ?? 0) + 1);
    if (oldest === null || start < oldest) oldest = start;
  }

  if (oldest === null) return [];

  const today = dayKeyInZone(nowIso, timeZone);
  const newestKey = DAY_KEY.test(today) && today >= oldest ? today : oldest;
  const last =
    grain === "day" ? newestKey : grain === "week" ? weekStartKey(newestKey) : `${newestKey.slice(0, 7)}-01`;

  const buckets: TrendBucket[] = [];
  let cursor = oldest;
  for (let guard = 0; cursor <= last && guard < 2000; guard += 1) {
    const toKey =
      grain === "day" ? cursor : grain === "week" ? addDaysToKey(cursor, 6) : lastDayOfMonth(cursor);
    buckets.push({
      key: cursor,
      label: bucketLabel(cursor, grain),
      fromKey: cursor,
      toKey,
      count: counts.get(cursor) ?? 0,
    });
    cursor =
      grain === "day"
        ? addDaysToKey(cursor, 1)
        : grain === "week"
          ? addDaysToKey(cursor, 7)
          : addMonthsToKey(cursor, 1);
  }

  if (buckets.length <= MAX_TREND_BUCKETS) return buckets;

  const cut = buckets.length - (MAX_TREND_BUCKETS - 1);
  const earlier = buckets.slice(0, cut);
  const merged: TrendBucket = {
    key: "earlier",
    label: `${earlier.length} earlier`,
    fromKey: earlier[0].fromKey,
    toKey: earlier[earlier.length - 1].toKey,
    count: earlier.reduce((total, bucket) => total + bucket.count, 0),
  };
  return [merged, ...buckets.slice(cut)];
}

/**
 * Assessment score bands, as a share of each attempt's own maximum.
 *
 * Percentages rather than raw points because every suite sets its own
 * `max_score`, so a "62" from a 40-question test and a "62" from a 200-point
 * one are not the same result.
 */
export const SCORE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Under 50%", min: 0, max: 49.999 },
  { label: "50–69%", min: 50, max: 69.999 },
  { label: "70–84%", min: 70, max: 84.999 },
  { label: "85% and above", min: 85, max: 100 },
];

/** The band one percentage falls in, or null when it is off every scale. */
export function bandOf(percent: number): string | null {
  return SCORE_BANDS.find((band) => percent >= band.min && percent <= band.max)?.label ?? null;
}

export function buildAnalyticsReport(input: AnalyticsInput): AnalyticsReport {
  const now = Date.parse(input.generatedAt) || Date.now();
  const grain = trendGrain(input.window);

  // ---- Assessments -------------------------------------------------------
  const opened = input.attempts.filter(attemptOpened).length;
  const submitted = input.attempts.filter(attemptSubmitted).length;
  const graded = input.attempts.filter(attemptGraded).length;

  const inviteToOpen = input.attempts
    .map((attempt) => elapsed(attempt.created_at, attempt.started_at))
    .filter((value): value is number => value !== null)
    .map((value) => value / HOUR);

  const timeOnTest = input.attempts
    .map((attempt) => elapsed(attempt.started_at, attempt.submitted_at))
    .filter((value): value is number => value !== null)
    .map((value) => value / 60_000);

  // A score only counts when the attempt actually has a maximum to compare to;
  // a zero or null `max_score` would turn a real result into a false 0%.
  const scored = input.attempts.filter(attemptScored);
  const percentages = scored.map(attemptPercent);

  const bands = SCORE_BANDS.map((band) => ({
    label: band.label,
    count: percentages.filter((value) => value >= band.min && value <= band.max).length,
  }));

  // ---- Sourcing ----------------------------------------------------------
  const prospectStages = countBy(input.prospects, (prospect) => prospect.stage || "NEW");
  const firstTouch = new Map<string, number>();
  for (const log of input.logs) {
    if (!log.prospect_id || !log.created_at) continue;
    const at = Date.parse(log.created_at);
    if (Number.isNaN(at)) continue;
    const known = firstTouch.get(log.prospect_id);
    if (known === undefined || at < known) firstTouch.set(log.prospect_id, at);
  }
  const toFirstContact: number[] = [];
  for (const prospect of input.prospects) {
    const touchedAt = firstTouch.get(prospect.id);
    const lag = elapsed(prospect.created_at, touchedAt ? new Date(touchedAt).toISOString() : null);
    if (lag !== null) toFirstContact.push(lag / HOUR);
  }
  const converted = input.prospects.filter(prospectConverted).length;

  // ---- Messages ----------------------------------------------------------
  const channels = [...new Set(input.logs.map((log) => log.channel))].sort();
  const byChannel = channels.map((channel) => {
    const rows = input.logs.filter((log) => log.channel === channel);
    return {
      channel,
      sent: rows.length,
      delivered: measuresDelivery(channel) ? rows.filter((row) => row.delivered).length : null,
      undelivered: measuresDelivery(channel) ? rows.filter((row) => !row.delivered).length : null,
      // Only the portal notice has a read marker; a WhatsApp delivery receipt
      // is not stored here, so this column is left blank for other channels.
      read: rows.filter(messageRead).length,
    };
  });

  // ---- Interviews --------------------------------------------------------
  const interviewStatuses = countBy(input.interviews, (interview) => interview.status);
  const upcoming = input.interviews.filter((interview) => interviewUpcoming(interview, now)).length;
  const withLead = input.interviews.filter(
    (interview) => elapsed(interview.application_created_at, interview.scheduled_at) !== null
  );
  const leadDays = withLead
    .map((interview) => elapsed(interview.application_created_at, interview.scheduled_at))
    .filter((value): value is number => value !== null)
    .map((value) => value / DAY);

  const panels = countBy(
    input.interviews.filter((interview) => interview.interviewer),
    (interview) => interview.interviewer as string
  );
  const byInterviewer = [...panels.entries()]
    .map(([name, count]) => ({ name, panels: count }))
    .sort((a, b) => b.panels - a.panels || a.name.localeCompare(b.name))
    .slice(0, 6);

  const completed = interviewStatuses.get("COMPLETED") ?? 0;
  const noShow = interviewStatuses.get("NO_SHOW") ?? 0;

  return {
    window: input.window,
    windowLabel: windowLabel(input.window),
    timeZone: input.timeZone,
    generatedAt: input.generatedAt,
    complete: input.complete,
    scoresHidden: input.scoresHidden,
    limitations: input.limitations,
    assessments: {
      issued: input.attempts.length,
      opened,
      submitted,
      graded,
      inProgress: input.attempts.filter(attemptInProgress).length,
      notStarted: input.attempts.filter(attemptNotStarted).length,
      expired: input.attempts.filter(attemptExpired).length,
      openRate: rate(opened, input.attempts.length),
      finishRate: rate(submitted, opened),
      medianInviteToOpenHours: round(median(inviteToOpen)),
      medianTimeOnTestMinutes: round(median(timeOnTest), 0),
      scoredAttempts: input.scoresHidden ? 0 : scored.length,
      medianScorePercent: input.scoresHidden ? null : round(median(percentages), 0),
      scoreBands: input.scoresHidden ? [] : bands,
      statusMix: mixOf(input.attempts, (attempt) => attempt.status || "UNKNOWN"),
      trend: buildTrend(
        input.attempts.map((attempt) => attempt.created_at),
        input.window,
        input.timeZone,
        input.generatedAt
      ),
      trendGrain: grain,
    },
    sourcing: {
      total: input.prospects.length,
      contacted: prospectStages.get("CONTACTED") ?? 0,
      replied: prospectStages.get("REPLIED") ?? 0,
      interviewing: prospectStages.get("INTERVIEW") ?? 0,
      converted,
      passed: prospectStages.get("PASSED") ?? 0,
      replyRate: rate(prospectStages.get("REPLIED") ?? 0, prospectStages.get("CONTACTED") ?? 0),
      conversionRate: rate(converted, input.prospects.length),
      medianHoursToFirstContact: round(median(toFirstContact)),
      prospectsWithMessages: firstTouch.size,
      stages: [...prospectStages.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      trend: buildTrend(
        input.prospects.map((prospect) => prospect.created_at),
        input.window,
        input.timeZone,
        input.generatedAt
      ),
      trendGrain: grain,
    },
    messages: {
      scanned: input.logs.length,
      delivered: input.logs.filter(messageDelivered).length,
      undelivered: input.logs.filter(messageUndelivered).length,
      read: input.logs.filter(messageRead).length,
      byChannel,
      trend: buildTrend(
        input.logs.map((log) => log.created_at),
        input.window,
        input.timeZone,
        input.generatedAt
      ),
      trendGrain: grain,
    },
    interviews: {
      booked: input.interviews.length,
      completed,
      cancelled: interviewStatuses.get("CANCELLED") ?? 0,
      noShow,
      upcoming,
      decided: input.interviews.filter(interviewDecided).length,
      noShowRate: rate(noShow, completed + noShow),
      medianLeadDays: round(median(leadDays), 1),
      panelsWithLead: withLead.length,
      byInterviewer,
      statusMix: mixOf(input.interviews, (interview) => interview.status || "UNKNOWN"),
      trend: buildTrend(
        input.interviews.map((interview) => interview.created_at),
        input.window,
        input.timeZone,
        input.generatedAt
      ),
      trendGrain: grain,
    },
  };
}
