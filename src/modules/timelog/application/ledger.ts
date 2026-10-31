import "server-only";

/**
 * The one door the time ledger is read and written through.
 *
 * Every call here uses the caller's own session client, so Row Level Security —
 * not this file — decides whose hours they may see and which rows they may
 * change. That is why there is no service-role path: a timesheet written with the
 * service key would bypass the one rule the table exists to enforce, that your
 * hours are yours to edit.
 *
 * PostgREST reports a refused write as success with zero rows back, which reads
 * exactly like a saved entry. Every mutation therefore re-selects and counts, and
 * an empty result is reported as the failure it is.
 */

import { createServerRestClient } from "@/lib/data-api/server";
import { dayKeyInZone, formatInZone, fromZoneInputValue } from "@/lib/timezone";
import {
  DEFAULT_SCOPE,
  isTimeScope,
  timeWindow,
  isTimeCategory,
  type TimeCategory,
  type TimeEntry,
  type TimeScope,
  type TimeWindowKey,
} from "@/modules/timelog/domain/ledger";

/** The ceiling on one read, so no window can pull the whole table into memory. */
export const LEDGER_ROW_LIMIT = 1_000;
const MAX_ROWS = LEDGER_ROW_LIMIT;

/**
 * The window and the cut, resolved the same way on screen and in a download.
 *
 * Shared because the one way a file can lie about a ledger is to cover a
 * different span than the page above it: a window here counts whole days on the
 * office wall, which is a piece of arithmetic nobody should get to write twice.
 */
export function ledgerCut(
  raw: { window?: unknown; scope?: unknown },
  timeZone: string,
  now: Date
): {
  window: TimeWindowKey;
  scope: TimeScope;
  since: string;
  scopeNote: string;
} {
  const window = timeWindow(raw.window).key;
  const scope: TimeScope = isTimeScope(raw.scope) ? raw.scope : DEFAULT_SCOPE;
  const days = timeWindow(window).days;

  const firstDay = dayKeyInZone(
    new Date(now.getTime() - (days - 1) * 86_400_000).toISOString(),
    timeZone
  );
  const since = fromZoneInputValue(`${firstDay}T00:00`, timeZone) ?? firstDay;

  const from =
    days === 1
      ? "today"
      : `since ${formatInZone(since, timeZone, { day: "numeric", month: "short" })}`;
  const scopeNote =
    scope === "mine"
      ? `Your hours ${from}, on the ${timeZone} clock.`
      : `Every colleague's hours ${from}, on the ${timeZone} clock.`;

  return { window, scope, since, scopeNote };
}

const EMBEDDED =
  "id, company_id, staff_id, category, task, job_id, application_id, note, " +
  "started_at, ended_at, user_profiles(full_name), job_openings(title), applications(full_name)";

export const LEDGER_NOT_PROVISIONED =
  "The time ledger has not been created yet. Apply db/migrations/025_time_entries.sql, then reload this page.";

/** A joined one-to-one comes back as an object, an array or null depending on the driver. */
type Embed = Record<string, unknown> | Record<string, unknown>[] | null | undefined;

type RawRow = Record<string, unknown> & {
  id: string;
  company_id: string | null;
  staff_id: string;
  category: string;
  task: string;
  job_id: string | null;
  application_id: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
  user_profiles?: Embed;
  job_openings?: Embed;
  applications?: Embed;
};

function embeddedText(value: Embed, field: string): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  const name = row?.[field];
  return typeof name === "string" && name.trim() ? name : null;
}

/**
 * Rows, narrowed once.
 *
 * The client cannot type a select whose embedded relations are named by a
 * constant string, so every read in this module arrives as an unknown shape and
 * `RawRow` describes what the migration guarantees.
 */
function asRows(value: unknown): RawRow[] {
  return (value ?? []) as RawRow[];
}

function asRow(value: unknown): RawRow {
  return value as RawRow;
}

