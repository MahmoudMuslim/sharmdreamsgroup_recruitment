/**
 * The shortlist: where one opening's applicants are ordered against each other.
 *
 * Everything here is pure arithmetic over signals the portal already stores for a
 * single application. The module reads nothing — no database, no session, no
 * model — because the decision it exists to make is not *what the evidence is* but
 * *what may be said about it*. A caller hands over rows it has already fetched
 * (and already masked, if masking applies) and gets back an ordering plus the
 * reason each line carries.
 *
 * Three rules hold it together, and each one exists because the portal has had to
 * take a claim back before:
 *
 *   1. **No evidence is never a zero.** A CV nobody screened, a requisition with no
 *      skill list, an unmarked paper — these are facts about the paperwork, the
 *      same reading the applicants drawer gives for `candidate_skills`. A component
 *      with nothing behind it drops out of the score and its weight redistributes
 *      over what remains, so an applicant is never ranked down for a step nobody
 *      took. That is also why a line can carry `score: null`.
 *   2. **A number the caller may not read cannot rank anyone.** The reports reader
 *      masks scores *before* the sort so "highest AI fit" cannot order rows by a
 *      figure the account is not allowed to see; the shortlist is a sort, so the
 *      same rule runs here, and the withheld components are named rather than left
 *      quiet — a narrower ranking has to look narrower.
 *   3. **A failed gate question is a marker, not a fourth score.** It puts a person
 *      below everyone who passed and keeps them on the page with their number
 *      intact, because a row the database holds has to be visible to be refused.
 *
 * The output is a percentage on the same 0..100 scale as `ai_match_score`, rounded
 * to a whole number: half a match is not a thing anyone can act on.
 */

import { parseGateAnswers } from "../../careers/gate-questions.ts";
import {
  matchRequiredSkills,
  skillMatchSummary,
  type DemonstratedSkill,
  type RequiredSkill,
} from "./openingSkills.ts";

/** The four signals a shortlist is allowed to be built from. */
export const SHORTLIST_COMPONENTS = ["ai", "skills", "test", "interview"] as const;

export type ShortlistComponent = (typeof SHORTLIST_COMPONENTS)[number];

/**
 * What each component is worth against the others when all of them are present.
 * Screening carries the most weight because it is the only signal that read the
 * CV itself; a requisition's skills come next because they are the opening's own
 * words; a test paper and an interview panel carry equal weight, since neither is
 * comparable to the other across openings.
 */
export const SHORTLIST_WEIGHTS: Record<ShortlistComponent, number> = {
  ai: 0.35,
  skills: 0.25,
  test: 0.2,
  interview: 0.2,
};

/**
 * How many applicants one opening's shortlist may be built from. A shortlist is a
 * screen, not a queue: past this many the recruiter is being shown an order over a
 * sample, and the header has to say so — the same disclosure every capped read in
 * this portal makes.
 */
export const SHORTLIST_LIMIT = 200;

/** The interview scorecard's own scale, so a panel average is a fraction of it. */
const SCORECARD_FLOOR = 1;
const SCORECARD_CEILING = 5;

export interface ShortlistSkills {
  required: number;
  meets: number;
  below: number;
  unevidenced: number;
}

export interface ShortlistTest {
  /** Null when the paper carries no total, which is not the same as a nil score. */
  score: number | null;
  max: number;
  graded: boolean;
}

export interface ShortlistInterview {
  /** The panel's average on the 1..5 scale, or null when no scorecard was filed. */
  average: number | null;
  panel: number;
}

export interface ShortlistGate {
  passed: number;
  failed: number;
}

/** Everything one application can say about itself, exactly as it was read. */
export interface ApplicantSignals {
  applicationId: string;
  name: string;
  stage: string;
  aiScore: number | null;
  skills: ShortlistSkills | null;
  gate: ShortlistGate | null;
  test: ShortlistTest | null;
  interview: ShortlistInterview | null;
}

export interface RankContext {
  /**
   * Whether scores are masked for the account asking. The caller decides — it owns
   * the permission read — and this module obeys it without checking anything.
   */
  scoresHidden: boolean;
}

