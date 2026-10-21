"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { submitApplication, type ApplyResult } from "../../actions";
import {
  ABOUT_ME_MAX_CHARS,
  CV_MAX_BYTES,
  CV_MAX_MB,
  CV_TEXT_MIN_CHARS,
  isAcceptedCvType,
  profileLink
} from "@/modules/careers/cv-rules";
import type { CvDetails } from "@/modules/careers/cv-details";
import type { PublicGateQuestion } from "@/modules/careers/gate-questions";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";
import type { Locale } from "@/types";
import { cn } from "@/lib/utils";
import { AboutStep } from "./ApplyAboutStep";
import { CvStep } from "./ApplyCvStep";
import { QuestionsStep } from "./ApplyQuestionsStep";
import { ReceivedPanel } from "./ApplyReceivedPanel";
import { ReviewStep } from "./ApplyReviewStep";

/**
 * The application, one screen at a time.
 *
 * It used to be one long form beside the job ad: contact details, the role's
 * viability questions, a file, a pasted CV and the submit button all on one
 * scroll, on the same screen as the ad the candidate was still reading. A step
 * per screen asks one thing at a time and says what is left, and the review
 * step is the first place a candidate sees their own answers side by side.
 *
 * Nothing about what is stored changed, so the same three doors are used: the
 * viability questions are fetched from `/api/careers/questions` rather than
 * prerendered, an attached file can fill the contact fields through
 * `/api/careers/prefill`, the file itself goes to a private bucket through
 * `/api/careers/upload`, and `submitApplication` still scores the answers
 * server-side. Each step is validated in the browser before it can be left and
 * the whole thing is validated again on the server, so a step skipped by hand
 * cannot smuggle an empty application through.
 *
 * On success the tracking code is shown and copied to the clipboard — losing it
 * means losing access to the application, so it is surfaced prominently rather
 * than sent only to an email the candidate may not check. It is the only success
 * screen: an application a question rules out is stored as rejected and the
 * standard rejection letter follows, but nothing here, and nothing in that
 * letter, says an answer decided it. Naming one would hand the applicant the
 * rule they just broke, and the questions would stop being requirements.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const STEPS = ["about", "cv", "questions", "review"] as const;
type StepId = (typeof STEPS)[number];

const STEP_KEYS: Record<StepId, string> = {
  about: "apply.steps.about",
  cv: "apply.steps.cv",
  questions: "apply.steps.questions",
  review: "apply.steps.review",
};

/** "name, email and phone", in the grammar of the language on screen. */
function joinWords(locale: Locale, items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const arabic = locale === "ar";
  const head = items.slice(0, -1).join(arabic ? "، " : ", ");
  return `${head}${arabic ? " و" : " and "}${items[items.length - 1]}`;
}

