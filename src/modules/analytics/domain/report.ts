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

/** One `candidate_attempts` row, narrowed to what the report reads. */
export interface AttemptRow {
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
  stage: string;
  created_at: string | null;
  application_id: string | null;
}

/** One `communication_logs` row. `delivered` is current state, not attempt history. */
export interface LogRow {
  channel: string;
  delivered: boolean;
  read_at: string | null;
  created_at: string | null;
  prospect_id: string | null;
}

/** One `interview_schedules` row with the owning application's start date. */
export interface InterviewRow {
  status: string;
  scheduled_at: string | null;
  created_at: string | null;
  interviewer: string | null;
  application_created_at: string | null;
}

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
  };
  messages: {
    scanned: number;
    byChannel: {
      channel: string;
      sent: number;
      delivered: number;
      undelivered: number;
      read: number;
    }[];
  };
  interviews: {
    booked: number;
    completed: number;
    cancelled: number;
    noShow: number;
    upcoming: number;
    noShowRate: number | null;
    medianLeadDays: number | null;
    byInterviewer: { name: string; panels: number }[];
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

/**
 * Assessment score bands, as a share of each attempt's own maximum.
 *
 * Percentages rather than raw points because every suite sets its own
 * `max_score`, so a "62" from a 40-question test and a "62" from a 200-point
 * one are not the same result.
 */
const SCORE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Under 50%", min: 0, max: 49.999 },
  { label: "50–69%", min: 50, max: 69.999 },
  { label: "70–84%", min: 70, max: 84.999 },
  { label: "85% and above", min: 85, max: 100 },
];

export function buildAnalyticsReport(input: AnalyticsInput): AnalyticsReport {
  const now = Date.parse(input.generatedAt) || Date.now();

  // ---- Assessments -------------------------------------------------------
  const opened = input.attempts.filter((attempt) => attempt.started_at).length;
  const submitted = input.attempts.filter((attempt) => attempt.submitted_at).length;
  const graded = input.attempts.filter((attempt) => attempt.status === "GRADED").length;

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
  const scored = input.attempts.filter(
    (attempt) =>
      attempt.total_score !== null &&
      attempt.max_score !== null &&
      Number(attempt.max_score) > 0
  );
  const percentages = scored.map(
    (attempt) => (Number(attempt.total_score) / Number(attempt.max_score)) * 100
  );

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
  const converted = input.prospects.filter(
    (prospect) => prospect.stage === "CONVERTED" || prospect.application_id !== null
  ).length;

  // ---- Messages ----------------------------------------------------------
  const channels = [...new Set(input.logs.map((log) => log.channel))].sort();
  const byChannel = channels.map((channel) => {
    const rows = input.logs.filter((log) => log.channel === channel);
    return {
      channel,
      sent: rows.length,
      delivered: rows.filter((row) => row.delivered).length,
      undelivered: rows.filter((row) => !row.delivered).length,
      // Only the portal notice has a read marker; a WhatsApp delivery receipt
      // is not stored here, so this column is left blank for other channels.
      read: channel === "IN_APP" ? rows.filter((row) => row.read_at).length : 0,
    };
  });

  // ---- Interviews --------------------------------------------------------
  const interviewStatuses = countBy(input.interviews, (interview) => interview.status);
  const upcoming = input.interviews.filter(
    (interview) =>
      interview.status === "SCHEDULED" &&
      interview.scheduled_at !== null &&
      Date.parse(interview.scheduled_at) > now
  ).length;
  const leadDays = input.interviews
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
      inProgress: input.attempts.filter((attempt) => attempt.status === "IN_PROGRESS").length,
      notStarted: input.attempts.filter((attempt) => attempt.status === "NOT_STARTED").length,
      expired: input.attempts.filter((attempt) => attempt.status === "EXPIRED").length,
      openRate: rate(opened, input.attempts.length),
      finishRate: rate(submitted, opened),
      medianInviteToOpenHours: round(median(inviteToOpen)),
      medianTimeOnTestMinutes: round(median(timeOnTest), 0),
      scoredAttempts: input.scoresHidden ? 0 : scored.length,
      medianScorePercent: input.scoresHidden ? null : round(median(percentages), 0),
      scoreBands: input.scoresHidden ? [] : bands,
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
    },
    messages: { scanned: input.logs.length, byChannel },
    interviews: {
      booked: input.interviews.length,
      completed,
      cancelled: interviewStatuses.get("CANCELLED") ?? 0,
      noShow,
      upcoming,
      noShowRate: rate(noShow, completed + noShow),
      medianLeadDays: round(median(leadDays), 1),
      byInterviewer,
    },
  };
}

/**
 * The report as a flat CSV.
 *
 * One `section,metric,value` triple per line rather than a grid: the four
 * areas count different things, and a spreadsheet with ragged columns gets
 * averaged by whoever opens it.
 */
export function reportToCsv(report: AnalyticsReport): string {
  const lines: string[] = [
    "section,metric,value",
    `meta,window,${report.windowLabel}`,
    `meta,time_zone,${report.timeZone}`,
    `meta,generated_at,${report.generatedAt}`,
    `meta,complete,${report.complete ? "yes" : "no — a read hit its row budget"}`,
  ];

  for (const limitation of report.limitations) {
    lines.push(`limitation,,${limitation}`);
  }

  const add = (section: string, metric: string, value: string | number | null) => {
    lines.push(`${section},${metric},${value ?? ""}`);
  };

  const a = report.assessments;
  add("assessments", "issued", a.issued);
  add("assessments", "opened", a.opened);
  add("assessments", "submitted", a.submitted);
  add("assessments", "graded", a.graded);
  add("assessments", "expired", a.expired);
  add("assessments", "open_rate_percent", a.openRate);
  add("assessments", "finish_rate_percent", a.finishRate);
  add("assessments", "median_hours_to_open", a.medianInviteToOpenHours);
  add("assessments", "median_minutes_on_test", a.medianTimeOnTestMinutes);
  if (report.scoresHidden) {
    add("assessments", "score_distribution", "withheld from this account");
  } else {
    add("assessments", "median_score_percent", a.medianScorePercent);
    for (const band of a.scoreBands) add("assessments", `score_${band.label}`, band.count);
  }

  const s = report.sourcing;
  add("sourcing", "prospects", s.total);
  add("sourcing", "contacted", s.contacted);
  add("sourcing", "replied", s.replied);
  add("sourcing", "interview", s.interviewing);
  add("sourcing", "converted", s.converted);
  add("sourcing", "passed", s.passed);
  add("sourcing", "median_hours_to_first_contact", s.medianHoursToFirstContact);
  add("sourcing", "reply_rate_percent", s.replyRate);
  add("sourcing", "conversion_rate_percent", s.conversionRate);

  for (const row of report.messages.byChannel) {
    add("messages", `${row.channel}_sent`, row.sent);
    add("messages", `${row.channel}_delivered`, row.delivered);
    add("messages", `${row.channel}_undelivered`, row.undelivered);
    if (row.channel === "IN_APP") add("messages", "IN_APP_read", row.read);
  }

  const i = report.interviews;
  add("interviews", "booked", i.booked);
  add("interviews", "completed", i.completed);
  add("interviews", "cancelled", i.cancelled);
  add("interviews", "no_show", i.noShow);
  add("interviews", "upcoming", i.upcoming);
  add("interviews", "no_show_rate_percent", i.noShowRate);
  add("interviews", "median_lead_days", i.medianLeadDays);
  for (const panel of i.byInterviewer) add("interviews", `panel:${panel.name}`, panel.panels);

  return `${lines.join("\r\n")}\r\n`;
}
