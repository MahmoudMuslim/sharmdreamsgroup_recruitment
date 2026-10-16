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
 * How far the rail counts read back to count stage, channel and company.
 *
 * One small-columns read beats a count query per stage, and it gives all three
 * rails their numbers from the same set the table lists. Past this many applications
 * the counts stop being exact, so `truncated` carries that to the page and the
 * page says it out loud instead of printing a stale number as a fact.
 */
export const CANDIDATE_COUNT_SCAN_LIMIT = 2000;

/** A row small enough to count: the columns the three rails filter on, and whose role it is. */
export interface CountableCandidate {
  stage: string;
  source: string;
  /** The company the application's opening sits under, resolved from `job_openings`. */
  tenant_id: string | null;
  company_name: string | null;
}

/** One company on the rail: the id the URL carries, the name a recruiter reads, its share. */
export interface CandidateRailCompany {
  id: string;
  name: string;
  count: number;
}

/** What the rails are allowed to claim about the set behind the table. */
export interface CandidateTally {
  /** Applications in the set the view lists, live or archive. */
  total: number;
  /** Pipeline stage → how many sit there. */
  stages: Record<string, number>;
  /** Application source → how many came that way. */
  sources: Record<string, number>;
  /** Companies with at least one application in the set, busiest first. */
  companies: CandidateRailCompany[];
  /** True when the scan hit its ceiling, so these counts are a floor. */
  truncated: boolean;
}

/**
 * Group a set by the company its openings belong to.
 *
 * A row whose opening came back with no company is left out of the rail rather
 * than filed under a name nobody chose: `applications.job_id` and
 * `job_openings.tenant_id` are both `not null`, so the only way an embed is empty
 * is an opening this session cannot read — and counting that as a company would
 * invent a group no one can click. `total` still counts every row.
 */
export function tallyCompanies(rows: readonly CountableCandidate[]): CandidateRailCompany[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    if (!row.tenant_id || !row.company_name) continue;
    const seen = counts.get(row.tenant_id);
    counts.set(row.tenant_id, { name: row.company_name, count: (seen?.count ?? 0) + 1 });
  }
  return [...counts.entries()]
    .map(([id, { name, count }]) => ({ id, name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * What the rails are allowed to claim about the set behind the table.
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
    companies: tallyCompanies(rows),
    truncated: rows.length >= CANDIDATE_COUNT_SCAN_LIMIT,
  };
}

/**
 * What a list of applications is allowed to claim about its own scope.
 *
 * Three numbers can be confused here: how many applications the view holds, how
 * many rows one read carries, and how many an answer actually names. The rails
 * count the first, the read is bound by the second, and the assistant clips to
 * the third — so whoever lists rows says which of the three it is standing on.
 * A single rail — a stage, a channel or a company — has a count of its own to
 * quote; two or more together is a set nothing counts, and the note admits that
 * instead of inventing a number. Search words belong to the third number only:
 * they are matched over the rows the read carries, so the note says what a search
 * could have reached before anybody is told a person is not in the pipeline.
 */
export function candidateScopeNote(input: {
  archived: boolean;
  stage: string | null;
  source: string | null;
  /** The company the read was scoped to, named so the note can quote it. */
  company?: { id: string; name: string } | null;
  query?: string | null;
  shown: number;
  loaded: number;
  tally: CandidateTally;
}): string {
  const { archived, stage, source, company, query, shown, loaded, tally } = input;
  const view = archived ? "archive" : "live pipeline";
  const apps = (n: number) => `${n.toLocaleString()} application${n === 1 ? "" : "s"}`;
  // The rails count the set, but a search only ever saw the rows the read
  // carries, so an empty answer is a fact about the window first.
  const text = query
    ? ` “${query}” was matched against the ${loaded.toLocaleString()} row${
        loaded === 1 ? "" : "s"
      } the read carries, not against the ${view}, so an application outside that read cannot be found this way.`
    : "";
  const scan = tally.truncated
    ? ` Counts are drawn from the newest ${CANDIDATE_COUNT_SCAN_LIMIT.toLocaleString()} applications, so they are a floor.`
    : "";
  // Three rails, and an answer has to say which of them it is standing on. Named
  // in one list so a stage *and* a company reads as the combination it is rather
  // than as the one filter that happens to be first.
  const rails = [
    stage ? `stage ${stage}` : null,
    source ? `channel ${source}` : null,
    company ? `company ${company.name}` : null,
  ].filter((word): word is string => word !== null);
  const asked =
    rails.length === 0
      ? null
      : rails.length === 1
        ? rails[0]
        : `${rails.slice(0, -1).join(", ")} and ${rails[rails.length - 1]}`;
  if (loaded === 0) {
    return asked
      ? `Nothing in the ${view} matches ${asked}, so this answer names none. It holds ${apps(tally.total)}.${scan}${text}`
      : `The ${view} holds ${apps(tally.total)}, but the read came back empty, so this answer names none.${scan}${text}`;
  }
  const carried = `${loaded.toLocaleString()} row${loaded === 1 ? "" : "s"} the read carries (${CANDIDATE_ROW_LIMIT.toLocaleString()} at most)`;
  // A one-row read is not a sample of the ceiling, it is under it, so the
  // ceiling is dropped rather than named as if it had bound the answer.
  const window =
    shown >= loaded
      ? loaded === 1
        ? "This answer names the only row the read carries."
        : `This answer names every one of the ${carried}.`
      : `This answer names ${shown.toLocaleString()} of the ${carried}.`;
  // A single rail has a number of its own; two or more is a set nothing counts.
  const rail =
    stage && !source && !company
      ? tally.stages[stage]
      : !stage && source && !company
        ? tally.sources[source]
        : !stage && !source && company
          ? tally.companies.find((entry) => entry.id === company.id)?.count
          : undefined;

  if (rails.length > 1) {
    return `Filtered to ${asked}, which no rail counts as a combination. ${window} The ${view} holds ${apps(tally.total)}.${scan}${text}`;
  }
  if (rail !== undefined) {
    return `${asked} — ${apps(rail)}, out of ${apps(tally.total)} in the ${view}. This answer names ${shown.toLocaleString()} of that rail, taken from the ${carried}.${scan}${text}`;
  }
  return `The ${view} holds ${apps(tally.total)}. ${window}${scan}${text}`;
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
  /** The company the opening belongs to — typed in the box, so it is searched. */
  company_name: string | null;
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

/**
 * A company id exactly as a read returned it, or `null`.
 *
 * `applications` has no company column: the rail reaches one through
 * `job_openings.tenant_id`, and PostgREST needs a real uuid to narrow that embed.
 * A name typed into the parameter would come back as a database error about uuid
 * syntax, so the rail drops it and the table stays unfiltered — which is what the
 * two enum rails above already do with an unknown stage.
 */
const COMPANY_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCompanyId(value: unknown): string | null {
  return typeof value === "string" && COMPANY_ID_SHAPE.test(value.trim())
    ? value.trim()
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
    (row.company_name ?? "").toLowerCase().includes(q) ||
    row.tracking_code.toLowerCase().includes(q)
  );
}

/**
 * The columns the box reads, in the words that describe it.
 *
 * The table's placeholder and the assistant's `query` argument both quote this
 * rather than name columns in prose, so a column added to `matches()` cannot be
 * promised in one place and missing in the other.
 */
export function candidateSearchWords(): string {
  return "name, email, role, company or tracking code";
}

/**
 * Keep the rows the recruiter is looking at.
 *
 * The search is a case-insensitive substring over five columns, deliberately
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
