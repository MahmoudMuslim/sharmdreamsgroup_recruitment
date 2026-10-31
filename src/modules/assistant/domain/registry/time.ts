// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import {
  TIME_CATEGORIES,
  addTime,
  deleteTime,
  discardTime,
  editTime,
  startTime,
  stopTime,
} from "@/modules/assistant/application/sources";
import type { AssistantTool, ToolArgs } from "./shared";
import { ToolArgumentError, optionalStr, report, str } from "./shared";

/* Time Tracker tools. */

/**
 * The field half of a ledger form, shared by the three tools that send one.
 *
 * Times are the console's own `datetime-local` values — `YYYY-MM-DDTHH:mm` in
 * the organisation timezone, not an ISO instant with an offset. The action
 * converts them with the same zone the screen uses, so a chat entry and a typed
 * one land at the same clock time.
 */
function category(args: ToolArgs): string {
  const value = str(args, "category").toUpperCase();
  if (!(TIME_CATEGORIES as readonly string[]).includes(value)) {
    throw new ToolArgumentError(`"category" must be one of ${TIME_CATEGORIES.join(", ")}.`);
  }
  return value;
}

function entryFields(args: ToolArgs) {
  return {
    task: str(args, "task"),
    category: category(args),
    note: optionalStr(args, "note") ?? "",
    jobId: optionalStr(args, "job_id") ?? null,
    applicationId: optionalStr(args, "application_id") ?? null,
  };
}

const ENTRY_ARGS = {
  task: "string — what was worked on",
  category: `string — one of ${TIME_CATEGORIES.join(", ")}`,
  note: "string — optional",
  job_id: "string — optional opening id the work belongs to",
  application_id: "string — optional candidate record the work belongs to",
};

export const time: readonly AssistantTool[] = [
  {
    name: "start_time",
    label: "Starting a timer",
    description:
      "Start a timer for the signed-in staff member. The start is stamped by the database clock, not by the browser, so a running figure is a measurement rather than a difference between two machines' ideas of now. The ledger holds at most one running timer per person — stop or discard the current one first if it is still running.",
    args: ENTRY_ARGS,
    run: async (args) =>
      report(
        await startTime({
          ...entryFields(args),
          startValue: "",
          endValue: null,
        })
      ),
  },
  {
    name: "stop_time",
    label: "Stopping a timer",
    description:
      "Stop the named running timer and record how long it actually ran. Only the person who logged the span can stop it. The entry id comes from get_time_ledger; a timer already stopped is refused.",
    args: { entry_id: "string — from get_time_ledger" },
    run: async (args) => report(await stopTime(str(args, "entry_id"))),
  },
  {
    name: "add_time",
    label: "Logging a span that already happened",
    description:
      "Record work that happened earlier, which a timer cannot. Both ends are required: a back-dated row with no end would become a second running timer. Times are `YYYY-MM-DDTHH:mm` in the organisation timezone, the same values the Time Tracker's own fields take.",
    args: {
      ...ENTRY_ARGS,
      started_at: "string — when the span began, `YYYY-MM-DDTHH:mm`",
      ended_at: "string — when the span ended, `YYYY-MM-DDTHH:mm`",
    },
    run: async (args) =>
      report(
        await addTime({
          ...entryFields(args),
          startValue: str(args, "started_at"),
          endValue: str(args, "ended_at"),
        })
      ),
  },
  {
    name: "edit_time",
    label: "Correcting a logged span",
    description:
      "Rewrite the task, category, note, candidate, opening or times of one entry the signed-in staff member logged. Read the entry first with get_time_ledger and send the full record: the action compares what it stores against the stored row, and the trail describes that diff. A running row keeps running — its end is only written by stop_time — so leaving `ended_at` out of an edit to a finished row keeps its stored end.",
    args: {
      entry_id: "string — from get_time_ledger",
      ...ENTRY_ARGS,
      started_at: "string — the span's start, `YYYY-MM-DDTHH:mm`",
      ended_at: "string — optional, `YYYY-MM-DDTHH:mm`; omit to keep a finished row's stored end",
    },
    run: async (args) => {
      const entryId = str(args, "entry_id");
      const id = entryFields(args);
      // Read after the argument checks so a malformed category is refused before
      // the action reads a row it will not touch.
      return report(
        await editTime(entryId, {
          task: id.task,
          category: id.category,
          note: id.note,
          jobId: id.jobId,
          applicationId: id.applicationId,
          startValue: str(args, "started_at"),
          endValue: optionalStr(args, "ended_at") ?? null,
        })
      );
    },
  },
  {
    name: "discard_time",
    label: "Discarding a timer started by mistake",
    description:
      "Throw away a running timer without logging the time. Separate from stop_time on purpose: stopping records the minutes, discarding records nothing and leaves a trail row saying the start was withdrawn. A timer already stopped is refused — delete it instead if the logged hours were wrong.",
    args: { entry_id: "string — from get_time_ledger" },
    run: async (args) => report(await discardTime(str(args, "entry_id"))),
  },
  {
    name: "delete_time",
    label: "Removing a logged entry",
    description:
      "Remove one entry from the ledger. Hours are one of the few records the portal really erases, so the trail row is the only surviving account of what went — the delete is not undoable. Only the person who logged the span can delete it; read the entry first with get_time_ledger.",
    args: { entry_id: "string — from get_time_ledger" },
    run: async (args) => report(await deleteTime(str(args, "entry_id"))),
  },
];
