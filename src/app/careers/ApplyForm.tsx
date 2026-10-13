"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Loader2,
  Paperclip,
  Upload,
  X,
} from "lucide-react";
import { submitApplication, type ApplyResult } from "./actions";
import type { PublicGateQuestion } from "@/modules/careers/gate-questions";

/**
 * Public application form.
 *
 * Two submission paths, because not every candidate has a PDF handy:
 *   • attach a file, uploaded to a private bucket readable only by staff;
 *   • or paste the CV text, which is also what AI screening reads.
 *
 * Above that sit the viability questions a recruiter authors for this role — no
 * points, just requirements the applicant answers about themselves. They are
 * fetched rather than rendered on the page, because the page itself is
 * prerendered and its job payload is cached; see /api/careers/questions.
 *
 * On success the tracking code is shown and copied to the clipboard — losing it
 * means losing access to the application, so it is surfaced prominently rather
 * than sent only to an email the candidate may not check. An application that a
 * question rules out gets a separate, polite panel instead: it is stored as
 * rejected, and saying so plainly is kinder than a thank-you note that hides it.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

export function ApplyForm({
  jobId,
  jobTitle,
}: {
  jobId: string;
  jobTitle: string;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cvText, setCvText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("CAREER_SITE");

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [questions, setQuestions] = useState<PublicGateQuestion[] | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionsAttempt, setQuestionsAttempt] = useState(0);

  /* ------------------------------------------------------ viability questions */

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/careers/questions?jobId=${encodeURIComponent(jobId)}`,
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
          setQuestionsError("We could not load this role's application questions.");
          return;
        }
        setQuestions(payload.questions as PublicGateQuestion[]);
      } catch {
        if (!active) return;
        setQuestions([]);
        setQuestionsError("We could not load this role's application questions.");
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [jobId, questionsAttempt]);

  /** Back to the loading state, then read the questions again. */
  function retryQuestions() {
    setQuestions(null);
    setQuestionsError(null);
    setQuestionsAttempt((attempt) => attempt + 1);
  }

  function pickFile(selected: File | null) {
    setError(null);
    if (!selected) return;

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError("Attach a PDF, Word document or plain-text CV.");
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError("That file is larger than 5 MB. Please attach a smaller CV.");
      return;
    }
    setFile(selected);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      let cvFilePath: string | null = null;

      if (file) {
        const body = new FormData();
        body.append("file", file);
        body.append("jobId", jobId);

        const upload = await fetch("/api/careers/upload", {
          method: "POST",
          body,
        });

        if (!upload.ok) {
          const detail = await upload.json().catch(() => null);
          setError(
            typeof detail?.error === "string"
              ? detail.error
              : "We could not attach your CV. Try pasting your CV text instead."
          );
          setPending(false);
          return;
        }

        const stored = await upload.json();
        cvFilePath = typeof stored?.path === "string" ? stored.path : null;
      }

      const response = await submitApplication({
        jobId,
        fullName,
        email,
        phone,
        cvText,
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
        setError(response.error ?? "Your application could not be submitted.");
        // A refusal naming an unanswered question usually means the recruiter
        // added one while this form was open, so re-read the set rather than
        // leave the candidate submitting against a list they cannot see.
        retryQuestions();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  /* ---------------------------------------------------------------- success */

  // A submission without a tracking code would leave the candidate with no way
  // to follow their own application, so it is not treated as a success.
  if (result?.ok && result.trackingCode) {
    return result.outcome === "not-selected" ? (
      <NotSelectedPanel jobTitle={jobTitle} trackingCode={result.trackingCode} />
    ) : (
      <ReceivedPanel jobTitle={jobTitle} trackingCode={result.trackingCode} />
    );
  }

  /* ------------------------------------------------------------------- form */

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-brand-line bg-white p-6 shadow-soft sm:p-8"
    >
      <h2 className="font-display text-xl font-bold">Apply for this role</h2>
      <p className="mt-1 text-sm text-brand-ink/55">
        All fields marked with an asterisk are required.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="apply-name" className="mb-1.5 block text-xs font-bold">
            Full name <span className="ml-1 text-rose-600">*</span>
          </label>
          <input
            id="apply-name"
            required
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
            placeholder="Youssef El-Sayed"
          />
        </div>

        <div>
          <label htmlFor="apply-email" className="mb-1.5 block text-xs font-bold">
            Email <span className="ml-1 text-rose-600">*</span>
          </label>
          <input
            id="apply-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="apply-phone" className="mb-1.5 block text-xs font-bold">
            Phone
          </label>
          <input
            id="apply-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
            placeholder="+20 100 000 0000"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="apply-source" className="mb-1.5 block text-xs font-bold">
            How did you hear about us?
          </label>
          <select
            id="apply-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
          >
            <option value="CAREER_SITE">This careers site</option>
            <option value="JOB_BOARD">A job board</option>
            <option value="REFERRAL">A referral</option>
          </select>
        </div>
      </div>

      {/* ------------------------------------------------- viability questions */}
      {questions === null && !questionsError && (
        <p className="mt-6 flex items-center gap-2 text-xs text-brand-ink/45">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading the application questions for this role…
        </p>
      )}

      {questionsError && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-amber-800">{questionsError}</p>
            <button
              type="button"
              onClick={retryQuestions}
              className="mt-1 text-xs font-bold text-amber-900 underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {questions && questions.length > 0 && (
        <div className="mt-6 rounded-xl border border-brand-line bg-brand-sand/40 p-4 sm:p-5">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/55">
            Before you apply
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
            A few requirements for this role, asked of everyone who applies. Please answer each one
            — they decide whether we are able to consider your application.
          </p>

          {questions.map((question, index) => (
            <fieldset key={question.id} className="mt-4">
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
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))
                      }
                      className="h-4 w-4 shrink-0 accent-brand-gold-dark"
                    />
                    <span className="min-w-0">{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------- CV file */}
      <div className="mt-6">
        <span className="mb-1.5 block text-xs font-bold">Attach your CV</span>

        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
            <Paperclip className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <span className="shrink-0 text-xs text-brand-ink/45">
              {(file.size / 1024).toFixed(0)} KB
            </span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
              aria-label="Remove attached CV"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-line bg-brand-cream px-4 py-6 text-center transition hover:border-brand-gold/50 hover:bg-brand-sand">
            <Upload className="h-5 w-5 text-brand-gold-dark" aria-hidden />
            <span className="mt-2 text-sm font-semibold">Choose a file</span>
            <span className="mt-0.5 text-xs text-brand-ink/45">
              PDF, Word or text — up to 5 MB
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </div>

      {/* --------------------------------------------------------- CV text */}
      <div className="mt-4">
        <label htmlFor="apply-cv" className="mb-1.5 block text-xs font-bold">
          Or paste your CV text
        </label>
        <textarea
          id="apply-cv"
          rows={7}
          value={cvText}
          onChange={(e) => setCvText(e.target.value)}
          className="w-full resize-y rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
          placeholder="Paste the text of your CV here…"
        />
        <p className="mt-1 text-[11px] text-brand-ink/45">
          A file or pasted text is required — this is what the screening step reads.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-6 py-3.5 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {pending ? "Submitting…" : "Submit application"}
      </button>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-brand-ink/45">
        We store your details to process this application only. You will receive a tracking
        code on the next screen.
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ panels */

/** Every question answered acceptably: the application now waits on a person. */
function ReceivedPanel({
  jobTitle,
  trackingCode,
}: {
  jobTitle: string;
  trackingCode: string;
}) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
      <CheckCircle2 className="h-9 w-9 text-emerald-700" aria-hidden />

      <h2 className="mt-4 font-display text-2xl font-bold text-emerald-900">
        Application received
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-emerald-800">
        Thank you for applying for <strong>{jobTitle}</strong>. Our people team will review
        your application and contact you if there is a fit.
      </p>

      <div className="mt-6 rounded-xl border border-emerald-300 bg-white p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
          Your tracking code
        </p>
        <p className="mt-2 select-all font-mono text-2xl font-bold tracking-wider text-brand-ink">
          {trackingCode}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-brand-ink/60">
          Save this now — we have also copied it to your clipboard. Use it on the tracking
          page to follow your application at any time. Without it we cannot show you your
          progress.
        </p>
        <a
          href={`/portal?code=${encodeURIComponent(trackingCode)}`}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
        >
          Track this application
        </a>
      </div>
    </div>
  );
}

/**
 * A viability answer ruled the application out, and it is said plainly.
 *
 * The polite alternative — the same "we will contact you if there is a fit" the
 * accepted candidates get, to someone who will never be reviewed — is the version
 * of this screen that is easy to write and unkind to receive. The row is stored
 * and stays trackable, so a candidate who mis-clicked can still ask about it.
 *
 * It deliberately does not name the question: which answer the role accepts is
 * kept server-side, and the requirement itself is in the advert.
 */
function NotSelectedPanel({
  jobTitle,
  trackingCode,
}: {
  jobTitle: string;
  trackingCode: string;
}) {
  return (
    <div className="rounded-2xl border border-brand-line bg-brand-cream p-6 sm:p-8">
      <Inbox className="h-9 w-9 text-brand-gold-dark" aria-hidden />

      <h2 className="mt-4 font-display text-2xl font-bold">Thank you for applying</h2>
      <p className="mt-2 text-sm leading-relaxed text-brand-ink/70">
        We are not able to move your application for <strong>{jobTitle}</strong> forward,
        because your answers to our application questions do not meet a requirement this role
        has.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-brand-ink/70">
        That is about the requirements of the role, not about you. If one of your answers was a
        mistake, or your situation changes, you are welcome to apply again — this application
        does not block a new one.
      </p>

      <div className="mt-6 rounded-xl border border-brand-line bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45">
          Your reference
        </p>
        <p className="mt-2 select-all font-mono text-lg font-bold tracking-wider text-brand-ink">
          {trackingCode}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-brand-ink/55">
          Your application and your answers are kept on record. Use this code on the tracking
          page to see where it stands.
        </p>
        <a
          href={`/portal?code=${encodeURIComponent(trackingCode)}`}
          className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-brand-ink underline"
        >
          Track this application
        </a>
      </div>
    </div>
  );
}