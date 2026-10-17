/**
 * The keys console's "Recent changes" trail, in one implementation.
 *
 * The trail is the only place a passed provider test survives on a deployment
 * that keeps its keys in environment variables: `provider_credentials` has no
 * row to stamp `last_verified_at` onto, so every such test lives here and nowhere
 * else. That is why the console's list and the assistant's read share one filter,
 * one page size, one search window and one scope note — an answer that counted rows
 * a page cannot show is the same defect the other consoles were fixed for, and a
 * chat link to an unfiltered list would name rows the recruiter cannot find on
 * screen.
 *
 * A page, not a ceiling. The live table holds 24 rows against a 12-row page, so a
 * section headed "Recent changes" was showing half the history and saying nothing
 * about the other half. The count it holds, the page it is standing on and the rows
 * it left for the next page are all said out loud, in the browser and in the chat
 * answer, from the same function.
 *
 * A search is disclosed the same way. It matches the row as the console prints it —
 * the provider id and its display name, the action, the detail, the actor — so it
 * cannot be pushed into SQL, and it only answers about the rows it read. An empty
 * listing and a match older than the window look identical, and only the note can
 * tell them apart.
 *
 * A row's `detail` never carries a key: the writer stores `secretHint(...)` (eight
 * mask characters plus at most four) or a fixed phrase, so this module reads the
 * column as ordinary text and repeats it.
 *
 * Pure by design — no database, no `server-only`, no clock — so the client console
 * and the server-side read can import it alike.
 */

import { providerById, type ProviderDefinition } from "./providers";

/**
 * One page of the trail: how many rows the console section and the chat answer
 * carry at a time.
 *
 * A page, not a ceiling — `trailPages` is what turns it into a depth a reader can
 * walk. Keeping one number means the screen and the chat cannot disagree about how
 * much of the trail a single read holds.
 */
export const TRAIL_LIMIT = 12;

/**
 * How far back a search reads.
 *
 * Browsing walks the whole scope a page at a time, but a search has to hold the
 * rows it is matching in one read, so it takes the newest ones and says so:
 * `trailScopeNote` names the window whenever the scope is deeper than it. Today the
 * trail is 24 rows, so nothing is left out yet — the disclosure is here for the day
 * it grows past the window, which is when a silent cap would start answering "no row
 * matches" about rows nobody looked at.
 */
export const TRAIL_SEARCH_SCAN = 400;

/** Where a page starts in the trail's own newest-first order, zero-based. */
export function trailStart(page: number): number {
  return (page - 1) * TRAIL_LIMIT;
}

/** How many pages it takes to walk a scope of `total` rows. Always at least one. */
export function trailPages(total: number): number {
  return Math.max(1, Math.ceil(total / TRAIL_LIMIT));
}

/**
 * The page a parameter or argument asks for.
 *
 * Lenient in the same shape as `trailScope`: page 1 is the trail's front, so a
 * missing, negative, fractional or unparseable value reads as page 1 rather than as
 * an error or an empty list. A stale bookmark that names a page the trail has
 * outgrown is clamped by the read, not answered with nothing.
 */
export function trailNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/**
 * The words a reader or the chat asked the trail to be searched for.
 *
 * Internal whitespace collapses and the ends are trimmed, because a row is matched
 * by a substring and "key  history" would otherwise find nothing in a detail that
 * prints "key replaced". An all-blank parameter is no search at all — the same rule
 * every other parameter on this console follows, where a missing value lists
 * everything rather than nothing.
 */
export function trailWords(value: string | null | undefined): string | null {
  const words = value?.trim().replace(/\s+/g, " ") ?? "";
  return words === "" ? null : words;
}

/**
 * Whether one printed row carries the words.
 *
 * It is given exactly the fields the console renders — the action chip, the provider
 * id a row links by, the name that id carries in its tooltip and on the chat's own
 * row, the detail text, and the actor — so the box can only ever find what is on the
 * screen. Matching them here rather than in the browser keeps the search, its counts
 * and its paging one read for the console and the chat alike.
 */
export function trailPrintedMatches(
  row: {
    provider: string | null;
    name: string | null;
    action: string;
    detail: string | null;
    actor: string | null;
  },
  words: string
): boolean {
  const needle = words.toLowerCase();
  return [
    row.action,
    row.provider ?? "",
    row.name ?? "",
    row.detail ?? "",
    row.actor ?? "",
  ].some((field) => field.toLowerCase().includes(needle));
}

/**
 * The provider a trail listing is scoped to, or `null` for the whole history.
 *
 * Only an id the portal has a definition for narrows the list. Anything else —
 * a typo, a provider the registry dropped, an empty parameter — reads as "no
 * filter" rather than filtering the section down to nothing that was never asked
 * for, which is how every other console on this page treats its own parameters.
 */
