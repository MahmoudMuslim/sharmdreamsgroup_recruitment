import "server-only";
import type { RestClient } from "@/lib/rest/client";
import { CODING, CODING_SCHEMA_NOTE } from "@/modules/assessment/domain/coding";
import {
  SITUATIONAL_JUDGMENT,
  SITUATIONAL_SCHEMA_NOTE,
  isMissingQuestionTypeError,
} from "@/modules/assessment/domain/situational";

export interface QuestionTypeAvailability {
  situational: boolean;
  coding: boolean;
  note: string | null;
  codingNote: string | null;
}

/**
 * Which of the newer question types this database's enum actually has.
 *
 * Both labels are newer than the deployed schema, so both are checked the same
 * way: a one-row read that fails with 22P02 until its migration runs. The
 * two probes are issued together, and each absence is reported separately — a
 * missing 039 must not hide an available 034.
 */
export async function readQuestionTypeAvailability(
  restClient: RestClient
): Promise<QuestionTypeAvailability> {
  const [situationalError, codingError] = await Promise.all([
    probe(restClient, SITUATIONAL_JUDGMENT),
    probe(restClient, CODING),
  ]);

  return {
    situational: situationalError === null,
    coding: codingError === null,
    note:
      situationalError === null
        ? null
        : isMissingQuestionTypeError(situationalError)
          ? SITUATIONAL_SCHEMA_NOTE
          : `Situational judgment questions could not be checked on this database: ${situationalError.message}.`,
    codingNote:
      codingError === null
        ? null
        : isMissingQuestionTypeError(codingError)
          ? CODING_SCHEMA_NOTE
          : `Coding questions could not be checked on this database: ${codingError.message}.`,
  };
}

async function probe(
  restClient: RestClient,
  questionType: string
): Promise<{ code?: string | null; message: string } | null> {
  /* Not a head count. A HEAD error response arrives with an empty body — on
   * this stack PostgREST answers the missing enum label 400 with the 22P02
   * document, and `fetch` discards it — so the transport can only report
   * "Bad Request", `isMissingQuestionTypeError` says no, and the author reads
   * "could not be checked" where the door means to name the migration file.
   * The one-row GET carries the same verdict with the body intact. */
  const { error } = await restClient
    .from("assessment_questions")
    .select("id", { count: "exact" })
    .eq("question_type", questionType)
    .limit(1);
  return error ?? null;
}
