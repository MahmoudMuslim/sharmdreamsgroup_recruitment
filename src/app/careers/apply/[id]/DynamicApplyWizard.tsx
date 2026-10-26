"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Pencil,
} from "lucide-react";
import { submitApplication } from "../../actions";
import type { PublicGateQuestion } from "@/modules/careers/gate-questions";
import type { PersonFieldGroup } from "@/modules/candidates/domain/person-fields";
import { noticeFor } from "@/modules/candidates/domain/person-notice";
import type {
  PublicField,
  PublicForm,
  PublicStep,
} from "@/modules/form-builder/application/publicForm";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { QuestionsStep } from "./ApplyQuestionsStep";
import { ReceivedPanel } from "./ApplyReceivedPanel";
import { FieldRenderer } from "./fields/FieldRenderer";
import { isBlank } from "./fields/FieldFrame";
import type { T } from "./fields/types";

/**
 * The authored application, one resolved step at a time (spec §5).
 *
 * The steps, their headings, their fields and the consent groups each step
 * first asks all arrive from the server's projection; this component never
 * resolves a layout and never sees a `system_key`. The gate-questions step and
 * the Review step are the two fixed steps: neither can be authored away, and
 * the two legal consents live only on Review.
 *
 * A group the candidate declines hides the step that asked it and is left out
 * of both the answers and the person write. Undefined is not a decline: the
 * box is a genuine choice, so a candidate who never touches it keeps seeing
 * the questions and simply records no consent.
 */

type AuthoredStep = {
  kind: "authored";
  key: string;
  heading: string | null;
  fields: PublicField[];
  consentGroups: PersonFieldGroup[];
};

type StepModel =
  | AuthoredStep
  | { kind: "gate"; key: "gate" }
  | { kind: "review"; key: "review" };

type Consents = Partial<Record<PersonFieldGroup, boolean>>;

function declined(groups: PersonFieldGroup[], consents: Consents): boolean {
  return groups.length > 0 && groups.every((group) => consents[group] === false);
}

function printable(
  field: PublicField,
  value: unknown,
  uploadName: string | null,
  t: T,
  locale: string,
): string {
  if (field.type === "file" || field.type === "photo") {
    return uploadName ?? t("apply.notSet");
  }
  if (isBlank(value)) return t("apply.notSet");

  switch (field.type) {
    case "checkbox":
      return value === true ? t("apply.dyn.yes") : t("apply.dyn.no");
    case "multi_select":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "duration": {
      const pair = value as { value?: unknown; unit?: unknown };
      return typeof pair.value === "number" && typeof pair.unit === "string"
        ? `${pair.value} ${pair.unit}`
        : String(value);
    }
    case "geolocation": {
      const pair = value as { lat?: unknown; lng?: unknown };
      return typeof pair.lat === "number" && typeof pair.lng === "number"
        ? `${pair.lat}, ${pair.lng}`
        : String(value);
    }
    case "address": {
      const parts = Object.values(value as Record<string, unknown>).filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      );
      return parts.join(", ");
    }
    case "datetime": {
      const moment = new Date(String(value));
      return Number.isNaN(moment.getTime()) ? String(value) : moment.toLocaleString(locale);
    }
    default:
      return String(value);
  }
}

function ConsentBox({
  group,
  choice,
  onChoose,
  t,
}: {
  group: PersonFieldGroup;
  choice: boolean | undefined;
  onChoose: (agreed: boolean) => void;
  t: T;
}) {
  const notice = noticeFor(group);

  const control = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-xs font-bold transition",
      active
        ? "border-brand-gold bg-brand-gold/20 text-brand-ink"
        : "border-brand-line bg-white text-brand-ink/65 hover:border-brand-gold/60",
    );

  return (
    <div className="mt-5 first-of-type:mt-5 rounded-xl border border-brand-line bg-brand-cream/50 px-4 py-4">
      <p className="text-xs font-bold">{notice.title}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/65">{notice.body}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/50">{notice.withdraw}</p>
      <p className="mt-2 text-[11px] font-semibold leading-relaxed text-brand-ink/55">
        {t("apply.dyn.consentNote")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={choice === true}
          onClick={() => onChoose(true)}
          className={control(choice === true)}
        >
          {t("apply.dyn.agree")}
        </button>
        <button
          type="button"
          aria-pressed={choice === false}
          onClick={() => onChoose(false)}
          className={control(choice === false)}
        >
          {t("apply.dyn.ratherNot")}
        </button>
      </div>
    </div>
  );
}

