/**
 * One candidate's work, question by question and answer by answer.
 *
 * The grading report on the candidate's record already lists per-question
 * feedback, but it clips each answer to an excerpt and never shows the question
 * itself, its options or the answer key — which is enough to mark a paper and not
 * enough to read one. This is the shape the reading desk works with: the whole
 * prompt, the whole answer, and the paper this candidate was dealt.
 *
 * Pure by design, like the links board, so the server read that fills it and the
 * drawer that prints it agree on one vocabulary.
 */

/** One multiple-choice option, in the order *this* candidate saw it. */
export interface AnswerOption {
  /** The stored handle (`OPT_1`), never shown as-is — the runner never printed it. */
  label: string;
  text: string;
  correct: boolean;
  chosen: boolean;
}

/** A cell the candidate left in a spreadsheet model. */
export interface AnswerCell {
  ref: string;
  value: string;
}

/** One of the outputs the model is meant to produce. */
export interface ExpectedCell {
  ref: string;
  description: string;
  formula_hint: string | null;
}

export interface AttemptAnswer {
  question_id: string;
  title: string;
  prompt: string;
  instructions: string | null;
  question_type: string;
  /** What the question is worth in the suite. */
  points: number;
  /** Whether anything is recorded against this question for this attempt. */
  answered: boolean;

  /**
   * The whole typed answer, unclipped.
   *
   * Null for a quiz, whose pick is carried by `options` and `chosen_text` — the
   * database stores an option handle there, and printing it as prose would show
   * a recruiter `OPT_2`, a string the candidate never saw.
   */
  answer_text: string | null;
  options: AnswerOption[];
  /** The option the candidate picked, resolved to its wording, or null. */
  chosen_text: string | null;
  correct_text: string | null;
  cells: AnswerCell[];
  expected: ExpectedCell[];
  context: string | null;
  min_words: number | null;
  words: number | null;

  video_url: string | null;
  duration_seconds: number | null;
  /** The whole transcript, unclipped. */
  transcript: string | null;

  /** Null when `security.mask_scores_for_reviewers` withholds this reviewer's marks. */
  score: number | null;
  max_score: number | null;
  awarded_by: "STAFF" | "AI" | null;
  rationale: string | null;
  strengths: string[];
  improvements: string[];
  saved_at: string | null;
}

export interface AttemptAnswers {
  attempt_id: string;
  application_id: string;
  candidate_name: string;
  job_title: string | null;
  template_name: string;
  status: string;
  scores_masked: boolean;

  answered: number;
  questions: number;
  score: number | null;
  max_score: number | null;

  time_limit_minutes: number;
  started_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  integrity_flags: number;

  /**
   * Whether the order below is this candidate's own paper rather than the suite's
   * authored sequence. The runner deals and stores the order per attempt, so a
   * shuffled suite can be read in the order it was actually sat.
   */
  dealt_from_order: boolean;

  answers: AttemptAnswer[];
}

/**
 * What the desk holds.
 *
 * A suite carries tens of questions, so this read is uncapped and the sentence
 * can say so — unlike the links board, which counts a window. Naming the
 * unanswered questions matters as much as the answered ones: "question by
 * question" means the whole paper, including the gaps.
 */
export function answersScopeNote(answers: AttemptAnswers): string {
  if (answers.questions === 0) {
    return `The suite this link was issued from holds no questions now, so this is everything the candidate had to answer — nothing.`;
  }
  const open = answers.questions - answers.answered;
  const progress =
    open === 0
      ? `All ${answers.questions} questions were answered.`
      : `${answers.answered} of ${answers.questions} questions answered — the other ${open} left no record.`;
  const order = answers.dealt_from_order
    ? " Listed in the order this candidate was dealt it."
    : " Listed in the suite's own order.";
  return `${progress}${order}`;
}

/**
 * One line saying what this question asked for and what came back.
 *
 * Written per type because the four types store their answers in four different
 * columns, and a desk that only showed `answer_text` would report a video pitch
 * or a spreadsheet model as blank.
 */
