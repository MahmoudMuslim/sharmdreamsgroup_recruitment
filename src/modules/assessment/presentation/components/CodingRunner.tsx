"use client";

import { useEffect, useRef } from "react";
import { CODE_ANSWER_CAP, codingLanguageOf } from "@/modules/assessment/domain/coding";
import { useAssessmentStore } from "@/stores/useAssessmentStore";
import type { AttemptQuestionClient } from "@/stores/useAssessmentStore";
import { cn } from "@/lib/utils";

interface CodingRunnerProps {
  question: AttemptQuestionClient;
}

/**
 * A plain textarea, deliberately not an editor.
 *
 * There is no sandbox and nothing here is ever run; the answer is text a
 * reviewer reads. Tab therefore keeps its ordinary meaning and moves focus, so
 * the box cannot trap a keyboard; indentation is typed or pasted as whitespace.
 * The starter stays in its own read-only block and is never copied into the
 * answer — an untouched question must not look answered.
 */
export function CodingRunner({ question }: CodingRunnerProps) {
  const code = useAssessmentStore((state) => state.codeAnswersMap[question.id] ?? "");
  const setCodeAnswer = useAssessmentStore((state) => state.setCodeAnswer);
  const syncDraft = useAssessmentStore((state) => state.syncDraft);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  const language = codingLanguageOf(question.config);
  const starter = question.config.starter_code?.trim() ? question.config.starter_code : null;
  // Over-cap answers are refused at submit, not truncated here: the draft still
  // saves, so a long paste is visibly flagged and can be trimmed, never lost.
  const overCap = code.length > CODE_ANSWER_CAP;

  return (
    <div className="space-y-4">
      {starter && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-brand-ink/60">
            Starter code — shown for reference, not part of your answer.
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-brand-line bg-brand-cream px-4 py-3 font-mono text-xs leading-relaxed text-brand-ink/80">
            {starter}
          </pre>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`answer-${question.id}`} className="sr-only">
          Your code
        </label>
        <textarea
          id={`answer-${question.id}`}
          value={code}
          onChange={(event) => {
            setCodeAnswer(question.id, event.target.value);
            if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
            syncTimeoutRef.current = setTimeout(() => void syncDraft(), 2000);
          }}
          rows={16}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Write your answer in plain text. Use spaces to indent."
          className="w-full rounded-xl border border-brand-line bg-brand-cream p-4 font-mono text-sm leading-relaxed text-brand-ink placeholder:text-brand-ink/35 focus:border-brand-gold focus:bg-white focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-semibold tabular-nums",
            overCap ? "text-rose-700" : "text-brand-ink/50"
          )}
        >
          {language ? `${language} · ` : ""}
          {code.length.toLocaleString("en-US")} of{" "}
          {CODE_ANSWER_CAP.toLocaleString("en-US")} characters
        </span>
        <span className="flex items-center gap-1.5 text-brand-ink/45">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Autosaved
        </span>
      </div>

      {overCap && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700"
        >
          Your answer is over the character limit; trim it before submitting.
        </p>
      )}

      <p className="text-xs leading-relaxed text-brand-ink/50">
        Your answer is reviewed by a person; it is not run. Tab moves to the next
        field, so type or paste spaces to indent.
      </p>
    </div>
  );
}
