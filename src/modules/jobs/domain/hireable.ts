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
 * How many openings the /jobs grid may hold in the browser at once.
 *
 * The grid filters its rails and its search box over the rows it already has,
 * because the counts on the chips are the information and a rail that costs a
 * round trip per click would not answer instantly. So the read is bounded instead
 * of open-ended: the newest `GRID_ROW_LIMIT` openings come back with the exact
 * size of the scope beside them, and `gridWindowNote` says what is not in hand.
 */
export const GRID_ROW_LIMIT = 200;

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
 * Said out loud when the grid could not carry every opening in the scope.
 *
 * The grid's chips, its applicant total and its search box all work over the rows
 * it holds, so a truncated read has to say so: otherwise a recruiter who is told
 * "3 draft openings" has no way to know the fourth is not in the browser.
 */
export function gridWindowNote(total: number, loaded: number): string | null {
  if (total <= loaded) return null;
  const dropped = total - loaded;
  return `The grid carries the newest ${loaded.toLocaleString()} of the ${total.toLocaleString()} openings — one read holds ${GRID_ROW_LIMIT.toLocaleString()}, so ${dropped.toLocaleString()} older ${
    dropped === 1 ? "role is" : "roles are"
  } not in this browser, and the counts on the rails and the applicant total cover only the rows here.`;
}

/**
 * What an openings read is allowed to claim about its own scope.
 *
 * `scope` is the noun phrase the query asked for — "openings", "openings in
 * DRAFT", "openings you can still hire for" — so the sentence names the set it
 * counted rather than leaving a bare number to be read as "everything".
 *
 * `shown` and `search` are the two numbers a text search moves: the read still
 * carries `loaded`, but the answer now names fewer rows than that, and the words
 * only ever reached the rows in hand. The grid reaches further than an answer does
 * — it holds the newest `GRID_ROW_LIMIT` openings rather than the whole set — so
 * `/jobs` is named as the door for the rows this read could not see, never as a
 * place that can answer "there is no such role" about a set it also stopped short
 * of. A chat answer searches the newest `OPENING_READ_LIMIT` and says so.
 */
export function openingReadNote(
  total: number,
  loaded: number,
  scope: string,
  shown: number = loaded,
  search: string | null = null
): string {
  const dropped = total - loaded;
  if (total <= loaded) {
    const base = `All ${scope} are named here (${total.toLocaleString()}).`;
    if (!search) return base;
    const hits =
      shown === 0
        ? "matched none of them"
        : shown === total
          ? "matched every one of them"
          : `matched ${shown.toLocaleString()} of them`;
    return `${base} “${search}” ${hits}, and the whole set was searched, so no other opening holds those words.`;
  }
  const window = `This answer names the newest ${loaded.toLocaleString()} of the ${total.toLocaleString()} ${scope} — one read carries ${OPENING_READ_LIMIT.toLocaleString()}, so ${dropped.toLocaleString()} older ${
    dropped === 1 ? "role is" : "roles are"
  } not in it. The Jobs grid reads deeper (${GRID_ROW_LIMIT.toLocaleString()} of them) and paginates them.`;
  if (!search) return window;
  const hits =
    shown === 0
      ? "matched none of those"
      : shown === loaded
        ? "matched every one of those"
        : `matched ${shown.toLocaleString()} of those`;
  return `${window} “${search}” ${hits} — the ${dropped.toLocaleString()} older ${
    dropped === 1 ? "opening" : "openings"
  } beyond the read ${dropped === 1 ? "was" : "were"} never searched, so /jobs may show a role this answer could not see.`;
}
