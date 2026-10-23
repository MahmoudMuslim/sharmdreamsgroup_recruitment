/**
 * What a scoring rubric is, and what one set of bands adds up to.
 *
 * A case study and a recorded pitch are the two types whose marks were always a
 * judgement call. Without a rubric the call is still the grading prompt's: it
 * scores a written answer against five fixed words (analytical rigour, structure,
 * domain knowledge, feasibility, communication) and asks the model for a total. A
 * recruiter who cares about *this* role's criterion could not say so, and the
 * total the model returned was stored as the mark.
 *
 * A rubric moves both decisions to the person who set the question: named
 * criteria, the share of the question's marks each carries, and what a strong
 * answer shows. The model then does the one thing it is good at — reading the
 * answer and judging each criterion on its own — and this module does the
 * arithmetic, because a mark that adds up differently on the runner, the report
 * and the export is a mark nobody can defend.
 *
 * Two rules run through everything below.
 *
 * 1. The marks are recomputed here, never taken from the model. `scoreRubric`
 *    trusts a band only as far as it is a number in range; the total is the sum
 *    of what each criterion earned.
 * 2. A question with no rubric is not a question with an empty rubric. Papers
 *    written before this existed keep grading by the prompt's own judgement, so
 *    every reader starts by asking whether there is one at all.
 */

import type { QuestionConfig, QuestionType, RubricCriterion, RubricLine } from "@/types";

/** The fewest criteria worth calling a rubric — one is just a pass mark. */
export const MIN_RUBRIC_CRITERIA = 2;

/**
 * The most criteria a reviewer can read and a model can score honestly.
 *
 * Past this the grading prompt spends more room naming criteria than reading the
 * answer, and the review drawer becomes a wall of rows.
 */
export const MAX_RUBRIC_CRITERIA = 6;

/** What a whole question is worth, so the author writes shares not fractions. */
export const RUBRIC_WEIGHT_TOTAL = 100;

/** A question whose marks an author splits across criteria of their own naming. */
export type RubricType = Extract<QuestionType, "CASE_STUDY" | "VIDEO_PITCH">;

/**
 * The types whose marks a recruiter splits across their own criteria.
 *
 * A quiz has one right option and a scene a score per response, so both already
 * carry their whole marking scheme in their options.
 */
const RUBRIC_TYPES: RubricType[] = ["CASE_STUDY", "VIDEO_PITCH"];

/**
 * Whether a type's marks are split across an author's own criteria.
 *
 * The editor renders its marking-scheme panel on this and the writer reads the
 * draft on the same rule, so a form cannot offer a scheme the store would ignore
 * — or send rows for a type that has none. It narrows, because the form that
 * offers the panel then has to name the one note that belongs to that type.
 */
export function isRubricType(type: QuestionType): type is RubricType {
  return RUBRIC_TYPES.includes(type as RubricType);
}

/** A draft row as the editor and the assistant send it. */
export interface RubricDraftRow {
  label?: unknown;
  weight?: unknown;
  description?: unknown;
}

/** What an author may save, or the sentence saying they may not. */
export type RubricDraftResult =
  | { ok: true; criteria: RubricCriterion[] }
  | { ok: false; error: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A weight the author may save, or null when the row does not carry one. */
function readWeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 1 || value > RUBRIC_WEIGHT_TOTAL) return null;
  return value;
}

/**
 * Validate the criteria an author is saving.
 *
 * A row with neither a name nor a weight was never meant to be a criterion, so
 * it is dropped — that is what "add another, then change your mind" looks like.
 * A row with a weight and no name is a mistake worth naming, because the label
 * is the handle a mark is matched by: a criterion nobody can read is a criterion
 * whose marks go nowhere.
 *
 * The weights must add to exactly 100. They could be normalised instead, but a
 * rubric the author meant as 50/50 that was saved as 40/40 is a rubric they did
 * not write, and a refusal that quotes the sum they typed is a faster conversation
 * than a silent correction.
 */
