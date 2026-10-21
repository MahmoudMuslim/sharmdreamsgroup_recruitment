// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  APPLICATION_SOURCES,
  ToolArgumentError,
  bool,
  createCandidate,
  optionalStr,
  readAttachmentAsCv,
  readRecordCv,
  report,
  sendBulkEmail,
  sendBulkWhatsApp,
  setCandidateArchive,
  str,
  strArray,
  updateCandidateContact,
} from "./shared";

/* Candidate records tools. */

export const candidates: readonly AssistantTool[] = [
  {
    name: "record_candidate",
    label: "Recording a candidate by hand",
    description:
      "File an applicant who never came through the careers site — a mailed CV, a name from a phone screen, a row from an old spreadsheet. Starts them at New with a tracking code. Nothing is messaged: they didn't apply, so a confirmation would be wrong. A second live record for the same address in the same opening is refused.",
    args: {
      job_id: "string — from list_jobs",
      full_name: "string — at least two characters",
      email: "string — stored lowercase",
      phone: "string — optional; needed for WhatsApp notices",
      source: `string — one of ${APPLICATION_SOURCES.join(", ")}`,
    },
    run: async (args) =>
      report(
        await createCandidate({
          jobId: str(args, "job_id"),
          fullName: str(args, "full_name"),
          email: str(args, "email"),
          phone: optionalStr(args, "phone"),
          source: str(args, "source"),
        })
      ),
  },
  {
    name: "edit_candidate_contact",
    label: "Correcting candidate details",
    description:
      "Fix the name, email or phone a candidate arrived with. Every notice, bulk message and portal sign-in reads these columns, so this changes where future messages go.",
    args: {
      application_id: "string",
      full_name: "string",
      email: "string",
      phone: "string — optional; blank clears the stored number",
    },
    run: async (args) =>
      report(
        await updateCandidateContact({
          applicationId: str(args, "application_id"),
          fullName: str(args, "full_name"),
          email: str(args, "email"),
          phone: optionalStr(args, "phone"),
        })
      ),
  },
  {
    name: "set_candidate_archive",
    label: "Filing a candidate in or out",
    description:
      "File a candidate out of the pipeline, or bring them back. This is not a delete — answers, scores and notices all stay on the record. An open assessment link or a live interview is refused first.",
    args: {
      application_id: "string",
      archived: "boolean — true to file away, false to restore",
    },
    run: async (args) =>
      report(await setCandidateArchive({ applicationId: str(args, "application_id"), archived: bool(args, "archived", true) })),
  },
  {
    name: "read_candidate_cv",
    label: "Reading a CV into the record",
    description:
      "Parse a CV file already held for a candidate and store its text on the row, which is what AI screening and the profile read. Give an attachment_id for a file staff attached, or leave it out to read the CV the applicant submitted with their application. Refuses when the record already holds CV text — that replacement is a decision for the recruiter on their own screen, so tell them to use Read as CV there.",
    args: {
      application_id: "string",
      attachment_id: "string — optional, from list_files or the candidate dossier; omit for the CV on the record",
    },
    run: async (args) => {
      const applicationId = str(args, "application_id");
      const attachmentId = optionalStr(args, "attachment_id");
      return report(
        attachmentId
          ? await readAttachmentAsCv({ applicationId, attachmentId })
          : await readRecordCv({ applicationId })
      );
    },
  },
  {
    name: "message_candidates",
    label: "Sending a bulk campaign",
    description:
      "Send one written message to a set of candidates by email or WhatsApp. Placeholders in double braces are filled per recipient. Everyone named on the list receives it — send only what the recruiter has actually written.",
    args: {
      channel: "string — EMAIL or WHATSAPP",
      application_ids: "string[] — from list_candidates or get_job_applicants",
      subject: "string — email only",
      message: "string — the body",
      template_key: "string — optional, the WhatsApp template key to send under",
    },
    run: async (args) => {
      const channel = str(args, "channel").toUpperCase();
      const ids = strArray(args, "application_ids");
      const message = str(args, "message");

      if (channel === "EMAIL") {
        return report(await sendBulkEmail({ applicationIds: ids, subject: str(args, "subject"), message }));
      }
      if (channel === "WHATSAPP") {
        return report(
          await sendBulkWhatsApp({
            applicationIds: ids,
            templateKey: optionalStr(args, "template_key") ?? "generic",
            message,
          })
        );
      }
      throw new ToolArgumentError('"channel" must be EMAIL or WHATSAPP.');
    },
  },

];