export interface ShortlistLine {
  applicationId: string;
  name: string;
  stage: string;
  /** 0..100, or null when the caller has nothing readable to rank this person on. */
  score: number | null;
  /** Components actually in the arithmetic, in `SHORTLIST_COMPONENTS` order. */
  basis: ShortlistComponent[];
  /** Components with no evidence behind them — nobody took that step. */
  missing: ShortlistComponent[];
  /** Components withheld from this account by the masking rule. */
  hidden: ShortlistComponent[];
  gateFailed: boolean;
}

const COMPONENT_LABELS: Record<ShortlistComponent, string> = {
  ai: "AI screening",
  skills: "requisition skills",
  test: "the test paper",
  interview: "the interview panel",
};

/** Clamp a fraction of a signal onto the 0..100 scale the score is printed on. */
function percent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * What one component is worth, or null when it says nothing.
 *
 * Each branch's `null` is the whole point of the module: a missing figure is a
 * separate answer from a low one, and the arithmetic downstream can only keep them
 * apart if it is told.
 */
function componentValue(
  component: ShortlistComponent,
  row: ApplicantSignals
): number | null {
  switch (component) {
    case "ai": {
      if (row.aiScore === null || !Number.isFinite(row.aiScore)) return null;
      return percent(row.aiScore);
    }
    case "skills": {
      const skills = row.skills;
      if (!skills || skills.required <= 0) return null;
      // A required skill with nothing recorded is not a gap, so it is not in the
      // numerator or the denominator: the share is over the skills someone
      // actually looked for.
      const judged = skills.meets + skills.below;
      if (judged <= 0) return null;
      return percent((skills.meets / skills.required) * 100);
    }
    case "test": {
      const paper = row.test;
      if (!paper || !paper.graded) return null;
      if (paper.score === null || paper.max <= 0) return null;
      if (!Number.isFinite(paper.score) || !Number.isFinite(paper.max)) return null;
      return percent((paper.score / paper.max) * 100);
    }
    case "interview": {
      const panel = row.interview;
      if (!panel || panel.average === null || !Number.isFinite(panel.average)) return null;
      const span = SCORECARD_CEILING - SCORECARD_FLOOR;
      return percent(((panel.average - SCORECARD_FLOOR) / span) * 100);
    }
  }
}

function isWithheld(component: ShortlistComponent, context: RankContext): boolean {
  // The skill evidence is a count of names, not a score, so a masked reviewer still
  // sees it — exactly what the applicants drawer does when scores are hidden.
  return context.scoresHidden && component !== "skills";
}

/** One applicant's row: the arithmetic, and what it could not do. */
function lineFor(row: ApplicantSignals, context: RankContext): ShortlistLine {
  const basis: ShortlistComponent[] = [];
  const missing: ShortlistComponent[] = [];
  const hidden: ShortlistComponent[] = [];

  let weighted = 0;
  let weightSeen = 0;

  for (const component of SHORTLIST_COMPONENTS) {
    const value = componentValue(component, row);
    if (isWithheld(component, context)) {
      // Withheld is decided before the evidence is asked about, so a masked account
      // cannot learn from `missing` whether the figure exists.
      hidden.push(component);
      continue;
    }
    if (value === null) {
      missing.push(component);
      continue;
    }
    basis.push(component);
    weighted += value * SHORTLIST_WEIGHTS[component];
    weightSeen += SHORTLIST_WEIGHTS[component];
  }

  return {
    applicationId: row.applicationId,
    name: row.name,
    stage: row.stage,
    score: weightSeen > 0 ? Math.round(weighted / weightSeen) : null,
    basis,
    missing,
    hidden,
    gateFailed: (row.gate?.failed ?? 0) > 0,
  };
}

/**
 * Order an opening's applicants.
 *
 * Four keys, in this order, so the result is the same whoever pressed refresh and
 * whoever the database happened to return first: anyone who passed the gate before
 * anyone who did not, then the score, then the breadth of evidence behind it (a
 * 60% built on two signals outranks a 60% built on one, because it is the better
 * supported claim, and the reason line prints how many were used), then the name,
 * then the id.
 */
