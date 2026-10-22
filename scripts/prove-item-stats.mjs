/* scripts/prove-item-stats.mjs
 * Run: node --experimental-strip-types scripts/prove-item-stats.mjs
 *
 * Pins what `itemStatisticsOf` may say about a suite's questions. Every case is
 * a fixture — the local DB holds zero graded answers, so nothing here could be
 * proved against live rows. The cases that matter are the refusals: a table that
 * printed a difficulty off three answers, or one half of a top-versus-bottom
 * split without the other, would be a claim the counts do not support. */
import { itemStatisticsOf, MIN_ITEM_STATISTICS } from "../src/modules/assessment/domain/itemStats.ts";

/** Six graded papers, 90% down to 20%, so the halves are P1-P3 strong, P4-P6 weak. */
const PAPERS = [
  ["P1", 90], ["P2", 80], ["P3", 70], ["P4", 60], ["P5", 50], ["P6", 20],
];

/** A graded answer on one of those papers. */
const row = (question, paper, score, max, total = paperTotals[paper], attemptMax = 100) => ({
  question_id: question,
  attempt_id: paper,
  score,
  max_score: max,
  attempt_total: total,
  attempt_max: total === null ? null : attemptMax,
});

const paperTotals = Object.fromEntries(PAPERS.map(([id, total]) => [id, total]));

const ids = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9"];
const rows = [];

/* q1 — every paper answered it, 10/9/8 at the top and 6/5/4 at the bottom.
 * Difficulty 42/60 = 70%, halves 90 vs 50, gap +40. */
[10, 9, 8, 6, 5, 4].forEach((score, i) => rows.push(row("q1", PAPERS[i][0], score, 10)));

/* q2 — the reversed item: the weakest papers out-earned the strongest.
 * Difficulty 36/60 = 60%, halves 30 vs 90, gap -60. */
[2, 3, 4, 8, 9, 10].forEach((score, i) => rows.push(row("q2", PAPERS[i][0], score, 10)));

/* q3 — four graded answers, one short of the floor: no figure, the count instead. */
[8, 7, 6, 5].forEach((score, i) => rows.push(row("q3", PAPERS[i][0], score, 10)));

/* q4 — named by the suite, never answered. */

/* q5 — six graded answers, but four sit on papers whose total was never written,
 * so only one answer lands in each half. Difficulty still prints (it does not
 * need the split); the gap and both halves refuse. */
rows.push(row("q5", "P7", 1, 10, null), row("q5", "P8", 2, 10, null),
  row("q5", "P9", 3, 10, null), row("q5", "P10", 4, 10, null),
  row("q5", "P1", 5, 10), row("q5", "P6", 6, 10));

/* q6 — five rows, one unmarked and one worth zero points, so three count. */
rows.push(row("q6", "P1", 10, 10), row("q6", "P2", 10, 10), row("q6", "P3", 10, 10),
  row("q6", "P4", null, 10), row("q6", "P5", 10, 0));

/* q7 — the same suite on different scales per paper (10, 20, 10, 20, 10, 20).
 * Ranking is by each paper's own share, every item figure on the item's scale:
 * 40/90 = 44% overall, halves 35/40 = 88% and 5/50 = 10%, gap 78. */
[[10, 10], [20, 20], [5, 10], [0, 20], [0, 10], [5, 20]].forEach(([score, max], i) =>
  rows.push(row("q7", PAPERS[i][0], score, max))
);

/* q8 — two graded answers, one on a paper marked out of nothing (50 of 0) and
 * one on a paper with no total at all. Neither paper can be placed among its
 * suite, and two answers fall short of the difficulty floor in any case. */
rows.push(row("q8", "P15", 5, 10, 50, 0), row("q8", "P16", 5, 10, null, null));

/* q9 — six graded answers, every one on a paper this read never placed.
 * Difficulty prints from all six (21/60 = 35%) and the split refuses off the
 * suite's six ranked papers with 0 answers on each side. */
[1, 2, 3, 4, 5, 6].forEach((score, i) =>
  rows.push(row("q9", `X${i}`, score, 10, null, null))
);

/* A question the suite no longer names — dropped from the table, not listed. */
[8, 7, 6, 5, 4].forEach((score, i) => rows.push(row("ghost", PAPERS[i][0], score, 10)));

const byId = new Map(itemStatisticsOf(ids, rows).map((item) => [item.question_id, item]));
const second = new Map(itemStatisticsOf(ids, rows).map((item) => [item.question_id, item]));

