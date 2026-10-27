"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Pencil,
  Sparkles,
} from "lucide-react";
import { submitApplication } from "../../actions";
import type { PublicGateQuestion } from "@/modules/careers/gate-questions";
import type { PersonFieldGroup } from "@/modules/candidates/domain/person-fields";
import { noticeFor } from "@/modules/candidates/domain/person-notice";
import { NEVER_ASKED_TYPES } from "@/modules/form-builder/domain/cvAnswers";
import type {
  PublicField,
  PublicForm,
  PublicStep,
} from "@/modules/form-builder/application/publicForm";
import { GRID_CLASS, SPAN_CLASS } from "@/modules/form-builder/domain/rowLayout";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { QuestionsStep } from "./ApplyQuestionsStep";
import { ReceivedPanel } from "./ApplyReceivedPanel";
import { joinWords } from "./joinWords";
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
 *
 * Each step is a six-column grid and every field carries the width the server
 * derived, so two half-width questions sit in one row on a desktop. On a phone
 * each one spans the whole grid: a narrow field is an arrangement, never a
 * smaller question.
 *
 * A step can also be answered from the CV the candidate already attached. The
 * bytes of that file are held in a ref, never re-picked, and one press sends them
 * to `/api/careers/form-prefill` with the keys this page has already answered, so
 * the model is asked only about what is still blank here. What comes back is
 * written into the blanks and nowhere else: a field the candidate touched is
 * theirs, and the door re-checks every answer against the field that asks for it.
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

/**
 * The questions on a step a CV could still answer.
 *
 * A heading asks nothing, an attachment is chosen not read, and a checkbox is a
 * declaration no model makes for anybody else — the server refuses those too,
 * from the same list, so the page never counts a blank the CV owes it nothing for.
 */
function answerableFields(entry: AuthoredStep, answers: Record<string, unknown>): PublicField[] {
  return entry.fields.filter(
    (field) => !NEVER_ASKED_TYPES.includes(field.type) && isBlank(answers[field.key]),
  );
}

/**
 * One authored step of the form: its consent boxes, its fields in the author's
 * widths, and the button that reads the attached CV into the blanks.
 *
 * A component rather than a render helper because its parent holds two refs the
 * CV read lives on — the bytes and the set of fields the candidate wrote in —
 * and a ref reached through a helper called during render is a value the render
 * cannot re-run on. Everything here arrives as props and every ref stays in the
 * wizard, touched only from a handler.
 */
