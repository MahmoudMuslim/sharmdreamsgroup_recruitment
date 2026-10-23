import { summarizeSelection } from "@/modules/assessment/domain/testRecommendations";
import type { TestRecommendationResult } from "./recommendation-actions";

export function TestRecommendationResults({ result, selectedIds, budgetMinutes, onToggle }: {
  result: Extract<TestRecommendationResult, { ok: true }>;
  selectedIds: string[];
  budgetMinutes: number | null;
  onToggle: (id: string) => void;
}) {
  const summary = summarizeSelection(result.requirements, result.recommendations, selectedIds, budgetMinutes ?? Infinity);
  const requirements = new Map(result.requirements.map((item) => [item.id, item.text]));

  return (
    <div className="space-y-4 border-t border-brand-line pt-4">
      <h3 className="text-sm font-bold text-brand-ink">Suggestions for {result.opening.title}</h3>
      <section aria-label="Selection summary" aria-live="polite" className="rounded-xl border border-brand-line bg-brand-cream p-4">
        <p className="text-sm font-bold">
          {summary.totalMinutes} minutes selected{budgetMinutes !== null ? ` / ${budgetMinutes} minute budget` : " · Enter a valid budget"}
        </p>
        <p className="mt-1 text-xs text-brand-ink/70">
          {summary.matchedRequirementIds.length} of {result.requirements.length} requirements have a suggested match.
        </p>
        {budgetMinutes !== null && summary.overBudget && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Over budget by {summary.totalMinutes - budgetMinutes} minutes. This is advisory; you can keep or change your selection.
          </p>
        )}
      </section>

      {result.recommendations.length === 0 ? (
        <p className="rounded-xl border border-brand-line px-4 py-3 text-sm text-brand-ink/70">
          No grounded suggestions were returned from the reviewed tests. This does not mean no suitable tests exist.
        </p>
      ) : (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-xs font-bold text-brand-ink/70">Select existing tests to compare their suggested matches</legend>
          {result.recommendations.map((suite) => (
            <article key={suite.id} className="min-w-0 rounded-xl border border-brand-line p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(suite.id)}
                  onChange={() => onToggle(suite.id)}
                  aria-label={`Include “${suite.name}”`}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-brand-line accent-brand-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold"
                />
                <span className="min-w-0 break-words text-sm font-bold">
                  {suite.name}<span className="mt-1 block text-xs font-normal text-brand-ink/60">{suite.durationMinutes} minutes</span>
                </span>
              </label>
              <ul className="mt-3 space-y-3">
                {suite.evidence.map((item) => (
                  <li key={`${item.requirementId}-${item.questionId}`} className="space-y-2 break-words rounded-lg bg-brand-cream p-3 text-xs leading-relaxed text-brand-ink/80">
                    <p><span className="font-bold">Requirement: </span>{requirements.get(item.requirementId)}</p>
                    <p><span className="font-bold">Question: </span>{item.questionTitle}</p>
                    <div>
                      <p className="font-bold">Verified quotation</p>
                      <blockquote className="mt-1 border-l-2 border-brand-gold pl-3">{item.quote}</blockquote>
                    </div>
                    <p><span className="font-bold">AI explanation: </span>{item.explanation}</p>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </fieldset>
      )}

      <section className="rounded-xl border border-brand-line px-4 py-3">
        <h4 className="text-xs font-bold">No suggested match in this selection</h4>
        {summary.gaps.length > 0 ? (
          <ul aria-label="No suggested match in this selection" className="mt-2 list-disc space-y-1 pl-4 text-xs text-brand-ink/70">
            {summary.gaps.map((item) => <li key={item.id}>{item.text}</li>)}
          </ul>
        ) : <p className="mt-2 text-xs text-brand-ink/70">Every listed requirement has a suggested match in this selection.</p>}
      </section>
      <section aria-label="Recommendation scope" className="space-y-2 text-xs leading-relaxed text-brand-ink/60">
        <h4 className="font-bold">Scope notes</h4>
        <p>Only the reviewed existing tests and question text inform these suggestions.</p>
        <ul className="list-disc space-y-1 pl-4">
          {result.notes.map((note, index) => <li key={index}>{note}</li>)}
        </ul>
        <p className="break-words">Model: {result.model}</p>
      </section>
    </div>
  );
}