export function ApplyWizard({ job }: { job: { id: string; title: string } }) {
  const locale = usePublicLocale();
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cvText, setCvText] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<string>("CAREER_SITE");

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** The About-you step's own picker, so a CV can be chosen where it is used. */
  const aboutFileInput = useRef<HTMLInputElement>(null);

  const [questions, setQuestions] = useState<PublicGateQuestion[] | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionsAttempt, setQuestionsAttempt] = useState(0);

  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeNote, setWriteNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  /** Which fields the candidate has typed in themselves. */
  const touched = useRef(new Set<"name" | "email" | "phone" | "about">());

  /* --------------------------------------------------------------- the steps */

  const [step, setStep] = useState(0);
  /** The furthest step reached, which is how far the rail lets a chip jump. */
  const [furthest, setFurthest] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  const here = STEPS[step];

  function goTo(index: number) {
    setStep(index);
    setStepError(null);
    setFurthest((current) => Math.max(current, index));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ------------------------------------------------------ viability questions */

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/careers/questions?jobId=${encodeURIComponent(job.id)}`,
          { cache: "no-store" }
        );
        const payload = (await response.json().catch(() => null)) as
          | { questions?: unknown }
          | null;

        if (!active) return;

        if (!response.ok || !Array.isArray(payload?.questions)) {
          // Render no questions rather than pretending the role has none: the
          // submit action reads the same rows and refuses an unanswered form, so
          // this state can only ever be an inconvenience, never a silent pass.
          setQuestions([]);
          setQuestionsError(t("apply.qLoadFailed"));
          return;
        }
        setQuestions(payload.questions as PublicGateQuestion[]);
      } catch {
        if (!active) return;
        setQuestions([]);
        setQuestionsError(t("apply.qLoadFailed"));
      }
    };

    void load();
    return () => {
      active = false;
    };
    // `t` follows the visitor's language; a language switch re-reads nothing,
    // because the questions are a recruiter's own sentences and arrive as filed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, questionsAttempt]);

  /** Back to the loading state, then read the questions again. */
  function retryQuestions() {
    setQuestions(null);
    setQuestionsError(null);
    setQuestionsAttempt((attempt) => attempt + 1);
  }

  /* --------------------------------------------------------------- the CV file */

  /**
   * Take a chosen CV, or refuse it in the words this form already uses.
   *
   * Returns the file it accepted, because the About-you step needs to write from
   * the file the second it is chosen — `setFile` has not landed by then, and a
   * draft request built from the stale state would go out with no file in it.
   */
  function pickFile(selected: File | null): File | null {
    setError(null);
    setStepError(null);
    setFillNote(null);
    setWriteNote(null);
    if (!selected) return null;

    if (!isAcceptedCvType(selected.type)) {
      setStepError(t("apply.err.fileType"));
      return null;
    }
    if (selected.size > CV_MAX_BYTES) {
      setStepError(t("apply.err.fileSize", { mb: CV_MAX_MB }));
      return null;
    }
    setFile(selected);
    return selected;
  }

  /**
   * Ask the same reader the screening step uses for the three fields the CV
   * already prints. Fields the candidate has typed are never written over: what
   * they chose to write beats anything inferred from their file, and the rest
   * stays editable for them to check — on the step behind this one.
   */
  async function fillFromCv() {
    if (!file) return;
    setFilling(true);
    setFillNote(null);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("jobId", job.id);

      const response = await fetch("/api/careers/prefill", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; details?: Partial<CvDetails> }
        | null;

      if (!response.ok) {
        setFillNote({
          tone: "bad",
          text:
            typeof payload?.error === "string" ? payload.error : t("apply.fill.failed"),
        });
        return;
      }

      const details = payload?.details ?? {};
      const fields: {
        key: "name" | "email" | "phone";
        wordKey: string;
        value: string | null | undefined;
        write: (next: string) => void;
      }[] = [
        { key: "name", wordKey: "apply.word.name", value: details.fullName, write: setFullName },
        { key: "email", wordKey: "apply.word.email", value: details.email, write: setEmail },
        { key: "phone", wordKey: "apply.word.phone", value: details.phone, write: setPhone },
      ];

      const written: string[] = [];
      const kept: string[] = [];
      const absent: string[] = [];

      for (const field of fields) {
        // Read at the moment the answer lands, not when the request started: a
        // candidate who typed while the model was thinking keeps what they typed.
        if (touched.current.has(field.key)) {
          kept.push(t(field.wordKey));
          continue;
        }
        if (!field.value) {
          absent.push(t(field.wordKey));
          continue;
        }
        field.write(field.value);
        written.push(t(field.wordKey));
      }

      const parts: string[] = [];
      if (written.length) parts.push(t("apply.fill.written", { fields: joinWords(locale, written) }));
      if (kept.length) parts.push(t("apply.fill.kept", { fields: joinWords(locale, kept) }));
      if (absent.length) parts.push(t("apply.fill.absent", { fields: joinWords(locale, absent) }));

      setFillNote({
        tone: written.length ? "ok" : "bad",
        text: parts.length ? parts.join(" ") : t("apply.fill.none"),
      });
    } catch {
      setFillNote({ tone: "bad", text: t("apply.fill.unreachable") });
    } finally {
      setFilling(false);
    }
  }

  /* ------------------------------------------------------------ About me box */

  /**
   * Ask for a draft of the "About me" box, from the profile link or the CV.
   *
   * Both of those already say who the candidate is, so the one field of this form
   * with no answer sitting in it need not be written from scratch. What comes back
   * goes into the box and stays there for them to read: their own words are never
   * written over, and nothing is filed until they submit it themselves.
   *
   * `attachment` is the file chosen on this step, handed over before `setFile`
   * lands. Without it the draft uses the CV attached on the CV step.
   */
  async function fillAboutMe(attachment?: File | null) {
    setWriting(true);
    setWriteNote(null);

    try {
      const body = new FormData();
      body.append("jobId", job.id);
      if (linkedinUrl.trim()) body.append("link", linkedinUrl.trim());
      const source = attachment ?? file;
      if (source) body.append("file", source);

      const response = await fetch("/api/careers/about-me", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; hint?: unknown; aboutMe?: unknown; sources?: unknown }
        | null;

      if (!response.ok || typeof payload?.aboutMe !== "string") {
        const reason =
          typeof payload?.error === "string" ? payload.error : t("apply.about.failed");
        const hint = typeof payload?.hint === "string" ? ` ${payload.hint}` : "";
        setWriteNote({ tone: "bad", text: `${reason}${hint}` });
        return;
      }

      // Read at the moment the draft lands, not when the request started: a
      // candidate who wrote while the model was thinking keeps what they wrote.
      if (touched.current.has("about")) {
        setWriteNote({ tone: "bad", text: t("apply.about.kept") });
        return;
      }

      setCvText(payload.aboutMe.slice(0, ABOUT_ME_MAX_CHARS));

      const from = (Array.isArray(payload.sources) ? payload.sources : [])
        .filter((name): name is "LINKEDIN" | "CV" => name === "LINKEDIN" || name === "CV")
        .map((name) => t(name === "LINKEDIN" ? "apply.word.linkedin" : "apply.word.cv"));

      setWriteNote({
        tone: "ok",
        text: from.length
          ? `${t("apply.about.written", { sources: joinWords(locale, from) })} ${t("apply.about.check")}`
          : t("apply.about.check"),
      });
    } catch {
      setWriteNote({ tone: "bad", text: t("apply.about.unreachable") });
    } finally {
      setWriting(false);
    }
  }

  /* ------------------------------------------------- the About-you draft door */

  /**
   * One button, two doors, chosen by what is already on the screen.
   *
   * A link in the LinkedIn field is something the candidate already pointed at, so
   * it is what gets read. With that field empty and no CV attached there is nothing
   * here to write from, so the same press opens the file picker rather than sitting
   * greyed out under a heading that promises a CV. The file chosen there *is* the
   * CV this application carries — the CV step shows the same one, not a second copy.
   */
  function askAboutMe() {
    if (linkedinUrl.trim() || file) {
      void fillAboutMe();
      return;
    }
    aboutFileInput.current?.click();
  }

  /** Choose the CV on this step, then write from it straight away. */
  function pickForAbout(selected: File | null) {
    const accepted = pickFile(selected);
    if (accepted) void fillAboutMe(accepted);
  }

  /* -------------------------------------------------------------- submitting */

  async function onSubmit() {
    setError(null);
    setPending(true);

    try {
      let cvFilePath: string | null = null;

      if (file) {
        const body = new FormData();
        body.append("file", file);
        body.append("jobId", job.id);

        const upload = await fetch("/api/careers/upload", { method: "POST", body });

        if (!upload.ok) {
          const detail = await upload.json().catch(() => null);
          setError(
            typeof detail?.error === "string" ? detail.error : t("apply.err.upload")
          );
          setPending(false);
          return;
        }

        const stored = await upload.json();
        cvFilePath = typeof stored?.path === "string" ? stored.path : null;
      }

      const response = await submitApplication({
        jobId: job.id,
        fullName,
        email,
        phone,
        cvText,
        linkedinUrl,
        cvFilePath,
        source,
        gateAnswers: answers,
      });

      if (response.ok) {
        setResult(response);
        // Best-effort: the code is displayed regardless, so a blocked clipboard
        // never costs the candidate their only handle.
        if (response.trackingCode) {
          void navigator.clipboard?.writeText(response.trackingCode).catch(() => {});
        }
      } else {
        setError(response.error ?? t("apply.err.failed"));
        // A refusal naming an unanswered question usually means the recruiter
        // added one while this form was open, or the step that lists them could
        // never load — so re-read the set and take the candidate back to it
        // rather than leave them submitting against questions they cannot see.
        retryQuestions();
        if (questionsError) goTo(STEPS.indexOf("questions"));
      }
    } catch {
      setError(t("apply.err.failed"));
    } finally {
      setPending(false);
    }
  }

  /* ------------------------------------------------------------------- success */

  // A submission without a tracking code would leave the candidate with no way
  // to follow their own application, so it is not treated as a success.
  if (result?.ok && result.trackingCode) {
    return <ReceivedPanel jobTitle={job.title} trackingCode={result.trackingCode} />;
  }

  /* ------------------------------------------------------------- per-step rules */

  function stepProblem(index: number): string | null {
    switch (STEPS[index]) {
      case "about":
        if (fullName.trim().length < 2) return t("apply.err.name");
        if (!EMAIL_PATTERN.test(email.trim())) return t("apply.err.email");
        // The same predicate the reader and the submit action apply, so a link the
        // step lets through is never refused further down.
        if (linkedinUrl.trim() && !profileLink(linkedinUrl)) return t("apply.err.link");
        return null;
      case "cv":
        // The same rule the action applies: a file, or enough pasted text to read.
        if (!file && cvText.trim().length < CV_TEXT_MIN_CHARS) return t("apply.err.cv");
        return null;
      case "questions":
        if (!questions) return null;
        return questions.some((question) => !answers[question.id])
          ? t("apply.err.questions")
          : null;
      default:
        return null;
    }
  }

  function next() {
    const problem = stepProblem(step);
    if (problem) {
      setStepError(problem);
      return;
    }
    if (here === "review") {
      void onSubmit();
      return;
    }
    goTo(step + 1);
  }

  /* --------------------------------------------------------------------- render */

  const loadingQuestions = here === "questions" && questions === null && !questionsError;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href={`/careers/${job.id}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink/55 transition hover:text-brand-ink"
      >
        <ArrowLeft className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
        {t("apply.exit")}
      </Link>

      <h1 className="mt-4 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
        {t("apply.title", { role: job.title })}
      </h1>
      <p className="mt-2 text-sm text-brand-ink/60">{t("apply.intro")}</p>

      {/* ---------------------------------------------------------------- rail */}
      <ol className="mt-6 flex flex-wrap items-center gap-2">
        {STEPS.map((id, index) => {
          const reached = index <= furthest;
          const current = index === step;
          return (
            <li key={id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => reached && goTo(index)}
                disabled={!reached}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition",
                  current
                    ? "border-brand-gold bg-brand-gold/20 text-brand-ink"
                    : reached
                      ? "border-brand-line bg-white text-brand-ink/65 hover:border-brand-gold/60"
                      : "cursor-not-allowed border-brand-line bg-brand-cream text-brand-ink/30"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                    index < step ? "bg-emerald-600 text-white" : "bg-brand-ink/10 text-brand-ink/70"
                  )}
                >
                  {index < step ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : index + 1}
                </span>
                {t(STEP_KEYS[id])}
              </button>
              {index < STEPS.length - 1 && (
                <span className="hidden h-px w-4 bg-brand-line sm:block" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-ink/40">
        {t("apply.stepOf", { step: step + 1, total: STEPS.length })}
      </p>

      {/* ---------------------------------------------------------------- card */}
      <div className="mt-4 rounded-2xl border border-brand-line bg-white p-6 shadow-soft sm:p-8">
        {here === "about" && (
          <AboutStep
            t={t}
            fullName={fullName}
            email={email}
            phone={phone}
            linkedinUrl={linkedinUrl}
            aboutMe={cvText}
            source={source}
            writing={writing}
            writeNote={writeNote}
            hasFile={file !== null}
            aboutFileInput={aboutFileInput}
            onName={(value) => {
              touched.current.add("name");
              setFullName(value);
            }}
            onEmail={(value) => {
              touched.current.add("email");
              setEmail(value);
            }}
            onPhone={(value) => {
              touched.current.add("phone");
              setPhone(value);
            }}
            onLink={(value) => {
              setLinkedinUrl(value);
              setWriteNote(null);
            }}
            onAboutMe={(value) => {
              touched.current.add("about");
              setCvText(value);
            }}
            onAsk={askAboutMe}
            onPickForAbout={pickForAbout}
            onSource={setSource}
          />
        )}

        {here === "cv" && (
          <CvStep
            t={t}
            file={file}
            hasAbout={cvText.trim().length >= CV_TEXT_MIN_CHARS}
            filling={filling}
            fillNote={fillNote}
            fileInput={fileInput}
            onPick={pickFile}
            onClear={() => {
              setFile(null);
              setFillNote(null);
              if (fileInput.current) fileInput.current.value = "";
            }}
            onFill={() => void fillFromCv()}
          />
        )}

        {here === "questions" && (
          <QuestionsStep
            t={t}
            questions={questions}
            loadError={questionsError}
            answers={answers}
            onAnswer={(id, option) =>
              setAnswers((current) => ({ ...current, [id]: option }))
            }
            onRetry={retryQuestions}
          />
        )}

        {here === "review" && (
          <ReviewStep
            t={t}
            locale={locale}
            fullName={fullName}
            email={email}
            phone={phone}
            linkedinUrl={linkedinUrl}
            source={source}
            file={file}
            cvText={cvText}
            questions={questions ?? []}
            questionsError={questionsError}
            answers={answers}
            onEdit={goTo}
          />
        )}

        {(stepError || error) && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {stepError ?? error}
          </p>
        )}

        {/* ---------------------------------------------------------------- nav */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-brand-line pt-5">
          <button
            type="button"
            onClick={() => goTo(Math.max(0, step - 1))}
            disabled={step === 0 || pending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line px-4 py-2.5 text-sm font-bold text-brand-ink/70 transition hover:bg-brand-cream disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
            {t("apply.back")}
          </button>

          <button
            type="button"
            onClick={next}
            disabled={pending || loadingQuestions}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {here === "review"
              ? pending
                ? t("apply.submitting")
                : t("apply.submit")
              : t("apply.next")}
            {here !== "review" && (
              <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
            )}
          </button>
        </div>

        {here === "review" && (
          <p className="mt-3 text-center text-[11px] leading-relaxed text-brand-ink/45">
            {t("apply.privacy")}
          </p>
        )}
      </div>
    </div>
  );
}
