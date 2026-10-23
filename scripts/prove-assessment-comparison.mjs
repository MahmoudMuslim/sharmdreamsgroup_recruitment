import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createRestClient } from "../src/lib/rest/client.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const question = (n, type = "CASE_STUDY") => ({ id: id(100 + n), title: `Question ${n}`, prompt: `Prompt ${n}`, instructions: null, question_type: type, config: {}, points: 10, position: n });
const questions = [question(1), question(2, "MULTIPLE_CHOICE"), question(3, "EXCEL_MODEL"), question(4, "VIDEO_PITCH"), question(5, "SITUATIONAL_JUDGMENT")];
questions[1].config = { options: [{ label: "OPT_1", text: "Ask the guest", is_correct: true }, { label: "OPT_2", text: "Ignore it", is_correct: false }] };
questions[2].config = { initial_sheet: { data: [["Revenue", 100]] } };
questions[4].config = { options: [{ label: "OPT_1", text: "Investigate", score: 100 }] };
const attempt = (n, overrides = {}) => ({
  id: id(n), application_id: id(20 + n), template_id: id(50), status: "SUBMITTED", time_limit_minutes: 60,
  started_at: null, expires_at: null, submitted_at: "2026-10-23T10:00:00Z", total_score: 0, max_score: 50, integrity_flags: 0,
  question_order: [id(102), id(101), id(103), id(104), id(105)], option_order: {},
  assessment_templates: { name: "Guest service" },
  applications: { full_name: `Person ${n}`, tracking_code: `SDG-${n}`, job_id: id(60), archived_at: null, job_openings: { title: "Guest relations" } },
  ...overrides,
});
const response = (n, overrides = {}) => ({
  question_id: id(100 + n), answer_text: `Written answer ${n}`, spreadsheet_state: null, video_path: null,
  video_duration_seconds: null, transcript: null, score: null, max_score: 10, updated_at: null,
  ai_evaluation: { rationale: "Needs manual review", strengths: ["Clear"], improvements: ["More detail"] }, ...overrides,
});

function loadSource(filename, bindings = {}, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename);
  if (!existsSync(filename)) return {};
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  cache.set(filename, loaded.exports);
  function localRequire(name) {
    if (name in bindings) return bindings[name];
    if (name.startsWith("@/modules/assessment/domain/") || name === "@/lib/textSearch" || name.startsWith(".")) {
      return loadSource(name.startsWith("@/") ? resolve(root, "src", name.slice(2) + ".ts") : resolve(dirname(filename), name + ".ts"), bindings, cache);
    }
    if (name.startsWith("@/")) return new Proxy({}, { get() { throw new Error(`Unexpected boundary: ${name}`); } });
    return require(name);
  }
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
const domain = loadSource(resolve(root, "src/modules/assessment/domain/comparison.ts"));
const selection = (n, overrides = {}) => ({ id: id(n), application_id: id(20 + n), job_id: id(60), template_id: id(50), ...overrides });

// Removing ID-based grouping or accepting a fifth selection must fail these cases.
for (const [name, rows, valid] of [
  ["first selection", [selection(1)], true],
  ["four candidates", [1, 2, 3, 4].map((n) => selection(n)), true],
  ["fifth candidate", [1, 2, 3, 4, 5].map((n) => selection(n)), false],
  ["same title but different job", [selection(1), selection(2, { job_id: id(61) })], false],
  ["different suite", [selection(1), selection(2, { template_id: id(51) })], false],
  ["repeat applicant", [selection(1), selection(2, { application_id: id(21) })], false],
  ["duplicate attempt", [selection(1), selection(1)], false],
  ["missing job", [selection(1, { job_id: null })], false],
]) {
  test(`selection: ${name}`, () => {
    assert.equal(typeof domain.comparisonSelectionIssue, "function", "comparison selection rule exists");
    assert.equal(domain.comparisonSelectionIssue(rows) === null, valid);
  });
}
test("question rows align by ID despite shuffled order and preserve missing cells", () => {
  assert.equal(typeof domain.comparisonRows, "function");
  const a = { question_id: "a", title: "Same title", score: 0 }, b = { question_id: "b", title: "Same title", score: null };
  const rows = domain.comparisonRows([{ answers: [b, a] }, { answers: [a] }]);
  assert.deepEqual(rows.map((row) => [row.question_id, row.cells.map((cell) => cell?.score ?? null)]), [["b", [null, null]], ["a", [0, 0]]]);
  assert.equal(rows[0].cells[1], null);
});
test("score labels distinguish pending, true zero, hidden and missing denominators", () => {
  assert.equal(typeof domain.comparisonScore, "function");
  assert.equal(domain.comparisonScore(null, 10, false), "Pending");
  assert.equal(domain.comparisonScore(0, 10, false), "0 / 10");
  assert.equal(domain.comparisonScore(5, null, false), "5");
  assert.equal(domain.comparisonScore(5, 0, false), "5 / 0");
  assert.equal(domain.comparisonScore(5, 10, true), "Hidden");
});

