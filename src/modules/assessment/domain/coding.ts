/**
 * What a coding question is, and the few rules every door shares.
 *
 * A coding answer is text. The platform has no sandbox, never compiles, never
 * runs, and never tests what a candidate writes; a reviewer reads it. Everything
 * here is about keeping that honest: a closed language list so the review
 * surface can label a fence, a cap so one answer cannot fill the database, and
 * a refusal that names the question rather than the column.
 *
 * Nothing here touches the database.
 */

export const CODING = "CODING" as const;
export const CODING_MIGRATION = "db/migrations/039_coding_questions.sql";
export const CODING_SCHEMA_NOTE =
  "Coding questions need migration 039 (db/migrations/039_coding_questions.sql) to be applied before they can be saved. Nothing was saved.";
export const CODING_WRITE_REFUSAL =
  "Coding questions need migration 039 (db/migrations/039_coding_questions.sql) to be applied before they can be saved. Nothing was saved.";

export const CODING_LANGUAGES = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C#",
  "Go",
  "SQL",
  "PHP",
  "Ruby",
  "C++",
] as const;

export type CodingLanguage = (typeof CODING_LANGUAGES)[number];

/** One answer. Long enough for a real file, short enough to review. */
export const CODE_ANSWER_CAP = 20_000;
/** The snippet an author offers beside the prompt. Never graded. */
export const CODE_STARTER_CAP = 10_000;

export function readCodingLanguage(value: unknown): CodingLanguage | null {
  if (typeof value !== "string") return null;
  const wanted = value.trim().toLowerCase();
  if (wanted.length === 0) return null;
  return CODING_LANGUAGES.find((language) => language.toLowerCase() === wanted) ?? null;
}

export function starterCodeIssue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "The starter code must be text.";
  if (value.length > CODE_STARTER_CAP) {
    return `The starter code is ${value.length.toLocaleString("en-US")} characters; the limit is ${CODE_STARTER_CAP.toLocaleString("en-US")}.`;
  }
  return null;
}

export function codeAnswerOverCap(code: string): boolean {
  return code.length > CODE_ANSWER_CAP;
}

export function codeAnswerOverCapMessage(title: string): string {
  return `Your answer to "${title}" is longer than ${CODE_ANSWER_CAP.toLocaleString("en-US")} characters. Shorten it before submitting; nothing was submitted.`;
}

/**
 * The first over-cap answer, named by its question, or null.
 *
 * Returns a title rather than a question id because the refusal is shown to a
 * candidate, who has never seen an id. A missing title falls back to the id so
 * the message still points somewhere.
 */
export function codeAnswersOverCap(
  answers: Readonly<Record<string, string>>,
  titles: ReadonlyMap<string, string>
): string | null {
  for (const [questionId, code] of Object.entries(answers)) {
    if (typeof code !== "string") continue;
    if (codeAnswerOverCap(code)) return titles.get(questionId) ?? questionId;
  }
  return null;
}

export function codingAnswerAnswered(code: string): boolean {
  return code.trim().length > 0;
}

export function codingLanguageOf(config: { language?: unknown } | null | undefined): CodingLanguage | null {
  return readCodingLanguage(config?.language);
}

const FENCE_TAGS: Record<CodingLanguage, string> = {
  JavaScript: "javascript",
  TypeScript: "typescript",
  Python: "python",
  Java: "java",
  "C#": "csharp",
  Go: "go",
  SQL: "sql",
  PHP: "php",
  Ruby: "ruby",
  "C++": "cpp",
};

export function codingFenceTag(language: string | null | undefined): string {
  const known = readCodingLanguage(language);
  return known ? FENCE_TAGS[known] : "text";
}

/**
 * A fenced block the model can read without the answer breaking out of it.
 *
 * A candidate may legitimately write backticks. The fence is therefore one
 * backtick longer than the longest run in the answer, which is the only way a
 * fixed delimiter can contain arbitrary text.
 */
export function fencedCode(language: string | null | undefined, code: string): string {
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${codingFenceTag(language)}\n${code}\n${fence}`;
}

export function splitCodingAnswers(
  answers: Record<string, string>,
  typeById: ReadonlyMap<string, string>
): { cases: Record<string, string>; code: Record<string, string> } {
  const cases: Record<string, string> = {};
  const code: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(answers)) {
    const questionType = typeById.get(questionId);
    if (questionType === "CASE_STUDY") cases[questionId] = answer;
    else if (questionType === CODING) code[questionId] = answer;
  }
  return { cases, code };
}
