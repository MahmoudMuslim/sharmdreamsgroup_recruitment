import "server-only";

import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionUser } from "@/lib/auth/session";
import type { PermissionKey } from "@/modules/settings/domain/types";

/**
 * Checks whether the signed-in staff member holds a permission.
 *
 * The caller's role comes from the request-cached session and the grants are
 * read once per request, so a page that asks about five permissions costs one
 * auth round trip and one query instead of five of each.
 */
export async function hasPermissionForUser(permission: PermissionKey): Promise<boolean> {
  return (await callerGrants()).has(permission);
}

/** All permissions granted to the signed-in staff member, as a lookup set. */
export async function permissionsForCurrentUser(): Promise<Set<PermissionKey>> {
  return callerGrants();
}

/** The grants for one role, read with whichever client the caller holds. */
async function readGrants(supabase: SupabaseClient, roleKey: string): Promise<Set<PermissionKey>> {
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_key", roleKey)
    .eq("granted", true);

  if (error) return new Set();
  return new Set((data ?? []).map((row) => row.permission_key as PermissionKey));
}

/**
 * The grants a role holds, cached across requests.
 *
 * `role_permissions` is global — no tenant or company column — so the rows for
 * `RECRUITER` are the same set for every recruiter, and the portal used to ask
 * for them on every navigation. Keyed by the role string the session already
 * proved, read with the service client because a cached entry cannot depend on
 * one caller's cookies.
 *
 * `null`, not an empty set, answers a failed read: caching a database hiccup as
 * "this role holds nothing" would lock the portal out for the cache window. The
 * caller reads live instead, exactly as it did before this cache existed.
 *
 * The database is still the source of truth: `updateRolePermission` evicts this
 * tag in the same action that writes a grant, so a change shows up on the next
 * render. Eviction is local to the serving instance, so a second one converges
 * when `minutes` expires.
 */
async function cachedGrantsForRole(roleKey: string): Promise<Set<PermissionKey> | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("role-grants");

  const { data, error } = await getSupabaseServiceClient()
    .from("role_permissions")
    .select("permission_key")
    .eq("role_key", roleKey)
    .eq("granted", true);

  if (error) return null;
  return new Set((data ?? []).map((row) => row.permission_key as PermissionKey));
}

const callerGrants = cache(async (): Promise<Set<PermissionKey>> => {
  const user = await getSessionUser();
  if (!user) return new Set();

  const roleKey = String(user.role);
  const cached = await cachedGrantsForRole(roleKey);
  if (cached) return cached;

  const supabase = await createSupabaseServerClient();
  return readGrants(supabase, roleKey);
});

/**
 * Whether the signed-in member may create, edit and disable staff accounts.
 *
 * Three seeded keys all carry that meaning: `users.manage` and
 * `settings.manage_users` are both granted to Super Admin and Subsidiary HR
 * Manager, and `settings.manage_platform` is the group-wide grant — so checking
 * only one of them would lock out roles the database already authorised.
 */
export const STAFF_MANAGE_KEYS: readonly PermissionKey[] = [
  "users.manage",
  "settings.manage_users",
  "settings.manage_platform",
];

export async function canManageStaffUsers(): Promise<boolean> {
  const granted = await permissionsForCurrentUser();
  return STAFF_MANAGE_KEYS.some((key) => granted.has(key));
}
