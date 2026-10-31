import type { AssessmentTemplate } from "@/core/entities";
import type { StaffReadClient } from "./restClient";

/**
 * `assessment_templates` — the suite reads three doors ask before a question, an
 * assignment or a status change lands in one.
 *
 * The questions a suite holds are not part of these reads: the board counts
 * them through `assessment_questions`, which is a different table.
 */

/** The columns a door needs to say whether a suite exists, its name, and whether it is paused. */
export type SuiteState = Pick<AssessmentTemplate, "id" | "name" | "is_active">;

/**
 * One suite by id, or `null` when no row carries it.
 *
 * Three doors ask the same question — copy a question into a suite, pause or
 * resume a suite, issue a suite — and each refuses a missing row and a paused
 * row in its own words. This layer returns the row (or nothing) and the reason a
 * read failed; the policy stays with the door.
 */
export async function readSuiteById(
  restClient: StaffReadClient,
  templateId: string
): Promise<{ ok: true; suite: SuiteState | null } | { ok: false; error: string }> {
  const { data, error } = await restClient
    .from("assessment_templates")
    .select("id, name, is_active")
    .eq("id", templateId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: `That assessment suite could not be read: ${error.message}` };
  }
  return { ok: true, suite: (data as SuiteState | null) ?? null };
}

/**
 * Every suite in the order its name sorts — the destinations the question board
 * offers.
 *
 * A refused read comes back as a refusal rather than an empty list: an account
 * with no suites and a database that would not answer look identical in a
 * picker, and the caller decides which one it is showing.
 */
export async function listSuites(
  restClient: StaffReadClient
): Promise<{ ok: true; suites: SuiteState[] } | { ok: false; error: string }> {
  const { data, error } = await restClient
    .from("assessment_templates")
    .select("id, name, is_active")
    .order("name");

  if (error) {
    return { ok: false, error: `The assessment suites could not be read: ${error.message}` };
  }
  return { ok: true, suites: (data ?? []) as SuiteState[] };
}
