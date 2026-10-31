import type { JobOpening, JobStatus } from "@/core/entities";
import { isMissingSchemaError } from "./missingSchema";
import type { StaffReadClient } from "./restClient";

/**
 * `job_openings` — reads a vacancy is answered with.
 *
 * The opening's own rules (which statuses a person may still be filed under,
 * how a picker labels a draft, how many rows a window ships) stay in
 * `src/modules/jobs/domain/hireable`; a caller passes its vocabulary in and this
 * layer only says which columns come back. Deciding hireability here would put
 * the rule a door enforces somewhere the door's own module cannot see it.
 */

/** The columns every opening guard reads: what it is, and whether it is still live. */
export type OpeningGuardFields = Pick<JobOpening, "id" | "title" | "status">;

/**
 * The public apply doors' one question about an opening: is it open.
 *
 * Six doors ask it — the CV upload, the two prefill routes, the gate-question
 * read, the About-you draft and the form builder's public walk — each with the
 * same four lines and a comment naming the door it copied. They are kept apart
 * by what they answer: a role that fell to draft, a role that was deleted and a
 * database that refused the read are three different things to tell an
 * applicant, and a door that reports the third as the first sends people away
 * from a job that is still hiring.
 */
export type PublishedOpeningFields = Pick<JobOpening, "id">;

export async function readPublishedOpening(
  restClient: StaffReadClient,
  jobId: string
): Promise<
  | { ok: true; opening: PublishedOpeningFields }
  | { ok: false; reason: "not_open" }
  | { ok: false; reason: "read_failed"; error: string }
> {
  const { data, error } = await restClient
    .from("job_openings")
    .select("id")
    .eq("id", jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "read_failed", error: `That opening could not be read: ${error.message}` };
  }
  if (!data) return { ok: false, reason: "not_open" };
  return { ok: true, opening: data as unknown as PublishedOpeningFields };
}

/**
 * One opening's title and status, by id — the read that sits in front of every
 * "may this land on that opening?" rule.
 *
 * The caller decides what the status means for its own door: a form needs a
 * published role before it can be sent to applicants, a gate question needs one
 * before it can be asked, and a hire needs any role that is not closed. All of
 * them start by asking whether the opening is there at all.
 */
export async function readOpeningTitleAndStatus(
  restClient: StaffReadClient,
  jobId: string
): Promise<
  { ok: true; opening: OpeningGuardFields } | { ok: false; reason: "gone" | "read_failed"; error: string }
> {
  const { data, error } = await restClient
    .from("job_openings")
    .select("id, title, status")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "read_failed", error: `That opening could not be read: ${error.message}` };
  }
  if (!data) {
    return { ok: false, reason: "gone", error: "That opening no longer exists." };
  }
  return { ok: true, opening: data as unknown as OpeningGuardFields };
}

/** How many openings the picker-window read ships. */
export const OPENING_WINDOW_LIMIT = 200;

/**
 * The newest openings in the given statuses, with the head count of that whole
 * set beside them.
 *
 * Both halves belong to one read because a picker that lists twenty of sixty
 * roles has to be able to say so: the rows are the window and the count is the
 * truth about the scope, and a caller that asked for one and not the other would
 * have to make a second round trip to write its own note.
 */
export async function readOpeningPickerWindow(
  restClient: StaffReadClient,
  options: { statuses: readonly JobStatus[]; limit?: number }
): Promise<
  | { ok: true; rows: OpeningGuardFields[]; total: number | null }
  | { ok: false; error: string }
> {
  const limit = options.limit ?? OPENING_WINDOW_LIMIT;
  const [rows, count] = await Promise.all([
    restClient
      .from("job_openings")
      .select("id, title, status")
      .in("status", [...options.statuses])
      .order("created_at", { ascending: false })
      .limit(limit),
    restClient
      .from("job_openings")
      .select("id", { count: "exact", head: true })
      .in("status", [...options.statuses]),
  ]);

  if (rows.error) {
    return { ok: false, error: rows.error.message };
  }
  return {
    ok: true,
    rows: (rows.data ?? []) as unknown as OpeningGuardFields[],
    total: count.error ? null : count.count ?? null,
  };
}

/**
 * The seniority level of an opening, as the column holds it.
 *
 * `experience_level` is `text` with a CHECK, not an enum, so a row can carry a
 * word the vocabulary has never heard. The type says `string | null` rather than
 * agreeing with the entity's narrower field on purpose: every door that shows
 * the level classifies the word itself instead of trusting the cast.
 */
export type OpeningExperienceRow = Pick<JobOpening, "id"> & { experience_level: string | null };

/**
 * Whether the seniority column could be read at all.
 *
 * Three doors ask the same question of the same column and give three different
 * answers when it is missing — the public board returns no levels and does not
 * log a schema refusal on every cache revalidation, the grid says "not stored"
 * and names the migration, the assistant's scoped read reports the incident. All
 * three need the one fact this carries: was the refusal about the schema, or
 * about this request?
 */
export type OpeningExperienceRead =
  | { ok: true; rows: OpeningExperienceRow[] }
  | { ok: false; missingSchema: boolean; error: string };

/**
 * The seniority levels of openings already in hand, asked for by id.
 *
 * Used where the rows were chosen by a filter rather than by recency, so the
 * levels cannot silently describe a different window of openings.
 */
export async function readOpeningExperienceLevels(
  restClient: StaffReadClient,
  ids: readonly string[]
): Promise<OpeningExperienceRead> {
  const { data, error } = await restClient
    .from("job_openings")
    .select("id, experience_level")
    .in("id", [...ids]);

  if (error) {
    return { ok: false, missingSchema: isMissingSchemaError(error), error: error.message };
  }
  return { ok: true, rows: (data ?? []) as unknown as OpeningExperienceRow[] };
}

/**
 * The seniority levels of the newest openings, in the grid's own order.
 *
 * Read apart from the grid's row read, the same way the headcount target is: the
 * column arrives with its own ALTER, and on a database where that file has not
 * run naming it in the main `select` would refuse the entire openings page —
 * including the applicants, the rails and the positions picker, none of which
 * need it. Isolated here, a missing column costs only the level.
 *
 * The window takes the caller's limit and is matched back by id, so a row the
 * two reads disagree about is reported as "no level recorded" rather than
 * mismatched onto another opening.
 */
export async function readOpeningExperienceLevelWindow(
  restClient: StaffReadClient,
  options: { limit: number }
): Promise<OpeningExperienceRead> {
  const { data, error } = await restClient
    .from("job_openings")
    .select("id, experience_level")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, options.limit - 1);

  if (error) {
    return { ok: false, missingSchema: isMissingSchemaError(error), error: error.message };
  }
  return { ok: true, rows: (data ?? []) as unknown as OpeningExperienceRow[] };
}
