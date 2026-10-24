# Coding Question Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth question type, CODING, whose candidates write source code in a plain textarea and whose reviewers see it preformatted, gated behind authored-but-unapplied migration 039.

**Architecture:** CODING reuses the existing answer and grading plumbing rather than adding a new one. The answer travels in its own `code_answers_map` (never merged with `case_study_answers_map`), is stored as text in `candidate_responses.answer_text`, and is graded through the existing rubric path when the question carries criteria and through a new `evaluateCodeSubmission` engine call on `case_reasoning` when it does not. Availability is probed the same way situational judgment is: a head-count query that fails with 22P02 on an enum that lacks the label. Nothing compiles, runs, or tests candidate code anywhere in the stack.

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript 5, Tailwind 4, vanilla Node test/proof scripts, self-hosted PostgREST + Postgres.

**Spec:** [docs/superpowers/specs/2026-10-24-skill-rollup-and-coding-questions-design.md](file:///D:/Nextjs%20Projects/sharm_dreams_group/docs/superpowers/specs/2026-10-24-skill-rollup-and-coding-questions-design.md)

## Global Constraints

- Migration 039 is authored, never applied. Do not run `db:apply-local`, `docker:psql`, or any DDL against a database.
- Never compile, run, lint, or execute candidate code. There is no sandbox and no editor dependency; the answer is text.
- Render every code surface as text (`<pre>`, `whitespace-pre-wrap`), never as HTML or MDX.
- No new dependency for the answer box. A `<textarea>` with monospace styling is the whole editor.
- Do not touch the candidate portal, `NoticeInbox`, or `communication_logs`.
- Do not modify `src/modules/shell/domain/pageGuide.ts` counts outside the tasks that own them; the Guide is pinned by proof scripts.
- Every task ends green: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` and `npm run lint` must pass at each commit.
- Proof scripts are run with plain `node scripts/<name>.mjs`. `prove-migration-claims.mjs` needs the local Docker database and is deferred to the final gate task.
- Commit style: conventional lowercase subject, then a body that explains the why.

---

### Task 1: Migration 039 and the coding domain module

**Files:**
- Create: `db/migrations/039_coding_questions.sql`
- Create: `src/modules/assessment/domain/coding.ts`
- Create: `src/modules/assessment/domain/questionWriteErrors.ts`
- Create: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: `isMissingQuestionTypeError` from `@/modules/assessment/domain/situational` (signature `(error: { code?: string | null; message?: string }) => boolean`).
- Produces:
  - `CODING = "CODING" as const`
  - `CODING_MIGRATION = "db/migrations/039_coding_questions.sql"`
  - `CODING_SCHEMA_NOTE: string`
  - `CODING_WRITE_REFUSAL: string`
  - `CODING_LANGUAGES: readonly ["JavaScript","TypeScript","Python","Java","C#","Go","SQL","PHP","Ruby","C++"]`
  - `type CodingLanguage = (typeof CODING_LANGUAGES)[number]`
  - `CODE_ANSWER_CAP = 20_000`, `CODE_STARTER_CAP = 10_000`
  - `readCodingLanguage(value: unknown): CodingLanguage | null`
  - `starterCodeIssue(value: unknown): string | null`
  - `codeAnswerOverCap(code: string): boolean`
  - `codeAnswersOverCap(answers: Readonly<Record<string,string>>, titles: ReadonlyMap<string,string>): string | null`
  - `codeAnswerOverCapMessage(title: string): string`
  - `codingAnswerAnswered(code: string): boolean`
  - `codingLanguageOf(config: { language?: unknown } | null | undefined): CodingLanguage | null`
  - `codingFenceTag(language: string | null | undefined): string`
  - `fencedCode(language: string | null | undefined, code: string): string`
  - `splitCodingAnswers(answers: Record<string,string>, typeById: ReadonlyMap<string,string>): { cases: Record<string,string>; code: Record<string,string> }`
  - `questionWriteError(questionType: string, error: { code?: string | null; message: string }): string` from `questionWriteErrors.ts`

- [ ] **Step 1: Write the migration**

Create `db/migrations/039_coding_questions.sql`:

```sql
-- 039_coding_questions.sql
--
-- A sixth question type: CODING.
--
-- The candidate is given a prompt (and optionally a language and a starter
-- snippet) and writes source code into a plain text answer box. Nothing in this
-- platform compiles, runs or tests that code. The stack has no sandbox, and a
-- reviewer reading the submission is the only thing that ever evaluates it. The
-- type exists so a code answer has its own shape, its own cap (20,000
-- characters) and its own review surface instead of being smuggled into a case
-- study.
--
-- NOT APPLIED. This file is authored so the runner, the authoring drawer and
-- the proofs can agree on the label ahead of time. Every door that writes a
-- CODING row checks the enum first and refuses with a note naming this
-- migration. Apply it deliberately, with the same approval any other schema
-- change needs.

alter type public.question_type add value if not exists 'CODING';

-- PostgREST caches enum labels. Until this runs, a CODING write is rejected
-- with 22P02 and the UI reports the migration as missing rather than broken.
notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write the failing domain test**

Create `scripts/prove-coding-question.mjs`:

```js
/* scripts/prove-coding-question.mjs
 * Run: node scripts/prove-coding-question.mjs
 *
 * The sixth question type is text a candidate writes and a person reads. What
 * can be pinned without a database or a provider is the part every door shares:
 * the migration that adds the label, the closed language list, the two caps, the
 * split that keeps code out of the case-study map, and the sentences an author,
 * a candidate and a reviewer are shown.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// Modules under test import through the app's `@/` alias and through
// extensionless sibling paths, and one of them starts with `import
// "server-only"`. Plain Node resolves none of those, so teach this one process
// the bundler's mapping before any dynamic import runs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
        ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
        : null;
    if (base) {
      for (const candidate of [base, `${base}.ts`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function sourceHas(name, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(name, missing.length === 0, missing.map((n) => `missing ${JSON.stringify(n)}`).join(", "));
}

const {
  CODING,
  CODING_LANGUAGES,
  CODE_ANSWER_CAP,
  CODE_STARTER_CAP,
  readCodingLanguage,
  starterCodeIssue,
  codeAnswerOverCap,
  codeAnswersOverCap,
  codeAnswerOverCapMessage,
  codingAnswerAnswered,
  codingLanguageOf,
  codingFenceTag,
  fencedCode,
  splitCodingAnswers,
} = await import(pathToFileURL(path.join(root, "src/modules/assessment/domain/coding.ts")).href);

check("the label is CODING", CODING === "CODING");
check("the language list is the ten the spec names", CODING_LANGUAGES.length === 10, String(CODING_LANGUAGES.length));
check("the answer cap is 20,000", CODE_ANSWER_CAP === 20_000, String(CODE_ANSWER_CAP));
check("the starter cap is 10,000", CODE_STARTER_CAP === 10_000, String(CODE_STARTER_CAP));

check("a known language reads back", readCodingLanguage("python") === "Python");
check("a padded, odd-cased language reads back trimmed", readCodingLanguage("  jAvAsCrIpT ") === "JavaScript");
check("c# survives the lowercase match", readCodingLanguage("C#") === "C#");
check("c++ survives the lowercase match", readCodingLanguage("c++") === "C++");
check("an unknown language is refused", readCodingLanguage("COBOL") === null);
check("a non-string language is refused", readCodingLanguage(7) === null);
check("an empty language is refused", readCodingLanguage("   ") === null);

check("an empty starter is fine", starterCodeIssue(undefined) === null && starterCodeIssue("") === null);
check("a 10,000-character starter is fine", starterCodeIssue("x".repeat(CODE_STARTER_CAP)) === null);
check("a 10,001-character starter is refused", typeof starterCodeIssue("x".repeat(CODE_STARTER_CAP + 1)) === "string");
check("a starter is refused in words that name the limit", /10,000/.test(starterCodeIssue("x".repeat(CODE_STARTER_CAP + 1)) ?? ""));

check("a code answer at the cap fits", codeAnswerOverCap("x".repeat(CODE_ANSWER_CAP)) === false);
check("one character over the cap does not", codeAnswerOverCap("x".repeat(CODE_ANSWER_CAP + 1)) === true);
check("an empty answer is answered=false", codingAnswerAnswered("") === false);
check("a whitespace answer is answered=false", codingAnswerAnswered(" \n\t ") === false);
check("a real answer is answered=true", codingAnswerAnswered("print(1)") === true);

const titles = new Map([
  ["q1", "Two-sum warm-up"],
  ["q2", "Flatten a tree"],
]);
const over = codeAnswersOverCap(
  { q1: "x".repeat(CODE_ANSWER_CAP + 1), q2: "print(1)" },
  titles
);
check("the first over-cap answer names its question", over === "Two-sum warm-up", String(over));
check("a map inside the caps names nothing", codeAnswersOverCap({ q1: "print(1)" }, titles) === null);
check("a question with no title still names something", /q9/.test(codeAnswersOverCap({ q9: "x".repeat(CODE_ANSWER_CAP + 1) }, titles) ?? ""));
check(
  "the refusal message names the question and the cap",
  /Two-sum warm-up/.test(codeAnswerOverCapMessage("Two-sum warm-up")) &&
    /20,000/.test(codeAnswerOverCapMessage("Two-sum warm-up"))
);

check("a stored config language reads back", codingLanguageOf({ language: "go" }) === "Go");
check("a config with no language reads back null", codingLanguageOf({}) === null);
check("a null config reads back null", codingLanguageOf(null) === null);

check("c++ fences as cpp", codingFenceTag("C++") === "cpp");
check("c# fences as csharp", codingFenceTag("C#") === "csharp");
check("an unknown fence tag is plain text", codingFenceTag(null) === "text");
const fenced = fencedCode("Python", "print('```')\nprint(1)");
check("the fence outruns any backticks in the answer", fenced.startsWith("````python\n"), fenced.slice(0, 20));
check("the fence closes with four backticks", fenced.trimEnd().endsWith("````"));

const { cases, code } = splitCodingAnswers(
  { q1: "a case answer", q2: "code here", q3: "another case" },
  new Map([
    ["q1", "CASE_STUDY"],
    ["q2", "CODING"],
    ["q3", "CASE_STUDY"],
  ])
);
check("the case map holds only case studies", JSON.stringify(cases) === JSON.stringify({ q1: "a case answer", q3: "another case" }), JSON.stringify(cases));
check("the code map holds only coding answers", JSON.stringify(code) === JSON.stringify({ q2: "code here" }), JSON.stringify(code));
check(
  "an answer for a question not in the paper goes nowhere",
  Object.keys(splitCodingAnswers({ ghost: "x" }, new Map()).cases).length === 0 &&
    Object.keys(splitCodingAnswers({ ghost: "x" }, new Map()).code).length === 0
);

sourceHas("the migration adds the label idempotently", "db/migrations/039_coding_questions.sql", [
  "alter type public.question_type add value if not exists 'CODING';",
  "notify pgrst, 'reload schema';",
  "NOT APPLIED",
]);
sourceHas("the domain never names a dependency that would run code", "src/modules/assessment/domain/coding.ts", [
  "Nothing here touches the database.",
]);
check(
  "the domain imports no executor",
  !/child_process|vm\.|eval\(|new Function/.test(read("src/modules/assessment/domain/coding.ts"))
);

const { questionWriteError } = await import(
  pathToFileURL(path.join(root, "src/modules/assessment/domain/questionWriteErrors.ts")).href
);
check(
  "an enum miss on a coding write names migration 039",
  /039/.test(questionWriteError("CODING", { code: "22P02", message: "invalid input value for enum question_type: \"CODING\"" }))
);
check(
  "an enum miss on another type passes the database words through",
  questionWriteError("CASE_STUDY", { code: "22P02", message: "some other error" }) === "some other error"
);
check(
  "a non-enum error on a coding write passes the database words through",
  questionWriteError("CODING", { code: "23505", message: "duplicate key" }) === "duplicate key"
);

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/modules/assessment/domain/coding.ts`.

- [ ] **Step 4: Write the domain module**

Create `src/modules/assessment/domain/coding.ts`:

```ts
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
```

- [ ] **Step 5: Write the write-error module**

Create `src/modules/assessment/domain/questionWriteErrors.ts`:

```ts
import { CODING, CODING_WRITE_REFUSAL } from "@/modules/assessment/domain/coding";
import { isMissingQuestionTypeError } from "@/modules/assessment/domain/situational";

/**
 * A question write failed. Say the useful thing.
 *
 * `saveQuestion` lives in a `"use server"` module, so it cannot be exercised by
 * the plain-Node proofs. The translation lives here instead: a type that this
 * database's enum does not have is a missing migration, not a broken request,
 * and the author is told which migration and that nothing was written.
 */
export function questionWriteError(
  questionType: string,
  error: { code?: string | null; message: string }
): string {
  if (questionType === CODING && isMissingQuestionTypeError(error)) return CODING_WRITE_REFUSAL;
  return error.message;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node scripts/prove-coding-question.mjs`
Expected: PASS, printing `NN checks passed`.

- [ ] **Step 7: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/039_coding_questions.sql src/modules/assessment/domain/coding.ts src/modules/assessment/domain/questionWriteErrors.ts scripts/prove-coding-question.mjs
git commit -m "feat(assessments): give a coding answer its own shape" -m "Authored, unapplied migration 039 adds the CODING label to question_type. The domain module holds the closed language list, the 20,000-character answer cap, the 10,000-character starter cap and the pure helpers every door will share, so the runner, the authoring drawer and the review surfaces cannot disagree about what a coding answer is."
```

---

### Task 2: Availability probe learns coding

**Files:**
- Modify: `src/modules/assessment/application/questionTypeAvailability.ts:1-47`
- Modify: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: `CODING` from `coding.ts` (Task 1).
- Produces: `QuestionTypeAvailability` becomes `{ situational: boolean; coding: boolean; note: string | null; codingNote: string | null }`; `readQuestionTypeAvailability(restClient)` keeps its single argument.

- [ ] **Step 1: Write the failing test**

Append to `scripts/prove-coding-question.mjs`, before the failure summary:

```js
// ---------------------------------------------------------------------------
// The availability probe asks the database once per type.
// ---------------------------------------------------------------------------
const { readQuestionTypeAvailability } = await import(
  pathToFileURL(path.join(root, "src/modules/assessment/application/questionTypeAvailability.ts")).href
);

function fakeClient(failingType) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          queries.push({ table, column, value });
          return query;
        },
        then(resolve, reject) {
          const failed = failingType !== null && value === failingType;
          return Promise.resolve(
            failed
              ? { data: null, count: null, error: { code: "22P02", message: 'invalid input value for enum public.question_type: "CODING"' } }
              : { data: null, count: 3, error: null }
          ).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

{
  const client = fakeClient(null);
  const availability = await readQuestionTypeAvailability(client);
  check(
    "both types are available when both probes succeed",
    availability.situational === true && availability.coding === true,
    JSON.stringify(availability)
  );
  check("neither note is written when both types are available", availability.note === null && availability.codingNote === null);
  check(
    "one probe is issued per type",
    client.queries.length === 2,
    JSON.stringify(client.queries)
  );
  check(
    "the coding probe asks about CODING",
    client.queries.some((query) => query.value === "CODING"),
    JSON.stringify(client.queries)
  );
}

{
  const availability = await readQuestionTypeAvailability(fakeClient("CODING"));
  check("coding alone can be missing", availability.situational === true && availability.coding === false);
  check("the situational note is not written when only coding is missing", availability.note === null);
  check("the coding note names migration 039", /039/.test(availability.codingNote ?? ""), String(availability.codingNote));
  check(
    "the coding note promises no retry that cannot work",
    !/try again|retry/i.test(availability.codingNote ?? ""),
    String(availability.codingNote)
  );
}

{
  const availability = await readQuestionTypeAvailability(fakeClient("SITUATIONAL_JUDGMENT"));
  check("situational alone can be missing", availability.situational === false && availability.coding === true);
  check("the coding note is not written when only situational is missing", availability.codingNote === null);
  check("the situational note still names migration 034", /034/.test(availability.note ?? ""), String(availability.note));
}
```

The probe module has `import "server-only"` at the top and imports its two domain modules through the `@/` alias. The hook added at the top of this file resolves both, so the dynamic import below reaches the real module.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — `availability.coding` is `undefined` and `availability.codingNote` is `undefined`.

- [ ] **Step 3: Rewrite the probe**

Replace `src/modules/assessment/application/questionTypeAvailability.ts` in full:

```ts
import "server-only";
import type { RestClient } from "@/lib/rest/client";
import { CODING, CODING_SCHEMA_NOTE } from "@/modules/assessment/domain/coding";
import {
  SITUATIONAL_JUDGMENT,
  SITUATIONAL_SCHEMA_NOTE,
  isMissingQuestionTypeError,
} from "@/modules/assessment/domain/situational";

export interface QuestionTypeAvailability {
  situational: boolean;
  coding: boolean;
  note: string | null;
  codingNote: string | null;
}

/**
 * Which of the newer question types this database's enum actually has.
 *
 * Both labels are newer than the deployed schema, so both are checked the same
 * way: a head-count query that fails with 22P02 until its migration runs. The
 * two probes are issued together, and each absence is reported separately — a
 * missing 039 must not hide an available 034.
 */
export async function readQuestionTypeAvailability(
  restClient: RestClient
): Promise<QuestionTypeAvailability> {
  const [situationalError, codingError] = await Promise.all([
    probe(restClient, SITUATIONAL_JUDGMENT),
    probe(restClient, CODING),
  ]);

  return {
    situational: situationalError === null,
    coding: codingError === null,
    note:
      situationalError === null
        ? null
        : isMissingQuestionTypeError(situationalError)
          ? SITUATIONAL_SCHEMA_NOTE
          : `Situational judgment questions could not be checked on this database: ${situationalError.message}.`,
    codingNote:
      codingError === null
        ? null
        : isMissingQuestionTypeError(codingError)
          ? CODING_SCHEMA_NOTE
          : `Coding questions could not be checked on this database: ${codingError.message}.`,
  };
}

async function probe(
  restClient: RestClient,
  questionType: string
): Promise<{ code?: string | null; message: string } | null> {
  const { error } = await restClient
    .from("assessment_questions")
    .select("id", { count: "exact", head: true })
    .eq("question_type", questionType);
  return error ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/prove-coding-question.mjs`
Expected: PASS.

- [ ] **Step 5: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Expected: non-zero — every call site destructuring the old shape is now incomplete, which the next task repairs. Commit only after Step 6.

- [ ] **Step 6: Repair the two call sites so the tree is green**

`src/app/(admin)/assessments/page.tsx` and `src/app/(admin)/questions/actions.ts` and `src/app/(admin)/assessments/actions.ts` read this value. At this stage the new fields are not yet threaded to the editor (Task 4 does that). Thread only what the types require:

In `src/app/(admin)/assessments/page.tsx`, the destructure around line 54 becomes:

```ts
    availability,
```

and the grid receives the whole object. Locate the `Promise.all` entry (currently `getQuestionTypeAvailability()`) and keep the call; change the destructure from `situational` to `availability`, and at the `<AssessmentGrid … />` call replace `situational={situational}` with `situational={availability}`.

In `src/app/(admin)/questions/actions.ts` (around lines 104-119) and `src/app/(admin)/assessments/actions.ts` (around lines 217-220), update any local type annotation from `{ situational: boolean; note: string | null }` to `QuestionTypeAvailability`, imported from `@/modules/assessment/application/questionTypeAvailability`.

Run `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"` again. Expected: exit 0. If `AssessmentGrid`'s prop type still says `{ situational: boolean; note: string | null }`, widen it to `QuestionTypeAvailability` (import the type) — the extra fields are unused until Task 4.

- [ ] **Step 7: Run lint and commit**

Run: `npm run lint; echo "lint exit=$?"`
Expected: exit 0.

```bash
git add src/modules/assessment/application/questionTypeAvailability.ts scripts/prove-coding-question.mjs "src/app/(admin)/assessments/page.tsx" "src/app/(admin)/questions/actions.ts" "src/app/(admin)/assessments/actions.ts" "src/app/(admin)/assessments/AssessmentGrid.tsx"
git commit -m "feat(assessments): ask the database about coding questions too" -m "The availability probe now issues one head-count per newer type and reports each absence separately, so a missing 039 does not hide an applied 034. Call sites carry the wider shape; no screen reads the coding fields yet."
```

---

### Task 3: The sixth type reaches the shared vocabulary

**Files:**
- Modify: `src/types/index.ts:30-35`, `:217-237`
- Modify: `src/stores/useAssessmentStore.ts:6-27`, `:59-66`
- Modify: `src/app/(admin)/assessments/QuestionEditorDrawer.tsx:76-124`
- Modify: `src/modules/questions/bank.ts:79-93`
- Modify: `src/modules/assessment/domain/aiAuthoring.ts:41-47`
- Modify: `src/app/api/attempt/[token]/route.ts:119-156` (allow-list only)
- Modify: `src/app/(admin)/assessments/question-actions.ts:62-68` (unchanged content, but re-verify), `:82-115`, `:190-250` (allow-list untouched)
- Modify: `scripts/prove-scoring-rubric.mjs` (GET sanitizer test)
- Modify: `scripts/prove-situational.mjs:562` (member count pin)

**Interfaces:**
- Consumes: `CodingLanguage`, `CODING_LANGUAGES`, `readCodingLanguage` from `coding.ts` (Task 1).
- Produces: `QuestionType` includes `"CODING"`; `QuestionConfig` includes `language?: string` and `starter_code?: string`; `AttemptQuestionClient` union includes `"CODING"`; `AttemptDraftClient` includes `code_answers_map: Record<string,string>`; `TYPE_LABELS` / `TYPE_HINTS` / `RUBRIC_NOTES` / `TYPE_WORDS` / `SUITE_KINDS` cover CODING; the GET sanitizer passes `language` and `starter_code` through.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/prove-coding-question.mjs`:

```js
// ---------------------------------------------------------------------------
// The sixth type is everywhere the first five are.
// ---------------------------------------------------------------------------
sourceHas("the model type gains CODING", "src/types/index.ts", [
  '"CODING"',
  "language?: string",
  "starter_code?: string",
]);
sourceHas("the runner's store knows the sixth type", "src/stores/useAssessmentStore.ts", [
  '| "CODING"',
  "language?: string",
  "starter_code?: string",
]);
sourceHas("the editor has words for CODING", "src/app/(admin)/assessments/QuestionEditorDrawer.tsx", [
  "CODING:",
]);
sourceHas("the bank files a coding question", "src/modules/questions/bank.ts", [
  "CODING:",
]);
sourceHas("the drafting contract knows the sixth type", "src/modules/assessment/domain/aiAuthoring.ts", [
  "CODING:",
]);
sourceHas("the GET allow-list carries the two new config keys", "src/app/api/attempt/[token]/route.ts", [
  "source.language",
  "source.starter_code",
]);
check(
  "the manual type picker still hides CODING",
  !/QUESTION_TYPES[^=]*=\s*\[[^\]]*"CODING"/s.test(read("src/app/(admin)/assessments/question-actions.ts")),
  "question-actions QUESTION_TYPES should not include CODING until Task 4"
);
```

The GET sanitizer test belongs in `scripts/prove-scoring-rubric.mjs`, which is a `node --test` file with `assert`, not a `check` script. Add this test after the existing boundary tests (after the block that ends around line 335):

```js
test("a coding question reaches the runner with its language and starter, and nothing else", async () => {
  const codingRow = {
    id: "q-code",
    template_id: "suite-1",
    question_type: "CODING",
    title: "Flatten a nested list",
    prompt: "Write a function that flattens arbitrary nesting.",
    points: 10,
    position: 4,
    config: {
      language: "Python",
      starter_code: "def flatten(x):",
      initial_sheet: { data: [["leak"]] },
      expected_outputs: [{ cell: "A1", description: "leak", formula_hint: "leak" }],
    },
  };
  const { get } = harness({
    candidate_attempts: [attemptRow],
    assessment_templates: [{ id: "suite-1", name: "Front office" }],
    assessment_questions: [...paperRows, codingRow],
  });
  const body = await get("token-1");
  assert.deepEqual(configOf(body, "q-code"), {
    language: "Python",
    starter_code: "def flatten(x):",
  });
});
```

This test fails today because the sanitizer does not copy either key. It needs no new harness binding: the route does not import `coding.ts` yet, and `language`/`starter_code` are already on `QuestionConfig` from Step 3.

Update `scripts/prove-situational.mjs:560`:

```js
sourceHas("the model type has six members", "src/types/index.ts", ['"SITUATIONAL_JUDGMENT"', '"CODING"', "score?: number"]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/prove-coding-question.mjs`
Run: `node scripts/prove-situational.mjs`
Run: `node --test scripts/prove-scoring-rubric.mjs`
Expected: each FAILs on the new assertions (CODING missing from the union, the records, and the allow-list).

- [ ] **Step 3: Widen the shared types**

In `src/types/index.ts`, `QuestionType` (lines 30-35) becomes:

```ts
export type QuestionType =
  | "EXCEL_MODEL"
  | "VIDEO_PITCH"
  | "CASE_STUDY"
  | "MULTIPLE_CHOICE"
  | "SITUATIONAL_JUDGMENT"
  | "CODING";
```

`QuestionConfig` (lines 217-237) gains, after `options` and before `rubric`:

```ts
  /** CODING only: the closed language list entry the author picked. */
  language?: string;
  /** CODING only: a snippet shown read-only beside the prompt. Never graded. */
  starter_code?: string;
```

Do not relax any existing key. Do not add a key the allow-lists do not name.

- [ ] **Step 4: Fill every exhaustive registry**

`src/stores/useAssessmentStore.ts` — `AttemptQuestionClient.question_type` union (lines 6-27) gains `| "CODING"`, and the config block gains:

```ts
  language?: string;
  starter_code?: string;
```

Nothing else in the store changes in this task. `AttemptDraftClient`, `initialState`, `loadAttempt` and the setters all wait for Task 6, because the payload does not carry `code_answers_map` until the GET route is split.

`src/app/(admin)/assessments/QuestionEditorDrawer.tsx` — `TYPE_LABELS` and `TYPE_HINTS` gain a CODING entry. Do not unhide the type, and do not touch `RUBRIC_NOTES`: CODING is not a `RubricType` until Task 9, so an entry there is a type error.

```ts
// TYPE_LABELS
  CODING: "Coding",
// TYPE_HINTS
  CODING: "The candidate writes code in a plain text box. Nothing runs it.",
```

`src/modules/questions/bank.ts` — `KIND_LABELS` is `Record<BankKind, string>`; add `CODING: "Written"` for consistency. `SUITE_KINDS` is exhaustive:

```ts
  CODING: "written",
```

`src/modules/assessment/domain/aiAuthoring.ts` — `TYPE_WORDS` (lines 41-47) is exhaustive:

```ts
  CODING: "coding task",
```

Leave `QUESTION_TYPES` (138-144) at five and `QUESTION_RULES` (153-160) untouched until Task 5; the drafting door must not accept CODING before its contract knows how to check one.

- [ ] **Step 5: Widen the GET sanitizer**

In `src/app/api/attempt/[token]/route.ts`, the allow-list block (lines 119-156) gains, after the `expected_outputs` block and before the return:

```ts
    if (source.language) config.language = source.language;
    if (source.starter_code) config.starter_code = source.starter_code;
```

Do not copy these by spread; the point of the allow-list is that nothing else travels. The draft reconstruction (173-200) is unchanged in this task — Task 6 splits it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node scripts/prove-coding-question.mjs`
Run: `node scripts/prove-situational.mjs`
Run: `node --test scripts/prove-scoring-rubric.mjs`
Expected: PASS on all three. If `prove-scoring-rubric.mjs` documents its harness differently than assumed, adapt the new test to the file's real exports rather than changing the harness.

- [ ] **Step 7: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0. Any remaining compiler error names a record that needs its CODING entry — add it rather than widening the record's type.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/stores/useAssessmentStore.ts "src/app/(admin)/assessments/QuestionEditorDrawer.tsx" src/modules/questions/bank.ts src/modules/assessment/domain/aiAuthoring.ts "src/app/api/attempt/[token]/route.ts" scripts/prove-coding-question.mjs scripts/prove-situational.mjs scripts/prove-scoring-rubric.mjs
git commit -m "feat(assessments): teach the shared vocabulary a sixth question type" -m "QuestionType, the runner's draft shape, the editor's labels and the bank's filing all learn CODING in one commit, because the exhaustive Records would otherwise stop compiling between them. The type stays hidden in the picker and unaccepted by the drafting door until each has its own rules. The GET allow-list passes only language and starter_code."
```

---

### Task 4: Authors can describe a coding question

**Files:**
- Modify: `src/app/(admin)/assessments/question-actions.ts` (`QUESTION_TYPES` 62-68, `QuestionDraft` 82-115, `buildConfig` 190-250, `saveQuestion` 289-438)
- Modify: `src/app/(admin)/assessments/QuestionEditorDrawer.tsx` (props 224-264, `Draft` 108-124, `toDraft` 167-219, submit payload 388-436, type select 491-507, new fields, availability note 1060-1064)
- Modify: `src/app/(admin)/assessments/AssessmentGrid.tsx:891-917`, `:1242-1243`
- Modify: `src/app/(admin)/assessments/BankBoard.tsx:682-683`
- Modify: `src/app/(admin)/assessments/page.tsx` (threading)
- Modify: `src/app/(admin)/questions/actions.ts:104-105`, `:119`, `:169`
- Modify: `src/modules/shell/domain/pageGuide.ts:252-308`
- Modify: `scripts/prove-rubric-review-ui.mjs` (editor props + new cases)
- Modify: `scripts/prove-scoring-rubric.mjs` (authoring harness + `saveQuestion` cases)
- Modify: `scripts/prove-situational.mjs:728-736` (guide count)

**Interfaces:**
- Consumes: `codingAvailable`/`codingNote` from the availability object; `CODING_LANGUAGES`, `readCodingLanguage`, `starterCodeIssue`, `CODE_STARTER_CAP` from `coding.ts`; `questionWriteError` from `questionWriteErrors.ts`.
- Produces: `QuestionDraft` gains `language?: string; starter_code?: string`; `saveQuestion` accepts CODING and refuses with the probe's note when unavailable; editor props gain `codingAvailable?: boolean; codingNote?: string | null`.

- [ ] **Step 1: Write the failing tests**

Two proof files grow, and each grows in its own idiom. `prove-rubric-review-ui.mjs` drives the drawer through its render harness; `prove-scoring-rubric.mjs` runs the real `saveQuestion` through its authoring harness.

First, `scripts/prove-rubric-review-ui.mjs`. Extend the editor props fixture (lines 188-200):

```js
      situationalAvailable: true,
      situationalNote: null,
      codingAvailable: options.codingAvailable ?? true,
      codingNote: options.codingNote ?? null,
```

Extend the harness's `labelled` helper (line 305) so a `<select>` is reachable by its `aria-label`, exactly as an input is:

```js
  const labelled = (name) => find((node) => (node.type === "input" || node.type === "textarea" || node.type === "select") && node.props["aria-label"] === name);
```

Add the fixture and tests after the existing editor tests (after line 577):

```js
/** A coding question as the drawer receives it from the suite. */
const codeQuestion = (overrides = {}) => ({
  id: "q-code",
  template_id: "suite-a",
  question_type: "CODING",
  title: "Flatten a nested list",
  prompt: "Write a function that flattens arbitrary nesting.",
  instructions: null,
  config: { language: "Python", starter_code: "def flatten(x):" },
  points: 10,
  position: 0,
  time_limit_minutes: null,
  shuffle_options: false,
  ...overrides,
});

test("a coding question opens with its language and starter on the desk", () => {
  const ui = harness("editor", { question: codeQuestion() });
  assert.equal(ui.value("Language"), "Python");
  assert.equal(ui.value("Starter code"), "def flatten(x):");
  assert.match(ui.text(), /never graded/i);
  ui.unmount();
});

test("the language and starter travel with the save", () => {
  const ui = harness("editor", { question: codeQuestion() });
  ui.type("Language", "Go");
  ui.type("Starter code", "func flatten(x []int) {}");
  ui.submit();
  assert.equal(ui.saves[0].language, "Go");
  assert.equal(ui.saves[0].starter_code, "func flatten(x []int) {}");
  ui.unmount();
});

test("with 039 absent the drawer says so and cannot send the question", () => {
  const ui = harness("editor", {
    question: codeQuestion(),
    codingAvailable: false,
    codingNote:
      "Coding questions need migration 039 (db/migrations/039_coding_questions.sql) to be applied before they can be saved. Nothing was saved.",
  });
  assert.match(ui.text(), /039_coding_questions\.sql/);
  assert.equal(ui.button("Save question").props.disabled, true);
  ui.unmount();
});
```

Second, `scripts/prove-scoring-rubric.mjs`. Add a real coding-domain import beside the other domain imports at the top (lines 36-43), so both harnesses can bind it:

```js
import * as codingDomain from "../src/modules/assessment/domain/coding.ts";
```

Make the authoring harness answer the two new domain imports and the availability probe, and let it report a missing enum label. Inside `authoringHarness`'s `require` (lines 843-886), before the final `throw`:

```js
      if (name === "@/modules/assessment/domain/coding") return codingDomain;
      if (name === "@/modules/assessment/domain/questionWriteErrors") {
        return loadModule(path.join(root, "src/modules/assessment/domain/questionWriteErrors.ts"), {});
      }
      if (name === "@/modules/assessment/application/questionTypeAvailability") {
        return loadModule(
          path.join(root, "src/modules/assessment/application/questionTypeAvailability.ts"),
          {}
        );
      }
```

`loadModule` resolves the pure `@/modules/*/domain/*` imports for real and answers `server-only` with an empty module, so the empty bindings are enough.

Inside the fake builder's `then` (line 813), after the insert and update branches and before the read loop:

```js
            if (
              options.enumMissing &&
              query.filters.some(([column, value]) => column === "question_type" && value === options.enumMissing)
            ) {
              return Promise.resolve({
                data: null,
                error: {
                  code: "22P02",
                  message: `invalid input value for enum public.question_type: "${options.enumMissing}"`,
                },
              }).then(resolve, reject);
            }
```

Add the fixture and tests beside `draftOf` (line 906):

```js
const codeDraftOf = (overrides) =>
  draftOf({
    question_type: "CODING",
    title: "Flatten a nested list",
    prompt: "Write a function that flattens arbitrary nesting.",
    context: "",
    min_words: null,
    language: "Python",
    starter_code: "def flatten(x):",
    ...overrides,
  });

test("a coding question is saved with its language and starter", async () => {
  const h = authoringHarness();
  const result = await h.save(codeDraftOf());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.insertedRow().question_type, "CODING");
  assert.deepEqual(h.insertedRow().config, { language: "Python", starter_code: "def flatten(x):" });
});

test("a coding question with no language is refused before the insert", async () => {
  const h = authoringHarness();
  const result = await h.save(codeDraftOf({ language: "" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /language/i);
  assert.equal(h.inserts.length, 0);
});

test("a coding question whose enum 039 has not added is refused with the migration named", async () => {
  const h = authoringHarness({ enumMissing: "CODING" });
  const result = await h.save(codeDraftOf());
  assert.equal(result.ok, false);
  assert.match(result.error, /039/);
  assert.equal(h.inserts.length, 0);
});

test("an oversized starter is refused by its length", async () => {
  const h = authoringHarness();
  const result = await h.save(codeDraftOf({ starter_code: "x".repeat(10_001) }));
  assert.equal(result.ok, false);
  assert.match(result.error, /10,000/);
  assert.equal(h.inserts.length, 0);
});
```

In `scripts/prove-situational.mjs`, update the pin at 731-736: the guide check that asserts `"Five question types:"` becomes `"Six question types:"`, and adds `"039_coding_questions.sql"`. Keep the `034_situational_judgment.sql` needle.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/prove-rubric-review-ui.mjs`
Run: `node scripts/prove-situational.mjs`
Run: `node --test scripts/prove-scoring-rubric.mjs`
Expected: FAIL — the editor has no `language` control, the picker lists five, the guide still says five, and `saveQuestion` answers a CODING draft with "Choose a valid question type."

- [ ] **Step 3: Accept CODING at the save door**

In `src/app/(admin)/assessments/question-actions.ts`:

`QUESTION_TYPES` (62-68) gains `"CODING"`.

`QuestionDraft` (82-115) gains:

```ts
  /** CODING only: one of CODING_LANGUAGES, checked before the client opens. */
  language?: string;
  /** CODING only: the optional snippet shown beside the prompt. */
  starter_code?: string;
```

Imports at the top of the module:

```ts
import {
  CODING,
  CODING_SCHEMA_NOTE,
  readCodingLanguage,
  starterCodeIssue,
} from "@/modules/assessment/domain/coding";
import { readQuestionTypeAvailability } from "@/modules/assessment/application/questionTypeAvailability";
import { questionWriteError } from "@/modules/assessment/domain/questionWriteErrors";
```

Delete the local `questionWriteError` (130-132). If `isMissingQuestionTypeError` and `SITUATIONAL_WRITE_REFUSAL` are now imported but unused, remove them from the `situational` import too — lint fails on an unused binding.

`saveQuestion`: two checks, one on each side of the client. Place the first immediately after the rubric refusal (line 340), so a draft that cannot be saved is refused before a database round trip:

```ts
  if (draft.question_type === CODING) {
    if (!readCodingLanguage(draft.language)) {
      return { ok: false, error: "Pick the language the candidate should write in." };
    }
    const starterIssue = starterCodeIssue(draft.starter_code);
    if (starterIssue) return { ok: false, error: starterIssue };
  }
```

Place the second immediately after `const restClient = await createServerRestClient();` (line 342), before the template is read, so an unapplied 039 is refused before any write and the probe has a client to ask:

```ts
  if (draft.question_type === CODING) {
    const availability = await readQuestionTypeAvailability(restClient);
    if (!availability.coding) {
      return { ok: false, error: availability.codingNote ?? CODING_SCHEMA_NOTE };
    }
  }
```

`buildConfig` (190-250) gains its `case "CODING"` beside `CASE_STUDY`. It spreads `preserve_config` exactly as its neighbours do, so a config key this form cannot edit survives an edit, and it stores only the language the validator already accepted:

```ts
    case "CODING": {
      const config: QuestionConfig = { ...(draft.preserve_config ?? {}) };
      const language = readCodingLanguage(draft.language);
      if (!language) throw new Error("A coding question must name its language.");
      config.language = language;
      if (draft.starter_code?.trim()) config.starter_code = draft.starter_code;
      else delete config.starter_code;
      // A no-op until Task 9 makes CODING a rubric type; kept here so that
      // change needs no second edit to the save door.
      applyRubricChange(config, rubric);
      return config;
    }
```

`questionWriteError` at lines 379 and 419: replace `questionWriteError(error)` with `questionWriteError(draft.question_type, error)`.

- [ ] **Step 4: Offer CODING in the editor**

In `src/app/(admin)/assessments/QuestionEditorDrawer.tsx`:

Import the constants the form renders:

```ts
import {
  CODE_STARTER_CAP,
  CODING_LANGUAGES,
} from "@/modules/assessment/domain/coding";
```

Props (224-264) gain, beside `situationalAvailable`/`situationalNote`:

```ts
  /** Whether `public.question_type` carries CODING yet (039). */
  codingAvailable = true,
  /** Why it does not, shown where the type would otherwise be saved. */
  codingNote = null,
```

`Draft` (108-124) gains `language: string; starter_code: string;`. `toDraft` (167-219) puts `language: ""` and `starter_code: ""` on the blank draft, and on an edit reads `config.language ?? ""` and `config.starter_code ?? ""`.

The type picker filter (500) gains its second clause:

```tsx
              {(Object.keys(TYPE_LABELS) as QuestionType[])
                .filter(
                  (type) =>
                    (type !== "SITUATIONAL_JUDGMENT" || situationalAvailable) &&
                    (type !== "CODING" || codingAvailable)
                )
                .map((type) => (
```

The fifth type stays hidden without 034; the sixth stays hidden without 039.

After the CASE_STUDY block (744-774), add the coding fields. They use the drawer's own `Field`/`Select`/`TextArea` primitives, and the `aria-label`s are what the editor proof drives. The starter is shown and edited but never seeded into the candidate's answer (Task 8):

```tsx
          {editing.question_type === "CODING" && (
            <div className="space-y-4">
              <Field
                label="Language"
                htmlFor="q-language"
                required
                hint="The language the candidate writes in. Nothing runs their code."
              >
                <Select
                  id="q-language"
                  name="language"
                  aria-label="Language"
                  value={editing.language}
                  onChange={(e) => patch({ language: e.target.value })}
                  required
                >
                  <option value="">Pick a language</option>
                  {CODING_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Starter code"
                htmlFor="q-starter"
                hint="Shown beside the prompt and never graded. Blank means no starter."
              >
                <TextArea
                  id="q-starter"
                  name="starter_code"
                  aria-label="Starter code"
                  rows={6}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  maxLength={CODE_STARTER_CAP}
                  className="font-mono"
                  value={editing.starter_code}
                  onChange={(e) => patch({ starter_code: e.target.value })}
                />
              </Field>
              <p className="text-xs text-brand-ink/45">
                {editing.starter_code.length.toLocaleString("en-US")} of{" "}
                {CODE_STARTER_CAP.toLocaleString("en-US")} starter characters.
              </p>
            </div>
          )}
```

The submit payload (388-436) sends the pair only for CODING, beside the rubric conditional:

```ts
        // Only a coding question names a language or offers a starter; an
        // absent key on any other type means the same as it always did.
        ...(editing.question_type === "CODING"
          ? { language: editing.language, starter_code: editing.starter_code }
          : {}),
```

`toDraft` already loaded a stored starter into `editing.starter_code`, so an edit that leaves the box untouched sends the stored value back rather than clearing it.

The editing drawer shows the availability note under the type picker (the list-view note at 1060-1064 belongs to a different render branch and is not the one the editor proof sees):

```tsx
          {editing.question_type === "CODING" && !codingAvailable && codingNote ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
              {codingNote}
            </p>
          ) : null}
```

Disable the drawer's submit button while the type cannot be saved (`DrawerActions` already accepts `disabled`):

```tsx
            disabled={editing.question_type === "CODING" && !codingAvailable}
```

- [ ] **Step 5: Thread the new fields to every editor**

`AssessmentGrid.tsx`: the props type at 891-917 replaces `situational: { situational: boolean; note: string | null }` with `situational: QuestionTypeAvailability`, and the editor call at 1242-1243 gains `codingAvailable={situational.coding}` and `codingNote={situational.codingNote}`.

`BankBoard.tsx:682-683`: the editor call reads `data.situational`; add `codingAvailable={data.situational.coding}` and `codingNote={data.situational.codingNote}`.

`src/app/(admin)/questions/actions.ts` (104-105, 119, 169): pass the whole availability value through unchanged; nothing in that file branches on the type list, so no filter changes here.

- [ ] **Step 6: Tell the Guide there are six**

`src/modules/shell/domain/pageGuide.ts:252-308` (line numbers are from the file as it stands before Plan 1; anchor on the sentences, because Plan 1 inserts lines into the same entry):

- The sentence beginning `"Five question types: …"` becomes `"Six question types: …"` and names coding among them in the same sentence style as the fifth.
- The `"Situational judgment arrives with db/migrations/034_situational_judgment.sql…"` sentence gains the sixth-type twin, naming `db/migrations/039_coding_questions.sql`.

Do not add a cap figure here, and do not add a second 039 sentence to the `edges` block — Task 11 owns the copy pass and the proof only needs one naming.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node scripts/prove-rubric-review-ui.mjs`
Run: `node --test scripts/prove-scoring-rubric.mjs`
Run: `node scripts/prove-situational.mjs`
Expected: PASS.

- [ ] **Step 8: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(admin)/assessments/question-actions.ts" "src/app/(admin)/assessments/QuestionEditorDrawer.tsx" "src/app/(admin)/assessments/AssessmentGrid.tsx" "src/app/(admin)/assessments/BankBoard.tsx" "src/app/(admin)/assessments/page.tsx" "src/app/(admin)/questions/actions.ts" src/modules/shell/domain/pageGuide.ts scripts/prove-rubric-review-ui.mjs scripts/prove-scoring-rubric.mjs scripts/prove-situational.mjs
git commit -m "feat(assessments): let an author describe a coding question" -m "The picker offers CODING only when the enum has it, the drawer asks for a language with no default and an optional starter, and the save door refuses a missing language, an oversized starter or an unapplied 039 in words that say nothing was saved. The Guide moves to six types and names the migration behind the sixth."
```

---

### Task 5: AI drafting can propose a coding question

**Files:**
- Modify: `src/modules/assessment/domain/aiAuthoring.ts` (`QUESTION_TYPES` 138-144, `QUESTION_RULES` 153-160, `GeneratedQuestion` 72-89, `GENERATED_JSON_SHAPE` 103-136, `reviewDrafts` 376-531, `asReviewedDraft` 543-594, `draftForRow` 603-638)
- Modify: `src/app/(admin)/assessments/question-actions.ts:673` (`draftQuestions` filter)
- Modify: `src/app/(admin)/assessments/QuestionEditorDrawer.tsx:868-888` (AI checkbox filter)
- Modify: `src/modules/assistant/domain/registry/shared.ts:657-663`, `:691-697`, `:742-749`, `:760-800`
- Modify: `src/modules/assistant/domain/registry/authoring.ts:93-119`
- Modify: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: `CODING_LANGUAGES`, `readCodingLanguage`, `starterCodeIssue`, `CODE_STARTER_CAP` from `coding.ts`.
- Produces: `GeneratedQuestion` gains `language?: string; starter_code?: string`; `reviewDrafts` refuses a CODING draft without a known language, with a starter over the cap, or with an empty prompt; `draftForRow` carries `language`/`starter_code` at the top level of the `QuestionDraft`, where `buildConfig` reads them; `draftQuestions` accepts CODING only when the enum has it; the assistant's `save_question` tool accepts `language`/`starter_code`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/prove-coding-question.mjs`. The real accessors are `reviewDrafts(parsed, brief)` returning `{ drafts, dropped, shortBy }` and `draftForRow(draft, templateId, position)` returning a `QuestionDraft` whose config fields live in `preserve_config`:

```js
// ---------------------------------------------------------------------------
// A drafted coding question is held to the same rules a manual one is.
// ---------------------------------------------------------------------------
const { reviewDrafts, draftForRow } = await import(
  pathToFileURL(path.join(root, "src/modules/assessment/domain/aiAuthoring.ts")).href
);

const codingBrief = {
  topic: "Flattening nested lists",
  types: ["CODING"],
  count: 1,
  difficulty: "MID",
  pointsEach: 10,
  notes: "",
};

function drafted(overrides = {}) {
  return {
    question_type: "CODING",
    title: "Flatten a nested list",
    prompt: "Write a function that flattens arbitrary nesting.",
    points: 10,
    language: "Python",
    ...overrides,
  };
}

{
  const result = reviewDrafts([drafted()], codingBrief);
  check("a well-formed coding draft is kept", result.drafts.length === 1, JSON.stringify(result.dropped));
  check("the kept draft carries its language", result.drafts[0]?.language === "Python", JSON.stringify(result.drafts[0]));
}
{
  const result = reviewDrafts([drafted({ language: undefined })], codingBrief);
  check("a coding draft with no language is refused", result.drafts.length === 0);
  check("the refusal asks for a language", /language/i.test(result.dropped.join(" ")), JSON.stringify(result.dropped));
}
{
  const result = reviewDrafts([drafted({ language: "COBOL" })], codingBrief);
  check("a coding draft in an unknown language is refused", result.drafts.length === 0);
}
{
  const result = reviewDrafts([drafted({ starter_code: "x".repeat(10_001) })], codingBrief);
  check("a coding draft with an oversized starter is refused", result.drafts.length === 0);
  check(
    "the oversized starter is refused in the cap's own words",
    /10,000/.test(result.dropped.join(" ")),
    JSON.stringify(result.dropped)
  );
}
{
  const result = reviewDrafts([drafted({ prompt: "   " })], codingBrief);
  check("a coding draft with no prompt is refused", result.drafts.length === 0);
}

const codingRow = draftForRow(reviewDrafts([drafted()], codingBrief).drafts[0], "template-id", 3);
check("a drafted coding row carries its type", codingRow.question_type === "CODING", String(codingRow.question_type));
check("a drafted coding row carries its language", codingRow.language === "Python", JSON.stringify(codingRow));
check("a drafted coding row carries no starter when none was given", codingRow.starter_code === undefined, JSON.stringify(codingRow));
check("a drafted coding row leaves the preserved config alone", codingRow.preserve_config === null, JSON.stringify(codingRow.preserve_config));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — CODING drafts are refused as an unknown type.

- [ ] **Step 3: Widen the contract**

`aiAuthoring.ts`:

- Import `CODING_LANGUAGES`, `readCodingLanguage` and `starterCodeIssue` from `./coding`.
- `TYPE_WORDS` already has CODING from Task 3.
- `QUESTION_TYPES` (138-144) gains `"CODING"`.
- `QUESTION_RULES` (153-160) gains a coding rule in the same voice as its neighbors: language must be one of the ten, the prompt must be answerable in one file, no starter is required, and the question must not ask the candidate to run or test anything (there is nowhere to run it).
- `GeneratedQuestion` (72-89) gains `language?: string; starter_code?: string;`.
- `GENERATED_JSON_SHAPE` (103-136): the union string at 106 gains `"CODING"`; the field rules at 123-136 gain `language` and `starter_code`, with `starter_code` explicitly optional.
- `reviewDrafts` (376-531): after the type check (405) and the allowed set (410), add the CODING branch beside the MC/SJT/EXCEL branches. The generic title/prompt check at 417-422 already refuses an empty prompt, so this branch only has to name the language and the starter:

```ts
    if (questionType === "CODING") {
      const language = readCodingLanguage(record.language);
      if (!language) {
        dropped.push(
          `${where} is a coding question, and its language must be one of ${CODING_LANGUAGES.join(", ")}.`
        );
        return;
      }
      const starterIssue = starterCodeIssue(record.starter_code);
      if (starterIssue) {
        dropped.push(`${where} — ${starterIssue}`);
        return;
      }
    }
```

  The pushed draft (496-519) gains the two fields, normalised the same way the branch checked them:

```ts
      language: questionType === "CODING" ? (readCodingLanguage(record.language) ?? undefined) : undefined,
      starter_code:
        questionType === "CODING" && typeof record.starter_code === "string" && record.starter_code.trim()
          ? record.starter_code
          : undefined,
```

- `asReviewedDraft` (543-594) carries the pair through untouched: `language: typeof record.language === "string" ? record.language : undefined` and `starter_code: typeof record.starter_code === "string" ? record.starter_code : undefined`.
- `draftForRow` (603-638) keeps its EXCEL-only `preserve_config` exactly as it is and adds the pair at the top level of the returned `QuestionDraft`, because that is where `buildConfig`'s CODING case reads it:

```ts
    ...(draft.question_type === "CODING"
      ? {
          language: readCodingLanguage(draft.language) ?? undefined,
          starter_code: draft.starter_code?.trim() ? draft.starter_code : undefined,
        }
      : {}),
```


Do not widen the other types' configs.

- [ ] **Step 4: Let the drafting door accept CODING only when the enum has it**

`question-actions.ts:673` — the filter stays shape-identical; the availability check happens before the engine call:

```ts
  const types = (input.types ?? []).filter((type) => QUESTION_TYPES.includes(type));
  const availability = types.includes("CODING") ? await getQuestionTypeAvailability() : null;
  if (types.includes("CODING") && !availability?.coding) {
    return { error: availability?.codingNote ?? CODING_SCHEMA_NOTE };
  }
```

Place the probe after the filter and before the rest client is created (line 687), so an unapplied 039 refuses before any provider call.

`QuestionEditorDrawer.tsx` (868-888): the AI checkbox list stops filtering CODING out. Keep the existing `situationalAvailable` filter for the fifth type; coding checkboxes driven by `codingAvailable`:

```tsx
  {(type !== "SITUATIONAL_JUDGMENT" || situationalAvailable)
    && (type !== "CODING" || codingAvailable)}
```

- [ ] **Step 5: Teach the assistant the same two args**

`src/modules/assistant/domain/registry/shared.ts`: `QUESTION_TYPES` (691-697) gains `"CODING"`; `questionType` (742-749) and `questionDraftFrom` (760-800) carry `language` and `starter_code`, with the conditional spread used for `preserve_config` untouched.

`src/modules/assistant/domain/registry/authoring.ts:93-119`: the `save_question` argument schema gains:

```ts
        language: { type: "string", description: "CODING only: one of JavaScript, TypeScript, Python, Java, C#, Go, SQL, PHP, Ruby, C++." },
        starter_code: { type: "string", description: "CODING only: optional snippet shown beside the prompt; never graded." },
```

and the description names CODING among the types it can save.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node scripts/prove-coding-question.mjs`
Run: `node scripts/prove-rubric-review-ui.mjs`
Expected: PASS. If the assistant registry has its own proof (search `scripts/` for `save_question`), run it too.

- [ ] **Step 7: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/assessment/domain/aiAuthoring.ts "src/app/(admin)/assessments/question-actions.ts" "src/app/(admin)/assessments/QuestionEditorDrawer.tsx" src/modules/assistant/domain/registry/shared.ts src/modules/assistant/domain/registry/authoring.ts scripts/prove-coding-question.mjs
git commit -m "feat(assessments): let a model draft a coding question" -m "A drafted coding question is held to the same rules as a manual one: a language from the closed list, a prompt a candidate can answer in one file, an optional starter inside its cap, and nothing that asks anyone to run it. The drafting door probes the enum first, so an unapplied 039 refuses before a provider is called. The assistant's save_question learns the same two arguments."
```

---

### Task 6: The runner's store holds a code answer

**Files:**
- Modify: `src/stores/useAssessmentStore.ts:221-227`, `:244-272`, `:274-319`
- Modify: `src/app/api/attempt/[token]/route.ts:173-200` (use the split, remove the inline version from Task 3)
- Modify: `scripts/prove-scoring-rubric.mjs` (GET harness binding)
- Modify: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: `splitCodingAnswers`, `codeAnswerOverCap`, `codeAnswersOverCap`, `codeAnswerOverCapMessage`, `CODE_ANSWER_CAP` from `coding.ts`.
- Produces: `setCodeAnswer(questionId: string, code: string): void`; `syncDraft` sends both maps; `submitAttempt` refuses an over-cap answer by title before the network; the GET route fills `case_study_answers_map` and `code_answers_map` through one split.

- [ ] **Step 1: Write the failing test**

The store is a Zustand module in `"use client"` land that the existing proofs already reach. Follow the pattern the repo uses for store behaviour — `scripts/prove-situational.mjs` pins its shape by source where a harness is impractical. Append:

```js
// ---------------------------------------------------------------------------
// The store keeps the two written maps apart.
// ---------------------------------------------------------------------------
const storeSource = read("src/stores/useAssessmentStore.ts");
check(
  "the store saves the two maps in one request",
  /case_study_answers_map/.test(storeSource) && /code_answers_map/.test(storeSource),
  "both maps must travel in syncDraft"
);
check(
  "the store refuses an over-cap answer before the network",
  /codeAnswersOverCap|codeAnswerOverCap/.test(storeSource),
  "submitAttempt must refuse locally"
);
check(
  "the store does not merge code into the case map",
  !/case_study_answers_map:\s*\{[^}]*code_answers_map/s.test(storeSource),
  "a merged map would reload code as a case answer"
);
sourceHas("the GET route splits by question type", "src/app/api/attempt/[token]/route.ts", [
  "splitCodingAnswers",
]);
```

If a store harness already exists in the proofs, prefer driving `setCodeAnswer` and `submitAttempt` through it over source pins; source pins are the fallback when the store needs a browser.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — no `code_answers_map` in `syncDraft`, no cap check in `submitAttempt`, no split in the route.

- [ ] **Step 3: Add the setter and the payload**

`src/stores/useAssessmentStore.ts` — first the shape. `AttemptDraftClient` (59-65) gains `code_answers_map: Record<string, string>` beside `case_study_answers_map`. `initialState` (105-124) gains `codeAnswersMap: {}`, and `loadAttempt` (131-158) sets `codeAnswersMap: draft?.code_answers_map ?? {}` beside `caseStudyAnswersMap`.

Then, beside `setCaseStudyAnswer` (221-223), the store's own key is camelCase like every other map — only the wire key has underscores:

```ts
  setCodeAnswer(questionId, code) {
    set((state) => ({ codeAnswersMap: { ...state.codeAnswersMap, [questionId]: code } }));
  },
```

Declare `setCodeAnswer: (questionId: string, code: string) => void;` in the `AssessmentState` interface beside `setCaseStudyAnswer` (97).

`syncDraft` (244-272) adds `code_answers_map: state.codeAnswersMap` to its PUT payload (255-262), beside `case_study_answers_map`. It must not copy one into the other.

`submitAttempt` (274-319), immediately after the guard and before the video uploads, so a refusal sends nothing:

```ts
  const titles = new Map(
    (state.payload?.questions ?? []).map((question) => [question.id, question.title] as const)
  );
  const overCap = codeAnswersOverCap(state.codeAnswersMap, titles);
  if (overCap) {
    set({ submitError: codeAnswerOverCapMessage(overCap) });
    return;
  }
```

The POST payload (300-306) gains `code_answers_map: fresh.codeAnswersMap` beside `case_study_answers_map: fresh.caseStudyAnswersMap`.

- [ ] **Step 4: Split the reload**

Replace the Task 3 inline split in `src/app/api/attempt/[token]/route.ts` (173-200) with one call. The route already holds the sanitized questions in `sanitizedQuestions` (163-166), so their types come from that same list:

```ts
const answeredWritten = Object.fromEntries(
  (responses ?? [])
    .filter((r) => r.answer_text)
    .map((r) => [r.question_id, r.answer_text as string])
);
const split = splitCodingAnswers(
  answeredWritten,
  new Map(sanitizedQuestions.map((question) => [question.id, question.question_type] as const))
);
```

then post `case_study_answers_map: split.cases` and `code_answers_map: split.code`. Nothing else in the reconstruction changes; spreadsheet and video paths are untouched.

The GET harness in `scripts/prove-scoring-rubric.mjs` throws on any `require` it does not know, so the route's new import must be bound beside the other domain modules (bindings at 133-161):

```js
    "@/modules/assessment/domain/coding": codingDomain,
```

with `import * as codingDomain from "../src/modules/assessment/domain/coding.ts";` beside the imports at 36-43 (Task 4 already added it for the authoring harness; keep one copy).

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/prove-coding-question.mjs`
Run: `node --test scripts/prove-scoring-rubric.mjs`
Expected: PASS.

- [ ] **Step 6: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/stores/useAssessmentStore.ts "src/app/api/attempt/[token]/route.ts" scripts/prove-coding-question.mjs scripts/prove-scoring-rubric.mjs
git commit -m "feat(assessments): give the runner's store a code answer" -m "The draft and the submission carry code_answers_map beside case_study_answers_map, and a save or submit that reloads splits by question type so a code answer never comes back as a case answer. An answer over the cap is refused in the candidate's own words before the request leaves the browser."
```

---

### Task 7: The write routes persist code answers

**Files:**
- Modify: `src/app/api/attempt/[token]/draft/route.ts:1-115`
- Modify: `src/app/api/attempt/[token]/submit/route.ts:1-239`
- Modify: `scripts/prove-scoring-rubric.mjs` (route harness)
- Modify: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: `codeAnswersOverCap` and `codeAnswerOverCapMessage` from `coding.ts`.
- Produces: both routes accept `code_answers_map`; the submit route selects `title` and refuses an over-cap answer server-side, naming the question; both case loops guard on `CASE_STUDY` and both code loops guard on `CODING`, so neither map can be written through the other's door.

- [ ] **Step 1: Write the failing tests**

`scripts/prove-scoring-rubric.mjs` already drives the GET route through a transpiled handler in a fresh context. Add a sibling harness for the two write routes, with `upsert` captured because that is the call that stores answers:

```js
/**
 * Runs the real draft (`PUT`) or submit (`POST`) route against a synthetic
 * database. The fake client is a thenable chain like the GET harness above;
 * `upsert` resolves immediately and records exactly what the route asked the
 * database to store, so the assertions are about rows, not source shape.
 */
function writeHarness(tables, method) {
  const upserts = [];
  const updates = [];
  const responses = [];
  const rows = {
    candidate_attempts: [],
    assessment_questions: [],
    candidate_responses: [],
    applications: [],
    ...tables,
  };

  const client = {
    from(table) {
      const query = { table, filters: [] };
      const builder = {
        select() {
          return this;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return this;
        },
        update(values) {
          query.values = values;
          return this;
        },
        upsert(values, config) {
          upserts.push({ table, values, config });
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          query.single = true;
          return this;
        },
        maybeSingle() {
          query.single = true;
          return this;
        },
        then(resolve, reject) {
          let found = [...(rows[table] ?? [])];
          for (const [column, value] of query.filters) {
            found = found.filter((row) => row[column] === value);
          }
          if (query.values) {
            updates.push({ table, values: query.values });
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          return Promise.resolve({
            data: query.single ? (found[0] ?? null) : found,
            error: null,
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  const bindings = {
    "@/lib/data-api/service": { getServiceRestClient: () => client },
    "@/modules/assessment/application/gradeAttempt": { gradeAttemptResponses: async () => ({}) },
    "@/modules/activity/application/record": { recordActivity: async () => ({}) },
    "@/modules/assessment/application/runner-trail": {
      APPLICATION_EMBED: "applications ( id, stage, full_name, job_openings ( title ) )",
      attemptContext: () => ({
        applicationId: "app-1",
        applicationStage: "SCREENING",
        candidateName: "Salma Abdelrahim",
        jobTitle: "Front office agent",
      }),
      runnerActor: (label) => ({ actorKind: "CANDIDATE", actorLabel: label, via: "assessment runner" }),
    },
    "@/modules/assessment/domain/situational": {
      judgeChoice: () => ({ score: 0, rationale: "", strengths: [], improvements: [] }),
    },
    "@/modules/assessment/domain/coding": codingDomain,
    "next/server": {
      after: () => {},
      NextResponse: {
        json: (body, init) => {
          const result = { body, status: init?.status ?? 200 };
          responses.push(result);
          return result;
        },
      },
    },
  };

  const file =
    method === "PUT"
      ? "src/app/api/attempt/[token]/draft/route.ts"
      : "src/app/api/attempt/[token]/submit/route.ts";
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const context = {
    exports,
    require: (name) => {
      if (!(name in bindings)) throw new Error(`Unmocked boundary: ${name}`);
      return bindings[name];
    },
  };
  new Script(compiled).runInNewContext(context, { timeout: 5000 });

  return {
    send: (body) =>
      exports[method]({ json: async () => body }, { params: Promise.resolve({ token: "token-1" }) }),
    upserts,
    updates,
    responses,
  };
}

const codingAttempt = { ...attemptRow, application_id: "app-1" };
const codingPaper = [
  {
    id: "q-code",
    template_id: "suite-1",
    question_type: "CODING",
    title: "Flatten",
    prompt: "Write it.",
    points: 10,
    position: 0,
    config: { language: "Python" },
  },
  {
    id: "q-case",
    template_id: "suite-1",
    question_type: "CASE_STUDY",
    title: "Diagnose",
    prompt: "Diagnose it.",
    points: 10,
    position: 1,
    config: {},
  },
];
const codingTables = () => ({
  candidate_attempts: [codingAttempt],
  assessment_questions: codingPaper,
});

test("the submit route stores a code answer as text", async () => {
  const h = writeHarness(codingTables(), "POST");
  const response = await h.send({
    case_study_answers_map: { "q-case": "a case answer" },
    code_answers_map: { "q-code": "print(1)" },
  });
  assert.notEqual(response.status, 400);
  const written = h.upserts.find((entry) => entry.table === "candidate_responses");
  assert.equal(written.values.length, 2);
  assert.deepEqual(
    written.values.map((row) => [row.question_id, row.answer_text]).sort(),
    [
      ["q-case", "a case answer"],
      ["q-code", "print(1)"],
    ]
  );
});

test("the submit route will not store a coding answer through the case door", async () => {
  const h = writeHarness(codingTables(), "POST");
  await h.send({ case_study_answers_map: { "q-code": "print(1)" } });
  assert.equal(h.upserts.find((entry) => entry.table === "candidate_responses"), undefined);
});

test("the submit route will not store a case answer through the code door", async () => {
  const h = writeHarness(codingTables(), "POST");
  await h.send({ code_answers_map: { "q-case": "a case answer" } });
  assert.equal(h.upserts.find((entry) => entry.table === "candidate_responses"), undefined);
});

test("an over-cap submission is refused by name and writes nothing", async () => {
  const h = writeHarness(codingTables(), "POST");
  const response = await h.send({
    code_answers_map: { "q-code": "x".repeat(codingDomain.CODE_ANSWER_CAP + 1) },
  });
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(response.body), /Flatten/);
  assert.deepEqual(h.upserts, []);
  assert.deepEqual(h.updates, []);
});

test("the draft route saves a code answer under its own key", async () => {
  const h = writeHarness(codingTables(), "PUT");
  const response = await h.send({ code_answers_map: { "q-code": "print(1)" } });
  assert.equal(response.status, 200);
  const written = h.upserts.find((entry) => entry.table === "candidate_responses");
  assert.equal(written.values.length, 1);
  assert.equal(written.values[0].answer_text, "print(1)");
});

test("the draft route will not save a coding answer through the case door", async () => {
  const h = writeHarness(codingTables(), "PUT");
  await h.send({ case_study_answers_map: { "q-code": "print(1)" } });
  assert.deepEqual(h.upserts, []);
});
```

Append the corresponding source pins to `scripts/prove-coding-question.mjs`:

```js
sourceHas("the draft route accepts the code map and guards both doors", "src/app/api/attempt/[token]/draft/route.ts", [
  "code_answers_map",
  'question_type !== "CASE_STUDY"',
  'question_type !== "CODING"',
]);
sourceHas("the submit route selects the title its refusal names", "src/app/api/attempt/[token]/submit/route.ts", [
  "code_answers_map",
  "codeAnswerOverCapMessage",
  '"id, question_type, points, title, config"',
]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/prove-scoring-rubric.mjs`
Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — the routes ignore `code_answers_map` and store nothing for `q-code`.

- [ ] **Step 3: Extend the draft route**

`src/app/api/attempt/[token]/draft/route.ts`: `DraftBody` gains `code_answers_map?: Record<string, string>;`. The question select already reads `"id, question_type, points"`. The case loop (54-64) gains its guard, and a code loop lands beside it:

```ts
      for (const [questionId, answerText] of Object.entries(body.case_study_answers_map ?? {})) {
        const question = questionById.get(questionId);
        if (!question || question.question_type !== "CASE_STUDY") continue;
        upserts.push({
          attempt_id: attempt.id,
          question_id: questionId,
          answer_text: answerText,
          max_score: question.points,
          updated_at: new Date().toISOString(),
        });
      }
      for (const [questionId, answerText] of Object.entries(body.code_answers_map ?? {})) {
        const question = questionById.get(questionId);
        if (!question || question.question_type !== "CODING") continue;
        upserts.push({
          attempt_id: attempt.id,
          question_id: questionId,
          answer_text: answerText,
          max_score: question.points,
          updated_at: new Date().toISOString(),
        });
      }
```

The upsert's `onConflict: "attempt_id,question_id"` is unchanged; code and case answers land in the same `answer_text` column because they are both written prose.

- [ ] **Step 4: Extend the submit route**

`src/app/api/attempt/[token]/submit/route.ts`:

- `SubmitBody` gains `code_answers_map?: Record<string, string>;`.
- The question select (39-42) becomes `"id, question_type, points, title, config"` so the refusal can name a question.
- Before any write, add the server-side cap check — the store refuses first, but a stale client must not be trusted:

```ts
  const overCapTitle = codeAnswersOverCap(body.code_answers_map ?? {}, new Map(questions.map((q) => [q.id, q.title])));
  if (overCapTitle) {
    return NextResponse.json({ error: codeAnswerOverCapMessage(overCapTitle) }, { status: 400 });
  }
```

- The case loop (76-88) gains its guard: `if (!question || question.question_type !== "CASE_STUDY") continue;`
- A coding loop lands beside it:

```ts
  for (const [questionId, answerText] of Object.entries(body.code_answers_map ?? {})) {
    const question = questionById.get(questionId);
    if (!question || question.question_type !== "CODING" || handled.has(questionId)) continue;
    maxScore += question.points;
    responseRows.push({
      attempt_id: attempt.id,
      question_id: questionId,
      answer_text: answerText,
      max_score: question.points,
      updated_at: new Date().toISOString(),
    });
    handled.add(questionId);
  }
```

- The upsert, attempt update, stage move, activity and `after(gradeAttemptResponses)` calls are unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/prove-scoring-rubric.mjs`
Run: `node scripts/prove-coding-question.mjs`
Expected: PASS.

- [ ] **Step 6: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/attempt/[token]/draft/route.ts" "src/app/api/attempt/[token]/submit/route.ts" scripts/prove-scoring-rubric.mjs scripts/prove-coding-question.mjs
git commit -m "feat(assessments): persist a code answer without the case door" -m "Both write routes accept code_answers_map and store it in answer_text, guarded by question type so a coding answer can never be written as a case answer or the reverse. The submit route re-checks the cap and names the question, because the browser's refusal is a courtesy and not an authority."
```

---

### Task 8: The candidate gets a code box

**Files:**
- Create: `src/modules/assessment/presentation/components/CodingRunner.tsx`
- Modify: `src/modules/assessment/presentation/AssessmentRunner.tsx:125-169`, `:373-389`
- Modify: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: store `codeAnswersMap`, `setCodeAnswer`, `syncDraft`; `codingAnswerAnswered`, `codingLanguageOf`, `CODE_ANSWER_CAP` from `coding.ts`.
- Produces: `<CodingRunner question={…} />` rendered by `AssessmentRunner` for `question_type === "CODING"`; the answered flag for a coding question is `codingAnswerAnswered`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/prove-coding-question.mjs`:

```js
// ---------------------------------------------------------------------------
// The runner has a coding branch, and the answer box is a textarea.
// ---------------------------------------------------------------------------
sourceHas("the runner dispatches a coding question", "src/modules/assessment/presentation/AssessmentRunner.tsx", [
  "CodingRunner",
  "CODING",
]);
sourceHas("the coding runner is a textarea that writes the code map", "src/modules/assessment/presentation/components/CodingRunner.tsx", [
  'useAssessmentStore',
  "setCodeAnswer",
  "syncDraft",
  "<textarea",
  "spellCheck={false}",
  "autoCapitalize",
  'font-mono',
  "whitespace-pre-wrap",
]);
check(
  "the coding runner claims nothing about running the code",
  /not run|never run|is not run|reviewed/i.test(read("src/modules/assessment/presentation/components/CodingRunner.tsx")),
  "the runner must say the code is reviewed, not run"
);
check(
  "the coding runner does not seed the answer from the starter",
  !/setCodeAnswer\([^)]*starter/i.test(read("src/modules/assessment/presentation/components/CodingRunner.tsx")),
  "a seeded answer would be counted as answered"
);
```

If the repo has a client-render harness (the summary records one at tier 3 in `prove-situational.mjs`'s sibling proofs), add a behavioural case that types into the box and asserts the store map and the autosave call. Otherwise the source pins plus the walked UI are the evidence; say so in the commit body.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — no `CodingRunner.tsx`, no dispatch.

- [ ] **Step 3: Write the runner**

Create `src/modules/assessment/presentation/components/CodingRunner.tsx`, modelled on its neighbour `CaseStudyRunner.tsx` (read it in full first; it is the closest sibling and carries the debounce, the cleanup effect and the autosave footer):

```tsx
"use client";

import { useEffect, useRef } from "react";
import { CODE_ANSWER_CAP, codingLanguageOf } from "@/modules/assessment/domain/coding";
import { useAssessmentStore } from "@/stores/useAssessmentStore";

export function CodingRunner({ question }: { question: { id: string; prompt: string; config?: { language?: string; starter_code?: string } | null } }) {
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

  return (
    <div className="space-y-4">
      <div className="whitespace-pre-wrap rounded-md border bg-muted/40 px-4 py-3 text-sm">{question.prompt}</div>

      {question.config?.starter_code ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Starter code — shown for reference, not part of your answer.
          </p>
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/60 px-3 py-2 font-mono text-xs">
            {question.config.starter_code}
          </pre>
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={`answer-${question.id}`} className="sr-only">
          Your code
        </label>
        <textarea
          id={`answer-${question.id}`}
          aria-label="Your code"
          value={code}
          onChange={(event) => {
            setCodeAnswer(question.id, event.target.value);
            if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
            syncTimeoutRef.current = setTimeout(() => {
              void syncDraft();
            }, 2000);
          }}
          rows={16}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={CODE_ANSWER_CAP}
          className="w-full rounded-md border px-3 py-2 font-mono text-sm"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {language ? `${language} · ` : ""}
          {code.length.toLocaleString("en-US")} of {CODE_ANSWER_CAP.toLocaleString("en-US")} characters
        </span>
        <span>Autosaved. Your answer is reviewed by a person; it is not run.</span>
      </div>
    </div>
  );
}
```

Read the real `AttemptQuestionClient` shape and the sibling runner's selectors before saving: the selectors in `CaseStudyRunner` are the authority, and this box must read and write the same store keys they do. Tab moves focus normally — do not intercept `keydown`.

- [ ] **Step 4: Dispatch it**

In `AssessmentRunner.tsx`, import the runner beside its siblings (line 22-24):

```ts
import { CodingRunner } from "@/modules/assessment/presentation/components/CodingRunner";
```

The `answered` memo is a `switch` (132-169), so CODING is a `case`, not an `if`. Read the map beside the other selectors (125-129):

```ts
  const codeAnswers = useAssessmentStore((s) => s.codeAnswersMap);
```

inside the switch, beside `case "CASE_STUDY"`:

```ts
        case "CODING":
          flags[index] = codingAnswerAnswered(codeAnswers[id] ?? "");
          break;
```

and add `codeAnswers` to the memo's dependency array (171). Import `codingAnswerAnswered` from `coding.ts`.

The render block (373-389) is a list of `&&` conditionals, not a `switch`. Add one beside the case branch:

```tsx
            {currentQuestion.question_type === "CODING" && (
              <CodingRunner question={currentQuestion} />
            )}
```

Place it after the CASE_STUDY branch so the order reads the same as the type union.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/prove-coding-question.mjs`
Expected: PASS.

- [ ] **Step 6: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/assessment/presentation/components/CodingRunner.tsx src/modules/assessment/presentation/AssessmentRunner.tsx scripts/prove-coding-question.mjs
git commit -m "feat(assessments): give the candidate a plain code box" -m "A coding question renders a monospace textarea with the ordinary Tab key, spelling and autocorrect off, the language and the starter shown for reference, and a character count against the cap. The starter is never copied into the answer, so an untouched question is not counted as answered. The footer says the code is reviewed, not run."
```

---

### Task 9: A code answer is graded, never executed

**Files:**
- Modify: `src/modules/assessment/application/gradeAttempt.ts:477-578`, `:594-629`
- Modify: `src/modules/screening/infrastructure/openRouterEngine.ts:619-700`, and a new `evaluateCodeSubmission` beside `evaluateCaseStudy` (388-429)
- Modify: `src/modules/assessment/domain/rubric.ts:45`, `:53`
- Modify: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: `codingLanguageOf`, `fencedCode`, `CODING` from `coding.ts`; existing `gradeByRubric`.
- Produces: `RubricType` includes `"CODING"`; `gradeResponse` dispatches CODING to rubric grading when criteria exist and to `evaluateCodeSubmission` otherwise; `gradeAgainstRubric` accepts `code?: boolean; language?: string`; `evaluateCodeSubmission(input): Promise<EvaluationResult>`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/prove-coding-question.mjs`:

```js
// ---------------------------------------------------------------------------
// Grading reads the code. It never runs it.
// ---------------------------------------------------------------------------
const { isRubricType } = await import(
  pathToFileURL(path.join(root, "src/modules/assessment/domain/rubric.ts")).href
);
check("coding can carry a rubric", isRubricType("CODING") === true);
check("a quiz still cannot carry a rubric", isRubricType("MULTIPLE_CHOICE") === false);

sourceHas("grading dispatches coding", "src/modules/assessment/application/gradeAttempt.ts", [
  '"CODING"',
  "evaluateCodeSubmission",
  "gradeByRubric",
]);
sourceHas("the rubric prompt fences code with its language", "src/modules/screening/infrastructure/openRouterEngine.ts", [
  "fencedCode",
  "options.code",
]);
check(
  "no grading path claims to compile or run the answer",
  !/\b(compile|execute|run the tests?|sandbox)\b/i.test(
    read("src/modules/screening/infrastructure/openRouterEngine.ts").slice(
      read("src/modules/screening/infrastructure/openRouterEngine.ts").indexOf("evaluateCodeSubmission")
    )
  ),
  "the code prompt must not promise execution"
);
check(
  "nothing in the grading path spawns a process",
  !/child_process|execSync|spawnSync|new Worker/.test(
    read("src/modules/assessment/application/gradeAttempt.ts") +
      read("src/modules/screening/infrastructure/openRouterEngine.ts")
  )
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — CODING is not a rubric type and grading has no branch.

- [ ] **Step 3: Let a coding question carry criteria**

`src/modules/assessment/domain/rubric.ts:45`:

```ts
export type RubricType = Extract<QuestionType, "CASE_STUDY" | "VIDEO_PITCH" | "CODING">;
```

line 53:

```ts
const RUBRIC_TYPES: RubricType[] = ["CASE_STUDY", "VIDEO_PITCH", "CODING"];
```

- [ ] **Step 4: Fence the code for the rubric**

`openRouterEngine.ts` `gradeAgainstRubric` options (619-629) gain:

```ts
  code?: boolean;
  language?: string;
```

The material block (around 655-680) becomes, for a code answer:

```ts
  const material = options.code
    ? `The candidate's submitted code:\n\n${fencedCode(options.language, rawMaterial)}`
    : rawMaterial;
```

and the scheme paragraph gains one sentence when `options.code`: the material is source text a person wrote; it has not been compiled, run or tested; do not claim it works or fails, and judge it as written.

- [ ] **Step 5: Add the fallback evaluator**

Beside `evaluateCaseStudy` (388-429), add `evaluateCodeSubmission` with the same shape (input, capability `case_reasoning`, temperature 0.2, jsonMode) and a system prompt that says, in its own words: read the code as text; do not claim to have compiled or run it; assess correctness from the code alone; name what would need testing. Return the same result shape `evaluateCaseStudy` returns so the caller needs no branch on the result.

- [ ] **Step 6: Dispatch it**

In `gradeAttempt.ts` `gradeResponse` (477-578), add beside the CASE branch (483-507):

```ts
      if (question.question_type === "CODING") {
        const material = answer.answer_text ?? "";
        const language = codingLanguageOf(question.config);
        if (criteria.length > 0) {
          return gradeByRubric(question, criteria, material, {
            capability: "case_reasoning",
            code: true,
            language,
          });
        }
        return evaluateCodeSubmission({
          question,
          material,
          language,
        });
      }
```

Match the real signature of `gradeByRubric` and the real `EvaluationResult` plumbing in that function — the CASE branch is the template and the only acceptable shape. If `gradeByRubric` also needs `context`, pass what the CASE branch passes.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node scripts/prove-coding-question.mjs`
Run: `node --test scripts/prove-scoring-rubric.mjs`
Expected: PASS.

- [ ] **Step 8: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/modules/assessment/application/gradeAttempt.ts src/modules/screening/infrastructure/openRouterEngine.ts src/modules/assessment/domain/rubric.ts scripts/prove-coding-question.mjs
git commit -m "feat(assessments): mark code by reading it" -m "A coding answer joins the rubric types, so a question with criteria is marked against them exactly as a case study is, with the submission fenced under its language so the model reads it as source. A question without criteria falls back to a dedicated case_reasoning evaluation whose prompt forbids any claim of compiling, running or testing."
```

---

### Task 10: Reviewers read the code, not a description of it

**Files:**
- Modify: `src/modules/assessment/domain/attemptAnswers.ts:64-112`
- Modify: `src/modules/assessment/domain/comparison.ts:10-14`, `:38-70`
- Modify: `src/app/(admin)/assessments/actions.ts:650-774`
- Modify: `src/app/(admin)/assessments/IssuedLinksBoard.tsx:50-56`, `:763-775`
- Modify: `src/app/(admin)/assessments/ComparisonDrawer.tsx:128-169`
- Modify: `scripts/prove-coding-question.mjs`

**Interfaces:**
- Consumes: `codingLanguageOf`, `codingFenceTag` from `coding.ts`.
- Produces: `AttemptAnswer` and `ComparisonAnswer` gain `language: string | null`; the reading desk and the comparison drawer print `<pre>` with the language label; the links board prints code in a preformatted block; the mapping reads `language` from the question config.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/prove-coding-question.mjs`:

```js
// ---------------------------------------------------------------------------
// Every surface that shows a code answer shows it as text.
// ---------------------------------------------------------------------------
sourceHas("the answer shape carries a language", "src/modules/assessment/domain/attemptAnswers.ts", [
  "language",
]);
sourceHas("the comparison carries a language", "src/modules/assessment/domain/comparison.ts", [
  "language",
]);
sourceHas("the reading desk prints code preformatted", "src/app/(admin)/assessments/IssuedLinksBoard.tsx", [
  "<pre",
  "codingFenceTag",
]);
sourceHas("the comparison drawer prints code preformatted", "src/app/(admin)/assessments/ComparisonDrawer.tsx", [
  "<pre",
  "language",
]);
check(
  "no review surface renders an answer as HTML",
  !/dangerouslySetInnerHTML/.test(
    read("src/app/(admin)/assessments/IssuedLinksBoard.tsx") +
      read("src/app/(admin)/assessments/ComparisonDrawer.tsx")
  ),
  "an answer is text and must be rendered as text"
);
```

If a pure mapping proof exists for `attemptAnswers`/`comparison`, add a case that a CODING answer maps its `answer_text` and its stored language into the `AttemptAnswer`; the source pins are the fallback.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — neither shape has a language and neither surface prints a `<pre>`.

- [ ] **Step 3: Carry the language**

`attemptAnswers.ts` `AttemptAnswer` (64-112) gains:

```ts
  /** CODING only: the language the author picked, for the fence label. */
  language: string | null;
```

`comparison.ts` `ComparisonAnswer` (10-14) adds `"language"` to the `Pick`, and `comparisonPaper` (38-70) copies it through.

`actions.ts` (715-760), in the object `answers.push` builds, sets:

```ts
      language: question.question_type === "CODING" ? codingLanguageOf(question.config) : null,
```

next to `question_type`/`points`, and imports `codingLanguageOf` from `coding.ts`. Leave `answered` (727) as it is: the desk's meaning is "a response row is recorded", which is not the runner's "the candidate typed something".

- [ ] **Step 4: Print it**

`IssuedLinksBoard.tsx`: `TYPE_META` (50-56) is `Record<string, { word: string; icon: LucideIcon }>` — add a CODING row in that shape and import the icon it names (for example `Code2` or `FileCode2` from `lucide-react` beside the existing icon imports):

```tsx
  CODING: { word: "Coding", icon: FileCode2 },
```

The answer body (763-775) replaces its single `{answer.answer_text && (...)}` block with a branch inside that same guard, so a coding answer is printed as text and never doubled:

```tsx
        {answer.answer_text && (
          <div className="mt-2 rounded-lg border border-brand-line bg-white p-3">
            {answer.question_type === "CODING" ? (
              <>
                <p className="text-[11px] font-medium text-brand-ink/45">
                  {codingFenceTag(answer.language)}
                </p>
                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-brand-ink/80">
                  {answer.answer_text}
                </pre>
              </>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-ink/80">
                {answer.answer_text}
              </p>
            )}
            {answer.words !== null && (
              <p className="mt-2 text-[11px] text-brand-ink/45">
                {answer.words} word{answer.words === 1 ? "" : "s"}
                {answer.min_words ? ` — the question asked for at least ${answer.min_words}` : ""}
              </p>
            )}
          </div>
        )}
```

and import `codingFenceTag` from `coding.ts`.

`ComparisonDrawer.tsx` `AnswerEvidence` (131-150): the written branch is `(answer.question_type === "CASE_STUDY" || answer.answer_text !== null)`, so a code answer already qualifies — it must only stop being printed as prose. Replace that one line with a CODING `<pre>` and keep the existing paragraph for everything else:

```tsx
          {answer.question_type === "CODING" ? (
            <div>
              {answer.language ? <p className="font-semibold">{answer.language}</p> : null}
              <pre className="whitespace-pre-wrap break-words font-mono">{answer.answer_text || "No written text recorded."}</pre>
            </div>
          ) : (
            (answer.question_type === "CASE_STUDY" || answer.answer_text !== null) && <p>{answer.answer_text || "No written text recorded."}</p>
          )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/prove-coding-question.mjs`
Expected: PASS.

- [ ] **Step 6: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/assessment/domain/attemptAnswers.ts src/modules/assessment/domain/comparison.ts "src/app/(admin)/assessments/actions.ts" "src/app/(admin)/assessments/IssuedLinksBoard.tsx" "src/app/(admin)/assessments/ComparisonDrawer.tsx" scripts/prove-coding-question.mjs
git commit -m "feat(assessments): show a reviewer the code as written" -m "A code answer reaches the reading desk and the comparison drawer with its language, and both print it inside a preformatted block. Nothing renders it as markup, so a candidate's angle brackets are characters and not structure."
```

---

### Task 11: The Guide states the rules, and the proofs pin them

**Files:**
- Modify: `src/modules/shell/domain/pageGuide.ts:252-308`
- Modify: `scripts/prove-guide-figures.mjs` (two cap figures)
- Modify: `scripts/prove-coding-question.mjs` (Guide copy pins)
- Modify: `scripts/prove-migration-claims.mjs:45-91`

**Interfaces:**
- Consumes: `CODE_ANSWER_CAP`, `CODE_STARTER_CAP`, `CODING_LANGUAGES` from `coding.ts`.
- Produces: the Guide's `/assessments` page states the caps, the not-run rule and the language list in figures the proofs can pin, and the proofs hold the 039 sentence Task 4 wrote; `prove-migration-claims.mjs` asks the database for the CODING label.

- [ ] **Step 1: Write the failing tests**

Add to `prove-guide-figures.mjs` a `/assessments` case in its existing table shape:

```js
  {
    route: "/assessments",
    want: "the coding answer cap",
    guide: /A coding answer holds at most ([\d,]+) characters/,
    sources: [
      { rel: "src/modules/assessment/domain/coding.ts", pattern: /export const CODE_ANSWER_CAP = ([\d_]+);/ },
    ],
  },
  {
    route: "/assessments",
    want: "the coding starter cap",
    guide: /starter is optional and holds at most ([\d,]+) characters/,
    sources: [
      { rel: "src/modules/assessment/domain/coding.ts", pattern: /export const CODE_STARTER_CAP = ([\d_]+);/ },
    ],
  },
```

Add to `prove-coding-question.mjs`:

```js
sourceHas("the Guide states the coding rules in the same voice as the rest", "src/modules/shell/domain/pageGuide.ts", [
  "A coding answer holds at most",
  "never compiled",
  "039_coding_questions.sql",
]);
check(
  "the Guide names every language the picker offers, in order",
  read("src/modules/shell/domain/pageGuide.ts").includes(CODING_LANGUAGES.join(", ")),
  "a language missing from the Guide is a language the author cannot look up"
);
```

`prove-migration-claims.mjs`: add an entry to `MIGRATIONS` (45-91), in the same `{ file, asks }` shape as 034:

```js
  {
    file: "039_coding_questions.sql",
    asks:
      "select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'question_type' and e.enumlabel = 'CODING') as present",
  },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/prove-guide-figures.mjs`
Run: `node scripts/prove-coding-question.mjs`
Expected: FAIL — the Guide has no cap sentences and no migration-claims entry exists.

- [ ] **Step 3: Write the Guide copy**

`src/modules/shell/domain/pageGuide.ts:252-308`, inside the `/assessments` page:

- The `"Six question types: …"` sentence Task 4 wrote already names coding in the same style as the fifth. Read it; do not rewrite it.
- A new sentence states the caps exactly as the proof pins them: `A coding answer holds at most 20,000 characters, and the starter is optional and holds at most 10,000 characters.` (the proof captures each figure out of its own clause, so both clauses must carry the word "characters").
- A new sentence states the rule plainly: code is `never compiled`, run or tested; a person reviews it.
- Confirm, do not re-add: Task 4 put the 039 sentence directly after the 034 sentence, in the same conditional voice — while the migration is absent the picker hides the type and a save is refused. Step 1's `sourceHas` needle reads it from there, so a second copy is drift, not redundancy.
- The language list appears where the picker's list is described, so an author can see all ten without opening the form. Write it as a contiguous run in `CODING_LANGUAGES` order, because the proof compares against `CODING_LANGUAGES.join(", ")`: `A coding question fixes one language for the answer — JavaScript, TypeScript, Python, Java, C#, Go, SQL, PHP, Ruby, C++ — and the candidate writes in a plain text box.`

Do not restate the rubric weight total, the picker window or any figure another task owns.

- [ ] **Step 4: Pin the migration claim**

Apply the `MIGRATIONS` entry from Step 1. Because `prove-migration-claims.mjs` derives `namedFiles` by scanning `src/**/*.{ts,tsx}`, `CODING_MIGRATION` in `coding.ts` already satisfies the "the copy names every migration this proof asks about" check; confirm it does rather than adding a second literal.

- [ ] **Step 5: Confirm the situational proof**

No edit is expected here. Task 3 moved the five-member pin at `prove-situational.mjs:560` to six, and Task 4 moved its Guide needle from `"Five question types:"` to `"Six question types:"` and added `039_coding_questions.sql`. Nothing else in the repo counts question types. Run the proof; if it fails, its own message names the sentence or pin that no longer matches — repair the copy and the pin together rather than deleting the needle.

- [ ] **Step 6: Run the affected proofs**

Run: `node scripts/prove-guide-figures.mjs`
Run: `node scripts/prove-coding-question.mjs`
Run: `node scripts/prove-situational.mjs`
Run: `node scripts/prove-migration-claims.mjs`
Expected: the first three PASS. `prove-migration-claims.mjs` requires the local Docker database (`docker/.env`); if it is not running, record that as a deferred check rather than starting containers.

- [ ] **Step 7: Run the gates**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Run: `npm run lint; echo "lint exit=$?"`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/shell/domain/pageGuide.ts scripts/prove-guide-figures.mjs scripts/prove-coding-question.mjs scripts/prove-migration-claims.mjs
git commit -m "docs(assessments): say what a coding question holds and what it never does" -m "The Guide carries the two caps, the closed language list and the rule that code is reviewed rather than run, and names 039 as the migration the type waits on. The figure and migration proofs pin the caps to the domain constants and ask the database for the label, so copy and code cannot drift apart."
```

---

### Task 12: Whole-suite gate

**Files:** none.

- [ ] **Step 1: Type check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Expected: `tsc exit=0`.

- [ ] **Step 2: Lint**

Run: `npm run lint; echo "lint exit=$?"`
Expected: `lint exit=0`.

- [ ] **Step 3: Every affected proof**

Run each and record its exit:

```bash
node scripts/prove-coding-question.mjs; echo "coding exit=$?"
node scripts/prove-situational.mjs; echo "situational exit=$?"
node --test scripts/prove-scoring-rubric.mjs; echo "scoring exit=$?"
node scripts/prove-rubric-review-ui.mjs; echo "review-ui exit=$?"
node scripts/prove-guide-figures.mjs; echo "guide-figures exit=$?"
node scripts/prove-migration-claims.mjs; echo "migration-claims exit=$?"
```

Expected: every exit 0 except, possibly, `prove-migration-claims.mjs`, which needs the local Docker database. If it fails for a missing database, say so explicitly in the report; do not start containers or apply migrations to make it pass.

- [ ] **Step 4: Confirm the branch's own claims**

Read the committed diff and confirm:

- `db/migrations/039_coding_questions.sql` exists and no migration was applied.
- No file outside the assessment module, its routes, the store, the Guide and the proofs was touched.
- No `child_process`, `vm`, `eval` or `new Function` appears in any file this plan created.
- The candidate portal, `NoticeInbox` and `communication_logs` are untouched.

- [ ] **Step 5: Report**

Write a short report: the proof results as a table, the two unapplied slices (`039` and anything the plan deliberately left, e.g. the Guide cap if Step 3 was deferred), and an offer to commit anything still uncommitted. Do not push.
