/**
 * What a situational judgment question is, and what a chosen response earns.
 *
 * The type is a fifth member of `QuestionType`, and it borrows the quiz's
 * storage almost whole: `config.options`, an `answer_text` holding the chosen
 * option's label, the attempt's `choice_answers_map`, and the same option
 * shuffle. What it does not borrow is the marking. A quiz has one right option
 * and every other pick scores zero. A judgment scene has a score per response —
 * 100 is the response the author would coach, 0 is the one that would make the
 * situation worse — so a pick earns its share of the question's points.
 *
 * The percentages live here rather than in the submit route, the editor, the AI
 * drafter and the review desk separately. Four readers of one arithmetic is how
 * a question ends up worth 7 marks on the runner and 8 on the report; one
 * module means the validation sentence a drafter sees is the sentence the
 * editor shows, and the score a candidate gets is the score the desk prints.
 *
 * Nothing here touches the database. The label itself is added by
 * `db/migrations/034_situational_judgment.sql`, which is applied on this
 * database; every door still probes for it, so a database that predates the
 * file names it instead of writing a row the enum would reject.
 */

import type { MultipleChoiceOption, QuestionConfig } from "@/types";

/** The enum label, spelled exactly as the migration adds it. */
export const SITUATIONAL_JUDGMENT = "SITUATIONAL_JUDGMENT";

/** The file that adds the label to `public.question_type`, applied on this database. */
export const SITUATIONAL_MIGRATION = "db/migrations/034_situational_judgment.sql";

/** What the builder and the bank say on a database that predates the label. */
export const SITUATIONAL_SCHEMA_NOTE =
  `Situational judgment questions have not been added to this database yet — ${SITUATIONAL_MIGRATION} is authored but not applied. Every other question type works normally.`;

/** What a write that named the new type is told on a database where the label is absent. */
export const SITUATIONAL_WRITE_REFUSAL =
  `This question was not saved: ${SITUATIONAL_MIGRATION} is authored but not applied, so the database's question_type enum has no ${SITUATIONAL_JUDGMENT} value yet.`;

/**
 * Whether an error means the enum has not heard of the new value.
 *
 * One code says it: 22P02, Postgres refusing an input value for the enum —
 * which is exactly what both the availability probe (a filter naming the label)
 * and a write receive while 034 is unapplied. The message check catches a
 * driver that reports the same refusal without a code. A constraint violation
 * is deliberately not here: for this type the only constraint it can hit is
 * the enum itself, and its message is the one quoted above.
 */
export function isMissingQuestionTypeError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === "22P02" ||
    /invalid input value for enum|schema cache/i.test(error.message ?? "")
  );
}

/** One stored response, with the percentage it carries when the row is usable. */
export interface JudgmentOption {
  label: string;
  text: string;
  /** 0 (harmful) to 100 (the response to coach); null when the row stores none. */
  score: number | null;
}

/**
 * A stored percentage, or null when the option does not carry a usable one.
 *
 * The editor only stores whole numbers, so a fraction here is either hand-
 * written JSON or an AI draft that slipped past review; rounding it keeps the
 * marks arithmetic whole rather than carrying a float into a score column. A
 * value outside 0–100 is not rounded into range — it is refused, because a
 * negative or 140% effectiveness is not a question anyone meant to write.
 */
export function readJudgmentScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value);
}

/** The question's responses in authored order, scored or not. */
export function judgmentOptionsOf(
  config: Pick<QuestionConfig, "options"> | null | undefined
): JudgmentOption[] {
  return (config?.options ?? []).map((option) => ({
    label: option.label,
    text: option.text,
    score: readJudgmentScore(option.score),
  }));
}

/** The best effectiveness the scene offers, or null when nothing is scored. */
export function bestJudgmentScore(options: readonly JudgmentOption[]): number | null {
  const scores = options
    .map((option) => option.score)
    .filter((score): score is number => score !== null);
  return scores.length === 0 ? null : Math.max(...scores);
}

/** What one pick earns, in the words the reviewer reads. */
export interface JudgmentResult {
  /** Marks the chosen response earns out of the question's points. */
  score: number;
  percent: number | null;
  chosen_text: string | null;
  best_percent: number | null;
  best_text: string | null;
  rationale: string;
  strengths: string[];
  improvements: string[];
}

/**
 * Mark one pick against the scene's percentages.
 *
 * The chosen label is matched exactly: the runner writes the stored handle
 * (`OPT_2`), never the wording, so a label that is not on the question is a
 * corrupted answer and is reported as unscorable rather than matched to
 * something similar. Ties for the best response are allowed — a scene may hold
 * two equally effective responses — and the first of them is named.
 *
 * `points` is the question's authored value; the percentage is applied to it
 * and rounded once, so 30 marks at 60% is 18 and never 17.999.
 */