function AuthoredStepCard({
  entry,
  answers,
  fieldErrors,
  uploads,
  consents,
  jobId,
  filling,
  fillNote,
  onFill,
  onFieldChange,
  onFile,
  onUploadResult,
  onConsent,
  t,
}: {
  entry: AuthoredStep;
  answers: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  uploads: Record<string, { uploadId: string; fileName: string }>;
  consents: Consents;
  jobId: string;
  filling: boolean;
  fillNote: { tone: "ok" | "bad"; text: string } | null;
  onFill: () => void;
  onFieldChange: (key: string, value: unknown) => void;
  onFile: (key: string, file: File | null) => void;
  onUploadResult: (key: string, uploadId: string | null, fileName: string | null) => void;
  onConsent: (group: PersonFieldGroup, agreed: boolean) => void;
  t: T;
}) {
  const hidden = declined(entry.consentGroups, consents);
  const blanks = hidden ? [] : answerableFields(entry, answers);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h2 className="font-display text-xl font-bold">
          {entry.heading ?? t("apply.dyn.formStep")}
        </h2>

        {blanks.length > 0 && (
          <button
            type="button"
            onClick={onFill}
            disabled={filling}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-brand-gold/60 bg-brand-sand/60 px-3.5 py-2 text-xs font-bold text-brand-ink transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
          >
            {filling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
            )}
            {filling ? t("apply.dyn.cvFillBusy") : t("apply.dyn.cvFillButton")}
          </button>
        )}
      </div>

      {blanks.length > 0 && !fillNote && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/45">
          {t("apply.dyn.cvFillNote")}
        </p>
      )}

      {fillNote && (
        <p
          role={fillNote.tone === "bad" ? "alert" : "status"}
          className={cn(
            "mt-2 text-[11px] leading-relaxed",
            fillNote.tone === "ok" ? "text-emerald-800" : "text-amber-800",
          )}
        >
          {fillNote.text}
        </p>
      )}

      {entry.consentGroups.map((group) => (
        <ConsentBox
          key={group}
          group={group}
          choice={consents[group]}
          onChoose={(agreed) => onConsent(group, agreed)}
          t={t}
        />
      ))}

      {hidden ? (
        <p className="mt-5 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-sm leading-relaxed text-brand-ink/60">
          {t("apply.dyn.declined")}
        </p>
      ) : (
        <div className={cn(GRID_CLASS, "gap-x-4 gap-y-5 sm:gap-x-5")}>
          {entry.fields.map((field) => (
            <div key={field.key} className={SPAN_CLASS[field.width]}>
              <FieldRenderer
                field={field}
                id={`field-${field.key}`}
                value={answers[field.key]}
                onChange={(value) => onFieldChange(field.key, value)}
                error={fieldErrors[field.key]}
                upload={{
                  jobId,
                  fieldKey: field.key,
                  uploadId: uploads[field.key]?.uploadId ?? null,
                  fileName: uploads[field.key]?.fileName ?? null,
                  onUploaded: (uploadId, fileName) => onUploadResult(field.key, uploadId, fileName),
                  // The CV is the file the candidate already has open, so the read
                  // reuses these bytes instead of asking for the file twice.
                  onFile: (file) => onFile(field.key, file),
                }}
                t={t}
              />
            </div>
          ))}
        </div>
      )}
    </>
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

  /**
   * The fields this candidate has written in themselves, however briefly.
   *
   * A ref, not state: nothing on screen depends on it, and a re-render on every
   * keystroke would be a second cost beside the one the field itself already pays.
   * It is read the moment the CV answers come back, so a candidate who typed while
   * the model was thinking keeps what they typed.
   */
  const touched = useRef<Set<string>>(new Set());

  /** The bytes of the last file attached on this page, for the CV read to reuse. */
  const cvFile = useRef<{ fieldKey: string; file: File } | null>(null);

  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

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
    setFillNote(null);
    setFurthest((current) => Math.max(current, next));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setAnswer(key: string, value: unknown) {
    touched.current.add(key);
    setAnswers((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setStepError(null);
  }

  /* --------------------------------------------------------------- the CV read */

  /**
   * Of this step's answerable blanks, the ones the candidate has not written in.
   *
   * A field typed into and then cleared is still theirs. Asked from the click,
   * where the ref holds what the candidate did up to this instant rather than what
   * an older render saw.
   */
  function fillable(entry: AuthoredStep): PublicField[] {
    return answerableFields(entry, answers).filter((field) => !touched.current.has(field.key));
  }

  /**
   * Ask what the attached CV says about the blanks on this step.
   *
   * The file is the one already attached here — held in a ref since the upload box
   * took it — so the candidate never picks it twice. Every other key on the form
   * goes up as `skip`, which is only ever a subtraction: the model is asked about
   * this page's blanks and nothing else, and a second press costs fewer tokens than
   * the first.
   *
   * Nothing is written over. The field errors stay as they are and the answers stay
   * editable, and a refusal from the door reads as an advice line under the button,
   * never as a red box on a field the candidate never touched.
   */
  async function fillFromCv(entry: AuthoredStep) {
    const source = cvFile.current?.file ?? null;
    if (!source) {
      setFillNote({ tone: "bad", text: t("apply.dyn.cvFillNoFile") });
      return;
    }

    const targets = fillable(entry);
    if (targets.length === 0) return;

    setFilling(true);
    setFillNote(null);

    try {
      const wanted = new Set(targets.map((field) => field.key));
      const body = new FormData();
      body.append("file", source);
      body.append("jobId", job.id);
      for (const stage of form.steps) {
        for (const field of stage.fields) {
          if (!wanted.has(field.key)) body.append("skip", field.key);
        }
      }

      const response = await fetch("/api/careers/form-prefill", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; answers?: Record<string, unknown> }
        | null;

      if (!response.ok) {
        setFillNote({
          tone: "bad",
          text: typeof payload?.error === "string" ? payload.error : t("apply.fill.failed"),
        });
        return;
      }

      const proposals = payload?.answers ?? {};
      const written: string[] = [];
      const kept: string[] = [];
      const absent: string[] = [];

      for (const field of targets) {
        // Read at the moment the answer lands, not when the request started: a
        // candidate who typed while the model was thinking keeps what they typed.
        if (touched.current.has(field.key)) {
          kept.push(field.label);
          continue;
        }
        if (proposals[field.key] === undefined) {
          absent.push(field.label);
          continue;
        }
        setAnswer(field.key, proposals[field.key]);
        written.push(field.label);
      }

      const parts: string[] = [];
      if (written.length) parts.push(t("apply.fill.written", { fields: joinWords(locale, written) }));
      if (kept.length) parts.push(t("apply.fill.kept", { fields: joinWords(locale, kept) }));
      if (absent.length) parts.push(t("apply.fill.absent", { fields: joinWords(locale, absent) }));

      // Every target landed in one of the three buckets, so an empty sentence here
      // is a bug, not a state to describe to the candidate. Say nothing instead.
      if (parts.length > 0) {
        setFillNote({ tone: written.length ? "ok" : "bad", text: parts.join(" ") });
      }
    } catch {
      setFillNote({ tone: "bad", text: t("apply.fill.unreachable") });
    } finally {
      setFilling(false);
    }
  }

  /**
   * The bytes the upload box took.
   *
   * Replacing an attachment replaces the stash; removing the one that is stashed is
   * the only removal that empties it.
   */
  function keepCvFile(fieldKey: string, file: File | null) {
    if (file) cvFile.current = { fieldKey, file };
    else if (cvFile.current?.fieldKey === fieldKey) cvFile.current = null;
  }

  /** Where an attachment's ledger id lands, and the error beside it clears. */
  function recordUploadResult(fieldKey: string, uploadId: string | null, fileName: string | null) {
    setUploads((current) => {
      const next = { ...current };
      if (uploadId && fileName) next[fieldKey] = { uploadId, fileName };
      else delete next[fieldKey];
      return next;
    });
    setFieldErrors((current) => {
      if (!(fieldKey in current)) return current;
      const next = { ...current };
      delete next[fieldKey];
      return next;
    });
  }

  function agreeConsent(group: PersonFieldGroup, agreed: boolean) {
    setConsents((current) => ({ ...current, [group]: agreed }));
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
          problems[field.key] = t(
            field.type === "photo" ? "apply.dyn.requiredPhoto" : "apply.dyn.requiredFile",
            { label: field.label },
          );
        }
        continue;
      }

      if (field.type === "checkbox") {
        if (field.required && answers[field.key] !== true) {
          problems[field.key] = t("apply.dyn.requiredTick", { label: field.label });
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
      <p className="mt-2 text-sm text-brand-ink/60">
        {t("apply.intro", { total: steps.length })}
      </p>

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
        {here.kind === "authored" && (
          <AuthoredStepCard
            entry={here}
            answers={answers}
            fieldErrors={fieldErrors}
            uploads={uploads}
            consents={consents}
            jobId={job.id}
            filling={filling}
            fillNote={fillNote}
            onFill={() => void fillFromCv(here)}
            onFieldChange={setAnswer}
            onFile={keepCvFile}
            onUploadResult={recordUploadResult}
            onConsent={agreeConsent}
            t={t}
          />
        )}

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