export function readRubricDraft(
  rows: readonly RubricDraftRow[] | null | undefined
): RubricDraftResult {
  const filled = (rows ?? []).filter(
    (row) => text(row?.label).length > 0 || readWeight(row?.weight) !== null
  );

  if (filled.length < MIN_RUBRIC_CRITERIA) {
    return {
      ok: false,
      error: `A rubric needs at least two criteria the marks are split between — this has ${filled.length}.`,
    };
  }
  if (filled.length > MAX_RUBRIC_CRITERIA) {
    return {
      ok: false,
      error: `A rubric holds at most ${MAX_RUBRIC_CRITERIA} criteria — this has ${filled.length}. Merge the ones you grade together.`,
    };
  }

  const criteria: RubricCriterion[] = [];
  for (const row of filled) {
    const label = text(row.label);
    if (!label) {
      return { ok: false, error: "Every criterion needs a name — it is how its mark is matched and reported." };
    }
    const weight = readWeight(row.weight);
    if (weight === null) {
      return {
        ok: false,
        error: `“${label}” needs a whole-number weight between 1 and ${RUBRIC_WEIGHT_TOTAL} — the share of the question's marks it carries.`,
      };
    }
    const description = text(row.description);
    criteria.push(
      description ? { label, weight, description } : { label, weight }
    );
  }

  const total = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (total !== RUBRIC_WEIGHT_TOTAL) {
    return {
      ok: false,
      error: `A rubric's weights add up to 100 so the shares read as percentages — these add up to ${total}.`,
    };
  }

  const seen = new Set(criteria.map((criterion) => criterion.label.toLowerCase()));
  if (seen.size !== criteria.length) {
    return {
      ok: false,
      error: "Two criteria have the same name. Each name is what a mark is matched to, so they cannot repeat.",
    };
  }

  return { ok: true, criteria };
}

/**
 * The criteria a stored row offers for marking, dropping what it cannot read.
 *
 * Tolerant on purpose: `config` is a jsonb column a migration, an import or a
 * hand edit can reach, and a paper should not fail to grade because one of four
 * criteria lost its weight. What survives is what is graded, and the review desk
 * shows the same list the grader did.
 */
export function rubricCriteriaOf(
  config: Pick<QuestionConfig, "rubric"> | null | undefined
): RubricCriterion[] {
  const stored = Array.isArray(config?.rubric) ? config.rubric : [];
  const criteria: RubricCriterion[] = [];
  for (const row of stored as readonly RubricDraftRow[]) {
    if (!row || typeof row !== "object") continue;
    const label = text(row.label);
    const weight = readWeight(row.weight);
    if (!label || weight === null) continue;
    const description = text(row.description);
    criteria.push(description ? { label, weight, description } : { label, weight });
  }
  return criteria;
}

/**
 * Split the question's marks across the criteria, in whole marks.
 *
 * Weights are shares of the rubric, not of the question: a 15-mark question with
 * a 40% criterion is worth 6 marks there and nothing else. Rounding each share
 * on its own would let the parts add to 14 or 16, and a candidate would be short
 * or over the question's ceiling because of a rounding order. So the largest
 * fractions are paid first until the whole question is allocated — the parts sum
 * to the total by construction, and a tie is settled by weight, then by the
 * author's own order.
 *
 * The denominator is the weights as stored, not 100, so a hand-edited row that
 * sums to 90 still spends exactly the question's marks rather than losing 10% of
 * them.
 */
export function rubricAllowances(points: number, criteria: readonly RubricCriterion[]): number[] {
  if (criteria.length === 0) return [];
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (totalWeight <= 0 || !Number.isFinite(points) || points <= 0) {
    return criteria.map(() => 0);
  }

  const exact = criteria.map((criterion) => (points * criterion.weight) / totalWeight);
  const allowances = exact.map((value) => Math.floor(value));
  const spare = points - allowances.reduce((sum, value) => sum + value, 0);

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value), weight: criteria[index].weight }))
    .sort((a, b) =>
      b.fraction - a.fraction || b.weight - a.weight || a.index - b.index
    );

  for (const entry of byFraction.slice(0, Math.max(0, spare))) {
    allowances[entry.index] += 1;
  }
  return allowances;
}

/** One criterion's band, as the grading model returns it. */
export interface RubricBand {
  criterion?: unknown;
  percent?: unknown;
  evidence?: unknown;
}

/** The marks a rubric produced, or the reason it produced none. */
export type RubricScore =
  | {
      ok: true;
      total: number;
      max: number;
      lines: RubricLine[];
    }
  | { ok: false; error: string };

function readPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > RUBRIC_WEIGHT_TOTAL) return null;
  return value;
}

/**
 * Mark a set of bands against the question's own rubric.
 *
 * A band is matched to a criterion by name, exactly. A near match is not a
 * match: the model that returns "Structure and flow" for a criterion called
 * "Structure" has told us something about its reading, and inventing the
 * alignment would quietly move marks between criteria the recruiter weighted by
 * hand. So an unmatched name, a repeated name, or a criterion the model skipped
 * is a refusal the grading pass treats as a failed answer rather than a mark.
 *
 * Nothing here reads a total the model proposed. `total` is the sum of the
 * lines, and it cannot exceed the question's points because the allowances do.
 */
