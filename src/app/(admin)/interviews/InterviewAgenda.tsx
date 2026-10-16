"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, Clock, Video, X } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/modules/analytics/presentation/ui";
import { DrawerActions, Field, FormMessage, Select, TextInput } from "@/modules/analytics/presentation/Form";
import { channelSummary } from "@/modules/omnichannel/presentation/candidateNotice";
import { durationOptions } from "@/app/(admin)/candidates/interviews-model";
import {
  rescheduleInterview,
  setInterviewStatus,
  type InterviewerOption,
} from "@/app/(admin)/candidates/interview-actions";
import { cn } from "@/lib/utils";
import {
  dayKeyInZone,
  formatInZone,
  fromZoneInputValue,
  toZoneInputValue,
} from "@/lib/timezone";
import { getInterviewAgenda, type AgendaInterview } from "./actions";

type Range = "today" | "week" | "month" | "past";

type Outcome = "COMPLETED" | "NO_SHOW" | "CANCELLED";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Next 7 days" },
  { id: "month", label: "Next 30 days" },
  { id: "past", label: "Last 30 days" },
];

const OUTCOMES: { status: Outcome; label: string }[] = [
  { status: "COMPLETED", label: "Completed" },
  { status: "NO_SHOW", label: "No-show" },
  { status: "CANCELLED", label: "Cancel" },
];

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "NO_SHOW") return "danger" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "info" as const;
}

/**
 * Midnight of the day the instant falls on in `timeZone`, as a comparable number.
 *
 * Built from the zone's own calendar parts rather than the browser's, so a
 * 01:00-Cairo booking stays on the Cairo date even for a recruiter reading the
 * agenda from Berlin.
 */
function zoneDayMs(iso: string, timeZone: string): number {
  const key = dayKeyInZone(iso, timeZone);
  if (!key) return NaN;
  const [y, mo, d] = key.split("-").map(Number);
  return Date.UTC(y, mo - 1, d);
}

function dayOffset(iso: string, timeZone: string): number {
  return Math.round(
    (zoneDayMs(iso, timeZone) - zoneDayMs(new Date().toISOString(), timeZone)) / 86_400_000
  );
}

function dayLabel(iso: string, timeZone: string): string {
  const offset = dayOffset(iso, timeZone);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return formatInZone(iso, timeZone, { weekday: "long", day: "numeric", month: "long" });
}