export function DynamicApplyWizard({
  form,
  job,
  referralCode,
  talentPoolMonths,
}: {
  form: PublicForm;
  job: { id: string; title: string };
  /** A staff member's code from the link, or null when the ad was opened directly. */
  referralCode: string | null;
  /** The window the talent-pool consent would run for, read from Settings. */
  talentPoolMonths: number;
}) {
  const locale = usePublicLocale();
  const t: T = (key, vars) => translate(locale, key, vars);

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [uploads, setUploads] = useState<Record<string, { uploadId: string; fileName: string }>>({});
  const [consents, setConsents] = useState<Consents>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [questions, setQuestions] = useState<PublicGateQuestion[] | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [questionsAttempt, setQuestionsAttempt] = useState(0);
  const [gateAnswers, setGateAnswers] = useState<Record<string, string>>({});

  const [processingConsent, setProcessingConsent] = useState(false);
  const [talentPoolConsent, setTalentPoolConsent] = useState(false);

  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<
    { ok: true; outcome: "received"; trackingCode: string } | null
  >(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/careers/questions?jobId=${encodeURIComponent(job.id)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => null)) as
          | { questions?: unknown }
          | null;

        if (!active) return;

        if (!response.ok || !Array.isArray(payload?.questions)) {
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
    // `t` follows the visitor's language; the fetch re-runs only for a new role
    // or an explicit retry, exactly as the legacy wizard does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, questionsAttempt]);

  function retryQuestions() {
    setQuestions(null);
    setQuestionsError(null);
    setQuestionsAttempt((attempt) => attempt + 1);
  }

  const gateVisible = questions === null || questions.length > 0 || questionsError !== null;

  const steps: StepModel[] = [
    ...form.steps.map(
      (entry, index): StepModel => ({
        kind: "authored",
        key: `form-${index}`,
        heading: entry.heading,
        fields: entry.fields,
        consentGroups: entry.consentGroups,
      }),
    ),
    ...(gateVisible ? [{ kind: "gate", key: "gate" } as StepModel] : []),
    { kind: "review", key: "review" },
  ];

  const index = Math.min(step, steps.length - 1);
  const here = steps[index];
  const gateLoading = questions === null;

  function goTo(target: number) {
    const next = Math.min(Math.max(0, target), steps.length - 1);
    setStep(next);
    setStepError(null);
    setFurthest((current) => Math.max(current, next));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setAnswer(key: string, value: unknown) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setStepError(null);
  }

  /* ------------------------------------------------------------ per-step rules */

  function authoredProblems(entry: AuthoredStep): Record<string, string> {
    if (declined(entry.consentGroups, consents)) return {};

    const problems: Record<string, string> = {};

    for (const field of entry.fields) {
      if (field.type === "section_heading") continue;

      if (field.type === "file" || field.type === "photo") {
        if (field.required && !uploads[field.key]) {
          problems[field.key] = t("apply.dyn.required", { label: field.label });
        }
        continue;
      }

      if (field.type === "checkbox") {
        if (field.required && answers[field.key] !== true) {
          problems[field.key] = t("apply.dyn.required", { label: field.label });
        }
        continue;
      }

      if (field.required && isBlank(answers[field.key])) {
        problems[field.key] = t("apply.dyn.required", { label: field.label });
        continue;
      }

      if (field.type === "url" && !isBlank(answers[field.key])) {
        let valid = false;
        try {
          const parsed = new URL(String(answers[field.key]));
          valid = parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          valid = false;
        }
        if (!valid) problems[field.key] = t("apply.dyn.badUrl");
      }
    }

    return problems;
  }

  function next() {
    if (pending) return;

    if (here.kind === "authored") {
      const problems = authoredProblems(here);
      if (Object.keys(problems).length > 0) {
        setFieldErrors(problems);
        setStepError(Object.values(problems)[0]);
        return;
      }
      setFieldErrors({});
      goTo(index + 1);
      return;
    }

    if (here.kind === "gate") {
      if (!questions) return;
      if (questions.some((question) => !gateAnswers[question.id])) {
        setStepError(t("apply.err.questions"));
        return;
      }
      setStepError(null);
      goTo(index + 1);
      return;
    }

    if (gateLoading) return;
    if (!processingConsent) {
      setStepError(t("apply.consent.required"));
      return;
    }
    void onSubmit();
  }

  /* --------------------------------------------------------------- submitting */

  async function onSubmit() {
    setError(null);
    setStepError(null);
    setPending(true);

    try {
      const hiddenKeys = new Set(
        form.steps
          .filter((entry) => declined(entry.consentGroups, consents))
          .flatMap((entry) => entry.fields.map((field) => field.key)),
      );

      const customAnswers: Record<string, unknown> = {};
      for (const entry of form.steps) {
        if (declined(entry.consentGroups, consents)) continue;
        for (const field of entry.fields) {
          if (field.type === "file" || field.type === "photo" || field.type === "section_heading") {
            continue;
          }
          if (answers[field.key] !== undefined) customAnswers[field.key] = answers[field.key];
        }
      }

      const personConsents: Record<string, boolean> = {};
      for (const [group, agreed] of Object.entries(consents)) {
        if (typeof agreed === "boolean") personConsents[group] = agreed;
      }

      const response = await submitApplication({
        // The legacy columns are filled by the server from the authored fields
        // bound to them; the wizard sends only the authored answers.
        jobId: job.id,
        fullName: "",
        email: "",
        phone: "",
        cvText: "",
        linkedinUrl: "",
        cvFilePath: null,
        source: referralCode ? "REFERRAL" : "CAREER_SITE",
        referralCode: referralCode ?? "",
        gateAnswers,
        processingConsent,
        talentPoolConsent,
        formUploads: Object.entries(uploads)
          .filter(([key]) => !hiddenKeys.has(key))
          .map(([, upload]) => ({ uploadId: upload.uploadId })),
        customAnswers,
        personConsents,
      });

      if (response.ok) {
        setResult(response);
        if (response.trackingCode) {
          void navigator.clipboard?.writeText(response.trackingCode).catch(() => {});
        }
        return;
      }

      setError(response.error ?? t("apply.err.failed"));

      if (response.fieldErrors && Object.keys(response.fieldErrors).length > 0) {
        setFieldErrors(response.fieldErrors);
        const first = Object.keys(response.fieldErrors)[0];
        const target = steps.findIndex(
          (entry) => entry.kind === "authored" && entry.fields.some((field) => field.key === first),
        );
        if (target >= 0) goTo(target);
      }

      if (response.error.includes("question")) {
        retryQuestions();
        const target = steps.findIndex((entry) => entry.kind === "gate");
        if (target >= 0) goTo(target);
      }
    } catch {
      setError(t("apply.err.failed"));
    } finally {
      setPending(false);
    }
  }

  /* ------------------------------------------------------------------- success */

  if (result?.ok && result.trackingCode) {
    return <ReceivedPanel jobTitle={job.title} trackingCode={result.trackingCode} />;
  }

  /* --------------------------------------------------------------------- render */

  function railLabel(entry: StepModel): string {
    if (entry.kind === "authored") return entry.heading ?? t("apply.dyn.formStep");
    return t(entry.kind === "gate" ? "apply.steps.questions" : "apply.steps.review");
  }

  function renderAuthored(entry: AuthoredStep) {
    const hidden = declined(entry.consentGroups, consents);

    return (
      <>
        <h2 className="font-display text-xl font-bold">
          {entry.heading ?? t("apply.dyn.formStep")}
        </h2>

        {entry.consentGroups.map((group) => (
          <ConsentBox
            key={group}
            group={group}
            choice={consents[group]}
            onChoose={(agreed) => {
              setConsents((current) => ({ ...current, [group]: agreed }));
              setStepError(null);
            }}
            t={t}
          />
        ))}

        {hidden ? (
          <p className="mt-5 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-sm leading-relaxed text-brand-ink/60">
            {t("apply.dyn.declined")}
          </p>
        ) : (
          entry.fields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              id={`field-${field.key}`}
              value={answers[field.key]}
              onChange={(value) => setAnswer(field.key, value)}
              error={fieldErrors[field.key]}
              upload={{
                jobId: job.id,
                fieldKey: field.key,
                uploadId: uploads[field.key]?.uploadId ?? null,
                fileName: uploads[field.key]?.fileName ?? null,
                onUploaded: (uploadId, fileName) => {
                  setUploads((current) => {
                    const next = { ...current };
                    if (uploadId && fileName) next[field.key] = { uploadId, fileName };
                    else delete next[field.key];
                    return next;
                  });
                  setFieldErrors((current) => {
                    if (!(field.key in current)) return current;
                    const next = { ...current };
                    delete next[field.key];
                    return next;
                  });
                },
              }}
              t={t}
            />
          ))
        )}
      </>
    );
  }

  function renderReview() {
    return (
      <div>
        <h2 className="font-display text-xl font-bold">{t("apply.reviewTitle")}</h2>
        <p className="mt-1 text-sm text-brand-ink/55">{t("apply.reviewNote")}</p>

        {form.steps.map((entry: PublicStep, stepIndex: number) => {
          if (declined(entry.consentGroups, consents)) return null;
          const rows = entry.fields.filter((field) => field.type !== "section_heading");
          if (rows.length === 0) return null;

          return (
            <section key={`review-${stepIndex}`} className="mt-5 first-of-type:mt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                  {entry.heading ?? t("apply.dyn.formStep")}
                </p>
                <button
                  type="button"
                  onClick={() => goTo(stepIndex)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-brand-gold-dark transition hover:bg-brand-cream"
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                  {t("apply.edit")}
                </button>
              </div>
              <dl className="mt-2 divide-y divide-brand-line rounded-xl border border-brand-line">
                {rows.map((field) => (
                  <div key={field.key} className="px-4 py-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                      {field.label}
                    </dt>
                    <dd className="mt-1 break-words text-sm text-brand-ink/80">
                      {printable(field, answers[field.key], uploads[field.key]?.fileName ?? null, t, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}

        {questions && questions.length > 0 && (
          <section className="mt-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
              {t("apply.reviewQuestions")}
            </p>
            <ul className="mt-2 space-y-2">
              {questions.map((question) => (
                <li key={question.id} className="rounded-xl border border-brand-line px-4 py-3">
                  <p className="text-xs font-bold text-brand-ink/70">{question.question}</p>
                  <p className="mt-1 text-sm text-brand-ink">
                    {gateAnswers[question.id] || t("apply.notSet")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <fieldset className="mt-5 rounded-xl border border-brand-line px-4 py-4">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
            {t("apply.consentHeading")}
          </legend>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={processingConsent}
              onChange={(event) => {
                setProcessingConsent(event.target.checked);
                setStepError(null);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-gold-dark"
            />
            <span className="text-sm leading-relaxed text-brand-ink/80">
              {t("apply.consent.processing")}
              <span className="mt-1 block text-xs text-brand-ink/50">
                {t("apply.consent.processingNote")}
              </span>
            </span>
          </label>

          <label className="mt-3 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={talentPoolConsent}
              onChange={(event) => setTalentPoolConsent(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-gold-dark"
            />
            <span className="text-sm leading-relaxed text-brand-ink/80">
              {t("apply.consent.pool", { months: talentPoolMonths })}
              <span className="mt-1 block text-xs text-brand-ink/50">
                {t("apply.consent.poolNote")}
              </span>
            </span>
          </label>
        </fieldset>
      </div>
    );
  }

  const waitingForGates = here.kind === "review" && gateLoading;

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
        {steps.map((entry, chipIndex) => {
          const reached = chipIndex <= furthest;
          const current = chipIndex === index;
          return (
            <li key={entry.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => reached && goTo(chipIndex)}
                disabled={!reached}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition",
                  current
                    ? "border-brand-gold bg-brand-gold/20 text-brand-ink"
                    : reached
                      ? "border-brand-line bg-white text-brand-ink/65 hover:border-brand-gold/60"
                      : "cursor-not-allowed border-brand-line bg-brand-cream text-brand-ink/30",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                    chipIndex < index
                      ? "bg-emerald-600 text-white"
                      : "bg-brand-ink/10 text-brand-ink/70",
                  )}
                >
                  {chipIndex < index ? (
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                  ) : (
                    chipIndex + 1
                  )}
                </span>
                <span className="max-w-[12rem] truncate">{railLabel(entry)}</span>
              </button>
              {chipIndex < steps.length - 1 && (
                <span className="hidden h-px w-4 bg-brand-line sm:block" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-ink/40">
        {t("apply.stepOf", { step: index + 1, total: steps.length })}
      </p>

      {/* ---------------------------------------------------------------- card */}
      <div className="mt-4 rounded-2xl border border-brand-line bg-white p-6 shadow-soft sm:p-8">
        {here.kind === "authored" && renderAuthored(here)}

        {here.kind === "gate" && (
          <QuestionsStep
            t={t}
            questions={questions}
            loadError={questionsError}
            answers={gateAnswers}
            onAnswer={(id, option) => {
              setGateAnswers((current) => ({ ...current, [id]: option }));
              setStepError(null);
            }}
            onRetry={retryQuestions}
          />
        )}

        {here.kind === "review" && renderReview()}

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
            onClick={() => goTo(index - 1)}
            disabled={index === 0 || pending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line px-4 py-2.5 text-sm font-bold text-brand-ink/70 transition hover:bg-brand-cream disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
            {t("apply.back")}
          </button>

          <button
            type="button"
            onClick={next}
            disabled={pending || waitingForGates || (here.kind === "gate" && gateLoading)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {here.kind === "review"
              ? pending
                ? t("apply.submitting")
                : t("apply.submit")
              : t("apply.next")}
            {here.kind !== "review" && (
              <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
            )}
          </button>
        </div>

        {here.kind === "review" && (
          <p className="mt-3 text-center text-[11px] leading-relaxed text-brand-ink/45">
            {t("apply.privacy")}{" "}
            <Link
              href="/privacy"
              className="font-bold text-brand-gold-dark underline-offset-2 hover:underline"
            >
              {t("apply.consent.privacyLink")}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
