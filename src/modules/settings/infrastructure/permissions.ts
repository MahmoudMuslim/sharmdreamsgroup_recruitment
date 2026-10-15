import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import type { PermissionKey } from "@/modules/settings/domain/types";

/**
 * Checks whether the signed-in staff member holds a permission.
 *
 * The caller's role comes from the request-cached session and the grants are
 * read once per request, so a page that asks about five permissions costs one
 * auth round trip and one query instead of five of each. The database remains
 * the source of truth, so revoking a grant takes effect immediately without a
 * redeploy.
 */
export async function hasPermissionForUser(permission: PermissionKey): Promise<boolean> {
  return (await callerGrants()).has(permission);
}

/** All permissions granted to the signed-in staff member, as a lookup set. */
export async function permissionsForCurrentUser(): Promise<Set<PermissionKey>> {
  return callerGrants();
}

const callerGrants = cache(async (): Promise<Set<PermissionKey>> => {
  const user = await getSessionUser();
  if (!user) return new Set();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_key", user.role as string)
    .eq("granted", true);

  if (error) return new Set();
  return new Set((data ?? []).map((row) => row.permission_key as PermissionKey));
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
