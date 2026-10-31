"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  X,
} from "lucide-react";
import { getAttemptIntegrity, type AttemptIntegrity } from "./integrity-actions";
import {
  getAttemptAiGrades,
  retryAttemptGrading,
  scoreAttemptResponse,
  type AttemptGrades,
  type QuestionGrade,
} from "./assessment-actions";
import { INTEGRITY_LABELS } from "@/modules/assessment/domain/integrity";
import { cn } from "@/lib/utils";
import { Badge } from "@/modules/analytics/presentation/ui";

const QUESTION_TYPE_LABELS: Record<string, string> = {
  EXCEL_MODEL: "Excel model",
  VIDEO_PITCH: "Video pitch",
  CASE_STUDY: "Case study",
  MULTIPLE_CHOICE: "Multiple choice",
  SITUATIONAL_JUDGMENT: "Situational judgment",
};

function severityTone(severity: string) {
  if (severity === "CRITICAL") return "danger" as const;
  if (severity === "WARN") return "gold" as const;
  return "neutral" as const;
}

function scoreTone(score: number | null) {
  if (score === null) return "neutral" as const;
  if (score >= 85) return "success" as const;
  if (score >= 60) return "gold" as const;
  return "danger" as const;
}

/**
 * What the report may honestly say about an unfinished attempt.
 *
 * The chip this replaces promised "Grading in progress" for every non-GRADED
 * status. Nothing is in progress: the scheduled sweep retries open answers but
 * deliberately leaves a parked one alone, so a paper still waiting on a person
 * stays that way. Each line here states only what the status and the response
 * rows prove — and names the desk below when this reviewer can finish the job.
 */
function statusNote(grades: AttemptGrades): { text: string; actionable: boolean } | null {
  if (grades.status === "GRADED") return null;
  if (grades.status === "NOT_STARTED") return { text: "Not started yet", actionable: false };
  if (grades.status === "IN_PROGRESS") return { text: "Still being answered", actionable: false };
  // Set both when a deadline ran out and when a recruiter revoked the link.
  if (grades.status === "EXPIRED") return { text: "Link closed", actionable: false };
  if (grades.unscored === 0) {
    return { text: "Every answer is marked — only the status is behind", actionable: true };
  }
  // The engine is the only thing that scores these, so say whether it can run
  // before saying who may finish the job by hand.
  const why: string[] = [];
  if (grades.ai_grading === "OFF") why.push("AI grading is switched off");
  else if (grades.ai_grading === "NO_PROVIDER") why.push("no AI provider is configured");
  if (grades.can_score) why.push("award them below");

  return {
    text: `${grades.unscored} answer${grades.unscored === 1 ? "" : "s"} left unscored${
      why.length ? ` — ${why.join(", ")}` : ""
    }`,
    actionable: true,
  };
}

/**
 * Recruiter-facing integrity report.
 *
 * Signals are advisory context, not a verdict — the copy makes that explicit so
 * nobody auto-rejects on a single tab switch.
 *
 * It is also the desk where an answer the AI could not score gets its marks: the
 * recording a mark would be judged from is played here, and this is where one is
 * typed by hand. The assistant can read this same report and run both grading
 * actions, but only through the very two actions called below — so a role
 * refused on this screen is refused in the chat as well.
 */
