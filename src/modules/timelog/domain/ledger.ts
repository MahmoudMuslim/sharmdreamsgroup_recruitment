/**
 * Worked time, as the portal counts it.
 *
 * Pure by design — no database, no `server-only` — because the running timer is
 * the one part of this page that must keep moving after the server has stopped
 * rendering. Both halves need the same arithmetic, and two copies of a duration
 * formatter is how a ticking clock and a saved total start disagreeing.
 */

export const TIME_CATEGORIES = [
  "SCREENING",
  "ASSESSMENT",
  "INTERVIEW",
  "ONBOARDING",
  "SOURCING",
  "ADMIN",
  "OTHER",
] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];

/**
 * What each bucket means, in the words the picker shows.
 *
 * A category only groups if people choose the same one for the same work, so the
 * console says what belongs in each instead of leaving "ADMIN" to be guessed.
 */
export const CATEGORY_LABEL: Record<TimeCategory, string> = {
  SCREENING: "Screening",
  ASSESSMENT: "Assessments",
  INTERVIEW: "Interviews",
  ONBOARDING: "Onboarding",
  SOURCING: "Sourcing",
  ADMIN: "Administration",
  OTHER: "Other",
};

export const CATEGORY_HINT: Record<TimeCategory, string> = {
  SCREENING: "Reading CVs, scoring fit, moving a candidate through a stage",
  ASSESSMENT: "Setting tests, grading submissions, reviewing pitch recordings",
  INTERVIEW: "Panel time, interview prep and the notes that follow it",
  ONBOARDING: "New-hire checklists, equipment, first-week coordination",
  SOURCING: "Outbound search, prospect lists, first contact",
  ADMIN: "Portal configuration, team access, reporting",
  OTHER: "Work that is none of the above",
};

export type CategoryTone = "neutral" | "gold" | "success" | "info";

export const CATEGORY_TONE: Record<TimeCategory, CategoryTone> = {
  SCREENING: "gold",
  ASSESSMENT: "info",
  INTERVIEW: "success",
  ONBOARDING: "success",
  SOURCING: "info",
  ADMIN: "neutral",
  OTHER: "neutral",
};

export const DEFAULT_CATEGORY: TimeCategory = "SCREENING";

/** Said wherever the ledger sits behind a permission the reader does not hold. */
export const TRACK_DENIED =
  "Logging hours needs the Track time permission. Ask an administrator for it in Settings → Roles & permissions.";

/** A logged span, as the ledger reads it back. */
export interface TimeEntry {
  id: string;
  staff_id: string;
  staff_name: string;
  company_id: string | null;
  category: TimeCategory;
  task: string;
  job_id: string | null;
  job_title: string | null;
  application_id: string | null;
  application_name: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
}

/** What a form posts. A null `startedAt` means "stamp it with the database clock". */
export interface TimeDraft {
  task: string;
  category: TimeCategory;
  note: string;
  jobId: string | null;
  applicationId: string | null;
  /** Null only when starting a timer now: nobody's laptop gets to decide when it began. */
  startedAt: string | null;
  endedAt: string | null;
}

export const TIME_LIMITS = { task: 160, note: 500 } as const;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Five minutes of slack for a future start.
 *
 * A back-dated entry typed on a laptop whose clock runs a little fast is not a
 * mistake worth refusing, but an hour ahead is.
 */
const FUTURE_SLACK_MS = 5 * MINUTE_MS;

