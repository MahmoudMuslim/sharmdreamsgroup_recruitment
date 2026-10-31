"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { blindMarkingNote } from "@/modules/assessment/domain/blindMarking";
import { linkStatusWord } from "@/modules/assessment/domain/issuedLinks";
import {
  comparisonRows,
  comparisonScore,
  type AttemptComparison,
  type ComparisonAnswer,
} from "@/modules/assessment/domain/comparison";
import { getAttemptComparison } from "./actions";

export function ComparisonDrawer({ attemptIds, onClose }: { attemptIds: string[]; onClose: () => void }) {
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<{ ids: string[]; revision: number; result: AttemptComparison } | null>(null);
  const result = read?.ids === attemptIds && read.revision === revision ? read.result : null;

  useEffect(() => {
    let active = true;
    getAttemptComparison(attemptIds).then(
      (result) => { if (active) setRead({ ids: attemptIds, revision, result }); },
      () => { if (active) setRead({ ids: attemptIds, revision, result: { ok: false, error: "The comparison could not be read. Please try again." } }); },
    );
    return () => { active = false; };
  }, [attemptIds, revision]);

  const papers = result?.ok ? result.papers : [];
  const rows = comparisonRows(papers);

  return (
    <div onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const panel = event.currentTarget.querySelector<HTMLElement>('[role="dialog"] > [tabindex="-1"]');
      const controls = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], video[controls], [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      const target = event.target as HTMLElement;
      if (event.shiftKey ? target === first || !controls.includes(target) : target === last || !controls.includes(target)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }}>
      <Drawer
        open
        onClose={onClose}
        title="Compare candidates"
        subtitle={papers.length ? `${papers[0].job_title ?? "Job opening"} · ${papers[0].template_name}` : "Stored answers and marks, side by side"}
        eyebrow="Read-only comparison"
        width="max-w-6xl"
        footer={
          <>
            <p className="text-xs text-brand-ink/70">No marks or hiring decisions are changed here.</p>
            <button
              type="button"
              disabled={!result}
              onClick={() => setRevision((value) => value + 1)}
              className="min-h-11 shrink-0 rounded-xl border border-brand-line px-3 text-xs font-semibold hover:bg-brand-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink disabled:opacity-50"
            >
              Re-read
            </button>
          </>
        }
      >
        {!result && <p role="status" className="text-sm text-brand-ink/70">Reading selected papers…</p>}
        {result && !result.ok && <p role="alert" className="text-sm text-brand-ink">{result.error}</p>}
        {result?.ok && (
          <div className="min-w-0 space-y-4">
            <p className="text-xs leading-relaxed text-brand-ink/70">
              Questions and option wording reflect the current suite, not a frozen historical version. Columns follow your selection order, not a ranking. Pending means no mark is available; a recorded zero remains zero.
            </p>
            {papers.some((paper) => paper.identity_blind) && <p className="text-xs leading-relaxed text-brand-ink/70">{blindMarkingNote()}</p>}
            <p id="comparison-scroll-help" className="text-xs text-brand-ink/70">Scroll across to read every candidate. Keyboard users can focus the table region and use the arrow keys.</p>
            <div
              role="region"
              aria-label="Candidate comparison table"
              aria-describedby="comparison-scroll-help"
              tabIndex={0}
              className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-brand-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
            >
              <table className="w-full border-collapse text-left text-sm text-brand-ink">
                <caption className="sr-only">Stored assessment evidence for the selected candidates</caption>
                <thead className="bg-brand-cream">
                  <tr>
                    <th scope="col" className="min-w-48 border-b border-brand-line p-4 align-top">Question</th>
                    {papers.map((paper) => (
                      <th key={paper.attempt_id} scope="col" className="min-w-64 border-b border-l border-brand-line p-4 align-top">
                        <p className="break-words">{paper.candidate_name}</p>
                        {paper.identity_blind && <p className="mt-1 text-xs font-normal">Blind identity</p>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-brand-cream">
                    <th scope="row" className="p-4 align-top">Status and total</th>
                    {papers.map((paper) => (
                      <td key={paper.attempt_id} className="border-l border-brand-line p-4 align-top">
                        <p>{linkStatusWord(paper.status)}</p>
                        <p className="mt-1 font-semibold tabular-nums">{comparisonScore(paper.score, paper.max_score, paper.scores_masked)}</p>
                      </td>
                    ))}
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.question_id} className="border-t border-brand-line">
                      <th scope="row" className="p-4 align-top">
                        <p className="break-words">{row.title}</p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-xs font-normal leading-relaxed text-brand-ink/70">{row.prompt}</p>
                      </th>
                      {row.cells.map((answer, index) => (
                        <td key={papers[index].attempt_id} className="border-l border-brand-line p-4 align-top">
                          {answer ? <AnswerEvidence answer={answer} masked={papers[index].scores_masked} /> : <p>No question data for this paper.</p>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p role="status" className="text-sm text-brand-ink/70">No question data is available in the current suite. This does not establish what these candidates originally answered.</p>}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function AnswerEvidence({ answer, masked }: { answer: ComparisonAnswer; masked: boolean }) {
  return (
    <div className="w-64 max-w-full space-y-3 whitespace-pre-wrap break-words text-xs leading-relaxed">
      <p className="font-semibold tabular-nums">Mark: {comparisonScore(answer.score, answer.max_score, masked)}</p>
      {!answer.answered ? <p>No answer recorded.</p> : (
        <>
          {answer.chosen_text !== null && <p><strong>Selected:</strong> {answer.chosen_text}</p>}
          {answer.question_type === "CODING" ? (
            /* The code is read, never run: it is printed as the text the
               candidate wrote, in a block that keeps its own line breaks, and
               never as markup. A question with no language carries no label,
               and a code answer with no text carries no block — the fallback
               is an ordinary sentence, not a line of code. */
            <div>
              {answer.language ? <p className="font-semibold">{answer.language}</p> : null}
              {answer.answer_text ? (
                <pre className="whitespace-pre-wrap break-words font-mono">{answer.answer_text}</pre>
              ) : (
                <p>No written text recorded.</p>
              )}
            </div>
          ) : (
            (answer.question_type === "CASE_STUDY" || answer.answer_text !== null) && <p>{answer.answer_text || "No written text recorded."}</p>
          )}
          {answer.question_type === "EXCEL_MODEL" && (
            <div>
              <p className="font-semibold">Spreadsheet changes</p>
              {answer.cells.length ? <dl className="mt-1 space-y-1">{answer.cells.map((cell) => <div key={cell.ref}><dt className="inline font-semibold">{cell.ref}: </dt><dd className="inline">{cell.value || "Cleared"}</dd></div>)}</dl> : <p>No changed cells recorded.</p>}
            </div>
          )}
          {answer.question_type === "VIDEO_PITCH" && (
            <div className="space-y-2">
              {answer.video_url ? <video controls preload="none" playsInline src={answer.video_url} aria-label={`Recorded answer: ${answer.title}`} className="w-full rounded-lg bg-brand-ink" /> : <p>Recording unavailable.</p>}
              <p><strong>Transcript:</strong> {answer.transcript || "No transcript recorded."}</p>
            </div>
          )}
          {(answer.question_type === "MULTIPLE_CHOICE" || answer.question_type === "SITUATIONAL_JUDGMENT") && answer.chosen_text === null && <p>Selected option wording is unavailable in the current suite.</p>}
        </>
      )}
      {answer.criteria.length > 0 && (
        <div>
          <p className="font-semibold">Criterion marks</p>
          <ul className="mt-1 space-y-1">
            {answer.criteria.map((criterion, index) => (
              <li key={`${criterion.label}-${index}`}>
                <span className="font-semibold">{criterion.label}</span> — {masked ? "Hidden" : criterion.marks === null ? "No mark on file" : `${criterion.marks} of ${criterion.allowance}${criterion.percent === null ? "" : ` (${criterion.percent}%)`}`}
                {criterion.evidence && <span className="block italic">Quoted: {criterion.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {answer.rationale && <p><strong>Grading explanation:</strong> {answer.rationale}</p>}
      {answer.strengths.length > 0 && <div><p className="font-semibold">Strengths</p><ul className="list-disc pl-4">{answer.strengths.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
      {answer.improvements.length > 0 && <div><p className="font-semibold">Improvements</p><ul className="list-disc pl-4">{answer.improvements.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
    </div>
  );
}
