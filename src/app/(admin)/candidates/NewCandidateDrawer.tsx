"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { sourceLabel, stageLabel } from "@/lib/utils";
import { APPLICATION_SOURCES } from "@/modules/candidates/domain/listFilters";
import {
  createCandidate,
  listManualOpenings,
  type CreatedCandidate,
  type ManualOpeningOption,
} from "./candidate-actions";

/**
 * Files an applicant who never came through the career site.
 *
 * Before this, the only doors into `applications` were the public apply form and
 * converting a sourced prospect, so a CV someone mailed or a name taken during a
 * phone screen could not be worked as a candidate at all.
 *
 * The opening list is fetched when the drawer opens rather than in the page
 * render — recording someone by hand is rare next to the table, and a fourth
 * query on every Candidates load would tax it for everyone.
 */
export function NewCandidateDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState<ManualOpeningOption[] | null>(null);
  const [jobId, setJobId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCandidate | null>(null);
  const [pending, setPending] = useState(false);

  function stop() {
    setOpen(false);
    setError(null);
    setCreated(null);
  }

  function start() {
    setOpen(true);
    if (openings !== null) return;
    void listManualOpenings().then((result) => {
      setOpenings(result.openings);
      // A failed query must not look like a group with no openings, and an
      // empty list must not look like a failure.
      if (!result.ok) setError("The openings list did not load. Close this panel and try again.");
      else if (result.openings.length === 0)
        setError("There are no job openings to file someone under yet.");
    });
  }

  function clearContact() {
    setFullName("");
    setEmail("");
    setPhone("");
    setError(null);
    setCreated(null);
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
      const result = await createCandidate({ jobId, fullName, email, phone, source });
      if (result.ok && result.candidate) {
        setCreated(result.candidate);
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
            ? "Filed under New — attach a CV on the record and read it in before screening."
            : "For someone who never applied through the careers site."
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
            hint="Only openings your company's scope reaches."
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

          <FormMessage
            error={error}
            success={
              created
                ? `Recorded ${created.full_name} for ${created.job_title}. Tracking code ${created.tracking_code}.`
                : null
            }
          />
        </div>
      </Drawer>
    </>
  );
}
