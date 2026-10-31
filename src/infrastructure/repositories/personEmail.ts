import type { PersonEmail } from "@/core/entities";
import { isMissingSchemaError } from "./missingSchema";
import type { StaffReadClient } from "./restClient";

/**
 * `person_emails` — the address-to-person lookup three doors kept writing.
 *
 * The address is normalised by the caller (`personKey`) because the rule that
 * spells an identity belongs to the person domain, not to the wire. What this
 * answers is only what the table says: one person, no person, or a read that
 * failed — and for the last, whether the failure was a database without 043 or
 * something this request did. The doors give those three different sentences,
 * so none of them is written here.
 */

/** The one column the lookup asks for. */
export type PersonEmailOwner = Pick<PersonEmail, "person_id">;

export async function readPersonIdByEmail(
  restClient: StaffReadClient,
  email: string
): Promise<
  | { ok: true; personId: string | null }
  | { ok: false; missingSchema: boolean; error: string }
> {
  const { data, error } = await restClient
    .from("person_emails")
    .select("person_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, missingSchema: isMissingSchemaError(error), error: error.message };
  }
  return { ok: true, personId: (data as PersonEmailOwner | null)?.person_id ?? null };
}
