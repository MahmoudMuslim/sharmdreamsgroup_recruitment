"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Loader2, ScrollText, X } from "lucide-react";
import { Badge, Button, EmptyState } from "@/modules/analytics/presentation/ui";
import { formatInZone, fromZoneInputValue, toZoneInputValue } from "@/lib/timezone";
import { Field, FormMessage, Select, TextInput } from "@/modules/analytics/presentation/Form";
import { channelSummary } from "@/modules/omnichannel/presentation/candidateNotice";
import { durationOptions } from "./interviews-model";
import {
  generateInterviewGuide,
  listInterviewers,
  rescheduleInterview,
  scheduleInterview,
  setInterviewStatus,
  type InterviewerOption,
  type InterviewGuideQuestion,
  type InterviewMutation,
  type InterviewRecord,
} from "./interview-actions";

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "NO_SHOW") return "danger" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "info" as const;
}

/** Reads an ISO instant as the wall clock the organisation books against. */
function formatSlot(iso: string, timeZone: string): string {
  return formatInZone(iso, timeZone, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Interview scheduling for one candidate.
 *
 * Bookings are stored on `interview_schedules`; the candidate hears about them
 * over the same WhatsApp queue the pipeline uses. Times are read and typed in
 * `organisation.timezone` — the zone the interview physically happens in — and
 * converted to an absolute instant before they leave the browser, so a recruiter
 * on holiday books the same slot as one at the desk.
 */
export function InterviewPanel({
  applicationId,
  candidateName,
  jobTitle,
  initialInterviews,
  canWrite,
  timeZone,
  canGenerateQuestions,
}: {
  applicationId: string;
  candidateName: string;
  jobTitle: string | null;
  initialInterviews: InterviewRecord[];
  canWrite: boolean;
  /** `organisation.timezone`, passed down from the page that reads the setting. */
  timeZone: string;
  /** `ai.interview_questions` — the button only appears while that switch is on. */
  canGenerateQuestions: boolean;
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
  const [questions, setQuestions] = useState<InterviewGuideQuestion[] | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function makeGuide() {
    setGenerating(true);
    setGuideError(null);
    try {
      const result = await generateInterviewGuide({ applicationId });
      if (result.ok) setQuestions(result.questions ?? []);
      else {
        setQuestions(null);
        setGuideError(result.error ?? "The model did not return a guide.");
      }
    } catch {
      setQuestions(null);
      setGuideError("The question service did not answer.");
    } finally {
      setGenerating(false);
    }
  }

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
      setWhen(toZoneInputValue(existing.scheduled_at, timeZone));
      setDuration(String(existing.duration_minutes));
      setMeetingLink(existing.meeting_link ?? "");
      // Left stale, the select still held whoever was picked for the last panel
      // opened, so moving one interview reassigned another.
      setInterviewerId(existing.interviewer_profile_id ?? "");
    } else {
      setEditingId(null);
      setWhen("");
      setDuration("45");
      setMeetingLink("");
      setInterviewerId("");
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
    const scheduledAt = fromZoneInputValue(when, timeZone);
    if (!scheduledAt) {
      setError("Pick a valid date and time.");
      return;
    }

    const payload = {
      scheduledAt,
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
                      <p className="font-display text-sm font-bold">
                        {formatSlot(row.scheduled_at, timeZone)}
                      </p>
                      <Badge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-brand-ink/60">
                      {row.duration_minutes} min
                      {row.interviewer_name ? ` · ${row.interviewer_name}` : ""}
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
                  <Field
                    label="Date and time"
                    htmlFor="interview-when"
                    required
                    hint={`Typed against the organisation timezone (${timeZone}) and sent as an absolute time.`}
                  >
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
                      {durationOptions(Number(duration)).map((minutes) => (
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

            {canGenerateQuestions && (
              <section className="mt-5 rounded-xl border border-brand-line bg-brand-cream p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 font-display text-sm font-bold">
                    <ScrollText className="h-4 w-4 text-brand-gold-dark" aria-hidden />
                    Interview questions
                  </h3>
                  <Button size="sm" variant="outline" disabled={generating} onClick={() => void makeGuide()}>
                    {generating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {questions ? "Regenerate" : "Generate from the CV gaps"}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-brand-ink/55">
                  Asked of the model behind Settings → AI & screening: it reads the gaps AI screening
                  found in this CV, the role&rsquo;s requirements and the answers from the test. The
                  guide is not stored — copy what you need into your notes before closing this panel.
                </p>

                {guideError && <p className="mt-3 text-xs font-semibold text-rose-700">{guideError}</p>}

                {questions && questions.length > 0 && (
                  <ol className="mt-3 space-y-2.5">
                    {questions.map((item, index) => (
                      <li key={index} className="rounded-lg border border-brand-line bg-white p-3">
                        <p className="text-sm font-semibold leading-snug">
                          {index + 1}. {item.question}
                        </p>
                        {item.rationale && (
                          <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/60">{item.rationale}</p>
                        )}
                        {item.skill_probed && (
                          <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-gold-dark">
                            {item.skill_probed}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}

                {questions && questions.length === 0 && !guideError && (
                  <p className="mt-3 text-xs text-brand-ink/55">The model returned no questions.</p>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}
