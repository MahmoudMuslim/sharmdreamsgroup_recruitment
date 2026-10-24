import type { QuestionConfig, QuestionType } from "@/types";
import type { QuestionDraft } from "@/app/(admin)/assessments/question-actions";
import { refToRowAndColumn } from "./attemptAnswers";
import { readJudgmentDraft } from "./situational";

/**
 * What a model is allowed to hand back before it can be offered to a recruiter.
 *
 * A generated question looks finished, which is exactly the danger: a quiz with
 * two options marked correct, a spreadsheet whose required cell is already
 * filled in by the question itself, a judgment scene whose responses all score
 * 100, or a video pitch capped at nine seconds all pass as plausible prose and
 * then fail on a candidate's screen. Everything here
 * decides, from the runner's own rules, whether a draft could actually be sat —
 * and says in one sentence what was refused instead of writing a broken row.
 *
 * `saveQuestion` stays the authority on the database row. Nothing in this file
 * writes; it only turns a model's reply into drafts a human can review, so a
 * draft that slips through here is still refused at the door.
 *
 * A whole suite drafted from a job opening comes through the same door:
 * `reviewSuite` checks the shell the suite editor stores — name, role family,
 * clock — and hands its questions to `reviewDrafts`, so a drafted suite and a
 * batch of drafted questions are judged by identical rules.
 */

export const MAX_DRAFTS_PER_RUN = 8;
/** The grid the runner builds: `SpreadsheetRunner` pads to 30 rows × 8 columns. */
export const GRID_ROWS = 30;
export const GRID_COLUMNS = 8;

export const DIFFICULTIES = ["ENTRY", "MID", "SENIOR"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  ENTRY: "Entry level",
  MID: "Working professional",
  SENIOR: "Senior / lead",
};

const TYPE_WORDS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "quiz",
  CASE_STUDY: "case study",
  EXCEL_MODEL: "spreadsheet model",
  VIDEO_PITCH: "video pitch",
  SITUATIONAL_JUDGMENT: "situational judgment",
  CODING: "coding task",
};

export interface AuthoringBrief {
  topic: string;
  types: QuestionType[];
  count: number;
  difficulty: Difficulty;
  pointsEach: number;
  notes: string;
}

export interface GeneratedOption {
  text: string;
  is_correct: boolean;
  /** SITUATIONAL_JUDGMENT only: 0–100 effectiveness, or null when unscored. */
  score?: number | null;
}

export interface GeneratedOutput {
  cell: string;
  description: string;
  formula_hint: string | null;
}

/** One question, already normalised to what the runner and grader can use. */
export interface GeneratedQuestion {
  question_type: QuestionType;
  title: string;
  prompt: string;
  instructions: string;
  points: number;
  time_limit_minutes: number | null;
  shuffle_options: boolean;
  options: GeneratedOption[];
  context: string;
  min_words: number | null;
  min_duration_seconds: number | null;
  max_duration_seconds: number | null;
  sheet: (string | number | null)[][];
  outputs: GeneratedOutput[];
  /** What the recruiter has to look at before this can be handed to a candidate. */
  cautions: string[];
}

export interface DraftReview {
  drafts: GeneratedQuestion[];
  /** One sentence per draft refused, in the order the model returned them. */
  dropped: string[];
  /** Drafts the model did not write, so the desk can say "3 of 5". */
  shortBy: number;
}

/**
 * The JSON contract, in one place, so the prompt and the validator cannot drift
 * apart and blame each other when a reply is refused.
 */
