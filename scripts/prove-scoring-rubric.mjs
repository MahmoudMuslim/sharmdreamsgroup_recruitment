/* scripts/prove-scoring-rubric.mjs
 * Run: node --test scripts/prove-scoring-rubric.mjs
 *
 * A scoring rubric is the marking scheme a recruiter writes for a written or
 * recorded answer: named criteria, the share of the question's marks each
 * carries, and what a strong answer shows. It is worth marks, so it is exactly
 * the kind of text that must not reach a candidate who is sitting the test.
 *
 * The candidate route reads `assessment_questions` with `.select("*")` and hands
 * the rows to an inline sanitizer that copies the whole `config` and rewrites
 * only the keys it knows about. A rubric added to `config` therefore arrives in
 * the browser unless the sanitizer is taught to drop it — so the first thing
 * this file proves is that it does.
 *
 *   1. the boundary — the payload a sitting candidate receives carries nothing
 *      of the rubric, while everything needed to answer a case study or a video
 *      pitch (scenario, word minimum, recording length) still arrives;
 *   2. the arithmetic — what an author may save and what per-criterion bands add
 *      up to, in the rubric domain module;
 *   3. the grading, the review surfaces and the assistant.
 *
 * (1) runs the real route handler: the file is transpiled to CommonJS and
 * executed in a fresh context whose only outside calls are the stubs below, so
 * no database, session or provider is touched. The assertions are behaviour —
 * the JSON a candidate's browser would hold — not the shape of the source.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

import * as rubricDomain from "../src/modules/assessment/domain/rubric.ts";
import * as attemptAnswersDomain from "../src/modules/assessment/domain/attemptAnswers.ts";
import * as comparisonDomain from "../src/modules/assessment/domain/comparison.ts";
import { createRestClient } from "../src/lib/rest/client.ts";
import * as situational from "../src/modules/assessment/domain/situational.ts";
import * as codingDomain from "../src/modules/assessment/domain/coding.ts";
import * as trail from "../src/modules/activity/domain/trail.ts";
import * as attemptTotals from "../src/modules/assessment/domain/attemptTotals.ts";
import * as sweepSelection from "../src/modules/assessment/domain/sweepSelection.ts";
import * as skillTags from "../src/modules/assessment/domain/skillTags.ts";

import {
  MAX_RUBRIC_CRITERIA,
  MIN_RUBRIC_CRITERIA,
  rubricAllowances,
  rubricCriteriaOf,
  rubricEvaluation,
  readRubricDraft,
  scoreRubric,
} from "../src/modules/assessment/domain/rubric.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) =>
  readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * Runs the real `GET /api/attempt/[token]` against a synthetic database.
 *
 * Every module the route imports is a stub here, so the only production code
 * under test is the route's own reading and sanitizing of a question row.
 */
function harness(tables, options = {}) {
  const queries = [];
  const updates = [];
  const rows = {
    candidate_attempts: [],
    assessment_templates: [],
    assessment_questions: [],
    candidate_responses: [],
    ...tables,
  };

  const client = {
    from(table) {
      const query = { table, operations: [] };
      queries.push(query);
      const builder = {
        select(...args) {
          query.select = args;
          return this;
        },
        eq(column, value) {
          query.operations.push(["eq", column, value]);
          return this;
        },
        order(column, config) {
          query.operations.push(["order", column, config]);
          return this;
        },
        update(values) {
          query.values = values;
          return this;
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
          try {
            let found = [...(rows[table] ?? [])];
            for (const [operation, column, value] of query.operations) {
              if (operation === "eq") found = found.filter((row) => row[column] === value);
            }
            if (query.values) {
              updates.push({ table, values: query.values });
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            }
            return Promise.resolve({
              data: query.single ? found[0] ?? null : found,
              error: options.dbError === table ? { message: "Assessment not found" } : null,
            }).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return builder;
    },
  };

  const responses = [];
  const compiled = ts.transpileModule(read("src/app/api/attempt/[token]/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const bindings = {
    "@/lib/data-api/service": { getServiceRestClient: () => client },
    "@/modules/assessment/application/buildPaper": {
      buildPaper: async () => ({
        questionOrder: options.questionOrder ?? [],
        optionOrder: options.optionOrder ?? {},
      }),
    },
    "@/modules/assessment/application/attemptSettings": {
      getAttemptSettings: async () => ({ ai_enabled: false }),
    },
    "@/modules/assessment/application/linkValidity": {
      isLinkExpired: async () => options.linkExpired ?? false,
    },
    "@/modules/activity/application/record": { recordActivity: async () => ({}) },
    "@/modules/assessment/application/runner-trail": {
      attemptContext: () => ({ candidateName: "Candidate", jobTitle: "Front office agent" }),
      runnerActor: (label) => ({ actorLabel: label, actorId: null }),
    },
    "@/modules/assessment/domain/coding": codingDomain,
    "next/server": {
      NextResponse: {
        json: (body, init) => {
          const result = { body, status: init?.status ?? 200 };
          responses.push(result);
          return result;
        },
      },
    },
  };

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
    get: (token) =>
      context.exports.GET(undefined, { params: Promise.resolve({ token }) }),
    queries,
    updates,
    responses,
  };
}

/** A case study and a video pitch, each carrying a rubric a recruiter wrote. */
const CASE_RUBRIC = [
  { label: "Diagnoses the cause, not the symptom", weight: 40, description: "Names the occupancy driver before proposing anything." },
  { label: "Feasible in this resort", weight: 35, description: "The plan survives a real resort's staffing." },
  { label: "Structure", weight: 25 },
];
const PITCH_RUBRIC = [
  { label: "Opens with the guest's problem", weight: 60 },
  { label: "Closes with a specific ask", weight: 40 },
];

const attemptRow = {
  id: "attempt-1",
  access_token: "token-1",
  status: "IN_PROGRESS",
  template_id: "suite-1",
  time_limit_minutes: 30,
  expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
  current_index_hint: 0,
  applications: { full_name: "Salma Abdelrahim", job_openings: { title: "Front office agent" } },
};

const paperRows = [
  {
    id: "q-case",
    template_id: "suite-1",
    question_type: "CASE_STUDY",
    title: "The quiet season",
    prompt: "Describe how you would respond.",
    points: 20,
    position: 0,
    config: {
      context: "A resort is 30% below occupancy after a competitor opens.",
      min_words: 150,
      rubric: CASE_RUBRIC,
    },
  },
  {
    id: "q-pitch",
    template_id: "suite-1",
    question_type: "VIDEO_PITCH",
    title: "Two-minute pitch",
    prompt: "Pitch this room to a walk-in guest.",
    points: 10,
    position: 1,
    config: {
      min_duration_seconds: 60,
      max_duration_seconds: 120,
      rubric: PITCH_RUBRIC,
    },
  },
  {
    id: "q-quiz",
    template_id: "suite-1",
    question_type: "MULTIPLE_CHOICE",
    title: "Which is a liability?",
    prompt: "Pick one.",
    points: 5,
    position: 2,
    config: {
      options: [
        { label: "OPT_1", text: "Cash", is_correct: false, score: 90 },
        { label: "OPT_2", text: "A bank loan", is_correct: true, score: 0 },
      ],
    },
  },
  {
    id: "q-excel",
    template_id: "suite-1",
    question_type: "EXCEL_MODEL",
    title: "Room revenue model",
    prompt: "Fill the model.",
    points: 15,
    position: 3,
    config: {
      initial_sheet: { data: [["A1"]] },
      expected_outputs: [{ cell: "C4", description: "Total revenue", formula_hint: "=SUM(C2:C3)" }],
    },
  },
];

const openAttempt = () =>
  harness({
    candidate_attempts: [attemptRow],
    assessment_templates: [{ id: "suite-1", name: "Front office" }],
    assessment_questions: paperRows,
  });

const configOf = (body, id) => body.questions.find((question) => question.id === id).config;

// ---------------------------------------------------------------------------
// 1. Nothing of the marking scheme reaches a sitting candidate
// ---------------------------------------------------------------------------
test("a candidate opening the link receives the paper", async () => {
  const h = openAttempt();
  const response = await h.get("token-1");
  assert.equal(response.status, 200);
  assert.equal(response.body.questions.length, 4);
});

test("a case study arrives with no rubric", async () => {
  const h = openAttempt();
  const response = await h.get("token-1");
  assert.equal(configOf(response.body, "q-case").rubric, undefined);
});

test("a video pitch arrives with no rubric", async () => {
  const h = openAttempt();
  const response = await h.get("token-1");
  assert.equal(configOf(response.body, "q-pitch").rubric, undefined);
});

test("the payload carries no criteria wording, description or weight", async () => {
  const h = openAttempt();
  const response = await h.get("token-1");
  const wire = JSON.stringify(response.body);
  for (const secret of [
    "Diagnoses the cause",
    "Names the occupancy driver",
    "Feasible in this resort",
    "The plan survives a real resort",
    "Closes with a specific ask",
    "weight",
    "criteria",
    "rubric",
  ]) {
    assert.ok(!wire.includes(secret), `the candidate payload still carries ${JSON.stringify(secret)}`);
  }
});

test("the scenario, word minimum and recording length still arrive", async () => {
  const h = openAttempt();
  const response = await h.get("token-1");
  assert.equal(configOf(response.body, "q-case").context, "A resort is 30% below occupancy after a competitor opens.");
  assert.equal(configOf(response.body, "q-case").min_words, 150);
  assert.equal(configOf(response.body, "q-pitch").min_duration_seconds, 60);
  assert.equal(configOf(response.body, "q-pitch").max_duration_seconds, 120);
  const caseQuestion = response.body.questions.find((question) => question.id === "q-case");
  assert.equal(caseQuestion.points, 20);
  assert.equal(caseQuestion.prompt, "Describe how you would respond.");
});

test("the keys the sanitizer already guards are still guarded", async () => {
  const h = openAttempt();
  const response = await h.get("token-1");
  assert.deepEqual(
    configOf(response.body, "q-quiz").options.map((option) => Object.keys(option).sort()),
    [["label", "text"], ["label", "text"]]
  );
  assert.deepEqual(
    configOf(response.body, "q-excel").expected_outputs.map((output) => Object.keys(output).sort()),
    [["cell", "description"]]
  );
});

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
      rubric: CASE_RUBRIC,
    },
  };
  const { get } = harness({
    candidate_attempts: [attemptRow],
    assessment_templates: [{ id: "suite-1", name: "Front office" }],
    assessment_questions: [...paperRows, codingRow],
  });
  const response = await get("token-1");
  // The route runs inside a `vm` context, so its objects carry that realm's
  // prototypes; a copy brings them home for a strict deep-equal.
  assert.deepEqual({ ...configOf(response.body, "q-code") }, {
    language: "Python",
    starter_code: "def flatten(x):",
  });
});

test("a coding question's stored rubric never reaches the candidate", async () => {
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
      rubric: CASE_RUBRIC,
    },
  };
  const { get } = harness({
    candidate_attempts: [attemptRow],
    assessment_templates: [{ id: "suite-1", name: "Front office" }],
    assessment_questions: [...paperRows, codingRow],
  });
  const response = await get("token-1");
  assert.equal(configOf(response.body, "q-code").rubric, undefined);
  assert.equal(configOf(response.body, "q-code").language, "Python");
  assert.equal(configOf(response.body, "q-code").starter_code, "def flatten(x):");
});

