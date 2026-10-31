// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import {
  actOnPrivacyRequest,
  getRetentionDesk,
} from "@/modules/assistant/application/sources";
import type { AssistantTool } from "./shared";
import { ToolArgumentError, report, str } from "./shared";

/* Privacy desk tools. */

const PRIVACY_ACTIONS = ["verify", "approve", "decline", "execute"] as const;

export const privacy: readonly AssistantTool[] = [
  {
    name: "get_retention_desk",
    label: "Reading the privacy desk",
    description:
      "The Retention console (/retention): the access and erasure requests waiting on somebody, each request's state, email and kind; the records the retention review has flagged, with its own note when the read was capped; and the counts of what is due, approaching and held. Permission-gated to the same roles the console admits. A desk that has not been created yet (db/migrations/041_privacy.sql unapplied) says so instead of reading as an empty queue.",
    args: {},
    run: async () => {
      const page = await getRetentionDesk();
      if (page.denied) {
        return {
          ok: false,
          error: "Only a recruiter or the owner can read the privacy desk.",
        };
      }
      return { ok: true, desk: page.desk };
    },
  },
  {
    name: "act_on_privacy_request",
    label: "Moving a privacy request one step",
    description:
      "Move one access or erasure request to its next state. Only the next step the desk allows is accepted: verify before approve or decline, approve before execute, and nothing after execute or decline. `verify` is a recruiter's or owner's press; `approve`, `decline` and `execute` are the owner's. Executing an erasure is destructive and cannot be undone — the person's record and stored files are erased and the action is recorded in the trail. Read the desk first and use the request id it reports.",
    args: {
      request_id: "string — from get_retention_desk",
      action: `string — one of ${PRIVACY_ACTIONS.join(", ")}`,
    },
    run: async (args) => {
      const action = str(args, "action").toLowerCase();
      if (!(PRIVACY_ACTIONS as readonly string[]).includes(action)) {
        throw new ToolArgumentError(
          `"action" must be one of ${PRIVACY_ACTIONS.join(", ")}.`
        );
      }
      return report(
        await actOnPrivacyRequest({
          requestId: str(args, "request_id"),
          action,
        })
      );
    },
  },
];