export function answerStateWord(answer: AttemptAnswer): string {
  if (!answer.answered) {
    return answer.question_type === "MULTIPLE_CHOICE" ? "No option picked" : "Left blank";
  }
  switch (answer.question_type) {
    case "MULTIPLE_CHOICE":
      return answer.chosen_text ? "An option was picked" : "An answer was recorded";
    case "EXCEL_MODEL":
      return answer.cells.length === 0
        ? "The sheet was handed back unchanged"
        : `${answer.cells.length} cell${answer.cells.length === 1 ? "" : "s"} changed`;
    case "VIDEO_PITCH":
      return answer.video_url ? "A recording was made" : "A recording is on file";
    case "CASE_STUDY":
      return answer.words === null
        ? "Written answer on file"
        : `${answer.words} word${answer.words === 1 ? "" : "s"} written`;
    default:
      return "Answer on file";
  }
}

/** `75` becomes "1:15" so a pitch's length reads like a length. */
export function durationWord(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Words in a typed answer, counted the same way the desk reports them. */
export function countWords(text: string | null): number | null {
  if (!text) return null;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length === 0 ? null : words.length;
}

/** `0` → "A", `26` → "AA" — the same letters the runner's grid labels its columns with. */
export function columnLetters(index: number): string {
  let n = index;
  let name = "";
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

const CELL_REF = /^([A-Z]+)([0-9]+)$/;

export function refToRowAndColumn(ref: string): { row: number; col: number } | null {
  const match = CELL_REF.exec(ref);
  if (!match) return null;
  const col = match[1]
    .split("")
    .reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return { col, row: parseInt(match[2], 10) - 1 };
}

function sameValue(stored: unknown, given: string | number | null): boolean {
  if (stored === null || stored === undefined) return given === null;
  return String(stored) === String(given);
}

/**
 * The cells this candidate changed, against the sheet they were handed.
 *
 * The runner saves every non-empty cell of the grid, so the values the question
 * shipped with are stored alongside the candidate's own work. Listing them back
 * as "their answer" would credit a headline row to the person who only typed the
 * total beneath it — and would hide a cell they deliberately cleared. This
 * compares each stored cell with `initial_sheet` at the same address: what
 * differs is theirs, and a cell that now holds nothing where the seed had
 * something is a change too, so it is reported as an empty one.
 */
export function changedCellsOf(
  state: Record<string, { value?: string | number | null }> | null | undefined,
  initial: (string | number | null)[][] | null | undefined
): AnswerCell[] {
  if (!state) return [];
  const given = (ref: string): string | number | null => {
    const at = refToRowAndColumn(ref);
    if (!at || !initial) return null;
    return initial[at.row]?.[at.col] ?? null;
  };
  const cleared = new Set<string>();
  const changed: AnswerCell[] = [];

  for (const [ref, cell] of Object.entries(state)) {
    const seed = given(ref);
    const value = cell?.value ?? null;
    if (value === null || value === "") {
      if (seed !== null && seed !== "") cleared.add(ref);
      continue;
    }
    if (sameValue(value, seed)) continue;
    changed.push({ ref, value: String(value) });
  }

  // A cell the candidate deleted holds nothing, so the saved map has no key for
  // it at all — the seed has to be walked to find those.
  for (const [rowIndex, row] of (initial ?? []).entries()) {
    for (const [colIndex, seed] of row.entries()) {
      if (seed === null || seed === "") continue;
      const ref = `${columnLetters(colIndex)}${rowIndex + 1}`;
      if (state[ref] !== undefined) continue;
      cleared.add(ref);
    }
  }

  for (const ref of cleared) changed.push({ ref, value: "cleared" });

  return changed.sort((a, b) => {
    const at = refToRowAndColumn(a.ref);
    const bt = refToRowAndColumn(b.ref);
    if (!at || !bt) return a.ref.localeCompare(b.ref);
    return at.row - bt.row || at.col - bt.col;
  });
}

