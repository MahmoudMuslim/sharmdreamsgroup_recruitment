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