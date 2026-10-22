// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  num,
  optionalStr,
  report,
  retryAttemptGrading,
  scoreAttemptResponse,
  str,
} from "./shared";

/* Grading tools. */

export const grading: readonly AssistantTool[] = [
  {
    name: "award_marks",
    label: "Awarding marks by hand",
    description:
      "Put a mark on one answer, exactly as the mark editor on the candidate's Integrity report does. For an answer the AI left unscored or parked for review, after reading it with get_attempt_grades: the number is whole points out of that answer's own max_score, never a percentage, and the note is saved as the reason a person decided. Refused when the recruiter's role has its marks withheld — that is the same rule that hides the editor on screen.",
    args: {
      response_id: "string — from get_attempt_grades",
      score: "number — whole points, from 0 up to that answer's max_score",
      note: "string — why, in the recruiter's words. Optional",
    },
    run: async (args) =>
      report(
        await scoreAttemptResponse({
          responseId: str(args, "response_id"),
          score: num(args, "score"),
          note: optionalStr(args, "note") ?? "",
        })
      ),
  },
  {
    name: "retry_grading",
    label: "Finishing or re-running grading",
    description:
      "One more pass by the grading engine over an attempt's unscored answers — or the final check that closes a paper whose answers all carry a mark but whose status is still SUBMITTED. The same run the report's button starts: it is the only way marks come back from the AI on an attempt that was already submitted, since nothing schedules the timed sweep, and the only door that closes a paper left behind when a finalize did not land. Marks it writes are the engine's own; the trail also records that this person asked. A pass over unscored answers is refused when AI grading is off or no provider is configured, which get_attempt_grades reports in advance — closing a fully marked paper needs neither.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => report(await retryAttemptGrading(str(args, "attempt_id"))),
  },

];
