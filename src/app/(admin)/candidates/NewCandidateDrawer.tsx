"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, UserPlus } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { sourceLabel, stageLabel } from "@/lib/utils";
import { pickerWindowNote } from "@/modules/jobs/domain/hireable";
import { APPLICATION_SOURCES } from "@/modules/candidates/domain/listFilters";
import { CV_ALLOWED_MIME_TYPES, CV_MAX_MB } from "@/modules/careers/cv-rules";
import { attachmentRule } from "@/modules/careers/attachment-rules";
import type { PersonFieldGroup } from "@/modules/candidates/domain/person-fields";
import {
  createCandidate,
  listManualOpenings,
  listDrawerPersonFields,
  type CreatedCandidate,
  type DrawerPersonField,
  type ManualOpeningOption,
  type PersonFieldValue,
} from "./candidate-actions";

/** The CV formats the staff door accepts — the same list the apply path uses. */
const CV_ACCEPT = ".pdf,.doc,.docx,.txt," + CV_ALLOWED_MIME_TYPES.join(",");

/** A stable display order for the collapsible person groups. */
const GROUP_ORDER: PersonFieldGroup[] = [
  "identity",
  "contact",
  "marital_status",
  "housing",
  "health",
  "family_details",
];

const GROUP_LABELS: Partial<Record<PersonFieldGroup, string>> = {
  identity: "Identity",
  contact: "Contact",
  marital_status: "Marital & family status",
  housing: "Housing & commute",
  health: "Health (restricted)",
  family_details: "Family details (restricted)",
};

/**
 * Files an applicant who never came through the career site, and now finally
 * takes the CV file, a profile photo and the structured person fields the record
 * door was built for (spec §4).
 *
 * The CV and photo travel as files in the action's arguments — this Next build
 * serialises a `File` through a Server Action (the precedent is the sourcing
 * profile reader, `uploadProspectProfile`), so a walk-in's CV can land in the
 * same breath as the record instead of forcing a second "attach it afterwards"
 * trip. The door stores the bytes itself, because the staff upload route needs an
 * application id that does not exist yet.
 *
 * The person controls are generated from the registry (`listDrawerPersonFields`),
 * not mirrored by hand, and the Tier-3 groups render only for a grant-holder. They
 * are collapsed by default: a quick walk-in is a name, an email and a CV, and the
 * structured half is opt-in. Whatever the recruiter fills is sent; the door
 * decides what its consent and grants allow and reports the rest in the note.
 *
 * The opening list and the person fields are fetched when the drawer opens rather
 * than in the page render — recording someone by hand is rare next to the table.
 */