test("a reloaded code answer lands in its own map, not among the case answers", async () => {
  const codingRow = {
    id: "q-code",
    template_id: "suite-1",
    question_type: "CODING",
    title: "Flatten a nested list",
    prompt: "Write a function that flattens arbitrary nesting.",
    points: 10,
    position: 1,
    config: { language: "Python", starter_code: "def flatten(x):" },
  };
  const { get } = harness(
    {
      candidate_attempts: [attemptRow],
      assessment_templates: [{ id: "suite-1", name: "Front office" }],
      assessment_questions: [paperRows[0], codingRow],
      candidate_responses: [
        {
          id: "r-case",
          attempt_id: "attempt-1",
          question_id: "q-case",
          answer_text: "The competitor took the conference contract.",
          spreadsheet_state: null,
          video_path: null,
        },
        {
          id: "r-code",
          attempt_id: "attempt-1",
          question_id: "q-code",
          answer_text: "def flatten(x): return []",
          spreadsheet_state: null,
          video_path: null,
        },
      ],
    },
    { questionOrder: ["q-case", "q-code"] }
  );
  const response = await get("token-1");
  assert.equal(response.status, 200);
  // The case map must not carry the code answer, and the code map must not
  // carry the case answer: a merged or swapped split fails both.
  assert.deepEqual({ ...response.body.draft.case_study_answers_map }, {
    "q-case": "The competitor took the conference contract.",
  });
  assert.deepEqual({ ...response.body.draft.code_answers_map }, {
    "q-code": "def flatten(x): return []",
  });
});

// ---------------------------------------------------------------------------
// 1b. The write doors — a code answer is stored as written prose
//
// The draft (`PUT`) and submit (`POST`) routes are run against the same kind of
// synthetic database the GET harness uses. `upsert` is the call that stores an
// answer, so it is captured with exactly what the route asked it to write.
// ---------------------------------------------------------------------------

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
  assert.equal(response.status, 200);
  const written = h.upserts.find((entry) => entry.table === "candidate_responses");
  assert.equal(written.values.length, 2);
  // The rows were built inside the VM, so their arrays carry that realm's
  // prototypes; serialising brings them home for a strict deep-equal.
  assert.deepEqual(
    JSON.parse(JSON.stringify(written.values.map((row) => [row.question_id, row.answer_text]).sort())),
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

test("the draft route will not save a case answer through the code door", async () => {
  const h = writeHarness(codingTables(), "PUT");
  await h.send({ code_answers_map: { "q-case": "a case answer" } });
  assert.deepEqual(h.upserts, []);
});

test("the draft route still saves an over-cap answer so nothing is lost", async () => {
  const h = writeHarness(codingTables(), "PUT");
  const response = await h.send({ code_answers_map: { "q-code": "x".repeat(codingDomain.CODE_ANSWER_CAP + 1) } });
  assert.equal(response.status, 200);
  const written = h.upserts.find((entry) => entry.table === "candidate_responses");
  assert.equal(written.values.length, 1);
  assert.equal(written.values[0].answer_text.length, codingDomain.CODE_ANSWER_CAP + 1);
});

// ---------------------------------------------------------------------------
// 2. What an author may save
// ---------------------------------------------------------------------------
const threeCriteria = [
  { label: "Diagnoses the cause", weight: 40, description: "Names the driver before proposing." },
  { label: "Feasible here", weight: 35 },
  { label: "Structure", weight: 25 },
];

test("a draft rubric is trimmed and blank guidance is left off", () => {
  const saved = readRubricDraft([
    { label: "  Diagnoses the cause ", weight: 40, description: "   " },
    { label: "Structure", weight: 60, description: " Flows " },
  ]);
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(saved.criteria, [
    { label: "Diagnoses the cause", weight: 40 },
    { label: "Structure", weight: 60, description: "Flows" },
  ]);
});

test("a row the author never filled in is dropped, not refused", () => {
  const saved = readRubricDraft([
    { label: "", weight: null, description: "" },
    { label: "Cause", weight: 50 },
    { label: "Structure", weight: 50 },
  ]);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.criteria.length, 2);
});

for (const [label, rows, needle] of [
  ["no criteria at all", [], "two criteria"],
  [
    "one criterion",
    [
      { label: "Cause", weight: 100 },
      { label: "", weight: null },
    ],
    "two criteria",
  ],
  [
    "a criterion with no name",
    [
      { label: "   ", weight: 50 },
      { label: "Structure", weight: 50 },
    ],
    "name",
  ],
  [
    `more than the ${MAX_RUBRIC_CRITERIA} allowed`,
    Array.from({ length: MAX_RUBRIC_CRITERIA + 1 }, (_, index) => ({
      label: `Criterion ${index + 1}`,
      weight: 100 / (MAX_RUBRIC_CRITERIA + 1),
    })),
    String(MAX_RUBRIC_CRITERIA),
  ],
  [
    "a weight that is not a whole number",
    [
      { label: "Cause", weight: 33.5 },
      { label: "Structure", weight: 66.5 },
    ],
    "whole-number",
  ],
  [
    "a weight the author left blank",
    [
      { label: "Cause", weight: null },
      { label: "Structure", weight: 100 },
    ],
    "whole-number",
  ],
  [
    "a weight above the whole question",
    [
      { label: "Cause", weight: 120 },
      { label: "Structure", weight: -20 },
    ],
    "whole-number",
  ],
  [
    "a weight of zero",
    [
      { label: "Cause", weight: 0 },
      { label: "Structure", weight: 100 },
    ],
    "whole-number",
  ],
  [
    "weights that stop short of the marks",
    [
      { label: "Cause", weight: 50 },
      { label: "Structure", weight: 40 },
    ],
    "90",
  ],
  [
    "weights that overshoot the marks",
    [
      { label: "Cause", weight: 60 },
      { label: "Feasible", weight: 60 },
    ],
    "120",
  ],
  [
    "two criteria with the same name",
    [
      { label: "Structure", weight: 50 },
      { label: "structure", weight: 50 },
    ],
    "same name",
  ],
]) {
  const refused = readRubricDraft(rows);
  test(`readRubricDraft refuses ${label}`, () => {
    assert.equal(refused.ok, false);
    assert.match(refused.error, new RegExp(needle, "i"));
  });
}

test("the smallest rubric an author may save has two criteria", () => {
  assert.equal(MIN_RUBRIC_CRITERIA, 2);
  const saved = readRubricDraft([
    { label: "Cause", weight: 70 },
    { label: "Structure", weight: 30 },
  ]);
  assert.equal(saved.ok, true, saved.error);
});

// ---------------------------------------------------------------------------
// 3. Reading a rubric a row already holds
// ---------------------------------------------------------------------------
test("a question written before rubrics existed reads as none", () => {
  for (const config of [null, undefined, {}, { context: "x" }, { rubric: [] }]) {
    assert.deepEqual(rubricCriteriaOf(config), []);
  }
});

test("a stored rubric reads in the order the author set it", () => {
  const criteria = rubricCriteriaOf({ rubric: threeCriteria });
  assert.deepEqual(
    criteria.map((criterion) => criterion.label),
    ["Diagnoses the cause", "Feasible here", "Structure"]
  );
  assert.equal(criteria[0].description, "Names the driver before proposing.");
  assert.equal(criteria[1].description, undefined);
});

test("a hand-edited row is dropped rather than guessed at", () => {
  const criteria = rubricCriteriaOf({
    rubric: [
      { label: "Good", weight: 50 },
      { label: "", weight: 50 },
      { label: "Fractional", weight: 50.5 },
      { label: "Over a hundred", weight: 140 },
      { weight: 50 },
      "not an object",
      null,
    ],
  });
  assert.deepEqual(criteria, [{ label: "Good", weight: 50 }]);
});

// ---------------------------------------------------------------------------
// 4. How the question's marks split across the criteria
// ---------------------------------------------------------------------------
test("the allowances add up to exactly what the question is worth", () => {
  for (const [points, weights] of [
    [20, [33, 33, 34]],
    [10, [50, 50]],
    [10, [33, 67]],
    [100, [34, 33, 33]],
    [7, [40, 35, 25]],
    [1, [50, 50]],
  ]) {
    const criteria = weights.map((weight, index) => ({ label: `C${index}`, weight }));
    const allowances = rubricAllowances(points, criteria);
    assert.equal(
      allowances.reduce((sum, marks) => sum + marks, 0),
      points,
      `${points} over ${weights.join("/")} gave ${allowances.join("/")}`
    );
    assert.ok(allowances.every((marks) => Number.isInteger(marks) && marks >= 0));
  }
});

test("an allowance split is deterministic and pays the largest fraction first", () => {
  assert.deepEqual(rubricAllowances(20, threeCriteria), [8, 7, 5]);
  assert.deepEqual(
    rubricAllowances(20, threeCriteria),
    rubricAllowances(20, threeCriteria)
  );
  assert.deepEqual(
    rubricAllowances(10, [
      { label: "A", weight: 33 },
      { label: "B", weight: 67 },
    ]),
    [3, 7]
  );
});

test("one criterion carries the whole question", () => {
  assert.deepEqual(rubricAllowances(20, [{ label: "Only", weight: 100 }]), [20]);
});

// ---------------------------------------------------------------------------
// 5. What a set of per-criterion bands adds up to
// ---------------------------------------------------------------------------
const bandsOf = (entries) =>
  entries.map(([label, percent, evidence]) => ({ criterion: label, percent, evidence }));

test("every criterion at full effectiveness earns exactly the question", () => {
  const result = scoreRubric(20, threeCriteria, bandsOf([
    ["Diagnoses the cause", 100],
    ["Feasible here", 100],
    ["Structure", 100],
  ]));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.total, 20);
  assert.equal(result.max, 20);
  assert.deepEqual(result.lines.map((line) => line.marks), [8, 7, 5]);
});

test("nothing shown earns nothing", () => {
  const result = scoreRubric(20, threeCriteria, bandsOf([
    ["Diagnoses the cause", 0],
    ["Feasible here", 0],
    ["Structure", 0],
  ]));
  assert.equal(result.total, 0);
  assert.deepEqual(result.lines.map((line) => line.marks), [0, 0, 0]);
});

test("a band earns its share of its own criterion, rounded once", () => {
  const result = scoreRubric(20, threeCriteria, bandsOf([
    ["Diagnoses the cause", 100, "Points at the competitor's rate card."],
    ["Feasible here", 50, "Staffing is hand-waved."],
    ["Structure", 20],
  ]));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.lines.map((line) => line.marks), [8, 4, 1]);
  assert.deepEqual(result.lines.map((line) => line.allowance), [8, 7, 5]);
  assert.deepEqual(result.lines.map((line) => line.percent), [100, 50, 20]);
  assert.equal(result.total, 13);
  assert.equal(result.lines[0].evidence, "Points at the competitor's rate card.");
  assert.equal(result.lines[1].evidence, "Staffing is hand-waved.");
  assert.equal(result.lines[2].evidence, null);
});

test("a fractional band is rounded once, not twice", () => {
  const result = scoreRubric(10, [
    { label: "A", weight: 50 },
    { label: "B", weight: 50 },
  ], bandsOf([["A", 87.5], ["B", 12.5]]));
  assert.deepEqual(result.lines.map((line) => line.marks), [4, 1]);
  assert.equal(result.total, 5);
});

test("a criterion is never paid more than it is worth", () => {
  const result = scoreRubric(20, threeCriteria, bandsOf([
    ["Diagnoses the cause", 100],
    ["Feasible here", 100],
    ["Structure", 100],
  ]));
  assert.ok(result.lines.every((line) => line.marks <= line.allowance));
  assert.ok(result.total <= result.max);
});

