/**
 * What each question in a suite did to the papers that sat it.
 *
 * A suite total says how a candidate did. These two figures are about the test:
 *
 * - **difficulty** — the share of its points candidates earned on this question.
 *   A 95% item is one almost everyone answered; a 20% item is hard, badly worded
 *   or badly marked, and nothing here can tell you which.
 * - **discrimination** — the gap, in percentage points of the item, between the
 *   papers that scored highest overall and those that scored lowest. A positive
 *   gap is a question doing its job: the strong papers out-earn the weak ones on
 *   it. A negative gap means the weakest papers did better, which is a flag on the
 *   item — a giveaway answer, a trick wording, a question only one kind of
 *   candidate understood.
 *
 * Both come out of `candidate_responses` rows the portal already writes, so no
 * column, no norm group and no outside calibration is needed — and that is also
 * the limit of what may be said. There is no stored target difficulty in this
 * repo, so an item is never called "too hard" or "too easy": the figures print
 * with the count they came from and the split they were taken over, and a count
 * too small to mean anything gets the count instead of a number.
 *
 * Pure by design, like `benchmark.ts`: the read gathers the rows, this file
 * decides what may be said about them.
 *
 * The halves are cut on the paper, not on the item. A suite can be re-weighted
 * after people have sat it, so two papers with different mark totals are not
 * comparable in raw marks and each paper is placed by its share of the total it
 * was marked out of. That normalisation only ever orders the papers: every item
 * figure is earned ÷ available on that item's own scale, so no rounding of a
 * paper percentage can move an item's difficulty.
 */

/**
 * Fewer graded answers than this and neither figure is a measurement.
 *
 * A difficulty taken off two answers is a description of two people, and the
 * top-versus-bottom gap needs two answers on each side before it is more than the
 * luck of which two papers happened to be compared. The floor is the same reason
 * `benchmark.ts` refuses a percentile on fewer than five papers.
 */
export const MIN_ITEM_STATISTICS = 5;

/** At least this many graded answers on each side of the split before a gap is printed. */
const MIN_PER_GROUP = 2;

/** One graded answer, with just enough of its paper to place that paper. */
export interface ItemResponseRow {
  question_id: string;
  attempt_id: string;
  /** Marks this answer earned. Null rows are unmarked and carry no figure. */
  score: number | null;
  /** The points this question was worth on that paper. */
  max_score: number | null;
  /** The paper this answer belongs to, so it can be ranked among its suite. */
  attempt_total: number | null;
  attempt_max: number | null;
}

/** What one question did, and the only shape any screen may print from it. */
export interface ItemStatistics {
  question_id: string;
  /** Graded answers to this item — the base every figure here is taken from. */
  answers: number;
  /** Graded papers the suite's two halves were cut from. */
  papers: number;
  /** 0–100 share of available points earned; null when the base refuses it. */
  difficulty_pct: number | null;
  top_pct: number | null;
  bottom_pct: number | null;
  /** `top_pct - bottom_pct`, negative when the weakest papers out-earned the strongest. */
  discrimination_pct_points: number | null;
  note: string;
}

