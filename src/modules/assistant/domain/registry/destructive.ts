// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  MASTER_ENTITIES,
  cancelWhatsAppJob,
  deleteAttachment,
  deleteAttempt,
  deleteGateQuestion,
  deleteJobOpening,
  deleteMasterRecord,
  deleteNotificationTemplate,
  deleteProspect,
  deleteQuestion,
  deleteStaffAccount,
  deleteStoredFile,
  deleteTask,
  deleteTemplate,
  masterEntity,
  report,
  str,
} from "./shared";

/* Destructive tools. */

export const destructive: readonly AssistantTool[] = [
  {
    name: "delete_job",
    label: "Deleting a job opening",
    description:
      "Permanently delete a job opening. Refused once candidates have applied — close it instead.",
    args: { job_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteJobOpening(str(args, "job_id"))),
  },
  {
    name: "delete_prospect",
    label: "Deleting a prospect",
    description: "Permanently delete a sourced prospect and their outreach history link.",
    args: { id: "string — prospect id" },
    destructive: true,
    run: async (args) => report(await deleteProspect(str(args, "id"))),
  },
  {
    name: "cancel_outbox_message",
    label: "Cancelling a queued message",
    description: "Cancel a WhatsApp message that is still queued, so it is never sent.",
    args: { id: "string — outbox job id from list_outbox" },
    destructive: true,
    run: async (args) => report(await cancelWhatsAppJob(str(args, "id"))),
  },
  {
    name: "delete_assessment_suite",
    label: "Deleting an assessment suite",
    description:
      "Permanently delete a suite and its questions. Refused as soon as any candidate holds a link — pause it instead, because the attempt is the record of what that person was asked.",
    args: { suite_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteTemplate(str(args, "suite_id"))),
  },
  {
    name: "delete_question",
    label: "Deleting a question",
    description:
      "Remove a question from a suite. Refused once a candidate has answered it, since their graded work would disappear with the question.",
    args: {
      question_id: "string",
      template_id: "string — the suite it belongs to",
    },
    destructive: true,
    run: async (args) =>
      report(await deleteQuestion(str(args, "question_id"), str(args, "template_id"))),
  },
  {
    name: "delete_attempt",
    label: "Deleting an assessment attempt",
    description:
      "Remove an attempt that was never opened, and with it the link the candidate was sent. Anything with answers attached is refused.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    destructive: true,
    run: async (args) => report(await deleteAttempt(str(args, "attempt_id"))),
  },
  {
    name: "delete_onboarding_task",
    label: "Deleting an onboarding task",
    description:
      "Remove one task from a hire's checklist. The plan itself is never deleted — a hire's checklist history stays on the record.",
    args: { plan_id: "string", task_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteTask(str(args, "plan_id"), str(args, "task_id"))),
  },
  {
    name: "delete_attachment",
    label: "Removing an attached file",
    description:
      "Delete one file staff attached to a candidate record — the stored object and the row that names it, so no dead download is offered.",
    args: { attachment_id: "string — from get_candidate_dossier" },
    destructive: true,
    run: async (args) => report(await deleteAttachment(str(args, "attachment_id"))),
  },
  {
    name: "delete_stored_file",
    label: "Deleting a stored file",
    description:
      "Permanently remove one object from a storage bucket by its full path. Stricter than the file browser: a candidate's upload is evidence, so this needs platform settings permission, and some buckets refuse staff deletes.",
    args: {
      bucket: "string — bucket key from list_files",
      path: "string — full storage key, e.g. applications/<id>/<file>.pdf",
    },
    destructive: true,
    run: async (args) => report(await deleteStoredFile(str(args, "bucket"), str(args, "path"))),
  },
  {
    name: "delete_gate_question",
    label: "Deleting a gate question",
    description:
      "Remove a viability question. Applications already carry its answer as text, so past records keep what was asked.",
    args: { question_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteGateQuestion(str(args, "question_id"))),
  },
  {
    name: "delete_notification_template",
    label: "Deleting a message template",
    description:
      "Remove a template row. Prefer reset_notification_template: a deleted row is one nobody can look at again, and the copy only survives in the audit log.",
    args: { id: "string — template row id from get_settings" },
    destructive: true,
    run: async (args) => report(await deleteNotificationTemplate({ id: str(args, "id") })),
  },
  {
    name: "delete_master_record",
    label: "Retiring a master-data record",
    description:
      "Take one company, department, location, role family, position, skill or currency out of new selections. Nothing is deleted and nothing is refused: the row stays so the openings, candidates and reports already naming it keep resolving, and the settings console lists it with a Retired badge. A retired position leaves the openings that started from it and the copy they inherited untouched. Undo it with save_master_record (fields {\"is_active\": true}). The answer says how many hireable openings carry its name as written — a floor, because an opening that spells the name differently is not counted; a position is counted exactly by the openings linked to it.",
    args: {
      entity: `string — one of ${MASTER_ENTITIES.join(", ")}`,
      id: "string — record id",
    },
    destructive: true,
    run: async (args) => {
      const entity = masterEntity(str(args, "entity"));
      return report(await deleteMasterRecord(entity, str(args, "id")));
    },
  },
  {
    name: "delete_staff_account",
    label: "Deleting a staff account",
    description:
      "Permanently delete a team member's account and profile. Their interviews and audit rows survive with the name blanked; set_staff_active is the reversible answer and is what a recruiter usually means.",
    args: { profile_id: "string — from list_team" },
    destructive: true,
    run: async (args) => report(await deleteStaffAccount(str(args, "profile_id"))),
  },
];
