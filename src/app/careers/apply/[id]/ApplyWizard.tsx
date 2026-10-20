"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Paperclip,
  Pencil,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { submitApplication, type ApplyResult } from "../../actions";
import {
  ABOUT_ME_MAX_CHARS,
  CV_MAX_BYTES,
  CV_MAX_MB,
  CV_TEXT_MIN_CHARS,
  isAcceptedCvType,
  profileLink,
} from "@/modules/careers/cv-rules";
import type { CvDetails } from "@/modules/careers/cv-details";
import type { PublicGateQuestion } from "@/modules/careers/gate-questions";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";
import type { Locale } from "@/types";
import { cn } from "@/lib/utils";

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

/** Candidate-set sources only — the action refuses anything else. */
const SOURCES = [
  { value: "CAREER_SITE", key: "apply.source.site" },
  { value: "JOB_BOARD", key: "apply.source.board" },
  { value: "REFERRAL", key: "apply.source.referral" },
] as const;

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

/* --------------------------------------------------------------------- steps */

type T = (key: string, vars?: Record<string, string | number>) => string;

const FIELD =
  "w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none";

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold">
      {children}
    </label>
  );
}

/**
 * A step's heading, with the one control that belongs to the whole step sitting on
 * its right. The About-you draft button lives here because it writes from anything
 * on the step, not from the box under it — and a candidate looking for the CV door
 * finds it at the top, beside the words they are being asked to fill.
 */
function StepHead({
  title,
  note,
  action,
}: {
  title: string;
  note: string;
  action?: ReactNode;
}) {
  const head = (
    <>
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-brand-ink/55">{note}</p>
    </>
  );

  if (!action) return head;

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">{head}</div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function AboutStep({
  t,
  fullName,
  email,
  phone,
  linkedinUrl,
  aboutMe,
  source,
  writing,
  writeNote,
  hasFile,
  aboutFileInput,
  onName,
  onEmail,
  onPhone,
  onLink,
  onAboutMe,
  onAsk,
  onPickForAbout,
  onSource,
}: {
  t: T;
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  aboutMe: string;
  source: string;
  writing: boolean;
  writeNote: { tone: "ok" | "bad"; text: string } | null;
  hasFile: boolean;
  aboutFileInput: React.RefObject<HTMLInputElement | null>;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onLink: (value: string) => void;
  onAboutMe: (value: string) => void;
  onAsk: () => void;
  onPickForAbout: (file: File | null) => void;
  onSource: (value: string) => void;
}) {
  // The same predicate the reader and the submit action use, so the sentence under
  // the field cannot promise a read of a link nothing will fetch.
  const readableLink = profileLink(linkedinUrl);
  const canWrite = readableLink !== null || hasFile;

  return (
    <div>
      <StepHead
        title={t("apply.aboutTitle")}
        note={t("apply.aboutNote")}
        action={
          <>
            <button
              type="button"
              onClick={onAsk}
              disabled={writing}
              title={t("apply.aboutFillNote", { mb: CV_MAX_MB })}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/60 bg-brand-sand/60 px-3.5 py-2 text-xs font-bold text-brand-ink transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {writing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
              )}
              {writing ? t("apply.aboutFilling") : t("apply.aboutFill")}
            </button>

            {/* Driven by the button above, so it stays out of the tab order — but it
                is still named, because the picker the operating system draws shows
                nothing but this label. */}
            <input
              ref={aboutFileInput}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              aria-label={t("apply.aboutPick")}
              tabIndex={-1}
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                // Cleared so the same file can be chosen again after a refusal.
                event.target.value = "";
                onPickForAbout(selected);
              }}
            />
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="apply-name">
            {t("apply.name")} <span className="ml-1 text-rose-600">*</span>
          </Label>
          <input
            id="apply-name"
            required
            autoComplete="name"
            value={fullName}
            onChange={(event) => onName(event.target.value)}
            className={FIELD}
            placeholder={t("apply.namePlaceholder")}
          />
        </div>

        <div>
          <Label htmlFor="apply-email">
            {t("apply.email")} <span className="ml-1 text-rose-600">*</span>
          </Label>
          <input
            id="apply-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => onEmail(event.target.value)}
            className={FIELD}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <Label htmlFor="apply-phone">{t("apply.phone")}</Label>
          <input
            id="apply-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => onPhone(event.target.value)}
            className={FIELD}
            placeholder={t("apply.phonePlaceholder")}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="apply-linkedin">
            {t("apply.linkedin")}{" "}
            <span className="ml-1 font-normal text-brand-ink/40">{t("apply.optional")}</span>
          </Label>
          <input
            id="apply-linkedin"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={linkedinUrl}
            onChange={(event) => onLink(event.target.value)}
            className={FIELD}
            placeholder={t("apply.linkedinPlaceholder")}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
            {t("apply.linkedinNote")}
          </p>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="apply-about">{t("apply.aboutMe")}</Label>
          <textarea
            id="apply-about"
            rows={7}
            maxLength={ABOUT_ME_MAX_CHARS}
            value={aboutMe}
            onChange={(event) => onAboutMe(event.target.value)}
            className={cn(FIELD, "resize-y")}
            placeholder={t("apply.aboutMePlaceholder")}
          />

          <div className="mt-2">
            {writeNote && (
              <p
                role={writeNote.tone === "bad" ? "alert" : "status"}
                className={cn(
                  "mt-2 text-[11px] leading-relaxed",
                  writeNote.tone === "ok" ? "text-emerald-800" : "text-amber-800"
                )}
              >
                {writeNote.text}
              </p>
            )}

            {!canWrite && !writeNote && (
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
                {t("apply.about.noSource")}
              </p>
            )}

            <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
              {t("apply.aboutMeNote")}
            </p>
          </div>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="apply-source">{t("apply.source")}</Label>
          <select
            id="apply-source"
            value={source}
            onChange={(event) => onSource(event.target.value)}
            className={FIELD}
          >
            {SOURCES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function CvStep({
  t,
  file,
  hasAbout,
  filling,
  fillNote,
  fileInput,
  onPick,
  onClear,
  onFill,
}: {
  t: T;
  file: File | null;
  /** Whether the About-you box already holds enough to review them by. */
  hasAbout: boolean;
  filling: boolean;
  fillNote: { tone: "ok" | "bad"; text: string } | null;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void;
  onClear: () => void;
  onFill: () => void;
}) {
  return (
    <div>
      <StepHead title={t("apply.cvTitle")} note={t("apply.cvNote")} />

      <div className="mt-6">
        <span className="mb-1.5 block text-xs font-bold">{t("apply.cvAttach")}</span>

        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
            <Paperclip className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <span className="shrink-0 text-xs text-brand-ink/45">
              {(file.size / 1024).toFixed(0)} KB
            </span>
            <button
              type="button"
              onClick={onClear}
              aria-label={t("apply.cvRemove")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-line bg-brand-cream px-4 py-6 text-center transition hover:border-brand-gold/50 hover:bg-brand-sand">
            <Upload className="h-5 w-5 text-brand-gold-dark" aria-hidden />
            <span className="mt-2 text-sm font-semibold">{t("apply.cvChoose")}</span>
            <span className="mt-0.5 text-xs text-brand-ink/45">
              {t("apply.cvTypes", { mb: CV_MAX_MB })}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              className="sr-only"
              onChange={(event) => onPick(event.target.files?.[0] ?? null)}
            />
          </label>
        )}

        {file && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onFill}
              disabled={filling}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/60 bg-brand-sand/60 px-3.5 py-2 text-xs font-bold text-brand-ink transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {filling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
              )}
              {filling ? t("apply.cvFilling") : t("apply.cvFill")}
            </button>

            {fillNote && (
              <p
                role={fillNote.tone === "bad" ? "alert" : "status"}
                className={cn(
                  "mt-2 text-[11px] leading-relaxed",
                  fillNote.tone === "ok" ? "text-emerald-800" : "text-amber-800"
                )}
              >
                {fillNote.text} {fillNote.tone === "ok" && t("apply.cvFillCheck")}
              </p>
            )}

            <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
              {t("apply.cvFillNote")}
            </p>
          </div>
        )}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-brand-ink/45">
        {hasAbout ? t("apply.cvHasAbout") : t("apply.cvNoAbout")}
      </p>
    </div>
  );
}