export function rankApplicants(
  rows: readonly ApplicantSignals[],
  context: RankContext
): ShortlistLine[] {
  return rows
    .map((row) => lineFor(row, context))
    .sort((a, b) => {
      if (a.gateFailed !== b.gateFailed) return a.gateFailed ? 1 : -1;
      // An unranksble line sits below every scored one rather than pretending to
      // tie at zero, and two of them order among themselves by name.
      if (a.score === null || b.score === null) {
        if (a.score === b.score) return breakTie(a, b);
        return a.score === null ? 1 : -1;
      }
      if (a.score !== b.score) return b.score - a.score;
      if (a.basis.length !== b.basis.length) return b.basis.length - a.basis.length;
      return breakTie(a, b);
    });
}

function breakTie(a: ShortlistLine, b: ShortlistLine): number {
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.applicationId.localeCompare(b.applicationId);
}

/** Whether any line has anything readable behind it at all. */
export function isRankable(lines: readonly ShortlistLine[]): boolean {
  return lines.some((line) => line.basis.length > 0);
}

function listPhrase(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The line under one applicant's number: what the ranking actually looked at. */
export function shortlistReason(line: ShortlistLine): string {
  if (line.basis.length === 0) {
    return line.hidden.length > 0
      ? `Nothing recorded to rank on — ${line.hidden.length} score${
          line.hidden.length === 1 ? "" : "s"
        } withheld from your account.`
      : "Nothing recorded to rank on.";
  }
  const parts = [`Ranked on ${listPhrase(line.basis.map((component) => COMPONENT_LABELS[component]))}`];
  if (line.missing.length > 0) parts.push(`${line.missing.length} without evidence`);
  if (line.hidden.length > 0) parts.push(`${line.hidden.length} withheld from your account`);
  if (line.gateFailed) parts.push("a gate question was answered below the pass mark");
  return `${parts.join("; ")}.`;
}

/**
 * The header over the whole list. It carries the two disclosures a per-line reason
 * cannot: whether the ranking is possible at all, and how much of it the caller's
 * own permissions took away. What a *read* left out — a capped list, a skill table
 * that is not on this database — is the reader's own disclosure, because only it
 * knows how many rows it asked for.
 */
export function shortlistBasisNote(lines: readonly ShortlistLine[]): string {
  if (!isRankable(lines)) {
    return "These applicants cannot be ranked: no opening signal is readable for this account.";
  }
  const withheld = lines.find((line) => line.hidden.length > 0)?.hidden.length ?? 0;
  const head = `Ranked from ${lines.length} applicant${
    lines.length === 1 ? "" : "s"
  }, each on the signals it carries.`;
  return withheld > 0
    ? `${head} Scores are withheld from your account, so the ranking is narrower than it looks.`
    : head;
}

/* -------------------------------------------------------------------------- */
/* from a row the read returned to the signals above                          */
/* -------------------------------------------------------------------------- */

/**
 * One row of the bounded applicants read, as the REST embed hands it over.
 *
 * Every field is `unknown` on purpose: this is jsonb and a joined array, and the
 * shape the column writes today is not a promise about the rows an older build or
 * a hand edit left behind. The mapper's job is to decide what a row *can* be said
 * to carry, which means a value it cannot read has to become no evidence rather
 * than a guess.
 */
export interface ShortlistRow {
  id?: unknown;
  full_name?: unknown;
  stage?: unknown;
  ai_match_score?: unknown;
  candidate_skills?: unknown;
  candidate_attempts?: unknown;
  gate_answers?: unknown;
  interview_schedules?: unknown;
}

/** The four marks a scorecard row carries, in the column names the table writes. */
const SCORECARD_COLUMNS = ["technical", "communication", "problem_solving", "culture"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function labelOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A number the row actually carries; a blank, a name or an infinity says nothing. */
function numberOf(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const given = typeof value === "number" ? value : Number(value);
  return Number.isFinite(given) ? given : null;
}

/**
 * The paper whose marks count: the newest one somebody graded.
 *
 * A candidate can be re-sat, so the embed returns several rows, and `created_at`
 * is an ISO stamp the sort can read as text. A `SUBMITTED` attempt has no marks
 * yet — it is kept as `graded: false` so the line can say the paper exists rather
 * than implying nothing was issued, and the ranker drops it from the arithmetic.
 */
function paperOf(value: unknown, scoresHidden: boolean): ShortlistTest | null {
  if (scoresHidden) return null;
  const attempts = rowsOf(value).sort((a, b) =>
    labelOf(b.created_at).localeCompare(labelOf(a.created_at))
  );
  if (attempts.length === 0) return null;
  const graded = attempts.find((attempt) => labelOf(attempt.status) === "GRADED");
  const chosen = graded ?? attempts[0];
  return {
    score: numberOf(chosen.total_score),
    max: numberOf(chosen.max_score) ?? 0,
    graded: chosen === graded,
  };
}

/**
 * The panel's average, over every schedule the applicant has.
 *
 * A card missing one of the four marks is skipped, not counted as a lower card:
 * half a judgement is not a smaller judgement. The panel count is a count of
 * filings, so unlike the average it survives a masked read — the same rule the
 * applicants drawer applies to skill evidence.
 */
function panelOf(value: unknown, scoresHidden: boolean): ShortlistInterview {
  const marks: number[] = [];
  for (const schedule of rowsOf(value)) {
    for (const card of rowsOf(schedule.interview_scorecards)) {
      const ratings = SCORECARD_COLUMNS.map((column) => numberOf(card[column]));
      if (ratings.some((mark) => mark === null)) continue;
      marks.push((ratings as number[]).reduce((sum, mark) => sum + mark, 0) / SCORECARD_COLUMNS.length);
    }
  }
  const average =
    marks.length === 0 ? null : marks.reduce((sum, mark) => sum + mark, 0) / marks.length;
  return { average: scoresHidden ? null : average, panel: marks.length };
}

/**
 * What this application's record shows against what the opening asked for.
 *
 * The requisition's list is the denominator, never the applicant's rows: a person
 * who lists five skills the opening never asked for has met none of a list of
 * zero. An opening with no skill list gives back `null`, because an empty list is
 * a vacancy that never named its skills, not a vacancy that asked for none.
 */
function skillsOf(
  required: readonly RequiredSkill[],
  value: unknown
): ShortlistSkills | null {
  if (required.length === 0) return null;
  const demonstrated: DemonstratedSkill[] = rowsOf(value)
    .filter((row) => typeof row.skill_id === "string")
    .map((row) => ({
      skill_id: String(row.skill_id),
      proficiency: numberOf(row.proficiency) ?? Number.NaN,
    }));
  return skillMatchSummary(matchRequiredSkills(required, demonstrated, []));
}

/**
 * Turn one raw applicant row into the signals the ranker consumes.
 *
 * `scoresHidden` is the caller's mask predicate, applied here rather than inside
 * the ranker so the withheld figures never cross into the screen's props at all —
 * the same reason the applicants list nulls the two scores in the action. The
 * requisition's required skills are passed in because they belong to the opening,
 * not to any one application, and one read of them serves the whole list.
 */
export function shortlistSignals(
  row: ShortlistRow,
  required: readonly RequiredSkill[],
  context: { scoresHidden?: boolean } = {}
): ApplicantSignals {
  const scoresHidden = context.scoresHidden === true;
  const answers = parseGateAnswers(row.gate_answers);

  return {
    applicationId: typeof row.id === "string" ? row.id : "",
    name: labelOf(row.full_name),
    stage: labelOf(row.stage) || "NEW",
    aiScore: scoresHidden ? null : numberOf(row.ai_match_score),
    skills: skillsOf(required, row.candidate_skills),
    gate:
      answers.length === 0
        ? null
        : {
            passed: answers.filter((answer) => answer.passed).length,
            failed: answers.filter((answer) => !answer.passed).length,
          },
    test: paperOf(row.candidate_attempts, scoresHidden),
    interview: panelOf(row.interview_schedules, scoresHidden),
  };
}
