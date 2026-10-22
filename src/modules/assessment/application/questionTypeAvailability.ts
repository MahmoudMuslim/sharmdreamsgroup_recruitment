import "server-only";

import type { RestClient } from "@/lib/rest/client";
import {
  SITUATIONAL_JUDGMENT,
  SITUATIONAL_SCHEMA_NOTE,
  isMissingQuestionTypeError,
} from "@/modules/assessment/domain/situational";

/** What the builder pages may offer, and the sentence that explains a closed door. */
export interface QuestionTypeAvailability {
  /** The database's `question_type` enum holds SITUATIONAL_JUDGMENT. */
  situational: boolean;
  /** Why it cannot be offered yet; null when it can. */
  note: string | null;
}

/**
 * Whether the database will accept a situational judgment question.
 *
 * The question type is added by `db/migrations/034_situational_judgment.sql`,
 * which is authored and not applied. A page cannot test an enum by inspecting
 * its rows, so it asks the enum directly: a filter on the label. While the
 * label is missing Postgres refuses the *filter* with 22P02, which is the same
 * refusal a write would get — one probe answers both "may I offer this?" and
 * "would a save fail?".
 *
 * The read is a head count: nothing is printed, so the count is only the
 * vehicle for the filter, and an empty table is as good an answer as a full one.
 */
export async function readQuestionTypeAvailability(
  restClient: RestClient
): Promise<QuestionTypeAvailability> {
  const { error } = await restClient
    .from("assessment_questions")
    .select("id", { count: "exact", head: true })
    .eq("question_type", SITUATIONAL_JUDGMENT);

  if (!error) return { situational: true, note: null };

  return {
    situational: false,
    note: isMissingQuestionTypeError(error)
      ? SITUATIONAL_SCHEMA_NOTE
      : `Situational judgment questions could not be checked on this database: ${error.message}.`,
  };
}
