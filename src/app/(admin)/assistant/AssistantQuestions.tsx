"use client";

import {
  Check,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantQuestion } from "@/modules/assistant/domain/tools";

/**
 * The answer buttons for a question the assistant asked.
 *
 * Choosing sends that option as the next message, so the reply the model reads
 * is exactly what the recruiter picked — no id or index for it to reinterpret.
 * A question the conversation has moved past stays on screen, greyed and marked
 * with what was actually answered, so an old thread reads as a Q&A and not as a
 * list of open tasks.
 *
 * `showQuestion` prints the question above the buttons. The bubble normally
 * carries it, but a turn that asked twice or answered in prose before asking
 * has no copy of the second question outside this card — and a row of nameless
 * buttons is the thing that used to look broken.
 */
export function QuestionChoices({
  ask,
  showQuestion,
  live,
  answered,
  pending,
  onChoose,
}: {
  ask: AssistantQuestion;
  showQuestion: boolean;
  live: boolean;
  answered: string | null;
  pending: boolean;
  onChoose: (option: string) => void;
}) {
  return (
    <div className="mt-1.5">
      {showQuestion && (
        <p className="mb-1 text-[11px] font-bold leading-snug text-brand-ink">{ask.question}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {ask.options.map((option, index) => {
          const chosen = answered === option;
          return (
            <button
              key={`${option}-${index}`}
              type="button"
              disabled={!live || pending}
              onClick={() => onChoose(option)}
              title={
                live
                  ? `Answer: ${option}`
                  : answered
                    ? `Already answered: ${answered}`
                    : "Answered by a later message — click through the composer instead"
              }
              aria-disabled={!live || pending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-[11px] font-semibold transition",
                chosen
                  ? "border-brand-gold bg-brand-gold/20 text-brand-ink"
                  : live
                    ? "border-brand-line bg-white text-brand-ink/75 hover:border-brand-gold hover:bg-brand-gold/10"
                    : "border-brand-line/60 bg-brand-cream text-brand-ink/40"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  chosen ? "bg-brand-gold-dark text-brand-cream" : "bg-brand-sand text-brand-ink/60"
                )}
              >
                {chosen ? <Check className="h-2.5 w-2.5" aria-hidden /> : index + 1}
              </span>
              <span className="min-w-0">{option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The question as a bubble: its text, not the numbered list the model was fed. */
export function askBubble(ask: AssistantQuestion): string {
  return ask.context ? `${ask.context}\n\n${ask.question}` : ask.question;
}

/**
 * The notice for a live question that has no buttons.
 *
 * It happens for two reasons the recruiter cannot see: `ask_question` refused
 * the choices it was given, or the model wrote the question into its prose
 * instead of calling the tool. Either way the panel has nothing to click, and
 * saying so is the difference between a broken-looking chat and a question to
 * answer by typing.
 */
export function TypedAnswerNote() {
  return (
    <p className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-brand-ink/70">
      <Info className="mr-1 inline h-3 w-3 text-amber-700" aria-hidden />
      This question has no buttons — the choices the assistant tried to offer were not usable.
      Answer it in the box below.
    </p>
  );
}
