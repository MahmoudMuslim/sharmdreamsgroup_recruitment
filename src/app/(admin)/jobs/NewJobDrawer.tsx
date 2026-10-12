"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { createJobOpening } from "./job-actions";

export interface JobFormOptions {
  companies: { id: string; name: string; sector: string }[];
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  currencies: { id: string; code: string; symbol: string; label: string }[];
}

const EMPLOYMENT_TYPES = [
  { value: "FULL_TIME", label: "Full time" },
  { value: "PART_TIME", label: "Part time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERNSHIP", label: "Internship" },
];

const STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "PAUSED", label: "Paused" },
  { value: "CLOSED", label: "Closed" },
];

const EMPTY = {
  title: "",
  tenant_id: "",
  department: "",
  sector: "HOSPITALITY",
  location: "",
  employment_type: "FULL_TIME",
  description: "",
  requirements: "",
  min_salary_usd: "",
  max_salary_usd: "",
  salary_currency: "USD",
  status: "DRAFT",
};

/**
 * Create-job drawer.
 *
 * Department and location are not free text — they are seeded from the master
 * data the user maintains in Settings, so openings always use the controlled
 * vocabulary rather than drifting into "Finance" vs "finance" vs "Finance & FP&A".
 */
export function NewJobDrawer({ options }: { options: JobFormOptions }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    ...EMPTY,
    tenant_id: options.companies[0]?.id ?? "",
    // Default to the first configured currency so a newly added code is picked
    // up without touching the form.
    salary_currency:
      options.currencies.find((c) => c.code === "USD")?.code ??
      options.currencies[0]?.code ??
      "USD",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const set = (field: keyof typeof EMPTY) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (error) setError(null);
    if (saved) setSaved(false);
  };

  function close() {
    setOpen(false);
    setError(null);
    setSaved(false);
  }

  async function submit() {
    if (!draft.title.trim()) {
      setError("A job title is required.");
      return;
    }
    if (!draft.tenant_id) {
      setError("Choose the company this role belongs to.");
      return;
    }

    setPending(true);
    try {
      const result = await createJobOpening({
        ...draft,
        requirements: draft.requirements
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      if (result.ok) {
        setSaved(true);
        // The action already revalidated /jobs; refresh pulls the new row in.
        // Done here rather than via a callback prop, because this component is
        // rendered from a Server Component and functions cannot cross that
        // boundary.
        setTimeout(() => {
          close();
          router.refresh();
        }, 600);
      } else {
        setError(result.error ?? "Could not create the opening.");
      }
    } catch {
      setError("Something went wrong creating the opening.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
      >
        <Plus className="h-4 w-4" aria-hidden />
        New opening
      </button>

      <Drawer
        open={open}
        onClose={close}
        eyebrow="Requisitions"
        title="New job opening"
        subtitle="Published openings appear on the careers site immediately."
        onSubmit={submit}
        footer={
          <DrawerActions
            onCancel={close}
            submitLabel="Create opening"
            pending={pending}
            note="Leave blank to publish later."
          />
        }
      >
        <div className="space-y-4">
          <Field label="Job title" htmlFor="job-title" required>
            <TextInput
              id="job-title"
              value={draft.title}
              onChange={(e) => set("title")(e.target.value)}
              placeholder="Financial Planning & Analysis Manager"
            />
          </Field>

          <Field label="Company" htmlFor="job-company" required>
            <Select
              id="job-company"
              value={draft.tenant_id}
              onChange={(e) => {
                set("tenant_id")(e.target.value);
                const company = options.companies.find((c) => c.id === e.target.value);
                if (company) set("sector")(company.sector);
              }}
            >
              {options.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Department"
              htmlFor="job-department"
              required
              hint="From Settings → Organisation."
            >
              <Select
                id="job-department"
                value={draft.department}
                onChange={(e) => set("department")(e.target.value)}
              >
                <option value="">Select department…</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Location" htmlFor="job-location" required hint="From master data.">
              <Select
                id="job-location"
                value={draft.location}
                onChange={(e) => set("location")(e.target.value)}
              >
                <option value="">Select location…</option>
                {options.locations.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Employment type" htmlFor="job-employment">
              <Select
                id="job-employment"
                value={draft.employment_type}
                onChange={(e) => set("employment_type")(e.target.value)}
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Status" htmlFor="job-status">
              <Select id="job-status" value={draft.status} onChange={(e) => set("status")(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="job-description" required>
            <TextArea
              id="job-description"
              rows={4}
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="What the role owns, who it reports to, and what success looks like."
            />
          </Field>

          <Field
            label="Requirements"
            htmlFor="job-requirements"
            hint="One per line."
          >
            <TextArea
              id="job-requirements"
              rows={3}
              value={draft.requirements}
              onChange={(e) => set("requirements")(e.target.value)}
              placeholder={"5+ years FP&A experience\nIFRS reporting\nAdvanced Excel"}
            />
          </Field>

          {/* Salary is a three-part value: an amount pair plus the currency they
              are denominated in. Labelling the inputs with the selected code
              keeps the two in step as the recruiter switches currency. */}
          <div className="rounded-xl border border-brand-line bg-brand-cream p-4">
            <Field
              label="Salary currency"
              htmlFor="job-currency"
              hint="From Settings → Organisation → Currencies."
              className="mb-4"
            >
              <Select
                id="job-currency"
                value={draft.salary_currency}
                onChange={(e) => set("salary_currency")(e.target.value)}
              >
                {options.currencies.length === 0 && (
                  <option value="USD">USD — US Dollar</option>
                )}
                {options.currencies.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} — {c.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={`Salary from (${draft.salary_currency})`}
                htmlFor="job-salary-min"
              >
                <TextInput
                  id="job-salary-min"
                  type="number"
                  min={0}
                  value={draft.min_salary_usd}
                  onChange={(e) => set("min_salary_usd")(e.target.value)}
                  placeholder="1200"
                />
              </Field>
              <Field
                label={`Salary to (${draft.salary_currency})`}
                htmlFor="job-salary-max"
              >
                <TextInput
                  id="job-salary-max"
                  type="number"
                  min={0}
                  value={draft.max_salary_usd}
                  onChange={(e) => set("max_salary_usd")(e.target.value)}
                  placeholder="1800"
                />
              </Field>
            </div>
          </div>

          <FormMessage error={error} success={saved ? "Opening created." : null} />
        </div>
      </Drawer>
    </>
  );
}