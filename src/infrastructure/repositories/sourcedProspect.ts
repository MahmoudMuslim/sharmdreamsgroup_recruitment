import type { SourcedProspect } from "@/core/entities";
import type { StaffReadClient } from "./restClient";

/**
 * `sourced_prospects` — reads the sourcing pool answers with.
 *
 * A projection, not an ORM: it names the columns a door actually asks for, in
 * the words the row type says exist, and returns the refusal a caller would
 * otherwise have to write again. Tenant scoping stays in the RLS policies this
 * client is issued under — nothing here adds a `tenant_id` filter the database
 * is already enforcing, because a second fence that disagrees with the first is
 * a bug waiting for the day the two drift.
 */

/**
 * The fields the profile doors read: what the last capture stored, plus the
 * words on the card the capture is compared against.
 *
 * `profile` is the jsonb as the row holds it — `normalizeProspectProfile` drops
 * an entry it cannot place rather than rendering half a structure. The source
 * is widened to `string | null` on purpose: the column is `text` with a CHECK,
 * so a row can hold a word the vocabulary has never heard, and the door has to
 * classify it instead of trusting the cast.
 */
export type ProspectCaptureFields = Pick<
  SourcedProspect,
  | "profile"
  | "profile_url"
  | "profile_captured_at"
  | "profile_error"
  | "full_name"
  | "headline"
  | "company"
  | "linkedin_url"
> & { profile_source: string | null };

const CAPTURE_COLUMNS =
  "profile, profile_url, profile_source, profile_captured_at, profile_error, full_name, headline, company, linkedin_url";

/**
 * One prospect's captured profile, by id — or the reason it could not be read.
 *
 * The pool drawer, the URL door, the paste door and the upload door all ask for
 * this same projection before they ask anything of a model, so the column list
 * is written down here once rather than four times.
 */
export async function readProspectCaptureFields(
  restClient: StaffReadClient,
  prospectId: string
): Promise<
  { ok: true; row: ProspectCaptureFields } | { ok: false; reason: "gone" | "read_failed"; error: string }
> {
  const { data, error } = await restClient
    .from("sourced_prospects")
    .select(CAPTURE_COLUMNS)
    .eq("id", prospectId)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "read_failed", error: `That prospect could not be read: ${error.message}` };
  }
  if (!data) {
    return { ok: false, reason: "gone", error: "That prospect is no longer in the pool." };
  }
  return { ok: true, row: data as unknown as ProspectCaptureFields };
}