export function IntegrityPanel({
  accessToken,
  candidateName,
}: {
  accessToken: string;
  candidateName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AttemptIntegrity | null>(null);
  const [grades, setGrades] = useState<AttemptGrades | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [runNote, setRunNote] = useState<{ text: string; bad: boolean } | null>(null);

  /**
   * `silent` keeps the report on screen while it re-reads, which is what a
   * hand-awarded mark needs: the panel must not blank itself into a spinner
   * under the recruiter's own cursor.
   */
  async function fetchReport({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [integrityResult, gradesResult] = await Promise.all([
        getAttemptIntegrity(accessToken),
        getAttemptAiGrades(accessToken),
      ]);
      setReport(integrityResult);
      setGrades(gradesResult);
    } catch {
      setError("Could not load the integrity report.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function openPanel() {
    setOpen(true);
    if (report || loading) return;
    await fetchReport();
  }

  /**
   * One grading pass, on demand, for the answers the engine left open.
   *
   * Reports what the run moved in its own words rather than reloading quietly:
   * a pass that scored nothing is a real outcome a recruiter needs to see, not a
   * button that appeared to do nothing.
   */
  async function runGrading(attemptId: string, mayScore: boolean) {
    setRetrying(true);
    setRunNote(null);
    try {
      const result = await retryAttemptGrading(attemptId);
      if (!result.ok) {
        setRunNote({ text: result.error ?? "The AI did not run.", bad: true });
        return;
      }

      const scored = result.scored ?? 0;
      const left = result.still_unscored ?? 0;
      const finish = scored === 0 ? "" : mayScore ? " — or award them below" : "";
      setRunNote({
        text:
          scored === 0 && left === 0
            ? result.finalized
              ? "Every answer already carried a mark — the test is now graded."
              : "Every answer already carried a mark."
            : scored === 0
              ? `The AI took another pass — all ${left} still open${finish}`
              : left === 0
                ? `The AI scored the last ${scored === 1 ? "answer" : `${scored} answers`} — the test is graded`
                : `The AI scored ${scored}, ${left} still open${finish}`,
        bad: false,
      });
      await fetchReport({ silent: true });
    } finally {
      setRetrying(false);
    }
  }

  const note = grades ? statusNote(grades) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => void openPanel()}
        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
      >
        <ShieldQuestion className="h-3 w-3" aria-hidden />
        Integrity
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="integrity-title"
        >
          <button
            type="button"
            aria-label="Close integrity report"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
          />

          <div className="relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-brand-line bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="integrity-title" className="font-display text-xl font-extrabold">
                  Assessment report
                </h2>
                <p className="mt-1 text-sm text-brand-ink/60">{candidateName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close integrity report"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-brand-ink/50">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading report…
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </p>
            )}

            {report && !loading && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Integrity
                    </p>
                    <p className="mt-1 font-display text-2xl font-extrabold">
                      {report.scores_masked ? "Hidden" : (report.integrity_score ?? "—")}
                      {!report.scores_masked && report.integrity_score !== null && (
                        <span className="text-sm text-brand-ink/40">/100</span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Signals
                    </p>
                    <p className="mt-1 font-display text-2xl font-extrabold">
                      {report.integrity_flags}
                    </p>
                  </div>
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Score
                    </p>
                    <p className="mt-1 font-display text-2xl font-extrabold">
                      {report.scores_masked ? "Hidden" : (report.score ?? "—")}
                      {!report.scores_masked && report.max_score ? (
                        <span className="text-sm text-brand-ink/40">/{report.max_score}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Status
                    </p>
                    <p className="mt-1 text-sm font-bold">{report.status}</p>
                  </div>
                </div>

                {/* The rank beside its own population. The note carries the count,
                    so a suite with too few graded papers shows the number found
                    and says no rank is claimed rather than leaving a blank. */}
                {grades?.benchmark && (
                  <p className="rounded-xl bg-brand-cream px-4 py-3 text-xs leading-relaxed text-brand-ink/65">
                    {grades.benchmark.note}
                  </p>
                )}

                {report.scores_masked && (
                  <p className="rounded-xl bg-brand-cream px-4 py-3 text-xs leading-relaxed text-brand-ink/60">
                    The marks are withheld because “Mask scores for interviewers” is on and your
                    role is not granted “View unmasked scores”. Answers, recordings and the AI’s
                    written feedback are still here.
                  </p>
                )}

                {grades && grades.grades.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/45">
                        <Sparkles className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
                        AI feedback — {grades.template_name}
                      </h3>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {note && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold",
                              note.actionable
                                ? "bg-amber-50 text-amber-800"
                                : "bg-brand-cream text-brand-ink/55"
                            )}
                          >
                            {note.actionable ? (
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                            ) : (
                              <Clock className="h-3 w-3" aria-hidden />
                            )}
                            {note.text}
                          </span>
                        )}
                        {/* Offered when the engine can make a run: a pass over
                            open answers needs AI ready, while closing a paper
                            whose answers all carry a mark needs only the grade
                            permission. */}
                        {grades.can_retry &&
                          (grades.unscored > 0
                            ? grades.ai_grading === "READY"
                            : grades.status === "SUBMITTED") && (
                            <button
                              type="button"
                              disabled={retrying}
                              onClick={() => void runGrading(grades.attempt_id, grades.can_score)}
                              className="inline-flex items-center gap-1 rounded-lg bg-brand-ink px-2.5 py-1 text-[11px] font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {retrying ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                              ) : (
                                <RefreshCw className="h-3 w-3" aria-hidden />
                              )}
                              {retrying
                                ? "Grading…"
                                : grades.unscored > 0
                                  ? "Ask the AI again"
                                  : "Finish grading"}
                            </button>
                          )}
                        {runNote && (
                          <p
                            className={cn(
                              "w-full text-right text-[11px] leading-tight",
                              runNote.bad ? "text-rose-700" : "text-emerald-800"
                            )}
                          >
                            {runNote.text}
                          </p>
                        )}
                      </div>
                    </div>

                    <ul className="space-y-3">
                      {grades.grades.map((grade) => (
                        <li
                          key={grade.id}
                          className="rounded-xl border border-brand-line p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold">{grade.title}</p>
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-ink/45">
                                {QUESTION_TYPE_LABELS[grade.question_type] ?? grade.question_type}
                              </p>
                              {grade.awarded_by && (
                                <p className="text-[11px] text-brand-ink/40">
                                  {grade.awarded_by === "STAFF"
                                    ? "Marks awarded by a person"
                                    : "Marks awarded by the AI"}
                                </p>
                              )}
                            </div>
                            <Badge
                              tone={
                                grades.scores_masked || grade.score === null || !grade.max_score
                                  ? "neutral"
                                  : scoreTone(Math.round((grade.score / grade.max_score) * 100))
                              }
                              className="shrink-0"
                            >
                              {grades.scores_masked
                                ? "Hidden"
                                : grade.score === null || !grade.max_score
                                  ? "Not graded"
                                  : `${grade.score}/${grade.max_score}`}
                            </Badge>
                          </div>

                          {grade.video_url && (
                            <video
                              src={grade.video_url}
                              controls
                              preload="none"
                              className="mt-3 aspect-video w-full rounded-lg bg-black"
                            />
                          )}

                          {grade.rationale && (
                            <p className="mt-2.5 text-sm leading-relaxed text-brand-ink/70">
                              {grade.rationale}
                            </p>
                          )}

                          {grade.strengths.length > 0 && (
                            <ul className="mt-2.5 space-y-1">
                              {grade.strengths.slice(0, 5).map((strength) => (
                                <li key={strength} className="flex items-start gap-1.5 text-xs text-emerald-800">
                                  <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                                  {strength}
                                </li>
                              ))}
                            </ul>
                          )}

                          {grade.improvements.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {grade.improvements.slice(0, 5).map((improvement) => (
                                <li key={improvement} className="flex items-start gap-1.5 text-xs text-amber-800">
                                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden />
                                  {improvement}
                                </li>
                              ))}
                            </ul>
                          )}

                          {grade.answer_preview && (
                            <details className="mt-2.5">
                              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-brand-ink/40 hover:text-brand-ink/60">
                                Answer excerpt
                              </summary>
                              <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-brand-cream p-3 text-xs leading-relaxed text-brand-ink/60">
                                {grade.answer_preview}
                                {grade.answer_preview.length === 400 && "…"}
                              </p>
                            </details>
                          )}

                          {grade.transcript && (
                            <details className="mt-2.5">
                              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-brand-ink/40 hover:text-brand-ink/60">
                                Transcript
                              </summary>
                              <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-brand-cream p-3 text-xs leading-relaxed text-brand-ink/60">
                                {grade.transcript}
                                {grade.transcript.length === 1200 && "…"}
                              </p>
                            </details>
                          )}

                          {grades.can_score && (
                            <ScoreEditor
                              key={grade.response_id}
                              grade={grade}
                              onReload={() => void fetchReport({ silent: true })}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {report.events.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    No integrity signals recorded — the assessment was completed cleanly.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge tone={scoreTone(report.integrity_score)}>
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        {report.scores_masked
                          ? "Signals recorded"
                          : `Integrity ${report.integrity_score ?? "?"}/100`}
                      </Badge>
                      <span className="text-xs text-brand-ink/45">
                        {report.events.length} event
                        {report.events.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <ul className="divide-y divide-brand-line rounded-xl border border-brand-line">
                      {report.events.map((event) => (
                        <li key={event.id} className="flex flex-wrap items-start gap-3 p-3">
                          <Badge tone={severityTone(event.severity)} className="shrink-0">
                            {event.severity}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">
                              {INTEGRITY_LABELS[event.event_type] ?? event.event_type}
                            </p>
                            <p className="text-xs text-brand-ink/55">
                              {new Date(event.occurred_at).toLocaleString()}
                              {event.question_title ? ` · ${event.question_title}` : ""}
                            </p>
                            {event.detail && (
                              <p className="mt-0.5 text-xs text-brand-ink/45">{event.detail}</p>
                            )}
                            {event.device_label && (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand-ink/40">
                                <Laptop className="h-3 w-3" aria-hidden />
                                {event.device_label}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    <p className="rounded-xl bg-brand-cream px-4 py-3 text-xs leading-relaxed text-brand-ink/60">
                      These are signals for context, not a verdict. We record only that an
                      action happened — never keystrokes, screen content or pasted text.
                      Weigh them with the candidate&rsquo;s answers before deciding.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Award or amend one answer's marks by hand.
 *
 * Rendered only when the server says this reviewer may grade and can see points,
 * so the control never offers a mark its own action would refuse. What is typed
 * here is written onto the response and into the change trail, and the attempt's
 * totals are recomputed by the grading engine's own rule — so marking the last
 * unscored answer is what finally moves a stuck test to GRADED.
 */
function ScoreEditor({
  grade,
  onReload,
}: {
  grade: QuestionGrade;
  onReload: () => void;
}) {
  const [points, setPoints] = useState(grade.score === null ? "" : String(grade.score));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const max = Number(grade.max_score ?? 0);
  const unscored = grade.score === null;

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = Number(points);
    if (!Number.isInteger(value) || value < 0) {
      setMessage({ text: "Whole points only, 0 included.", bad: true });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await scoreAttemptResponse({
        responseId: grade.response_id,
        score: value,
        note: reason,
      });
      if (!result.ok) {
        setMessage({ text: result.error ?? "The mark was not saved.", bad: true });
        return;
      }

      setReason("");
      onReload();
      const left = result.remaining_unscored ?? 0;
      setMessage({
        text:
          left === 0
            ? `Awarded ${value} — that was the last unscored answer, so the test is now graded.`
            : `Awarded ${value} — ${left} answer${left === 1 ? "" : "s"} still unscored.`,
        bad: false,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 border-t border-brand-line pt-3">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-brand-ink/40 hover:text-brand-ink/60">
        {unscored
          ? "Award marks by hand"
          : `Re-mark this answer (now ${grade.score} of ${max})`}
      </summary>

      <form onSubmit={(event) => void save(event)} className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-brand-ink/60">
            Points
            <input
              type="number"
              min={0}
              max={max || undefined}
              step={1}
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              className="w-20 rounded-lg border border-brand-line bg-white px-2 py-1 text-sm focus:border-brand-gold focus:outline-none"
              required
            />
          </label>
          <span className="text-[11px] text-brand-ink/45">
            of {max || "?"} this answer carries
          </span>
        </div>

        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Why — written onto the answer and into the change trail."
          className="w-full rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs leading-relaxed focus:border-brand-gold focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {unscored ? "Award" : "Save mark"}
          </button>
          {message && (
            <p
              className={cn(
                "text-[11px] leading-tight",
                message.bad ? "text-rose-700" : "text-emerald-800"
              )}
            >
              {message.text}
            </p>
          )}
        </div>
      </form>
    </details>
  );
}