export function judgeChoice(
  points: number,
  config: Pick<QuestionConfig, "options"> | null | undefined,
  chosenLabel: string | null | undefined
): JudgmentResult {
  const options = judgmentOptionsOf(config);
  const bestPercent = bestJudgmentScore(options);
  const best = options.find((option) => option.score !== null && option.score === bestPercent);
  const chosen = chosenLabel ? options.find((option) => option.label === chosenLabel) : undefined;
  const percent = chosen?.score ?? null;
  const score = percent === null ? 0 : Math.round((points * percent) / 100);

  if (options.length === 0 || bestPercent === null) {
    return {
      score: 0,
      percent: null,
      chosen_text: null,
      best_percent: null,
      best_text: null,
      rationale:
        "This question carries no scored responses, so the answer could not be marked.",
      strengths: [],
      improvements: [],
    };
  }

  if (percent === null) {
    return {
      score: 0,
      percent: null,
      chosen_text: chosen?.text ?? null,
      best_percent: bestPercent,
      best_text: best?.text ?? null,
      rationale: chosenLabel
        ? "The recorded answer does not match a response on this question, so it was not marked."
        : "No response was recorded, so there was nothing to mark.",
      strengths: [],
      improvements: chosenLabel ? [] : ["Answer the scene before submitting the test"],
    };
  }

  const atBest = percent === bestPercent;
  return {
    score,
    percent,
    chosen_text: chosen?.text ?? null,
    best_percent: bestPercent,
    best_text: best?.text ?? null,
    rationale: atBest
      ? `Chose the response this scene rewards — ${percent}% effective, ${score} of ${points} marks.`
      : `Chose a response rated ${percent}% effective, earning ${score} of ${points} marks. The scene's most effective response was “${best?.text}”.`,
    strengths: atBest ? ["Picked the response the scene rewards"] : percent >= 60 ? ["Chose a workable response"] : [],
    improvements: atBest ? [] : [`Compare the pick with the scene's most effective response: “${best?.text}”.`],
  };
}

/* ---- authoring ---- */

/** One response as the editor and the AI drafter hold it before validation. */
export interface JudgmentDraftOption {
  text: string;
  score: number | null;
}

/** A response that passed validation: wording, and a whole-number percentage. */
export interface JudgmentDraft {
  text: string;
  score: number;
}

export type JudgmentDraftRead =
  | { ok: true; options: JudgmentDraft[] }
  | { ok: false; error: string };

/**
 * What makes a judgment scene markable, in the words the author is shown.
 *
 * Two rules, because each one protects a different promise. Two scored
 * responses make it a choice rather than a statement. Two *different* scores
 * make it a judgment: a scene where every response is worth 100 is a quiz with
 * the answer key removed, and one where every response is worth 0 can never
 * award anything. Requiring two distinct scores implies one above zero, so
 * there is no third rule to state.
 *
 * Blank rows are dropped before counting — the editor leaves one ready to fill
 * — but a row with wording and no score is refused rather than silently
 * marked 0, because that would be putting words in the author's mouth.
 */
export function readJudgmentDraft(options: JudgmentDraftOption[]): JudgmentDraftRead {
  const kept = options
    .map((option) => ({ text: option.text.trim(), score: option.score }))
    .filter((option) => option.text.length > 0);

  if (kept.length < 2) {
    return {
      ok: false,
      error: "A situational judgment question needs at least two responses to choose between.",
    };
  }

  const unscored = kept.find(
    (option) =>
      option.score === null || !Number.isInteger(option.score) || option.score < 0 || option.score > 100
  );
  if (unscored) {
    return {
      ok: false,
      error: "Every response needs a whole-number score from 0 to 100 — 0 for the response that makes things worse, 100 for the one to coach.",
    };
  }

  const scored = kept.filter(
    (option): option is JudgmentDraft =>
      option.score !== null &&
      Number.isInteger(option.score) &&
      option.score >= 0 &&
      option.score <= 100
  );

  const distinct = new Set(scored.map((option) => option.score));
  if (distinct.size < 2) {
    return {
      ok: false,
      error: "A situational judgment question needs at least two different response scores, or there is nothing for the candidate to judge.",
    };
  }

  return { ok: true, options: scored };
}

/** The stored option shape, with the handle the runner and the desk share. */
export function judgmentStoredOptions(options: JudgmentDraft[]): MultipleChoiceOption[] {
  return options.map((option, index) => ({
    label: `OPT_${index + 1}`,
    text: option.text,
    // No option is *the* correct one; the percentages carry the ranking. The
    // field stays false so a quiz reader never mistakes a scene for a key.
    is_correct: false,
    score: option.score,
  }));
}
