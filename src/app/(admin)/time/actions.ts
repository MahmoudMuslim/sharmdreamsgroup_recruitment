"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { fromZoneInputValue } from "@/lib/timezone";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { recordActivity } from "@/modules/activity/application/record";
import { changePhrase, changedFields } from "@/modules/activity/domain/trail";
import {
  formatSpan,
  isTimeCategory,
  normaliseDraft,
  elapsedSeconds,
  TRACK_DENIED,
  type TimeCategory,
  type TimeDraft,
  type TimeEntry,
  type TimeScope,
  type TimeWindowKey,
} from "@/modules/timelog/domain/ledger";
import {
  deleteEntry,
  insertEntry,
  ledgerCut,
  readEntry,
  readLedger,
  stopEntry,
  updateEntry,
  type LedgerWrite,
} from "@/modules/timelog/application/ledger";

/**
 * What a read-back of one entry says when it finds nothing.
 *
 * "Not yours" would be a guess: an unapplied migration, a row deleted a moment
 * ago and a row belonging to a colleague all read the same way here, and the
 * first of them is the one a reader can act on.
 */
const MISSING_ENTRY =
  "That entry is not in the ledger, or the ledger has not been created yet.";

/**
 * What a row belonging to someone else says.
 *
 * Checked here as well as by the policies, because a colleague's hours are
 * readable in the company cut: without the check, editing one costs a round-trip
 * to Postgres and comes back as a refusal nobody can read.
 */
const NOT_YOURS = "Only the person who logged a span can change it.";

export interface LedgerOptions {
  openings: { id: string; title: string }[];
  candidates: { id: string; name: string; job: string | null }[];
}

export interface LedgerView {
  entries: TimeEntry[];
  window: TimeWindowKey;
  scope: TimeScope;
  /** Whose hours this cut is, in a sentence the screen and the header share. */
  scopeNote: string;
  timeZone: string;
  /** The server's instant, which the ticking clock is anchored to. */
  now: string;
  callerStaffId: string;
  callerName: string;
  options: LedgerOptions;
}

export interface LedgerPreview {
  ok: boolean;
  error?: string;
  view?: LedgerView;
}

/** Both halves of a form post a wall clock; the ledger stores absolute instants. */
export interface TimeForm {
  task: string;
  category: string;
  note: string;
  jobId: string | null;
  applicationId: string | null;
  /** `YYYY-MM-DDTHH:mm` in the organisation timezone. Blank means "the database decides". */
  startValue: string;
  /** Null while a timer runs, or when the span is being closed as it is typed. */
  endValue: string | null;
}

/**
 * A posted form, turned into instants.
 *
 * `allowBlankStart` is what separates the two ways an entry is made: a back-dated
 * span has to name when it began, while a timer has to name nothing of the sort so
 * the database can. A form cannot opt into the second path by leaving the field
 * empty, because only `startTime` passes the flag.
 */
function draftOf(
  form: TimeForm,
  timeZone: string,
  allowBlankStart = false
): { value: TimeDraft } | { error: string } {
  const category: TimeCategory = isTimeCategory(form.category)
    ? form.category
    : ("SCREENING" as TimeCategory);

  let startedAt: string | null = null;
  const rawStart = form.startValue.trim();
  if (rawStart !== "") {
    startedAt = fromZoneInputValue(rawStart, timeZone);
    if (!startedAt) return { error: "That start date and time is not one the ledger accepts." };
  } else if (!allowBlankStart) {
    return { error: "Type a start date and time, like 2026-10-16T09:30." };
  }

  let endedAt: string | null = null;
  if (form.endValue !== null && form.endValue.trim() !== "") {
    endedAt = fromZoneInputValue(form.endValue, timeZone);
    if (!endedAt) return { error: "That end date and time is not one the ledger accepts." };
  }

  return normaliseDraft(
    {
      task: form.task,
      category,
      note: form.note,
      jobId: form.jobId,
      applicationId: form.applicationId,
      startedAt,
      endedAt,
    },
    Date.now()
  );
}