export const GENERATED_JSON_SHAPE = `{
  "questions": [
    {
      "question_type": "MULTIPLE_CHOICE" | "CASE_STUDY" | "EXCEL_MODEL" | "VIDEO_PITCH" | "SITUATIONAL_JUDGMENT",
      "title": "short label for the candidate's contents list",
      "prompt": "the question the candidate is asked",
      "instructions": "one or two lines shown under the question, or an empty string",
      "points": number,
      "time_limit_minutes": number or null,
      "options": [{ "text": "string", "is_correct": boolean, "score": number or null }],
      "context": "scenario the candidate reads first, or empty string",
      "min_words": number or null,
      "min_duration_seconds": number or null,
      "max_duration_seconds": number or null,
      "initial_sheet": [["label", "label"], ["input", "input"]],
      "expected_outputs": [{ "cell": "C5", "description": "what belongs there", "formula_hint": "how to work it out" }]
    }
  ]
}

Field rules:
- "options": MULTIPLE_CHOICE and SITUATIONAL_JUDGMENT only, 2 to 6 entries.
- MULTIPLE_CHOICE: exactly one option with "is_correct": true, and every "score" null.
- SITUATIONAL_JUDGMENT: a workplace scene in "prompt", then responses the candidate
  could plausibly give. Every option has "is_correct": false and a whole-number
  "score" from 0 (makes things worse) to 100 (the response to coach). At least two
  scores must differ. There is no single right answer — rank the responses.
- "context" and "min_words": CASE_STUDY only.
- "min_duration_seconds" and "max_duration_seconds": VIDEO_PITCH only.
- "initial_sheet" and "expected_outputs": EXCEL_MODEL only. The sheet ships with
  the question, so it holds only labels and given figures — never the answer.
- "expected_outputs": 1 to 6 cells the candidate must produce, and every one of
  them must be BLANK in "initial_sheet".
- Leave a field out or null when it does not belong to that question type.`;

const QUESTION_TYPES: readonly string[] = [
  "MULTIPLE_CHOICE",
  "CASE_STUDY",
  "EXCEL_MODEL",
  "VIDEO_PITCH",
  "SITUATIONAL_JUDGMENT",
];

/**
 * What each question type can actually give a candidate, said once.
 *
 * Both authoring prompts quote this. A model told one thing about a spreadsheet
 * and refused another by `reviewDrafts` produces a run where every question is
 * dropped, so the rules and the review are written from the same words.
 */
export const QUESTION_RULES = `Each question must be answerable with only what its type gives the candidate:
- MULTIPLE_CHOICE: exactly one option is correct. Wrong options must be plausible, not jokes. Never use "all of the above" or "none of the above" — options are shuffled per candidate.
- SITUATIONAL_JUDGMENT: a short workplace scene in "prompt", then 2 to 6 responses the candidate could give. Every response carries a 0–100 "score" saying how effective it is, and at least two scores must differ. None is marked correct — the percentages are the ranking. Write responses that a reasonable person might actually choose; a scene where only the 100-scored response is plausible tests nothing.
- CASE_STUDY: put the scenario the candidate reads first in "context", then ask one thing of them in "prompt".
- EXCEL_MODEL: the candidate edits a grid. "initial_sheet" is the paper handed to them: labels and given figures ONLY. Every cell listed in "expected_outputs" must be BLANK there — a required cell that the sheet already prints is an answer given away, not a question.
- VIDEO_PITCH: the candidate speaks to a camera. Ask something answerable out loud in the seconds allowed, with nothing to look up.

Do not invent company figures you then ask the candidate to find. Do not ask for something the question itself states. Set every number a candidate needs inside the question.`;

/** How the suite shell is judged, next to the questions it holds. */
export const SUITE_RULES = `The suite around the questions:
- "name": a few words a recruiter recognises in a dropdown, naming the role and what is being tested — not the vacancy's reference or its posting date.
- "description": one or two sentences to the candidate, saying what the test covers and what they need to have to hand.
- "role_family": copy one of the families given to you, exactly as written, or the suite lands in a filter nobody uses.
- "time_limit_minutes": long enough for every question you wrote, up to 480. A suite shorter than its own questions is a test no one can finish.
- "block_copy_paste": true unless the test is meant to be open-book, because blocking it stops a candidate pasting their own notes or a formula.`;

const TITLE_CAP = 160;
const PROMPT_CAP = 4000;
const OPTION_CAP = 400;
const CELL_CAP = 120;

function text(value: unknown, cap: number): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

