import type { QuestionConfig, QuestionType } from "@/types";
import type { QuestionDraft } from "@/app/(admin)/assessments/question-actions";
import { refToRowAndColumn } from "./attemptAnswers";

/**
 * What a model is allowed to hand back before it can be offered to a recruiter.
 *
 * A generated question looks finished, which is exactly the danger: a quiz with
 * two options marked correct, a spreadsheet whose required cell is already
 * filled in by the question itself, or a video pitch capped at nine seconds all
 * pass as plausible prose and then fail on a candidate's screen. Everything here
 * decides, from the runner's own rules, whether a draft could actually be sat —
 * and says in one sentence what was refused instead of writing a broken row.
 *
 * `saveQuestion` stays the authority on the database row. Nothing in this file
 * writes; it only turns a model's reply into drafts a human can review, so a
 * draft that slips through here is still refused at the door.
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
      "question_type": "MULTIPLE_CHOICE" | "CASE_STUDY" | "EXCEL_MODEL" | "VIDEO_PITCH",
      "title": "short label for the candidate's contents list",
      "prompt": "the question the candidate is asked",
      "instructions": "one or two lines shown under the question, or an empty string",
      "points": number,
      "time_limit_minutes": number or null,
      "options": [{ "text": "string", "is_correct": boolean }],
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
- "options": MULTIPLE_CHOICE only, 2 to 6 entries, exactly one with "is_correct": true.
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
];

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
      // unanswerable, so the recruiter switches shuffling on once they have read it.
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
 * The row the suite editor writes.
 *
 * A spreadsheet's grid and required cells go through `preserve_config` because
 * that is the field `buildConfig` keeps untouched for `EXCEL_MODEL` — the same
 * door the manual editor uses, so a generated workbook is stored exactly like a
 * hand-authored one and the runner needs no new code path.
 */
export function draftForRow(
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
