import type { UserProfile } from "@/core/entities";
import type { StaffReadClient } from "./restClient";

/**
 * `user_profiles` — reads that turn an auth account into the row the app stores
 * beside its changes.
 *
 * The account, not the person: this id is what a trail row, a file owner or a
 * saved session points at. `person_profiles` is a different table and a
 * different projection.
 */

/**
 * The `user_profiles.id` for a signed-in account, or the reason it is not known.
 *
 * Ten staff doors wrote this three-line read themselves, each with its own
 * `?? null` that hid the difference between "no such account" and "the read
 * failed". Keeping that distinction here is the point: a caller may still
 * choose `null`, but it has to say so.
 */
export async function readStaffProfileIdByAuthUserId(
  restClient: StaffReadClient,
  authUserId: string
): Promise<
  | { ok: true; profileId: string | null }
  | { ok: false; error: string }
> {
  const { data, error } = await restClient
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: `The staff account could not be read: ${error.message}` };
  }
  const row = data as Pick<UserProfile, "id"> | null;
  return { ok: true, profileId: row?.id ?? null };
}
