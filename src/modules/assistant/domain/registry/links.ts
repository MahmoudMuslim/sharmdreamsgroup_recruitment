// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  extendAttemptLink,
  num,
  reissueAttemptLink,
  report,
  revokeAttempt,
  str,
} from "./shared";

/* Assessment link control tools. */

export const links: readonly AssistantTool[] = [
  {
    name: "revoke_attempt",
    label: "Revoking an assessment link",
    description:
      "Stop an open assessment link: the candidate can no longer start or continue it. Answers already given stay on the record, which is why a submitted attempt cannot be revoked.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => report(await revokeAttempt(str(args, "attempt_id"))),
  },
  {
    name: "extend_attempt",
    label: "Extending an assessment deadline",
    description:
      "Buy more time on an open link, added to whatever deadline is already in force. Works on an invitation not yet opened and on a test already in progress.",
    args: {
      attempt_id: "string — from get_candidate_dossier",
      hours: "number — 1 to 336",
    },
    run: async (args) =>
      report(await extendAttemptLink(str(args, "attempt_id"), num(args, "hours"))),
  },
  {
    name: "reissue_attempt",
    label: "Re-issuing an assessment link",
    description:
      "Replace a link the candidate never opened with a fresh one and send the invitation again — for the invite that bounced, expired or was lost. The old address stops resolving the moment this runs. A test that was already opened is refused, because a second link would hand a second sitting of the same paper.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => report(await reissueAttemptLink(str(args, "attempt_id"))),
  },
];
