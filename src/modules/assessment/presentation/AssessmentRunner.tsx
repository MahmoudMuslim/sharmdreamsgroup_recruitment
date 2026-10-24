"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Loader2,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useIntegrityMonitor,
  type IntegrityEventInput,
} from "@/modules/assessment/presentation/hooks/useIntegrityMonitor";
import { SdgMark } from "@/modules/analytics/presentation/BrandLogo";
import { VideoPitchRecorder } from "@/modules/assessment/presentation/components/VideoPitchRecorder";
import { CaseStudyRunner } from "@/modules/assessment/presentation/components/CaseStudyRunner";
import { CodingRunner } from "@/modules/assessment/presentation/components/CodingRunner";
import { QuizRunner } from "@/modules/assessment/presentation/components/QuizRunner";
import { SituationalRunner } from "@/modules/assessment/presentation/components/SituationalRunner";
import {
  useAssessmentStore,
  type AttemptQuestionClient,
  type AttemptPayload,
} from "@/stores/useAssessmentStore";
import { codingAnswerAnswered } from "@/modules/assessment/domain/coding";
import { cn, formatDuration } from "@/lib/utils";

/**
 * The spreadsheet grid, loaded when a paper actually shows one.
 *
 * `SpreadsheetRunner` drags in Handsontable and HyperFormula — the single
 * biggest thing this app ships to a browser, and one an applicant sitting a
 * multiple-choice or case-study paper never needs. Rendered on demand, it becomes
 * its own chunk fetched at the question that uses it, so the rest of the runner
 * arrives sooner; `ssr: false` because the grid reads the DOM it is mounted into
 * and has nothing to server-render.
 */
const SpreadsheetRunner = dynamic(
  () =>
    import("@/modules/assessment/presentation/components/SpreadsheetRunner").then(
      (mod) => mod.SpreadsheetRunner
    ),
  {
    ssr: false,
    loading: () => (
      <p className="flex items-center gap-2 py-10 text-sm text-brand-ink/55">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Opening the spreadsheet…
      </p>
    ),
  }
);

/** Plain-language disclosure shown to the candidate for each signal. */
const INTEGRITY_COPY: Record<string, string> = {
  FOCUS_LOST: "You switched to another window or application",
  TAB_HIDDEN: "This tab went to the background",
  FULLSCREEN_EXIT: "You left full-screen mode",
  COPY_DETECTED: "You copied text from the assessment",
  PASTE_DETECTED: "You pasted content into a question",
  PASTE_BLOCKED: "Pasting is disabled for this question, so nothing was inserted",
  AI_PASTE_SUSPECTED: "Pasted text looked machine-generated",
  MULTI_DEVICE: "This assessment was started on a different device",
};