function toEntry(row: RawRow): TimeEntry {
  return {
    id: row.id,
    staff_id: row.staff_id,
    // A reader who cannot open staff records still has their own hours; the name
    // is what is missing, not the entry, so the row is shown with a neutral label.
    staff_name: embeddedText(row.user_profiles, "full_name") ?? "A colleague",
    company_id: row.company_id,
    category: isTimeCategory(row.category) ? row.category : ("OTHER" as TimeCategory),
    task: row.task,
    job_id: row.job_id,
    job_title: embeddedText(row.job_openings, "title"),
    application_id: row.application_id,
    application_name: embeddedText(row.applications, "full_name"),
    note: row.note,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
}

/** Turns a database refusal into the sentence a recruiter can act on. */
function explain(error: { message?: string } | null, fallback: string): string | null {
  if (!error) return null;
  const message = error.message ?? "";
  if (/time_entries_one_running_idx/i.test(message))
    return "You already have a timer running. Stop it before starting another.";
  if (/time_entries_span_check/i.test(message))
    return "That entry was refused: an end time must be later than its start.";
  if (/time_entries_category_check/i.test(message))
    return "That category is not one the ledger accepts.";
  if (/does not exist|PGRST205|Could not find the table|stop_time_entry/i.test(message))
    return LEDGER_NOT_PROVISIONED;
  return `${fallback}: ${message}`;
}

export interface LedgerRead {
  entries: TimeEntry[];
  /**
   * Every span the window and scope hold, counted by the database.
   *
   * Separate from `entries` because the read is capped: a screen that listed
   * only what it loaded would call 1,000 spans "the week" when the week holds
   * three times that. `null` only if the transport lost the count header.
   */
  total: number | null;
  /** How many of those spans this read actually carries, newest first. */
  carried: number;
  error: string | null;
}

/**
 * The window, plus whatever the caller is still running.
 *
 * Two queries rather than one because a timer started on Monday and left running
 * is invisible to a `started_at >= today` filter — and an invisible timer has no
 * Stop button, which strands it. The caller's running row is therefore always
 * read back on its own, whatever the window says.
 */
export async function readLedger(options: {
  /** Lower bound for listed rows, or null for everything the ledger holds. */
  since: string | null;
  /** Restrict the list to one colleague; null means the whole company. */
  staffId: string | null;
  /** The caller's own profile, whose running row is never filtered away. */
  callerStaffId: string;
}): Promise<LedgerRead> {
  const restClient = await createServerRestClient();

  let listed = restClient
    .from("time_entries")
    // `count: "exact"` is what lets the screen and a download say how much of
    // the cut the 1,000-row ceiling left behind, instead of calling the loaded
    // rows the whole window.
    .select(EMBEDDED, { count: "exact" })
    .order("started_at", { ascending: false })
    .limit(MAX_ROWS);
  if (options.since) listed = listed.gte("started_at", options.since);
  if (options.staffId) listed = listed.eq("staff_id", options.staffId);

  const running = restClient
    .from("time_entries")
    .select(EMBEDDED)
    .is("ended_at", null)
    .eq("staff_id", options.callerStaffId)
    .order("started_at", { ascending: false })
    .limit(1);

  const [listResult, runningResult] = await Promise.all([listed, running]);

  const failure =
    explain(listResult.error, "The ledger could not be read") ??
    explain(runningResult.error, "The running timer could not be read");
  if (failure) return { entries: [], total: null, carried: 0, error: failure };

  const listedRows = asRows(listResult.data);
  const byId = new Map<string, TimeEntry>();
  for (const row of asRows(runningResult.data)) byId.set(row.id, toEntry(row));
  for (const row of listedRows) byId.set(row.id, toEntry(row));

  const entries = [...byId.values()].sort((a, b) =>
    a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0
  );

  return {
    entries,
    // The transport reads the total from Content-Range; when it is absent the
    // count is unknown rather than equal to what was loaded.
    total: listResult.count,
    carried: listedRows.length,
    error: null,
  };
}

/** One entry, for a write that has to describe what it changed. */
export async function readEntry(id: string): Promise<TimeEntry | null> {
  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("time_entries")
    .select(EMBEDDED)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toEntry(asRow(data));
}

export interface LedgerWrite {
  ok: boolean;
  error?: string;
  entry?: TimeEntry;
}

export interface NewEntry {
  staffId: string;
  companyId: string | null;
  category: TimeCategory;
  task: string;
  note: string | null;
  jobId: string | null;
  applicationId: string | null;
  /** Omit to let the database stamp the start, which is what a timer does. */
  startedAt?: string;
  endedAt: string | null;
}

/**
 * Adds a span.
 *
 * `started_at` is left to the column default when the caller is starting a timer,
 * so the start is the database's instant, like the end is.
 */
export async function insertEntry(entry: NewEntry): Promise<LedgerWrite> {
  const restClient = await createServerRestClient();

  const row = {
    staff_id: entry.staffId,
    company_id: entry.companyId,
    category: entry.category,
    task: entry.task,
    note: entry.note,
    job_id: entry.jobId,
    application_id: entry.applicationId,
    ended_at: entry.endedAt,
    ...(entry.startedAt ? { started_at: entry.startedAt } : {}),
  };

  const { data, error } = await restClient
    .from("time_entries")
    .insert(row)
    .select(EMBEDDED);

  const refusal = explain(error, "That entry could not be logged");
  if (refusal) return { ok: false, error: refusal };

  const rows = asRows(data);
  if (rows.length === 0)
    return { ok: false, error: "The ledger refused that entry for this account." };

  return { ok: true, entry: toEntry(rows[0]) };
}

/** Edits a span. Only the fields the caller named are sent. */
export async function updateEntry(
  id: string,
  patch: Partial<Omit<NewEntry, "staffId" | "companyId">>
): Promise<LedgerWrite> {
  const restClient = await createServerRestClient();

  const body: Record<string, unknown> = {};
  if (patch.category !== undefined) body.category = patch.category;
  if (patch.task !== undefined) body.task = patch.task;
  if (patch.note !== undefined) body.note = patch.note;
  if (patch.jobId !== undefined) body.job_id = patch.jobId;
  if (patch.applicationId !== undefined) body.application_id = patch.applicationId;
  if (patch.startedAt !== undefined) body.started_at = patch.startedAt;
  if (patch.endedAt !== undefined) body.ended_at = patch.endedAt;

  if (Object.keys(body).length === 0) return { ok: true };

  const { data, error } = await restClient
    .from("time_entries")
    .update(body)
    .eq("id", id)
    .select(EMBEDDED);

  const refusal = explain(error, "That entry could not be changed");
  if (refusal) return { ok: false, error: refusal };

  const rows = asRows(data);
  if (rows.length === 0)
    return { ok: false, error: "That entry is no longer in the ledger, or is not yours to change." };

  return { ok: true, entry: toEntry(rows[0]) };
}

/**
 * Ends a running span with the database clock.
 *
 * A null result means the row was already finished or belonged to someone else:
 * the function's own `where` clause covers both, and neither is a failure worth
 * hiding, because the screen has just been showing a Stop button that no longer
 * applies.
 */
export async function stopEntry(id: string): Promise<LedgerWrite> {
  const restClient = await createServerRestClient();
  const { data, error } = await restClient.rpc("stop_time_entry", { entry_id: id });

  const refusal = explain(error, "That timer could not be stopped");
  if (refusal) return { ok: false, error: refusal };
  if (!data) return { ok: false, error: "That timer has already been stopped, or is not yours." };

  const after = await readEntry(id);
  return { ok: true, entry: after ?? undefined };
}

/**
 * Removes a span.
 *
 * Deletion, not archiving: hours are a personal record of work, and a ledger full
 * of withdrawn rows would have to explain which of them count. The company rule
 * that nothing is ever erased belongs to candidate records, whose history
 * outlives them.
 */
export async function deleteEntry(id: string): Promise<LedgerWrite> {
  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("time_entries")
    .delete()
    .eq("id", id)
    .select("id");

  const refusal = explain(error, "That entry could not be removed");
  if (refusal) return { ok: false, error: refusal };
  if (!data || data.length === 0)
    return { ok: false, error: "That entry is no longer in the ledger, or is not yours to remove." };

  return { ok: true };
}
