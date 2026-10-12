import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types";

export interface SessionUser {
  authUserId: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantId: string | null;
}

/**
 * Resolves the signed-in staff member from the request cookie jar.
 *
 * The Supabase server client carries the user's JWT, so every query made with
 * it is evaluated against Row Level Security using `auth.uid()`. Staff roles
 * are stored in `user_profiles`; the RLS helper functions read from there.
 *
 * Returns `null` when there is no session or the profile row is missing.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, auth_user_id, full_name, email, role, tenant_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    authUserId: user.id,
    email: profile.email ?? user.email ?? "",
    fullName: profile.full_name ?? user.email ?? "Unknown user",
    role: profile.role as UserRole,
    tenantId: profile.tenant_id ?? null,
  };
}

/** Roles allowed inside the recruiter/admin portal. */
export const STAFF_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "RECRUITER",
  "HIRING_MANAGER",
] as const;

export function isStaff(role: UserRole | undefined): boolean {
  return role !== undefined && STAFF_ROLES.includes(role);
}

/**
 * Page-level guard: bounces anonymous visitors to the sign-in screen and
 * keeps candidates out of the recruiter portal.
 */
export async function requireStaff(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!isStaff(user.role)) redirect("/portal?denied=staff-only");

  return user;
}