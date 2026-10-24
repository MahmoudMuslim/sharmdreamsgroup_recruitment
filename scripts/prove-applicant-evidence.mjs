/* scripts/prove-applicant-evidence.mjs
 * Run: node --test scripts/prove-applicant-evidence.mjs
 *
 * The bounded evidence read the expanded applicant performs, proved at the
 * action rather than through a stubbed drawer.
 *
 * `scripts/prove-opening-skills-ui.mjs` renders the drawer with
 * `getApplicantSubmission` replaced by a fixture, so it can show the sentence a
 * line produces but not the query that produced the line. This file runs the
 * REAL `src/app/(admin)/jobs/applicant-actions.ts` in a fresh vm context against
 * a REST client that records every request, and asks the five questions the
 * drawer cannot answer:
 *
 * 1. is the evidence one scoped query — this application, graded rows only,
 *    newest first, `limit(501)` so 500 is distinguishable from "more than 500"?
 * 2. does 501 rows map exactly the first 500, and say the figure covers them?
 * 3. does a read at exactly 500 stay silent about a cap?
 * 4. does a failed evidence read leave the CV and screening summary intact,
 *    with a note and `ok: true` rather than a failed submission?
 * 5. does the mask that built the papers come back on the submission, and hide
 *    every figure while keeping the skill name?
 *
 * No database, session, permission table or storage is touched: the modules the
 * action imports are the stubs below, and the roll-up is the real domain module.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

import * as skillEvidenceDomain from "../src/modules/assessment/domain/skillEvidence.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The submission lives in a vm realm, so `assert.deepEqual` refuses its objects
 * as not reference-equal to a literal written here. Round-tripping through JSON
 * compares the data the drawer receives, which is the thing under test.
 */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const compile = (rel) =>
  ts.transpileModule(readFileSync(path.join(root, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

const ACTION_SOURCE = "src/app/(admin)/jobs/applicant-actions.ts";

const applicationRow = {
  id: "app-1",
  cv_file_path: null,
  cv_text: "CV text",
  ai_screening_summary: "Screening",
};

/** One graded response, shaped as the join returns it. */
const response = (marks, allowance, title, questionId) => ({
  question_id: questionId,
  ai_evaluation: {
    criteria: [
      { label: "Diagnosis", marks, allowance, skill_id: "s-fin", skill_name: "Financial modelling" },
    ],
  },
  assessment_questions: { title },
});

/**
 * A REST client that answers from fixtures and remembers what was asked.
 *
 * It records the select list, the filters in order, the limit and whether the
 * query expects one row — enough to prove the read's scope without a database.
 */
function makeClient(queries, state) {
  return {
    from(table) {
      const request = { table, select: null, ops: [], limit: null, single: false };
      queries.push(request);
      const builder = {
        select(columns) { request.select = columns; return this; },
        eq(column, value) { request.ops.push(["eq", column, value]); return this; },
        is(column, value) { request.ops.push(["is", column, value]); return this; },
        not(column, operator, value) { request.ops.push(["not", column, operator, value]); return this; },
        order(column, options) { request.ops.push(["order", column, options]); return this; },
        limit(value) { request.limit = value; return this; },
        maybeSingle() { request.single = true; return this; },
        single() { request.single = true; return this; },
        then(resolve, reject) {
          const run = async () => {
            if (state.errors?.[table]) return { data: null, error: state.errors[table] };
            if (table === "applications") {
              const row = state.application ?? null;
              return { data: request.single ? row : row ? [row] : [], error: null };
            }
            if (table === "candidate_responses") {
              return { data: state.rows ?? [], error: null };
            }
            throw new Error(`Unmocked table in the action: ${table}`);
          };
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

/** Runs the real action over one synthetic database. */
function harness(options = {}) {
  const queries = [];
  const routes = [];
  const state = {
    application: options.application ?? applicationRow,
    rows: options.rows ?? [],
    masked: options.masked ?? false,
    errors: options.errors,
  };
  const client = makeClient(queries, state);
  const rest = { createServerRestClient: async () => client };
  const session = {
    requireStaff: async (route) => { routes.push(route); },
  };
  const visibility = { scoresAreMaskedForCurrentUser: async () => state.masked };
  const cvLinks = {
    cvDisplayName: () => null,
    createCvLinks: async () => ({ cv_url: null, cv_download_url: null }),
  };

  const action = {};
  new Script(compile(ACTION_SOURCE)).runInNewContext(
    { exports: action, require: (name) => {
      if (name === "@/lib/data-api/server") return rest;
      if (name === "@/lib/auth/session") return session;
      if (name === "@/modules/settings/application/scoreVisibility") return visibility;
      if (name === "@/modules/careers/cv-links") return cvLinks;
      if (name === "@/modules/jobs/domain/openingSkills") return {};
      if (name === "@/modules/assessment/domain/skillEvidence") return skillEvidenceDomain;
      throw new Error(`Unmocked boundary in the action: ${name}`);
    } },
    { timeout: 5000 }
  );

  return {
    open: (id = "app-1") => action.getApplicantSubmission(id),
    queries,
    routes,
    state,
  };
}

// ---------------------------------------------------------------------------
// The read itself
// ---------------------------------------------------------------------------

test("the evidence read is one query, scoped to this application and capped at 501", async () => {
  const h = harness();
  await h.open("app-1");

  assert.deepEqual(h.routes, ["/jobs"], "the staff guard runs before any query");
  assert.equal(h.queries.filter((query) => query.table === "candidate_responses").length, 1);

  const read = h.queries.find((query) => query.table === "candidate_responses");
  for (const column of [
    "question_id",
    "ai_evaluation",
    "assessment_questions!inner(title)",
    "candidate_attempts!inner(application_id)",
  ]) {
    assert.ok(read.select.includes(column), `the select names ${column}`);
  }
  assert.ok(
    read.ops.some((op) => plain(op).join("|") === plain(["eq", "candidate_attempts.application_id", "app-1"]).join("|")),
    "the read is scoped to this application's attempts"
  );
  assert.ok(
    read.ops.some((op) => plain(op).join("|") === plain(["not", "ai_evaluation", "is", null]).join("|")),
    "only graded responses are read"
  );
  assert.ok(
    read.ops.some((op) => op[0] === "order" && op[1] === "updated_at" && op[2]?.ascending === false),
    "the read keeps the most recent work, not an arbitrary page"
  );
  assert.equal(read.limit, 501, "501 is how 500 is told from more than 500");
});

test("a capped read maps exactly 500 and says the figure covers them", async () => {
  const rows = Array.from({ length: 500 }, (_, index) =>
    response(1, 2, "Case one", `q-${index}`)
  );
  // The 501st is larger than every other row's marks and must not be summed.
  rows.push(response(99, 100, "Case one", "q-500"));
  const h = harness({ rows });
  const result = await h.open("app-1");

  assert.equal(result.ok, true);
  const submission = plain(result.submission);
  assert.equal(submission.skill_evidence.length, 1);
  const [line] = submission.skill_evidence;
  assert.equal(line.awarded, 500);
  assert.equal(line.allowance, 1000);
  assert.equal(line.percent, 50);
  assert.equal(line.questionCount, 500);
  assert.match(submission.skill_evidence_note, /500 most recent graded responses/);
});

test("a read at exactly 500 carries no cap note", async () => {
  const rows = Array.from({ length: 500 }, (_, index) =>
    response(1, 2, "Case one", `q-${index}`)
  );
  const h = harness({ rows });
  const result = await h.open("app-1");

  assert.equal(result.ok, true);
  const submission = plain(result.submission);
  assert.equal(submission.skill_evidence_note, null);
  assert.equal(submission.skill_evidence.length, 1);
  assert.ok(submission.skill_evidence_coverage, "the coverage sentence is present");
  assert.match(submission.skill_evidence_coverage, /From 500 tagged criteria on 500 questions/);
  // The action read the applicant's whole application, not one paper.
  assert.match(
    submission.skill_evidence_coverage,
    /A percentage is evidence from the graded answers read here, not a proficiency level\.$/
  );
  assert.doesNotMatch(submission.skill_evidence_coverage, /this paper/);
});

// ---------------------------------------------------------------------------
// Failure and masking
// ---------------------------------------------------------------------------

test("a failed evidence read leaves the CV and screening summary intact", async () => {
  const h = harness({ errors: { candidate_responses: { message: "boom" } } });
  const result = await h.open("app-1");

  assert.equal(result.ok, true);
  const submission = plain(result.submission);
  assert.equal(submission.cv_text, "CV text");
  assert.equal(submission.screening_summary, "Screening");
  assert.deepEqual(submission.skill_evidence, []);
  assert.equal(submission.skill_evidence_coverage, null);
  assert.match(submission.skill_evidence_note, /could not be read/);
});

test("the mask that built the papers comes back on the submission", async () => {
  const rows = [
    response(6, 10, "Case one", "q-1"),
    response(8, 10, "Case two", "q-2"),
  ];

  const masked = harness({ rows, masked: true });
  const hidden = plain((await masked.open("app-1")).submission);
  assert.equal(hidden.skill_evidence_masked, true);
  const [hiddenLine] = hidden.skill_evidence;
  assert.equal(hiddenLine.skill_name, "Financial modelling");
  assert.equal(hiddenLine.awarded, null);
  assert.equal(hiddenLine.allowance, null);
  assert.equal(hiddenLine.percent, null);
  assert.equal(hiddenLine.questionCount, 2);

  const unmasked = harness({ rows, masked: false });
  const shown = plain((await unmasked.open("app-1")).submission);
  assert.equal(shown.skill_evidence_masked, false);
  const [shownLine] = shown.skill_evidence;
  assert.equal(shownLine.awarded, 14);
  assert.equal(shownLine.allowance, 20);
  assert.equal(shownLine.percent, 70);
});
