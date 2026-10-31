// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  TASK_CATEGORIES,
  TASK_OWNERS,
  bool,
  generateOnboardingPlan,
  num,
  optionalStr,
  report,
  saveTask,
  setTaskCompleted,
  str,
} from "./shared";

/* Onboarding tools. */

export const onboarding: readonly AssistantTool[] = [
  {
    name: "generate_onboarding_plan",
    label: "Generating an onboarding plan",
    description:
      "Build a hire's checklist from their role, assessment and screening. Refuses when the application already has a plan.",
    args: {
      application_id: "string — a HIRED application",
      job_title: "string — optional override for the role text",
    },
    run: async (args) =>
      report(
        await generateOnboardingPlan(
          str(args, "application_id"),
          optionalStr(args, "job_title") ?? null
        )
      ),
  },
  {
    name: "save_onboarding_task",
    label: "Saving an onboarding task",
    description:
      "Add a task to a hire's checklist, or edit the named one. Completion is a separate call so the trail records a tick as a tick.",
    args: {
      plan_id: "string — from list_onboarding_plans",
      task_id: "string — optional, the task being edited",
      title: "string",
      category: `string — one of ${TASK_CATEGORIES.join(", ")} or your own`,
      owner: `string — one of ${TASK_OWNERS.join(", ")} or your own`,
      due_offset_days: "number — days from the hire's start date, negative is before day one",
    },
    run: async (args) =>
      report(
        await saveTask(str(args, "plan_id"), optionalStr(args, "task_id") ?? null, {
          title: str(args, "title"),
          category: str(args, "category"),
          owner: str(args, "owner"),
          due_offset_days: num(args, "due_offset_days"),
        })
      ),
  },
  {
    name: "complete_onboarding_task",
    label: "Ticking an onboarding task",
    description: "Mark a checklist task done, or reopen it. Progress is recalculated from the list.",
    args: {
      plan_id: "string",
      task_id: "string",
      completed: "boolean",
    },
    run: async (args) =>
      report(
        await setTaskCompleted(str(args, "plan_id"), str(args, "task_id"), bool(args, "completed", true))
      ),
  },

];
