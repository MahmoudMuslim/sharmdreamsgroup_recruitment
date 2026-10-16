/**
 * The candidates screen's filters and sort, in one implementation.
 *
 * The table applies them to the rows it loaded; an export applies them to
 * everything in the database. Two copies of the same predicate is how a
 * downloaded file ends up answering a different question than the screen it was
 * clicked from, so both sides come through here.
 *
 * Pure by design — no database, no `server-only` — so the client table and the
 * export reader can import it alike.
 */

export const PIPELINE_STAGES = [
  "NEW",
  "AI_SCREENING",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
] as const;

export const APPLICATION_SOURCES = [
  "LINKEDIN",
  "WHATSAPP",
  "JOB_BOARD",
  "CAREER_SITE",
  "REFERRAL",
  "ATS_IMPORT",
] as const;

export type CandidateSort = "recent" | "fit" | "name";

/**
 * The one attempt status that still owes somebody a decision.
 *
 * `GRADED` has its marks and `EXPIRED` means the link closed before an answer was
 * filed, so neither is waiting on anyone. `SUBMITTED` is what the grading engine
 * leaves an attempt in when it never finished scoring it — and nothing schedules
 * a second pass, so it waits for a person. The attention feed counts exactly
 * these, the candidates page lists them under `?ungraded=1`, and the download
 * carries the same filter, so the three share the words rather than restating
 * them.
 */
export const UNSCORED_ATTEMPT_STATUS = "SUBMITTED";

/** Embed + filter column that restrict *candidate* rows to ungraded attempts. */
export const UNGRADED_ATTEMPT_EMBED =
  "candidate_attempts!inner(access_token, status, total_score)";
export const UNGRADED_ATTEMPT_FILTER = "candidate_attempts.status";

/**
 * How many ungraded assessments the grading queue will list.
 *
 * A queue past this is not busy, it is broken — the engine grades on submit and
 * nothing re-runs it — so the page says which end of the list it is showing
 * instead of pretending a Bell count and a table are the same size. Shared
 * because the read that fills the queue and the view that explains its ceiling
 * are on opposite sides of the server/client line.
 */
export const GRADING_QUEUE_LIMIT = 200;

/**
 * How many rows the candidates table lists, in whichever view is open.
 *
 * The rail chips count the whole set behind the view, so a chip number is a
 * promise about rows the page can list — and past this ceiling it is not. The
 * view says so rather than letting a recruiter count forty rows under a chip
 * that said two hundred. It is the same size as the grading queue so the two
 * rails explain one ceiling, not two.
 */
export const CANDIDATE_ROW_LIMIT = 200;

/**
 * How far the rail counts read back to count stage and channel.
 *
 * One small-columns read beats a count query per stage, and it gives both rails
 * their numbers from the same set the table lists. Past this many applications
 * the counts stop being exact, so `truncated` carries that to the page and the
 * page says it out loud instead of printing a stale number as a fact.
 */
export const CANDIDATE_COUNT_SCAN_LIMIT = 2000;

/** A row small enough to count: the two columns the rails filter on. */
export interface CountableCandidate {
  stage: string;
  source: string;
}

/** What the rails are allowed to claim about the set behind the table. */
export interface CandidateTally {
  /** Applications in the set the view lists, live or archive. */
  total: number;
  /** Pipeline stage → how many sit there. */
  stages: Record<string, number>;
  /** Application source → how many came that way. */
  sources: Record<string, number>;
  /** True when the scan hit its ceiling, so these counts are a floor. */
  truncated: boolean;
}

/**
 * Count a set by stage and channel.
 *
 * Kept here rather than in the read so the client rail and the server action
 * tally the same way — and so the grading queue, which counts the rows it
 * actually loaded, uses this same function over a smaller set.
 */
export function tallyCandidates(rows: CountableCandidate[]): CandidateTally {
  const stages: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const row of rows) {
    stages[row.stage] = (stages[row.stage] ?? 0) + 1;
    sources[row.source] = (sources[row.source] ?? 0) + 1;
  }
  return {
    total: rows.length,
    stages,
    sources,
    truncated: rows.length >= CANDIDATE_COUNT_SCAN_LIMIT,
  };
}

export const CANDIDATE_SORTS: { key: CandidateSort; label: string }[] = [
  { key: "recent", label: "newest first" },
  { key: "fit", label: "highest AI fit first" },
  { key: "name", label: "name A-Z" },
];

/** The columns the search and the sort read. Anything richer is not filtered on. */
export interface FilterableCandidate {
  full_name: string;
  email: string;
  job_title: string | null;
  tracking_code: string;
  stage: string;
  source: string;
  ai_match_score: number | null;
}

export interface CandidateListFilters {
  stage: string | null;
  source: string | null;
  query: string | null;
  sort: CandidateSort;
}

export function isPipelineStage(value: unknown): string | null {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value)
    ? value
    : null;
}

export function isApplicationSource(value: unknown): string | null {
  return typeof value === "string" && (APPLICATION_SOURCES as readonly string[]).includes(value)
    ? value
    : null;
}

export function isCandidateSort(value: unknown): CandidateSort {
  return value === "fit" || value === "name" ? value : "recent";
}

function matches(row: FilterableCandidate, q: string): boolean {
  return (
    row.full_name.toLowerCase().includes(q) ||
    row.email.toLowerCase().includes(q) ||
    (row.job_title ?? "").toLowerCase().includes(q) ||
    row.tracking_code.toLowerCase().includes(q)
  );
}

/**
 * Keep the rows the recruiter is looking at.
 *
 * The search is a case-insensitive substring over four columns, deliberately
 * not an SQL `ILIKE`: a name containing `_` or `%` is a wildcard to Postgres and
 * a literal to `includes()`, so a pushed-down search would quietly match
 * candidates nobody typed.
 */
export function filterCandidates<T extends FilterableCandidate>(
  rows: readonly T[],
  filters: CandidateListFilters
): T[] {
  const q = (filters.query ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.stage && row.stage !== filters.stage) return false;
    if (filters.source && row.source !== filters.source) return false;
    return q === "" || matches(row, q);
  });
}

/** Newest-first input, because the read is ordered that way and "recent" must not reshuffle it. */
export function sortCandidates<T extends FilterableCandidate>(
  rows: readonly T[],
  sort: CandidateSort
): T[] {
  const copy = [...rows];
  if (sort === "fit") {
    copy.sort((a, b) => (b.ai_match_score ?? -1) - (a.ai_match_score ?? -1));
  } else if (sort === "name") {
    copy.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }
  return copy;
}

/** How a file was ordered, in the words its "Covers" line uses. */
export function candidateSortLabel(sort: CandidateSort): string {
  return CANDIDATE_SORTS.find((option) => option.key === sort)?.label ?? sort;
}
