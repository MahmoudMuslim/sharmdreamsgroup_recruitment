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
import { createJobOpening, updateJobOpening, type JobDraft } from "./job-actions";
import { saveOpeningSkills } from "./opening-skills-actions";
import { JobSkillsField } from "./JobSkillsField";
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  OPENING_TERMS_MIGRATION,
} from "@/modules/jobs/domain/openingTerms";
import {
  sameRequiredSkills,
  type CatalogueSkill,
  type RequiredSkill,
} from "@/modules/jobs/domain/openingSkills";
import {
  filingGhostLabel,
  type FilingVocabularies,
} from "@/modules/settings/domain/masterDataFiling";
import type { PositionChoice } from "@/modules/settings/domain/types";

export interface JobFormOptions {
  companies: { id: string; name: string; sector: string }[];
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  currencies: { id: string; code: string; symbol: string; label: string }[];
  /** The same four lists with their retired rows, for labelling a legacy value. */
  filing: FilingVocabularies;
  /** The posts a new opening may start from. Empty while 026 is unapplied. */
  positions: PositionChoice[];
  /** False when `positions` could not be read at all — the table does not exist yet. */
  positionsAvailable: boolean;
  /**
   * False where 033 has never run: `experience_level` is not a column and the
   * employment check still holds four values. The form then offers the four it
   * can store and no level at all, rather than a picker whose choice the
   * database would refuse.
   */
  termsAvailable: boolean;
  /**
   * The skills a requisition may be pointed at — the live catalogue rows, in the
   * master-data console's own order. Empty when the catalogue could not be read.
   */
  skills: CatalogueSkill[];
  /** The same list with its retired rows, so a skill required before it was struck off is still named. */
  skillLabels: CatalogueSkill[];
  /** Non-null when `job_opening_skills` is not on this database: the picker is replaced by this sentence. */
  skillsNote: string | null;
}

/** The stored row an edit starts from — only the fields this form can write. */
export interface JobForEdit {
  id: string;
  title: string;
  tenant_id: string;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  /** Null on a database without the column, and for an opening nobody gave a level. */
  experience_level: string | null;
  description: string;
  requirements: string[] | null;
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string;
  status: string;
  /**
   * The rows `job_opening_skills` already holds for this opening, read by the page
   * beside the row. Empty when the list is empty *and* when 037 is unapplied — the
   * picker's `note` is what tells the two apart, so an unapplied migration never
   * reads as a recruiter who chose nothing.
   */
  required_skills: RequiredSkill[];
}

const STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "PAUSED", label: "Paused" },
  { value: "CLOSED", label: "Closed" },
];

/** Every field is a string because the salary pair and requirements are edited as text. */
interface JobFormState {
  /**
   * The position a create starts from. Never prefilled on edit: the column may not
   * exist yet, and an edit does not move an opening's position link.
   */
  position_id: string;
  title: string;
  tenant_id: string;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  /** Blank means "not recorded", which is what the column stores as null. */
  experience_level: string;
  description: string;
  requirements: string;
  min_salary_usd: string;
  max_salary_usd: string;
  salary_currency: string;
  status: string;
}

const EMPTY: JobFormState = {
  position_id: "",
  title: "",
  tenant_id: "",
  department: "",
  sector: "HOSPITALITY",
  location: "",
  employment_type: "FULL_TIME",
  experience_level: "",
  description: "",
  requirements: "",
  min_salary_usd: "",
  max_salary_usd: "",
  salary_currency: "USD",
  status: "DRAFT",
};

function createDraft(options: JobFormOptions): JobFormState {
  return {
    ...EMPTY,
    tenant_id: options.companies[0]?.id ?? "",
    // Default to the first configured currency so a newly added code is picked
    // up without touching the form.
    salary_currency:
      options.currencies.find((c) => c.code === "USD")?.code ??
      options.currencies[0]?.code ??
      "USD",
  };
}

