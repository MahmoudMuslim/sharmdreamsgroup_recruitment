// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  ToolArgumentError,
  convertProspect,
  importProspects,
  optionalStr,
  pasteProspectProfile,
  report,
  sendProspectOutreach,
  str,
  strArray,
} from "./shared";

/* Sourcing tools. */

export const sourcing: readonly AssistantTool[] = [
  {
    name: "convert_prospect",
    label: "Converting a prospect",
    description:
      "Turn a sourced prospect into an application against an opening, carrying their captured profile into the new record.",
    args: {
      id: "string — prospect id from list_prospects",
      job_id: "string — opening to apply them to",
    },
    run: async (args) => report(await convertProspect({ id: str(args, "id"), job_id: str(args, "job_id") })),
  },
  {
    name: "import_prospects",
    label: "Importing a prospect list",
    description:
      "Load a pasted list into the sourcing pool: one LinkedIn profile URL per line, or a CSV with a header row. The server re-parses the text and skips anyone already in the pool by profile URL or email, so pasting the same list twice adds nobody twice. It stores the list only — no profile is read and no message is sent.",
    args: {
      raw: "string — the list as pasted, one profile per line or a CSV with a header row",
      origin: "string — LINKEDIN or CSV, whichever the text is",
      job_id: "string — optional opening to attach the pool to",
    },
    run: async (args) => {
      const origin = str(args, "origin").toUpperCase();
      if (origin !== "LINKEDIN" && origin !== "CSV") {
        throw new ToolArgumentError('"origin" must be LINKEDIN or CSV.');
      }
      return report(
        await importProspects({
          raw: str(args, "raw"),
          origin,
          job_id: optionalStr(args, "job_id") ?? null,
        })
      );
    },
  },
  {
    name: "read_prospect_profile",
    label: "Structuring a pasted profile",
    description:
      "Structure the profile text a recruiter copied and store it on the prospect. This is the door that always works: a LinkedIn page is behind a login for any automated request, so nothing is fetched on the recruiter's behalf — only the text they pasted is sent to the model, and the stored profile names the model that structured it. Too little text to read a person out of is refused rather than guessed at.",
    args: {
      id: "string — prospect id from list_prospects",
      text: "string — the whole copied page, history and education included",
    },
    run: async (args) =>
      report(await pasteProspectProfile({ id: str(args, "id"), text: str(args, "text") })),
  },
  {
    name: "message_prospects",
    label: "Messaging prospects",
    description:
      "Send outreach copy to a set of prospects by email or WhatsApp and log each attempt on their record. At most 200 at a time. A non-empty `closed_roles` still means the send went through — quote those opening names and tell the recruiter to reopen the role, edit the copy or refile the prospects.",
    args: {
      ids: "string[] — prospect ids",
      channel: "string — EMAIL or WHATSAPP",
      body: "string — the message",
      subject: "string — optional, email only",
    },
    run: async (args) => {
      const channel = str(args, "channel").toUpperCase();
      if (channel !== "EMAIL" && channel !== "WHATSAPP") {
        throw new ToolArgumentError('"channel" must be EMAIL or WHATSAPP.');
      }
      return report(
        await sendProspectOutreach({
          ids: strArray(args, "ids"),
          channel: channel as "EMAIL" | "WHATSAPP",
          body: str(args, "body"),
          subject: optionalStr(args, "subject"),
        })
      );
    },
  },

];