/** A whole number inside the range the column accepts, or null when absent. */
function whole(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function countFor(brief: AuthoringBrief): number {
  return whole(brief.count, 1, MAX_DRAFTS_PER_RUN) ?? 1;
}

/**
 * The seed grid, trimmed to what the runner can render.
 *
 * Rows and columns past the grid's 30×8 would be silently cut by
 * `SpreadsheetRunner`, so a model that writes a 40-row sheet gets the extra rows
 * removed here rather than a candidate losing figures they never see.
 */
export function normaliseSheet(raw: unknown): (string | number | null)[][] {
  if (!Array.isArray(raw)) return [];
  const rows: (string | number | null)[][] = [];
  for (const row of raw.slice(0, GRID_ROWS)) {
    if (!Array.isArray(row)) continue;
    const cells = row.slice(0, GRID_COLUMNS).map((cell): string | number | null => {
      if (cell === null || cell === undefined || cell === "") return null;
      if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
      if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
      return String(cell).trim().slice(0, CELL_CAP) || null;
    });
    if (cells.some((cell) => cell !== null)) rows.push(cells);
  }
  return rows;
}

/**
 * The cells the candidate must produce, checked against the sheet that ships.
 *
 * A required output written over a given figure is the model handing the answer
 * away — the grader then reads the seed value the candidate never calculated and
 * awards it. Those outputs are refused here, and if none survive the whole
 * question goes, because a model question with nothing to produce scores nothing.
 */
export function normaliseOutputs(
  raw: unknown,
  sheet: (string | number | null)[][]
): { outputs: GeneratedOutput[]; refused: string[] } {
  const outputs: GeneratedOutput[] = [];
  const refused: string[] = [];
  const seen = new Set<string>();

  for (const entry of Array.isArray(raw) ? raw : []) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const cell = text(record.cell, 8).toUpperCase();
    const description = text(record.description, 300);
    const at = refToRowAndColumn(cell);

    if (cell === "") continue;
    if (!at) {
      refused.push(`${cell} is not a cell the grid has.`);
      continue;
    }
    if (at.col >= GRID_COLUMNS || at.row >= GRID_ROWS) {
      refused.push(`${cell} sits outside the ${GRID_COLUMNS}-column grid the candidate gets.`);
      continue;
    }
    if (!description) {
      refused.push(`${cell} has no description, so nothing could be graded there.`);
      continue;
    }
    if (seen.has(cell)) continue;

    const given = sheet[at.row]?.[at.col];
    if (given !== null && given !== undefined && given !== "") {
      refused.push(
        `${cell} is required but the question already prints ${JSON.stringify(given)} there.`
      );
      continue;
    }

    seen.add(cell);
    outputs.push({
      cell,
      description,
      formula_hint: text(record.formula_hint, 200) || null,
    });
  }

  return { outputs: outputs.slice(0, 6), refused };
}

function optionsOf(raw: unknown): {
  options: GeneratedOption[];
  cautions: string[];
  reason: string | null;
} {
  const cautions: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > 6) cautions.push("Only the first six answer options were kept.");
  const kept: GeneratedOption[] = [];
  const seen = new Set<string>();

  for (const entry of list.slice(0, 6)) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const optionText = text(record.text, OPTION_CAP);
    if (!optionText) continue;
    const fingerprint = optionText.toLowerCase();
    if (seen.has(fingerprint)) {
      cautions.push("Two options carried the same wording, so one was removed.");
      continue;
    }
    seen.add(fingerprint);

    // One key, always the first option the model marked. A quiz with two correct
    // answers scores nothing, so the second marking is dropped rather than trusted.
    const claimsCorrect = record.is_correct === true;
    const isFirst = claimsCorrect && !kept.some((option) => option.is_correct);
    if (claimsCorrect && !isFirst) {
      cautions.push(
        "The model marked more than one option correct; only the first one is the answer key."
      );
    }
    kept.push({ text: optionText, is_correct: isFirst });
  }

  if (kept.length < 2) {
    return {
      options: [],
      cautions,
      reason: "A quiz needs at least two answer options, and this one did not have them.",
    };
  }
  if (!kept.some((option) => option.is_correct)) {
    return {
      options: [],
      cautions,
      reason: "No option was marked correct, so nothing could be scored.",
    };
  }

  return { options: kept, cautions, reason: null };
}

