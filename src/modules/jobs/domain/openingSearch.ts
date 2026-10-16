/**
 * The openings search, in one implementation.
 *
 * The grid runs it over every opening the page holds; the assistant runs it over
 * the handful its own read carries. Both surfaces then have to say what they
 * searched, and a column list kept by each side is how a chat answer starts
 * denying a role the table finds seconds later — so the predicate, its columns
 * and the words that describe them live here, next to neither of them.
 *
 * Pure by design — no database, no `server-only` — so the client grid and the
 * server-side read can import it alike.
 */

/**
 * The columns a search reads.
 *
 * A company is matched by its name, never by its id: a recruiter types
 * "Sharm Dreams", not a uuid, and an id in a search box matches nothing.
 */
export interface SearchableOpening {
  title: string | null;
  department: string | null;
  location: string | null;
  /** Resolved before the search runs — the grid from its options, the read from its embed. */
  company_name: string | null;
}

export const OPENING_SEARCH_COLUMNS: readonly {
  key: keyof SearchableOpening;
  label: string;
}[] = [
  { key: "title", label: "title" },
  { key: "department", label: "department" },
  { key: "location", label: "location" },
  { key: "company_name", label: "company" },
];

/**
 * What the search box promises, in the recruiter's words.
 *
 * The placeholder and the assistant's tool argument are both descriptions of
 * `searchOpenings`, so both are built from its column list rather than typed out
 * by hand beside it.
 */
export function openingSearchWords(): string {
  const labels = OPENING_SEARCH_COLUMNS.map((column) => column.label);
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * Keep the openings whose four columns hold the words.
 *
 * Case-insensitive substring, not a pushed-down `ILIKE`: a title or company
 * holding `_` or `%` is a wildcard to Postgres and a literal to `includes()`, so
 * the database version would quietly match openings nobody typed. An empty or
 * whitespace query returns the rows untouched — a search box with nothing in it
 * filters nothing.
 */
export function searchOpenings<T extends SearchableOpening>(
  rows: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) =>
    OPENING_SEARCH_COLUMNS.some(({ key }) => {
      const value = row[key];
      return typeof value === "string" && value.toLowerCase().includes(q);
    })
  );
}