for (const [label, entries, needle] of [
  [
    "a criterion the model left unscored",
    [
      { criterion: "Diagnoses the cause", percent: 80 },
      { criterion: "Structure", percent: 40 },
    ],
    "Feasible here",
  ],
  [
    "a band above one hundred",
    [
      { criterion: "Diagnoses the cause", percent: 140 },
      { criterion: "Feasible here", percent: 50 },
      { criterion: "Structure", percent: 50 },
    ],
    "0.100",
  ],
  [
    "a negative band",
    [
      { criterion: "Diagnoses the cause", percent: -5 },
      { criterion: "Feasible here", percent: 50 },
      { criterion: "Structure", percent: 50 },
    ],
    "0.100",
  ],
  [
    "a band that is not a number",
    [
      { criterion: "Diagnoses the cause", percent: "high" },
      { criterion: "Feasible here", percent: 50 },
      { criterion: "Structure", percent: 50 },
    ],
    "0.100",
  ],
  [
    "a band naming a criterion the question does not have",
    [
      { criterion: "Diagnoses the cause", percent: 50 },
      { criterion: "Feasible here", percent: 50 },
      { criterion: "Structure", percent: 50 },
      { criterion: "Eye contact", percent: 50 },
    ],
    "Eye contact",
  ],
  [
    "the same criterion scored twice",
    [
      { criterion: "Structure", percent: 50 },
      { criterion: "Structure", percent: 90 },
      { criterion: "Diagnoses the cause", percent: 50 },
      { criterion: "Feasible here", percent: 50 },
    ],
    "twice",
  ],
]) {
  const refused = scoreRubric(20, threeCriteria, entries);
  test(`scoreRubric refuses ${label}`, () => {
    assert.equal(refused.ok, false);
    assert.match(refused.error, new RegExp(needle, "i"));
    assert.equal(refused.total, undefined);
  });
}

test("scoreRubric refuses to mark against a rubric that is not there", () => {
  const refused = scoreRubric(20, [], []);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /criteria/i);
});

// ---------------------------------------------------------------------------
// 6. How the mark is worded for a reviewer
// ---------------------------------------------------------------------------
const middling = scoreRubric(20, threeCriteria, bandsOf([
  ["Diagnoses the cause", 100, "Names the rate card as the driver."],
  ["Feasible here", 50, "Assumes the current rota absorbs it."],
  ["Structure", 20, null],
]));

test("the rationale states the total and each criterion's share", () => {
  const copy = rubricEvaluation(middling, { transcriptOnly: false });
  assert.match(copy.rationale, /13 of 20/);
  assert.match(copy.rationale, /3 criteria/);
  assert.match(copy.rationale, /Diagnoses the cause/);
  assert.match(copy.rationale, /8 of 8/);
  assert.match(copy.rationale, /4 of 7/);
  assert.match(copy.rationale, /1 of 5/);
});

test("a criterion paid in full is a strength that names its evidence", () => {
  const copy = rubricEvaluation(middling, { transcriptOnly: false });
  assert.equal(copy.strengths.length, 1);
  assert.match(copy.strengths[0], /Diagnoses the cause/);
  assert.match(copy.strengths[0], /Names the rate card as the driver/);
});

test("anything short of full is an improvement that names the shortfall", () => {
  const copy = rubricEvaluation(middling, { transcriptOnly: false });
  assert.equal(copy.improvements.length, 2);
  assert.match(copy.improvements.join(" "), /Feasible here/);
  assert.match(copy.improvements.join(" "), /3 marks/);
  assert.match(copy.improvements.join(" "), /Assumes the current rota absorbs it/);
});

test("a recorded pitch says it was scored from the transcript alone", () => {
  const copy = rubricEvaluation(middling, { transcriptOnly: true });
  assert.match(copy.rationale, /transcript/i);
  assert.match(copy.rationale, /presence|delivery/i);
});

test("a written case study is not described as a transcript", () => {
  const copy = rubricEvaluation(middling, { transcriptOnly: false });
  assert.doesNotMatch(copy.rationale, /transcript/i);
});

test("a perfect paper leaves nothing to improve", () => {
  const perfect = scoreRubric(20, threeCriteria, bandsOf([
    ["Diagnoses the cause", 100, "Direct."],
    ["Feasible here", 100, "Costed."],
    ["Structure", 100, "Clear."],
  ]));
  const copy = rubricEvaluation(perfect, { transcriptOnly: false });
  assert.equal(copy.strengths.length, 3);
  assert.deepEqual(copy.improvements, []);
});

test("an empty paper names every criterion as short", () => {
  const empty = scoreRubric(20, threeCriteria, bandsOf([
    ["Diagnoses the cause", 0],
    ["Feasible here", 0],
    ["Structure", 0],
  ]));
  const copy = rubricEvaluation(empty, { transcriptOnly: false });
  assert.deepEqual(copy.strengths, []);
  assert.equal(copy.improvements.length, 3);
  assert.match(copy.rationale, /0 of 20/);
});

