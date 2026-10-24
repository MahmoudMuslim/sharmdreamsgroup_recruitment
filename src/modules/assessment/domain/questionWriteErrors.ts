import { CODING, CODING_WRITE_REFUSAL } from "@/modules/assessment/domain/coding";
import { isMissingQuestionTypeError } from "@/modules/assessment/domain/situational";

/**
 * A question write failed. Say the useful thing.
 *
 * `saveQuestion` lives in a `"use server"` module, so it cannot be exercised by
 * the plain-Node proofs. The translation lives here instead: a type that this
 * database's enum does not have is a missing migration, not a broken request,
 * and the author is told which migration and that nothing was written.
 */
export function questionWriteError(
  questionType: string,
  error: { code?: string | null; message: string }
): string {
  if (questionType === CODING && isMissingQuestionTypeError(error)) return CODING_WRITE_REFUSAL;
  return error.message;
}
