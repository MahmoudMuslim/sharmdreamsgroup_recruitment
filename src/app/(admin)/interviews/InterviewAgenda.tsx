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
  INTERVIEW_ROUND_LABELS,
  INTERVIEW_ROUNDS,
  roundLabel,
  scorecardsFor,
  type InterviewScorecardLayer,
} from "@/modules/interviews/domain/interviewScorecard";
import { dayKeyInZone, formatInZone, fromZoneInputValue, toZoneInputValue } from "@/lib/timezone";
import {
  countInterviewsOutsideAgenda,
  getInterviewAgenda,
  type AgendaInterview,
} from "./actions";
import { getInterviewScorecardLayer } from "./scorecard-actions";
import { ScorecardDesk } from "./ScorecardDesk";
import {
  agendaRangeLabel,
  AGENDA_FUTURE_DAYS,
  AGENDA_PAST_DAYS,
  AGENDA_RANGES,
  inAgendaRange,
  PENDING_INTERVIEW_STATUS,
  type AgendaRange,
  type InterviewStatus,
} from "./agenda-model";

type Outcome = "COMPLETED" | "NO_SHOW" | "CANCELLED";

/** The status chips, in the order a recruiter reads them. */
const RAIL_STATUSES: { status: InterviewStatus; label: string }[] = [
  { status: "SCHEDULED", label: "Awaiting outcome" },
  { status: "COMPLETED", label: "Completed" },
  { status: "NO_SHOW", label: "No-show" },
  { status: "CANCELLED", label: "Cancelled" },
];

/** The chip a status is filed under, for prose that has to name the filter in view. */
function statusLabel(status: InterviewStatus): string {
  return RAIL_STATUSES.find((option) => option.status === status)?.label ?? status;
}

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
 *
 * The two rails are the view: a range and a status, both written to the address as
 * they are chosen, because the interview alert in the app bar counts one slice of
 * this table and has to land on that same slice.
 */