/**
 * The responses of a judgment scene, reduced to what the desk can store.
 *
 * Wording is deduplicated before the scores are judged: two identical responses
 * with different percentages are impossible to tell apart on a candidate's
 * screen, so the second is dropped with a caution. `readJudgmentDraft` then
 * applies the same rules the manual editor uses — at least two responses, whole
 * percentages from 0 to 100, and at least two that differ.
 */
function judgedOptionsOf(raw: unknown): {
  options: GeneratedOption[];
  cautions: string[];
  reason: string | null;
} {
  const cautions: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > 6) cautions.push("Only the first six responses were kept.");

  const candidates: { text: string; score: number | null }[] = [];
  const seen = new Set<string>();

  for (const entry of list.slice(0, 6)) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const optionText = text(record.text, OPTION_CAP);
    if (!optionText) continue;
    const fingerprint = optionText.toLowerCase();
    if (seen.has(fingerprint)) {
      cautions.push("Two responses carried the same wording, so one was removed.");
      continue;
    }
    seen.add(fingerprint);
    const rawScore = record.score;
    candidates.push({
      text: optionText,
      score: typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : null,
    });
  }

  const read = readJudgmentDraft(candidates);
  if (!read.ok) return { options: [], cautions, reason: read.error };

  return {
    options: read.options.map((option) => ({
      text: option.text,
      // No response is *the* correct one; the percentages rank them.
      is_correct: false,
      score: option.score,
    })),
    cautions,
    reason: null,
  };
}

/** Turns a model's reply into drafts a human can review, naming every refusal. */
export function reviewDrafts(
  parsed: unknown,
  brief: AuthoringBrief,
  existingTitles: string[] = []
): DraftReview {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { questions?: unknown })?.questions)
      ? ((parsed as { questions: unknown[] }).questions)
      : null;

  if (!list) {
    return {
      drafts: [],
      dropped: ["The model's reply was not a list of questions, so nothing was offered."],
      shortBy: countFor(brief),
    };
  }

  const wanted = countFor(brief);
  const allowed = new Set<QuestionType>(brief.types);
  const drafts: GeneratedQuestion[] = [];
  const dropped: string[] = [];

  list.slice(0, wanted).forEach((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const where = `Question ${index + 1}`;
    const type = record.question_type;

    if (typeof type !== "string" || !QUESTION_TYPES.includes(type)) {
      dropped.push(`${where} named a type the runner cannot ask (${String(type ?? "nothing")}).`);
      return;
    }
    const questionType = type as QuestionType;
    if (!allowed.has(questionType)) {
      dropped.push(
        `${where} is a ${TYPE_WORDS[questionType]}, which was not one of the kinds asked for.`
      );
      return;
    }

    const title = text(record.title, TITLE_CAP);
    const prompt = text(record.prompt, PROMPT_CAP);
    if (!title || !prompt) {
      dropped.push(`${where} came without a ${!title ? "title" : "question"}, so there was nothing to review.`);
      return;
    }

    const cautions: string[] = [];
    const points = whole(record.points, 1, 100);
    if (points === null) {
      cautions.push(`It carries no marks of its own, so it takes the ${brief.pointsEach} you set.`);
    }

    const duplicate = existingTitles.find(
      (existing) => existing.toLowerCase().trim() === title.toLowerCase().trim()
    );
    if (duplicate) cautions.push(`The suite already has a question called “${duplicate}”.`);

    let options: GeneratedOption[] = [];
    let outputs: GeneratedOutput[] = [];
    let sheet: (string | number | null)[][] = [];

    if (questionType === "MULTIPLE_CHOICE") {
      const graded = optionsOf(record.options);
      if (graded.reason) {
        dropped.push(`${where} — ${graded.reason}`);
        return;
      }
      options = graded.options;
      cautions.push(...graded.cautions);
      cautions.push(
        `The model picked the answer out of ${options.length} options, so check the key is right.`
      );
    }

    if (questionType === "SITUATIONAL_JUDGMENT") {
      const judged = judgedOptionsOf(record.options);
      if (judged.reason) {
        dropped.push(`${where} — ${judged.reason}`);
        return;
      }
      options = judged.options;
      cautions.push(...judged.cautions);
      const best = Math.max(...options.map((option) => option.score ?? 0));
      cautions.push(
        `The model rated the responses itself, and its most effective one scores ${best}% — check the ranking is the one you would coach.`
      );
    }

    if (questionType === "EXCEL_MODEL") {
      sheet = normaliseSheet(record.initial_sheet);
      const checked = normaliseOutputs(record.expected_outputs, sheet);
      outputs = checked.outputs;
      if (checked.refused.length > 0) {
        cautions.push(
          `${checked.refused.length} required ${
            checked.refused.length === 1 ? "cell was" : "cells were"
          } refused: ${checked.refused.join(" ")}`
        );
      }
      if (sheet.length === 0) {
        dropped.push(`${where} is a model question with no starting grid for the candidate to fill.`);
        return;
      }
      if (outputs.length === 0) {
        dropped.push(
          `${where} asked for nothing the candidate has to produce, so it could not be scored.`
        );
        return;
      }
      cautions.push("Read the required cells against the figures the sheet ships with.");
    }

    const maxSeconds = whole(record.max_duration_seconds, 10, 1800);
    const minSeconds = whole(record.min_duration_seconds, 0, 1800);
    if (questionType === "VIDEO_PITCH" && maxSeconds === null && minSeconds === null) {
      cautions.push("No length limit was given, so the recorder allows any pitch.");
    }

    drafts.push({
      question_type: questionType,
      title,
      prompt,
      instructions: text(record.instructions, 1000),
      points: points ?? whole(brief.pointsEach, 1, 100) ?? 10,
      time_limit_minutes: whole(record.time_limit_minutes, 1, 480),
      // Left off: a shuffled quiz whose model wrote "All of the above" as its
      // last option puts that option in the middle and makes the question
      // unanswerable, and a shuffled scene hides the order the model ranked.
      // The recruiter switches shuffling on once they have read it.
      shuffle_options: false,
      options,
      context: text(record.context, PROMPT_CAP),
      min_words: whole(record.min_words, 1, 3000),
      min_duration_seconds:
        minSeconds !== null && (maxSeconds === null || minSeconds <= maxSeconds)
          ? minSeconds
          : null,
      max_duration_seconds: maxSeconds,
      sheet,
      outputs,
      cautions,
    });
  });

  if (list.length > wanted) {
    dropped.push(
      `The model wrote ${list.length} and you asked for ${wanted}, so the last ${
        list.length - wanted
      } were not offered.`
    );
  }

  return { drafts, dropped, shortBy: Math.max(0, wanted - drafts.length) };
}

