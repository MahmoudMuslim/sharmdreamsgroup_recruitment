/**
 * Where one paper sits among the papers the same suite produced.
 *
 * A mark on its own says nothing: 17/40 tells a recruiter only that the paper was
 * worth 40, not whether the candidate did well. The same number read as "at or
 * above 9 of the 12 graded papers on this suite" is a comparison a person can act
 * on — and it is the only kind of claim this module makes, because nothing in the
 * repo stores a norm group, a target score or a grade boundary.
 *
 * Pure by design, like the issued-links board and the suite search: the server
 * read counts the rows, this file decides what may be said about them, and a chat
 * answer and a console get the same words for the same counts.
 *
 * The population is deliberately narrow, and says so on screen:
 *
 * - **the same suite**, because a night-audit paper and a front-office paper are
 *   not the same test;
 * - **graded**, because an unmarked or half-marked paper has no place in a rank;
 * - **marked out of the same total**, because a suite's questions can be edited
 *   and its points re-weighted after people have sat it. Comparing a 40-mark
 *   paper with a 100-mark one would compare the marking scheme, not the candidate.
 *
 * That last rule is why the read counts with filters instead of pulling rows and
 * normalising percentages in memory: every paper in the population is on the same
 * scale, so raw marks are directly comparable and no rounding of a percentage can
 * move someone across the line.
 */

/**
 * Fewer graded papers than this and a percentile is noise.
 *
 * With three papers the only ranks available are 33, 67 and 100 — figures that
 * look like a measurement and are not one, so the console prints the count it
 * found and refuses the rank instead.
 */
export const MIN_BENCHMARK_POPULATION = 5;

/** The counts behind one benchmark, as the read found them. */
export interface BenchmarkCounts {
  /** The attempt's own marks. Null when it has none to rank. */
  score: number | null;
  /** The mark total its paper is out of — the scale the population shares. */
  max_score: number;
  /**
   * Graded papers on the same suite marked out of the same total, this one
   * included. Null when the count itself could not be made.
   */
  population: number | null;
  /** Of those, how many this paper is at or above — itself included. */
  at_or_above: number | null;
}

/** The counts, read. What every surface that prints a benchmark already has. */
export interface AttemptBenchmark extends BenchmarkCounts {
  /** Null when the counts refuse the claim — see `benchmarkNote`. */
  percentile: number | null;
  note: string;
}

/**
 * The percentile: what share of the population this paper is at or above.
 *
 * Null for anything that cannot be ranked — no marks, no count, or a population
 * too small to mean anything. A rank is never printed beside a count that does
 * not support it.
 */
export function percentileOf(counts: BenchmarkCounts): number | null {
  const { score, population, at_or_above } = counts;
  if (score === null || population === null || at_or_above === null) return null;
  if (population < MIN_BENCHMARK_POPULATION) return null;
  // Itself is always in both counts, so anything outside this range is a read
  // that disagreed with itself and must not become a number on screen.
  if (at_or_above < 1 || at_or_above > population) return null;
  return Math.round((at_or_above / population) * 100);
}

/** `1st`, `2nd`, `3rd`, `11th`, `21st` — the rank reads as a sentence, not a code. */
function ordinal(value: number): string {
  if (value % 100 >= 11 && value % 100 <= 13) return `${value}th`;
  const last = value % 10;
  if (last === 1) return `${value}st`;
  if (last === 2) return `${value}nd`;
  if (last === 3) return `${value}rd`;
  return `${value}th`;
}

/**
 * What the counts allow to be said, in one line.
 *
 * Either the rank with the population it was taken from, or the reason there is
 * no rank — never a bare em dash, because a recruiter cannot tell from silence
 * whether the data is missing or the claim was deliberately withheld.
 */
export function benchmarkNote(counts: BenchmarkCounts): string {
  const papers = (n: number) => `${n.toLocaleString()} graded paper${n === 1 ? "" : "s"}`;

  if (counts.score === null) {
    return "This paper has no marks yet, so there is nothing to rank it against.";
  }
  if (counts.population === null || counts.at_or_above === null) {
    return "The graded papers on this suite could not be counted, so no rank is given.";
  }
  if (counts.population < MIN_BENCHMARK_POPULATION) {
    return `Only ${papers(counts.population)} on this suite ${
      counts.population === 1 ? "is" : "are"
    } marked out of ${counts.max_score.toLocaleString()} — a rank needs at least ${MIN_BENCHMARK_POPULATION.toLocaleString()}, so none is claimed.`;
  }
  const percentile = percentileOf(counts);
  if (percentile === null) {
    return "The counts behind this rank did not agree, so no rank is given.";
  }
  return `At or above ${ordinal(percentile)} percentile of ${papers(
    counts.population
  )} on this suite, all marked out of ${counts.max_score.toLocaleString()}.`;
}

/**
 * The one shape both consoles and the chat print.
 *
 * Built here rather than at each call site so a screen cannot invent a friendlier
 * sentence than the counts support — the note and the number always come from the
 * same three figures.
 */
export function benchmarkOf(counts: BenchmarkCounts): AttemptBenchmark {
  return { ...counts, percentile: percentileOf(counts), note: benchmarkNote(counts) };
}
