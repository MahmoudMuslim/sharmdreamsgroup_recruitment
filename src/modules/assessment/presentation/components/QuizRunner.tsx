"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useAssessmentStore } from "@/stores/useAssessmentStore";
import type { AttemptQuestionClient } from "@/stores/useAssessmentStore";
import { cn } from "@/lib/utils";

interface QuizRunnerProps {
  question: AttemptQuestionClient;
}

export function QuizRunner({ question }: QuizRunnerProps) {
  const selected = useAssessmentStore((state) => state.choiceAnswersMap[question.id]);
  const setChoiceAnswer = useAssessmentStore((state) => state.setChoiceAnswer);
  const syncDraft = useAssessmentStore((state) => state.syncDraftToSupabase);

  const options = question.config.options ?? [];

  return (
    <div className="space-y-3" role="radiogroup" aria-label="Answer options">
      {options.map((option) => {
        const isSelected = selected === option.label;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => {
              setChoiceAnswer(question.id, option.label);
              void syncDraft();
            }}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm leading-relaxed transition",
              isSelected
                ? "border-brand-gold bg-brand-gold/10 text-brand-ink"
                : "border-brand-line bg-brand-cream text-brand-ink/75 hover:border-brand-gold/40 hover:bg-brand-sand"
            )}
          >
            {isSelected ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-dark" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink/25" aria-hidden />
            )}
            <span>
              <span className="mr-2 font-display font-bold text-brand-gold-dark">
                {option.label}.
              </span>
              {option.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}
