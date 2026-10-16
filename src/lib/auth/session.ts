import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loginSearch } from "@/lib/auth/login-target";
import type { UserRole } from "@/types";

export interface SessionUser {
  authUserId: string;
  /**
   * `user_profiles.id` — the row every FK to a person points at, including the
   * audit trail's actor. Carried here so an action that stamps who made a
   * change does not have to spend another query finding out.
   */
  profileId: string;
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
 *
 * Cached per request: `auth.getUser()` is a network call to the auth service,
 * and one admin page asks half a dozen times (the guard, each read action, each
 * permission check). Without this the same JWT was verified on every one of
 * them, which dominated the settings page's time to first byte.
 */
export const getSessionUser = cache(
  async (): Promise<SessionUser | null> => {
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
      profileId: profile.id as string,
      email: profile.email ?? user.email ?? "",
      fullName: profile.full_name ?? user.email ?? "Unknown user",
      role: profile.role as UserRole,
      tenantId: profile.tenant_id ?? null,
    };
  }
);

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
 *
 * `nextPath` is where to come back to, and a caller that knows the view it is
 * rendering can pass its query with the path. The proxy usually answers that
 * first — it sees the request's own URL — so this fires for the session that a
 * page-level read rejects, such as a profile row that no longer exists.
 */
export async function requireStaff(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) redirect(`/login${loginSearch(nextPath)}`);
  if (!isStaff(user.role)) redirect("/portal?denied=staff-only");

  return user;
}