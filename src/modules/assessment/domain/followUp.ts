/**
 * When finishing one test should send a candidate on to the next.
 *
 * The rule belongs to the suite that was just sat: a percent band of its own
 * marks, an inclusive bottom and top, and the suite to issue when the score
 * lands inside it. The arithmetic lives here rather than in the router, the
 * suite editor and the assistant separately, so the percentage the router
 * compares is the percentage the editor previewed and the sentence the
 * assistant reads is the sentence the card prints.
 *
 * Bands are percentages, not raw scores. A recruiter writing "70 to 90" on a
 * suite whose questions are later re-marked should keep meaning 70 to 90, and
 * two suites with different point totals should be comparable. An inclusive
 * band on both ends is deliberate: 85–85 means "exactly 85", and 0–100 means
 * "everyone who finishes".
 *
 * The columns behind this rule are added by
 * `db/migrations/035_assessment_follow_ups.sql`, which is authored and not
 * applied. Every door probes for them and names that file while they are
 * missing; nothing here touches the database.
 */

/** The file that adds the rule columns and the attempt link. Authored, not applied. */
export const FOLLOW_UP_MIGRATION = "db/migrations/035_assessment_follow_ups.sql";

/** What the suite editor and the assistant say while the columns are missing. */
export const FOLLOW_UP_SCHEMA_NOTE =
  "Second-test routing has not been added to this database yet — db/migrations/035_assessment_follow_ups.sql is authored but not applied. Every other suite setting works normally.";

/** What a save that carried a rule is told while the columns are missing. */
export const FOLLOW_UP_WRITE_REFUSAL =
  "The suite itself was saved, but its second-test rule was not: db/migrations/035_assessment_follow_ups.sql is authored but not applied.";

/**
 * Whether an error means the follow-up columns are not on this database.
 *
 * Two shapes, because the same absence is reported by two layers: Postgres
 * itself answers 42703 when a select names the missing column, and PostgREST
 * answers PGRST204 from its schema cache before the query reaches Postgres.
 * The message check catches a driver that reports either without a code.
 */
export function isMissingFollowUpColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .*follow_up|follow_up_.* does not exist|Could not find the '.*follow_up.*' column/i.test(
      error.message ?? ""
    )
  );
}

/** A rule as stored: the target suite and the inclusive percent band. */
export interface FollowUpRule {
  templateId: string;
  /** Inclusive; 0 is the floor. */
  minPercent: number;
  /** Inclusive; 100 is the ceiling. */
  maxPercent: number;
}

/** The three nullable columns, as any reader receives them. */
export interface FollowUpRuleRow {
  follow_up_template_id?: string | null;
  follow_up_min_percent?: number | string | null;
  follow_up_max_percent?: number | string | null;
}

/**
 * The rule a row carries, or null when it carries none.
 *
 * A half-written row is null rather than a guess: the database's
 * `assessment_templates_follow_up_complete_check` refuses one, so seeing it
 * here means the row predates the constraint or was written around it, and
 * inventing a band for it is how a candidate gets sent somewhere nobody chose.
 */
export function readFollowUpRule(row: FollowUpRuleRow | null | undefined): FollowUpRule | null {
  const templateId = row?.follow_up_template_id ?? null;
  const min = readPercent(row?.follow_up_min_percent);
  const max = readPercent(row?.follow_up_max_percent);
  if (!templateId || min === null || max === null) return null;
  if (min > max) return null;
  return { templateId, minPercent: min, maxPercent: max };
}

/** A stored percentage as the nearest whole 0–100 number, or null when the value cannot be one. */
function readPercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const whole = Math.round(numeric);
  if (whole < 0 || whole > 100) return null;
  return whole;
}

/**
 * A percentage as typed into the editor, or null when it is not a whole
 * 0–100 number.
 *
 * Stricter than `readPercent`: a stored row may hold 70.5 from a hand-run
 * statement and is rounded so the router can still act on it, but a typed band
 * is a decision the author is making right now. Turning 70.5 into 71 would
 * move a candidate the author did not mean to move, and rounding down would
 * keep one they meant to. The sentence the refusal prints promises whole
 * numbers, so the check has to keep that promise.
 */
function readTypedPercent(value: string): number | null {
  if (value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100) return null;
  return numeric;
}