export function NewCandidateDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState<ManualOpeningOption[] | null>(null);
  const [openingsTotal, setOpeningsTotal] = useState(0);
  const [jobId, setJobId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [personFields, setPersonFields] = useState<DrawerPersonField[]>([]);
  const [personValues, setPersonValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // One state, not two: the notice only ever describes the record it was filed
  // with, so clearing the record cannot leave an orphaned warning on screen.
  const [created, setCreated] = useState<{ candidate: CreatedCandidate; notice: string; note: string } | null>(
    null
  );
  const [pending, setPending] = useState(false);

  const photoRule = attachmentRule("candidate-photos");

  function stop() {
    setOpen(false);
    setError(null);
    setCreated(null);
  }

  function start() {
    setOpen(true);
    if (openings === null) {
      void listManualOpenings().then((result) => {
        setOpenings(result.openings);
        setOpeningsTotal(result.total);
        // A failed query must not look like a group with no openings, and an
        // empty list must not look like a failure.
        if (!result.ok) setError("The openings list did not load. Close this panel and try again.");
        else if (result.openings.length === 0)
          setError("There are no job openings to file someone under yet.");
      });
    }
    if (personFields.length === 0) {
      void listDrawerPersonFields().then((result) => {
        if (result.ok) setPersonFields(result.fields);
      });
    }
  }

  function clearContact() {
    setFullName("");
    setEmail("");
    setPhone("");
    setCvFile(null);
    setPhotoFile(null);
    setPersonValues({});
    setError(null);
    setCreated(null);
  }

  // A picker ships a window of the hireable openings, so when the window ran out
  // of room the field says which roles it left off instead of looking complete.
  const shortBy = openings ? pickerWindowNote(openingsTotal, openings.length) : null;

  // Group the registry fields once, in the fixed display order, so a group that
  // renders empty never shows a blank collapsible.
  const groups = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group] ?? group,
    fields: personFields.filter((field) => field.group === group),
  })).filter((section) => section.fields.length > 0);

  /** The person fields that actually hold something, as the door expects them. */
  function collectPersonChanges(): PersonFieldValue[] {
    const out: PersonFieldValue[] = [];
    for (const field of personFields) {
      const raw = (personValues[field.key] ?? "").trim();
      if (!raw) continue;
      out.push({ key: field.key, value: field.input === "number" ? Number(raw) : raw });
    }
    return out;
  }

  async function submit() {
    if (created) {
      // The opening and source stay picked: a recruiter filing a batch of
      // walk-ins for one role shouldn't re-select them per person.
      clearContact();
      return;
    }
    if (!jobId) {
      setError("Choose the opening this applicant is being recorded against.");
      return;
    }
    if (fullName.trim().length < 2) {
      setError("The name needs at least two characters.");
      return;
    }
    if (!email.trim()) {
      setError("An email address is needed — it is how the candidate is found again.");
      return;
    }
    if (!source) {
      setError("Say where this applicant came from.");
      return;
    }

    setPending(true);
    try {
      const result = await createCandidate({
        jobId,
        fullName,
        email,
        phone,
        source,
        cvFile,
        photoFile,
        person: collectPersonChanges(),
      });
      if (result.ok && result.candidate) {
        setCreated({
          candidate: result.candidate,
          notice: result.notice ?? "",
          note: result.note ?? "",
        });
        // The action already revalidated /candidates; this pulls the new row
        // into the table behind the drawer.
        router.refresh();
      } else {
        setError(result.error ?? "Could not record the candidate.");
      }
    } catch {
      setError("Something went wrong saving the record.");
    } finally {
      setPending(false);
    }
  }

  function renderControl(field: DrawerPersonField) {
    const value = personValues[field.key] ?? "";
    const setValue = (next: string) => {
      setPersonValues((prev) => ({ ...prev, [field.key]: next }));
      setError(null);
      setCreated(null);
    };
    const id = `new-candidate-person-${field.key}`;

    if (field.input === "select") {
      return (
        <Field label={field.label} htmlFor={id}>
          <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
      );
    }

    if (field.input === "textarea") {
      return (
        <Field label={field.label} htmlFor={id}>
          <textarea
            id={id}
            value={value}
            maxLength={field.maxChars}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-xl border border-brand-line bg-brand-paper px-3 py-2 text-sm text-brand-ink"
          />
        </Field>
      );
    }

    const inputType =
      field.input === "date" ? "date" : field.input === "number" ? "number" : "text";
    return (
      <Field label={field.label} htmlFor={id}>
        <TextInput
          id={id}
          type={inputType}
          value={value}
          maxLength={field.maxChars}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        Record a candidate
      </button>

      <Drawer
        open={open}
        onClose={stop}
        eyebrow="Talent database"
        title="Record a candidate by hand"
        subtitle={
          created
            ? "Filed under New — the CV is attached and read in before screening."
            : "For someone who never applied through the careers site. Add their CV and photo now."
        }
        onSubmit={submit}
        footer={
          <DrawerActions
            onCancel={stop}
            submitLabel={created ? "Record another" : "Record candidate"}
            pending={pending}
            disabled={!created && !jobId}
            note="Nothing is sent to the candidate. They didn't apply, so a confirmation would be wrong."
          />
        }
      >
        <div className="space-y-4">
          <Field
            label="Job opening"
            htmlFor="new-candidate-job"
            required
            hint={`Openings your scope reaches that are not closed — a role the group stopped hiring for cannot take a new applicant.${
              shortBy ? ` ${shortBy}` : ""
            }`}
          >
            <Select
              id="new-candidate-job"
              value={jobId}
              onChange={(e) => {
                setJobId(e.target.value);
                setError(null);
                setCreated(null);
              }}
            >
              <option value="">{openings === null ? "Loading openings…" : "Select opening…"}</option>
              {(openings ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} — {o.department || "no department"} ({stageLabel(o.status)})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Full name" htmlFor="new-candidate-name" required>
            <TextInput
              id="new-candidate-name"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setError(null);
                setCreated(null);
              }}
              placeholder="Amira Hassan"
            />
          </Field>

          <Field
            label="Email"
            htmlFor="new-candidate-email"
            required
            hint="Stored lowercase, and it keeps the portal sign-in working for this record."
          >
            <TextInput
              id="new-candidate-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
                setCreated(null);
              }}
              placeholder="amira@example.com"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="new-candidate-phone" hint="Optional. Needed for WhatsApp notices.">
              <TextInput
                id="new-candidate-phone"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
                placeholder="+20 100 000 0000"
              />
            </Field>

            <Field label="Where they came from" htmlFor="new-candidate-source" required>
              <Select
                id="new-candidate-source"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setError(null);
                  setCreated(null);
                }}
              >
                <option value="">Select a source…</option>
                {APPLICATION_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="CV file"
            htmlFor="new-candidate-cv"
            hint={`Attach the CV now, up to ${CV_MAX_MB} MB — it is stored and read for screening when the record is created.`}
          >
            <input
              id="new-candidate-cv"
              type="file"
              accept={CV_ACCEPT}
              onChange={(e) => {
                setCvFile(e.target.files?.[0] ?? null);
                setError(null);
                setCreated(null);
              }}
              className="block w-full text-sm text-brand-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-gold file:px-3 file:py-1.5 file:text-sm file:font-semibold"
            />
          </Field>

          <Field label="Profile photo" htmlFor="new-candidate-photo" hint={photoRule?.hint}>
            <input
              id="new-candidate-photo"
              type="file"
              accept={photoRule?.accept}
              onChange={(e) => {
                setPhotoFile(e.target.files?.[0] ?? null);
                setError(null);
                setCreated(null);
              }}
              className="block w-full text-sm text-brand-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-gold file:px-3 file:py-1.5 file:text-sm file:font-semibold"
            />
          </Field>

          {groups.length > 0 && (
            <details className="rounded-xl border border-brand-line px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-brand-ink">
                Person details (optional)
              </summary>
              <p className="mt-1 text-xs text-brand-ink/60">
                Generated from the profile registry. A field needs the candidate&apos;s consent to save, so
                anything refused is named back to you after the record is created.
              </p>
              <div className="mt-3 space-y-4">
                {groups.map((section) => (
                  <div key={section.group} className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-ink/70">
                      {section.label}
                    </h4>
                    {section.fields.map(renderControl)}
                  </div>
                ))}
              </div>
            </details>
          )}

          <FormMessage
            error={error}
            success={
              created
                ? `Recorded ${created.candidate.full_name} for ${created.candidate.job_title}. Tracking code ${created.candidate.tracking_code}.`
                : null
            }
            notice={created?.notice || null}
          />

          {created?.note && (
            <p className="text-sm text-brand-ink/70">{created.note}</p>
          )}

          {created && (
            <Link
              href={`/candidates/${created.candidate.id}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-gold-dark hover:underline"
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              Open their profile — everything filed about them, on every opening
            </Link>
          )}
        </div>
      </Drawer>
    </>
  );
}
