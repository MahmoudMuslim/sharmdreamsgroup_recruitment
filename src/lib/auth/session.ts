import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/data-api/server";
import { verifySessionToken } from "@/lib/auth/token";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
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
 * The bearer is verified locally against `AUTH_JWT_SECRET` — there is no auth
 * service to ask — and `user_profiles` is then read *through that bearer*, so
 * Row Level Security still decides whether the profile is visible. That second
 * part matters: verifying the signature proves who the caller is, not what they
 * may see, and skipping the RLS read here would hand a revoked account its old
 * role until the token aged out.
 *
 * Returns `null` when there is no session or the profile row is missing.
 *
 * Cached per request, on purpose. It was added because `auth.getUser()` was a
 * network call to the auth service and one admin page asked half a dozen times
 * (the guard, each read action, each permission check); verify is local now, but
 * the profile read below is still a round trip, so the wrapper still earns its
 * keep.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const bearer = jar.get(SESSION_COOKIE)?.value;
  if (!bearer) return null;

  const claims = await verifySessionToken(bearer);
  if (!claims || claims.role !== "authenticated") return null;

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, auth_user_id, full_name, email, role, tenant_id")
    .eq("auth_user_id", claims.sub)
    .maybeSingle();

  if (!profile) return null;

  return {
    authUserId: claims.sub,
    profileId: profile.id as string,
    // Both identity fields come from `user_profiles`, not from the token's
    // claims. A claim is a signature, not a directory: the old code could fall
    // back to `user.email` because GoTrue put the address in the token, and this
    // one deliberately does not, so a renamed account is never read under its
    // stale claim. The profile row is where this portal keeps the address a
    // recruiter is known by.
    email: (profile.email as string) ?? "",
    fullName: (profile.full_name as string) ?? "Unknown user",
    role: profile.role as UserRole,
    tenantId: (profile.tenant_id as string | null) ?? null,
  };
});

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