export function trailScope(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && providerById(id) ? id : null;
}

/** The definition behind a scope, for a label that names the provider the way its card does. */
export function trailProvider(id: string | null): ProviderDefinition | null {
  return id ? (providerById(id) ?? null) : null;
}

/**
 * What a trail answer is standing on.
 *
 * Five facts in the order they are needed: whose history this is, how many rows
 * exist for it, which page of them this listing holds, how many of those rows can
 * name a person, and — when the listing is a search — which rows the words were
 * looked for in.
 *
 * The page clause is the one this trail cannot do without: 12 rows of 24 reads as
 * the whole history to anyone who counts what is on the screen, and a reader who
 * walked deeper should know the walk is finite rather than endless. The actor clause
 * stops a blank column being read as "nobody tested this" — the console prints
 * `system` for those rows.
 */
export function trailScopeNote(input: {
  providerId: string | null;
  total: number;
  loaded: number;
  /** How many of the scope's rows name the person who acted. */
  named: number;
  /** 1-based. The read reports the page it actually served, after clamping. */
  page?: number;
  /** Set when the listing is a search: the words, the window read, the scope's own size. */
  search?: { words: string; scanned: number; scopeRows: number } | null;
}): string {
  const { providerId, total, loaded, named, search } = input;
  const page = Math.max(1, input.page ?? 1);
  const definition = trailProvider(providerId);
  const rows = (value: number) => `${value.toLocaleString()} row${value === 1 ? "" : "s"}`;
  const whose = definition ? ` for ${definition.displayName}` : "";
  const searched = search ? searchedSentence(search) : null;

  if (total === 0 && search) {
    return `Nothing here matches “${search.words}”${whose}. ${searched} A search can only answer about the rows it read, so an empty listing is not a claim that this provider was never tested or changed through this portal.`;
  }
  if (total === 0) {
    return definition
      ? `Nothing is recorded${whose} — the trail holds only changes and tests made through this portal, so a key served from the environment may be working without ever having been tested here.`
      : "No credential has been changed or tested through this portal yet, so the trail is empty.";
  }

  const pages = trailPages(total);
  const offset = trailStart(page);
  const last = offset + loaded;
  let span: string;
  if (loaded >= total) {
    span = `this listing carries all ${rows(total)}`;
  } else {
    const newer =
      offset > 0
        ? `${offset.toLocaleString()} newer ${offset === 1 ? "row" : "rows"} on ${
            page === 2 ? "the previous page" : "earlier pages"
          }`
        : null;
    const left = total - last;
    const older =
      left > 0
        ? `${left.toLocaleString()} older ${left === 1 ? "row" : "rows"} on ${
            pages - page === 1 ? "the next page" : "later pages"
          }`
        : null;
    /* One `with` clause, both halves nominal — a verb in only one of them reads as
     * a mistake where the two are named together. */
    const beside = newer || older ? `, with ${[newer, older].filter(Boolean).join(" and ")}` : "";
    span =
      `page ${page} of ${pages} shows ${
        loaded === 1 ? "row" : "rows"
      } ${offset + 1}${loaded > 1 ? `–${last}` : ""} of them${beside}`;
  }
  const who =
    named === 0
      ? "No row names the person who acted: those writes recorded no actor, and the console prints them as system."
      : named === total
        ? "Every row names the person who acted."
        : `Only ${named.toLocaleString()} of the ${total.toLocaleString()} name the person who acted — the rest recorded no actor, and the console prints them as system.`;
  const head = search
    ? `${rows(total)} ${total === 1 ? "matches" : "match"} “${search.words}”${whose}`
    : `${rows(total)} recorded${whose}`;
  return `${head} — ${span}. ${who}${searched ? ` ${searched}` : ""}`;
}

/**
 * What a search actually read.
 *
 * The sentence has to distinguish "no row matches" from "the matching row is further
 * back than the window", because the two look identical in a listing and only one of
 * them is the trail's fault. When the window covers the scope it says so, which is
 * the only case in which an empty search means anything at all.
 */
function searchedSentence(search: { words: string; scanned: number; scopeRows: number }): string {
  const { scanned, scopeRows } = search;
  if (scanned >= scopeRows) {
    return `All ${scopeRows.toLocaleString()} rows in this scope were searched.`;
  }
  const left = scopeRows - scanned;
  return `Searched the newest ${scanned.toLocaleString()} of the ${scopeRows.toLocaleString()} rows in this scope, so ${left.toLocaleString()} older ${
    left === 1 ? "row was" : "rows were"
  } not read.`;
}
