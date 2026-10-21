"use client";

import {
  AlertTriangle,
  Loader2
} from "lucide-react";
import type { PublicGateQuestion } from "@/modules/careers/gate-questions";
import { StepHead, type T } from "./ApplyBits";

export function QuestionsStep({
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
