import "server-only";

import { createHash } from "node:crypto";
import type { RestClient } from "@/lib/rest/client";
import type { LiveWatch } from "@/modules/live/domain/watch";

/**
 * How far a hashed watch looks into its table.
 *
 * Newest rows first, so an insert is always inside the window; a table that
 * outgrows it stops reporting edits to its oldest rows, which is the trade made
 * for not putting an `updated_at` on those tables.
 */
const HASH_ROWS = 500;

/**
 * The column that says which rows are newest.
 *
 * Not `id`: every one of these tables keys on `gen_random_uuid()`, so ordering
 * by it is lexicographic, and a row inserted this second lands anywhere in the
 * ranking — usually outside a 500-row window once the table outgrows it. Each
 * hashed table carries `created_at` with a `default now()`, which is the only
 * real newest-first order available without adding an update stamp.
 */
const NEWEST_COLUMN = "created_at";

/**
 * What one poll learned about one area.
 *
 * Three states, because two failures look alike on the wire and mean opposite
 * things for the recruiter's screen. A table that is not there can never move,
 * so a page fed only by one must stop promising a reload it will never get. A
 * request that merely failed says nothing at all — and must not be allowed to
 * take a working promise away, or a one-second network hiccup would silently
 * unwatch the pipeline on seven pages and swallow every change made during it.
 */
export type LiveAreaMark =
  | { state: "ok"; stamp: string }
  /** PostgREST answered that this definition can never be read. */
  | { state: "refused" }
  /** The request did not complete, so the previous answer still stands. */
  | { state: "unknown" };

export type LiveFingerprints = Record<string, LiveAreaMark>;

/**
 * The codes that are a verdict on the *definition*, not on the connection:
 * relation not in the schema cache, relation or column missing, no privilege.
 * A transport failure comes back with an empty code, which is why the list is
 * an allow-list of refusals rather than a list of failures.
 */
const REFUSALS = new Set(["PGRST205", "42P01", "42703", "42501"]);

/** Only a named schema or privilege problem refuses an area. */
function toMark(code: string | undefined): LiveAreaMark {
  return REFUSALS.has(code ?? "") ? { state: "refused" } : { state: "unknown" };
}

/**
 * Fingerprints one connection's slice of the watch list.
 *
 * The list itself lives in the domain, because the browser needs the same
 * page-prefix rule the server uses to scope a poll. This function only turns
 * the chosen slice into marks.
 */
export async function readLiveFingerprints(
  restClient: RestClient,
  watches: readonly LiveWatch[]
): Promise<LiveFingerprints> {
  const entries = await Promise.all(
    watches.map(async (watch): Promise<[string, LiveAreaMark]> => {
      try {
        return [watch.area, await fingerprint(restClient, watch)];
      } catch {
        // A request that never completed is not an answer about the table.
        return [watch.area, { state: "unknown" }];
      }
    })
  );

  return Object.fromEntries(entries);
}

/**
 * The marks to remember after a poll: a refusal is an answer, an `unknown` is
 * not, so the last stamp actually read is kept through a failed tick. That is
 * what lets a change made while the connection was down still arrive as a
 * change once it is back, instead of being compared against nothing.
 */
export function carryLastRead(
  before: LiveFingerprints,
  after: LiveFingerprints
): LiveFingerprints {
  const merged: LiveFingerprints = { ...before };
  for (const [area, mark] of Object.entries(after)) {
    if (mark.state !== "unknown") merged[area] = mark;
  }
  return merged;
}

/** The areas whose fingerprint moved since `before`, within the caller's scope. */
export function diffLiveFingerprints(
  before: LiveFingerprints,
  after: LiveFingerprints,
  watches: readonly LiveWatch[]
): string[] {
  const moved: string[] = [];
  for (const watch of watches) {
    const was = before[watch.area];
    const now = after[watch.area];
    // Either side not a read is not a change — that would flap on permissions.
    if (!was || !now || was.state !== "ok" || now.state !== "ok") continue;
    if (was.stamp !== now.stamp) moved.push(watch.area);
  }
  return moved;
}

async function fingerprint(restClient: RestClient, watch: LiveWatch): Promise<LiveAreaMark> {
  if (watch.stamp) {
    const { data, count, error } = await restClient
      .from(watch.table)
      // Newest first plus the total, in one request: a delete moves `count`, an
      // insert moves the newest stamp, so either one changes the fingerprint.
      .select(watch.stamp, { count: "exact" })
      .order(watch.stamp, { ascending: false })
      .limit(1);

    if (error) return toMark(error.code);
    // The stamp is named by a variable, so PostgREST cannot infer the row shape
    // for the single column it was asked to return.
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    return { state: "ok", stamp: `${count ?? -1}|${rows[0]?.[watch.stamp] ?? "-"}` };
  }

  const columns = watch.columns ?? [];
  const { data, error } = await restClient
    .from(watch.table)
    .select(columns.join(","))
    .order(NEWEST_COLUMN, { ascending: false })
    .limit(HASH_ROWS);

  if (error) return toMark(error.code);
  return {
    state: "ok",
    stamp: createHash("sha256").update(JSON.stringify(data ?? [])).digest("hex"),
  };
}
