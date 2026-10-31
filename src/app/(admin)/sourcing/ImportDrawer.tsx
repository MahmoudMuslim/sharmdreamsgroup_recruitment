"use client";

import { useMemo, useState, useTransition } from "react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea
} from "@/modules/analytics/presentation/Form";
import { openingOptionLabel, pickerWindowNote } from "@/modules/jobs/domain/hireable";
import { parseProspectImport } from "@/modules/sourcing/domain/prospect-import";
import {
  DEDUPE_WINDOW
} from "./pool-model";
import {
  importProspects,
  type JobOption
} from "./actions";

/* -------------------------------------------------------------------------- */

export function ImportDrawer({
  open,
  jobs,
  jobsTotal,
  onClose,
  onDone,
}: {
  open: boolean;
  jobs: JobOption[];
  jobsTotal: number;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [origin, setOrigin] = useState<"LINKEDIN" | "CSV">("LINKEDIN");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Parsed live in the browser with the same pure function the server uses, so
  // the count shown before importing is the count that will be written.
  const preview = useMemo(() => (raw.trim() ? parseProspectImport(raw) : null), [raw]);

  // The picker is a window into the hireable openings, so when the window ran
  // out of room the field says which roles it left off rather than looking whole.
  const shortBy = pickerWindowNote(jobsTotal, jobs.length);
  const jobHint = `Optional. Names the role in the outreach copy instead of “one of our roles”.${
    shortBy ? ` ${shortBy}` : ""
  }`;

  function submit() {
    if (!raw.trim()) {
      setError("Paste at least one profile link or one CSV row.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await importProspects({
        raw,
        origin,
        job_id: jobId || null,
      });
      if (!result.ok) {
        setError(result.error ?? "The import failed.");
        return;
      }
      const skipped = result.existing ?? 0;
      const unusable = result.problems?.length ?? 0;
      const summary = `${result.imported ?? 0} loaded into the pool${
        skipped ? `, ${skipped} already there by profile link or email` : ""
      }${unusable ? `, ${unusable} line${unusable > 1 ? "s" : ""} unreadable` : ""}.`;
      setRaw("");
      onDone(summary);
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Load a list"
      title="Import prospects"
      subtitle="One LinkedIn profile URL per line, or a CSV/TSV export with a header row."
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={pending ? "Importing…" : "Import"}
          pending={pending}
          note={`A profile link already in the pool is refused by the database. An email match is skipped when it sits among the newest ${DEDUPE_WINDOW.toLocaleString()} records.`}
        />
      }
      onSubmit={submit}
    >
      <Field label="Where the list came from" htmlFor="prospect-origin">
        <Select
          id="prospect-origin"
          value={origin}
          onChange={(event) => setOrigin(event.target.value as "LINKEDIN" | "CSV")}
        >
          <option value="LINKEDIN">LinkedIn profile links I collected</option>
          <option value="CSV">A CSV / TSV export</option>
        </Select>
      </Field>

      <Field
        label="Link to an opening"
        htmlFor="prospect-job"
        hint={jobHint}
        className="mt-4"
      >
        <Select id="prospect-job" value={jobId} onChange={(event) => setJobId(event.target.value)}>
          <option value="">No opening yet</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {openingOptionLabel(job.title, job.status)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Paste the list"
        htmlFor="prospect-raw"
        hint="A row with only a profile link is enough — the name is read from the link."
        className="mt-4"
      >
        <TextArea
          id="prospect-raw"
          rows={9}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder={"https://www.linkedin.com/in/ahmed-fouad-9a2b3c\nFull Name,Headline,Email,LinkedIn"}
        />
      </Field>

      {preview && (
        <div className="mt-4 rounded-xl border border-brand-line bg-brand-cream/60 p-3.5 text-xs">
          <p className="font-semibold">
            {preview.drafts.length} ready to import
            {preview.duplicates > 0 && ` · ${preview.duplicates} repeated line${preview.duplicates > 1 ? "s" : ""} in this paste`}
          </p>
          {preview.problems.length > 0 && (
            <ul className="mt-2 space-y-1 text-brand-ink/60">
              {preview.problems.slice(0, 6).map((problem) => (
                <li key={problem.line}>
                  Line {problem.line}: {problem.reason}
                </li>
              ))}
              {preview.problems.length > 6 && <li>…and {preview.problems.length - 6} more.</li>}
            </ul>
          )}
        </div>
      )}

      <FormMessage error={error} />
    </Drawer>
  );
}
