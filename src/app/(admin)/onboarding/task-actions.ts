"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import {
  newTaskId,
  normaliseDraft,
  progressOf,
  tasksOf,
  type ChecklistTask,
  type TaskDraft,
} from "./checklist";

export interface ChecklistResult {
  ok: boolean;
  error?: string;
  /** Recalculated from the saved list, so the meter never disagrees with the ticks. */
  progress?: number;
  done?: number;
  total?: number;
}

interface OnboardingPlan {
  id: string;
  applicationId: string | null;
  /** The hire the checklist belongs to, so a trail row names a person. */
  candidate: string;
}

/**
 * What the trail should say about a save.
 *
 * Only the caller knows which button was pressed — a tick, an edit, a deletion
 * all write the same list back — so the description is handed down to `persist`
 * rather than guessed at from the saved rows.
 */
interface TaskChange {
  action: string;
  summary: string;
  detail?: Record<string, unknown>;
}

/**
 * Editing a checklist is writing a candidate's journey, so it follows the same
 * gate as the rest of the candidate workspace — `candidates.write`, which the
 * live matrix grants to Super Admin, Subsidiary HR Manager and Recruiter.
 * Hiring Manager is deliberately excluded: it only holds `candidates.read`.
 * Generating a whole plan stays behind platform permission.
 */
async function editableTasks(
  planId: string
): Promise<{ tasks: ChecklistTask[]; plan: OnboardingPlan } | { error: string }> {
  await requireStaff("/onboarding");
  if (!(await hasPermissionForUser("candidates.write"))) {
    return { error: "You need the Manage candidates permission to edit onboarding tasks." };
  }
  if (!planId) return { error: "Missing plan." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("onboarding_plans")
    .select("id, checklist, application_id, applications(full_name)")
    .eq("id", planId)
    .maybeSingle();

  if (error) return { error: `Could not read this plan: ${error.message}` };
  if (!data) return { error: "That onboarding plan no longer exists." };

  const row = data as unknown as {
    id: string;
    checklist: unknown;
    application_id?: string | null;
    applications?: { full_name?: string } | { full_name?: string }[] | null;
  };
  const embedded = row.applications;

  return {
    tasks: tasksOf(row.checklist),
    plan: {
      id: row.id,
      applicationId: row.application_id ?? null,
      candidate:
        (Array.isArray(embedded) ? embedded[0]?.full_name : embedded?.full_name) ?? "this hire",
    },
  };
}

function result(tasks: ChecklistTask[]): ChecklistResult {
  return {
    ok: true,
    progress: progressOf(tasks),
    done: tasks.filter((task) => task.completed).length,
    total: tasks.length,
  };
}

function tally(tasks: ChecklistTask[]): string {
  return `${tasks.filter((task) => task.completed).length} of ${tasks.length} done`;
}

/**
 * Saves the whole list back and recomputes `progress` in the same write.
 *
 * The zero-row guard matters: PostgREST reports success for an update that
 * matched nothing, so a plan deleted a moment ago would otherwise read as saved.
 * The trail row is written only once the save is known to have landed.
 */
async function persist(
  plan: OnboardingPlan,
  tasks: ChecklistTask[],
  change?: TaskChange
): Promise<ChecklistResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("onboarding_plans")
    .update({ checklist: tasks, progress: progressOf(tasks) })
    .eq("id", plan.id)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "That onboarding plan no longer exists." };

  if (change) {
    await recordActivity({
      area: "onboarding",
      action: change.action,
      entity: "onboarding plan",
      entityId: plan.id,
      summary: change.summary,
      detail: { candidate: plan.candidate, application_id: plan.applicationId, now: tally(tasks), ...change.detail },
    });
  }

  revalidatePath("/onboarding");
  return result(tasks);
}

/** Ticks a task off, or reopens it. */
export async function setTaskCompleted(
  planId: string,
  taskId: string,
  completed: boolean
): Promise<ChecklistResult> {
  const loaded = await editableTasks(planId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const index = loaded.tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return { ok: false, error: "That task is no longer in this plan." };

  const tasks = [...loaded.tasks];
  tasks[index] = { ...tasks[index], completed };

  return persist(loaded.plan, tasks, {
    action: completed ? "task_complete" : "task_reopen",
    summary: `${completed ? "Completed" : "Reopened"} “${tasks[index].title}” on ${loaded.plan.candidate}'s onboarding plan`,
    detail: { task_id: taskId, was_completed: loaded.tasks[index].completed },
  });
}

/** Adds a task when `taskId` is null, otherwise edits the one named. */
export async function saveTask(
  planId: string,
  taskId: string | null,
  draft: TaskDraft
): Promise<ChecklistResult> {
  const checked = normaliseDraft(draft);
  if ("error" in checked) return { ok: false, error: checked.error };

  const loaded = await editableTasks(planId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  if (taskId === null) {
    const tasks = [
      ...loaded.tasks,
      { id: newTaskId(), ...checked.value, completed: false },
    ];
    const added = tasks[tasks.length - 1];
    return persist(loaded.plan, tasks, {
      action: "task_add",
      summary: `Added “${added.title}” to ${loaded.plan.candidate}'s onboarding plan, due ${
        added.due_offset_days < 0
          ? `${Math.abs(added.due_offset_days)} days before`
          : `${added.due_offset_days} days after`
      } the start date`,
      detail: { task_id: added.id, due_offset_days: added.due_offset_days },
    });
  }

  const index = loaded.tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return { ok: false, error: "That task is no longer in this plan." };

  const before = loaded.tasks[index];
  const tasks = [...loaded.tasks];
  tasks[index] = { ...before, ...checked.value };

  const changed = Object.entries(checked.value).filter(
    ([key, value]) => before[key as keyof ChecklistTask] !== value
  );

  return persist(loaded.plan, tasks, {
    action: "task_edit",
    summary: `Edited “${tasks[index].title}” on ${loaded.plan.candidate}'s onboarding plan — ${
      changed.length > 0
        ? `changed ${changed.map(([key]) => key).join(", ")}`
        : "saved without changing a field"
    }`,
    detail: { task_id: taskId, ...Object.fromEntries(changed) },
  });
}

/**
 * Removes a task.
 *
 * Deleting the last one leaves a 0% plan rather than a divide-by-zero, and the
 * plan itself is untouched — removing a whole plan is not offered because the
 * hire's checklist history would be gone with it.
 */
export async function deleteTask(planId: string, taskId: string): Promise<ChecklistResult> {
  const loaded = await editableTasks(planId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const removed = loaded.tasks.find((task) => task.id === taskId);
  const tasks = loaded.tasks.filter((task) => task.id !== taskId);
  if (tasks.length === loaded.tasks.length) {
    return { ok: false, error: "That task is no longer in this plan." };
  }

  return persist(loaded.plan, tasks, {
    action: "task_delete",
    summary: `Removed “${removed?.title ?? "a task"}” from ${loaded.plan.candidate}'s onboarding plan`,
    detail: { task_id: taskId, was_completed: removed?.completed ?? null },
  });
}