function slotLabel(iso: string, timeZone: string): string {
  return formatInZone(iso, timeZone, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Day-grouped interview agenda, and the desk the panels are moved from.
 *
 * Booking stays on the candidate's profile — a first invitation needs the
 * application, the stage and the notice together. Anything the agenda can already
 * see is edited here instead, because a panel that has to be moved is found on
 * the calendar, not by searching for the candidate.
 *
 * Times are typed against `organisation.timezone`, the zone the panel physically
 * runs in, and converted to an absolute instant before they leave the browser, so
 * a recruiter on holiday moves a slot to the same minute as one at the desk.
 */
export function InterviewAgenda({
  interviews,
  timeZone,
  canWrite,
  interviewers,
}: {
  interviews: AgendaInterview[];
  timeZone: string;
  /** `candidates.write` — the grant the two writers re-check on the server. */
  canWrite: boolean;
  /** Who may sit on a panel, read in the page render rather than on first click. */
  interviewers: InterviewerOption[];
}) {
  const [rows, setRows] = useState<AgendaInterview[]>(interviews);
  const [range, setRange] = useState<Range>("week");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("45");
  const [interviewerId, setInterviewerId] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const groups = useMemo(() => {
    const within = (row: AgendaInterview) => {
      const offsetDays = dayOffset(row.scheduled_at, timeZone);
      if (range === "past") return offsetDays < 0 && offsetDays >= -30;
      if (range === "today") return offsetDays === 0;
      if (range === "week") return offsetDays >= 0 && offsetDays <= 7;
      return offsetDays >= 0 && offsetDays <= 30;
    };

    const byDay = new Map<string, AgendaInterview[]>();
    for (const row of rows.filter(within)) {
      const key = dayKeyInZone(row.scheduled_at, timeZone);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(row);
      else byDay.set(key, [row]);
    }

    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, items]) => ({
        label: dayLabel(items[0].scheduled_at, timeZone),
        rows: items.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      }));
  }, [rows, range, timeZone]);

  const visible = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const pendingOutcome = rows.filter((row) => row.status === "SCHEDULED").length;

  /** Reads the window again, so a moved panel leaves the day it was in. */
  async function reload() {
    setRows(await getInterviewAgenda());
  }

  function closeEditor() {
    setEditingId(null);
    setWhen("");
    setDuration("45");
    setInterviewerId("");
    setMeetingLink("");
  }

  function openEditor(row: AgendaInterview) {
    setError(null);
    setNotice(null);
    setEditingId(row.id);
    setWhen(toZoneInputValue(row.scheduled_at, timeZone));
    setDuration(String(row.duration_minutes));
    setInterviewerId(row.interviewer_profile_id ?? "");
    setMeetingLink(row.meeting_link ?? "");
  }

  async function save(row: AgendaInterview) {
    if (!when) {
      setError("Pick a date and time.");
      return;
    }
    const scheduledAt = fromZoneInputValue(when, timeZone);
    if (!scheduledAt) {
      setError("Pick a valid date and time.");
      return;
    }

    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await rescheduleInterview({
        interviewId: row.id,
        scheduledAt,
        durationMinutes: Number(duration),
        meetingLink,
        interviewerProfileId: interviewerId || null,
      });
      if (!result.ok) {
        setError(result.error ?? "The panel was not moved.");
        return;
      }
      setNotice(`Moved to ${slotLabel(scheduledAt, timeZone)}. ${channelSummary(result.channels, result.notified)}`);
      closeEditor();
      await reload();
    } catch {
      setError("The portal did not answer, so the panel is unchanged.");
    } finally {
      setPending(false);
    }
  }

  async function mark(row: AgendaInterview, status: Outcome) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setInterviewStatus({ interviewId: row.id, status });
      if (!result.ok) {
        setError(result.error ?? "The outcome was not recorded.");
        return;
      }
      setNotice(
        status === "CANCELLED"
          ? `Panel cancelled. ${channelSummary(result.channels, result.notified)}`
          : status === "NO_SHOW"
            ? "Recorded as a no-show. The candidate is not messaged."
            : "Recorded as completed. The candidate is not messaged."
      );
      if (editingId === row.id) closeEditor();
      await reload();
    } catch {
      setError("The portal did not answer, so the outcome is unchanged.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setRange(option.id)}
            className={cn(
              "rounded-xl border px-3.5 py-2 text-sm font-semibold transition",
              range === option.id
                ? "border-brand-ink bg-brand-ink text-brand-cream"
                : "border-brand-line bg-white hover:bg-brand-sand"
            )}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-brand-ink/50">
          {visible} shown · {pendingOutcome} awaiting an outcome
        </span>
      </div>

      {!canWrite && rows.length > 0 && (
        <p className="text-xs text-brand-ink/50">
          Reading the calendar. Moving a panel or recording an outcome needs the Edit candidates
          permission.
        </p>
      )}

      <FormMessage error={error} success={notice} />

      {visible === 0 && (
        <Card>
          <EmptyState
            title="Nothing booked here"
            description="Interviews appear once they are scheduled from a candidate's profile."
            icon={<CalendarDays className="h-6 w-6" aria-hidden />}
          />
        </Card>
      )}

      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-[0.14em] text-brand-ink/45">
            {group.label}
          </h2>
          <div className="space-y-3">
            {group.rows.map((row) => {
              const editable = row.status !== "CANCELLED";
              // The writer refuses a slot already in the past, so the form is not
              // offered for one either: a control that can only fail is a trap.
              const inFuture = Date.parse(row.scheduled_at) > Date.now();
              const open = editingId === row.id;

              return (
                <Card key={row.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 font-display text-base font-bold">
                          <Clock className="h-4 w-4 text-brand-gold-dark" aria-hidden />
                          {formatInZone(row.scheduled_at, timeZone, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <Badge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</Badge>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold">
                        <Link
                          href={`/candidates?c=${encodeURIComponent(row.tracking_code)}`}
                          className="hover:text-brand-gold-dark hover:underline"
                        >
                          {row.candidate_name}
                        </Link>
                        <span className="ml-1.5 text-xs font-normal text-brand-ink/45">
                          {row.tracking_code}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-brand-ink/60">
                        {row.job_title ?? "No role on file"} · {row.duration_minutes} min
                        {row.interviewer_name
                          ? ` · ${row.interviewer_name}`
                          : " · interviewer not assigned"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.meeting_link && (
                        <a
                          href={row.meeting_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
                        >
                          <Video className="h-3.5 w-3.5" aria-hidden />
                          Join
                        </a>
                      )}
                      {canWrite && inFuture && row.status === "SCHEDULED" && (
                        <Button
                          size="sm"
                          variant={open ? "ghost" : "outline"}
                          disabled={pending}
                          onClick={() => (open ? closeEditor() : openEditor(row))}
                        >
                          {open ? (
                            <>
                              <X className="h-3.5 w-3.5" aria-hidden />
                              Close
                            </>
                          ) : (
                            <>
                              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                              Move
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  {canWrite && editable && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {OUTCOMES.map((option) => (
                        <Button
                          key={option.status}
                          size="sm"
                          variant={option.status === "CANCELLED" ? "ghost" : "outline"}
                          disabled={pending || row.status === option.status}
                          onClick={() => void mark(row, option.status)}
                        >
                          {option.label}
                        </Button>
                      ))}
                      {!inFuture && row.status === "SCHEDULED" && (
                        <span className="text-[11px] text-brand-ink/45">
                          This slot has passed, so it cannot be moved — record what happened
                          instead, or book a new panel from the candidate.
                        </span>
                      )}
                    </div>
                  )}

                  {open && (
                    <form
                      className="mt-4 rounded-xl border border-brand-line bg-brand-cream/60 p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save(row);
                      }}
                    >
                      <h3 className="mb-3 font-display text-sm font-bold">Move this panel</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Date and time"
                          htmlFor={`agenda-when-${row.id}`}
                          required
                          hint={`Typed against ${timeZone} and sent as an absolute time.`}
                        >
                          <TextInput
                            id={`agenda-when-${row.id}`}
                            type="datetime-local"
                            value={when}
                            onChange={(event) => setWhen(event.target.value)}
                          />
                        </Field>
                        <Field label="Duration" htmlFor={`agenda-duration-${row.id}`} required>
                          <Select
                            id={`agenda-duration-${row.id}`}
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
                        <Field
                          label="Interviewer"
                          htmlFor={`agenda-interviewer-${row.id}`}
                          className="sm:col-span-2"
                        >
                          <Select
                            id={`agenda-interviewer-${row.id}`}
                            value={interviewerId}
                            onChange={(event) => setInterviewerId(event.target.value)}
                          >
                            <option value="">Not assigned</option>
                            {interviewers.map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.full_name} ({person.role.replace("_", " ").toLowerCase()})
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field
                          label="Meeting link"
                          htmlFor={`agenda-link-${row.id}`}
                          className="sm:col-span-2"
                          hint="Optional. Included in the candidate's message."
                        >
                          <TextInput
                            id={`agenda-link-${row.id}`}
                            type="url"
                            placeholder="https://…"
                            value={meetingLink}
                            onChange={(event) => setMeetingLink(event.target.value)}
                          />
                        </Field>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <DrawerActions
                          onCancel={closeEditor}
                          submitLabel="Save"
                          pending={pending}
                          disabled={!when}
                          note="The candidate is told the panel moved — not re-invited — over every channel that is switched on."
                        />
                      </div>
                    </form>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
