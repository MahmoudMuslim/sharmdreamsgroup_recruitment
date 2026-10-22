/**
 * Rounds and scorecards, in the words the screens and the chat share.
 *
 * Pure by design — no database, no `server-only` — because three surfaces need
 * the same four labels and the same 1..5 rule: the agenda's scorecard desk, the
 * candidate's booking form and the assistant's tools. A vocabulary copied three
 * times is a review form that accepts "Hiring Manager" in one place and not in
 * another.
 *
 * The four ratings are kept apart rather than averaged into one number. An
 * average is a read-time convenience; storing it would erase the disagreement a
 * panel of three exists to surface, and it would make "technical 5, culture 2" —
 * a different judgement from "4, 4, 4, 3" — arrive as the same 3.5.
 */

export const INTERVIEW_ROUNDS = [
  "SCREENING",
  "TECHNICAL",
  "HIRING_MANAGER",
  "CULTURE_FIT",
] as const;

export type InterviewRound = (typeof INTERVIEW_ROUNDS)[number];

export const INTERVIEW_ROUND_LABELS: Record<InterviewRound, string> = {
  SCREENING: "Screening",
  TECHNICAL: "Technical",
  HIRING_MANAGER: "Hiring manager",
  CULTURE_FIT: "Culture fit",
};

/** One of the four rounds, or false for a blank, a guess or a lowercase echo. */
export function isInterviewRound(value: unknown): value is InterviewRound {
  return typeof value === "string" && (INTERVIEW_ROUNDS as readonly string[]).includes(value);
}

/**
 * The round in the words a card prints, or null when none was recorded.
 *
 * Null rather than "Not set": a caller that wants to say "no round" can decide
 * how loud to be, while a card with nothing to show stays quiet. Historical
 * panels are null, and the agenda does not repeat "not set" on every one.
 */
export function roundLabel(value: unknown): string | null {
  return isInterviewRound(value) ? INTERVIEW_ROUND_LABELS[value] : null;
}

export const SCORECARD_MIN = 1;
export const SCORECARD_MAX = 5;
export const SCORECARD_FEEDBACK_LIMIT = 4000;

export const SCORECARD_CRITERIA = [
  { key: "technical", label: "Technical" },
  { key: "communication", label: "Communication" },
  { key: "problemSolving", label: "Problem solving" },
  { key: "culture", label: "Culture" },
] as const;

export type ScorecardCriterion = (typeof SCORECARD_CRITERIA)[number]["key"];

export type ScorecardRatings = Record<ScorecardCriterion, number>;

export type RatingsRead =
  | { ok: true; ratings: ScorecardRatings }
  | { ok: false; error: string };

/**
 * The four ratings, or the first one that is not a whole number from 1 to 5.
 *
 * Numeric strings are accepted because an HTML form posts text and the action
 * should judge the value, not the transport. "3.5" is refused rather than
 * rounded: the scale is five points, and silently turning a half mark into a 4
 * would record a judgement nobody made.
 */
export function readScorecardRatings(input: Record<string, unknown>): RatingsRead {
  const ratings = {} as ScorecardRatings;

  for (const criterion of SCORECARD_CRITERIA) {
    const raw = input[criterion.key];
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < SCORECARD_MIN ||
      value > SCORECARD_MAX
    ) {
      return {
        ok: false,
        error: `${criterion.label} must be a whole number from ${SCORECARD_MIN} to ${SCORECARD_MAX}.`,
      };
    }
    ratings[criterion.key] = value;
  }

  return { ok: true, ratings };
}

export type FeedbackRead =
  | { ok: true; feedback: string | null }
  | { ok: false; error: string };

/** The written note, trimmed; blank becomes null rather than an empty string. */
export function readScorecardFeedback(value: unknown): FeedbackRead {
  if (value === null || value === undefined) return { ok: true, feedback: null };
  if (typeof value !== "string") {
    return { ok: false, error: "The feedback must be text." };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, feedback: null };
  if (trimmed.length > SCORECARD_FEEDBACK_LIMIT) {
    return {
      ok: false,
      error: `The feedback is longer than ${SCORECARD_FEEDBACK_LIMIT.toLocaleString()} characters.`,
    };
  }
  return { ok: true, feedback: trimmed };
}