/**
 * What an attempt's marks are as a percentage of what was possible.
 *
 * Rounded once, the same way every other percentage on this console is: a paper
 * worth 37 of 50 is 74%, and a band written 70–90 must not turn that into 73.9
 * somewhere and 74 somewhere else. Null when the suite carried no marks at all —
 * there is no percentage of nothing, and a 0–100 band must not treat an empty
 * paper as a zero.
 */
export function followUpPercent(
  total: number | null | undefined,
  max: number | null | undefined
): number | null {
  if (total === null || total === undefined || max === null || max === undefined) return null;
  if (!Number.isFinite(total) || !Number.isFinite(max) || max <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((total / max) * 100)));
}

/** Both ends inclusive: 85 sits in 70–90 and in 85–85. */
export function inFollowUpBand(percent: number, rule: FollowUpRule): boolean {
  return percent >= rule.minPercent && percent <= rule.maxPercent;
}

/** How a band reads on a card and in a sentence: "70–90%". */
export function followUpBandText(rule: Pick<FollowUpRule, "minPercent" | "maxPercent">): string {
  return `${rule.minPercent}\u2013${rule.maxPercent}%`;
}

/** The sentence a suite card prints, e.g. "70–90% moves on to Technical model". */
export function describeFollowUpRule(rule: FollowUpRule, targetName: string): string {
  return `${followUpBandText(rule)} moves on to ${targetName}`;
}

/* ---- authoring ---- */

/** The rule as the suite form holds it: the target id and the band as typed. */
export interface FollowUpRuleInput {
  templateId: string;
  minPercent: string;
  maxPercent: string;
}

export type FollowUpRuleRead =
  | { ok: true; rule: FollowUpRule | null }
  | { ok: false; error: string };

/**
 * Reads the three fields the suite editor submits.
 *
 * An empty target clears the rule only when the band is empty beside it. Half a
 * rule is refused rather than tightened into something the author did not
 * write: a target without a band would route every candidate, and a band
 * without a target is a promise the router cannot keep.
 */
export function readFollowUpRuleInput(
  input: FollowUpRuleInput,
  selfId: string | null
): FollowUpRuleRead {
  const templateId = input.templateId.trim();
  const minText = input.minPercent.trim();
  const maxText = input.maxPercent.trim();
  const noBand = minText === "" && maxText === "";

  if (!templateId) {
    if (noBand) return { ok: true, rule: null };
    return {
      ok: false,
      error:
        "Choose the suite a candidate should be sent to, or clear the band to switch the second test off.",
    };
  }

  if (noBand) {
    return {
      ok: false,
      error:
        "Give the score band as two percentages from 0 to 100 — the marks that should earn the second test.",
    };
  }

  const min = readTypedPercent(minText);
  const max = readTypedPercent(maxText);
  if (min === null || max === null) {
    return { ok: false, error: "Both ends of the band must be whole numbers from 0 to 100." };
  }
  if (min > max) {
    return { ok: false, error: "The bottom of the band cannot be above its top." };
  }
  if (selfId && templateId === selfId) {
    return {
      ok: false,
      error: "A suite cannot send a candidate back to itself. Choose a different second test.",
    };
  }

  return { ok: true, rule: { templateId, minPercent: min, maxPercent: max } };
}

/**
 * The chain a new rule would create, or null when it closes no loop.
 *
 * `targetOf` is every suite's own target, read once by the caller. Adding
 * "this suite → that suite" is a loop exactly when following targets from
 * *that* suite already arrives back at *this* one. The returned list names the
 * suites in order, ending where it started, so the refusal can print the path
 * instead of only saying "cycle".
 *
 * A loop that does not touch the source is not this edit's doing, and is left
 * alone — the guard is here to stop a recruiter creating one, not to audit
 * rules written before the guard existed.
 */
export function followUpLoop(
  sourceId: string,
  targetId: string,
  targetOf: ReadonlyMap<string, string | null>
): string[] | null {
  const chain = [sourceId];
  const seen = new Set([sourceId]);
  let cursor: string | null = targetId;

  while (cursor) {
    chain.push(cursor);
    if (cursor === sourceId) return chain;
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    if (chain.length > 20) return null;
    cursor = targetOf.get(cursor) ?? null;
  }

  return null;
}
