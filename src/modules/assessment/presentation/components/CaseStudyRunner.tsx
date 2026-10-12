"use client";

import { useEffect, useRef } from "react";
import { useAssessmentStore } from "@/stores/useAssessmentStore";
import type { AttemptQuestionClient } from "@/stores/useAssessmentStore";
import { cn } from "@/lib/utils";

interface CaseStudyRunnerProps {
  question: AttemptQuestionClient;
}

export function CaseStudyRunner({ question }: CaseStudyRunnerProps) {
  const answer = useAssessmentStore((state) => state.caseStudyAnswersMap[question.id] ?? "");
  const setAnswer = useAssessmentStore((state) => state.setCaseStudyAnswer);
  const syncDraft = useAssessmentStore((state) => state.syncDraftToSupabase);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const minWords = question.config.min_words ?? 200;
  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  return (
    <div className="space-y-4">
      {question.config.context && (
        <div className="rounded-xl border border-brand-gold/25 bg-brand-gold/5 p-4 text-sm leading-relaxed text-brand-ink/75">
          <span className="font-bold text-brand-gold-dark">Scenario context: </span>
          {question.config.context}
        </div>
      )}

      <label htmlFor={`answer-${question.id}`} className="sr-only">
        Your case study answer
      </label>
      <textarea
        id={`answer-${question.id}`}
        value={answer}
        onChange={(event) => {
          setAnswer(question.id, event.target.value);
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = setTimeout(() => void syncDraft(), 2000);
        }}
        rows={14}
        placeholder="Structure your answer: situation, options considered, decision, and justification…"
        className="w-full rounded-xl border border-brand-line bg-brand-cream p-4 text-sm leading-relaxed text-brand-ink placeholder:text-brand-ink/35 focus:border-brand-gold focus:bg-white focus:outline-none"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-semibold",
            wordCount >= minWords ? "text-emerald-700" : "text-brand-ink/50"
          )}
        >
          {wordCount} / {minWords} words minimum
        </span>
        <span className="flex items-center gap-1.5 text-brand-ink/45">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Autosaved
        </span>
      </div>
    </div>
  );
}
