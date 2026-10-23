import "server-only";

import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import type { RestClient } from "@/lib/rest/client";
import { createServerRestClient } from "@/lib/data-api/server";
import { getServiceRestClient } from "@/lib/data-api/service";
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
async function readGrants(restClient: RestClient, roleKey: string): Promise<Set<PermissionKey>> {
  const { data, error } = await restClient
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
 * when the entry revalidates up to fifteen minutes later.
 *
 * This lifetime is what it is for a reason: `minutes` keeps the entry inside
 * prerenders (`cacheLife.md:266` — an `expire` under 5 minutes makes a cache a
 * dynamic hole), and a shell that could not be built is worse than a grant list
 * that revalidates. Staff routes read it behind a session, so none of them is
 * prerendered with a real answer in it either way.
 */
async function cachedGrantsForRole(roleKey: string): Promise<Set<PermissionKey> | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("role-grants");

  const { data, error } = await getServiceRestClient()
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

  const restClient = await createServerRestClient();
  return readGrants(restClient, roleKey);
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

/**
 * Whether the signed-in member may open a staff account that did not exist.
 *
 * The manage gate plus `users.create`: editing, disabling and deleting the
 * accounts a company already has is a different hand from inventing a new one,
 * and the matrix keeps a box for each. Both reads come off the request's cached
 * grant set, so this costs no query beyond `canManageStaffUsers`.
 */
export async function canCreateStaffUsers(): Promise<boolean> {
  const granted = await permissionsForCurrentUser();
  return STAFF_MANAGE_KEYS.some((key) => granted.has(key)) && granted.has("users.create");
}

/**
 * Whether the signed-in member may book, move or score an interview slot.
 *
 * Both grants, because the matrix keeps them apart: `candidates.write` is the
 * hand on the applicant's record and `interviews.schedule` is the calendar the
 * slot sits on. A member with only the first edits the candidate but cannot put
 * a panel in the diary; only the second gets a calendar they cannot write the
 * applicant behind it.
 *
 * This is also what makes the "Schedule interviews" box in the matrix decide
 * something: the booking, reschedule and outcome actions all pass through it.
 */
export async function canScheduleInterviews(): Promise<boolean> {
  const granted = await permissionsForCurrentUser();
  return granted.has("candidates.write") && granted.has("interviews.schedule");
}
