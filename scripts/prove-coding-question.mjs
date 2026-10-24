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
      let asked = null;
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          asked = value;
          queries.push({ table, column, value });
          return query;
        },
        then(resolve, reject) {
          const failed = failingType !== null && asked === failingType;
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

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
