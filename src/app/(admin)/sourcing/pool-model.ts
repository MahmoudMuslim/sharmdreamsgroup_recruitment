/**
 * The sourcing pool's bound and its ladder, in a module neither side owns.
 *
 * The read that ships the list and the rails that have to explain it sit on
 * opposite sides of the server/client line, so a literal kept by each is one
 * edit away from a number that lies — and a `"use server"` file cannot export
 * a constant at all. The board's stage wording lived here for the same reason
 * the trail quotes it: a rail that says "Applied" while a trail row says
 * "CONVERTED" reads backwards to whoever is reconciling the two.
 */

/** How many prospects one render ships. A window into the pool, not the pool. */
export const POOL_LIMIT = 500;

/**
 * How far an import looks for a prospect it is about to add.
 *
 * Only the email half of the check needs this window: a repeated profile link is
 * refused by `sourced_prospects_linkedin_key` no matter where the older row sits,
 * while an email match is only found inside the newest `DEDUPE_WINDOW` records.
 * Both facts belong to whoever is promising a list will not be duplicated, which
 * is why the number lives here rather than inside the action that uses it.
 */
export const DEDUPE_WINDOW = 5000;

/** Sourcing ladder — see the `stage` check constraint in migration 017. */
export const PROSPECT_STAGES = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERVIEW",
  "CONVERTED",
  "PASSED",
] as const;

export type ProspectStage = (typeof PROSPECT_STAGES)[number];

/** What the board calls a stage, in the recruiter's words. */
export const STAGE_WORDS: Record<ProspectStage, string> = {
  NEW: "Not contacted",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  INTERVIEW: "Interview",
  CONVERTED: "Applied",
  PASSED: "Passed",
};

export function stageWord(stage: string): string {
  return STAGE_WORDS[stage as ProspectStage] ?? stage;
}

/**
 * A `?stage=` parameter, or nothing.
 *
 * The rails filter the *query*, so the value arrives from the browser and has to
 * be refused rather than trusted: a parameter naming no stage narrows nothing
 * instead of silently emptying the board.
 */
export function isProspectStage(value: unknown): ProspectStage | null {
  return typeof value === "string" && (PROSPECT_STAGES as readonly string[]).includes(value)
    ? (value as ProspectStage)
    : null;
}

/** Counts the database gave, so they describe the pool rather than a slice. */
export type PoolCounts = Record<ProspectStage, number>;

/** The columns a prospect row has to carry for the search box to read it. */
export interface SearchableProspect {
  full_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  headline: string | null;
  location: string | null;
  linkedin_url: string | null;
}

/** The columns the board's search box reads. Anything richer is not searched. */
export const PROSPECT_SEARCH_COLUMNS: readonly {
  key: keyof SearchableProspect;
  label: string;
}[] = [
  { key: "full_name", label: "name" },
  { key: "email", label: "email" },
  { key: "phone", label: "phone" },
  { key: "company", label: "company" },
  { key: "headline", label: "role" },
  { key: "location", label: "location" },
  { key: "linkedin_url", label: "profile link" },
];

/**
 * What the search box promises, in the recruiter's words.
 *
 * The placeholder over the table and the assistant's tool argument are both
 * descriptions of `searchPool`, so they are built from its column list rather
 * than kept by hand: a box that says "name, email or profile link" while
 * matching two more columns is a search nobody can reproduce.
 */
export function prospectSearchWords(): string {
  const labels = PROSPECT_SEARCH_COLUMNS.map((column) => column.label);
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * The board's search box, in one implementation.
 *
 * A case-insensitive substring over the columns above rather than a pushed-down
 * `ILIKE` for the same reason the candidate table refuses it: a name holding `_`
 * or `%` is a wildcard to Postgres and a literal to `includes()`. It searches the
 * rows it is handed, so it is a filter over one capped read and never a search of
 * the pool — which is what whoever quotes its result has to say out loud.
 */
export function searchPool<T extends SearchableProspect>(
  rows: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) =>
    PROSPECT_SEARCH_COLUMNS.some(({ key }) => {
      const value = row[key];
      return typeof value === "string" && value.toLowerCase().includes(q);
    })
  );
}

export interface ProspectPoolTotals {
  /** Every prospect in the pool, live or not. */
  total: number;
  byStage: PoolCounts;
  /** Rows this render actually holds — never more than `POOL_LIMIT`. */
  loaded: number;
  limit: number;
}

/**
 * What a list of prospects is allowed to claim about its own scope.
 *
 * Whoever quotes it is describing a window: the pool's head counts come from
 * the database, the rows from one capped read, and a rail filters the *query*,
 * so the pool's total keeps its meaning while the rail's may outrun the read.
 * The assistant's answers are the caller — a board caption cannot carry three
 * numbers in one line, but a spoken answer can, and it must not improvise them.
 */
export function poolScopeNote(
  totals: ProspectPoolTotals,
  stage: ProspectStage | null,
  shown: number,
  search: string | null = null
): string {
  const { total, loaded, limit } = totals;
  const window = `taken from the ${loaded.toLocaleString()} row${
    loaded === 1 ? "" : "s"
  } the read carries (${limit.toLocaleString()} at most)`;
  // A text search only ever saw the rows above, so an empty answer is a fact
  // about the window before it is a fact about the person.
  const text = search
    ? ` “${search}” was matched against the ${loaded.toLocaleString()} row${
        loaded === 1 ? "" : "s"
      } the read carries, not against the pool, so a prospect outside the read cannot be found this way.`
    : "";

  if (!stage) {
    return `${total.toLocaleString()} prospects are in the pool. This answer names ${shown.toLocaleString()} of them, ${window}.${text}`;
  }

  const rail = totals.byStage[stage] ?? 0;
  const beyond = rail > loaded ? ` That rail holds ${rail - loaded} more than one read carries.` : "";
  return `${rail.toLocaleString()} ${rail === 1 ? "prospect sits" : "prospects sit"} in the ${stageWord(
    stage
  )} rail, out of ${total.toLocaleString()} in the pool. This answer names ${shown.toLocaleString()} of that rail, ${window}.${beyond}${text}`;
}