/**
 * A draft put back into the shape the review produced.
 *
 * Both authoring doors take their drafts back from the browser, and the row
 * authority calls `.trim()` and `.filter()` on the fields a review always fills.
 * A payload missing one of them throws out of the write loop, which turns the
 * batch the desk promises to refuse one at a time into a server error that names
 * nothing. This repairs the shape only — an empty title, points or option list
 * still reaches `saveQuestion`, where it is refused in the words that screen it.
 */
export function asReviewedDraft(raw: unknown): GeneratedQuestion {
  const record = (raw ?? {}) as Record<string, unknown>;
  const options = Array.isArray(record.options) ? record.options : [];
  const outputs = Array.isArray(record.outputs) ? record.outputs : [];
  const points = Number(record.points);
  const minSeconds = whole(record.min_duration_seconds, 0, 1800);
  const maxSeconds = whole(record.max_duration_seconds, 10, 1800);

  return {
    question_type: record.question_type as QuestionType,
    title: text(record.title, TITLE_CAP),
    prompt: text(record.prompt, PROMPT_CAP),
    instructions: text(record.instructions, 1000),
    points: Number.isFinite(points) ? points : 0,
    time_limit_minutes: whole(record.time_limit_minutes, 1, 480),
    shuffle_options: record.shuffle_options === true,
    options: options.map((entry) => {
      const option = (entry ?? {}) as Record<string, unknown>;
      return {
        text: text(option.text, OPTION_CAP),
        is_correct: option.is_correct === true,
        // A scene's percentages must survive the round trip through the browser;
        // a quiz's options carry none, and null is what the review gave them.
        score:
          typeof option.score === "number" && Number.isFinite(option.score)
            ? option.score
            : null,
      };
    }),
    context: text(record.context, PROMPT_CAP),
    min_words: whole(record.min_words, 1, 3000),
    // The same pair rule the review applies: a pitch that must run longer than
    // its own ceiling is not a limit the recorder can honour.
    min_duration_seconds:
      minSeconds !== null && (maxSeconds === null || minSeconds <= maxSeconds)
        ? minSeconds
        : null,
    max_duration_seconds: maxSeconds,
    sheet: normaliseSheet(record.sheet),
    outputs: outputs.map((entry) => {
      const output = (entry ?? {}) as Record<string, unknown>;
      return {
        cell: text(output.cell, 8).toUpperCase(),
        description: text(output.description, 300),
        formula_hint: text(output.formula_hint, 200) || null,
      };
    }),
    cautions: Array.isArray(record.cautions)
      ? record.cautions.map((line) => text(line, 400)).filter(Boolean)
      : [],
  };
}

