/**
 * Which openings a person can still be placed on.
 *
 * Three doors file someone under a role — converting a sourced prospect, linking
 * or importing a pool, recording a walk-in — the assistant drives every one of
 * them, and each keeps its own dropdown. A rule written by a picker is a rule the
 * next picker breaks, so it lives here.
 *
 * A CLOSED role is one the group stopped hiring for. Filing a candidate into it
 * puts a person in a pipeline that leads nowhere, and naming it in outreach copy
 * advertises a vacancy that no longer exists. A draft or a paused opening is
 * different: the role is real and unfilled, so a recruiter may legitimately build
 * its pipeline before it launches or while it is on hold — which is why those stay
 * on the list with their status shown rather than being hidden.
 */

/** The four `job_status` values — see the enum in `supabase/schema.sql`. */
export const JOB_STATUSES = ["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** Everything a person may still be filed under: any role that is not closed. */
export const HIREABLE_STATUSES: readonly JobStatus[] = ["DRAFT", "PUBLISHED", "PAUSED"];

/** How many openings one picker ships. A window into the hireable set, not the set. */
export const PICKER_LIMIT = 200;

/**
 * How many openings one read answers with.
 *
 * Smaller than a picker on purpose: a list of openings goes into the assistant's
 * context, where a result that outgrows its clip returns broken JSON the model
 * cannot tell apart from a short answer. This is the number an answer is allowed
 * to claim it named, so the read and the sentence about it come from here.
 */
export const OPENING_READ_LIMIT = 50;

export function isHireable(status: string): boolean {
  return (HIREABLE_STATUSES as readonly string[]).includes(status);
}

const STATUS_WORDS: Record<JobStatus, string> = {
  DRAFT: "draft",
  PUBLISHED: "published",
  PAUSED: "paused",
  CLOSED: "closed",
};

/**
 * How one opening reads inside a dropdown.
 *
 * A listed role that is not published is still a real, unfilled job, so it stays
 * on the list — but the recruiter has to see that it is not advertised yet, or
 * outreach quotes a vacancy the public cannot find.
 */
export function openingOptionLabel(title: string, status: string): string {
  const word = STATUS_WORDS[status as JobStatus];
  return !word || word === "published" ? title : `${title} — ${word}`;
}

/**
 * The refusal a closed opening gets.
 *
 * It names the door that already exists — `/jobs` offers Publish on any
 * non-published row — because a recruiter told only "not allowed" has nowhere to
 * go with the prospect in front of them.
 */
export function closedOpeningRefusal(title: string): string {
  return `“${title}” is closed, so no one can be filed under it. Reopen that opening from Jobs, or choose another role.`;
}

/** Said out loud when a picker could not fit every hireable opening onto it. */
export function pickerWindowNote(total: number, loaded: number): string | null {
  if (total <= loaded) return null;
  const dropped = total - loaded;
  return `This list holds the newest ${loaded.toLocaleString()} of the ${total.toLocaleString()} ${
    total === 1 ? "opening" : "openings"
  } you can still hire for — one picker carries ${PICKER_LIMIT.toLocaleString()}, so ${dropped.toLocaleString()} older ${
    dropped === 1 ? "role is" : "roles are"
  } missing from the dropdown.`;
}

/**
 * What an openings read is allowed to claim about its own scope.
 *
 * `scope` is the noun phrase the query asked for — "openings", "openings in
 * DRAFT", "openings you can still hire for" — so the sentence names the set it
 * counted rather than leaving a bare number to be read as "everything".
 */
export function openingReadNote(total: number, loaded: number, scope: string): string {
  if (total <= loaded) {
    return `All ${scope} are named here (${total.toLocaleString()}).`;
  }
  const dropped = total - loaded;
  return `This answer names the newest ${loaded.toLocaleString()} of the ${total.toLocaleString()} ${scope} — one read carries ${OPENING_READ_LIMIT.toLocaleString()}, so ${dropped.toLocaleString()} older ${
    dropped === 1 ? "role is" : "roles are"
  } not in it. /jobs lists them all.`;
}