function harness(options = {}) {
  const wire = [], checks = [];
  const attempts = options.attempts ?? [attempt(1), attempt(2, { status: "GRADED", total_score: 0 })];
  const responses = options.responses ?? [response(1), response(2, { answer_text: "OPT_1", score: 0 }), response(3, { answer_text: null, spreadsheet_state: { A1: { value: "Revenue" }, B1: { value: 200 } } }), response(4, { answer_text: null, video_path: "fixture.webm", transcript: "Recorded explanation" }), response(5, { answer_text: "OPT_1", score: 8 })];
  const client = createRestClient({ baseUrl: "http://comparison.invalid/rest/v1", token: "synthetic-staff", fetchImpl: async (url, init) => {
    const parsed = new URL(url), params = parsed.searchParams, table = parsed.pathname.split("/").at(-1);
    wire.push({ table, params, method: init.method, authorization: init.headers.Authorization });
    assert.equal(init.method, "GET", "comparison must never write");
    if (options.throwDb) throw new Error("PRIVATE backend details");
    if (options.errorTable === table) return new Response(JSON.stringify({ message: "PRIVATE backend details" }), { status: 500 });
    let data;
    if (table === "candidate_attempts") {
      let rows = attempts;
      if (params.get("id")?.startsWith("eq.")) rows = rows.filter((row) => row.id === params.get("id").slice(3));
      if (params.get("applications.archived_at") === "is.null") rows = rows.filter((row) => row.applications?.archived_at === null);
      data = params.get("limit") ? rows : rows[0] ?? null;
    } else if (table === "assessment_questions") data = options.questions ?? questions;
    else if (table === "candidate_responses") data = responses;
    else throw new Error(`Unexpected table ${table}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const bindings = {
    "@/lib/auth/session": { requireStaff: async (path) => { checks.push(path); if (options.denied) throw new Error("staff required"); } },
    "@/lib/data-api/server": { createServerRestClient: async () => client },
    "@/lib/config": { storageConfig: { buckets: { candidateVideos: "candidate-videos" } } },
    "@/lib/files/store": { getFileStore: async () => ({ signedUrl: async () => ({ url: "/fixture-recording" }) }) },
    "@/modules/settings/application/scoreVisibility": { scoresAreMaskedForCurrentUser: async () => options.masked ?? false },
    "@/modules/settings/application/blindMarking": { blindMarkingEnabled: async () => options.blind ?? false },
    "@/modules/assessment/application/attemptBenchmark": { readAttemptBenchmark: async () => { throw new Error("comparison must not read population benchmarks"); } },
  };
  const actions = loadSource(resolve(root, "src/app/(admin)/assessments/actions.ts"), bindings);
  return { run: async (ids = [id(1), id(2)]) => {
    assert.equal(typeof actions.getAttemptComparison, "function", "comparison server action exists");
    return actions.getAttemptComparison(ids);
  }, readLinks: actions.getIssuedLinks, readAnswers: actions.getAttemptAnswers, wire, checks };
}
for (const table of ["candidate_attempts", "assessment_questions", "candidate_responses"]) {
  test(`single-paper reader preserves its existing ${table} error result`, async () => {
    const h = harness({ masked: true, errorTable: table });
    const paper = await h.readAnswers(id(1));
    if (table === "candidate_attempts") assert.equal(paper, null);
    else if (table === "assessment_questions") assert.deepEqual(paper.answers, []);
    else {
      assert.equal(paper.answers.length, 5);
      assert.ok(paper.answers.every((answer) => !answer.answered && answer.score === null));
    }
    assert.deepEqual(h.checks, ["/assessments"]);
  });
}
test("issued links carry job IDs rather than grouping by titles", async () => {
  const h = harness();
  const read = await h.readLinks();
  assert.equal(read.rows[0].job_id, id(60));
  assert.ok(h.wire[0].params.get("select").includes("job_id"));
});
function refused(result) {
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Person|Written answer|SDG-/);
  assert.equal(result.papers, undefined);
}
test("staff refusal precedes all data reads", async () => {
  const h = harness({ denied: true });
  await assert.rejects(h.run(), /staff required/);
  assert.equal(h.wire.length, 0);
});
for (const ids of [null, [], [id(1)], [id(1), id(1)], [id(1), "bad"], [id(1), 42], [1, 2, 3, 4, 5].map(id)]) {
  test(`invalid request refused before data access: ${JSON.stringify(ids)}`, async () => {
    const h = harness(); refused(await h.run(ids)); assert.equal(h.wire.length, 0);
  });
}
for (const [label, second] of [
  ["missing attempt", null],
  ["archived", attempt(2, { applications: { ...attempt(2).applications, archived_at: "2026-10-23" } })],
  ["inaccessible application", attempt(2, { applications: null })],
  ["other job with same title", attempt(2, { applications: { ...attempt(2).applications, job_id: id(61) } })],
  ["other suite", attempt(2, { template_id: id(51) })],
  ["same applicant", attempt(2, { application_id: id(21) })],
]) {
  test(`server refuses ${label} without partial output`, async () => {
    refused(await harness({ attempts: [attempt(1), ...(second ? [second] : [])] }).run());
  });
}
for (const table of ["candidate_attempts", "assessment_questions", "candidate_responses"]) {
  test(`${table} failure cannot look like an empty answer or successful comparison`, async () => {
    refused(await harness({ errorTable: table }).run());
  });
}
test("transport errors return a safe failure", async () => { refused(await harness({ throwDb: true }).run()); });
test("comparison preserves selection order and all answer formats without benchmarks or writes", async () => {
  const h = harness(); const result = await h.run([id(2), id(1)]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.papers.map((paper) => paper.attempt_id), [id(2), id(1)]);
  assert.equal(result.papers[0].score, 0);
  assert.equal(result.papers[1].score, null, "unfinished aggregate must not appear as zero");
  const answers = result.papers[1].answers;
  assert.equal(answers.find((row) => row.question_id === id(101)).score, null);
  assert.equal(answers.find((row) => row.question_id === id(102)).chosen_text, "Ask the guest");
  assert.equal(answers.find((row) => row.question_id === id(102)).score, 0);
  assert.deepEqual(answers.find((row) => row.question_id === id(103)).cells, [{ ref: "B1", value: "200" }]);
  assert.equal(answers.find((row) => row.question_id === id(104)).transcript, "Recorded explanation");
  assert.equal(answers.find((row) => row.question_id === id(105)).chosen_text, "Investigate");
  assert.equal(answers[0].rationale, "Needs manual review");
  assert.ok(h.checks.includes("/assessments"));
  const attemptReads = h.wire.filter((request) => request.table === "candidate_attempts");
  assert.ok(attemptReads.every((request) => request.params.get("select").includes("applications!inner")));
  assert.ok(attemptReads.every((request) => request.params.get("applications.archived_at") === "is.null"));
  assert.ok(h.wire.every((request) => !request.params.get("select").includes("access_token")));
});
test("masking strips marks and keys while blind labels replace names in the serialized result", async () => {
  const result = await harness({ masked: true, blind: true }).run();
  assert.equal(result.ok, true);
  assert.equal(result.papers[0].candidate_name, "Candidate SDG-1");
  assert.equal(result.papers[1].candidate_name, "Person 2");
  assert.doesNotMatch(JSON.stringify(result), /Person 1|is_correct|correct_text|benchmark|awarded_by/);
  for (const paper of result.papers) {
    assert.equal(paper.score, null); assert.equal(paper.max_score, null);
    for (const answer of paper.answers) {
      assert.equal(answer.score, null); assert.equal(answer.max_score, null);
      assert.equal(answer.options, undefined); assert.equal(answer.points, undefined);
      assert.equal(answer.rationale, "Needs manual review");
    }
  }
});
test("unanswered questions remain distinct from ungraded stored answers", async () => {
  const result = await harness({ responses: [response(1)] }).run();
  assert.equal(result.ok, true);
  const answers = result.papers[0].answers;
  assert.equal(answers.find((answer) => answer.question_id === id(101)).answered, true);
  assert.equal(answers.find((answer) => answer.question_id === id(102)).answered, false);
});