/**
 * The row the suite editor writes.
 *
 * A spreadsheet's grid and required cells go through `preserve_config` because
 * that is the field `buildConfig` keeps untouched for `EXCEL_MODEL` — the same
 * door the manual editor uses, so a generated workbook is stored exactly like a
 * hand-authored one and the runner needs no new code path.
 */export function draftForRow(
  draft: GeneratedQuestion,
  templateId: string,
  position: number
): QuestionDraft {
  const config: QuestionConfig =
    draft.question_type === "EXCEL_MODEL"
      ? {
          initial_sheet: { data: draft.sheet },
          expected_outputs: draft.outputs.map((output) => ({
            cell: output.cell,
            description: output.description,
            formula_hint: output.formula_hint ?? undefined,
          })),
        }
      : {};

  return {
    id: null,
    template_id: templateId,
    question_type: draft.question_type,
    title: draft.title,
    prompt: draft.prompt,
    instructions: draft.instructions,
    points: draft.points,
    position,
    time_limit_minutes: draft.time_limit_minutes,
    shuffle_options: draft.shuffle_options,
    options: draft.options,
    context: draft.context,
    min_words: draft.min_words,
    min_duration_seconds: draft.min_duration_seconds,
    max_duration_seconds: draft.max_duration_seconds,
    preserve_config: Object.keys(config).length > 0 ? config : null,
  };
}

// ============================================================================
// Review-desk sentences
// ============================================================================

