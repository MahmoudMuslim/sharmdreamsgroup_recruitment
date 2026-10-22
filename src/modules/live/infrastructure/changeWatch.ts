import "server-only";

import { createHash } from "node:crypto";
import type { RestClient } from "@/lib/rest/client";
import type { StaffRoute } from "@/lib/auth/staffRoutes";

/**
 * One table the portal reads, described by what a write to it does.
 *
 * `stamp` is the column every write moves — a table with an `updated_at`
 * trigger, or one that is only ever inserted into. `columns` is used instead
 * when the table has no such column: the watched values of its newest rows are
 * hashed, so an edit that moves no timestamp still moves the fingerprint.
 */
export interface LiveWatch {
  /** Shown back to the browser, so the badge can name what moved. */
  area: string;
  table: string;
  stamp?: string;
  columns?: string[];
  /**
   * Portal pages that have to re-read when this area moves.
   *
   * A page name typed wrong here is not a broken link someone can click — it is
   * a page that silently never refreshes, on a watch list nobody reads twice.
   * Hence `StaffRoute`, and hence bare prefixes: the browser matches these the
   * same way the edge guard matches a pathname.
   */
  paths: readonly StaffRoute[];
}

/**
 * The hiring data an open admin page shows, and the pages it shows on.
 *
 * Deliberately not "every table": settings, AI providers and the assistant are
 * read through their own screens and already re-read the moment you save, so a
 * poll on them would only cost queries.
 */
export const LIVE_WATCH: readonly LiveWatch[] = [
  {
    area: "pipeline",
    table: "applications",
    stamp: "updated_at",
    paths: ["/candidates", "/dashboard", "/analytics", "/reports", "/jobs", "/files", "/whatsapp"],
  },
  {
    area: "sourcing",
    table: "sourced_prospects",
    stamp: "updated_at",
    paths: ["/sourcing", "/dashboard"],
  },
  {
    // Watched by outcome, not by `draft_saved_at`: an applicant autosaving an
    // answer every 30 seconds would otherwise reload the recruiter's screen all
    // day. A submission moves `status`, so it still arrives live.
    area: "assessments",
    table: "candidate_attempts",
    columns: ["id", "status", "submitted_at", "total_score"],
    paths: ["/assessments", "/candidates", "/dashboard"],
  },
  {
    area: "interviews",
    table: "interview_schedules",
    columns: ["id", "application_id", "scheduled_at", "status", "meeting_link"],
    paths: ["/interviews", "/candidates", "/dashboard"],
  },
  {
    area: "openings",
    table: "job_openings",
    columns: ["id", "title", "status", "closing_at", "department"],
    paths: ["/jobs", "/dashboard", "/candidates"],
  },
  {
    area: "onboarding",
    table: "onboarding_plans",
    columns: ["id", "progress", "checklist"],
    paths: ["/onboarding", "/dashboard"],
  },
  {
    area: "outreach",
    table: "communication_logs",
    columns: ["id", "delivered", "error_message", "read_at"],
    paths: ["/whatsapp", "/candidates", "/files"],
  },
  {
    // The other half of /whatsapp. A queued alert is not a delivery until the
    // dispatcher writes its log row, so without this the queue itself — a
    // colleague's retry, a cancel, a job flipping to parked — sits still while
    // the page claims it is live. `error_log` is left out: it grows on every
    // failed attempt and would reload the page for noise the list already shows.
    area: "queue",
    table: "scheduled_whatsapp_jobs",
    columns: ["id", "status", "scheduled_for", "attempts", "sent_at"],
    paths: ["/whatsapp"],
  },
  {
    area: "gate questions",
    table: "application_gate_questions",
    stamp: "updated_at",
    // The bank lists these too. A suite's questions are not watched at all —
    // `assessment_questions` carries no created or updated stamp to watch — so
    // the bank's Live badge only ever refreshes on its apply-form half.
    paths: ["/questions"],
  },
  {
    area: "files",
    table: "application_attachments",
    stamp: "created_at",
    paths: ["/files", "/candidates"],
  },
  {
    // `updated_at` rather than `started_at`: stopping a timer moves the end and
    // the trigger's stamp, not the start, and a colleague's stop is exactly the
    // change a shared ledger has to show without a refresh.
    area: "time",
    table: "time_entries",
    stamp: "updated_at",
    paths: ["/time"],
  },
] as const;

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

export async function readLiveFingerprints(
  restClient: RestClient
): Promise<LiveFingerprints> {
  const entries = await Promise.all(
    LIVE_WATCH.map(async (watch): Promise<[string, LiveAreaMark]> => {
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

/** The areas whose fingerprint moved since `before`. */
export function diffLiveFingerprints(
  before: LiveFingerprints,
  after: LiveFingerprints
): string[] {
  const moved: string[] = [];
  for (const watch of LIVE_WATCH) {
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