function editDraft(job: JobForEdit): JobFormState {
  return {
    // An edit keeps the link the opening already has; nothing here reads or moves it.
    position_id: "",
    title: job.title,
    tenant_id: job.tenant_id,
    department: job.department,
    sector: job.sector,
    location: job.location,
    employment_type: job.employment_type,
    experience_level: job.experience_level ?? "",
    description: job.description,
    requirements: (job.requirements ?? []).join("\n"),
    min_salary_usd: job.min_salary_usd === null ? "" : String(job.min_salary_usd),
    max_salary_usd: job.max_salary_usd === null ? "" : String(job.max_salary_usd),
    salary_currency: job.salary_currency || "USD",
    status: job.status,
  };
}

/**
 * The job-opening form, for both create and edit.
 *
 * One component because the two must never disagree about what a valid opening
 * is — a rule checked on save but not on edit is how a bad row gets written.
 *
 * Department and location are not free text — they are seeded from the master
 * data the user maintains in Settings, and `jobColumnsFrom` refuses a value the
 * list does not hold, so openings cannot drift into "Finance" vs "finance" vs
 * "Finance & FP&A". A value an older opening already carries is the exception: it
 * stays editable, and the ghost option below is what makes the screen admit it.
 */
export function JobFormDrawer({
  options,
  job,
  open,
  onClose,
}: {
  options: JobFormOptions;
  /** null when creating. */
  job: JobForEdit | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<JobFormState>(() =>
    job ? editDraft(job) : createDraft(options)
  );
  /**
   * The skill list, held apart from `draft`.
   *
   * It is not a column of `job_openings` and cannot join the payload that writes
   * one; it goes to its own action, against the id that payload returned. Keeping
   * it out of `draft` is also what lets the save ask the honest question "did this
   * list move?" instead of comparing a serialised form state.
   */
  const [skills, setSkills] = useState<RequiredSkill[]>(() => job?.required_skills ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const set = (field: keyof JobFormState) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (error) setError(null);
    if (saved) setSaved(false);
  };

  function close() {
    onClose();
    setError(null);
    setSaved(false);
  }

  // A `<select>` with no option for its own value shows the "Select …" placeholder
  // while still holding the old text, so an opening seeded before the master tables
  // were filled reads as if the field had been cleared. Each of these gives that
  // value an option that says where it came from.
  const ghosts = {
    tenant_id: filingGhostLabel({
      entity: "companies",
      by: "id",
      rows: options.filing.companies,
      value: draft.tenant_id,
    }),
    department: filingGhostLabel({
      entity: "departments",
      rows: options.filing.departments,
      value: draft.department,
    }),
    location: filingGhostLabel({
      entity: "locations",
      rows: options.filing.locations,
      value: draft.location,
    }),
    salary_currency: filingGhostLabel({
      entity: "currencies",
      by: "code",
      rows: options.filing.currencies,
      value: draft.salary_currency,
    }),
  };

  /**
   * Fills the draft from a position.
   *
   * Every inheritable field is replaced — this is the "start from" action, and a
   * second pick has to replace the first one's copy or the drawer would hold a mix
   * of two positions. After that the fields are ordinary editable text, and the
   * server keeps whatever the recruiter leaves in them.
   */
  function pickPosition(id: string) {
    const position = options.positions.find((p) => p.id === id);
    if (!position) {
      setDraft((d) => ({ ...d, position_id: "" }));
      return;
    }
    const company = options.companies.find((c) => c.id === position.tenant_id);
    setDraft((d) => ({
      ...d,
      position_id: position.id,
      title: position.title,
      tenant_id: position.tenant_id ?? d.tenant_id,
      department: position.department,
      description: position.responsibilities ?? "",
      requirements: (position.requirements ?? []).join("\n"),
      min_salary_usd: position.min_salary_usd === null ? "" : String(position.min_salary_usd),
      max_salary_usd: position.max_salary_usd === null ? "" : String(position.max_salary_usd),
      salary_currency: position.salary_currency || "USD",
      sector: company?.sector ?? d.sector,
    }));
    if (error) setError(null);
    if (saved) setSaved(false);
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

    const payload: JobDraft = {
      ...draft,
      // The link belongs to a create alone. An edit leaves the opening's position
      // where it is — and while 026 is unapplied, sending the column at all would
      // fail the save.
      position_id: job ? undefined : draft.position_id || undefined,
      // Undefined, not null, when the form has no level to offer: a literal null
      // would name a column the database does not have, and the level is not the
      // recruiter's to lose because a migration has not run.
      experience_level: options.termsAvailable ? draft.experience_level || null : undefined,
      requirements: draft.requirements
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };

    setPending(true);
    try {
      const result = job
        ? await updateJobOpening(job.id, payload)
        : await createJobOpening(payload);
      if (!result.ok) {
        setError(result.error ?? (job ? "Could not save the opening." : "Could not create the opening."));
        return;
      }

      // The skill list rides on its own write, against the id the opening write
      // just returned — that is the only id a create has. Untouched means nothing
      // goes on the wire: a recruiter who edited the description must not send a
      // list, and must not be refused for a table they never touched.
      const id = result.id ?? job?.id;
      const untouched = sameRequiredSkills(job?.required_skills ?? [], skills);
      if (!untouched && id) {
        const saved = await saveOpeningSkills(id, skills);
        if (!saved.ok) {
          // The opening *is* saved. Saying only "could not save" would send the
          // recruiter back over the whole form, and a drawer that closed would
          // hide the half of the write that failed, so it stays open on both facts.
          setError(`The opening itself saved. Its skill list did not: ${saved.error ?? "the required skills could not be written."}`);
          return;
        }
        if (saved.skills) setSkills(saved.skills);
      }

      setSaved(true);
      // The action already revalidated /jobs; refresh pulls the row back in.
      // Done here rather than via a callback prop, because this component is
      // rendered from a Server Component and functions cannot cross that
      // boundary.
      setTimeout(() => {
        close();
        router.refresh();
      }, 600);
    } catch {
      setError("Something went wrong saving the opening.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      eyebrow="Requisitions"
      title={job ? "Edit job opening" : "New job opening"}
      subtitle={
        job
          ? "Changes go live on the careers site as soon as you save."
          : "Published openings appear on the careers site immediately."
      }
      onSubmit={submit}
      footer={
        <DrawerActions
          onCancel={close}
          submitLabel={job ? "Save changes" : "Create opening"}
          pending={pending}
          note="Leave blank to publish later."
        />
      }
    >
      <div className="space-y-4">
        {/* A create may start from a position — the same inheritance createJobOpening
            performs on the server, so the form shows exactly what the write will do.
            An edit keeps the link it already has and is never offered this. */}
        {!job &&
          (options.positionsAvailable === false ? (
            <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-4">
              <p className="text-sm font-semibold text-amber-900">
                Positions have not been created on this database yet.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
                <code className="rounded bg-amber-100 px-1 py-0.5 text-[12px]">
                  db/migrations/026_positions.sql
                </code>{" "}
                is authored but not applied, so there is no vacancy copy to start from. You
                can still create an opening from scratch.
              </p>
            </div>
          ) : options.positions.length === 0 ? (
            <div className="rounded-xl border border-brand-line bg-brand-cream p-4 text-sm leading-relaxed text-brand-ink/70">
              No positions are on the list yet. Add one in Settings → Organisation →
              Positions, and a new opening can start from its copy.
            </div>
          ) : (
            <div className="rounded-xl border border-brand-line bg-brand-cream p-4">
              <Field
                label="Start from a position"
                htmlFor="job-position"
                hint="Fills the title, company, department, description, requirements and salary band below. Everything stays editable."
              >
                <Select
                  id="job-position"
                  value={draft.position_id}
                  onChange={(e) => pickPosition(e.target.value)}
                >
                  <option value="">No position — start from a blank opening</option>
                  {options.positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} — {p.department}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ))}

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
            {ghosts.tenant_id && (
              <option value={draft.tenant_id}>{ghosts.tenant_id}</option>
            )}
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
              {ghosts.department && (
                <option value={draft.department}>{ghosts.department}</option>
              )}
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
              {ghosts.location && (
                <option value={draft.location}>{ghosts.location}</option>
              )}
            </Select>
          </Field>
        </div>

        <div
          className={`grid grid-cols-1 gap-4 ${
            options.termsAvailable ? "sm:grid-cols-3" : "sm:grid-cols-2"
          }`}
        >
          <Field label="Employment type" htmlFor="job-employment">
            <Select
              id="job-employment"
              value={draft.employment_type}
              onChange={(e) => set("employment_type")(e.target.value)}
            >
              {/* Where 033 has never run the widened check does not exist, so the
                  two types it adds are not offered — a picker whose choice the
                  database would refuse is worse than one that says why. */}
              {(options.termsAvailable
                ? EMPLOYMENT_TYPES
                : EMPLOYMENT_TYPES.filter(
                    (type) => type.value !== "REMOTE" && type.value !== "HYBRID"
                  )
              ).map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              {/* A row stored before the read failed still gets its own option, so
                  the select cannot show a value the opening does not hold. */}
              {!EMPLOYMENT_TYPES.some((t) => t.value === draft.employment_type) &&
                draft.employment_type && (
                  <option value={draft.employment_type}>
                    {draft.employment_type.replace(/_/g, " ")}
                  </option>
                )}
            </Select>
          </Field>

          {options.termsAvailable && (
            <Field
              label="Experience level"
              htmlFor="job-experience"
              hint="Optional. Blank means none was recorded."
            >
              <Select
                id="job-experience"
                value={draft.experience_level}
                onChange={(e) => set("experience_level")(e.target.value)}
              >
                <option value="">Not recorded</option>
                {EXPERIENCE_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

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

        {!options.termsAvailable && (
          <p className="text-[11px] leading-relaxed text-brand-ink/50">
            Seniority levels and Remote/Hybrid job types arrive with{" "}
            <code className="rounded bg-brand-sand px-1 py-0.5 text-[11px]">
              {OPENING_TERMS_MIGRATION}
            </code>
            , which is authored but not applied. Until it is, this form offers the four
            employment types the database already stores.
          </p>
        )}

        <Field label="Description" htmlFor="job-description" required>
          <TextArea
            id="job-description"
            rows={4}
            value={draft.description}
            onChange={(e) => set("description")(e.target.value)}
            placeholder="What the role owns, who it reports to, and what success looks like."
          />
        </Field>

        <Field label="Requirements" htmlFor="job-requirements" hint="One per line.">
          <TextArea
            id="job-requirements"
            rows={3}
            value={draft.requirements}
            onChange={(e) => set("requirements")(e.target.value)}
            placeholder={"5+ years FP&A experience\nIFRS reporting\nAdvanced Excel"}
          />
        </Field>

        {/* Named skills, beside the lines they came from. The picker reads the
            requirement text above it as it is typed, so a line that spells out a
            catalogue skill can be accepted into the list the applicant is scored
            against — and a list the recruiter edits is what the save writes. */}
        <JobSkillsField
          skills={options.skills}
          labels={options.skillLabels}
          required={skills}
          requirements={draft.requirements
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)}
          note={options.skillsNote}
          onChange={(next) => {
            setSkills(next);
            if (error) setError(null);
            if (saved) setSaved(false);
          }}
        />

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
              {options.currencies.length === 0 && <option value="USD">USD — US Dollar</option>}
              {options.currencies.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
              {ghosts.salary_currency && (
                <option value={draft.salary_currency}>{ghosts.salary_currency}</option>
              )}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={`Salary from (${draft.salary_currency})`} htmlFor="job-salary-min">
              <TextInput
                id="job-salary-min"
                type="number"
                min={0}
                value={draft.min_salary_usd}
                onChange={(e) => set("min_salary_usd")(e.target.value)}
                placeholder="1200"
              />
            </Field>
            <Field label={`Salary to (${draft.salary_currency})`} htmlFor="job-salary-max">
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

        <FormMessage
          error={error}
          success={saved ? (job ? "Opening updated." : "Opening created.") : null}
        />
      </div>
    </Drawer>
  );
}

/** Create-only entry point: the "+ New opening" button in the page header. */
export function NewJobDrawer({ options }: { options: JobFormOptions }) {
  const [open, setOpen] = useState(false);
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

      {/* Keyed so a second open always starts from a clean draft. */}
      {open && (
        <JobFormDrawer
          key="new-job"
          options={options}
          job={null}
          open
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
