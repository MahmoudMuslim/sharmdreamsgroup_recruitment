// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  ToolArgumentError,
  bool,
  gateOptions,
  moveGateQuestion,
  num,
  optionalStr,
  report,
  resetNotificationTemplate,
  saveGateQuestion,
  saveNotificationTemplate,
  setGateQuestionActive,
  str,
} from "./shared";

/* Gate and templates tools. */

export const gateTemplates: readonly AssistantTool[] = [
  {
    name: "save_gate_question",
    label: "Saving a viability gate question",
    description:
      "Create or edit a question the public apply form asks. Options marked as not passing make the application politely declined. Applies to one role, or to every published role when job_id is left out.",
    args: {
      id: "string — optional, the question being edited",
      job_id: "string — optional opening id, omit to ask on every role",
      question: "string",
      help_text: "string — optional",
      options: "object[] — [{\"label\":\"answer\",\"passes\":true}, …]",
      is_active: "boolean — optional, defaults to true",
      position: "number — optional, order on the form",
    },
    run: async (args) =>
      report(
        await saveGateQuestion({
          id: optionalStr(args, "id") ?? null,
          job_id: optionalStr(args, "job_id") ?? null,
          question: str(args, "question"),
          help_text: optionalStr(args, "help_text") ?? "",
          options: gateOptions(args),
          is_active: bool(args, "is_active", true),
          position: args.position === undefined ? 0 : num(args, "position"),
        })
      ),
  },
  {
    name: "set_gate_question_active",
    label: "Switching a gate question on or off",
    description: "Hide a viability question from applicants, or put it back, without deleting it.",
    args: {
      question_id: "string",
      active: "boolean — optional, defaults to true",
    },
    run: async (args) =>
      report(await setGateQuestionActive(str(args, "question_id"), bool(args, "active", true))),
  },
  {
    name: "move_gate_question",
    label: "Reordering a gate question",
    description: "Move one viability question one slot up or down on the apply form.",
    args: {
      question_id: "string",
      direction: "string — up or down",
    },
    run: async (args) => {
      const direction = str(args, "direction").toLowerCase();
      if (direction !== "up" && direction !== "down") {
        throw new ToolArgumentError('"direction" must be "up" or "down".');
      }
      return report(await moveGateQuestion(str(args, "question_id"), direction));
    },
  },
  {
    name: "save_notification_template",
    label: "Editing a notification template",
    description:
      "Rewrite one message template. The dispatch paths send this copy verbatim, so the next stage alert a candidate receives is whatever is written here.",
    args: {
      id: "string — template row id from get_settings",
      subject: "string — optional, email subject",
      body: "string — under 4000 characters",
      is_active: "boolean — optional, defaults to true",
    },
    run: async (args) =>
      report(
        await saveNotificationTemplate({
          id: str(args, "id"),
          subject: optionalStr(args, "subject") ?? null,
          body: str(args, "body"),
          is_active: bool(args, "is_active", true),
        })
      ),
  },
  {
    name: "reset_notification_template",
    label: "Resetting a template to shipped copy",
    description:
      "Put one template back to the wording the portal ships with and switch it on. The row survives; only its text and switch are rewritten.",
    args: { id: "string — template row id from get_settings" },
    run: async (args) => report(await resetNotificationTemplate({ id: str(args, "id") })),
  },

];
