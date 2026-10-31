import type { Company } from "@/core/entities";
import type { StaffReadClient } from "./restClient";

/**
 * `tenants_and_companies` — the reads that turn a company id into the name a
 * person reads on screen.
 *
 * A company is the rail most of the console filters by, so three doors had to
 * answer the same question: does this id carry a company at all?
 */

/**
 * The name of the company carrying an id, or the reason it is not known.
 *
 * The distinction is the whole read. A caller that only wants a label can take
 * `null` and draw nothing; a caller that is about to publish an empty board or
 * an empty spreadsheet under that id has to be able to tell "this company has
 * nobody in it" from "no company carries that id" — an empty set of children
 * looks identical either way, so the id is named on its own before anything is
 * counted. A refused read is a third answer, and the doors give it three
 * different policies: the export refuses, the chat throws, the account menu
 * falls back to no label.
 */
export async function readCompanyNameById(
  restClient: StaffReadClient,
  companyId: string
): Promise<{ ok: true; name: string | null } | { ok: false; error: string }> {
  const { data, error } = await restClient
    .from("tenants_and_companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: `That company could not be read: ${error.message}` };
  }
  const row = data as Pick<Company, "name"> | null;
  return { ok: true, name: typeof row?.name === "string" && row.name !== "" ? row.name : null };
}