/** The four marks as one number a card can sort or print, or null for no marks. */
export function scorecardAverage(ratings: ScorecardRatings | null | undefined): number | null {
  if (!ratings) return null;
  let total = 0;
  for (const criterion of SCORECARD_CRITERIA) total += ratings[criterion.key];
  return total / SCORECARD_CRITERIA.length;
}

/** An average to one decimal, or an em dash when there is nothing to average. */
export function averageLabel(average: number | null): string {
  return average === null ? "—" : average.toFixed(1);
}

/**
 * The scorecard in one line: `Technical 4 · Communication 3 · … · average 4.0`.
 *
 * Used by the trail and the chat, where a table of four figures costs more than
 * the sentence. The screen draws its own grid and does not use this.
 */
export function scorecardSummary(ratings: ScorecardRatings): string {
  const marks = SCORECARD_CRITERIA.map(
    (criterion) => `${criterion.label} ${ratings[criterion.key]}`
  ).join(" · ");
  return `${marks} · average ${averageLabel(scorecardAverage(ratings))}`;
}

/** A stored scorecard, as the reader hands it to a screen or the chat. */
export interface InterviewScorecard extends ScorecardRatings {
  id: string;
  interviewId: string;
  authorProfileId: string | null;
  authorName: string | null;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Both halves of the panel read: rounds by id, and every scorecard in the set. */
export interface InterviewScorecardLayer {
  /** Round by interview id. An interview with no round is absent, not null. */
  rounds: Record<string, InterviewRound>;
  scorecards: InterviewScorecard[];
  /**
   * The requested ids that exist on the schedule table.
   *
   * Kept apart from `rounds`, which omits a panel that simply has no round. A
   * reader handed an id that is not here was handed a panel that does not exist,
   * and saying "no scorecards" about it would dress a mistake up as an answer.
   * Empty while the round column is unreadable: existence cannot be proved then.
   */
  foundIds: string[];
  /** False when the `round` column could not be read — 032 unapplied, usually. */
  roundsAvailable: boolean;
  /** False when the scorecard table could not be read. */
  scorecardsAvailable: boolean;
  /** Why either half is unavailable, in the words the screen prints. */
  note: string | null;
}

/** One panel's scorecards, in the order they were written. */
export function scorecardsFor(
  layer: InterviewScorecardLayer,
  interviewId: string
): InterviewScorecard[] {
  return layer.scorecards.filter((card) => card.interviewId === interviewId);
}

/** The average of every scorecard on a panel, or null when nobody has scored it. */
export function panelAverage(scorecards: readonly InterviewScorecard[]): number | null {
  if (scorecards.length === 0) return null;
  let total = 0;
  for (const card of scorecards) {
    total += (card.technical + card.communication + card.problemSolving + card.culture) / 4;
  }
  return total / scorecards.length;
}

/**
 * The one sentence every door says when 032 has not been applied.
 *
 * Both halves of the migration share a file, and both failures mean the same
 * thing to the reader: the database predates the feature. Naming the file is
 * the actionable half — "not supported" is not.
 */
export const SCORECARD_MIGRATION = "db/migrations/032_interview_scorecards.sql";

export const SCORECARD_SCHEMA_NOTE =
  `Rounds and scorecards have not been created on this database yet. Apply ${SCORECARD_MIGRATION} — ` +
  "until it runs, a panel has no round and no scorecard can be saved.";

export const SCORECARD_WRITE_REFUSAL =
  `Scorecards have not been created on this database yet. Apply ${SCORECARD_MIGRATION}, ` +
  "then save this scorecard again.";

export const ROUND_WRITE_REFUSAL =
  `Rounds have not been added to panels on this database yet. Apply ${SCORECARD_MIGRATION}, ` +
  "then pick the round again.";

export interface SchemaErrorShape {
  code?: string | null;
  message?: string | null;
}

/**
 * True when PostgREST said the definition is missing, rather than that the
 * request failed.
 *
 * The codes are the same four the live channel treats as a verdict — relation
 * not in the schema cache, relation or column absent, no privilege is not among
 * them but a missing *column* arrives as 42703/PGRST204, which is exactly the
 * unapplied `round` column. A transport failure has no code and must not be
 * reported as "apply the migration".
 */
export function isMissingSchemaError(error: SchemaErrorShape | null | undefined): boolean {
  if (!error) return false;
  if (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    error.code === "42703"
  ) {
    return true;
  }
  return /does not exist|schema cache/i.test(error.message ?? "");
}
