// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import {
  BONUS_STATES,
  decideReferralBonus,
  fileReferral,
  getReferralBoard,
  reassignReferral,
} from "@/modules/assistant/application/sources";
import type { AssistantTool } from "./shared";
import { ToolArgumentError, optionalStr, report, str } from "./shared";

/* Referral book tools. */

export const referrals: readonly AssistantTool[] = [
  {
    name: "get_referral_board",
    label: "Reading the referral book",
    description:
      "The Referrals console (/referrals): every claim with the person referred, the role, who is credited, the application it became and the bonus decision, plus the staff a claim can be reassigned to, the openings a claim can be filed against, the caller's own referral code, and the note the reader wrote about that code. A refused read is a permission answer, not an empty book. The referral tables arrive with db/migrations/040_referrals.sql; on a database where that file has not been run, the board says so instead of reading as no claims.",
    args: {},
    run: async () => {
      const desk = await getReferralBoard();
      return {
        ok: true,
        board: desk.board,
        my_code: desk.myCode,
        code_note: desk.codeNote,
        jobs: desk.jobs,
        staff: desk.staff,
      };
    },
  },
  {
    name: "file_referral",
    label: "Filing a referral claim by hand",
    description:
      "Credit the signed-in staff member for somebody who applied another way or was referred before the link existed. The email is the key and is folded the way the claim's index folds it. First claim wins: a second live claim for the same address and opening is refused and names who already holds it — use reassign_referral if that credit belongs to someone else.",
    args: {
      email: "string — the referred person's address",
      full_name: "string — optional; used when the claim has no application to read the name from",
      job_id: "string — from get_referral_board jobs or list_jobs",
      note: "string — optional internal note",
    },
    run: async (args) =>
      report(
        await fileReferral({
          email: str(args, "email"),
          fullName: optionalStr(args, "full_name"),
          jobId: str(args, "job_id"),
          note: optionalStr(args, "note"),
        })
      ),
  },
  {
    name: "reassign_referral",
    label: "Moving a referral's credit",
    description:
      "Move a claim from one member of staff to another. The claim's email, role and application are untouched — only who is credited moves, and the trail keeps both names. Only a recruiter or the owner may reassign. Read the board first for the claim id and the staff ids.",
    args: {
      referral_id: "string — from get_referral_board",
      profile_id: "string — the staff member to credit, from get_referral_board staff or list_team",
    },
    run: async (args) =>
      report(
        await reassignReferral({
          referralId: str(args, "referral_id"),
          profileId: str(args, "profile_id"),
        })
      ),
  },
  {
    name: "decide_referral_bonus",
    label: "Recording a referral bonus decision",
    description:
      "Record what the referral programme decided a claim is worth. This stores the decision and its note; it pays nothing. Only a recruiter or the owner may decide. States are NONE (no decision), PENDING, PAID and DECLINED; a note is optional and is stored with the decision.",
    args: {
      referral_id: "string — from get_referral_board",
      state: `string — one of ${BONUS_STATES.join(", ")}`,
      note: "string — optional",
    },
    run: async (args) => {
      const state = str(args, "state").toUpperCase();
      if (!(BONUS_STATES as readonly string[]).includes(state)) {
        throw new ToolArgumentError(`"state" must be one of ${BONUS_STATES.join(", ")}.`);
      }
      return report(
        await decideReferralBonus({
          referralId: str(args, "referral_id"),
          state,
          note: optionalStr(args, "note"),
        })
      );
    },
  },
];
