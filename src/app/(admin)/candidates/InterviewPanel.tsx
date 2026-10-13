"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Loader2, X } from "lucide-react";
import { Badge, Button, EmptyState } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, Select, TextInput } from "@/modules/analytics/presentation/Form";
import {
  listInterviewers,
  rescheduleInterview,
  scheduleInterview,
  setInterviewStatus,
  type InterviewerOption,
  type InterviewMutation,
  type InterviewRecord,
} from "./interview-actions";

const DURATIONS = [30, 45, 60, 90];

type ChannelReport = NonNullable<InterviewMutation["channels"]>;

/**
 * What the candidate actually received, in the recruiter's words.
 *
 * Says refused rather than sent when the relay rejected the email: the row is in
 * the outbox with the relay's answer, and the portal notice still reached them.
 */
function channelSummary(channels: ChannelReport | undefined, notified: boolean | undefined) {
  if (!channels) {
    return notified
      ? "The candidate was notified on the channels that are switched on."
      : "(no channel delivered a note — WhatsApp is off or the candidate has no number.)";
  }

  const parts: string[] = [];
  if (channels.whatsapp === "queued") parts.push("a WhatsApp note queued");
  if (channels.email === "sent") parts.push("an email");
  if (channels.email === "failed") parts.push("an email the relay refused (see Outbox)");
  if (channels.inApp === "sent") parts.push("a portal notice");

  if (parts.length === 0) {
    return "(nothing reached the candidate — every channel is off, or the email and number are missing.)";
  }
  return `The candidate was sent ${parts.join(", ")}.`;
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "NO_SHOW") return "danger" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "info" as const;
}