export function kindsWord(types: QuestionType[]): string {
  const words = types.map((type) => TYPE_WORDS[type]);
  if (words.length === 0) return "no question type";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Says what came back, including what came back short or not at all. */
export function reviewNote(review: DraftReview, wanted: number): string {
  const kept = review.drafts.length;
  if (kept === 0) {
    return review.dropped.length > 0
      ? `Nothing was offered to review — ${review.dropped[0]}`
      : "The model returned no questions.";
  }
  const parts = [
    `${kept} draft${kept === 1 ? "" : "s"} to review${
      review.dropped.length > 0 ? `, ${review.dropped.length} refused` : ""
    }.`,
  ];
  if (review.dropped.length > 0) {
    parts.push("Nothing refused is added to the suite, and none of it is stored.");
  }
  if (wanted > kept) {
    parts.push(
      `You asked for ${wanted}; ${review.shortBy} ${
        review.shortBy === 1 ? "is" : "are"
      } missing, so run it again or add the rest by hand.`
    );
  }
  return parts.join(" ");
}

export function sheetNote(draft: GeneratedQuestion): string {
  return `Ships with ${draft.sheet.length} row${
    draft.sheet.length === 1 ? "" : "s"
  } of figures and asks for ${draft.outputs.length} cell${
    draft.outputs.length === 1 ? "" : "s"
  } to be produced.`;
}

// ============================================================================
// A whole suite, drafted from a job opening
// ============================================================================

/**
 * The suite half of a model reply, reviewed before it can be created.
 *
 * A job opening is not a test: its description sells the role and its
 * requirements list tools, and a model asked to test that will happily write a
 * question about a benefit the candidate never has to reason about. So the suite
 * is reviewed as a shell (name, family, duration) plus the questions, and every
 * field that the suite editor refuses to store is fixed here rather than
 * discovered when the recruiter clicks create.
 */

export const SUITE_JSON_SHAPE = `{
  "suite": {
    "name": "short name a recruiter recognises in a dropdown",
    "description": "one or two sentences telling the candidate what this test covers",
    "role_family": "one of the role families listed below, exactly as written",
    "time_limit_minutes": number,
    "block_copy_paste": boolean
  },
  "questions": [ ...the shape described below... ]
}`;

/** What the reviewer needs beyond the model's reply. */
export interface SuiteReviewContext {
  /** The live `role_families` keys — a suite cannot be filed under a retired one. */
  roleFamilies: string[];
  /** Suite names already on file, so a second copy is named rather than made. */
  existingNames: string[];
  /** `assessment.default_duration_minutes`, used when the model gives no clock. */
  defaultDurationMinutes: number;
}

/** The vacancy a test is written for, in the words the recruiter filed. */
export interface OpeningSeed {
  id: string;
  title: string;
  department: string;
  location: string;
  description: string;
  requirements: string[];
  status: string;
}

/** Everything the prompt is built from, before a model is called. */
export interface SuiteSeedingContext extends SuiteReviewContext {
  opening: OpeningSeed | null;
  /** Where the suite is filed when the model's family is refused. */
  fallbackRoleFamily: string;
}

export interface GeneratedSuite {
  name: string;
  description: string;
  role_family: string;
  time_limit_minutes: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  block_copy_paste: boolean;
  cautions: string[];
}

export interface SuiteReview {
  suite: GeneratedSuite;
  review: DraftReview;
}

const SUITE_NAME_CAP = 120;
const SUITE_DESCRIPTION_CAP = 1000;
const OPENING_COPY_CAP = 1200;
const OPENING_REQUIREMENT_CAP = 160;
const OPENING_REQUIREMENTS_MAX = 14;

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * The vacancy, in the words the recruiter filed, clipped to one prompt block.
 *
 * A job ad is written to sell a role: the salary band, the benefits, the
 * "dynamic team environment". None of it is testable, so the block keeps the
 * title, where the work happens and what the role asks for, and drops the rest.
 * The clip is here rather than in the prompt so a run that reads a long
 * description cannot push the reply past the token budget the gateway sends.
 */
export function openingSeedWords(opening: OpeningSeed): string {
  const requirements = opening.requirements
    .map((requirement) => text(requirement, OPENING_REQUIREMENT_CAP))
    .filter(Boolean)
    .slice(0, OPENING_REQUIREMENTS_MAX);
  const dropped = opening.requirements.filter(Boolean).length - requirements.length;

  const lines = [
    `ROLE: ${text(opening.title, 160)}`,
    `DEPARTMENT: ${text(opening.department, 80) || "not recorded"}`,
    `LOCATION: ${text(opening.location, 80) || "not recorded"}`,
    `WHAT THE OPENING SAYS: ${text(opening.description, OPENING_COPY_CAP) || "nothing was filed"}`,
  ];

  if (requirements.length > 0) {
    lines.push(
      `WHAT THE ROLE ASKS FOR:\n${requirements.map((r) => `- ${r}`).join("\n")}` +
        (dropped > 0 ? `\n(${dropped} further requirements were not carried into this prompt.)` : "")
    );
  }

  return lines.join("\n");
}

/** A suite the recruiter can actually create, plus what they should look at. */
export function reviewSuite(
  parsed: unknown,
  brief: AuthoringBrief,
  context: SuiteSeedingContext
): SuiteReview {
  const record = ((parsed ?? {}) as Record<string, unknown>).suite as
    | Record<string, unknown>
    | undefined;
  const cautions: string[] = [];

  const named = text(record?.name, SUITE_NAME_CAP);
  if (!named) {
    cautions.push("The model named nothing, so this suite needs a name before it can be created.");
  } else if (
    context.existingNames.some((existing) => existing.toLowerCase().trim() === named.toLowerCase().trim())
  ) {
    cautions.push(
      `A suite called “${named}” already exists, so this would be a second copy of the name.`
    );
  }

  const familyRaw = text(record?.role_family, 60);
  const family = familyRaw.toUpperCase().replace(/[\s-]+/g, "_");
  // A family the master-data list does not carry is not stored: the suite opens
  // filed under the family the recruiter was already choosing, and the desk says
  // so, rather than inventing a fifth value the rest of the portal cannot filter.
  const role_family =
    family && context.roleFamilies.includes(family) ? family : context.fallbackRoleFamily;
  if (familyRaw && !context.roleFamilies.includes(family)) {
    cautions.push(
      `“${familyRaw}” is not one of the role families on file, so it opens under ${
        context.fallbackRoleFamily || "a family you must pick"
      }.`
    );
  } else if (!familyRaw) {
    cautions.push(
      `The model gave no role family, so it opens under ${
        context.fallbackRoleFamily || "the family you pick"
      }.`
    );
  }

  const minutes = whole(record?.time_limit_minutes, 5, 480);
  if (minutes === null) {
    cautions.push(
      `No usable duration came back, so it opens at the ${context.defaultDurationMinutes} minutes Settings sets.`
    );
  }

  const blockCopy = bool(record?.block_copy_paste, false);
  if (blockCopy) {
    cautions.push(
      "Copy and paste is blocked, so a candidate cannot paste their own notes or a formula."
    );
  }

  const review = reviewDrafts(parsed, brief);

  // Two drafts can carry the same title inside one run, which the suite's own
  // duplicate check cannot see because neither exists yet.
  const titles = new Map<string, number>();
  for (const draft of review.drafts) {
    const key = draft.title.toLowerCase().trim();
    titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  for (const draft of review.drafts) {
    if ((titles.get(draft.title.toLowerCase().trim()) ?? 0) > 1) {
      draft.cautions.push("Another drafted question carries this same title.");
    }
  }

  // A suite clock shorter than the questions' own limits is a test that cannot
  // be finished, and neither half warns the other on its own.
  const perQuestion = review.drafts.reduce(
    (total, draft) => total + (draft.time_limit_minutes ?? 0),
    0
  );
  const suiteMinutes = minutes ?? context.defaultDurationMinutes;
  if (perQuestion > suiteMinutes) {
    cautions.push(
      `The questions add up to ${perQuestion} minutes of their own against a ${suiteMinutes}-minute suite, so a candidate cannot finish them all.`
    );
  }

  return {
    suite: {
      name: named,
      description: text(record?.description, SUITE_DESCRIPTION_CAP),
      role_family,
      time_limit_minutes: suiteMinutes,
      // Left off for the same reason a drafted quiz ships unshuffled: the model
      // picked the keys, and a shuffled "all of the above" stops being a question.
      randomize_questions: false,
      randomize_options: false,
      block_copy_paste: blockCopy,
      cautions,
    },
    review,
  };
}

/** Total marks the drafted questions carry, so the desk can state the weight. */
export function totalMarks(drafts: GeneratedQuestion[]): number {
  return drafts.reduce((total, draft) => total + draft.points, 0);
}

/** What creating this suite would write, in one sentence. */
/**
 * The kinds inside a drafted suite, counted.
 *
 * "quiz" is the one word in this list that does not take a bare "s", and the
 * sentence a recruiter reads is the only place these counts are shown.
 */
function kindCount(type: QuestionType, count: number): string {
  const word = TYPE_WORDS[type];
  return count === 1 ? word : word.endsWith("z") ? `${word}zes` : `${word}s`;
}

export function suiteReviewNote(review: SuiteReview): string {
  const { suite, review: questions } = review;
  const counts = new Map<QuestionType, number>();
  for (const draft of questions.drafts) {
    counts.set(draft.question_type, (counts.get(draft.question_type) ?? 0) + 1);
  }
  const mix = [...counts.entries()]
    .map(([type, count]) => `${count} ${kindCount(type, count)}`)
    .join(", ");
  return `${questions.drafts.length} question${
    questions.drafts.length === 1 ? "" : "s"
  } (${mix || "none yet"}) worth ${totalMarks(questions.drafts)} marks, over ${
    suite.time_limit_minutes
  } minutes${questions.dropped.length > 0 ? `, with ${questions.dropped.length} refused` : ""}.`;
}