export function InterviewAgenda({
  interviews,
  timeZone,
  canWrite,
  interviewers,
  initialRange,
  initialStatus,
  outsideAgenda,
  readAt,
  viewerId,
  scorecardLayer,
}: {
  interviews: AgendaInterview[];
  timeZone: string;
  /** `candidates.write` — the grant the two writers re-check on the server. */
  canWrite: boolean;
  /** Who may sit on a panel, read in the page render rather than on first click. */
  interviewers: InterviewerOption[];
  /** The range `?range=` named, already validated by the page. */
  initialRange: AgendaRange;
  /** The status `?status=` named, or null when the view shows every one. */
  initialStatus: InterviewStatus | null;
  /** Panels awaiting an outcome beyond each edge of the window this list can show. */
  outsideAgenda: { ahead: number; overdue: number };
  /**
   * The instant the page read the window at, and the moment every range is
   * measured from. It arrives as a prop rather than from the browser clock so the
   * slice starts where the server's `scheduled_at >= now` predicate started — and
   * so a re-render cannot quietly move the boundary.
   */
  readAt: string;
  /** The signed-in profile: a scorecard is "yours" by this id, not by name. */
  viewerId: string;
  /** Rounds and scorecards, read beside the agenda and reseeded with it. */
  scorecardLayer: InterviewScorecardLayer;
}) {
  const [rows, setRows] = useState<AgendaInterview[]>(interviews);
  const [outside, setOutside] = useState(outsideAgenda);
  const [seededFrom, setSeededFrom] = useState(interviews);
  const [layer, setLayer] = useState(scorecardLayer);
  const [seededLayerFrom, setSeededLayerFrom] = useState(scorecardLayer);
  // A panel booked from a candidate's profile, or by the assistant, re-renders
  // this page with a fresh read. Adopting it is what keeps the agenda and the
  // interview alert describing one set: the Bell re-counts the database on every
  // live change, and a list left on the rows it arrived with would disagree.
  if (interviews !== seededFrom) {
    setSeededFrom(interviews);
    setRows(interviews);
    setOutside(outsideAgenda);
  }
  // The layer is a second read with its own freshness: a scorecard written in
  // another tab arrives with a new server render while the schedule rows are the
  // same objects, so it reseeds on its own identity rather than theirs.
  if (scorecardLayer !== seededLayerFrom) {
    setSeededLayerFrom(scorecardLayer);
    setLayer(scorecardLayer);
  }
  const [range, setRange] = useState<AgendaRange>(initialRange);
  const [status, setStatus] = useState<InterviewStatus | null>(initialStatus);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("45");
  const [round, setRound] = useState("");
  const [interviewerId, setInterviewerId] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const view = useMemo(() => {
    const nowMs = Date.parse(readAt);
    const todayKey = dayKeyInZone(readAt, timeZone);
    const withinRange = rows.filter(
      (row) =>
        // "Today" is the organisation's calendar day; every other range is a span
        // of absolute instants measured from the same `readAt` the window was cut at.
        inAgendaRange(
          Date.parse(row.scheduled_at),
          range,
          nowMs,
          dayKeyInZone(row.scheduled_at, timeZone) === todayKey
        )
    );
    const shown = status ? withinRange.filter((row) => row.status === status) : withinRange;

    const byDay = new Map<string, AgendaInterview[]>();
    for (const row of shown) {
      const key = dayKeyInZone(row.scheduled_at, timeZone);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(row);
      else byDay.set(key, [row]);
    }

    return {
      groups: [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, items]) => ({
          label: dayLabel(items[0].scheduled_at, timeZone),
          rows: items.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
        })),
      // Counted over the range, whatever the status chip is set to: this is the
      // number the interview alert makes its claim with, so a chip that quietly
      // removed it from view would only restart the disagreement.
      awaitingOutcome: withinRange.filter((row) => row.status === PENDING_INTERVIEW_STATUS).length,
      hasForward: rows.some((row) => Date.parse(row.scheduled_at) >= nowMs),
      hasPast: rows.some((row) => Date.parse(row.scheduled_at) < nowMs),
      hasOtherStatuses: status ? withinRange.some((row) => row.status !== status) : false,
    };
  }, [rows, range, status, timeZone, readAt]);

  const visible = view.groups.reduce((sum, group) => sum + group.rows.length, 0);

  /**
   * Move the view, then put the same view in the address.
   *
   * The whole window is already in `rows`, so a chip is answered locally and the
   * URL is rewritten rather than navigated: the address stays true for a refresh
   * or a paste — the page reads both parameters back through its own validators —
   * and changing range costs no round trip.
   */
  function applyView(next: AgendaRange, nextStatus: InterviewStatus | null) {
    setRange(next);
    setStatus(nextStatus);
    const search = new URLSearchParams();
    search.set("range", next);
    if (nextStatus) search.set("status", nextStatus);
    const qs = search.toString();
    window.history.replaceState(null, "", qs ? `/interviews?${qs}` : "/interviews");
  }

  /**
   * Reads the window and its two edges again, so a moved panel leaves the day it
   * was in and the horizon note never lags behind the list under it.
   */
  async function reload() {
    const [fresh, edges] = await Promise.all([
      getInterviewAgenda(),
      countInterviewsOutsideAgenda(),
    ]);
    setRows(fresh);
    setOutside(edges);
    // The layer is a second read of the same rows — a newly booked panel needs
    // its round, and a scorecard just saved needs to arrive without a refresh.
    setLayer(await getInterviewScorecardLayer(fresh.map((row) => row.id)));
  }

  function closeEditor() {
    setEditingId(null);
    setWhen("");
    setDuration("45");
    setRound("");
    setInterviewerId("");
    setMeetingLink("");
  }

  function openEditor(row: AgendaInterview) {
    setError(null);
    setNotice(null);
    setEditingId(row.id);
    setWhen(toZoneInputValue(row.scheduled_at, timeZone));
    setDuration(String(row.duration_minutes));
    setRound(layer.rounds[row.id] ?? "");
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
        // Omitted while the column is missing, so a move still works on a
        // database that predates 032. Blank is an explicit clear once it exists.
        ...(layer.roundsAvailable ? { round: round || null } : {}),
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

  async function mark(row: AgendaInterview, outcome: Outcome) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setInterviewStatus({ interviewId: row.id, status: outcome });
      if (!result.ok) {
        setError(result.error ?? "The outcome was not recorded.");
        return;
      }
      setNotice(
        outcome === "CANCELLED"
          ? `Panel cancelled. ${channelSummary(result.channels, result.notified)}`
          : outcome === "NO_SHOW"
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
        {AGENDA_RANGES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => applyView(option.id, status)}
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
        <span
          className="ml-auto text-xs text-brand-ink/50"
          title={`Awaiting an outcome counts every scheduled panel in ${agendaRangeLabel(range)}, whatever the status chip is set to — the same set the interview alert in the app bar counts.`}
        >
          {visible} shown · {view.awaitingOutcome} awaiting an outcome in this range
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/40">
          Status
        </span>
        <button
          type="button"
          onClick={() => applyView(range, null)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
            !status
              ? "border-brand-ink bg-brand-ink text-brand-cream"
              : "border-brand-line bg-white hover:bg-brand-sand"
          )}
        >
          All
        </button>
        {RAIL_STATUSES.map((option) => (
          <button
            key={option.status}
            type="button"
            onClick={() => applyView(range, status === option.status ? null : option.status)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
              status === option.status
                ? "border-brand-gold-dark bg-brand-gold/15 text-brand-gold-dark"
                : "border-brand-line bg-white hover:bg-brand-sand"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!canWrite && rows.length > 0 && (
        <p className="text-xs text-brand-ink/50">
          Reading the calendar. Moving a panel or recording an outcome needs the Edit candidates
          permission.
        </p>
      )}

      {layer.note && <p className="text-xs text-brand-ink/50">{layer.note}</p>}

      {(outside.ahead > 0 || outside.overdue > 0) && (
        <p className="text-xs text-brand-ink/50">
          Outside this window:{" "}
          {[
            outside.ahead > 0
              ? `${outside.ahead} ${outside.ahead === 1 ? "panel is" : "panels are"} booked beyond the ${AGENDA_FUTURE_DAYS}-day horizon`
              : null,
            outside.overdue > 0
              ? `${outside.overdue} ${outside.overdue === 1 ? "slot is" : "slots are"} further back than ${AGENDA_PAST_DAYS} days and still awaiting an outcome`
              : null,
          ]
            .filter((part) => part !== null)
            .join("; ")}
          . Each is on the candidate&apos;s profile.
        </p>
      )}

      <FormMessage error={error} success={notice} />

      {visible === 0 && (
        <Card>
          <EmptyState
            title={rows.length === 0 ? "Nothing booked here" : "Nothing in this view"}
            description={
              rows.length === 0
                ? "Interviews appear once they are scheduled from a candidate's profile."
                : `This calendar holds ${rows.length} panel${rows.length === 1 ? "" : "s"}, but none of them fall in ${agendaRangeLabel(range)}${
                    status ? ` under the "${statusLabel(status)}" chip` : ""
                  }.`
            }
            icon={<CalendarDays className="h-6 w-6" aria-hidden />}
          />
          {rows.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {status && view.hasOtherStatuses && (
                <Button size="sm" variant="outline" onClick={() => applyView(range, null)}>
                  Show every status
                </Button>
              )}
              {range !== "upcoming" && view.hasForward && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => applyView("upcoming", status)}
                >
                  {agendaRangeLabel("upcoming")}
                </Button>
              )}
              {range !== "past" && view.hasPast && (
                <Button size="sm" variant="outline" onClick={() => applyView("past", status)}>
                  {agendaRangeLabel("past")}
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {view.groups.map((group) => (
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
              const panelRound = roundLabel(layer.rounds[row.id]);

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
                          href={
                            row.application_id
                              ? `/candidates/${row.application_id}`
                              : `/candidates?c=${encodeURIComponent(row.tracking_code)}`
                          }
                          className="hover:text-brand-gold-dark hover:underline"
                          title={
                            row.application_id
                              ? "Their profile — every opening they hold, with the tests, files and messages on any of them"
                              : undefined
                          }
                        >
                          {row.candidate_name}
                        </Link>
                        <span className="ml-1.5 text-xs font-normal text-brand-ink/45">
                          {row.tracking_code}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-brand-ink/60">
                        {row.job_title ?? "No role on file"} · {row.duration_minutes} min
                        {panelRound ? ` · ${panelRound} round` : ""}
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
                        {layer.roundsAvailable && (
                          <Field
                            label="Round"
                            htmlFor={`agenda-round-${row.id}`}
                            hint="Which stage of the process this panel is. Blank leaves the panel with no round."
                          >
                            <Select
                              id={`agenda-round-${row.id}`}
                              value={round}
                              onChange={(event) => setRound(event.target.value)}
                            >
                              <option value="">No round</option>
                              {INTERVIEW_ROUNDS.map((id) => (
                                <option key={id} value={id}>
                                  {INTERVIEW_ROUND_LABELS[id]}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        )}
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

                  {layer.scorecardsAvailable &&
                    (row.status === "COMPLETED" ||
                      (row.status === "SCHEDULED" && !inFuture)) && (
                      <ScorecardDesk
                        interviewId={row.id}
                        viewerId={viewerId}
                        cards={scorecardsFor(layer, row.id)}
                        timeZone={timeZone}
                        onSaved={reload}
                      />
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
