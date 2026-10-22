"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useAssessmentStore } from "@/stores/useAssessmentStore";
import type { AttemptQuestionClient } from "@/stores/useAssessmentStore";
import { cn } from "@/lib/utils";

/**
 * A scene with several plausible responses and no single right answer.
 *
 * The runner deliberately looks like `QuizRunner` — one pick, the same radio
 * group, the same `choice_answers_map` — because the candidate's job is the
 * same shape. What differs is the sentence above the options: a quiz asks them
 * to find the correct answer, a judgment scene asks them to choose the response
 * they would most likely make. Saying so is the point of the type, so the
 * prompt is repeated here in the desk's voice rather than left to the header.
 *
 * The percentages the response earns live in the question's config and are
 * stripped by the attempt route before this component ever sees them. The
 * letters shown are display positions, not the stored `OPT_n` handles, so a
 * shuffled paper still reads A, B, C down the screen.
 */
interface SituationalRunnerProps {
  question: AttemptQuestionClient;
}

export function SituationalRunner({ question }: SituationalRunnerProps) {
  const selected = useAssessmentStore((state) => state.choiceAnswersMap[question.id]);
  const setChoiceAnswer = useAssessmentStore((state) => state.setChoiceAnswer);
  const syncDraft = useAssessmentStore((state) => state.syncDraft);

  const options = question.config.options ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-brand-ink/60">
        Choose the response you would most likely make. More than one may be
        reasonable — pick the one you think works best.
      </p>

      <div className="space-y-3" role="radiogroup" aria-label="Response options">
        {options.map((option, index) => {
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
                  {String.fromCharCode(65 + index)}.
                </span>
                {option.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