export function AssessmentRunner() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const loadAttempt = useAssessmentStore((s) => s.loadAttempt);
  const startAttempt = useAssessmentStore((s) => s.startAttempt);
  const nextQuestion = useAssessmentStore((s) => s.nextQuestion);
  const prevQuestion = useAssessmentStore((s) => s.prevQuestion);
  const decrementTimer = useAssessmentStore((s) => s.decrementTimer);
  const syncDraft = useAssessmentStore((s) => s.syncDraft);
  const submitAttempt = useAssessmentStore((s) => s.submitAttempt);

  const isLoading = useAssessmentStore((s) => s.isLoading);
  const loadError = useAssessmentStore((s) => s.loadError);
  const payload = useAssessmentStore((s) => s.payload);
  const currentQuestionIndex = useAssessmentStore((s) => s.currentQuestionIndex);
  const timeRemainingSeconds = useAssessmentStore((s) => s.timeRemainingSeconds);
  const isSubmitting = useAssessmentStore((s) => s.isSubmitting);
  const submitError = useAssessmentStore((s) => s.submitError);
  const submittedAt = useAssessmentStore((s) => s.submittedAt);

  const [started, setStarted] = useState(false);

  useEffect(() => {
    void loadAttempt(token);
  }, [token, loadAttempt]);

  // Keep the server-side draft fresh so a crashed tab loses nothing. The cadence
  // is Settings → Assessments → Autosave interval, delivered with the paper.
  const autosaveIntervalMs = (payload?.settings.autosave_interval_seconds ?? 0) * 1000;
  useEffect(() => {
    if (!autosaveIntervalMs) return;
    const id = setInterval(() => void syncDraft(), autosaveIntervalMs);
    return () => clearInterval(id);
  }, [syncDraft, autosaveIntervalMs]);

  // Authoritative countdown lives on the server (expires_at); the client mirrors it.
  useEffect(() => {
    if (!started || submittedAt) return;
    const id = setInterval(() => decrementTimer(), 1000);
    return () => clearInterval(id);
  }, [started, submittedAt, decrementTimer]);

  const questions = useMemo<AttemptQuestionClient[]>(
    () => (payload?.questions ?? []) as AttemptQuestionClient[],
    [payload]
  );
  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const progress = questions.length
    ? Math.round(((currentQuestionIndex + 1) / questions.length) * 100)
    : 0;

  // --- Transparency: which questions have an answer yet --------------------
  const spreadsheet = useAssessmentStore((s) => s.spreadsheetDataMap);
  const videos = useAssessmentStore((s) => s.videoPathsMap);
  const videoBlobs = useAssessmentStore((s) => s.videoBlobMap);
  const caseStudies = useAssessmentStore((s) => s.caseStudyAnswersMap);
  const codeAnswers = useAssessmentStore((s) => s.codeAnswersMap);
  const choices = useAssessmentStore((s) => s.choiceAnswersMap);
  const goToQuestion = useAssessmentStore((s) => s.goToQuestion);

  const answered = useMemo(() => {
    const flags = new Array<boolean>(questions.length).fill(false);
    questions.forEach((question, index) => {
      const id = question.id;
      switch (question.question_type) {
        case "EXCEL_MODEL": {
          // The sheet ships pre-filled with assumptions, so "answered" must
          // mean the candidate actually populated the required output cells.
          const cells = spreadsheet[id];
          if (!cells) break;
          const required = question.config.expected_outputs ?? [];
          flags[index] =
            required.length > 0
              ? required.every(
                  (output) => {
                    const value = cells[output.cell]?.value;
                    return value !== null && value !== undefined && value !== "";
                  }
                )
              : Object.keys(cells).length > 0;
          break;
        }
        case "VIDEO_PITCH":
          flags[index] = Boolean(videos[id]) || Boolean(videoBlobs[id]);
          break;
        case "CASE_STUDY":
          flags[index] = (caseStudies[id] ?? "").trim().length > 0;
          break;
        case "CODING":
          // Same rule as a case study: any non-whitespace text counts, and the
          // starter is never seeded into the answer, so an untouched box is not.
          flags[index] = codingAnswerAnswered(codeAnswers[id] ?? "");
          break;
        case "MULTIPLE_CHOICE":
        case "SITUATIONAL_JUDGMENT":
          // Both store the pick in `choice_answers_map`; a judgment scene is
          // answered the moment one response is selected, like a quiz.
          flags[index] = Boolean(choices[id]);
          break;
      }
    });
    return flags;
  }, [questions, spreadsheet, videos, videoBlobs, caseStudies, codeAnswers, choices]);

  const answeredCount = answered.filter(Boolean).length;
  const outstanding = questions
    .map((question, index) => ({ question, index }))
    .filter(({ index }) => !answered[index]);

  // --- Submit review --------------------------------------------------------
  const [confirming, setConfirming] = useState(false);
  const closeConfirm = useCallback(() => setConfirming(false), []);
  useEffect(() => {
    if (!confirming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  // --- Integrity: every signal recorded is disclosed to the candidate -------
  const [integrityNotices, setIntegrityNotices] = useState<IntegrityEventInput[]>([]);

  const handleIntegrityEvent = useCallback((event: IntegrityEventInput) => {
    setIntegrityNotices((prev) => [...prev.slice(-2), event]);
  }, []);

  useIntegrityMonitor({
    attemptToken: token,
    questionId: currentQuestion?.id ?? null,
    enabled: started && !submittedAt,
    trackFocusChanges: payload?.settings.track_focus_changes,
    blockCopyPaste: true,
    onEvent: handleIntegrityEvent,
  });

  const begin = useCallback(async () => {
    setStarted(true);
    await startAttempt();
  }, [startAttempt]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-ivory px-4 text-brand-ink/50">
        <span className="inline-flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading your assessment…
        </span>
      </main>
    );
  }

  if (loadError || !payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-ivory px-4">
        <div className="w-full max-w-md rounded-2xl border border-brand-line bg-white p-8 text-center shadow-soft">
          <h1 className="font-display text-2xl font-extrabold">Assessment unavailable</h1>
          <p className="mt-2 text-sm text-brand-ink/60">
            {loadError ?? "This assessment link is no longer valid."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/portal")}
            className="mt-6 w-full rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
          >
            Back to portal
          </button>
        </div>
      </main>
    );
  }

  if (submittedAt) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-ivory px-4">
        <div className="w-full max-w-md rounded-2xl border border-brand-line bg-white p-8 text-center shadow-lift">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="font-display text-2xl font-extrabold">Assessment submitted</h1>
          <p className="mt-2 text-sm text-brand-ink/60">
            Thank you — your responses have been received and are now being reviewed.
          </p>
          <button
            type="button"
            onClick={() => router.push("/portal")}
            className="mt-6 w-full rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
          >
            Return to portal
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-ivory text-brand-ink">
      {/* Sticky header keeps the timer and progress visible on every device. */}
      <header className="sticky top-0 z-50 border-b border-brand-line bg-brand-cream/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <SdgMark size={38} />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gold-dark">
                {(payload as AttemptPayload).job_title || "Assessment"}
              </p>
              <h1 className="truncate font-display text-base font-bold sm:text-lg">
                {payload.template_name}
              </h1>
            </div>
          </div>
          <div
            className={cn(
              "shrink-0 self-start rounded-xl px-3.5 py-1.5 font-mono text-base font-bold tabular-nums sm:self-auto sm:text-lg",
              timeRemainingSeconds <= 300
                ? "bg-rose-100 text-rose-700"
                : "bg-white text-brand-ink shadow-soft"
            )}
            aria-live="polite"
            aria-label="Time remaining"
          >
            {formatDuration(timeRemainingSeconds)}
          </div>
        </div>

        {/* Progress + question navigator */}
        <div className="h-1 w-full bg-brand-sand">
          <div
            className="h-full bg-gradient-to-r from-brand-gold-dark to-brand-gold-light transition-[width] duration-500"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Assessment progress"
          />
        </div>

        {started && (
          <div className="mx-auto max-w-4xl px-4 pb-3 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-brand-ink/50">
                {answeredCount} of {questions.length} answered
              </span>
              <nav aria-label="Question navigator" className="flex flex-wrap justify-end gap-1.5">
                {questions.map((question, index) => {
                  const isCurrent = index === currentQuestionIndex;
                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => goToQuestion(index)}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={`Go to question ${index + 1}${answered[index] ? " (answered)" : " (not answered)"}`}
                      className={cn(
                        "h-7 min-w-7 rounded-lg px-1.5 text-[11px] font-bold transition",
                        isCurrent && "bg-brand-ink text-brand-cream",
                        !isCurrent && answered[index] && "bg-brand-gold/25 text-brand-gold-dark hover:bg-brand-gold/40",
                        !isCurrent && !answered[index] && "bg-brand-sand text-brand-ink/45 hover:bg-brand-line"
                      )}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        )}
      </header>

      {!started ? (
        <section className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Ready to begin?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-brand-ink/60">
            {payload.application_name}, this assessment has {questions.length} question
            {questions.length === 1 ? "" : "s"} and is time-limited. Your progress saves
            automatically as you go.
          </p>
          <button
            type="button"
            onClick={() => void begin()}
            className="mt-8 w-full rounded-xl bg-brand-ink px-8 py-4 text-base font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90 sm:w-auto"
          >
            Start assessment
          </button>
        </section>
      ) : currentQuestion ? (
        <section className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
            <span>
              Question {currentQuestionIndex + 1} of {questions.length}
            </span>
            <span>{currentQuestion.points} points</span>
          </div>

          <h2 className="font-display text-xl font-bold leading-snug sm:text-2xl">
            {currentQuestion.title}
          </h2>
          <p className="mb-6 mt-2 whitespace-pre-line text-sm leading-relaxed text-brand-ink/70">
            {currentQuestion.prompt}
          </p>

          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-soft sm:p-6">
            {currentQuestion.question_type === "EXCEL_MODEL" && (
              <SpreadsheetRunner question={currentQuestion} />
            )}
            {currentQuestion.question_type === "VIDEO_PITCH" && (
              <VideoPitchRecorder question={currentQuestion} />
            )}
            {currentQuestion.question_type === "CASE_STUDY" && (
              <CaseStudyRunner question={currentQuestion} />
            )}
            {currentQuestion.question_type === "CODING" && (
              <CodingRunner question={currentQuestion} />
            )}
            {currentQuestion.question_type === "MULTIPLE_CHOICE" && (
              <QuizRunner question={currentQuestion} />
            )}
            {currentQuestion.question_type === "SITUATIONAL_JUDGMENT" && (
              <SituationalRunner question={currentQuestion} />
            )}
          </div>

          {submitError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {submitError}
            </p>
          )}

          {/* Sticky action bar: reachable with one thumb on mobile. */}
          <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-brand-line bg-brand-cream/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
            <button
              type="button"
              onClick={prevQuestion}
              disabled={currentQuestionIndex === 0}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-4 py-3 text-sm font-semibold transition",
                currentQuestionIndex === 0
                  ? "cursor-not-allowed text-brand-ink/30"
                  : "text-brand-ink/70 hover:bg-brand-sand"
              )}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Previous</span>
            </button>

            {isLastQuestion ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={isSubmitting}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:opacity-60 sm:flex-none"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
                {isSubmitting ? "Submitting…" : "Review & submit"}
              </button>
            ) : (
              <button
                type="button"
                onClick={nextQuestion}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 sm:flex-none"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>

          {integrityNotices.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4"
            >
              <p className="flex items-start gap-2 text-xs font-bold text-amber-900">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Assessment activity recorded
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-amber-900/80">
                {integrityNotices.map((notice, index) => (
                  <li key={`${notice.type}-${index}`}>
                    {INTEGRITY_COPY[notice.type] ?? "Activity detected during the assessment."}
                    {notice.detail ? ` (${notice.detail})` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] leading-relaxed text-amber-900/60">
                We only record that an action happened — never your keystrokes, screen or
                pasted text. A recruiter reviews this before any decision is made.
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="mx-auto max-w-2xl px-4 py-20 text-center text-brand-ink/55 sm:px-6">
          This assessment has no questions yet. Please contact your recruiter.
        </section>
      )}

      {/* ---- Submission review ---- */}
      {confirming && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
        >
          <button
            type="button"
            aria-label="Close review"
            onClick={closeConfirm}
            className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
          />

          <div className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-brand-line bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="review-title" className="font-display text-xl font-extrabold">
                  Submit your assessment?
                </h2>
                <p className="mt-1 text-sm text-brand-ink/60">
                  {answeredCount} of {questions.length} questions answered
                  {integrityNotices.length > 0 &&
                    ` · ${integrityNotices.length} integrity signal${integrityNotices.length === 1 ? "" : "s"} recorded`}
                </p>
              </div>
              <button
                type="button"
                onClick={closeConfirm}
                aria-label="Close review"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {outstanding.length > 0 ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
                  <Flag className="h-4 w-4" aria-hidden />
                  {outstanding.length} question{outstanding.length === 1 ? "" : "s"} still
                  unanswered
                </p>
                <ul className="mt-2 space-y-1">
                  {outstanding.map(({ question, index }) => (
                    <li key={question.id}>
                      <button
                        type="button"
                        onClick={() => {
                          goToQuestion(index);
                          closeConfirm();
                        }}
                        className="text-left text-xs text-amber-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700"
                      >
                        Q{index + 1} — {question.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Every question has been answered.
              </p>
            )}

            <p className="mb-5 text-xs leading-relaxed text-brand-ink/50">
              Once submitted you cannot change your answers. Your recruiter will receive your
              results together with automated scoring.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => void submitAttempt()}
                disabled={isSubmitting}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90 disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
                {isSubmitting ? "Submitting…" : "Submit now"}
              </button>
              <button
                type="button"
                onClick={closeConfirm}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-brand-line bg-white px-6 py-3 text-sm font-bold text-brand-ink transition hover:bg-brand-sand"
              >
                Keep working
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}