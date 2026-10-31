import type { JobOpening, JobStatus } from "@/core/entities";
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