export function isTimeCategory(value: unknown): value is TimeCategory {
  return (
    typeof value === "string" && (TIME_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isRunning(entry: Pick<TimeEntry, "ended_at">): boolean {
  return entry.ended_at === null;
}

/** Milliseconds spent so far — the running half of the row keeps growing. */
export function elapsedMs(entry: TimeEntry, nowMs: number): number {
  const start = Date.parse(entry.started_at);
  if (Number.isNaN(start)) return 0;
  const end = entry.ended_at ? Date.parse(entry.ended_at) : nowMs;
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

export function elapsedSeconds(entry: TimeEntry, nowMs: number): number {
  return Math.floor(elapsedMs(entry, nowMs) / 1000);
}

/**
 * The live clock face: `1:04:22`, `128:05:09`.
 *
 * Hours are not padded to two digits, because a timer left running over the
 * weekend should read as the absurd number it is rather than wrap around.
 */
export function formatTicker(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** A span in the words a table cell uses: `2h 14m`, `38m`, `45s`. */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** A total of hours, as decimal hours beside the readable form. */
export function decimalHours(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(1);
}

/**
 * How far back a window asks for, counted in calendar days rather than hours.
 *
 * Days because "Today" means the day on the office wall, not the last 24 hours:
 * an entry logged at 09:00 is gone from a 24-hour window by 09:01 the next day,
 * which is exactly when a recruiter wants to still see it.
 */
export const TIME_WINDOWS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "14d", label: "14 days", days: 14 },
  { key: "30d", label: "30 days", days: 30 },
] as const;
export type TimeWindowKey = (typeof TIME_WINDOWS)[number]["key"];

export function isTimeWindow(value: unknown): value is TimeWindowKey {
  return TIME_WINDOWS.some((option) => option.key === value);
}

export function timeWindow(key: unknown): (typeof TIME_WINDOWS)[number] {
  return TIME_WINDOWS.find((option) => option.key === key) ?? TIME_WINDOWS[1];
}

/** Whose hours: the caller's own, or everyone in their company. */
export const TIME_SCOPES = ["mine", "team"] as const;
export type TimeScope = (typeof TIME_SCOPES)[number];

export function isTimeScope(value: unknown): value is TimeScope {
  return typeof value === "string" && (TIME_SCOPES as readonly string[]).includes(value);
}

/**
 * The draft, checked against the same limits the table enforces.
 *
 * The database refuses a blank task, an unknown category or a span that runs
 * backwards; refusing them here too is not defence in depth but the difference
 * between an error a person can act on and a Postgres constraint name.
 */
export function normaliseDraft(
  draft: TimeDraft,
  nowMs = Date.now()
): { value: TimeDraft } | { error: string } {
  const task = draft.task.replace(/\s+/g, " ").trim();
  if (!task) return { error: "Say what the time was spent on." };
  if (task.length > TIME_LIMITS.task)
    return { error: `Keep the description under ${TIME_LIMITS.task} characters.` };
  if (!isTimeCategory(draft.category)) return { error: "Pick one of the listed categories." };

  const note = draft.note.replace(/\s+/g, " ").trim();
  if (note.length > TIME_LIMITS.note)
    return { error: `Keep the note under ${TIME_LIMITS.note} characters.` };

  // A missing start means "this timer begins now", and only the database gets to
  // say when that is — see TimeDraft.
  let started: number | null = null;
  if (draft.startedAt !== null) {
    started = Date.parse(draft.startedAt);
    if (Number.isNaN(started)) return { error: "That start time is not a real date and time." };
    if (started > nowMs + FUTURE_SLACK_MS)
      return { error: "A span cannot start in the future." };
  }

  let ended: number | null = null;
  if (draft.endedAt !== null) {
    if (started === null)
      return { error: "A span needs a start before it can have an end." };
    ended = Date.parse(draft.endedAt);
    if (Number.isNaN(ended)) return { error: "That end time is not a real date and time." };
    if (ended <= started)
      return { error: "The end must be after the start — or leave the end blank to run a timer." };
  }

  return {
    value: {
      task,
      category: draft.category,
      note,
      jobId: draft.jobId,
      applicationId: draft.applicationId,
      startedAt: started === null ? null : new Date(started).toISOString(),
      endedAt: ended === null ? null : new Date(ended).toISOString(),
    },
  };
}

/** What a row points at: a candidate, an opening, both, or neither. */
export function subjectOf(entry: TimeEntry): string | null {
  if (entry.application_name && entry.job_title)
    return `${entry.application_name} · ${entry.job_title}`;
  return entry.application_name ?? entry.job_title ?? null;
}

export interface DayGroup {
  /** `YYYY-MM-DD` in the reader's organisation timezone. */
  key: string;
  seconds: number;
  entries: TimeEntry[];
}

/**
 * Rows grouped onto the day they started on.
 *
 * A span that runs past midnight is counted where it began rather than split:
 * splitting is what a billing system does, and this ledger is read by the person
 * who worked the hours, for whom "Tuesday took six hours" is the useful number.
 */
export function groupByDay(
  entries: TimeEntry[],
  nowMs: number,
  dayKey: (iso: string) => string
): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const entry of entries) {
    const key = dayKey(entry.started_at) || "unknown";
    const group = groups.get(key) ?? { key, seconds: 0, entries: [] };
    group.seconds += elapsedMs(entry, nowMs);
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, seconds: Math.floor(group.seconds / 1000) }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

export interface Slice {
  key: string;
  label: string;
  seconds: number;
  entries: number;
}

function fold(
  entries: TimeEntry[],
  nowMs: number,
  pick: (entry: TimeEntry) => { key: string; label: string } | null
): Slice[] {
  const acc = new Map<string, Slice>();
  for (const entry of entries) {
    const picked = pick(entry);
    if (!picked) continue;
    const slice = acc.get(picked.key) ?? { ...picked, seconds: 0, entries: 0 };
    slice.seconds += elapsedMs(entry, nowMs);
    slice.entries += 1;
    acc.set(picked.key, slice);
  }
  return [...acc.values()]
    .map((slice) => ({ ...slice, seconds: Math.floor(slice.seconds / 1000) }))
    .sort((a, b) => b.seconds - a.seconds);
}

/**
 * Totals per category, per colleague, per opening — all from the rows on screen.
 *
 * The subject labels fall back to the bare noun rather than a story: a missing
 * name means the candidate was removed *or* that this reader may not open
 * candidate records, and the ledger has no business claiming which.
 */
export const byCategory = (entries: TimeEntry[], nowMs: number): Slice[] =>
  fold(entries, nowMs, (entry) => ({
    key: entry.category,
    label: CATEGORY_LABEL[entry.category] ?? entry.category,
  }));

export const byStaff = (entries: TimeEntry[], nowMs: number): Slice[] =>
  fold(entries, nowMs, (entry) => ({
    key: entry.staff_id,
    label: entry.staff_name,
  }));

export const byJob = (entries: TimeEntry[], nowMs: number): Slice[] =>
  fold(entries, nowMs, (entry) =>
    entry.job_id ? { key: entry.job_id, label: entry.job_title ?? "An opening" } : null
  );

export const byCandidate = (entries: TimeEntry[], nowMs: number): Slice[] =>
  fold(entries, nowMs, (entry) =>
    entry.application_id
      ? { key: entry.application_id, label: entry.application_name ?? "A candidate" }
      : null
  );

/** A colleague's hours, in the order the console lists them. */
export function totalSeconds(entries: TimeEntry[], nowMs: number): number {
  return Math.floor(entries.reduce((sum, entry) => sum + elapsedMs(entry, nowMs), 0) / 1000);
}

/** The days a window covers, oldest last, whether or not anyone logged anything. */
export function dayKeys(days: number, nowMs: number, keyOf: (iso: string) => string): string[] {
  const keys: string[] = [];
  for (let back = 0; back < days; back += 1) {
    const key = keyOf(new Date(nowMs - back * DAY_MS).toISOString());
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * What the ledger is, in the words both the screen and the header use.
 *
 * Kept here rather than in the page so a limitation stated once cannot be
 * contradicted by a second copy somewhere else.
 */
export const LEDGER_NOTES = {
  label: "Time ledger",
  caveats: [
    "Time is logged by the person who worked it. Nothing here is measured automatically: a stage move, an interview or a grade leaves no entry unless someone starts a timer or adds the span by hand.",
    "A span counts on the day it started, so work carried past midnight is not split across two days.",
    "The elapsed time of a running entry is the database clock, not the browser's, so the ticking figure and the saved total are the same measurement.",
    "Removing an entry deletes it. Hours are not archived the way candidates are: a mistake in a personal timesheet is corrected, not kept.",
  ],
};
