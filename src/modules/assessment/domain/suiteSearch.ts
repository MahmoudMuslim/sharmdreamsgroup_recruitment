/**
 * The suites search, in one implementation.
 *
 * The grid runs it over every suite the page holds; the assistant runs it over
 * the suites its own read carries. Both surfaces then have to say what they
 * searched, and a column list kept by each side is how a chat answer starts
 * denying a suite the table finds seconds later — so the predicate, its columns
 * and the words that describe them live here, next to neither of them.
 *
 * Pure by design — no database, no `server-only` — so the client grid and the
 * server-side read can import it alike.
 */

import {
  describeFields,
  searchByFields,
  wordsClause,
  type SearchField,
} from "@/lib/textSearch";

/**
 * The columns a suite search reads.
 *
 * Role family and the active/paused switch are the grid's *other* two filters and
 * deliberately not part of this: they are picklists, not words, and folding them
 * in would let a description of the search box promise a filter it cannot apply.
 */
interface SearchableSuite {
  name: string;
  description: string;
}

export const SUITE_SEARCH_FIELDS: readonly SearchField<SearchableSuite>[] = [
  { label: "name", read: (suite) => suite.name },
  { label: "description", read: (suite) => suite.description },
];

/** What the search box promises, in the recruiter's words. */
export function suiteSearchWords(): string {
  return describeFields(SUITE_SEARCH_FIELDS);
}

export function searchSuites<T extends SearchableSuite>(rows: readonly T[], query: string): T[] {
  return searchByFields(rows, query, SUITE_SEARCH_FIELDS);
}

/**
 * What a suites read is standing on.
 *
 * `getTemplates()` carries no window — every suite the group has comes back — so
 * this is the one list answer that can honestly say a missing suite does not
 * exist. A search keeps that guarantee: the words were tried against the whole
 * catalogue, not against the newest slice of it.
 */
export function suiteReadNote(total: number, shown: number, search: string | null): string {
  if (total === 0) return "There are no assessment suites, so none are listed.";
  const base = `All ${total.toLocaleString()} suites are named here${
    shown < total ? ` — this answer names ${shown.toLocaleString()} of them` : ""
  }.`;
  return search
    ? `${base}${wordsClause(
        search,
        `the whole catalogue of ${total.toLocaleString()} suites`,
        true,
        "a suite"
      )}`
    : base;
}
