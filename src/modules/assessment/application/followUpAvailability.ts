import "server-only";

import type { RestClient } from "@/lib/rest/client";
import {
  FOLLOW_UP_MIGRATION,
  FOLLOW_UP_SCHEMA_NOTE,
  isMissingFollowUpColumnError,
} from "@/modules/assessment/domain/followUp";

/** Which half of the follow-up schema this database has. */
export interface FollowUpAvailability {
  /** The three rule columns exist on `assessment_templates`. */
  rules: boolean;
  /** `candidate_attempts.follow_up_of_attempt_id` exists, so a route can be recorded. */
  routing: boolean;
  /** Why the rule cannot be offered yet; null when both halves are there. */
  note: string | null;
}

/**
 * Whether this database can store and act on a second-test rule.
 *
 * Two probes, not one, because a database can be halfway: the migration adds
 * template columns and an attempt column in one file, but a hand-run statement
 * or a failed apply can leave the editor able to save a rule the router cannot
 * record. A select that names a missing column is the question itself — there
 * is no way to ask Postgres about a column without naming it, and the refusal
 * is the answer. Empty tables answer as well as full ones: the select is the
 * vehicle for the column list.
 *
 * While 035 is unapplied the page simply hides the rule. Offering a field whose
 * save would fail turns a settings screen into a 42703 message about Postgres
 * internals, which is the thing the probe exists to prevent.
 */
export async function readFollowUpAvailability(
  restClient: RestClient
): Promise<FollowUpAvailability> {
  const [rulesRead, routingRead] = await Promise.all([
    restClient
      .from("assessment_templates")
      .select("id, follow_up_template_id, follow_up_min_percent, follow_up_max_percent")
      .limit(1),
    restClient
      .from("candidate_attempts")
      .select("id, follow_up_of_attempt_id")
      .limit(1),
  ]);

  const rules = !rulesRead.error;
  const routing = !routingRead.error;

  if (rules && routing) return { rules, routing, note: null };

  if (!rules) {
    return {
      rules,
      routing,
      note: isMissingFollowUpColumnError(rulesRead.error)
        ? FOLLOW_UP_SCHEMA_NOTE
        : `Second-test routing could not be checked on this database: ${rulesRead.error?.message ?? "the rule columns could not be read."}`,
    };
  }

  // The rule columns are there but the attempt link is not. Saying "not applied"
  // would be wrong — half of the file is applied — so name the exact column.
  return {
    rules,
    routing,
    note: isMissingFollowUpColumnError(routingRead.error)
      ? `Second-test rules can be saved, but routing cannot record where a link came from: candidate_attempts.follow_up_of_attempt_id is missing, so ${FOLLOW_UP_MIGRATION} was only partly applied.`
      : `Second-test routing could not be checked on this database: ${routingRead.error?.message ?? "the attempt link column could not be read."}`,
  };
}
