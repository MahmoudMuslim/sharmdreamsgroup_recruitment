"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip, Upload, X } from "lucide-react";
import { submitApplication, type ApplyResult } from "./actions";

/**
 * Public application form.
 *
 * Two submission paths, because not every candidate has a PDF handy:
 *   • attach a file, uploaded to a private bucket readable only by staff;
 *   • or paste the CV text, which is also what AI screening reads.
 *
 * On success the tracking code is shown and copied to the clipboard — losing it
 * means losing access to the application, so it is surfaced prominently rather
 * than sent only to an email the candidate may not check.
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
  const trackingCode = result?.ok ? result.trackingCode : undefined;

  if (result?.ok && trackingCode) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
        <CheckCircle2 className="h-9 w-9 text-emerald-700" aria-hidden />

        <h2 className="mt-4 font-display text-2xl font-bold text-emerald-900">
          Application received
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">
          Thank you for applying for <strong>{jobTitle}</strong>. Our people team will
          review your application and contact you if there is a fit.
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