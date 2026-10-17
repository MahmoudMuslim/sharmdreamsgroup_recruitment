"use server";

import { requireStaff } from "@/lib/auth/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import {
  SETTINGS_TRAIL_LIMIT,
  trailGroup,
  trailGroupById,
  trailGroupFor,
  trailKeyLabel,
  trailOffset,
  trailPage,
  trailPageCount,
  trailValueText,
} from "@/modules/settings/domain/settingsTrail";

const AUDIT_DENIED =
  "Reading the change trail needs the Manage platform settings permission.";

/**
 * One recorded change, in the words the console prints.
 *
 * `from` and `to` are the two stored values already rendered short, so neither the
 * browser nor the chat has to re-implement how a boolean, a list of languages or a
 * deleted row reads. `group` is the id a reader can scope by, not its label: the
 * label comes from the same vocabulary the scope is validated against, so a row and
 * a filter can never disagree about what a change is filed under.
 */
export interface SettingsTrailEntryView {
  id: string;
  key: string;
  label: string | null;
  group: string | null;
  from: string;
  to: string;
  actor: string | null;
  createdAt: string;
}

export type SettingsTrailRead =
  | {
      ok: true;
      entries: SettingsTrailEntryView[];
      /** Rows in the database at this scope — more than `entries` on every page but the last. */
      total: number;
      /** How many rows at this scope name the person who made the change. */
      named: number;
      /** The page actually served: a request past the end is clamped, never answered blank. */
      page: number;
    }
  | { ok: false; error: string };

/**
 * The settings change trail, newest first, a page at a time, with the counts the
 * listing is drawn from.
 *
 * Both counts carry the same scope predicate as the rows, which is the only way a
 * scoped answer can say "page 2 of 5 for Notifications" instead of quoting the
 * whole table beside a filtered list. `named` is asked separately because the note
 * makes a claim about every row in scope, not about the ones on screen.
 *
 * A page rather than a cursor, because `changed_at` is not a unique column here: a
 * save writes one audit row per setting it moved, all under the same transaction
 * timestamp, and the live table shows how often that bites — 152 rows share 38
 * timestamps, six to a second at the most. A `changed_at < cursor` walk would
 * therefore drop the rest of any batch it happened to split, which is exactly the
 * silent gap this read exists to close. Ordering by `changed_at` then `id` is a
 * total order over the scope, so page N is a stable slice: every row appears on
 * exactly one page, and the last page ends the trail.
 *
 * Read with the service client after the permission has been checked here, and that
 * order matters twice over. `settings_audit_read` lets only
 * `settings.manage_platform` through, and an RLS-refused SELECT returns an empty
 * list with no error — so a session-scoped read would report "no changes recorded"
 * to a recruiter it simply cannot answer, which is a different statement from the
 * truth. The actor's name also comes through a `user_profiles` embed, and
 * `profiles_self_read` limits that to the reader's own row: under the session
 * client every other person's name would vanish and the console would say
 * "no actor recorded" about a row that has one.
 */
export async function listSettingsTrail(
  scope: { group?: string | null; page?: string | number | null } = {}
): Promise<SettingsTrailRead> {
  await requireStaff("/settings");
  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: AUDIT_DENIED };
  }

  const group = trailGroupById(trailGroup(scope.group));
  const admin = getSupabaseServiceClient();

  /**
   * One page of the scope, in the trail's own newest-first order.
   *
   * The scope predicate is repeated in each builder on purpose: a helper that took
   * a query and handed it back lost the builder's chain, and every one of these
   * reads has to describe exactly the same rows as the listing beside it, or a
   * scoped note quotes the whole trail.
   */
  const rowsOf = (asked: number) => {
    const offset = trailOffset(asked);
    let query = admin
      .from("settings_audit_log")
      .select(
        "id, key, previous_value, next_value, changed_at, changed_by, user_profiles(full_name)"
      );
    if (group?.kind === "keys") query = query.in("key", group.keys);
    else if (group) query = query.like("key", `${group.prefix}%`);
    return query
      .order("changed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + SETTINGS_TRAIL_LIMIT - 1);
  };

  /** How many rows the scope holds, or how many of them name an actor. */
  const countOf = (onlyActor: boolean) => {
    let query = admin
      .from("settings_audit_log")
      .select("id", { count: "exact", head: true });
    if (onlyActor) query = query.not("changed_by", "is", null);
    if (group?.kind === "keys") query = query.in("key", group.keys);
    else if (group) query = query.like("key", `${group.prefix}%`);
    return query;
  };

  const refuse = (message: string): SettingsTrailRead => {
    console.error("[settings] change trail refused:", message);
    return { ok: false, error: `The change trail could not be read: ${message}` };
  };

  let page = trailPage(scope.page);
  const [listed, sized, actors] = await Promise.all([
    rowsOf(page),
    countOf(false),
    countOf(true),
  ]);
  // Without the counts the note would claim a trail was empty, or that nobody
  // acted, when the number was never taken.
  if (sized.error) return refuse(sized.error.message);
  if (actors.error) return refuse(actors.error.message);

  const total = sized.count ?? 0;
  const lastPage = trailPageCount(total);
  let found = listed.data ?? [];
  // A page beyond the end is answered with the oldest page instead of with a
  // failure: `?range=` past the last row is refused outright by PostgREST rather
  // than returning an empty slice, so a bookmark for page 40 of a 152-row trail
  // would read as "the change trail could not be read". The count beside it is
  // the same scope predicate, so it already says where the trail ends.
  if (page > lastPage) {
    page = lastPage;
    const again = await rowsOf(page);
    if (again.error) return refuse(again.error.message);
    found = again.data ?? [];
  } else if (listed.error) {
    return refuse(listed.error.message);
  }

  const entries = (found as unknown[]).map((row) => {
    const r = row as {
      id: string;
      key: string;
      previous_value?: unknown;
      next_value?: unknown;
      changed_at: string;
      user_profiles?: { full_name?: string } | { full_name?: string }[] | null;
    };
    const actor = Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles;
    return {
      id: r.id,
      key: r.key,
      label: trailKeyLabel(r.key),
      group: trailGroupFor(r.key)?.id ?? null,
      from: trailValueText(r.previous_value),
      to: trailValueText(r.next_value),
      actor: actor?.full_name ?? null,
      createdAt: r.changed_at,
    };
  });

  return { ok: true, entries, total, named: actors.count ?? 0, page };
}
