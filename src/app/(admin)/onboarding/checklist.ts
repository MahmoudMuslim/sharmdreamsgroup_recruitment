/**
 * The onboarding checklist shape.
 *
 * Tasks are stored as a JSONB array on `onboarding_plans.checklist` rather than
 * in their own table, so editing one is a read-modify-write of the whole list.
 * Keeping that shape here means the reader, the writer and the UI agree on what
 * a task is without any of them importing a server action.
 */
export interface ChecklistTask {
  id: string;
  title: string;
  category: string;
  owner: string;
  /**
   * Days from the hire's start date, so a task can be due before day one
   * (contract, payroll, accounts) and the plan stays correct if the start date
   * moves. There is no start-date column, so the reference is `hired_at`.
   */
  due_offset_days: number;
  completed: boolean;
}

/** Fields the add/edit form can set; completion is a separate action. */
export interface TaskDraft {
  title: string;
  category: string;
  owner: string;
  due_offset_days: number;
}

/** The vocabularies the generator already uses, offered as suggestions. */
export const TASK_CATEGORIES = ["Admin", "IT", "Culture", "Role", "Compliance"] as const;

export const TASK_OWNERS = ["HR", "IT", "Manager", "Finance", "Chef"] as const;

export function isChecklistTask(value: unknown): value is ChecklistTask {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.completed === "boolean"
  );
}

/** Normalises the JSONB, which arrives untyped and may pre-date any field. */
export function tasksOf(checklist: unknown): ChecklistTask[] {
  if (!Array.isArray(checklist)) return [];
  return checklist.filter(isChecklistTask).map((item) => ({
    ...item,
    category: typeof item.category === "string" ? item.category : "Role",
    owner: typeof item.owner === "string" ? item.owner : "HR",
    due_offset_days: Number.isFinite(item.due_offset_days) ? item.due_offset_days : 0,
  }));
}

/**
 * The single definition of plan progress.
 *
 * `onboarding_plans.progress` is stored, not generated, so every write has to
 * recompute it from the list it just saved — otherwise the meter and the ticks
 * drift apart and a fully-checked plan still reads 0%.
 */
export function progressOf(tasks: ChecklistTask[]): number {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.completed).length / tasks.length) * 100);
}

export function newTaskId(): string {
  return `task-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * Turns a draft into stored fields, rejecting what the columns would accept but
 * the plan should not.
 */
export function normaliseDraft(draft: TaskDraft): { error: string } | { value: TaskDraft } {
  const title = draft.title.trim();
  if (title.length < 3) return { error: "Give the task a title of at least 3 characters." };
  if (title.length > 160) return { error: "Keep the task title under 160 characters." };

  const offset = Math.trunc(Number(draft.due_offset_days));
  if (!Number.isFinite(offset) || offset < -60 || offset > 365) {
    return { error: "Due offset must be between 60 days before and 365 days after the start." };
  }

  return {
    value: {
      title,
      category: draft.category.trim() || "Role",
      owner: draft.owner.trim() || "HR",
      due_offset_days: offset,
    },
  };
}
