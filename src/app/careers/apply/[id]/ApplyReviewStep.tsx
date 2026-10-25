"use client";

import {
  Pencil
} from "lucide-react";
import type { PublicGateQuestion } from "@/modules/careers/gate-questions";
import type { Locale } from "@/types";
import { sourceKey, StepHead, type T } from "./ApplyBits";

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

export function ReviewStep({
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
  const key = sourceKey(source);
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
          value={key ? t(key) : source}
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