function QuestionsStep({
  t,
  questions,
  loadError,
  answers,
  onAnswer,
  onRetry,
}: {
  t: T;
  questions: PublicGateQuestion[] | null;
  loadError: string | null;
  answers: Record<string, string>;
  onAnswer: (id: string, option: string) => void;
  onRetry: () => void;
}) {
  if (questions === null && !loadError) {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-ink/45">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("apply.qLoading")}
      </p>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-amber-800">{loadError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-xs font-bold text-amber-900 underline"
          >
            {t("apply.qRetry")}
          </button>
        </div>
      </div>
    );
  }

  const list = questions ?? [];

  if (list.length === 0) {
    return (
      <div>
        <StepHead title={t("apply.qTitle")} note={t("apply.qNone")} />
      </div>
    );
  }

  return (
    <div>
      <StepHead title={t("apply.qTitle")} note={t("apply.qNote")} />

      {list.map((question, index) => (
        <fieldset key={question.id} className="mt-5 first-of-type:mt-4">
          <legend className="text-xs font-bold">
            {index + 1}. {question.question} <span className="ml-1 text-rose-600">*</span>
          </legend>
          {question.helpText && (
            <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/50">
              {question.helpText}
            </p>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {question.options.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm transition hover:border-brand-gold"
              >
                <input
                  type="radio"
                  name={`gate-${question.id}`}
                  value={option}
                  required
                  checked={answers[question.id] === option}
                  onChange={(event) => onAnswer(question.id, event.target.value)}
                  className="h-4 w-4 shrink-0 accent-brand-gold-dark"
                />
                <span className="min-w-0">{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
  editLabel,
}: {
  label: string;
  value: React.ReactNode;
  onEdit: () => void;
  editLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
          {label}
        </p>
        <div className="mt-1 break-words text-sm text-brand-ink/80">{value}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-brand-gold-dark transition hover:bg-brand-cream"
      >
        <Pencil className="h-3 w-3" aria-hidden />
        {editLabel}
      </button>
    </div>
  );
}

function ReviewStep({
  t,
  locale,
  fullName,
  email,
  phone,
  linkedinUrl,
  source,
  file,
  cvText,
  questions,
  questionsError,
  answers,
  onEdit,
}: {
  t: T;
  locale: Locale;
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  source: string;
  file: File | null;
  cvText: string;
  questions: PublicGateQuestion[];
  questionsError: string | null;
  answers: Record<string, string>;
  onEdit: (index: number) => void;
}) {
  const sourceKey = SOURCES.find((option) => option.value === source)?.key;
  const written = cvText.trim().length;

  return (
    <div>
      <StepHead title={t("apply.reviewTitle")} note={t("apply.reviewNote")} />

      <dl className="mt-5 divide-y divide-brand-line rounded-xl border border-brand-line">
        <ReviewRow
          label={t("apply.reviewName")}
          value={fullName.trim() || t("apply.notSet")}
          onEdit={() => onEdit(0)}
          editLabel={t("apply.edit")}
        />
        <ReviewRow
          label={t("apply.reviewEmail")}
          value={email.trim() || t("apply.notSet")}
          onEdit={() => onEdit(0)}
          editLabel={t("apply.edit")}
        />
        <ReviewRow
          label={t("apply.reviewPhone")}
          value={phone.trim() || t("apply.notSet")}
          onEdit={() => onEdit(0)}
          editLabel={t("apply.edit")}
        />
        <ReviewRow
          label={t("apply.reviewLink")}
          value={linkedinUrl.trim() || t("apply.notSet")}
          onEdit={() => onEdit(0)}
          editLabel={t("apply.edit")}
        />
        <ReviewRow
          label={t("apply.reviewSource")}
          value={sourceKey ? t(sourceKey) : source}
          onEdit={() => onEdit(0)}
          editLabel={t("apply.edit")}
        />
        <ReviewRow
          label={t("apply.reviewAbout")}
          value={
            written
              ? t("apply.reviewWritten", { count: written.toLocaleString(locale) })
              : t("apply.notSet")
          }
          onEdit={() => onEdit(0)}
          editLabel={t("apply.edit")}
        />
        <ReviewRow
          label={t("apply.reviewCv")}
          value={
            file
              ? t("apply.reviewFile", { name: file.name })
              : written
                ? t("apply.reviewCvFromAbout")
                : t("apply.notSet")
          }
          onEdit={() => onEdit(1)}
          editLabel={t("apply.edit")}
        />
      </dl>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
            {t("apply.reviewQuestions")}
          </p>
          <button
            type="button"
            onClick={() => onEdit(2)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-brand-gold-dark transition hover:bg-brand-cream"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            {t("apply.edit")}
          </button>
        </div>

        {questionsError ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
            {t("apply.qWarnReview")}
          </p>
        ) : questions.length === 0 ? (
          <p className="mt-2 text-sm text-brand-ink/55">{t("apply.qNone")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {questions.map((question) => (
              <li key={question.id} className="rounded-xl border border-brand-line px-4 py-3">
                <p className="text-xs font-bold text-brand-ink/70">{question.question}</p>
                <p className="mt-1 text-sm text-brand-ink">
                  {answers[question.id] || t("apply.notSet")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- panels */

/** Every question answered acceptably: the application now waits on a person. */
function ReceivedPanel({
  jobTitle,
  trackingCode,
}: {
  jobTitle: string;
  trackingCode: string;
}) {
  const locale = usePublicLocale();
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
        <CheckCircle2 className="h-9 w-9 text-emerald-700" aria-hidden />

        <h1 className="mt-4 font-display text-2xl font-bold text-emerald-900">
          {t("apply.doneTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">
          {t("apply.doneBody", { role: jobTitle })}
        </p>

        <div className="mt-6 rounded-xl border border-emerald-300 bg-white p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
            {t("apply.doneCode")}
          </p>
          <p className="mt-2 select-all font-mono text-2xl font-bold tracking-wider text-brand-ink">
            {trackingCode}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-brand-ink/60">
            {t("apply.doneCodeNote")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`/portal?code=${encodeURIComponent(trackingCode)}`}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
            >
              {t("apply.doneTrack")}
            </a>
            <Link
              href="/careers"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-line px-5 py-2.5 text-sm font-bold text-brand-ink/70 transition hover:bg-brand-cream"
            >
              {t("apply.doneBack")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
