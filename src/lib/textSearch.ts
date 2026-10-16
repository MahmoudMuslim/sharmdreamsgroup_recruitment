/**
 * One search box, two doors.
 *
 * A console filters the rows it holds in the browser; the assistant runs the
 * same words over the handful of rows its own read carries. A column list kept
 * beside each of them is how a chat answer starts denying something the table
 * finds seconds later, so the predicate, its columns and the words describing
 * them are read from one list — the placeholder and the tool argument are both
 * generated from it rather than typed out beside it.
 *
 * Case-insensitive substring, never a pushed-down `ILIKE`: a name holding `_` or
 * `%` is a wildcard to Postgres and a literal to `includes()`, so the database
 * version would quietly match rows nobody typed. An empty or whitespace query
 * returns the rows untouched — a search box with nothing in it filters nothing.
 *
 * Pure by design: no database, no `server-only`, no clock, so a client component
 * and a server-side read can import it alike.
 */

export interface SearchField<T> {
  /** What the recruiter is told this column holds, in their words. */
  label: string;
  read: (row: T) => string | null | undefined;
}

/**
 * The columns a search reads, as one sentence.
 *
 * `["title", "department", "location"]` becomes "title, department or location",
 * which is what both a placeholder and a tool argument want. A single column has
 * no "or", so it is not prefixed with an empty list.
 */
export function describeFields<T>(fields: readonly SearchField<T>[]): string {
  const labels = fields.map((field) => field.label);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/** Keep the rows whose listed columns hold the words. */
export function searchByFields<T>(
  rows: readonly T[],
  query: string,
  fields: readonly SearchField<T>[]
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) =>
    fields.some((field) => {
      const value = field.read(row);
      return typeof value === "string" && value.toLowerCase().includes(needle);
    })
  );
}

/**
 * The sentence a scope note ends with when a search ran.
 *
 * `scope` is the set the words actually ran over, already counted in the caller's
 * own words ("the 200 jobs this read carries", "all 7 suites the catalogue
 * holds"). It is a separate sentence rather than a rewrite of the note's count
 * sentence because the two numbers mean different things: how many rows the read
 * carries, and how many the answer names. Folding them together is how a note
 * ends up stating the same figure twice and reading as two counts.
 *
 * `whole` is the difference between "nobody has that suite" and "the newest 200
 * rows have nobody" — only the first is a fact about the set.
 *
 * `item` is one of the rows named in the table's own words ("a job", "a suite"),
 * because a note that says "a row" at the bottom of a queue of jobs reads as if
 * it had been written about some other table.
 */
export function wordsClause(
  search: string,
  scope: string,
  whole: boolean,
  item: string
): string {
  return whole
    ? ` “${search}” was matched against ${scope}, which is the whole set — so nothing outside it holds those words.`
    : ` “${search}” was matched against ${scope}, so ${item} outside it cannot be found this way.`;
}
