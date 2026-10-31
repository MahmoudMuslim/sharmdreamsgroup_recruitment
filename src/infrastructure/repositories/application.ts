import type { Application } from "@/core/entities";
import { isMissingSchemaError } from "./missingSchema";
import type { StaffReadClient } from "./restClient";

/**
 * `applications` — the reads the pipeline screens are answered with.
 */

/**
 * The person an application belongs to — which is not the same as the row.
 *
 * `person_id` arrived with the profile spine, and a database that predates it
 * answers "column does not exist" rather than returning nothing. That answer is
 * a different fact from "this candidate record is no longer here", so the read
 * re-checks existence without the column instead of letting the first refusal
 * stand in for the second. The client's own person id is never trusted, so this
 * always goes to the server.
 */
export type ApplicationPersonRead =
  | { status: "found"; spinePresent: true; personId: string | null }
  | { status: "found"; spinePresent: false; personId: null }
  | { status: "gone" }
  | { status: "error"; error: string };

export async function readApplicationPerson(
  restClient: StaffReadClient,
  applicationId: string
): Promise<ApplicationPersonRead> {
  const { data, error } = await restClient
    .from("applications")
    .select("person_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (isMissingSchemaError(error)) {
    const again = await restClient
      .from("applications")
      .select("id")
      .eq("id", applicationId)
      .maybeSingle();
    if (again.error) return { status: "error", error: again.error.message };
    if (!again.data) return { status: "gone" };
    return { status: "found", spinePresent: false, personId: null };
  }
  if (error) return { status: "error", error: error.message };
  if (!data) return { status: "gone" };

  const row = data as Pick<Application, "person_id">;
  return { status: "found", spinePresent: true, personId: row.person_id ?? null };
}