export function scoreRubric(
  points: number,
  criteria: readonly RubricCriterion[],
  bands: readonly RubricBand[] | null | undefined
): RubricScore {
  if (criteria.length === 0) {
    return { ok: false, error: "This question has no rubric criteria to mark against." };
  }

  const byName = new Map<string, { criterion: RubricCriterion; index: number }>();
  criteria.forEach((criterion, index) => {
    byName.set(criterion.label.toLowerCase(), { criterion, index });
  });

  const earned = new Map<number, { percent: number; evidence: string | null }>();
  const seen = new Set<number>();

  for (const band of bands ?? []) {
    const name = text(band?.criterion);
    if (!name) {
      return { ok: false, error: "A criterion was returned without a name to match it to." };
    }
    const match = byName.get(name.toLowerCase());
    if (!match) {
      return {
        ok: false,
        error: `“${name}” is not a criterion of this question, so its mark has nowhere to go.`,
      };
    }
    if (seen.has(match.index)) {
      return { ok: false, error: `“${match.criterion.label}” was scored twice.` };
    }
    const percent = readPercent(band.percent);
    if (percent === null) {
      return {
        ok: false,
        error: `“${match.criterion.label}” did not come back with an effectiveness of 0–100.`,
      };
    }
    seen.add(match.index);
    earned.set(match.index, { percent, evidence: text(band.evidence) || null });
  }

  const missing = criteria.find((_criterion, index) => !seen.has(index));
  if (missing) {
    return {
      ok: false,
      error: `“${missing.label}” was not scored, so the rubric cannot be added up.`,
    };
  }

  const allowances = rubricAllowances(points, criteria);
  const lines: RubricLine[] = criteria.map((criterion, index) => {
    const band = earned.get(index) as { percent: number; evidence: string | null };
    const allowance = allowances[index];
    return {
      label: criterion.label,
      weight: criterion.weight,
      allowance,
      percent: band.percent,
      marks: Math.round((allowance * band.percent) / RUBRIC_WEIGHT_TOTAL),
      evidence: band.evidence,
      ...(criterion.description ? { description: criterion.description } : {}),
    };
  });

  return {
    ok: true,
    total: lines.reduce((sum, line) => sum + line.marks, 0),
    max: allowances.reduce((sum, marks) => sum + marks, 0),
    lines,
  };
}

/** What the review desk and the candidate's feedback read. */
export interface RubricEvaluationCopy {
  rationale: string;
  strengths: string[];
  improvements: string[];
}

/**
 * Put a rubric's marks into the three fields an evaluation already has.
 *
 * A criterion paid in full is the strength, and anything short of full is the
 * improvement — with the marks left on the table named, because "be more
 * structured" is advice a candidate cannot spend. There is no threshold here on
 * purpose: the question's own weighting is the only standard a reviewer agreed
 * to.
 *
 * A recorded pitch says what was scored from the transcript alone. The model
 * never sees the video, so presence, dress and delivery are not marks anyone
 * earned here, and a rationale that omitted that would read as though they were
 * judged and found flat.
 */
export function rubricEvaluation(
  score: Extract<RubricScore, { ok: true }>,
  options: { transcriptOnly?: boolean } = {}
): RubricEvaluationCopy {
  const shares = score.lines
    .map((line) => `“${line.label}” ${line.marks} of ${line.allowance}`)
    .join(", ");

  const rationale =
    `Marked against ${score.lines.length} criteria the question sets: ${shares} — ` +
    `${score.total} of ${score.max} marks.` +
    (options.transcriptOnly
      ? " Scored from the transcript of what was said; presence, dress and delivery are not in it and stay with a reviewer."
      : "");

  return {
    rationale,
    strengths: score.lines
      .filter((line) => line.percent >= RUBRIC_WEIGHT_TOTAL)
      .map((line) =>
        line.evidence
          ? `“${line.label}” — full marks (${line.marks} of ${line.allowance}): ${line.evidence}`
          : `“${line.label}” — full marks (${line.marks} of ${line.allowance}).`
      ),
    improvements: score.lines
      .filter((line) => line.percent < RUBRIC_WEIGHT_TOTAL)
      .map((line) => {
        const short = `${line.allowance - line.marks} marks short (${line.marks} of ${line.allowance})`;
        const guidance = line.description ? ` What it asks for: ${line.description}.` : "";
        return line.evidence
          ? `“${line.label}” — ${short}: ${line.evidence}.${guidance}`
          : `“${line.label}” — ${short}.${guidance}`;
      }),
  };
}
