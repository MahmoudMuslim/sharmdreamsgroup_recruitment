// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import {
  confirmOfferHire,
  issueOffer,
  readOfferPanel,
  withdrawOffer,
} from "@/modules/assistant/application/sources";
import type { AssistantTool, ToolArgs } from "./shared";
import { num, report, str } from "./shared";

/* Offer tools. */

function optionalNum(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  return num(args, key);
}

export const offers: readonly AssistantTool[] = [
  {
    name: "read_offer",
    label: "Reading an application's offer",
    description:
      "The newest offer on one application and where it stands: its state, the deadline and whether that deadline has passed, the default number of days a new offer gets, and — when the table exists — the offer itself. A read that fails on a database where db/migrations/042_offers.sql has never run says so; that is not the same answer as “no offer”, and only the first one means the offer desk is unavailable. The application id comes from list_candidates or get_job_applicants.",
    args: { application_id: "string — from list_candidates" },
    run: async (args) => report(await readOfferPanel(str(args, "application_id"))),
  },
  {
    name: "issue_offer",
    label: "Issuing an offer",
    description:
      "Mail an offer letter with its answer link, then record the offer with a deadline. The letter goes out before the row is written, so a refused send leaves nothing behind; a second open offer, an expired one or one already accepted is refused before anything is mailed. This messages the candidate — issue it only when the recruiter has asked for that. The letter's copy comes from the offer template; `days` defaults to the desk's own default, which read_offer reports.",
    args: {
      application_id: "string — from list_candidates, at the offer stage",
      days: "number — optional, days the candidate has to answer; omit for the desk default",
    },
    run: async (args) =>
      report(
        await issueOffer({
          applicationId: str(args, "application_id"),
          days: optionalNum(args, "days"),
        })
      ),
  },
  {
    name: "withdraw_offer",
    label: "Withdrawing an offer",
    description:
      "Close an unanswered offer, including one whose deadline has passed. An offer the candidate has already accepted or declined is a recorded answer and is not withdrawn here. Read the offer first with read_offer to get its id; the standing alone does not tell you whether an answer arrived.",
    args: {
      application_id: "string — the application the offer belongs to",
      offer_id: "string — the offer's id, as read_offer reports it",
    },
    run: async (args) =>
      report(
        await withdrawOffer({
          applicationId: str(args, "application_id"),
          offerId: str(args, "offer_id"),
        })
      ),
  },
  {
    name: "confirm_offer_hire",
    label: "Confirming an accepted offer as a hire",
    description:
      "Turn an ACCEPTED offer into a hire. Acceptance is the candidate's answer; the hire is the company's decision, which is why this is a separate press. Only an offer already recorded as ACCEPTED is confirmed — a declined or unanswered offer is refused. The move goes through the application stage writer, so the stage change, its trail row and the hired letter happen exactly as they do from the candidate desk. Read the offer first with read_offer.",
    args: { application_id: "string — an application whose offer was accepted" },
    run: async (args) =>
      report(await confirmOfferHire({ applicationId: str(args, "application_id") })),
  },
];
