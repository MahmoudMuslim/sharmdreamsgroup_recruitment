// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  QUESTION_TYPES,
  ToolArgumentError,
  bool,
  moveQuestion,
  num,
  optionalStr,
  questionDraftFrom,
  report,
  saveQuestion,
  saveTemplate,
  setTemplateActive,
  str,
} from "./shared";

/* Authoring tests tools. */

export const authoring: readonly AssistantTool[] = [
  {
    name: "save_assessment_suite",
    label: "Saving an assessment suite",
    description:
      "Create an assessment suite, or rewrite one when suite_id is given. A suite is only useful once it has questions — add them with save_question, then assign the suite with assign_assessment.",
    args: {
      suite_id: "string — optional, the suite being edited",
      tenant_id: "string — company id from get_master_data (entity companies), required when creating",
      name: "string",
      description: "string — optional",
      role_family: "string — role family label from get_master_data (entity role_families)",
      time_limit_minutes: "number — for the whole suite",
      randomize_questions: "boolean — optional, defaults to false",
      randomize_options: "boolean — optional, defaults to false",
      block_copy_paste: "boolean — optional, defaults to true",
    },
    run: async (args) =>
      report(
        await saveTemplate({
          id: optionalStr(args, "suite_id") ?? null,
          tenant_id: str(args, "tenant_id"),
          name: str(args, "name"),
          description: optionalStr(args, "description") ?? "",
          role_family: str(args, "role_family"),
          time_limit_minutes: num(args, "time_limit_minutes"),
          randomize_questions: bool(args, "randomize_questions", false),
          randomize_options: bool(args, "randomize_options", false),
          block_copy_paste: bool(args, "block_copy_paste", true),
        })
      ),
  },
  {
    name: "set_assessment_suite_active",
    label: "Pausing or resuming a suite",
    description:
      "Publish or pause a suite. Pausing closes the assign door; a link already in a candidate's inbox keeps working, which is why this is the way to retire a suite that has been sat.",
    args: {
      suite_id: "string — suite id from list_assessment_suites",
      active: "boolean — true to publish, false to pause",
    },
    run: async (args) =>
      report(await setTemplateActive(str(args, "suite_id"), bool(args, "active", true))),
  },
  {
    name: "save_question",
    label: "Saving a question",
    description:
      "Add a question to a suite, or rewrite one when id is given. Read the suite with get_assessment_suite first: a save writes the whole question, and an EXCEL_MODEL question must come back with its config in preserve_config or the spreadsheet definition is lost.",
    args: {
      id: "string — optional, the question being edited",
      template_id: "string — suite id",
      question_type: `string — one of ${QUESTION_TYPES.join(", ")}`,
      title: "string",
      prompt: "string — what the candidate is asked",
      instructions: "string — optional",
      points: "number",
      position: "number — optional, order in the suite",
      time_limit_minutes: "number — optional, per question",
      shuffle_options: "boolean — optional",
      options:
        "object[] — for MULTIPLE_CHOICE: [{\"text\":\"answer\",\"is_correct\":true}, …], at least two",
      context: "string — optional, the case study brief",
      min_words: "number — optional, case study minimum",
      min_duration_seconds: "number — optional, video pitch minimum",
      max_duration_seconds: "number — optional, video pitch maximum",
      preserve_config: "object — optional, the config object exactly as read back",
    },
    run: async (args) => report(await saveQuestion(questionDraftFrom(args))),
  },
  {
    name: "move_question",
    label: "Reordering a question",
    description: "Move one question one slot up or down; the suite is renumbered after it.",
    args: {
      question_id: "string",
      template_id: "string — the suite it belongs to",
      direction: "string — up or down",
    },
    run: async (args) => {
      const direction = str(args, "direction").toLowerCase();
      if (direction !== "up" && direction !== "down") {
        throw new ToolArgumentError('"direction" must be "up" or "down".');
      }
      return report(await moveQuestion(str(args, "question_id"), str(args, "template_id"), direction));
    },
  },

];