/** Reads an ISO instant as the wall clock the recruiter's browser is on. */
function formatSlot(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Prefills a `datetime-local` input from a stored instant. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * Interview scheduling for one candidate.
 *
 * Bookings are stored on `interview_schedules`; the candidate hears about them
 * over the same WhatsApp queue the pipeline uses. Times are shown in the
 * recruiter's own timezone and sent as absolute instants, so a booking never
 * shifts on the way to the database.
 */
export function InterviewPanel({
  applicationId,
  candidateName,
  jobTitle,
  initialInterviews,
  canWrite,
}: {
  applicationId: string;
  candidateName: string;
  jobTitle: string | null;
  initialInterviews: InterviewRecord[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [interviews, setInterviews] = useState(initialInterviews);
  const [interviewers, setInterviewers] = useState<InterviewerOption[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("45");
  const [interviewerId, setInterviewerId] = useState("");
  const [meetingLink, setMeetingLink] = useState("");

  async function loadInterviewers() {
    if (interviewers) return;
    try {
      setInterviewers(await listInterviewers());
    } catch {
      setError("Could not load the interviewer list.");
    }
  }

  function openForm(existing?: InterviewRecord) {
    setError(null);
    setNotice(null);
    if (existing) {
      setEditingId(existing.id);
      setWhen(toLocalInputValue(existing.scheduled_at));
      setDuration(String(existing.duration_minutes));
      setMeetingLink(existing.meeting_link ?? "");
    } else {
      setEditingId(null);
      setWhen("");
      setDuration("45");
      setMeetingLink("");
    }
    setShowForm(true);
    void loadInterviewers();
  }

  function applyResult(result: InterviewMutation, message: string) {
    if (result.interviews) setInterviews(result.interviews);
    setNotice(`${message} ${channelSummary(result.channels, result.notified)}`);
    router.refresh();
  }

  async function submit() {
    if (!when) {
      setError("Pick a date and time.");
      return;
    }
    const instant = new Date(when);
    if (Number.isNaN(instant.getTime())) {
      setError("Pick a valid date and time.");
      return;
    }

    const payload = {
      scheduledAt: instant.toISOString(),
      durationMinutes: Number(duration),
      meetingLink,
      interviewerProfileId: interviewerId || null,
    };

    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = editingId
        ? await rescheduleInterview({ interviewId: editingId, ...payload })
        : await scheduleInterview({ applicationId, ...payload });

      if (!result.ok) {
        setError(result.error ?? "Could not save the interview.");
        return;
      }
      applyResult(result, editingId ? "Interview moved." : "Interview booked.");
      setShowForm(false);
      setEditingId(null);
    } catch {
      setError("Something went wrong saving the interview.");
    } finally {
      setPending(false);
    }
  }

  async function mark(id: string, status: "COMPLETED" | "NO_SHOW" | "CANCELLED") {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setInterviewStatus({ interviewId: id, status });
      if (!result.ok) {
        setError(result.error ?? "Could not update the interview.");
        return;
      }
      const label =
        status === "COMPLETED" ? "Marked completed." : status === "NO_SHOW" ? "Marked no-show." : "Interview cancelled.";
      if (status === "CANCELLED") applyResult(result, label);
      else {
        setNotice(label);
        if (result.interviews) setInterviews(result.interviews);
        router.refresh();
      }
    } catch {
      setError("Something went wrong updating the interview.");
    } finally {
      setPending(false);
    }
  }

  const upcoming = interviews.filter((row) => row.status === "SCHEDULED").length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setNotice(null);
          setError(null);
        }}
        className="inline-flex items-center gap-1 rounded bg-brand-gold/20 px-2.5 py-1 text-xs font-semibold text-brand-gold-dark transition hover:bg-brand-gold/30"
      >
        <CalendarClock className="h-3 w-3" aria-hidden />
        Interview{upcoming > 0 ? ` · ${upcoming}` : ""}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="interview-title"
        >
          <button
            type="button"
            aria-label="Close interview panel"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
          />

          <div className="relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-brand-line bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="interview-title" className="font-display text-xl font-extrabold">
                  Interviews
                </h2>
                <p className="mt-1 text-sm text-brand-ink/60">
                  {candidateName}
                  {jobTitle ? ` — ${jobTitle}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close interview panel"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {interviews.length === 0 && !showForm && (
              <EmptyState
                title="No interviews booked"
                description="Book a slot and the candidate is emailed, messaged on WhatsApp if that channel is on, and left a notice in their portal inbox."
                icon={<CalendarClock className="h-6 w-6" aria-hidden />}
              />
            )}

            {interviews.length > 0 && (
              <ul className="mb-5 space-y-3">
                {interviews.map((row) => (
                  <li key={row.id} className="rounded-xl border border-brand-line bg-brand-cream p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-display text-sm font-bold">{formatSlot(row.scheduled_at)}</p>
                      <Badge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-brand-ink/60">
                      {row.duration_minutes} min
                      {row.interviewer_name ? ` · ${row.interviewer_name}` : ""}
                      {row.calendar_provider !== "MANUAL" ? ` · ${row.calendar_provider}` : ""}
                    </p>
                    {row.meeting_link && (
                      <a
                        href={row.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all text-xs font-semibold text-brand-gold-dark hover:underline"
                      >
                        {row.meeting_link}
                      </a>
                    )}

                    {canWrite && row.status === "SCHEDULED" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => openForm(row)}>
                          Reschedule
                        </Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => void mark(row.id, "COMPLETED")}>
                          Completed
                        </Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => void mark(row.id, "NO_SHOW")}>
                          No-show
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => void mark(row.id, "CANCELLED")}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {showForm ? (              <div className="rounded-xl border border-brand-line p-4">
                <h3 className="mb-3 font-display text-sm font-bold">
                  {editingId ? "Move this interview" : "New interview"}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date and time" htmlFor="interview-when" required hint="Shown in your timezone and sent as an absolute time.">
                    <TextInput
                      id="interview-when"
                      type="datetime-local"
                      value={when}
                      onChange={(event) => setWhen(event.target.value)}
                    />
                  </Field>
                  <Field label="Duration" htmlFor="interview-duration" required>
                    <Select
                      id="interview-duration"
                      value={duration}
                      onChange={(event) => setDuration(event.target.value)}
                    >
                      {DURATIONS.map((minutes) => (
                        <option key={minutes} value={String(minutes)}>
                          {minutes} minutes
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Interviewer" htmlFor="interview-interviewer" className="sm:col-span-2">
                    <Select
                      id="interview-interviewer"
                      value={interviewerId}
                      onChange={(event) => setInterviewerId(event.target.value)}
                    >
                      <option value="">Not assigned yet</option>
                      {(interviewers ?? []).map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.full_name} ({person.role.replace("_", " ").toLowerCase()})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Meeting link"
                    htmlFor="interview-link"
                    className="sm:col-span-2"
                    hint="Optional. Included in the candidate's message."
                  >
                    <TextInput
                      id="interview-link"
                      type="url"
                      placeholder="https://…"
                      value={meetingLink}
                      onChange={(event) => setMeetingLink(event.target.value)}
                    />
                  </Field>
                </div>

                <FormMessage error={error} success={notice} />

                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowForm(false);
                      setEditingId(null);
                      setError(null);
                    }}
                  >
                    Discard
                  </Button>
                  <Button disabled={pending} onClick={() => void submit()}>
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {editingId ? "Save new time" : "Book interview"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <FormMessage error={error} success={notice} />
                {canWrite && (
                  <div className="mt-4">
                    <Button onClick={() => openForm()}>
                      <CalendarPlus className="h-4 w-4" aria-hidden />
                      Schedule an interview
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
