import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as domain from "../src/modules/assessment/domain/testRecommendations.ts";
import * as hireable from "../src/modules/jobs/domain/hireable.ts";
import { createRestClient } from "../src/lib/rest/client.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/app/(admin)/assessments/recommendation-actions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const openingId = "10000000-0000-4000-8000-000000000001";
const input = { openingId, budgetMinutes: 30 };
const opening = { id: openingId, tenant_id: "company-a", title: "Guest relations", status: "PUBLISHED", description: "Respond to guest complaints.", requirements: ["Resolve guest complaints", "Communicate in English"] };
const suite = { id: "suite-a", tenant_id: "company-a", name: "Guest service", description: "Practical service", time_limit_minutes: 20, is_active: true };
const question = { id: "q-a", template_id: "suite-a", title: "Complaint handling", prompt: "Explain how you would resolve a guest complaint and document the outcome.", position: 1 };
const payload = { recommendations: [{ suiteId: suite.id, name: "Spoof", durationMinutes: 1, evidence: [{ requirementId: "r1", questionId: question.id, quote: "resolve a guest complaint", explanation: "The question asks for complaint handling." }] }] };

function harness(options = {}) {
  const queries = [];
  const requests = [];
  const checks = [];
  const tables = { job_openings: [opening], assessment_templates: [suite], assessment_questions: [question], ...options.tables };
  const client = { from(table) {
    const query = { table, operations: [] };
    queries.push(query);
    const builder = {
      select(...args) { query.select = args; return this; },
      eq(column, value) { query.operations.push(["eq", column, value]); return this; },
      in(column, value) { query.operations.push(["in", column, value]); return this; },
      order(column, opts) { query.operations.push(["order", column, opts]); return this; },
      limit(value) { query.limit = value; return this; },
      maybeSingle() { query.single = true; return this; },
      then(resolve, reject) {
        try {
          if (options.throwDb) throw new Error("private database details");
          let rows = [...(tables[table] ?? [])];
          for (const [operation, column, value] of query.operations) {
            if (operation === "eq") rows = rows.filter((row) => row[column] === value);
            if (operation === "in") rows = rows.filter((row) => value.includes(row[column]));
          }
          const count = rows.length;
          rows = rows.slice(0, query.limit ?? rows.length);
          return Promise.resolve({ data: query.single ? rows[0] ?? null : rows, count, error: options.dbError === table ? { message: "private database details" } : null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return builder;
  } };
  const bindings = {
    zod: require("zod"),
    "@/lib/auth/session": { requireStaff: async (path) => { checks.push(path); if (options.unauthenticated) throw new Error("login redirect"); } },
    "@/modules/settings/infrastructure/permissions": { hasPermissionForUser: async (permission) => { checks.push(permission); return options.allowed ?? true; } },
    "@/modules/settings/infrastructure/settingsReader": { getBoolSetting: async (key) => { checks.push(key); return options.enabled ?? true; } },
    "@/lib/data-api/server": { createServerRestClient: async () => options.client ?? client },
    "@/modules/jobs/domain/hireable": hireable,
    "@/modules/assessment/domain/testRecommendations": domain,
    "@/modules/screening/infrastructure/aiGateway": {
      complete: async (request) => { requests.push(request); if (options.providerError) throw new Error("provider credential SECRET"); return { content: options.content ?? JSON.stringify(options.payload ?? payload), model: "fixture/model", truncated: options.truncated ?? false }; },
      parseJsonResponse: JSON.parse,
    },
  };
  const exports = {};
  new Script(compiled).runInNewContext({ exports, require: (name) => { if (!(name in bindings)) throw new Error(`Unmocked boundary: ${name}`); return bindings[name]; } }, { timeout: 5000 });
  return { run: exports.recommendTests, queries, requests, checks };
}

function failed(result, expression) {
  assert.equal(result.ok, false);
  assert.match(result.error, expression);
  assert.doesNotMatch(result.error, /SECRET|private database/);
}

test("staff authentication cannot be bypassed", async () => {
  const h = harness({ unauthenticated: true });
  await assert.rejects(h.run(input), /login redirect/);
  assert.equal(h.queries.length + h.requests.length, 0);
});
test("create-assessments permission is required before any catalogue or AI access", async () => {
  const h = harness({ allowed: false });
  failed(await h.run(input), /permission/i);
  assert.ok(h.checks.includes("/assessments"));
  assert.ok(h.checks.includes("assessments.create"));
  assert.equal(h.queries.length + h.requests.length, 0);
});
for (const invalid of [null, {}, { ...input, openingId: "forged" }, { ...input, budgetMinutes: 4 }, { ...input, budgetMinutes: 481 }, { ...input, budgetMinutes: 10.5 }, { ...input, budgetMinutes: "30" }, { ...input, budgetMinutes: NaN }]) {
  test(`invalid action input is refused: ${JSON.stringify(invalid)}`, async () => {
    const h = harness();
    failed(await h.run(invalid), /opening|budget/i);
    assert.equal(h.queries.length + h.requests.length, 0);
  });
}
test("AI master switch stops generation", async () => {
  const h = harness({ enabled: false });
  failed(await h.run(input), /disabled/i);
  assert.ok(h.checks.includes("ai.enabled"));
  assert.equal(h.requests.length, 0);
});
for (const status of ["CLOSED", "UNKNOWN"]) {
  test(`unhireable opening ${status} is refused`, async () => {
    const h = harness({ tables: { job_openings: [{ ...opening, status }] } });
    failed(await h.run(input), /closed|available|hire/i);
    assert.equal(h.requests.length, 0);
  });
}
test("inaccessible opening cannot be replaced with client metadata", async () => {
  const h = harness({ tables: { job_openings: [] } });
  failed(await h.run({ ...input, title: opening.title, tenant_id: "company-b" }), /opening/i);
  assert.equal(h.requests.length, 0);
});
test("grounded recommendations return trusted durations and explicit requirement gaps", async () => {
  const h = harness();
  const result = await h.run(input);
  assert.equal(result.ok, true);
  assert.equal(result.recommendations[0].name, suite.name);
  assert.equal(result.recommendations[0].durationMinutes, 20);
  assert.deepEqual([...result.selectedIds], [suite.id]);
  assert.equal(result.requirements.length, 2);
  assert.equal(result.model, "fixture/model");
  assert.equal(h.requests[0].capability, "case_reasoning");
  const prompt = JSON.parse(h.requests[0].messages[1].content);
  assert.equal(prompt.suites[0].questions[0].prompt, question.prompt);
  assert.equal(prompt.requirements[0].text, opening.requirements[0]);
  assert.ok(h.queries.every((query) => query.select));
});
test("other companies, paused suites, empty suites and invalid durations never reach the model", async () => {
  const h = harness({ tables: { assessment_templates: [suite, { ...suite, id: "other-company", tenant_id: "company-b" }, { ...suite, id: "paused", is_active: false }, { ...suite, id: "empty" }, { ...suite, id: "invalid", time_limit_minutes: 0 }] } });
  assert.equal((await h.run(input)).ok, true);
  const prompt = JSON.parse(h.requests[0].messages[1].content);
  assert.deepEqual(prompt.suites.map((row) => row.id), [suite.id]);
  const query = h.queries.find((row) => row.table === "assessment_templates");
  assert.ok(query.operations.some(([op, key, value]) => op === "eq" && key === "tenant_id" && value === opening.tenant_id));
  assert.ok(query.operations.some(([op, key, value]) => op === "eq" && key === "is_active" && value === true));
});
test("forged quotes and unknown suite IDs cannot become recommendations", async () => {
  const h = harness({ payload: { recommendations: [{ ...payload.recommendations[0], suiteId: "unread" }, { suiteId: suite.id, evidence: [{ ...payload.recommendations[0].evidence[0], quote: "fabricated evidence here" }] }] } });
  const result = await h.run(input);
  assert.equal(result.ok, true);
  assert.equal(result.recommendations.length, 0);
  assert.ok(result.notes.some((note) => /discard|reject/i.test(note)));
});
test("valid empty recommendations are not a provider failure", async () => {
  const h = harness({ payload: { recommendations: [] } });
  const result = await h.run(input);
  assert.equal(result.ok, true);
  assert.equal(result.recommendations.length, 0);
});
for (const options of [{ providerError: true }, { content: "malformed" }, { payload: {} }, { truncated: true }]) {
  test(`bad provider response is safely refused: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    failed(await h.run(input), /recommend|AI|response/i);
  });
}
for (const table of ["job_openings", "assessment_templates", "assessment_questions"]) {
  test(`failed ${table} read never invokes the provider`, async () => {
    const h = harness({ dbError: table });
    failed(await h.run(input), /read|load/i);
    assert.equal(h.requests.length, 0);
  });
}
test("transport exceptions return safe structured errors", async () => {
  const h = harness({ throwDb: true });
  failed(await h.run(input), /read|load/i);
  assert.equal(h.requests.length, 0);
});
test("missing requirements use a disclosed description excerpt", async () => {
  const h = harness({ tables: { job_openings: [{ ...opening, requirements: [] }] } });
  const result = await h.run(input);
  assert.equal(result.ok, true);
  assert.equal(result.requirements[0].text, opening.description);
  assert.ok(result.notes.some((note) => /description/i.test(note)));
});
test("empty job brief stops the AI call", async () => {
  const h = harness({ tables: { job_openings: [{ ...opening, requirements: [], description: " " }] } });
  failed(await h.run(input), /requirement|description/i);
  assert.equal(h.requests.length, 0);
});
for (const table of ["assessment_templates", "assessment_questions"]) {
  test(`empty ${table} avoids an AI call`, async () => {
    const h = harness({ tables: { [table]: [] } });
    failed(await h.run(input), /suite|question/i);
    assert.equal(h.requests.length, 0);
  });
}
test("bounded reads and excerpts disclose omitted source material", async () => {
  const templates = Array.from({ length: 21 }, (_, i) => ({ ...suite, id: `s${i}` }));
  const questions = Array.from({ length: 121 }, (_, i) => ({ ...question, id: `q${i}`, template_id: `s${i % 20}`, prompt: "x".repeat(900) }));
  const h = harness({ tables: { assessment_templates: templates, assessment_questions: questions, job_openings: [{ ...opening, requirements: Array(21).fill("r".repeat(900)) }] }, payload: { recommendations: [] } });
  const result = await h.run(input);
  assert.equal(result.ok, true);
  const prompt = JSON.parse(h.requests[0].messages[1].content);
  assert.ok(prompt.requirements.length <= 20);
  assert.ok(prompt.requirements.every((r) => r.text.length <= 800));
  assert.ok(prompt.suites.length <= 20);
  assert.ok(prompt.suites.flatMap((s) => s.questions).length <= 120);
  assert.ok(prompt.suites.flatMap((s) => s.questions).every((q) => q.prompt.length <= 600));
  assert.ok(result.notes.some((note) => /21/.test(note) && /20/.test(note)));
  assert.ok(result.notes.some((note) => /120/.test(note)));
  assert.ok(result.notes.some((note) => /excerpt|truncat/i.test(note)));
  assert.ok(h.requests[0].messages[1].content.length < 110000);
});
test("budget never changes trusted catalogue duration", async () => {
  const h = harness();
  const result = await h.run({ ...input, budgetMinutes: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.recommendations[0].durationMinutes, 20);
  assert.equal(result.selectedIds.length, 0);
});
for (const [table, order, limit] of [
  ["assessment_templates", "name.asc,id.asc", "20"],
  ["assessment_questions", "template_id.asc,position.asc,id.asc", "120"],
]) {
  test(`${table} sends one composite order with an ID tie-breaker before limiting the window`, async () => {
    const wire = [];
    const tables = { job_openings: [opening], assessment_templates: [suite], assessment_questions: [question] };
    const client = createRestClient({
      baseUrl: "https://recommendations.invalid/rest/v1",
      token: null,
      fetchImpl: async (url, init) => {
        const parsed = new URL(url);
        wire.push({ url: parsed, method: init.method });
        return new Response(JSON.stringify(tables[parsed.pathname.split("/").at(-1)]), {
          status: 200, headers: { "content-type": "application/json", "content-range": "0-0/1" },
        });
      },
    });
    const h = harness({ client });
    assert.equal((await h.run(input)).ok, true);
    assert.equal(wire.length, 3);
    assert.ok(wire.every((request) => request.method === "GET"));
    const query = wire.find((request) => request.url.pathname.endsWith(`/${table}`)).url.searchParams;
    assert.deepEqual(query.getAll("order"), [order]);
    assert.equal(query.get("limit"), limit);
  });
}