/** A share of points, or null when there is no scale to take one on. */
function share(earned: number, available: number): number | null {
  if (!(available > 0)) return null;
  return Math.round((earned / available) * 100);
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/**
 * The one line this item's counts allow.
 *
 * Either both figures with their bases, or the reason a figure is missing — never
 * a bare em dash, because silence cannot be told apart from a withheld claim.
 */
function itemNote(args: {
  answers: number;
  papers: number;
  difficulty: number | null;
  topCount: number;
  bottomCount: number;
  top: number | null;
  bottom: number | null;
}): string {
  if (args.answers === 0) {
    return "No graded answer to this question yet, so there is nothing to measure.";
  }
  if (args.answers < MIN_ITEM_STATISTICS || args.difficulty === null) {
    return `Only ${plural(args.answers, "graded answer")} on this question — a difficulty figure needs at least ${MIN_ITEM_STATISTICS.toLocaleString()}, so none is claimed.`;
  }

  const difficultySentence = `Candidates earned ${args.difficulty}% of the points available on this question across ${plural(
    args.answers,
    "graded answer"
  )}.`;

  if (
    args.top === null ||
    args.bottom === null ||
    args.topCount < MIN_PER_GROUP ||
    args.bottomCount < MIN_PER_GROUP
  ) {
    return `${difficultySentence} No top-versus-bottom gap is claimed: the ${plural(
      args.papers,
      "graded paper"
    )} this suite splits into leave ${plural(args.topCount, "answer")} in the strongest group and ${plural(
      args.bottomCount,
      "answer"
    )} in the weakest, and two on each side are needed.`;
  }

  const gap = args.top - args.bottom;
  const gapSentence =
    gap >= 0
      ? `The ${plural(args.topCount, "answer")} from the strongest papers earned ${args.top}% and the ${plural(
          args.bottomCount,
          "answer"
        )} from the weakest earned ${args.bottom}%, so this question separates the two groups by ${gap} points.`
      : `The ${plural(args.topCount, "answer")} from the strongest papers earned ${args.top}% and the ${plural(
          args.bottomCount,
          "answer"
        )} from the weakest earned ${args.bottom}% — the weakest papers out-earned the strongest here by ${Math.abs(
          gap
        )} points, which is a flag on the question rather than on the candidates.`;

  return `${difficultySentence} ${gapSentence}`;
}

/**
 * Per-question difficulty and discrimination for one suite.
 *
 * Takes the suite's question ids (in the order they should be printed — an item
 * nobody answered is still listed, because a table that showed eight of ten
 * questions would be a silent claim about the other two) and every graded answer
 * rows the read found for them. Answers belonging to a question the suite no
 * longer names are dropped; the read counts those and says so.
 *
 * A paper counts toward the split only while it was marked whole: an attempt with
 * no total, or a total out of nothing, cannot be placed among its suite, though
 * its marked answers still count toward difficulty.
 */
export function itemStatisticsOf(
  questionIds: readonly string[],
  rows: readonly ItemResponseRow[]
): ItemStatistics[] {
  const known = new Set(questionIds);

  const paperShare = new Map<string, number>();
  for (const row of rows) {
    if (!known.has(row.question_id)) continue;
    if (row.attempt_max === null || row.attempt_total === null) continue;
    const max = Number(row.attempt_max);
    const total = Number(row.attempt_total);
    if (!(max > 0) || !Number.isFinite(total)) continue;
    // One paper, one placement — a second answer from the same paper must not
    // re-read its mark off a different row.
    if (!paperShare.has(row.attempt_id)) paperShare.set(row.attempt_id, total / max);
  }

  // Highest first, and by id at a tie so the same suite splits the same way twice.
  const ranked = [...paperShare.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );
  const half = Math.floor(ranked.length / 2);
  const top = new Set(ranked.slice(0, half).map(([id]) => id));
  const bottom = new Set(ranked.slice(ranked.length - half).map(([id]) => id));

  type Accumulator = {
    answers: number;
    earned: number;
    available: number;
    topAnswers: number;
    topEarned: number;
    topAvailable: number;
    bottomAnswers: number;
    bottomEarned: number;
    bottomAvailable: number;
  };
  const byQuestion = new Map<string, Accumulator>();
  const empty = (): Accumulator => ({
    answers: 0,
    earned: 0,
    available: 0,
    topAnswers: 0,
    topEarned: 0,
    topAvailable: 0,
    bottomAnswers: 0,
    bottomEarned: 0,
    bottomAvailable: 0,
  });

  for (const row of rows) {
    if (!known.has(row.question_id)) continue;
    const score = row.score === null ? null : Number(row.score);
    const max = row.max_score === null ? null : Number(row.max_score);
    // An unmarked answer has no figure, and a marked answer worth nothing is not a
    // small scale, it is a missing number — counting it would rank a question on a
    // divide by zero.
    if (score === null || !Number.isFinite(score) || !(max && max > 0)) continue;

    const item = byQuestion.get(row.question_id) ?? empty();
    item.answers += 1;
    item.earned += score;
    item.available += max;
    if (top.has(row.attempt_id)) {
      item.topAnswers += 1;
      item.topEarned += score;
      item.topAvailable += max;
    } else if (bottom.has(row.attempt_id)) {
      item.bottomAnswers += 1;
      item.bottomEarned += score;
      item.bottomAvailable += max;
    }
    byQuestion.set(row.question_id, item);
  }

  return questionIds.map((questionId) => {
    const item = byQuestion.get(questionId) ?? empty();
    const difficulty = share(item.earned, item.available);
    const enough = item.answers >= MIN_ITEM_STATISTICS && difficulty !== null;
    /* A half is printed only with the gap it belongs to. One side alone invites
     * the reader to subtract it in their head, which is the very claim these
     * counts refused — so both halves stay null unless the split qualifies. */
    const groups =
      item.topAnswers >= MIN_PER_GROUP && item.bottomAnswers >= MIN_PER_GROUP;
    const topPct = groups ? share(item.topEarned, item.topAvailable) : null;
    const bottomPct = groups ? share(item.bottomEarned, item.bottomAvailable) : null;
    const gap = topPct !== null && bottomPct !== null ? topPct - bottomPct : null;
    const note = itemNote({
      answers: item.answers,
      papers: ranked.length,
      difficulty: enough ? difficulty : null,
      topCount: item.topAnswers,
      bottomCount: item.bottomAnswers,
      top: enough ? topPct : null,
      bottom: enough ? bottomPct : null,
    });
    return {
      question_id: questionId,
      answers: item.answers,
      papers: ranked.length,
      difficulty_pct: enough ? difficulty : null,
      top_pct: enough ? topPct : null,
      bottom_pct: enough ? bottomPct : null,
      discrimination_pct_points: enough ? gap : null,
      note,
    };
  });
}