let bad = 0;
function check(name, actual, expected) {
  if (actual !== expected) {
    bad++;
    console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
}

/* The table lists the suite's questions, in order, and no ghost. */
check("row count", byId.size, ids.length);
check("order", itemStatisticsOf(ids, rows).map((i) => i.question_id).join(","), ids.join(","));

/* q1 — both figures claimed, from the bases they name. */
check("q1 answers", byId.get("q1").answers, 6);
check("q1 papers", byId.get("q1").papers, 6);
check("q1 difficulty", byId.get("q1").difficulty_pct, 70);
check("q1 top", byId.get("q1").top_pct, 90);
check("q1 bottom", byId.get("q1").bottom_pct, 50);
check("q1 gap", byId.get("q1").discrimination_pct_points, 40);
check(
  "q1 note",
  byId.get("q1").note,
  "Candidates earned 70% of the points available on this question across 6 graded answers. " +
    "The 3 answers from the strongest papers earned 90% and the 3 answers from the weakest earned 50%, " +
    "so this question separates the two groups by 40 points."
);

/* q2 — a negative gap is printed as a flag, never softened. */
check("q2 difficulty", byId.get("q2").difficulty_pct, 60);
check("q2 top", byId.get("q2").top_pct, 30);
check("q2 bottom", byId.get("q2").bottom_pct, 90);
check("q2 gap", byId.get("q2").discrimination_pct_points, -60);
check("q2 note flags", byId.get("q2").note.includes("the weakest papers out-earned the strongest here by 60 points"), true);

/* q3 — below the floor: no figure at all, and the count in its place. */
check("q3 answers", byId.get("q3").answers, 4);
check("q3 difficulty", byId.get("q3").difficulty_pct, null);
check("q3 note", byId.get("q3").note,
  `Only 4 graded answers on this question — a difficulty figure needs at least ${MIN_ITEM_STATISTICS}, so none is claimed.`);

/* q4 — an unanswered question is still listed, with the reason. */
check("q4 answers", byId.get("q4").answers, 0);
check("q4 difficulty", byId.get("q4").difficulty_pct, null);
check("q4 note", byId.get("q4").note, "No graded answer to this question yet, so there is nothing to measure.");

/* q5 — difficulty prints from all six; the split refuses, and NEITHER half is
 * printed with it. One side alone would be a gap the reader could compute. */
check("q5 answers", byId.get("q5").answers, 6);
check("q5 difficulty", byId.get("q5").difficulty_pct, 35);
check("q5 top", byId.get("q5").top_pct, null);
check("q5 bottom", byId.get("q5").bottom_pct, null);
check("q5 gap", byId.get("q5").discrimination_pct_points, null);
check("q5 note halves", byId.get("q5").note.startsWith("Candidates earned 35%"), true);
check("q5 note refusal", byId.get("q5").note.includes("No top-versus-bottom gap is claimed"), true);
check("q5 note counts", byId.get("q5").note.includes("leave 1 answer in the strongest group and 1 answer in the weakest"), true);

/* q6 — 5 rows but 3 graded answers: the floor counts answers, not rows. */
check("q6 answers", byId.get("q6").answers, 3);
check("q6 difficulty", byId.get("q6").difficulty_pct, null);

/* q7 — the halves are cut on each paper's own share, the figures stay on the
 * item's own scale. */
check("q7 difficulty", byId.get("q7").difficulty_pct, 44);
check("q7 top", byId.get("q7").top_pct, 88);
check("q7 bottom", byId.get("q7").bottom_pct, 10);
check("q7 gap", byId.get("q7").discrimination_pct_points, 78);

/* q8 — the papers exist but not on a usable scale, so no half is populated. */
check("q8 answers", byId.get("q8").answers, 2);
check("q8 difficulty", byId.get("q8").difficulty_pct, null);
check("q8 note", byId.get("q8").note,
  `Only 2 graded answers on this question — a difficulty figure needs at least ${MIN_ITEM_STATISTICS}, so none is claimed.`);

/* q9 — difficulty prints from six answers the split can never place: an answer
 * on a paper with no usable total still says something about the item, but it
 * must not land a candidate in a half they were never ranked into. */
check("q9 answers", byId.get("q9").answers, 6);
check("q9 difficulty", byId.get("q9").difficulty_pct, 35);
check("q9 top", byId.get("q9").top_pct, null);
check("q9 bottom", byId.get("q9").bottom_pct, null);
check("q9 gap", byId.get("q9").discrimination_pct_points, null);
check(
  "q9 note",
  byId.get("q9").note,
  "Candidates earned 35% of the points available on this question across 6 graded answers. " +
    "No top-versus-bottom gap is claimed: the 6 graded papers this suite splits into leave " +
    "0 answers in the strongest group and 0 answers in the weakest, and two on each side are needed."
);

/* The same rows twice give the same table — the tie-break is by paper id. */
check("deterministic", JSON.stringify([...second.entries()]), JSON.stringify([...byId.entries()]));

if (bad) {
  console.error(`${bad} item-statistics assertion(s) failed`);
  process.exit(1);
}
console.log(`item statistics: ${ids.length} fixtures, all assertions passed`);
