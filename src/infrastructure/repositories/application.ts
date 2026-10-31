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

/**
 * The applicant a staff door is about to act on.
 *
 * The booking desk refuses a rejected candidate, the offer desk refuses a stage
 * an offer cannot be issued from, and both start from the same three columns:
 * who this is, which stage they sit at, and whether the row is still there. The
 * stage rule itself stays in each door's own module — this only says which
 * columns come back, so a caller never has to cast the row through
 * `Record<string, unknown>` to read it.
 *
 * The answer carries a reason, not a sentence. The two doors word the same
 * absence differently, and only one of them used to say anything at all when the
 * database refused: a refused read was reported as a vanished candidate, which
 * is a different fact and the more damaging one to act on. So the failure comes
 * back with the database's own message and each door decides what to tell the
 * person who pressed the button.
 */
export type ApplicationStageDoorFields = Pick<Application, "id" | "stage" | "full_name">;

export type ApplicationStageDoorRead =
  | { ok: true; application: ApplicationStageDoorFields }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "read_failed"; error: string };

export async function readApplicationForStageDoor(
  restClient: StaffReadClient,
  applicationId: string
): Promise<ApplicationStageDoorRead> {
  const { data, error } = await restClient
    .from("applications")
    .select("id, stage, full_name")
    .eq("id", applicationId)
    .maybeSingle();

  if (error) return { ok: false, reason: "read_failed", error: error.message };
  if (!data) return { ok: false, reason: "gone" };
  return { ok: true, application: data as unknown as ApplicationStageDoorFields };
}
