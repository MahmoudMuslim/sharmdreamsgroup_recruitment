"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { formatInZone } from "@/lib/timezone";
import {
  TASK_CATEGORIES,
  TASK_OWNERS,
  type ChecklistTask,
  type TaskDraft,
} from "../checklist";
import { deleteTask, saveTask, setTaskCompleted } from "../task-actions";
import type { OnboardingRow } from "../actions";

const ACTION =
  "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50";

const FIELD =
  "w-full rounded-lg border border-brand-line bg-brand-cream px-2.5 py-1.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none";

const EMPTY_DRAFT: TaskDraft = { title: "", category: "Role", owner: "HR", due_offset_days: 0 };

const DAY_MONTH_YEAR = { day: "2-digit", month: "short", year: "numeric" } as const;

const DAY_MS = 86_400_000;

/**
 * Tasks carry a day offset from the start date, not a stored date, so the due
 * day is derived here. Without `hired_at` there is no anchor to count from and
 * the row says so instead of inventing a date.
 */
function dueLabel(
  hiredAt: string | null,
  offset: number,
  timeZone: string
): { text: string; overdue: boolean } {
  if (!hiredAt) return { text: `start + ${offset}d`, overdue: false };
  const due = Date.parse(hiredAt) + offset * DAY_MS;
  if (Number.isNaN(due)) return { text: `start + ${offset}d`, overdue: false };

  const iso = new Date(due).toISOString();
  const daysLeft = Math.round((due - Date.now()) / DAY_MS);
  return {
    text: `${formatInZone(iso, timeZone, DAY_MONTH_YEAR)}${
      daysLeft < 0 ? ` · ${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? " · today" : ""
    }`,
    overdue: daysLeft < 0,
  };
}

export function PlanChecklist({
  plan,
  timeZone,
  canEdit,
}: {
  plan: OnboardingRow;
  timeZone: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run(
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<boolean> {
    setPending(label);
    setError(null);
    const result = await fn();
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? `Could not ${label.toLowerCase()}.`);
      return false;
    }
    router.refresh();
    return true;
  }

  const toggleLabel = `${plan.checklist_done}/${plan.checklist_total} tasks`;

  return (
    <div className="rounded-xl border border-brand-line bg-brand-cream/60">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-ink/60 transition hover:text-brand-ink"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          Checklist
          <span className="font-mono text-[11px] font-semibold normal-case tracking-normal text-brand-ink/45">
            {plan.checklist_total === 0 ? "no tasks yet" : toggleLabel}
          </span>
        </button>
        {plan.checklist_total > 0 && (
          <span className="text-[11px] text-brand-ink/45">
            {plan.checklist_total - plan.checklist_done} left
          </span>
        )}
      </div>

      {open && (
        <div className="border-t border-brand-line px-3.5 py-3">
          {plan.tasks.length === 0 && (
            <p className="text-xs text-brand-ink/55">
              This plan has no tasks. Add the first one and the progress meter starts counting.
            </p>
          )}

          {plan.tasks.length > 0 && (
            <ul className="space-y-1.5">
              {plan.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  hiredAt={plan.hired_at}
                  timeZone={timeZone}
                  canEdit={canEdit}
                  busy={pending !== null}
                  pending={pending}
                  onToggle={(completed) =>
                    run(`Mark ${task.title.slice(0, 24)}`, () =>
                      setTaskCompleted(plan.id, task.id, completed)
                    )
                  }
                  onSave={(draft) => run("Save task", () => saveTask(plan.id, task.id, draft))}
                  onDelete={() => run("Delete task", () => deleteTask(plan.id, task.id))}
                />
              ))}
            </ul>
          )}

          {canEdit && <AddTask onAdd={(draft) => run("Add task", () => saveTask(plan.id, null, draft))} busy={pending !== null} />}

          {!canEdit && plan.tasks.length > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/45">
              Read-only — ticking, editing and removing tasks needs the Manage candidates permission.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="border-t border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

function TaskRow({
  task,
  hiredAt,
  timeZone,
  canEdit,
  busy,
  pending,
  onToggle,
  onSave,
  onDelete,
}: {
  task: ChecklistTask;
  hiredAt: string | null;
  timeZone: string;
  canEdit: boolean;
  busy: boolean;
  pending: string | null;
  onToggle: (completed: boolean) => Promise<boolean>;
  onSave: (draft: TaskDraft) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const due = dueLabel(hiredAt, task.due_offset_days, timeZone);

  if (editing) {
    return (
      <li className="rounded-lg border border-brand-line bg-white p-2.5">
        <TaskFields
          initial={task}
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            if (await onSave(draft)) setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start gap-2.5 rounded-lg border border-brand-line bg-white px-2.5 py-2">
      <input
        type="checkbox"
        checked={task.completed}
        disabled={!canEdit || busy}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`${task.completed ? "Reopen" : "Complete"}: ${task.title}`}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-gold disabled:cursor-not-allowed"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${task.completed ? "text-brand-ink/45 line-through" : ""}`}>
          {task.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-brand-ink/45">
          <span>{task.category}</span>
          <span aria-hidden>·</span>
          <span>{task.owner}</span>
          <span aria-hidden>·</span>
          <span className={due.overdue && !task.completed ? "font-semibold text-rose-600" : ""}>
            {task.completed ? "done" : `due ${due.text}`}
          </span>
        </p>
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            className={ACTION}
            aria-label={`Edit ${task.title}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Remove "${task.title}" from this plan?`)) return;
              onDelete();
            }}
            disabled={busy}
            className={ACTION}
            aria-label={`Delete ${task.title}`}
          >
            {pending === "Delete task" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            )}
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function TaskFields({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: Partial<TaskDraft> & { completed?: boolean };
  onCancel: () => void;
  onSubmit: (draft: TaskDraft) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>({
    title: initial.title ?? "",
    category: initial.category ?? "Role",
    owner: initial.owner ?? "HR",
    due_offset_days: initial.due_offset_days ?? 0,
  });
  const uid = useId();

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <datalist id={`${uid}-categories`}>
        {TASK_CATEGORIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id={`${uid}-owners`}>
        {TASK_OWNERS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <input
        className={FIELD}
        placeholder="Task"
        aria-label="Task title"
        required
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <input
          className={`${FIELD} min-w-0 flex-1`}
          list={`${uid}-categories`}
          placeholder="Category"
          aria-label="Category"
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
        />
        <input
          className={`${FIELD} min-w-0 flex-1`}
          list={`${uid}-owners`}
          placeholder="Owner"
          aria-label="Owner"
          value={draft.owner}
          onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-brand-ink/55">
          Due
          <input
            type="number"
            className={`${FIELD} w-20`}
            aria-label="Days from start date"
            min={-60}
            max={365}
            value={draft.due_offset_days}
            onChange={(e) =>
              setDraft({ ...draft, due_offset_days: Number(e.target.value) })
            }
          />
          d
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={ACTION}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          Save
        </button>
        <button type="button" onClick={onCancel} className={ACTION}>
          <X className="h-3.5 w-3.5" aria-hidden />
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddTask({
  onAdd,
  busy,
}: {
  onAdd: (draft: TaskDraft) => Promise<boolean>;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        disabled={busy}
        className={`${ACTION} mt-3`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add task
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-brand-line bg-white p-2.5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
        New task
      </p>
      <TaskFields
        initial={EMPTY_DRAFT}
        onCancel={() => setAdding(false)}
        onSubmit={async (draft) => {
          if (await onAdd(draft)) setAdding(false);
        }}
      />
    </div>
  );
}