/** The openings and candidates a span can be pointed at, as the caller sees them. */
async function readOptions(): Promise<LedgerOptions> {
  const supabase = await createSupabaseServerClient();

  const [openings, candidates] = await Promise.all([
    supabase
      .from("job_openings")
      .select("id, title")
      .in("status", ["PUBLISHED", "PAUSED"])
      .order("posted_at", { ascending: false })
      .limit(60),
    supabase
      .from("applications")
      .select("id, full_name, job_openings(title)")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  const candidateRows = (candidates.data ?? []) as unknown as {
    id: string;
    full_name: string | null;
    job_openings?: { title?: string } | { title?: string }[] | null;
  }[];

  return {
    openings: (openings.data ?? []) as { id: string; title: string }[],
    candidates: candidateRows.map((row) => {
      const job = row.job_openings;
      const title = Array.isArray(job) ? job[0]?.title : job?.title;
      return { id: row.id, name: row.full_name ?? "An applicant", job: title ?? null };
    }),
  };
}

/**
 * One cut of the ledger.
 *
 * The page renders the first cut and the screen asks for the rest, so both let
 * the database decide whether the caller may see the rows — a server action is a
 * public endpoint, and `window` and `scope` arrive from a browser.
 */
export async function getLedger(raw: {
  window?: unknown;
  scope?: unknown;
} = {}): Promise<LedgerPreview> {
  const user = await requireStaff("/time");
  if (!(await hasPermissionForUser("time.track"))) return { ok: false, error: TRACK_DENIED };

  const [timeZone, options] = await Promise.all([getOrganisationTimeZone(), readOptions()]);

  const now = new Date();
  const cut = ledgerCut({ window: raw.window, scope: raw.scope }, timeZone, now);

  const read = await readLedger({
    since: cut.since,
    staffId: cut.scope === "mine" ? user.profileId : null,
    callerStaffId: user.profileId,
  });
  if (read.error) return { ok: false, error: read.error };

  return {
    ok: true,
    view: {
      entries: read.entries,
      window: cut.window,
      scope: cut.scope,
      scopeNote: cut.scopeNote,
      timeZone,
      now: now.toISOString(),
      callerStaffId: user.profileId,
      callerName: user.fullName,
      options,
    },
  };
}

/**
 * Starts a timer.
 *
 * No `started_at` is sent: the column default stamps it with the database clock,
 * the same clock `stopTime` ends it with, so a running figure is a measurement
 * rather than the difference between two machines' ideas of now.
 */
export async function startTime(form: TimeForm): Promise<LedgerWrite> {
  const user = await requireStaff("/time");
  if (!(await hasPermissionForUser("time.track"))) return { ok: false, error: TRACK_DENIED };

  const timeZone = await getOrganisationTimeZone();
  const checked = draftOf({ ...form, startValue: "", endValue: null }, timeZone, true);
  if ("error" in checked) return { ok: false, error: checked.error };

  const write = await insertEntry({
    staffId: user.profileId,
    companyId: user.tenantId,
    category: checked.value.category,
    task: checked.value.task,
    note: checked.value.note || null,
    jobId: checked.value.jobId,
    applicationId: checked.value.applicationId,
    endedAt: null,
  });
  if (!write.ok || !write.entry) return write;

  await recordActivity({
    area: "time",
    action: "timer_start",
    entity: "time entry",
    entityId: write.entry.id,
    summary: `Started a timer on “${write.entry.task}”`,
    detail: {
      category: write.entry.category,
      started_at: write.entry.started_at,
      candidate: write.entry.application_name ?? write.entry.application_id,
      opening: write.entry.job_title ?? write.entry.job_id,
    },
  });

  revalidatePath("/time");
  return { ok: true, entry: write.entry };
}

/** Stops the running timer named, and records how long it actually ran. */
export async function stopTime(id: string): Promise<LedgerWrite> {
  const user = await requireStaff("/time");
  if (!(await hasPermissionForUser("time.track"))) return { ok: false, error: TRACK_DENIED };
  if (!id) return { ok: false, error: "No timer was named." };

  const before = await readEntry(id);
  if (!before) return { ok: false, error: MISSING_ENTRY };
  if (before.staff_id !== user.profileId) return { ok: false, error: NOT_YOURS };
  if (before.ended_at) return { ok: false, error: "That timer has already been stopped." };

  const write = await stopEntry(id);
  if (!write.ok || !write.entry) return write;

  const seconds = elapsedSeconds(write.entry, Date.now());
  await recordActivity({
    area: "time",
    action: "timer_stop",
    entity: "time entry",
    entityId: write.entry.id,
    summary: `Logged ${formatSpan(seconds)} on “${write.entry.task}”`,
    detail: {
      category: write.entry.category,
      started_at: write.entry.started_at,
      ended_at: write.entry.ended_at,
      span: formatSpan(seconds),
    },
  });

  revalidatePath("/time");
  return { ok: true, entry: write.entry };
}

/**
 * Throws away a timer that was started by mistake.
 *
 * Separate from `stopTime` because the two say different things: stopping records
 * the minutes, discarding records nothing and leaves a trail row saying the start
 * was withdrawn. A mis-click should not cost the ledger an entry.
 */
export async function discardTime(id: string): Promise<LedgerWrite> {
  const user = await requireStaff("/time");
  if (!(await hasPermissionForUser("time.track"))) return { ok: false, error: TRACK_DENIED };
  if (!id) return { ok: false, error: "No timer was named." };

  const entry = await readEntry(id);
  if (!entry) return { ok: false, error: MISSING_ENTRY };
  if (entry.staff_id !== user.profileId) return { ok: false, error: NOT_YOURS };
  if (entry.ended_at) return { ok: false, error: "That timer has already been stopped." };

  const write = await deleteEntry(id);
  if (!write.ok) return write;

  await recordActivity({
    area: "time",
    action: "timer_discard",
    entity: "time entry",
    entityId: entry.id,
    summary: `Discarded a timer on “${entry.task}” without logging the time`,
    detail: { category: entry.category, started_at: entry.started_at },
  });

  revalidatePath("/time");
  return { ok: true };
}

/** Logs a span that happened earlier, which a timer cannot. */
export async function addTime(form: TimeForm): Promise<LedgerWrite> {
  const user = await requireStaff("/time");
  if (!(await hasPermissionForUser("time.track"))) return { ok: false, error: TRACK_DENIED };

  // A back-dated row with no end would be a second running timer, and the ledger
  // only ever holds one per person — so the form has to close the span.
  if (form.endValue === null || form.endValue.trim() === "")
    return { ok: false, error: "Say when that span ended, or press Start to run a timer." };

  const timeZone = await getOrganisationTimeZone();
  const checked = draftOf(form, timeZone);
  if ("error" in checked) return { ok: false, error: checked.error };

  const write = await insertEntry({
    staffId: user.profileId,
    companyId: user.tenantId,
    category: checked.value.category,
    task: checked.value.task,
    note: checked.value.note || null,
    jobId: checked.value.jobId,
    applicationId: checked.value.applicationId,
    startedAt: checked.value.startedAt ?? undefined,
    endedAt: checked.value.endedAt,
  });
  if (!write.ok || !write.entry) return write;

  const seconds = elapsedSeconds(write.entry, Date.now());
  await recordActivity({
    area: "time",
    action: "entry_add",
    entity: "time entry",
    entityId: write.entry.id,
    summary: `Added ${formatSpan(seconds)} to the ledger — “${write.entry.task}”`,
    detail: {
      category: write.entry.category,
      started_at: write.entry.started_at,
      ended_at: write.entry.ended_at,
    },
  });

  revalidatePath("/time");
  return { ok: true, entry: write.entry };
}

/**
 * Corrects an entry.
 *
 * A running row keeps running: its end is only ever written by `stopTime`, so
 * renaming a live timer moves its label and nothing else. That is also why the
 * stored row is read first — the diff a trail row describes has to be the diff
 * against what the ledger holds, not against what the form was loaded with.
 */
export async function editTime(id: string, form: TimeForm): Promise<LedgerWrite> {
  const user = await requireStaff("/time");
  if (!(await hasPermissionForUser("time.track"))) return { ok: false, error: TRACK_DENIED };
  if (!id) return { ok: false, error: "No entry was named." };

  const before = await readEntry(id);
  if (!before) return { ok: false, error: MISSING_ENTRY };
  if (before.staff_id !== user.profileId) return { ok: false, error: NOT_YOURS };

  const timeZone = await getOrganisationTimeZone();
  const running = before.ended_at === null;
  // Clearing the end of a finished row would turn it into a second running timer,
  // so the stored end stands unless the row is already running.
  const keepEnd = !running && (form.endValue === null || form.endValue.trim() === "");
  const checked = draftOf(
    { ...form, endValue: running || keepEnd ? null : form.endValue },
    timeZone
  );
  if ("error" in checked) return { ok: false, error: checked.error };

  const value = checked.value;
  // A draft with no start is a form bug rather than a real case — `draftOf` was
  // not told to allow one — so the stored start is what stands.
  const startedAt = value.startedAt ?? before.started_at;
  const closedAt = running || keepEnd ? before.ended_at : value.endedAt;
  const write = await updateEntry(id, {
    category: value.category,
    task: value.task,
    note: value.note || null,
    jobId: value.jobId,
    applicationId: value.applicationId,
    startedAt,
    ...(running || keepEnd ? {} : { endedAt: value.endedAt }),
  });
  if (!write.ok) return write;

  // The trail compares column names, because that is what a reader of the trail
  // recognises; the stored row is read back in the shape the client holds.
  const was: Record<string, unknown> = {
    task: before.task,
    category: before.category,
    note: before.note,
    job_id: before.job_id,
    application_id: before.application_id,
    started_at: before.started_at,
    ended_at: before.ended_at,
  };
  const now: Record<string, unknown> = {
    task: value.task,
    category: value.category,
    note: value.note || null,
    job_id: value.jobId,
    application_id: value.applicationId,
    started_at: startedAt,
    ended_at: closedAt,
  };
  const edits = changedFields(was, now);

  await recordActivity({
    area: "time",
    action: "entry_edit",
    entity: "time entry",
    entityId: id,
    summary: `Edited “${value.task}” — ${changePhrase(edits)}`,
    detail: edits,
  });

  revalidatePath("/time");
  return { ok: true, entry: write.entry };
}

/**
 * Removes an entry.
 *
 * The summary names what went, because after the delete nothing else in the
 * portal can: hours are one of the few records that really are erased here, so
 * the trail row is the only surviving account of them.
 */
export async function deleteTime(id: string): Promise<LedgerWrite> {
  const user = await requireStaff("/time");
  if (!(await hasPermissionForUser("time.track"))) return { ok: false, error: TRACK_DENIED };
  if (!id) return { ok: false, error: "No entry was named." };

  const before = await readEntry(id);
  if (!before) return { ok: false, error: MISSING_ENTRY };
  if (before.staff_id !== user.profileId) return { ok: false, error: NOT_YOURS };

  const write = await deleteEntry(id);
  if (!write.ok) return write;

  await recordActivity({
    area: "time",
    action: "entry_delete",
    entity: "time entry",
    entityId: id,
    summary: `Removed ${formatSpan(elapsedSeconds(before, Date.now()))} from the ledger — “${before.task}”`,
    detail: {
      category: before.category,
      started_at: before.started_at,
      ended_at: before.ended_at,
      candidate: before.application_name ?? null,
      opening: before.job_title ?? null,
    },
  });

  revalidatePath("/time");
  return { ok: true };
}
