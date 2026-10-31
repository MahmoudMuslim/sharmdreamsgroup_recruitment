"use client";

import { useEffect, useState, useTransition } from "react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput
} from "@/modules/analytics/presentation/Form";
import { openingOptionLabel, pickerWindowNote } from "@/modules/jobs/domain/hireable";
import {
  saveProspect,
  type JobOption,
  type ProspectRow
} from "./actions";
import { type ContactField } from "./SourcingBits";

/* -------------------------------------------------------------------------- */

export function ProspectFormDrawer({
  prospect,
  focus,
  jobs,
  jobsTotal,
  onClose,
  onSaved,
}: {
  prospect: ProspectRow | null;
  /** Set when a reach door sent the recruiter here for one missing address. */
  focus?: ContactField | null;
  jobs: JobOption[];
  jobsTotal: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: prospect?.full_name ?? "",
    headline: prospect?.headline ?? "",
    company: prospect?.company ?? "",
    location: prospect?.location ?? "",
    email: prospect?.email ?? "",
    phone: prospect?.phone ?? "",
    linkedin_url: prospect?.linkedin_url ?? "",
    notes: prospect?.notes ?? "",
    job_id: prospect?.job_id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A reach door that found no address lands the recruiter on the field that
  // fixes it. Focus and scrolling are DOM concerns, so they stay in the effect.
  useEffect(() => {
    if (!focus) return;
    const input = document.getElementById(`field-${focus}`);
    input?.scrollIntoView({ block: "center" });
    input?.focus();
  }, [focus]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  // The picker lists only openings the group still hires for, so a record filed
  // under a role that has since closed holds a link nothing on the list matches.
  // Keeping it visible is what stops a save from unlinking the prospect while the
  // recruiter was only here to add a phone number.
  const staleLink =
    prospect?.job_id && !jobs.some((job) => job.id === prospect.job_id)
      ? { id: prospect.job_id, label: `${prospect.job_title ?? "The linked opening"} — no longer hiring` }
      : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveProspect({
        id: prospect?.id,
        // Whatever the record was actually sourced by survives the save — including
        // CHATBOT, which the public assistant wrote and no control here offers.
        origin:
          prospect?.origin === "LINKEDIN" ||
          prospect?.origin === "CSV" ||
          prospect?.origin === "CHATBOT"
            ? prospect.origin
            : "MANUAL",
        full_name: form.full_name,
        headline: form.headline || null,
        company: form.company || null,
        location: form.location || null,
        email: form.email || null,
        phone: form.phone || null,
        linkedin_url: form.linkedin_url || null,
        notes: form.notes || null,
        job_id: form.job_id || null,
      });
      if (!result.ok) {
        setError(result.error ?? "That could not be saved.");
        return;
      }
      onSaved();
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={prospect ? "Edit record" : "Add by hand"}
      title={prospect ? prospect.full_name : "New prospect"}
      subtitle="Only the name is required — but without an email, phone or profile link there is no way to reach them."
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={pending ? "Saving…" : prospect ? "Save changes" : "Add to pool"}
          pending={pending}
        />
      }
      onSubmit={submit}
    >
      <div className="space-y-4">
        <Field label="Full name" htmlFor="field-name" required>
          <TextInput id="field-name" value={form.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Headline" htmlFor="field-headline" hint="Their own words, straight off the profile.">
          <TextInput id="field-headline" value={form.headline} onChange={set("headline")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" htmlFor="field-company">
            <TextInput id="field-company" value={form.company} onChange={set("company")} />
          </Field>
          <Field label="Location" htmlFor="field-location">
            <TextInput id="field-location" value={form.location} onChange={set("location")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" htmlFor="field-email">
            <TextInput id="field-email" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Phone" htmlFor="field-phone" hint="Include the country code for WhatsApp.">
            <TextInput id="field-phone" value={form.phone} onChange={set("phone")} />
          </Field>
        </div>
        <Field label="LinkedIn profile" htmlFor="field-linkedin">
          <TextInput
            id="field-linkedin"
            value={form.linkedin_url}
            onChange={set("linkedin_url")}
            placeholder="linkedin.com/in/…"
          />
        </Field>
        <Field
          label="Linked opening"
          htmlFor="field-job"
          hint={pickerWindowNote(jobsTotal, jobs.length) ?? undefined}
        >
          <Select id="field-job" value={form.job_id} onChange={set("job_id")}>
            <option value="">None</option>
            {staleLink && <option value={staleLink.id}>{staleLink.label}</option>}
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {openingOptionLabel(job.title, job.status)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="field-notes">
          <TextArea id="field-notes" rows={4} value={form.notes} onChange={set("notes")} />
        </Field>
      </div>

      <FormMessage error={error} />
    </Drawer>
  );
}
