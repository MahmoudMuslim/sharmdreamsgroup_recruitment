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
      /** Rows in the database at this scope — more than `entries` whenever the cap bit. */
      total: number;
      /** How many rows at this scope name the person who made the change. */
      named: number;
    }
  | { ok: false; error: string };

/**
 * The settings change trail, newest first, with the counts the listing is drawn from.
 *
 * Both counts carry the same scope predicate as the rows, which is the only way a
 * scoped answer can say "15 of the 71 for Notifications" instead of quoting the
 * whole table beside a filtered list. `named` is asked separately because the note
 * makes a claim about every row in scope, not about the ones on screen.
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
  scope: { group?: string | null } = {}
): Promise<SettingsTrailRead> {
  await requireStaff("/settings");
  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: AUDIT_DENIED };
  }

  const group = trailGroupById(trailGroup(scope.group));
  const admin = getSupabaseServiceClient();

  let rowsQuery = admin
    .from("settings_audit_log")
    .select("id, key, previous_value, next_value, changed_at, changed_by, user_profiles(full_name)", {
      count: "exact",
    });
  let namedQuery = admin
    .from("settings_audit_log")
    .select("id", { count: "exact", head: true })
    .not("changed_by", "is", null);

  if (group?.kind === "keys") {
    rowsQuery = rowsQuery.in("key", group.keys);
    namedQuery = namedQuery.in("key", group.keys);
  } else if (group) {
    rowsQuery = rowsQuery.like("key", `${group.prefix}%`);
    namedQuery = namedQuery.like("key", `${group.prefix}%`);
  }

  const [{ data, count, error }, { count: namedCount, error: namedError }] = await Promise.all([
    rowsQuery.order("changed_at", { ascending: false }).limit(SETTINGS_TRAIL_LIMIT),
    namedQuery,
  ]);

  if (error) {
    console.error("[settings] change trail refused:", error.message);
    return { ok: false, error: `The change trail could not be read: ${error.message}` };
  }
  // Without this the note would claim nobody acted, which is a statement about a
  // count that was never taken.
  if (namedError) {
    console.error("[settings] change trail actor count refused:", namedError.message);
    return { ok: false, error: `The change trail could not be read: ${namedError.message}` };
  }

  const entries = ((data ?? []) as unknown[]).map((row) => {
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

  return {
    ok: true,
    entries,
    total: count ?? entries.length,
    named: namedCount ?? 0,
  };
}
