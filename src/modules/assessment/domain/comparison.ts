import { maskCriterionMarks, type AttemptAnswer, type AttemptAnswers } from "./attemptAnswers.ts";

export interface ComparisonSelection {
  id: string;
  application_id: string;
  job_id: string | null;
  template_id: string;
}

export type ComparisonAnswer = Pick<AttemptAnswer,
  "question_id" | "title" | "prompt" | "question_type" | "answered" |
  "answer_text" | "chosen_text" | "cells" | "video_url" | "transcript" |
  "score" | "max_score" | "rationale" | "strengths" | "improvements" | "criteria"
>;

export type ComparisonPaper = Pick<AttemptAnswers,
  "attempt_id" | "candidate_name" | "identity_blind" | "job_title" |
  "template_name" | "status" | "scores_masked" | "score" | "max_score"
> & { answers: ComparisonAnswer[] };

export type AttemptComparison =
  | { ok: true; papers: ComparisonPaper[] }
  | { ok: false; error: string };

export function comparisonSelectionIssue(rows: readonly ComparisonSelection[]): string | null {
  if (rows.length > 4) return "Compare up to four candidates at a time.";
  if (rows.some((row) => !row.job_id)) return "Each candidate must belong to a visible job opening.";
  if (new Set(rows.map((row) => row.application_id)).size !== rows.length ||
      new Set(rows.map((row) => row.id)).size !== rows.length) {
    return "Choose one attempt per candidate.";
  }
  if (rows.some((row) => row.job_id !== rows[0].job_id || row.template_id !== rows[0].template_id)) {
    return "Choose candidates for the same job opening and assessment suite.";
  }
  return null;
}

export function comparisonPaper(paper: AttemptAnswers): ComparisonPaper {
  return {
    attempt_id: paper.attempt_id,
    candidate_name: paper.candidate_name,
    identity_blind: paper.identity_blind,
    job_title: paper.job_title,
    template_name: paper.template_name,
    status: paper.status,
    scores_masked: paper.scores_masked,
    score: paper.scores_masked || paper.status !== "GRADED" ? null : paper.score,
    max_score: paper.scores_masked ? null : paper.max_score,
    answers: paper.answers.map((answer) => ({
      question_id: answer.question_id,
      title: answer.title,
      prompt: answer.prompt,
      question_type: answer.question_type,
      answered: answer.answered,
      answer_text: answer.answer_text,
      chosen_text: answer.chosen_text,
      cells: answer.cells,
      video_url: answer.video_url,
      transcript: answer.transcript,
      score: paper.scores_masked ? null : answer.score,
      max_score: paper.scores_masked ? null : answer.max_score,
      rationale: answer.rationale,
      strengths: answer.strengths,
      improvements: answer.improvements,
      // Re-masked here rather than trusted from the read: a paper assembled from
      // a stale or hand-built row must not carry points into a withheld view.
      criteria: paper.scores_masked ? maskCriterionMarks(answer.criteria) : answer.criteria,
    })),
  };
}

export function comparisonRows(papers: readonly ComparisonPaper[]) {
  const questions = new Map(papers.flatMap((paper) => paper.answers.map((answer) => [answer.question_id, answer] as const)));
  const answers = papers.map((paper) => new Map(paper.answers.map((answer) => [answer.question_id, answer])));
  return [...questions.values()].map((question) => ({
    question_id: question.question_id,
    title: question.title,
    prompt: question.prompt,
    cells: answers.map((paper) => paper.get(question.question_id) ?? null),
  }));
}

export function comparisonScore(score: number | null, max: number | null, masked: boolean): string {
  if (masked) return "Hidden";
  if (score === null) return "Pending";
  return max === null ? String(score) : `${score} / ${max}`;
}
