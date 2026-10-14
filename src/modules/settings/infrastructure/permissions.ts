import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PermissionKey } from "@/modules/settings/domain/types";

/**
 * Checks whether the signed-in staff member holds a permission.
 *
 * Two small, RLS-scoped reads rather than one clever join: resolve the caller's
 * role from `user_profiles`, then look for a granted row in
 * `role_permissions`. The database remains the source of truth, so revoking a
 * grant takes effect immediately without a redeploy.
 */
export async function hasPermissionForUser(permission: PermissionKey): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!profile) return false;

  const { data: grant, error } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_key", profile.role as string)
    .eq("permission_key", permission)
    .eq("granted", true)
    .maybeSingle();

  return !error && Boolean(grant);
}

/** All permissions granted to the signed-in staff member, as a lookup set. */
export async function permissionsForCurrentUser(): Promise<Set<PermissionKey>> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Set();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!profile) return new Set();

  const { data } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_key", profile.role as string)
    .eq("granted", true);

  return new Set((data ?? []).map((row) => row.permission_key as PermissionKey));
}

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
