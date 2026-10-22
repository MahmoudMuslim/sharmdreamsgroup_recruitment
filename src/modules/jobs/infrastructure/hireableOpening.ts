import type { createServerRestClient } from "@/lib/data-api/server";
import { closedOpeningRefusal, isHireable } from "@/modules/jobs/domain/hireable";

type StaffClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * The opening a write is about to file someone under — or the sentence that
 * refuses it.
 *
 * Every door that puts a person on a role asks before it writes, because a
 * dropdown is a convenience rather than a guarantee: the role can close between
 * the page loading and the click, and the assistant passes an id with no
 * dropdown behind it at all. The read goes through the staff RLS scope, so an
 * opening the caller cannot see is refused here rather than failing on a foreign
 * key inside the insert.
 */
export async function requireHireableOpening(
  restClient: StaffClient,
  jobId: string
): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const { data, error } = await restClient
    .from("job_openings")
    .select("title, status")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "That opening is not one your scope reaches — choose a role from the list." };
  }
  if (!isHireable(String(data.status))) {
    return { ok: false, error: closedOpeningRefusal(String(data.title)) };
  }
  return { ok: true, title: String(data.title) };
}
