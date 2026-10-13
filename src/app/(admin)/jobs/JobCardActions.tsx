"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Trash2, XCircle } from "lucide-react";
import { JobFormDrawer, type JobForEdit, type JobFormOptions } from "./JobFormDrawer";
import { deleteJobOpening, setJobStatus } from "./job-actions";

/**
 * Per-card controls for a single opening: edit, move its status, delete.
 *
 * The status shortcuts exist because publishing is the action recruiters repeat
 * ten times a day, and making them re-type the whole form to flip one field is
 * how people start setting status by hand in the database.
 *
 * Delete is offered but the server action refuses it once applications are
 * attached — see `deleteJobOpening`.
 */
export function JobCardActions({
  job,
  options,
  applicants,
}: {
  job: JobForEdit;
  options: JobFormOptions;
  applicants: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(action);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) setError(result.error ?? `Could not ${action.toLowerCase()}.`);
      else router.refresh();
    } catch {
      setError(`Something went wrong while trying to ${action.toLowerCase()}.`);
    } finally {
      setPending(null);
    }
  }

  function confirmDelete() {
    if (
      !window.confirm(
        `Delete “${job.title}”?\n\nThis permanently removes the opening. Once candidates have applied, the delete is refused and the opening should be closed instead.`
      )
    )
      return;
    run("Delete opening", () => deleteJobOpening(job.id));
  }

  const button =
    "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </button>

        {job.status !== "PUBLISHED" && (
          <button
            type="button"
            className={button}
            disabled={pending !== null}
            onClick={() => run("Publish", () => setJobStatus(job.id, "PUBLISHED"))}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {pending === "Publish" ? "Publishing…" : "Publish"}
          </button>
        )}

        {job.status === "PUBLISHED" && (
          <button
            type="button"
            className={button}
            disabled={pending !== null}
            onClick={() => run("Pause", () => setJobStatus(job.id, "PAUSED"))}
          >
            <Pause className="h-3.5 w-3.5" aria-hidden />
            {pending === "Pause" ? "Pausing…" : "Pause"}
          </button>
        )}

        {job.status !== "CLOSED" && (
          <button
            type="button"
            className={button}
            disabled={pending !== null}
            onClick={() => run("Close", () => setJobStatus(job.id, "CLOSED"))}
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden />
            {pending === "Close" ? "Closing…" : "Close"}
          </button>
        )}

        <button
          type="button"
          className={`${button} ml-auto text-rose-700 hover:bg-rose-50`}
          disabled={pending !== null}
          onClick={confirmDelete}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Delete
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
      {!error && applicants > 0 && job.status !== "CLOSED" && (
        <p className="mt-2 text-[11px] text-brand-ink/45">
          Closing keeps the {applicants} applicant{applicants === 1 ? "" : "s"} and their records.
        </p>
      )}

      {editing && (
        <JobFormDrawer
          key={job.id}
          options={options}
          job={job}
          open
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
