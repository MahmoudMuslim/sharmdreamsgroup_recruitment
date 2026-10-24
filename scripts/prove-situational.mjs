/* scripts/prove-situational.mjs
 * Run: node --experimental-strip-types scripts/prove-situational.mjs
 *
 * #261 adds the situational judgment question type: a workplace scene whose
 * responses each earn a 0–100 percentage of the question's marks instead of one
 * being right. `db/migrations/034_situational_judgment.sql` is authored and NOT
 * applied, so on the live stack the fifth enum value does not exist yet. What
 * can be pinned without a database is the part every door shares:
 *
 *   1. the arithmetic — one module decides what a pick earns, for the runner,
 *      the submit route, the review desk, the bank and the AI drafter;
 *   2. what an author may save — at least two responses, whole 0–100 scores,
 *      and at least two that differ;
 *   3. the bank — a judgment scene is its own kind, keeps its percentages, and
 *      is refused a pass/fail copy onto the apply form;
 *   4. the authored DDL — one appended enum label, one schema reload, no column
 *      and no backfill;
 *   5. the wiring markers — the editor, the availability probe, the runner, the
 *      submit route, the sanitizer, the review desk and the chat all agree.
 *
 * (4) and (5) are text assertions, deliberately: the SQL is reviewed, never run
 * here, and the screens need a browser. They catch the files being edited apart,
 * not a runtime that was misconfigured. Whether 034 is applied to any given
 * database is a fact about that database, not about this tree, and is checked
 * separately against the local stack.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

import {
  SITUATIONAL_JUDGMENT,
  SITUATIONAL_MIGRATION,
  SITUATIONAL_SCHEMA_NOTE,
  SITUATIONAL_WRITE_REFUSAL,
  bestJudgmentScore,
  isMissingQuestionTypeError,
  judgeChoice,
  judgmentOptionsOf,
  judgmentStoredOptions,
  readJudgmentDraft,
  readJudgmentScore,
} from "../src/modules/assessment/domain/situational.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// `bank.ts` imports through the app's `@/` alias. Plain Node cannot resolve it,
// so teach this one process the same mapping the bundler uses, then import the
// module dynamically (static imports would run before these hooks exist).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(root, "src", specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const bank = await import("../src/modules/questions/bank.ts");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. What a stored percentage means
// ---------------------------------------------------------------------------
for (const [label, value, want] of [
  ["zero is a real score", 0, 0],
  ["one hundred is a real score", 100, 100],
  ["a whole number passes through", 42, 42],
  ["a fraction is rounded once", 59.6, 60],
  ["a half rounds up", 59.5, 60],
  ["a negative percentage is refused", -1, null],
  ["above one hundred is refused", 101, null],
  ["NaN is refused", Number.NaN, null],
  ["Infinity is refused", Number.POSITIVE_INFINITY, null],
  ["a numeric string is refused", "50", null],
  ["null is refused", null, null],
  ["undefined is refused", undefined, null],
]) {
  const got = readJudgmentScore(value);
  check(`readJudgmentScore: ${label}`, got === want, String(got));
}

// ---------------------------------------------------------------------------
// 2. Reading a scene, and marking one pick
// ---------------------------------------------------------------------------
const scene = {
  options: [
    { label: "OPT_1", text: "Escalate to the client immediately", is_correct: false, score: 30 },
    { label: "OPT_2", text: "Ask the client what they need first", is_correct: false, score: 100 },
    { label: "OPT_3", text: "Say nothing and hope it clears", is_correct: false, score: 0 },
    { label: "OPT_4", text: "A row that stores no score" },
    { label: "OPT_5", text: "A row with an impossible score", score: 140 },
  ],
};

const readScene = judgmentOptionsOf(scene);
check("every response is read, scored or not", readScene.length === 5, String(readScene.length));
check(
  "stored percentages are carried and bad ones are left null",
  same(
    readScene.map((option) => option.score),
    [30, 100, 0, null, null]
  ),
  readScene.map((option) => option.score).join(", ")
);
check("the best effectiveness is the highest readable score", bestJudgmentScore(readScene) === 100);
check("a scene with no config has no responses", judgmentOptionsOf(null).length === 0);
check("a scene with no responses has no best score", bestJudgmentScore([]) === null);
check(
  "a scene whose responses are all unscored has no best score",
  bestJudgmentScore(judgmentOptionsOf({ options: [{ label: "OPT_1", text: "Only" }] })) === null
);

const best = judgeChoice(30, scene, "OPT_2");
check("the best response earns the whole question", best.score === 30, String(best.score));
check("the best response is recorded as 100%", best.percent === 100, String(best.percent));
check("the chosen wording is carried", best.chosen_text === "Ask the client what they need first");
check("the best wording is carried", best.best_text === "Ask the client what they need first");
check("the at-best rationale states the marks", /100% effective, 30 of 30 marks/.test(best.rationale), best.rationale);
check("the at-best rationale flags the reward", /response this scene rewards/.test(best.rationale));
check("an at-best pick has a strength", same(best.strengths, ["Picked the response the scene rewards"]));
check("an at-best pick has nothing to improve", best.improvements.length === 0);

const middling = judgeChoice(30, scene, "OPT_1");
check("a weaker response earns its share, rounded once", middling.score === 9, String(middling.score));
check("a weaker response records its percentage", middling.percent === 30, String(middling.percent));
check("the weaker rationale names the best response", middling.rationale.includes("Ask the client what they need first"), middling.rationale);
check("a 30% pick earns no strength", middling.strengths.length === 0);
check("a 30% pick says what to compare", middling.improvements.some((word) => word.includes("most effective response")));

const workable = judgeChoice(10, { options: [{ label: "OPT_1", text: "Workable", score: 60 }, { label: "OPT_2", text: "Ideal", score: 90 }] }, "OPT_1");
check("a 60% pick is called workable", same(workable.strengths, ["Chose a workable response"]), workable.strengths.join(", "));
check("a 60% pick earns 6 of 10", workable.score === 6, String(workable.score));

const rounded = judgeChoice(7, { options: [{ label: "OPT_1", text: "Half", score: 50 }, { label: "OPT_2", text: "Best", score: 90 }] }, "OPT_1");
check("half of seven marks rounds to four", rounded.score === 4, String(rounded.score));

const zero = judgeChoice(30, scene, "OPT_3");
check("the worst response earns nothing", zero.score === 0);
check("the worst response still records its percentage", zero.percent === 0);

const unknown = judgeChoice(30, scene, "OPT_9");
check("an unknown label earns nothing", unknown.score === 0);
check("an unknown label has no percentage", unknown.percent === null);
check("an unknown label is named unscorable", /does not match a response/.test(unknown.rationale), unknown.rationale);
check("an unknown label does not invent wording", unknown.chosen_text === null);
check("an unknown label still names the best response", unknown.best_text === "Ask the client what they need first");

const blank = judgeChoice(30, scene, null);
check("a blank answer earns nothing", blank.score === 0);
check("a blank answer says nothing was recorded", /No response was recorded/.test(blank.rationale), blank.rationale);
check("a blank answer tells the candidate to answer", blank.improvements.some((word) => word.includes("Answer the scene")));

const textNotLabel = judgeChoice(30, scene, "Ask the client what they need first");
check("a response's wording is not its label", textNotLabel.percent === null && /does not match a response/.test(textNotLabel.rationale));

const unscored = judgeChoice(30, { options: [{ label: "OPT_1", text: "A" }, { label: "OPT_2", text: "B" }] }, "OPT_1");
check("a scene with no readable percentages cannot be marked", unscored.score === 0 && unscored.percent === null);
check("an unmarkable scene says so", /carries no scored responses/.test(unscored.rationale), unscored.rationale);

const tied = judgeChoice(10, {
  options: [
    { label: "OPT_1", text: "First best", score: 100 },
    { label: "OPT_2", text: "Second best", score: 100 },
  ],
}, "OPT_2");
check("a tie still awards the whole question", tied.score === 10 && tied.percent === 100);
check("a tie names the first of the best responses", tied.best_text === "First best", tied.best_text);
check("a tie is still at best", tied.improvements.length === 0);

// ---------------------------------------------------------------------------
// 3. What an author may save
// ---------------------------------------------------------------------------
const saved = readJudgmentDraft([
  { text: "", score: null },
  { text: "  Escalate  ", score: 0 },
  { text: "Ask first", score: 50 },
]);
check("a blank row is dropped rather than refused", saved.ok);
check("the kept responses are trimmed", saved.ok && saved.options[0].text === "Escalate", saved.ok ? saved.options[0].text : saved.error);
check("a scene may include a zero score", saved.ok && same(saved.options.map((option) => option.score), [0, 50]));

for (const [label, options, needle] of [
  [
    "one response",
    [{ text: "Only", score: 50 }],
    "at least two responses",
  ],
  [
    "only blank rows",
    [
      { text: "", score: null },
      { text: "   ", score: 100 },
    ],
    "at least two responses",
  ],
  [
    "a response with no score",
    [
      { text: "A", score: null },
      { text: "B", score: 80 },
    ],
    "whole-number score",
  ],
  [
    "a fractional score",
    [
      { text: "A", score: 50.5 },
      { text: "B", score: 80 },
    ],
    "whole-number score",
  ],
  [
    "a score above 100",
    [
      { text: "A", score: 101 },
      { text: "B", score: 80 },
    ],
    "whole-number score",
  ],
  [
    "a negative score",
    [
      { text: "A", score: -1 },
      { text: "B", score: 80 },
    ],
    "whole-number score",
  ],
  [
    "every response scored the same",
    [
      { text: "A", score: 50 },
      { text: "B", score: 50 },
    ],
    "at least two different response scores",
  ],
]) {
  const got = readJudgmentDraft(options);
  check(`readJudgmentDraft refuses ${label}`, !got.ok, got.ok ? "accepted" : "");
  check(
    `the refusal for ${label} names what is missing`,
    !got.ok && got.error.includes(needle),
    got.ok ? "" : got.error
  );
}

const stored = judgmentStoredOptions(saved.ok ? saved.options : []);
check("stored responses carry stable handles", same(stored.map((option) => option.label), ["OPT_1", "OPT_2"]));
check("stored responses carry their wording", same(stored.map((option) => option.text), ["Escalate", "Ask first"]));
check("stored responses carry their percentages", same(stored.map((option) => option.score), [0, 50]));
check("no stored response is marked correct", stored.every((option) => option.is_correct === false));

// ---------------------------------------------------------------------------
// 4. The migration and the schema-missing predicate
// ---------------------------------------------------------------------------
check(
  "the migration is named by its real path",
  SITUATIONAL_MIGRATION === "db/migrations/034_situational_judgment.sql",
  SITUATIONAL_MIGRATION
);
check("the enum label is spelled as the migration adds it", SITUATIONAL_JUDGMENT === "SITUATIONAL_JUDGMENT");
check(
  "the read note names the migration and says authored but not applied",
  SITUATIONAL_SCHEMA_NOTE.includes(SITUATIONAL_MIGRATION) &&
    /authored but not applied/.test(SITUATIONAL_SCHEMA_NOTE),
  SITUATIONAL_SCHEMA_NOTE
);

for (const [label, error, want] of [
  ["enum input refusal (22P02)", { code: "22P02", message: "" }, true],
  [
    "the enum wording without a code",
    { message: 'invalid input value for enum question_type: "SITUATIONAL_JUDGMENT"' },
    true,
  ],
  ["a stale REST cache", { message: "Could not find the value in the schema cache" }, true],
  ["a check violation (23514)", { code: "23514", message: "" }, false],
  ["a vanished suite (23503)", { code: "23503", message: "" }, false],
  ["a duplicate (23505)", { code: "23505", message: "" }, false],
  ["a permission refusal (42501)", { code: "42501", message: "" }, false],
  ["no error at all", null, false],
  ["undefined", undefined, false],
]) {
  check(`isMissingQuestionTypeError: ${label}`, isMissingQuestionTypeError(error) === want);
}

const migration = read(SITUATIONAL_MIGRATION);
for (const [label, needle] of [
  ["appends the label idempotently", "alter type public.question_type add value if not exists 'SITUATIONAL_JUDGMENT';"],
  ["reloads the REST schema", "notify pgrst, 'reload schema';"],
  ["says it is not applied", "This migration is NOT applied to any database yet."],
  ["names the refusal a probe meets", "22P02"],
  ["keeps the scores in config rather than a column", "assessment_questions.config"],
]) {
  check(`034 ${label}`, migration.includes(needle), needle);
}
check("034 changes the enum and nothing else", (migration.match(/alter type/gi) ?? []).length === 1);
check("034 adds no column", !/add column/i.test(migration));
check("034 creates no table", !/create table/i.test(migration));
check("034 backfills no row", !/\bupdate\s+public\./i.test(migration));
check("034 defaults nothing", !/\bdefault\b/i.test(migration));

// ---------------------------------------------------------------------------
// 5. The bank reads a scene as a scale, not a key
// ---------------------------------------------------------------------------
const judgmentRow = {
  id: "q-sjt",
  template_id: "tpl-1",
  question_type: "SITUATIONAL_JUDGMENT",
  title: "The late deliverable",
  prompt: "  A client is waiting and the draft is not ready.  ",
  instructions: null,
  config: {
    options: [
      { label: "OPT_1", text: "Ship it unpolished", is_correct: false, score: 40 },
      { label: "OPT_2", text: "Call the client first", is_correct: false, score: 90 },
      { label: "OPT_3", text: "Say nothing", is_correct: false, score: 0 },
      { label: "OPT_4", text: "Hand-edited, no score", is_correct: false },
      { label: "OPT_5", text: "Hand-edited, impossible", is_correct: false, score: 140 },
      { label: "OPT_6", text: "Hand-edited, fractional", is_correct: false, score: 59.6 },
    ],
  },
  points: 20,
  position: 1,
  time_limit_minutes: null,
  shuffle_options: true,
};

const quizRow = {
  id: "q-mcq",
  template_id: "tpl-1",
  question_type: "MULTIPLE_CHOICE",
  title: "Which is a liability?",
  prompt: "Pick one.",
  instructions: "Read carefully.",
  config: {
    options: [
      { label: "OPT_1", text: "Cash", is_correct: false },
      { label: "OPT_2", text: "A bank loan", is_correct: true },
    ],
  },
  points: 10,
  position: 2,
  time_limit_minutes: 5,
  shuffle_options: true,
};

const placeOf = (templateId) =>
  templateId === "tpl-1" ? { label: "Ops test", isOpen: true } : null;

const [judgmentQuestion, quizQuestion] = bank.bankSuiteQuestions(
  [judgmentRow, quizRow],
  placeOf
);

check("a judgment row becomes its own kind", judgmentQuestion.kind === "judgment", judgmentQuestion.kind);
check("a judgment row is labelled in the bank", bank.KIND_LABELS.judgment === "Situational judgment");
check("the prompt is trimmed", judgmentQuestion.text === "A client is waiting and the draft is not ready.");
check("the bank keeps every readable response", judgmentQuestion.answers.length === 6, String(judgmentQuestion.answers.length));
check(
  "the bank keeps the percentages",
  same(
    judgmentQuestion.answers.map((answer) => answer.score),
    [40, 90, 0, null, null, 60]
  ),
  judgmentQuestion.answers.map((answer) => answer.score).join(", ")
);
check(
  "a malformed stored percentage is left null, not guessed",
  judgmentQuestion.answers[3].score === null && judgmentQuestion.answers[4].score === null
);
check(
  "a fractional stored percentage is rounded on the way out",
  judgmentQuestion.answers[5].score === 60,
  String(judgmentQuestion.answers[5].score)
);
check("no judgment response counts as accepted", judgmentQuestion.acceptedCount === 0);
check("a judgment scene gates nothing on the form", judgmentQuestion.effect === null);
check("the scene keeps its marks", judgmentQuestion.points === 20);
check("an open suite's question is live", judgmentQuestion.isLive === true);

check("a quiz row stays a choice", quizQuestion.kind === "choice", quizQuestion.kind);
check(
  "a quiz option carries no percentage",
  same(quizQuestion.answers.map((answer) => answer.score), [null, null])
);
check(
  "a quiz's correct answer is still accepted",
  same(quizQuestion.answers.map((answer) => answer.accepted), [false, true])
);

const suiteKinds = [
  ["MULTIPLE_CHOICE", "choice"],
  ["SITUATIONAL_JUDGMENT", "judgment"],
  ["CASE_STUDY", "written"],
  ["EXCEL_MODEL", "spreadsheet"],
  ["VIDEO_PITCH", "video"],
];
for (const [questionType, kind] of suiteKinds) {
  const [row] = bank.bankSuiteQuestions(
    [
      {
        ...quizRow,
        id: `q-${questionType}`,
        question_type: questionType,
        prompt: `A ${questionType} question.`,
      },
    ],
    placeOf
  );
  check(`a ${questionType} row maps to ${kind}`, row.kind === kind, row.kind);
}

const videoQuestion = bank.bankSuiteQuestions(
  [{ ...quizRow, id: "q-video", question_type: "VIDEO_PITCH", prompt: "Record a pitch." }],
  placeOf
)[0];
check("a non-choice kind reads no answers from config", videoQuestion.answers.length === 0);

const blankPrompt = bank.bankSuiteQuestions([{ ...judgmentRow, prompt: "   " }], placeOf);
check("a question with no prompt is dropped", blankPrompt.length === 0);
const missingSuite = bank.bankSuiteQuestions([judgmentRow], () => null);
check("a question whose suite vanished is dropped", missingSuite.length === 0);
const paused = bank.bankSuiteQuestions([judgmentRow], () => ({ label: "Ops test", isOpen: false }))[0];
check("a paused suite's question says so", paused.where === "Ops test (a paused suite)", paused.where);
check("a paused suite's question is not live", paused.isLive === false);

// ---------------------------------------------------------------------------
// 6. Moving a scene through the bank
// ---------------------------------------------------------------------------
const jobs = [{ id: "job-1", label: "Accountant" }];
const suites = [
  { id: "tpl-1", label: "Ops test" },
  { id: "tpl-2", label: "Finance test" },
];

const judgmentTargets = bank.bankTargetsFor(judgmentQuestion, jobs, suites);
check("a judgment scene is offered another suite", judgmentTargets.length === 1, String(judgmentTargets.length));
check("the target is the other suite", judgmentTargets[0]?.store === "suite" && judgmentTargets[0]?.placeKey === "tpl-2");
check("the suite copy is verbatim, scores included", judgmentTargets[0]?.note === "Copied as the same kind, with its marks, guidance and answer set.");

// A hand-edited scene that somehow carries an accepted flag still has a scale,
// not a key — the refusal is about the kind, not the flag.
const handEditedScene = { ...judgmentQuestion, acceptedCount: 1 };
const handEditedTargets = bank.bankTargetsFor(handEditedScene, jobs, suites);
check(
  "a judgment scene is never offered the apply form",
  handEditedTargets.every((target) => target.store === "suite"),
  handEditedTargets.map((target) => target.store).join(", ")
);

const quizTargets = bank.bankTargetsFor(quizQuestion, jobs, suites);
check(
  "a one-key quiz is offered the other suite and both form scopes",
  same(
    quizTargets.map((target) => `${target.store}:${target.placeKey}`),
    ["suite:tpl-2", "gate:shared", "gate:job-1"]
  ),
  quizTargets.map((target) => `${target.store}:${target.placeKey}`).join(", ")
);
check(
  "the quiz's form copy says which answer becomes the gate",
  quizTargets.find((target) => target.store === "gate")?.note ===
    "Becomes a no-points apply-form question: the correct answer is the one that keeps an application in the running."
);

const gateQuestion = {
  ...quizQuestion,
  key: "gate:g-1",
  store: "gate",
  id: "g-1",
  scopeKey: bank.SHARED_SCOPE,
  effect: null,
};
const gateTargets = bank.bankTargetsFor(gateQuestion, jobs, suites);
check(
  "a form question is offered the roles it is not on and every suite",
  same(
    gateTargets.map((target) => `${target.store}:${target.placeKey}`),
    ["gate:job-1", "suite:tpl-1", "suite:tpl-2"]
  ),
  gateTargets.map((target) => `${target.store}:${target.placeKey}`).join(", ")
);
check(
  "a form question with two accepted answers is offered no quiz",
  bank.bankTargetsFor({ ...gateQuestion, acceptedCount: 2 }, jobs, suites).every(
    (target) => target.store === "gate"
  )
);

const judgmentRefusal = bank.bankCrossStoreReason(judgmentQuestion, "gate");
check(
  "the judgment refusal explains the scale, not a missing answer",
  judgmentRefusal !== null &&
    /percentage/.test(judgmentRefusal) &&
    /no pass\/fail key/.test(judgmentRefusal),
  judgmentRefusal ?? "null"
);
check(
  "a judgment scene may still be copied to another suite",
  bank.bankCrossStoreReason(judgmentQuestion, "suite") === null
);
check(
  "a video pitch is refused the form for the written-answer reason",
  /written answer, a spreadsheet or a video/.test(
    bank.bankCrossStoreReason(videoQuestion, "gate") ?? ""
  )
);
check(
  "a quiz with no single key is refused the form",
  /do not leave exactly one to accept/.test(
    bank.bankCrossStoreReason({ ...quizQuestion, acceptedCount: 0 }, "gate") ?? ""
  )
);
check(
  "a one-key quiz may cross to the form",
  bank.bankCrossStoreReason(quizQuestion, "gate") === null
);
check(
  "a form question with two accepted answers is refused a quiz",
  /accepts more than one answer/.test(
    bank.bankCrossStoreReason({ ...gateQuestion, acceptedCount: 2 }, "suite") ?? ""
  )
);

const judgmentRail = bank.BANK_KIND_RAILS.findIndex((rail) => rail.key === "judgment");
check("the bank's kind rail carries judgment", judgmentRail === 2, String(judgmentRail));
check(
  "the rail is labelled the same as the kind",
  bank.BANK_KIND_RAILS[judgmentRail].label === bank.KIND_LABELS.judgment
);

// ---------------------------------------------------------------------------
// 7. Wiring markers — one vocabulary, every door
// ---------------------------------------------------------------------------
function sourceHas(label, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(
    label,
    missing.length === 0,
    missing.length ? `missing ${missing.map((n) => JSON.stringify(n)).join(", ")}` : ""
  );
  return text;
}

sourceHas("the model type has five members", "src/types/index.ts", [
  '"SITUATIONAL_JUDGMENT"',
  "score?: number",
]);

sourceHas("the runner dispatches a judgment scene", "src/modules/assessment/presentation/AssessmentRunner.tsx", [
  'import { SituationalRunner } from "@/modules/assessment/presentation/components/SituationalRunner";',
  'case "SITUATIONAL_JUDGMENT":',
  "<SituationalRunner question={currentQuestion} />",
]);

const situationalRunner = sourceHas(
  "the judgment runner asks for the likely response, not the right one",
  "src/modules/assessment/presentation/components/SituationalRunner.tsx",
  [
    "Choose the response you would most likely make.",
    'role="radiogroup"',
    "setChoiceAnswer(question.id, option.label);",
  ]
);
check(
  "the judgment runner never renders a percentage",
  !/option\.score/.test(situationalRunner)
);

const attemptRoute = read("src/app/api/attempt/[token]/route.ts");
const sanitized = attemptRoute.match(
  /const options = source\.options\.map\(\(option\) => \(\{([\s\S]*?)\}\)\);/
)?.[1] ?? "";
check("the attempt read sanitizes options", sanitized.length > 0);
check(
  "a candidate receives labels and wording only",
  /label: option\.label/.test(sanitized) && /text: option\.text/.test(sanitized)
);
check("a candidate never receives a percentage", !/score/.test(sanitized), sanitized.trim());
// Copying the whole config would have handed a sitting candidate the rubric a
// recruiter writes, so the candidate's copy is now built from the keys the
// runner reads. `scripts/prove-scoring-rubric.mjs` runs the route and proves the
// behaviour; this marker keeps it from quietly becoming a spread again.
check(
  "the candidate's config is rebuilt from an allow-list, not a copy of the row",
  /const config: AttemptPayload\["questions"\]\[number\]\["config"\] = \{\};/.test(attemptRoute) &&
    !/\.\.\.\(question\.config/.test(attemptRoute)
);

sourceHas("the submit route marks a judgment pick against its percentage", "src/app/api/attempt/[token]/submit/route.ts", [
  'question.question_type === "SITUATIONAL_JUDGMENT"',
  "judgeChoice(",
  "score: verdict.score,",
  "rationale: verdict.rationale,",
  "handled.add(questionId);",
]);
const submitRoute = read("src/app/api/attempt/[token]/submit/route.ts");
check(
  "the judgment branch runs before the quiz branch",
  submitRoute.indexOf('question.question_type === "SITUATIONAL_JUDGMENT"') <
    submitRoute.indexOf('question.question_type !== "MULTIPLE_CHOICE"')
);

sourceHas("the background grader leaves inline-scored scenes alone", "src/modules/assessment/application/gradeAttempt.ts", [
  "situational judgment scenes are scored inline by the submit route itself",
  '.is("score", null)',
]);

sourceHas("the editor offers a judgment scene only when the enum has it", "src/app/(admin)/assessments/QuestionEditorDrawer.tsx", [
  'SITUATIONAL_JUDGMENT: "Situational judgment",',
  "situationalAvailable = true,",
  "situationalNote = null,",
  ".filter((type) => type !== \"SITUATIONAL_JUDGMENT\" || situationalAvailable)",
  "!situationalAvailable && situationalNote",
  "Responses and effectiveness",
  "Effectiveness of response ",
  "reads the responses and is never shown a score.",
]);
check(
  "the editor's type filter is applied to both pickers",
  (read("src/app/(admin)/assessments/QuestionEditorDrawer.tsx").match(
    /type !== "SITUATIONAL_JUDGMENT" \|\| situationalAvailable/g
  ) ?? []).length === 2
);

sourceHas("the availability probe names the enum directly", "src/modules/assessment/application/questionTypeAvailability.ts", [
  "probe(restClient, SITUATIONAL_JUDGMENT)",
  '.eq("question_type", questionType);',
  "SITUATIONAL_SCHEMA_NOTE",
  "could not be checked on this database",
]);
sourceHas("the assessments page reads the probe", "src/app/(admin)/assessments/page.tsx", [
  "getQuestionTypeAvailability",
]);
sourceHas("the assessments actions expose the probe", "src/app/(admin)/assessments/actions.ts", [
  "readQuestionTypeAvailability(await createServerRestClient())",
  "readJudgmentScore(option.score)",
  "score: readJudgmentScore(option.score),",
]);
sourceHas("the suite grid passes the probe to the editor", "src/app/(admin)/assessments/AssessmentGrid.tsx", [
  "situationalAvailable={situational.situational}",
  "situationalNote={situational.note}",
]);
sourceHas("the question writer validates through the domain", "src/app/(admin)/assessments/question-actions.ts", [
  "readJudgmentDraft(",
  "judgmentStoredOptions(judgment)",
  "SITUATIONAL_WRITE_REFUSAL",
  "isMissingQuestionTypeError(error) ? SITUATIONAL_WRITE_REFUSAL : error.message",
  'draft.question_type === "MULTIPLE_CHOICE" || draft.question_type === "SITUATIONAL_JUDGMENT"',
]);

sourceHas("the review desk reads response percentages", "src/app/(admin)/assessments/actions.ts", [
  'question.question_type === "SITUATIONAL_JUDGMENT"',
  "chosen_text: arranged.find((option) => option.chosen)?.text ?? null,",
]);
sourceHas("the answers summary words a scene differently", "src/modules/assessment/domain/attemptAnswers.ts", [
  'answer.question_type === "SITUATIONAL_JUDGMENT"',
  '"A response was picked"',
]);
sourceHas("the issued-links desk ranks a scene instead of keying it", "src/app/(admin)/assessments/IssuedLinksBoard.tsx", [
  'SITUATIONAL_JUDGMENT: { word: "Judgment scene", icon: Scale }',
  "const bestJudgment =",
  "Their pick — the strongest response",
  "Most effective response, unpicked",
  "each earns its percentage of the marks",
  "the strongest response is marked.",
  "This judgment scene holds no responses",
]);
sourceHas("the integrity panel names the type", "src/app/(admin)/candidates/IntegrityPanel.tsx", [
  'SITUATIONAL_JUDGMENT: "Situational judgment"',
]);
sourceHas("the bank row prints the ranking", "src/app/(admin)/questions/BankRow.tsx", [
  "const bestScore =",
  "strongest response",
  "% effective",
  "Each response earns its percentage of the marks; none is simply right or wrong.",
]);
sourceHas("the bank view keeps the judgment rail through the URL", "src/app/(admin)/questions/bankView.ts", [
  '["", "choice", "judgment", "written", "spreadsheet", "video"]',
]);
sourceHas("the bank refuses a scene onto the apply form, before the generic refusal", "src/app/(admin)/questions/actions.ts", [
  "JUDGMENT_IS_SCORED",
  "readJudgmentScore(option.score)",
  'row.question_type === "SITUATIONAL_JUDGMENT"',
]);
const questionsActions = read("src/app/(admin)/questions/actions.ts");
check(
  "the judgment refusal precedes the not-a-choice refusal",
  questionsActions.indexOf('row.question_type === "SITUATIONAL_JUDGMENT"') <
    questionsActions.indexOf('row.question_type !== "MULTIPLE_CHOICE"')
);

sourceHas("the AI drafter asks for percentages and validates them", "src/modules/assessment/domain/aiAuthoring.ts", [
  'SITUATIONAL_JUDGMENT: "situational judgment"',
  "judgedOptionsOf(record.options)",
  "readJudgmentDraft(candidates)",
  "its most effective one scores",
  "is_correct: false,",
  'questionType === "SITUATIONAL_JUDGMENT"',
]);
sourceHas("the chat's save_question accepts a judgment scene", "src/modules/assistant/domain/registry/shared.ts", [
  '"SITUATIONAL_JUDGMENT",',
  "scoreField(option)",
  "picksOptions",
  '"options" is required for a SITUATIONAL_JUDGMENT question',
]);
sourceHas("the chat describes the judgment shape", "src/modules/assistant/domain/registry/authoring.ts", [
  "A SITUATIONAL_JUDGMENT scene puts the workplace scenario in prompt",
  "rates each response 0–100",
]);
sourceHas("the chat's suite read names the percentages", "src/modules/assistant/domain/registry/credentials.ts", [
  "effectiveness percentages for a situational judgment scene",
]);
sourceHas("the runner's store knows the fifth type", "src/stores/useAssessmentStore.ts", [
  '| "SITUATIONAL_JUDGMENT"',
]);
sourceHas("the Guide names the fifth type and the migration that adds it", "src/modules/shell/domain/pageGuide.ts", [
  "Five question types:",
  "Situational judgment (a workplace scene",
  "034_situational_judgment.sql",
  "the type picker hides the fifth type",
]);

check(
  "the read note does not promise a retry that cannot work",
  !/try again|retry/i.test(SITUATIONAL_SCHEMA_NOTE),
  SITUATIONAL_SCHEMA_NOTE
);
check(
  "the write refusal names the migration and says the save did not happen",
  SITUATIONAL_WRITE_REFUSAL.includes(SITUATIONAL_MIGRATION) &&
    /not saved/.test(SITUATIONAL_WRITE_REFUSAL),
  SITUATIONAL_WRITE_REFUSAL
);
check(
  "the write refusal promises no retry that cannot work",
  !/try again|retry/i.test(SITUATIONAL_WRITE_REFUSAL),
  SITUATIONAL_WRITE_REFUSAL
);
check(
  "the schema note says the other four types still work",
  /Every other question type works normally/.test(SITUATIONAL_SCHEMA_NOTE),
  SITUATIONAL_SCHEMA_NOTE
);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