// ---------------------------------------------------------------------------
// 7. Saving one — the real `saveQuestion` authoring action
//
// Transpiled and run in a fresh context, so the assertions are the row the
// action would write and the sentence it returns, not the shape of its source.
// A refused rubric must refuse *before* the suite is read: the marking scheme is
// not worth a database round trip when it cannot be marked.
// ---------------------------------------------------------------------------
const authoringSource = read("src/app/(admin)/assessments/question-actions.ts");
const authoringCompiled = ts.transpileModule(authoringSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function authoringHarness(options = {}) {
  const reads = [];
  const inserts = [];
  const updates = [];
  const activities = [];
  const revalidated = [];
  const tables = {
    assessment_templates: [{ id: "suite-1", name: "Front office" }],
    assessment_questions: [],
    candidate_responses: [],
    ...options.tables,
  };

  const client = {
    from(table) {
      reads.push(table);
      const query = { table, filters: [] };
      const builder = {
        select(...args) {
          query.select = args;
          return this;
        },
        insert(values) {
          inserts.push({ table, row: values });
          query.inserted = values;
          return this;
        },
        update(values) {
          query.update = values;
          return this;
        },
        delete() {
          query.deleted = true;
          return this;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return this;
        },
        order(column) {
          query.order = column;
          return this;
        },
        limit(value) {
          query.limit = value;
          return this;
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
          try {
            if (query.inserted) {
              return Promise.resolve({ data: { id: "q-new" }, error: null }).then(resolve, reject);
            }
            if (query.update) {
              updates.push({ table, values: query.update, filters: [...query.filters] });
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            }
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
            let found = [...(tables[table] ?? [])];
            for (const [column, value] of query.filters) {
              found = found.filter((row) => row[column] === value);
            }
            if (query.limit !== undefined) found = found.slice(0, query.limit);
            return Promise.resolve({
              data: query.single ? found[0] ?? null : found,
              error: null,
            }).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return builder;
    },
  };

  const exports = {};
  const context = {
    exports,
    require: (name) => {
      if (name === "next/cache") return { revalidatePath: (path) => revalidated.push(path) };
      if (name === "@/lib/data-api/server") return { createServerRestClient: async () => client };
      if (name === "@/lib/auth/session") return { requireStaff: async () => ({ id: "staff-1" }) };
      if (name === "@/modules/settings/infrastructure/permissions") {
        return { hasPermissionForUser: async () => options.allowed ?? true };
      }
      if (name === "@/lib/config.server") return { hasAiProvider: () => false };
      if (name === "@/modules/activity/application/record") {
        return {
          recordActivity: async (entry) => activities.push(entry),
          withActivityContext: async (_context, run) => run(),
        };
      }
      if (name === "@/modules/screening/infrastructure/openRouterEngine") {
        return { generateAssessmentQuestions: async () => ({ parsed: [], model: "fixture/model" }) };
      }
      // The AI-drafting helpers belong to `generateQuestions`, not to saving a
      // question, and the module cannot be loaded here: it imports a sibling by a
      // path the runner's bundler resolves and plain Node does not.
      if (name === "@/modules/assessment/domain/aiAuthoring") {
        return {
          MAX_DRAFTS_PER_RUN: 5,
          DIFFICULTIES: ["EASY", "MID", "HARD"],
          asReviewedDraft: () => {
            throw new Error("aiAuthoring.asReviewedDraft is not part of saving a question");
          },
          draftForRow: () => {
            throw new Error("aiAuthoring.draftForRow is not part of saving a question");
          },
          normaliseOutputs: () => {
            throw new Error("aiAuthoring.normaliseOutputs is not part of saving a question");
          },
          reviewDrafts: () => {
            throw new Error("aiAuthoring.reviewDrafts is not part of saving a question");
          },
        };
      }
      // Pure domain modules run for real, so the sentence an author reads is the
      // sentence the graders and the review desk read.
      if (name === "@/modules/activity/domain/trail") return trail;
      if (name === "@/modules/assessment/domain/situational") return situational;
      if (name === "@/modules/assessment/domain/rubric") return rubricDomain;
      if (name === "@/modules/assessment/domain/skillTags") return skillTags;
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
      throw new Error(`Unmocked boundary: ${name}`);
    },
  };
  new Script(authoringCompiled).runInNewContext(context, { timeout: 5000 });

  return {
    save: (draft) => context.exports.saveQuestion(draft),
    reads,
    inserts,
    updates,
    activities,
    revalidated,
    /** The full row an edit wrote, ignoring the position renumbering. */
    writtenRow: () => updates.find((entry) => "config" in entry.values)?.values,
    /** The row an insert wrote. */
    insertedRow: () => inserts[0]?.row,
  };
}

/** The draft the editor drawer sends, with the marking scheme left unsent. */
const draftOf = (overrides) => ({
  id: null,
  template_id: "suite-1",
  question_type: "CASE_STUDY",
  title: "The quiet season",
  prompt: "Describe how you would respond.",
  instructions: "",
  points: 20,
  position: 0,
  time_limit_minutes: null,
  shuffle_options: false,
  options: [],
  context: "A resort is 30% below occupancy after a competitor opens.",
  min_words: 150,
  min_duration_seconds: null,
  max_duration_seconds: null,
  preserve_config: null,
  ...overrides,
});

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
  // The row is built inside the VM, so its prototype is the VM's; serialising
  // compares the stored values across the two realms.
  assert.deepEqual(JSON.parse(JSON.stringify(h.insertedRow().config)), {
    language: "Python",
    starter_code: "def flatten(x):",
  });
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

/** An edit of a case study that already carries a rubric. */
const storedCase = (overrides) => ({
  id: "q-1",
  template_id: "suite-1",
  question_type: "CASE_STUDY",
  title: "The quiet season",
  prompt: "Describe how you would respond.",
  instructions: null,
  config: { context: "A resort is 30% below occupancy.", min_words: 150, rubric: CASE_RUBRIC },
  points: 20,
  position: 0,
  time_limit_minutes: null,
  shuffle_options: false,
  ...overrides,
});

const editHarness = (row, overrides) =>
  authoringHarness({ tables: { assessment_questions: [row ?? storedCase()] } });

async function refused(draft, expression, options) {
  const h = authoringHarness(options);
  const result = await h.save(draft);
  assert.equal(result.ok, false, `saved: ${JSON.stringify(result)}`);
  assert.match(result.error, expression);
  assert.equal(h.inserts.length, 0, "a refused rubric still inserted a question");
  assert.equal(h.updates.length, 0, "a refused rubric still updated a question");
  assert.equal(h.reads.length, 0, "a refused rubric still reached the database");
  return result;
}

test("a case study saves the criteria the recruiter wrote", async () => {
  const h = authoringHarness();
  const result = await h.save(
    draftOf({
      rubric: [
        { label: "  Diagnoses the cause ", weight: 60, description: "  Names the driver first. " },
        { label: "Feasible here", weight: 40, description: "   " },
      ],
    })
  );
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(h.insertedRow().config.rubric, [
    { label: "Diagnoses the cause", weight: 60, description: "Names the driver first." },
    { label: "Feasible here", weight: 40 },
  ]);
});

test("a recorded pitch saves its criteria too", async () => {
  const h = authoringHarness();
  const result = await h.save(
    draftOf({
      question_type: "VIDEO_PITCH",
      context: "",
      min_words: null,
      min_duration_seconds: 60,
      max_duration_seconds: 120,
      rubric: [
        { label: "Opens with the guest's problem", weight: 60 },
        { label: "Closes with a specific ask", weight: 40 },
      ],
    })
  );
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(h.insertedRow().config.rubric, [
    { label: "Opens with the guest's problem", weight: 60 },
    { label: "Closes with a specific ask", weight: 40 },
  ]);
});

test("weights that do not add up to 100 are refused with the total quoted", async () => {
  const result = await refused(
    draftOf({ rubric: [{ label: "Diagnosis", weight: 40 }, { label: "Feasibility", weight: 40 }] }),
    /add up to 100.*80/s
  );
  assert.match(result.error, /80/);
});

test("a single criterion is refused: a rubric splits marks between two", async () => {
  await refused(
    draftOf({ rubric: [{ label: "Diagnosis", weight: 100 }] }),
    /at least two criteria/
  );
});

test("a seventh criterion is refused", async () => {
  const seven = Array.from({ length: 7 }, (_unused, index) => ({
    label: `Criterion ${index + 1}`,
    weight: index === 0 ? 46 : 9,
  }));
  await refused(draftOf({ rubric: seven }), /at most 6 criteria/);
});

test("a criterion with no weight is refused by name", async () => {
  await refused(
    draftOf({ rubric: [{ label: "Diagnosis", weight: null }, { label: "Feasibility", weight: 50 }] }),
    /“Diagnosis” needs a whole-number weight/
  );
});

test("two criteria sharing a name are refused", async () => {
  await refused(
    draftOf({ rubric: [{ label: "Structure", weight: 50 }, { label: " structure ", weight: 50 }] }),
    /same name/
  );
});

test("a draft that does not mention the marking scheme leaves it as it was", async () => {
  const h = editHarness();
  const result = await h.save(
    draftOf({ id: "q-1", preserve_config: storedCase().config })
  );
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(h.writtenRow().config.rubric, CASE_RUBRIC);
});

test("an empty marking scheme retires it from the row", async () => {
  const h = editHarness();
  const result = await h.save(
    draftOf({ id: "q-1", rubric: [], preserve_config: storedCase().config })
  );
  assert.equal(result.ok, true, result.error);
  assert.ok(!("rubric" in h.writtenRow().config), JSON.stringify(h.writtenRow().config));
});

test("rows left blank save as no marking scheme, not as a refusal", async () => {
  const h = editHarness();
  const result = await h.save(
    draftOf({
      id: "q-1",
      rubric: [
        { label: "", weight: null, description: "" },
        { label: "   ", weight: undefined },
      ],
      preserve_config: storedCase().config,
    })
  );
  assert.equal(result.ok, true, result.error);
  assert.ok(!("rubric" in h.writtenRow().config), JSON.stringify(h.writtenRow().config));
});

test("retiring a rubric is recorded in the change trail", async () => {
  const h = editHarness();
  await h.save(draftOf({ id: "q-1", rubric: [], preserve_config: storedCase().config }));
  const configEdit = h.activities[0]?.detail?.config;
  assert.ok(configEdit, `no config in the trail: ${JSON.stringify(h.activities[0])}`);
  const [before, after] = configEdit.split(" → ");
  assert.match(before, /rubric: 3 items/);
  assert.ok(!/rubric/.test(after ?? ""), after);
});

test("a question type with no marking scheme cannot keep one", async () => {
  const quiz = authoringHarness();
  const result = await quiz.save(
    draftOf({
      question_type: "MULTIPLE_CHOICE",
      context: "",
      min_words: null,
      options: [
        { text: "Cash", is_correct: false },
        { text: "A bank loan", is_correct: true },
      ],
      preserve_config: { rubric: CASE_RUBRIC },
    })
  );
  assert.equal(result.ok, true, result.error);
  assert.ok(!("rubric" in quiz.insertedRow().config), JSON.stringify(quiz.insertedRow().config));

  const scene = authoringHarness();
  const sceneResult = await scene.save(
    draftOf({
      question_type: "SITUATIONAL_JUDGMENT",
      context: "",
      min_words: null,
      options: [
        { text: "Escalate at once", is_correct: false, score: 20 },
        { text: "Check the rate card first", is_correct: false, score: 100 },
      ],
      preserve_config: { rubric: PITCH_RUBRIC },
    })
  );
  assert.equal(sceneResult.ok, true, sceneResult.error);
  assert.ok(!("rubric" in scene.insertedRow().config), JSON.stringify(scene.insertedRow().config));
});

test("an invalid rubric on an edit is refused without touching the row", async () => {
  await refused(
    draftOf({ id: "q-1", rubric: [{ label: "Diagnosis", weight: 70 }, { label: "Feasibility", weight: 20 }] }),
    /add up to 100/s,
    { tables: { assessment_questions: [storedCase()] } }
  );
});

test("a refused rubric is refused before the permission read is acted on", async () => {
  const h = authoringHarness({ allowed: false });
  const result = await h.save(draftOf({ rubric: [{ label: "Only one", weight: 100 }] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /permission/i);
  assert.equal(h.reads.length, 0);
});

test("an unknown skill tag is refused by the real catalogue check", async () => {
  const h = authoringHarness();
  const result = await h.save(
    draftOf({
      rubric: [
        { label: "Structure", weight: 60, skill_id: "s-gone" },
        { label: "Evidence", weight: 40 },
      ],
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Structure/);
  assert.match(result.error, /does not hold/);
  assert.equal(h.inserts.length, 0, "a rejected tag still inserted a question");
});

test("a preserved rubric still passes the catalogue check", async () => {
  const h = authoringHarness();
  const result = await h.save(
    draftOf({
      preserve_config: {
        rubric: [
          { label: "Structure", weight: 60, skill_id: "s-gone" },
          { label: "Evidence", weight: 40 },
        ],
      },
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Structure/);
  assert.match(result.error, /does not hold/);
  assert.equal(h.inserts.length, 0, "a rejected preserved tag still inserted a question");
});

test("a preserved rubric's stored name is the catalogue's spelling", async () => {
  const h = authoringHarness({
    tables: { skills: [{ id: "s-live", name: "Financial analysis", is_active: true }] },
  });
  const result = await h.save(
    draftOf({
      preserve_config: {
        rubric: [
          {
            label: "Structure",
            weight: 60,
            skill_id: "s-live",
            skill_name: "Forged name",
            description: "kept",
          },
          { label: "Evidence", weight: 40 },
        ],
      },
    })
  );
  assert.equal(result.ok, true, result.error);
  const stored = h.insertedRow().config.rubric;
  assert.equal(stored.length, 2);
  assert.equal(stored[0].skill_id, "s-live");
  assert.equal(stored[0].skill_name, "Financial analysis");
  assert.equal(stored[0].description, "kept");
  assert.equal("skill_id" in stored[1], false);
});

test("an active tag's stored name is the catalogue's spelling on the panel path", async () => {
  const h = authoringHarness({
    tables: { skills: [{ id: "s-live", name: "Financial analysis", is_active: true }] },
  });
  const result = await h.save(
    draftOf({
      rubric: [
        { label: "Structure", weight: 60, skill_id: "s-live" },
        { label: "Evidence", weight: 40 },
      ],
    })
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(h.insertedRow().config.rubric[0].skill_name, "Financial analysis");
});

test("a coding save spreads a preserved config key its form cannot edit", async () => {
  const h = authoringHarness();
  const result = await h.save(
    codeDraftOf({
      preserve_config: {
        language: "Python",
        starter_code: "def flatten(x):",
        hand_edited: { kept: true },
      },
    })
  );
  assert.equal(result.ok, true, result.error);
  const config = JSON.parse(JSON.stringify(h.insertedRow().config));
  assert.equal(config.language, "Python");
  assert.deepEqual(config.hand_edited, { kept: true });
});

test("a coding save re-spells a preserved rubric's skill name like a case study", async () => {
  const h = authoringHarness({
    tables: { skills: [{ id: "s-live", name: "Financial analysis", is_active: true }] },
  });
  const result = await h.save(
    codeDraftOf({
      preserve_config: {
        language: "Python",
        rubric: [
          {
            label: "Structure",
            weight: 60,
            skill_id: "s-live",
            skill_name: "Forged name",
            description: "kept",
          },
          { label: "Evidence", weight: 40 },
        ],
      },
    })
  );
  assert.equal(result.ok, true, result.error);
  const stored = h.insertedRow().config.rubric;
  assert.equal(stored.length, 2);
  assert.equal(stored[0].skill_id, "s-live");
  assert.equal(stored[0].skill_name, "Financial analysis");
  assert.equal(stored[0].description, "kept");
  assert.equal("skill_id" in stored[1], false);
  assert.equal(h.insertedRow().config.language, "Python");
});

// ---------------------------------------------------------------------------
// 8. Marking an answer with one — the real grading engine
//
// The grading engine imports `server-only` and writes through REST, so the
// standing convention was to assert on its text. Text cannot prove the two
// things a rubric changes: the marks a candidate is awarded are the ones the
// criteria add up to (not a percentage the model proposed), and the criteria in
// force travel with the response, so editing them tomorrow cannot reinterpret a
// mark already given. So this harness runs the real module with every boundary
// stubbed, and asserts on the row it writes.
// ---------------------------------------------------------------------------
const gradingCompiled = ts.transpileModule(
  read("src/modules/assessment/application/gradeAttempt.ts"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

function gradingHarness(options = {}) {
  const updates = [];
  const activities = [];
  const calls = { case: [], pitch: [], excel: [], rubric: [], code: [] };
  const counters = { downloads: 0, followUps: 0 };
  const tables = {
    candidate_attempts: [
      {
        id: "att-1",
        status: "SUBMITTED",
        applications: [{ full_name: "Nadia Salem", job_openings: { title: "Front office manager" } }],
      },
    ],
    assessment_questions: [],
    candidate_responses: [],
    ...options.tables,
  };

  const client = {
    from(table) {
      const query = { table, filters: [] };
      const builder = {
        select() {
          return this;
        },
        eq(column, value) {
          query.filters.push((row) => row[column] === value);
          return this;
        },
        is(column, value) {
          query.filters.push((row) => row[column] === value);
          return this;
        },
        in(column, values) {
          query.filters.push((row) => values.includes(row[column]));
          return this;
        },
        limit(value) {
          query.limit = value;
          return this;
        },
        update(values) {
          query.values = values;
          return this;
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
          try {
            const matched = (tables[table] ?? []).filter((row) =>
              query.filters.every((keep) => keep(row))
            );
            if (query.values) {
              for (const row of matched) Object.assign(row, query.values);
              updates.push({ table, values: query.values, ids: matched.map((row) => row.id) });
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            }
            const found = query.limit === undefined ? matched : matched.slice(0, query.limit);
            return Promise.resolve({
              data: query.single ? found[0] ?? null : found,
              error: null,
            }).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return builder;
    },
  };

  const exports = {};
  const context = {
    exports,
    require: (name) => {
      if (name === "server-only") return {};
      if (name === "@/lib/data-api/service") return { getServiceRestClient: () => client };
      if (name === "@/lib/config") {
        return { storageConfig: { buckets: { candidateVideos: "candidate-videos" } } };
      }
      if (name === "@/lib/config.server") return { hasAiProvider: () => options.aiProvider ?? true };
      if (name === "@/lib/files/store") {
        return {
          getFileStore: async () => ({
            download: async () => {
              counters.downloads += 1;
              return { bytes: new Uint8Array([1, 2, 3]), contentType: "video/webm", error: null };
            },
          }),
        };
      }
      if (name === "@/modules/screening/application/screen-application") {
        return { getAiAutomationSettings: async () => ({ aiEnabled: options.aiEnabled ?? true }) };
      }
      if (name === "@/modules/assessment/application/routeFollowUp") {
        return {
          routeFollowUp: async () => {
            counters.followUps += 1;
          },
        };
      }
      if (name === "@/modules/activity/application/record") {
        return {
          engineActivityActor: async () => ({
            actorKind: "AI",
            actorLabel: "AI grading engine",
            actorId: null,
            companyId: null,
            via: "request",
          }),
          recordActivity: async (entry) => activities.push(entry),
          withActivityContext: async (_ctx, run) => run(),
        };
      }
      if (name === "@/modules/screening/infrastructure/aiGateway") {
        return {
          RecordingNotTranscribableError: class HarnessRecordingError extends Error {},
          TruncatedJsonResponseError: class HarnessTruncation extends Error {},
          transcribeRecording: async () => options.transcript ?? "",
        };
      }
      if (name === "@/modules/screening/infrastructure/openRouterEngine") {
        return {
          evaluateCaseStudy: async (...args) => {
            calls.case.push(args);
            return {
              score: 70,
              rationale: "Legacy verdict.",
              strengths: ["Named a driver"],
              improvements: ["Costed nothing"],
            };
          },
          evaluateVideoPitch: async (...args) => {
            calls.pitch.push(args);
            return {
              score: 70,
              rationale: "Legacy pitch verdict.",
              strengths: ["Opened warmly"],
              improvements: ["Made no ask"],
            };
          },
          evaluateExcelModel: async (...args) => {
            calls.excel.push(args);
            return { score: 60, breakdown: [] };
          },
          evaluateCodeSubmission: async (...args) => {
            calls.code.push(args);
            return {
              score: 60,
              rationale: "Legacy code verdict.",
              strengths: ["Handled the empty list"],
              improvements: ["Did not name the recursion depth"],
            };
          },
          gradeAgainstRubric: async (...args) => {
            calls.rubric.push(args);
            if (!options.bands) {
              throw new Error("the harness was given no rubric bands to return");
            }
            return options.bands;
          },
        };
      }
      // The arithmetic and the selection rules are pure, so they run for real.
      if (name === "@/modules/assessment/domain/attemptTotals") return attemptTotals;
      if (name === "@/modules/assessment/domain/sweepSelection") return sweepSelection;
      if (name === "@/modules/assessment/domain/rubric") return rubricDomain;
      if (name === "@/modules/assessment/domain/coding") return codingDomain;
      throw new Error(`Unmocked boundary: ${name}`);
    },
  };
  new Script(gradingCompiled).runInNewContext(context, { timeout: 5000 });

  return {
    run: () => context.exports.gradeAttemptResponses("att-1", { passes: 1 }),
    updates,
    activities,
    calls,
    counters,
    /** What was written to a response row that carries a verdict. */
    written: (id) =>
      updates.find((entry) => entry.ids.includes(id) && "ai_evaluation" in entry.values)?.values,
  };
}

const rubricCase = (overrides) => ({
  id: "q-case",
  question_type: "CASE_STUDY",
  title: "The quiet season",
  prompt: "Describe how you would respond.",
  points: 20,
  config: { context: "A resort is 30% below occupancy.", min_words: 150, rubric: CASE_RUBRIC },
  ...overrides,
});

const answerRow = (overrides) => ({
  id: "r-1",
  attempt_id: "att-1",
  question_id: "q-case",
  answer_text: "We should reprice the shoulder weeks and hold the rack rate.",
  spreadsheet_state: null,
  video_path: null,
  transcript: null,
  score: null,
  max_score: 20,
  ai_evaluation: null,
  ...overrides,
});

const rubricPitch = (overrides) => ({
  id: "q-pitch",
  question_type: "VIDEO_PITCH",
  title: "Sell the sea-view room",
  prompt: "Pitch this room to a walk-in guest.",
  points: 10,
  config: { min_duration_seconds: 60, max_duration_seconds: 120, rubric: PITCH_RUBRIC },
  ...overrides,
});

const pitchRow = (overrides) => ({
  id: "r-2",
  attempt_id: "att-1",
  question_id: "q-pitch",
  answer_text: null,
  spreadsheet_state: null,
  video_path: "att-1/pitch.webm",
  transcript: "Good evening — your boat waits two hours, so the day rate is wasted.",
  score: null,
  max_score: 10,
  ai_evaluation: null,
  ...overrides,
});

const codingQuestion = (overrides) => ({
  id: "q-code",
  question_type: "CODING",
  title: "Flatten a nested list",
  prompt: "Write a function that flattens arbitrary nesting.",
  points: 10,
  config: { language: "Python", starter_code: "def flatten(x):" },
  ...overrides,
});

const codeRow = (overrides) => ({
  id: "r-code",
  attempt_id: "att-1",
  question_id: "q-code",
  answer_text:
    "def flatten(x):\n    return [y for z in x for y in (flatten(z) if isinstance(z, list) else [z])]",
  spreadsheet_state: null,
  video_path: null,
  transcript: null,
  score: null,
  max_score: 10,
  ai_evaluation: null,
  ...overrides,
});

const middlingBands = () =>
  bandsOf([
    ["Diagnoses the cause, not the symptom", 100, "Names the competitor's opening as the driver."],
    ["Feasible in this resort", 50, "Assumes the current rota absorbs it."],
    ["Structure", 0],
  ]);

/**
 * Compares a value the harness's context produced with one this file made.
 *
 * Objects built inside the VM carry that context's prototypes, which
 * `deepStrictEqual` reads as a difference — so the comparison is made on the
 * JSON the database would hold, which is what the assertion is about anyway.
 */
const jsonEqual = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual ?? null)), expected, message);

const gradedCase = (options = {}) =>
  gradingHarness({
    tables: { assessment_questions: [rubricCase()], candidate_responses: [answerRow()] },
    bands: middlingBands(),
    ...options,
  });

test("a case study with a rubric is marked on the question's own criteria", async () => {
  const h = gradedCase();
  const result = await h.run();
  jsonEqual(result, { graded: 1, failed: 0 });

  assert.equal(h.calls.rubric.length, 1, "the rubric path never ran");
  assert.equal(h.calls.case.length, 0, "a rubric'd case was graded by the generic prompt");
  const [brief, material, criteria, callOptions] = h.calls.rubric[0];
  assert.match(brief, /The quiet season/);
  assert.match(material, /reprice the shoulder weeks/);
  assert.deepEqual(criteria, CASE_RUBRIC);
  assert.equal(callOptions.context, "A resort is 30% below occupancy.");
});

test("the marks awarded are the ones the criteria add up to", async () => {
  const h = gradedCase();
  await h.run();
  const values = h.written("r-1");
  assert.equal(values.score, 12, JSON.stringify(values.ai_evaluation));
  assert.equal(values.ai_evaluation.score, 12);
  assert.match(values.ai_evaluation.rationale, /12 of 20/);
});

test("the criteria that produced a mark travel with the mark", async () => {
  const h = gradedCase();
  await h.run();
  const lines = h.written("r-1").ai_evaluation.criteria;
  assert.deepEqual(
    lines.map((line) => [line.label, line.weight, line.allowance, line.percent, line.marks]),
    [
      ["Diagnoses the cause, not the symptom", 40, 8, 100, 8],
      ["Feasible in this resort", 35, 7, 50, 4],
      ["Structure", 25, 5, 0, 0],
    ]
  );
  assert.equal(lines[0].evidence, "Names the competitor's opening as the driver.");
  assert.equal(lines[0].description, "Names the occupancy driver before proposing anything.");
  assert.equal(lines[2].evidence, null);
});

test("the trail names the marks the rubric produced rather than a share of them", async () => {
  const h = gradedCase();
  await h.run();
  const graded = h.activities.find((entry) => entry.action === "response_graded");
  assert.ok(graded, `no grading row: ${JSON.stringify(h.activities)}`);
  assert.equal(graded.detail.points_awarded, 12);
  assert.equal(graded.detail.points_possible, 20);
  assert.match(graded.summary, /so 12 awarded/);
});

test("a criterion the model left unscored parks the answer with its name", async () => {
  const h = gradingHarness({
    tables: { assessment_questions: [rubricCase()], candidate_responses: [answerRow()] },
    bands: bandsOf([
      ["Diagnoses the cause, not the symptom", 100],
      ["Feasible in this resort", 50],
    ]),
  });
  const result = await h.run();
  jsonEqual(result, { graded: 0, failed: 0 });

  const values = h.written("r-1");
  assert.ok(values, "the row was left without an explanation");
  assert.ok(!("score" in values), `a rubric that could not be added up awarded marks: ${JSON.stringify(values)}`);
  assert.equal(values.ai_evaluation.score, null);
  assert.equal(values.ai_evaluation.parked, true);
  assert.match(values.ai_evaluation.rationale, /Structure/);
});

test("a band naming a criterion the question never set is refused, not fitted", async () => {
  const h = gradingHarness({
    tables: { assessment_questions: [rubricCase()], candidate_responses: [answerRow()] },
    bands: bandsOf([
      ["Diagnoses the cause, not the symptom", 100],
      ["Structure and flow", 60],
      ["Feasible in this resort", 40],
    ]),
  });
  const result = await h.run();
  jsonEqual(result, { graded: 0, failed: 0 });
  const values = h.written("r-1");
  assert.match(values.ai_evaluation.rationale, /Structure and flow/);
  assert.match(values.ai_evaluation.rationale, /nowhere to go/);
});

test("a band with no percentage in it is refused rather than read as zero", async () => {
  const h = gradingHarness({
    tables: { assessment_questions: [rubricCase()], candidate_responses: [answerRow()] },
    bands: [
      { criterion: "Diagnoses the cause, not the symptom", percent: 100 },
      { criterion: "Feasible in this resort", percent: "high" },
      { criterion: "Structure", percent: 0 },
    ],
  });
  await h.run();
  const values = h.written("r-1");
  assert.equal(values.ai_evaluation.score, null);
  assert.match(values.ai_evaluation.rationale, /Feasible in this resort/);
  assert.match(values.ai_evaluation.rationale, /0–100/);
});

test("a case study with no rubric is graded exactly as before rubrics", async () => {
  const h = gradingHarness({
    tables: {
      assessment_questions: [rubricCase({ config: { context: "A resort is 30% below occupancy.", min_words: 150 } })],
      candidate_responses: [answerRow()],
    },
  });
  const result = await h.run();
  jsonEqual(result, { graded: 1, failed: 0 });
  assert.equal(h.calls.rubric.length, 0, "a paper with no marking scheme was routed to one");
  assert.equal(h.calls.case.length, 1);
  jsonEqual(h.written("r-1").ai_evaluation, {
    score: 14,
    rationale: "Legacy verdict.",
    strengths: ["Named a driver"],
    improvements: ["Costed nothing"],
  });
});

test("a coding answer with a rubric is marked on the question's own criteria", async () => {
  const h = gradingHarness({
    tables: {
      assessment_questions: [
        codingQuestion({
          config: {
            language: "Python",
            context: "The feed nests lists three deep.",
            rubric: CASE_RUBRIC,
          },
        }),
      ],
      candidate_responses: [codeRow()],
    },
    bands: middlingBands(),
  });
  const result = await h.run();
  jsonEqual(result, { graded: 1, failed: 0 });

  assert.equal(h.calls.code.length, 0, "a rubric'd coding answer was graded by the fallback prompt");
  assert.equal(h.calls.rubric.length, 1, "the rubric path never ran");
  const [brief, material, criteria, callOptions] = h.calls.rubric[0];
  assert.match(brief, /Flatten a nested list/);
  assert.match(material, /def flatten/);
  assert.deepEqual(criteria, CASE_RUBRIC);
  assert.equal(callOptions.capability, "case_reasoning");
  assert.equal(callOptions.code, true);
  assert.equal(callOptions.language, "Python");
  assert.equal(callOptions.context, "The feed nests lists three deep.");
  assert.equal(h.written("r-code").score, 6);
});

test("a coding answer with no rubric falls back to the code reader", async () => {
  const h = gradingHarness({
    tables: { assessment_questions: [codingQuestion()], candidate_responses: [codeRow()] },
  });
  const result = await h.run();
  jsonEqual(result, { graded: 1, failed: 0 });

  assert.equal(h.calls.rubric.length, 0, "a paper with no marking scheme was routed to one");
  assert.equal(h.calls.code.length, 1);
  const [brief, language, answer] = h.calls.code[0];
  assert.match(brief, /Flatten a nested list/);
  assert.equal(language, "Python");
  assert.match(answer, /def flatten/);
  const values = h.written("r-code");
  assert.equal(values.score, 6);
  assert.equal(values.ai_evaluation.rationale, "Legacy code verdict.");
});

test("the fallback code reader is given the question's own context", async () => {
  const h = gradingHarness({
    tables: {
      assessment_questions: [
        codingQuestion({
          config: { language: "Python", context: "The feed nests lists three deep." },
        }),
      ],
      candidate_responses: [codeRow()],
    },
  });
  await h.run();
  assert.equal(h.calls.code.length, 1);
  const [, , , context] = h.calls.code[0];
  assert.equal(context, "The feed nests lists three deep.");
});

test("a blank code answer is left unscored, the way a blank case study is", async () => {
  for (const blank of ["", "  \n\t "]) {
    const h = gradingHarness({
      tables: {
        assessment_questions: [codingQuestion()],
        candidate_responses: [codeRow({ answer_text: blank })],
      },
    });
    const result = await h.run();
    jsonEqual(result, { graded: 0, failed: 0 });
    assert.equal(h.calls.code.length, 0, `a blank code answer (${JSON.stringify(blank)}) was sent to a model`);
    assert.equal(
      h.calls.rubric.length,
      0,
      `a blank code answer (${JSON.stringify(blank)}) was marked against a scheme`
    );
    assert.equal(
      h.written("r-code"),
      undefined,
      `a blank code answer (${JSON.stringify(blank)}) was given a mark`
    );
  }

  const study = gradingHarness({
    tables: {
      assessment_questions: [rubricCase()],
      candidate_responses: [answerRow({ answer_text: "" })],
    },
  });
  jsonEqual(await study.run(), { graded: 0, failed: 0 });
  assert.equal(study.written("r-1"), undefined, "a blank case study was given a mark");
});

test("a rubric'd pitch is scored from the transcript and says what it could not see", async () => {
  const h = gradingHarness({
    tables: { assessment_questions: [rubricPitch()], candidate_responses: [pitchRow()] },
    bands: bandsOf([
      ["Opens with the guest's problem", 100, "Names the wasted day rate."],
      ["Closes with a specific ask", 50, "Suggests the room without pricing it."],
    ]),
  });
  const result = await h.run();
  jsonEqual(result, { graded: 1, failed: 0 });
  assert.equal(h.calls.pitch.length, 0, "a rubric'd pitch was graded by the generic prompt");

  const [, material, criteria, callOptions] = h.calls.rubric[0];
  assert.match(material, /your boat waits two hours/);
  assert.deepEqual(criteria, PITCH_RUBRIC);
  assert.equal(callOptions.transcriptOnly, true);
  assert.equal(callOptions.capability, "soft_skills");
  jsonEqual(callOptions.limits, { minDurationSeconds: 60, maxDurationSeconds: 120 });

  const values = h.written("r-2");
  assert.equal(values.score, 8);
  assert.match(values.ai_evaluation.rationale, /transcript/i);
  assert.match(values.ai_evaluation.rationale, /presence|delivery/i);
});

test("a pitch with no rubric still gets its duration limits and its legacy verdict", async () => {
  const h = gradingHarness({
    tables: {
      assessment_questions: [
        rubricPitch({ config: { min_duration_seconds: 60, max_duration_seconds: 120 } }),
      ],
      candidate_responses: [pitchRow()],
    },
  });
  const result = await h.run();
  jsonEqual(result, { graded: 1, failed: 0 });
  assert.equal(h.calls.rubric.length, 0);
  jsonEqual(h.calls.pitch[0][2], { minDurationSeconds: 60, maxDurationSeconds: 120 });
  jsonEqual(h.written("r-2").ai_evaluation, {
    score: 7,
    rationale: "Legacy pitch verdict.",
    strengths: ["Opened warmly"],
    improvements: ["Made no ask"],
  });
});

test("an Excel model is untouched by the rubric path", async () => {
  const h = gradingHarness({
    tables: {
      assessment_questions: [
        {
          id: "q-excel",
          question_type: "EXCEL_MODEL",
          title: "Room revenue model",
          prompt: "Fill the model.",
          points: 15,
          config: { expected_outputs: [{ cell: "C4", description: "Total revenue" }], rubric: CASE_RUBRIC },
        },
      ],
      candidate_responses: [
        answerRow({
          id: "r-3",
          question_id: "q-excel",
          answer_text: null,
          spreadsheet_state: { C4: { value: 100 } },
          max_score: 15,
        }),
      ],
    },
  });
  const result = await h.run();
  jsonEqual(result, { graded: 1, failed: 0 });
  assert.equal(h.calls.rubric.length, 0, "a spreadsheet model was marked against written criteria");
  assert.equal(h.calls.excel.length, 1);
});

// ---------------------------------------------------------------------------
// 9. Asking for the bands — the real screening engine's prompt
//
// The model is asked for one judgement per criterion and no total: a total it
// proposes would disagree with the arithmetic in `scoreRubric`, and the
// arithmetic is what a candidate can be shown. These run the real module with
// the gateway stubbed, so the assertions are the words a model would read.
// ---------------------------------------------------------------------------
const screeningCompiled = ts.transpileModule(
  read("src/modules/screening/infrastructure/openRouterEngine.ts"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

/**
 * The skills domain, loaded from source rather than stubbed.
 *
 * The same engine that asks for the rubric bands asks what a CV demonstrated,
 * and the module that decides which catalogue names may be recorded is that
 * domain's own rule. Stubbing it would test the stub; it imports nothing, so it
 * loads with no boundaries at all.
 */
const skillsDomain = (() => {
  const output = ts.transpileModule(read("src/modules/jobs/domain/openingSkills.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = {};
  new Script(output).runInNewContext(
    { exports: loaded, require: (name) => { throw new Error(`the skills domain should not require ${name}`); } },
    { timeout: 5000 }
  );
  return loaded;
})();

function engineHarness(response = { bands: [] }) {
  const requests = [];
  const exports = {};
  const context = {
    exports,
    require: (name) => {
      if (name === "@/modules/jobs/domain/openingSkills") return skillsDomain;
      if (name === "@/modules/assessment/domain/coding") return codingDomain;
      if (name === "@/modules/screening/infrastructure/aiGateway") {
        return {
          complete: async (request) => {
            requests.push(request);
            return { content: JSON.stringify(response), model: "fixture/model", truncated: false };
          },
          parseJsonResponse: (content) => JSON.parse(content),
        };
      }
      if (name === "@/modules/assessment/domain/aiAuthoring") {
        return {
          DIFFICULTY_LABELS: {},
          GENERATED_JSON_SHAPE: {},
          SUITE_JSON_SHAPE: {},
          QUESTION_RULES: "rules",
          SUITE_RULES: "rules",
          kindsWord: () => "",
          openingSeedWords: () => [],
        };
      }
      throw new Error(`Unmocked boundary: ${name}`);
    },
  };
  new Script(screeningCompiled).runInNewContext(context, { timeout: 5000 });

  return {
    requests,
    ask: async (options = {}) => {
      const { material, ...callOptions } = options;
      return context.exports.gradeAgainstRubric(
        "The quiet season\n\nDescribe how you would respond.",
        material ?? "We should reprice the shoulder weeks.",
        options.criteria ?? CASE_RUBRIC,
        { capability: "case_reasoning", ...callOptions }
      );
    },
    /**
     * The fallback code evaluator, called the way the grader calls it.
     *
     * The real function runs with the gateway stubbed, so what the assertions
     * read is the request a model would have received — the fence, the label,
     * the language, the caveat, and the question's own context.
     */
    code: async (options = {}) => {
      const { answer, ...rest } = options;
      return context.exports.evaluateCodeSubmission(
        rest.brief ?? "Flatten a nested list\n\nWrite a function that flattens arbitrary nesting.",
        rest.language === undefined ? "Python" : rest.language,
        answer ?? "def flatten(x):\n    return x",
        rest.context ?? ""
      );
    },
    /** Everything the model is told, in one string. */
    words: (index = 0) => requests[index].messages.map((m) => m.content).join("\n"),
  };
}

/** The engine harness with a response shaped like a code verdict. */
const codeHarness = (
  response = { score: 70, rationale: "Read as written.", strengths: [], improvements: [] }
) => engineHarness(response);

test("the band request names every criterion and the share it carries", async () => {
  const h = engineHarness();
  await h.ask();
  const words = h.words();
  for (const criterion of CASE_RUBRIC) {
    assert.ok(words.includes(criterion.label), `the prompt never named “${criterion.label}”`);
    assert.ok(words.includes(`%`), "the prompt asked for shares without saying they are percentages");
  }
  assert.match(words, /“Feasible in this resort” — 35%/);
  assert.match(words, /Names the occupancy driver before proposing anything/);
});

test("the band request asks for a percentage and a quote per criterion", async () => {
  const h = engineHarness();
  await h.ask();
  const words = h.words();
  assert.match(words, /0-100/);
  assert.match(words, /evidence/i);
  assert.match(words, /["“]criterion["”]\s*:/);
  assert.equal(h.requests[0].jsonMode, true);
});

test("no total is asked for, because the marks are added up in code", async () => {
  const h = engineHarness();
  await h.ask();
  const words = h.words();
  assert.ok(!words.includes('"score"'), `the prompt asked the model for a score: ${words}`);
  assert.doesNotMatch(words, /score 0-100/i);
});

test("the model is told to use each criterion's name as written", async () => {
  const h = engineHarness();
  await h.ask();
  assert.match(h.words(), /exactly as written|name them exactly|verbatim/i);
});

test("the capability is the one the caller asked for", async () => {
  const h = engineHarness();
  await h.ask({ capability: "soft_skills", transcriptOnly: true });
  assert.equal(h.requests[0].capability, "soft_skills");
});

test("a transcript-only brief says the recording itself is not being judged", async () => {
  const h = engineHarness();
  await h.ask({ capability: "soft_skills", transcriptOnly: true });
  assert.match(h.words(), /transcript/i);
  assert.match(h.words(), /presence|dress|delivery|camera/i);
});

test("a written answer is not described as a transcript", async () => {
  const h = engineHarness();
  await h.ask();
  assert.doesNotMatch(h.words(), /transcript/i);
});

test("the question's scenario and the pitch's time allowance still reach the grader", async () => {
  const withContext = engineHarness();
  await withContext.ask({ context: "A resort is 30% below occupancy." });
  assert.match(withContext.words(), /A resort is 30% below occupancy/);

  const pitch = engineHarness();
  await pitch.ask({
    capability: "soft_skills",
    transcriptOnly: true,
    limits: { minDurationSeconds: 60, maxDurationSeconds: 120 },
  });
  assert.match(pitch.words(), /TIME ALLOWED: 60-120 seconds/i);
});

test("every criterion is given room to be answered", async () => {
  const h = engineHarness();
  const six = Array.from({ length: MAX_RUBRIC_CRITERIA }, (_unused, index) => ({
    label: `Criterion ${index + 1}`,
    weight: index === 0 ? 51 : 10,
    description: `What criterion ${index + 1} looks for.`,
  }));
  await h.ask({ criteria: six });
  assert.ok(
    h.requests[0].maxTokens >= 200 * six.length,
    `${h.requests[0].maxTokens} tokens for ${six.length} criteria`
  );
});

test("the bands come back as the model wrote them, for the code to add up", async () => {
  const bands = bandsOf([["Diagnoses the cause, not the symptom", 80, "Named the driver."]]);
  const h = engineHarness({ bands });
  const returned = await h.ask();
  assert.deepEqual(returned, bands);
});

test("a code-marking request fences the answer under its language and promises no run", async () => {
  const h = engineHarness();
  await h.ask({
    material: "def flatten(x):\n    return x",
    code: true,
    language: "Python",
  });
  const words = h.words();
  assert.match(words, /```python\n/);
  assert.match(words, /def flatten\(x\):/);
  assert.match(words, /CANDIDATE CODE/);
  assert.match(words, /not been compiled, run or tested/i);
});

test("a written case is not fenced and is not told the answer is code", async () => {
  const h = engineHarness();
  await h.ask();
  const words = h.words();
  assert.doesNotMatch(words, /```/);
  assert.doesNotMatch(words, /compiled|run or tested/i);
  assert.match(words, /CANDIDATE ANSWER/);
});

test("the fallback code prompt fences the answer, names the language and promises no run", async () => {
  const h = codeHarness();
  await h.code({ answer: "def flatten(x):\n    return x", language: "Python" });
  const words = h.words();
  assert.match(words, /```python\n/);
  assert.match(words, /def flatten\(x\):/);
  assert.match(words, /CANDIDATE CODE/);
  assert.match(words, /LANGUAGE:\nPython/);
  assert.match(words, /not been compiled, run or tested/i);
});

test("the fallback code prompt carries the question's own context", async () => {
  const h = codeHarness();
  await h.code({ context: "The feed nests lists three deep." });
  assert.match(h.words(), /CONTEXT:\nThe feed nests lists three deep\./);
});

test("the fallback code prompt has no context block when the question carries none", async () => {
  const h = codeHarness();
  await h.code();
  assert.doesNotMatch(h.words(), /CONTEXT:/);
});

// ---------------------------------------------------------------------------
// 10. Reading the mark back — the review desk
//
// A criterion is only worth something to a reviewer when they can see what it
// earned: "6 of 8 for naming the cause, and here is the sentence that earned it".
// The lines travel with the response, not with the question, so a recruiter who
// rewrites the criteria the next morning cannot reinterpret a mark given
// yesterday — and a paper marked before rubrics existed has no lines to show and
// must not read as broken.
//
// These run the real reader against the real query builder with a stub database
// behind it. The files are loaded in this realm, not a VM, so the objects
// compared below are the ones the drawer would render.
// ---------------------------------------------------------------------------
const nodeRequire = createRequire(import.meta.url);

/**
 * Runs a real source file in this realm.
 *
 * `bindings` answer a module's outside calls. A pure domain module is loaded for
 * real, because its rules are the thing under test; anything else from `@/` is a
 * Proxy that throws with its name, so a product boundary cannot be quietly
 * stubbed into agreeing.
 */
function loadModule(filename, bindings, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const loaded = { exports: {} };
  cache.set(filename, loaded.exports);
  function localRequire(name) {
    if (name in bindings) return bindings[name];
    const pure =
      /^@\/modules\/[^/]+\/domain\//.test(name) || name === "@/lib/textSearch" || name.startsWith(".");
    if (pure) {
      const base = name.startsWith("@/")
        ? path.join(root, "src", ...name.slice(2).split("/"))
        : path.join(path.dirname(filename), ...name.split("/"));
      // Some modules name their sibling with the extension and some without; a
      // miss here must not read as an empty module, so try both before giving up.
      const target = existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(base) ? base : null;
      if (!target) return {};
      return loadModule(target, bindings, cache);
    }
    if (name.startsWith("@/")) {
      return new Proxy({}, { get() { throw new Error(`Unmocked boundary: ${name}`); } });
    }
    // `server-only` is a bundler guard whose whole body throws when a client
    // module imports it; nothing here claims about a marking scheme.
    if (name === "server-only") return {};
    return nodeRequire(name);
  }
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const deskId = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DESK_JOB = deskId(60);

/** The three lines `scoreRubric` wrote for a 20-mark case study: 15 of 20. */
const AWARDED_CASE = [
  {
    label: "Diagnoses the cause, not the symptom",
    weight: 40,
    allowance: 8,
    percent: 80,
    marks: 6,
    evidence: "Named the occupancy driver before pricing.",
    description: "Names the occupancy driver before proposing anything.",
  },
  { label: "Feasible in this resort", weight: 35, allowance: 7, percent: 100, marks: 7 },
  {
    label: "Structure",
    weight: 25,
    allowance: 5,
    percent: 40,
    marks: 2,
    evidence: "The plan is listed but not ordered.",
  },
];
/** A weak paper on the same criteria: 5 of 20. */
const AWARDED_FEEBLE = [
  {
    label: "Diagnoses the cause, not the symptom",
    weight: 40,
    allowance: 8,
    percent: 20,
    marks: 2,
    evidence: "Jumped straight to a discount.",
    description: "Names the occupancy driver before proposing anything.",
  },
  { label: "Feasible in this resort", weight: 35, allowance: 7, percent: 0, marks: 0 },
  {
    label: "Structure",
    weight: 25,
    allowance: 5,
    percent: 60,
    marks: 3,
    evidence: "Three steps, out of order.",
  },
];

/** What the desk keeps of a stored line: the mark, not the rubric's arithmetic. */
const CASE_LINES = [
  {
    label: "Diagnoses the cause, not the symptom",
    marks: 6,
    allowance: 8,
    percent: 80,
    evidence: "Named the occupancy driver before pricing.",
    description: "Names the occupancy driver before proposing anything.",
    skill_id: null,
    skill_name: null,
  },
  {
    label: "Feasible in this resort",
    marks: 7,
    allowance: 7,
    percent: 100,
    evidence: null,
    description: null,
    skill_id: null,
    skill_name: null,
  },
  {
    label: "Structure",
    marks: 2,
    allowance: 5,
    percent: 40,
    evidence: "The plan is listed but not ordered.",
    description: null,
    skill_id: null,
    skill_name: null,
  },
];
const FEEBLE_LINES = [
  {
    label: "Diagnoses the cause, not the symptom",
    marks: 2,
    allowance: 8,
    percent: 20,
    evidence: "Jumped straight to a discount.",
    description: "Names the occupancy driver before proposing anything.",
    skill_id: null,
    skill_name: null,
  },
  {
    label: "Feasible in this resort",
    marks: 0,
    allowance: 7,
    percent: 0,
    evidence: null,
    description: null,
    skill_id: null,
    skill_name: null,
  },
  {
    label: "Structure",
    marks: 3,
    allowance: 5,
    percent: 60,
    evidence: "Three steps, out of order.",
    description: null,
    skill_id: null,
    skill_name: null,
  },
];
/** A withheld reviewer sees which criteria were graded, and never what they paid. */
const MASKED_CASE_LINES = CASE_LINES.map((line) => ({
  ...line,
  marks: null,
  allowance: null,
  percent: null,
}));

const deskQuestion = (overrides = {}) => ({
  id: "q-case",
  template_id: "suite-1",
  question_type: "CASE_STUDY",
  title: "The quiet season",
  prompt: "Describe how you would respond.",
  instructions: null,
  points: 20,
  position: 0,
  config: { context: "A resort is 30% below occupancy.", min_words: 150, rubric: CASE_RUBRIC },
  ...overrides,
});

const deskResponse = (ai_evaluation = { criteria: AWARDED_CASE }, overrides = {}) => ({
  question_id: "q-case",
  answer_text: "We should reprice the shoulder weeks rather than the peak.",
  spreadsheet_state: null,
  video_path: null,
  video_duration_seconds: null,
  transcript: null,
  score: 15,
  max_score: 20,
  updated_at: "2026-10-23T10:00:00Z",
  ai_evaluation: { score: 15, rationale: "Marked against 3 criteria.", strengths: [], improvements: [], ...ai_evaluation },
  ...overrides,
});

const deskAttempt = (n = 1, overrides = {}) => ({
  id: deskId(n),
  application_id: `app-${n}`,
  template_id: "suite-1",
  status: "GRADED",
  time_limit_minutes: 30,
  started_at: null,
  expires_at: null,
  submitted_at: "2026-10-23T10:00:00Z",
  total_score: 15,
  max_score: 20,
  integrity_flags: 0,
  question_order: ["q-case"],
  option_order: {},
  assessment_templates: { name: "Front office" },
  applications: {
    full_name: `Person ${n}`,
    tracking_code: `SDG-${n}`,
    job_id: DESK_JOB,
    archived_at: null,
    job_openings: { title: "Front office agent" },
  },
  ...overrides,
});

function deskHarness(options = {}) {
  const wire = [];
  const checks = [];
  const attempts = options.attempts ?? [deskAttempt()];
  const questions = options.questions ?? [deskQuestion()];
  const responses = options.responses ?? [deskResponse()];
  const client = createRestClient({
    baseUrl: "http://rubric-desk.invalid/rest/v1",
    token: "synthetic-staff",
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      const params = parsed.searchParams;
      const table = parsed.pathname.split("/").at(-1);
      wire.push({ table, params, method: init.method });
      assert.equal(init.method, "GET", "reading a paper's marks must never write");
      let data;
      if (table === "candidate_attempts") {
        let rows = attempts;
        const only = params.get("id");
        if (only?.startsWith("eq.")) rows = rows.filter((row) => row.id === only.slice(3));
        if (params.get("applications.archived_at") === "is.null") {
          rows = rows.filter((row) => row.applications?.archived_at === null);
        }
        data = params.get("limit") ? rows : rows[0] ?? null;
      } else if (table === "assessment_questions") {
        data = questions;
      } else if (table === "candidate_responses") {
        const at = params.get("attempt_id") ?? "";
        data = options.responsesByAttempt?.[at.slice(3)] ?? responses;
      } else {
        throw new Error(`Unexpected table ${table}`);
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const actions = loadModule(
    path.join(root, "src/app/(admin)/assessments/actions.ts"),
    {
      "@/lib/auth/session": { requireStaff: async (route) => { checks.push(route); } },
      "@/lib/data-api/server": { createServerRestClient: async () => client },
      "@/lib/config": { storageConfig: { buckets: { candidateVideos: "candidate-videos" } } },
      "@/lib/files/store": { getFileStore: async () => ({ signedUrl: async () => ({ url: "/fixture-recording" }) }) },
      "@/modules/settings/application/scoreVisibility": {
        scoresAreMaskedForCurrentUser: async () => options.masked ?? false,
      },
      "@/modules/settings/application/blindMarking": { blindMarkingEnabled: async () => false },
      // A benchmark is a claim about other candidates' marks and is not what these
      // tests are about; the desk's own read is stubbed out of the way.
      "@/modules/assessment/application/attemptBenchmark": { readAttemptBenchmark: async () => null },
      "@/modules/assessment/domain/attemptAnswers": attemptAnswersDomain,
      "@/modules/assessment/domain/comparison": comparisonDomain,
      "@/modules/assessment/domain/situational": situational,
    }
  );
  return {
    read: (id = deskId(1)) => actions.getAttemptAnswers(id),
    compare: (ids = [deskId(1), deskId(2)]) => actions.getAttemptComparison(ids),
    answer: async (id) => (await actions.getAttemptAnswers(id ?? deskId(1))).answers[0],
    wire,
    checks,
  };
}

test("the desk carries the mark each criterion earned", async () => {
  const answer = await deskHarness().answer();
  assert.deepEqual(answer.criteria, CASE_LINES);
});

test("the criteria a paper was marked on outlive the rubric that produced them", async () => {
  const retired = deskQuestion({ config: { context: "A resort is 30% below occupancy.", min_words: 150 } });
  const answer = await deskHarness({ questions: [retired] }).answer();
  assert.deepEqual(answer.criteria, CASE_LINES, "editing the criteria re-marked an old paper");
});

test("a paper marked before rubrics existed carries no criteria", async () => {
  const answer = await deskHarness({
    responses: [deskResponse({ rationale: "Clear structure, weak diagnosis.", strengths: ["Clear"], improvements: [] })],
  }).answer();
  assert.deepEqual(answer.criteria, []);
});

test("a reviewer whose marks are withheld reads the criteria and the quotes, not the points", async () => {
  const answer = await deskHarness({ masked: true }).answer();
  assert.deepEqual(answer.criteria, MASKED_CASE_LINES);
  assert.equal(answer.rationale, "Marked against 3 criteria.");
});

test("a criteria column that is not a list reads as no criteria", async () => {
  const answer = await deskHarness({
    responses: [deskResponse({ criteria: "Diagnoses the cause, not the symptom" })],
  }).answer();
  assert.deepEqual(answer.criteria, []);
});

test("a criterion row with no name has nowhere to put a mark", async () => {
  const answer = await deskHarness({
    responses: [deskResponse({ criteria: [AWARDED_CASE[0], { marks: 3, allowance: 5, percent: 60 }, null] })],
  }).answer();
  assert.deepEqual(answer.criteria, [CASE_LINES[0]]);
});

test("a figure that is not a number is reported absent, never guessed", async () => {
  const answer = await deskHarness({
    responses: [deskResponse({ criteria: [{ ...AWARDED_CASE[0], marks: "6 of 8", allowance: "8", percent: "80%" }] })],
  }).answer();
  assert.deepEqual(answer.criteria, [{ ...CASE_LINES[0], marks: null, allowance: null, percent: null }]);
});

test("the side-by-side comparison carries each paper's own per-criterion marks", async () => {
  const h = deskHarness({
    attempts: [deskAttempt(1), deskAttempt(2)],
    responsesByAttempt: {
      [deskId(2)]: [deskResponse({ criteria: AWARDED_FEEBLE }, { score: 5 })],
    },
  });
  const result = await h.compare();
  assert.equal(result.ok, true);
  assert.deepEqual(result.papers[0].answers[0].criteria, CASE_LINES);
  assert.deepEqual(result.papers[1].answers[0].criteria, FEEBLE_LINES);
});

test("a withheld comparison re-masks the lines, so a stale row cannot leak a mark", () => {
  const paper = {
    attempt_id: deskId(1),
    candidate_name: "Person 1",
    identity_blind: false,
    job_title: "Front office agent",
    template_name: "Front office",
    status: "GRADED",
    scores_masked: true,
    score: 15,
    max_score: 20,
    answers: [{
      question_id: "q-case",
      title: "The quiet season",
      prompt: "Describe how you would respond.",
      question_type: "CASE_STUDY",
      answered: true,
      answer_text: "We should reprice the shoulder weeks.",
      chosen_text: null,
      cells: [],
      video_url: null,
      transcript: null,
      score: 15,
      max_score: 20,
      rationale: "Marked against 3 criteria.",
      strengths: [],
      improvements: [],
      criteria: CASE_LINES,
    }],
  };
  const comparison = comparisonDomain.comparisonPaper(paper);
  assert.equal(comparison.answers[0].score, null);
  assert.deepEqual(comparison.answers[0].criteria, MASKED_CASE_LINES);
});

// ---------------------------------------------------------------------------
// 11. The assistant
//
// A recruiter who authors a suite in the chat has to be able to write the marking
// scheme there, and a read has to show them the one already stored — otherwise
// the chat is a worse editor than the drawer, and a model that edits a question
// without seeing its rubric has no way to know it must send the rows back.
//
// The registry modules are loaded with every product boundary stubbed, so what is
// asserted is the draft that reaches `saveQuestion` and the words a model reads.
// ---------------------------------------------------------------------------
const REGISTRY_QUESTIONS = [
  {
    id: "q-case",
    position: 0,
    type: "CASE_STUDY",
    question_type: "CASE_STUDY",
    title: "The quiet season",
    prompt: "Describe how you would respond.",
    instructions: null,
    points: 20,
    time_limit_minutes: null,
    shuffle_options: false,
    config: { context: "A resort is 30% below occupancy.", min_words: 150, rubric: CASE_RUBRIC },
  },
];

function registryHarness() {
  const saved = [];
  const sources = {
    saveQuestion: async (draft) => {
      saved.push(draft);
      return { ok: true, id: "q-case", message: "Saved the question." };
    },
    getQuestionsForEditor: async () => ({ "suite-1": REGISTRY_QUESTIONS }),
    getTemplateDetail: async () => ({
      id: "suite-1",
      name: "Front office",
      description: "Guest service suite",
      role_family: "Front office",
      time_limit_minutes: 30,
      is_active: true,
    }),
    // Three names the registry reads while its modules load, to spell out the
    // copy of tools these tests never run: `list_files` enumerates the storage
    // buckets in its argument note, and the file and mail tools build their
    // search words. None of those claims lives near a marking scheme.
    BUCKETS: [{ key: "candidate-resumes", label: "CVs" }],
    fileSearchWords: () => "",
    emailSearchWords: () => "",
  };
  const bindings = {
    // Anything else the registry reaches for from the application layer throws
    // with its name, so a fourth boundary that a question write or a suite read
    // depends on cannot be quietly stubbed into agreeing.
    "@/modules/assistant/application/sources": new Proxy(sources, {
      get: (target, key) => {
        if (typeof key === "symbol" || key in target) return target[key];
        throw new Error(`Assistant boundary reached in this proof: sources.${String(key)}`);
      },
    }),
  };
  const directory = path.join(root, "src/modules/assistant/domain/registry");
  const cache = new Map();
  const authoring = loadModule(path.join(directory, "authoring.ts"), bindings, cache);
  const credentials = loadModule(path.join(directory, "credentials.ts"), bindings, cache);
  const tool = (list, name) => {
    const found = list.find((entry) => entry.name === name);
    assert.ok(found, `no ${name} tool in the registry`);
    return found;
  };
  const saveQuestionTool = tool(authoring.authoring, "save_question");
  const suiteTool = tool(credentials.credentials, "get_assessment_suite");
  return {
    saved,
    questionArgs: saveQuestionTool.args,
    questionDescription: saveQuestionTool.description,
    suiteDescription: suiteTool.description,
    saveQuestion: (args) => saveQuestionTool.run({
      template_id: "suite-1",
      question_type: "CASE_STUDY",
      title: "The quiet season",
      prompt: "Describe how you would respond.",
      points: 20,
      ...args,
    }),
    readSuite: () => suiteTool.run({ template_id: "suite-1" }),
  };
}

test("the chat writes a case study's marking scheme", async () => {
  const h = registryHarness();
  const result = await h.saveQuestion({
    rubric: [
      { label: "  Diagnoses the cause  ", weight: "40", description: "  Names the driver first. " },
      { label: "Structure", weight: 60 },
    ],
  });
  assert.equal(result.ok, true);
  const [draft] = h.saved;
  assert.deepEqual(
    draft.rubric.map((row) => [row.label, row.weight]),
    [["Diagnoses the cause", 40], ["Structure", 60]]
  );
  assert.equal(draft.rubric[0].description, "Names the driver first.");
});

test("a chat call that never mentions the scheme leaves the stored one alone", async () => {
  const h = registryHarness();
  await h.saveQuestion({ context: "A resort is 30% below occupancy." });
  assert.equal("rubric" in h.saved[0], false, "an absent argument was sent as an empty rubric");
});

test("an emptied panel retires the rubric", async () => {
  const h = registryHarness();
  await h.saveQuestion({ rubric: [] });
  assert.deepEqual(h.saved[0].rubric, []);
});

test("a marking scheme that is not a list is refused before the question is written", async () => {
  const h = registryHarness();
  await assert.rejects(h.saveQuestion({ rubric: "Diagnoses the cause, not the symptom" }), /rubric/);
  assert.equal(h.saved.length, 0, "a refused rubric still reached the question write");
});

test("the argument copy names the two types, the three fields and the arithmetic", () => {
  const words = registryHarness().questionArgs.rubric;
  assert.match(words, /CASE_STUDY/);
  assert.match(words, /VIDEO_PITCH/);
  assert.match(words, /label/);
  assert.match(words, /weight/);
  assert.match(words, /description/);
  assert.match(words, /100/);
});

test("the tool says the scheme is what an answer is marked against", () => {
  assert.match(registryHarness().questionDescription, /marking scheme|marked against|criteria/i);
});

test("the suite read still returns the stored marking scheme", async () => {
  const h = registryHarness();
  const result = await h.readSuite();
  assert.equal(result.ok, true);
  assert.deepEqual(result.questions[0].config.rubric, CASE_RUBRIC);
});

test("the suite read names the marking scheme among what it returns", () => {
  assert.match(registryHarness().suiteDescription, /marking scheme|criteria|rubric/i);
});

test("the chat passes a criterion's skill id through to the write door", async () => {
  const h = registryHarness();
  const result = await h.saveQuestion({
    rubric: [
      { label: "Diagnoses the cause", weight: 40, skill_id: "s-fin" },
      { label: "Structure", weight: 60 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(h.saved[0].rubric[0].skill_id, "s-fin");
  assert.equal("skill_name" in h.saved[0].rubric[0], false);
});

test("the argument copy names the optional skill tag", () => {
  const words = registryHarness().questionArgs.rubric;
  assert.match(words, /skill_id/);
  assert.match(words, /catalogue/i);
});

test("the Guide says a percentage is not a proficiency level", () => {
  const guide = read("src/modules/shell/domain/pageGuide.ts");
  assert.match(guide, /not a proficiency level|never a 1–5 level/);
  assert.match(guide, /skill tag|tied to a skill|names one skill/i);
  assert.match(guide, /summed, never averaged/);

  const jobsAt = guide.indexOf('"/jobs": {');
  const assessmentsAt = guide.indexOf('"/assessments": {');
  assert.ok(jobsAt >= 0, "no /jobs entry in the Guide");
  assert.ok(assessmentsAt >= 0, "no /assessments entry in the Guide");
  assert.ok(jobsAt < assessmentsAt, "the /jobs entry should come before /assessments");

  const jobsEntry = guide.slice(jobsAt, assessmentsAt);
  const assessmentsEntry = guide.slice(assessmentsAt);
  assert.match(jobsEntry, /An expanded applicant's test-evidence line/);
  assert.match(jobsEntry, /500 most recent graded responses/);
  assert.doesNotMatch(assessmentsEntry, /An expanded applicant's test-evidence line/);
});

// ---------------------------------------------------------------------------
// 12. Carrying a criterion's skill tag
//
// A rubric criterion may point at one row of the skills catalogue. The tag has
// to survive both doors it passes through: the author's draft (where only the
// stored side owns the name, so a browser cannot forge one) and the snapshot
// written beside the mark (where the catalogue's spelling at authoring time is
// what a later rename must not overwrite).
// ---------------------------------------------------------------------------
test("a rubric criterion keeps its skill tag through authoring and the snapshot", () => {
  const read = readRubricDraft([
    {
      label: "Diagnoses the cause",
      weight: 60,
      skill_id: "skill-finance",
      // A browser or a chat model may send a name; the write door owns it.
      skill_name: "Forged name",
    },
    { label: "Protects the guest", weight: 40 },
  ]);
  assert.equal(read.ok, true);
  assert.equal(read.criteria[0].skill_id, "skill-finance");
  assert.equal("skill_name" in read.criteria[0], false);

  const scored = scoreRubric(20, read.criteria, [
    { criterion: "Diagnoses the cause", percent: 50, evidence: "names occupancy first" },
    { criterion: "Protects the guest", percent: 100 },
  ]);
  assert.equal(scored.ok, true);
  assert.equal(scored.lines[0].skill_id, "skill-finance");
  assert.equal(scored.lines[0].marks, 6);

  const readBack = attemptAnswersDomain.awardedCriteriaOf(
    { criteria: scored.lines },
    false
  );
  assert.equal(readBack[0].skill_id, "skill-finance");
  assert.equal(readBack[0].skill_name, null);
  const withheld = attemptAnswersDomain.awardedCriteriaOf(
    { criteria: scored.lines },
    true
  );
  assert.equal(withheld[0].skill_id, "skill-finance");
  assert.equal(withheld[0].marks, null);
});

test("a stored rubric keeps the catalogue's own spelling of the skill", () => {
  const criteria = rubricCriteriaOf({
    rubric: [
      {
        label: "Models the downside",
        weight: 100,
        skill_id: "skill-finance",
        skill_name: "Financial modelling",
      },
    ],
  });
  assert.equal(criteria[0].skill_id, "skill-finance");
  assert.equal(criteria[0].skill_name, "Financial modelling");
});
