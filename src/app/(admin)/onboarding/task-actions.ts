"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
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

/**
 * Editing a checklist is writing a candidate's journey, so it follows the same
 * gate as the rest of the candidate workspace — `candidates.write`, which the
 * live matrix grants to Super Admin, Subsidiary HR Manager and Recruiter.
 * Hiring Manager is deliberately excluded: it only holds `candidates.read`.
 * Generating a whole plan stays behind platform permission.
 */
async function editableTasks(
  planId: string
): Promise<{ tasks: ChecklistTask[] } | { error: string }> {
  await requireStaff("/onboarding");
  if (!(await hasPermissionForUser("candidates.write"))) {
    return { error: "You need the Manage candidates permission to edit onboarding tasks." };
  }
  if (!planId) return { error: "Missing plan." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("onboarding_plans")
    .select("id, checklist")
    .eq("id", planId)
    .maybeSingle();

  if (error) return { error: `Could not read this plan: ${error.message}` };
  if (!data) return { error: "That onboarding plan no longer exists." };

  return { tasks: tasksOf(data.checklist) };
}

function result(tasks: ChecklistTask[]): ChecklistResult {
  return {
    ok: true,
    progress: progressOf(tasks),
    done: tasks.filter((task) => task.completed).length,
    total: tasks.length,
  };
}

/**
 * Saves the whole list back and recomputes `progress` in the same write.
 *
 * The zero-row guard matters: PostgREST reports success for an update that
 * matched nothing, so a plan deleted a moment ago would otherwise read as saved.
 */
async function persist(planId: string, tasks: ChecklistTask[]): Promise<ChecklistResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("onboarding_plans")
    .update({ checklist: tasks, progress: progressOf(tasks) })
    .eq("id", planId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "That onboarding plan no longer exists." };

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
  return persist(planId, tasks);
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
    return persist(planId, [
      ...loaded.tasks,
      { id: newTaskId(), ...checked.value, completed: false },
    ]);
  }

  const index = loaded.tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return { ok: false, error: "That task is no longer in this plan." };

  const tasks = [...loaded.tasks];
  tasks[index] = { ...tasks[index], ...checked.value };
  return persist(planId, tasks);
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

  const tasks = loaded.tasks.filter((task) => task.id !== taskId);
  if (tasks.length === loaded.tasks.length) {
    return { ok: false, error: "That task is no longer in this plan." };
  }
  return persist(planId, tasks);
}
