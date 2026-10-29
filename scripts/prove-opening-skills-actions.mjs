/* scripts/prove-opening-skills-actions.mjs
 * Run: node --test scripts/prove-opening-skills-actions.mjs
 *
 * The domain rules (`src/modules/jobs/domain/openingSkills.ts`) say what a
 * requisition's skill list may contain. This file runs the two pieces of
 * production code that actually touch the database —
 * `src/modules/jobs/application/openingSkillsRead.ts` and
 * `src/app/(admin)/jobs/opening-skills-actions.ts` — against a synthetic REST
 * client that records every request, so what is asserted is the bytes a write
 * puts on the wire and the sentence a failure prints, not the shape of the
 * source.
 *
 * `db/migrations/037_opening_skills.sql` is APPLIED on this local database, so the
 * table behind these two files exists here. The absent case is still the single
 * most important thing to prove: on a database where that file has never run, a
 * missing table must cost the skill list and nothing else. So the tests below check
 * the refusal names the file,
 * check that a refusal writes nothing, and check that a failure which is NOT a
 * missing table is not dressed up as one.
 *
 * Both files are transpiled to CommonJS and run in a fresh context whose only
 * outside calls are the stubs below — no database, session, permission table or
 * provider is touched. The domain module is the real one.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

import * as openingSkillsDomain from "../src/modules/jobs/domain/openingSkills.ts";
import * as openingTermsDomain from "../src/modules/jobs/domain/openingTerms.ts";
import {
  OPENING_SKILLS_SCHEMA_NOTE,
  OPENING_SKILLS_WRITE_REFUSAL,
} from "../src/modules/jobs/domain/openingSkills.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The values the action and the read build live in a `vm` context, so their
 * objects carry that realm's `Object.prototype` and `assert.deepEqual` refuses
 * them as not reference-equal to a literal written here. Round-tripping through
 * JSON compares the data the recruiter receives, which is the thing under test.
 */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const compile = (rel) =>
  ts.transpileModule(readFileSync(path.join(root, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

const READ_SOURCE = "src/modules/jobs/application/openingSkillsRead.ts";
const ACTION_SOURCE = "src/app/(admin)/jobs/opening-skills-actions.ts";

const openingId = "10000000-0000-4000-8000-000000000001";
// As the `skills` table holds them: the picker offers the live rows in the
// console's own order, so a fixture without both columns is not a fixture the
// read could have returned.
const excel = { id: "20000000-0000-4000-8000-000000000001", name: "Excel (advanced)", is_active: true, sort_order: 10 };
const budgeting = { id: "20000000-0000-4000-8000-000000000002", name: "Budgeting", is_active: true, sort_order: 20 };
const recruiting = { id: "20000000-0000-4000-8000-000000000003", name: "Recruiting", is_active: true, sort_order: 30 };
// Struck off in the master-data console. It must stay out of what an opening may
// ask for, and stay in what a stored row is called — so it sits in the fixture
// beside the live rows, the way it sits in the table.
const travel = { id: "20000000-0000-4000-8000-000000000004", name: "Travel coordination", is_active: false, sort_order: 40 };

function tables(options) {
  return {
    job_openings: [{ id: openingId, title: "Finance Analyst" }],
    skills: [excel, budgeting, recruiting, travel],
    job_opening_skills: [],
    ...options.tables,
  };
}

/**
 * A REST client that answers from fixtures and remembers what was asked.
 *
 * `errors` injects a failure on a table's reads; `writeError` injects one on its
 * writes, which is how a half-finished save is separated from a save that never
 * started.
 */
function makeClient(remembered, state) {
  const client = {
    from(table) {
      const request = { table, method: "GET", select: null, operations: [], body: null, onConflict: null, limit: null };
      remembered.push(request);
      const builder = {
        select(columns) { request.select = columns; return this; },
        eq(column, value) { request.operations.push(["eq", column, value]); return this; },
        in(column, value) { request.operations.push(["in", column, value]); return this; },
        order(column) { request.operations.push(["order", column]); return this; },
        limit(value) { request.limit = value; return this; },
        maybeSingle() { request.single = true; return this; },
        single() { request.single = true; return this; },
        insert(values) { request.method = "POST"; request.body = values; return this; },
        upsert(values, opts) { request.method = "POST"; request.body = values; request.onConflict = opts?.onConflict ?? null; return this; },
        update(values) { request.method = "PATCH"; request.body = values; return this; },
        delete() { request.method = "DELETE"; return this; },
        then(resolve, reject) {
          const run = async () => {
            const read = request.method === "GET";
            const injected = read ? state.errors?.[table] : state.writeError?.[table];
            if (injected) return { data: null, error: injected };
            let rows = [...(state.tables[table] ?? [])];
            for (const [op, column, value] of request.operations) {
              if (op === "eq") rows = rows.filter((row) => row[column] === value);
              if (op === "in") rows = rows.filter((row) => value.includes(row[column]));
            }
            if (request.limit != null) rows = rows.slice(0, request.limit);
            if (request.method === "DELETE") {
              state.tables[table] = (state.tables[table] ?? []).filter((row) => !rows.includes(row));
            }
            if (request.method === "POST" && table === "job_opening_skills") {
              // Mirrors the wire's `on_conflict=opening_id,skill_id`: a row for
              // the same skill on another opening is not the same row.
              const incoming = Array.isArray(request.body) ? request.body : [request.body];
              const clashes = (row) =>
                incoming.some((next) => next.skill_id === row.skill_id && next.opening_id === row.opening_id);
              state.tables[table] = [
                ...(state.tables[table] ?? []).filter((row) => !clashes(row)),
                ...incoming,
              ];
            }
            return {
              data: request.single ? rows[0] ?? null : rows,
              count: rows.length,
              error: null,
            };
          };
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client;
}

/**
 * Runs the real action and the real read over one synthetic database.
 *
 * Both files are executed in their own context; the action's import of the read
 * module is wired to the read module's own exports, so a save exercises the same
 * reader the openings page uses instead of a paraphrase of it.
 */
function harness(options = {}) {
  const queries = [];
  const trail = [];
  const revalidated = [];
  const checks = [];
  const state = { tables: tables(options), errors: options.errors, writeError: options.writeError };
  const client = options.client ?? makeClient(queries, state);

  const rest = { createServerRestClient: async () => client };
  const session = {
    requireStaff: async (route) => {
      checks.push(route);
      if (options.unauthenticated) throw new Error("login redirect");
    },
  };
  const permissions = {
    hasPermissionForUser: async (key) => {
      checks.push(key);
      return options.allowed ?? true;
    },
  };
  const cache = { revalidatePath: (route) => revalidated.push(route) };
  const activity = { recordActivity: async (entry) => { trail.push(entry); return { ok: true }; } };

  const read = {};
  new Script(compile(READ_SOURCE)).runInNewContext(
    { exports: read, require: (name) => {
      if (name === "server-only") return {};
      if (name === "@/lib/data-api/server") return rest;
      if (name === "@/modules/jobs/domain/hireable") return { GRID_ROW_LIMIT: 200 };
      if (name === "@/modules/jobs/domain/openingSkills") return openingSkillsDomain;
      if (name === "@/modules/jobs/domain/openingTerms") return openingTermsDomain;
      throw new Error(`Unmocked boundary in the read: ${name}`);
    } },
    { timeout: 5000 }
  );

  const action = {};
  new Script(compile(ACTION_SOURCE)).runInNewContext(
    { exports: action, require: (name) => {
      if (name === "next/cache") return cache;
      if (name === "@/lib/data-api/server") return rest;
      if (name === "@/lib/auth/session") return session;
      if (name === "@/modules/settings/infrastructure/permissions") return permissions;
      if (name === "@/modules/activity/application/record") return activity;
      if (name === "@/modules/jobs/domain/openingSkills") return openingSkillsDomain;
      if (name === "@/modules/jobs/domain/openingTerms") return openingTermsDomain;
      if (name === "@/modules/jobs/application/openingSkillsRead") return read;
      throw new Error(`Unmocked boundary in the action: ${name}`);
    } },
    { timeout: 5000 }
  );

  return {
    save: (id, rows) => action.saveOpeningSkills(id, rows),
    catalogue: () => read.getSkillsCatalogue(client),
    required: (ids) => read.getOpeningsRequiredSkills(client, ids),
    queries,
    trail,
    revalidated,
    checks,
    state,
    writes: () => queries.filter((request) => request.method !== "GET"),
  };
}

// ---------------------------------------------------------------------------
// The gates: who may write, and what stops before a query
// ---------------------------------------------------------------------------

test("staff authentication is required before any query", async () => {
  const h = harness({ unauthenticated: true });
  await assert.rejects(h.save(openingId, [{ skill_id: excel.id }]), /login redirect/);
  assert.equal(h.queries.length, 0);
});

test("jobs.manage is required before the catalogue or the skill table is read", async () => {
  const h = harness({ allowed: false });
  const result = await h.save(openingId, [{ skill_id: excel.id }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /permission/i);
  assert.ok(h.checks.includes("/jobs"));
  assert.ok(h.checks.includes("jobs.manage"));
  assert.equal(h.queries.length, 0);
});

test("an opening that is not there is refused before the catalogue is read", async () => {
  const h = harness({ tables: { job_openings: [] } });
  const result = await h.save("00000000-0000-4000-8000-000000000009", [{ skill_id: excel.id }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /opening/i);
  assert.equal(h.queries.length, 1);
  assert.equal(h.writes().length, 0);
});

// ---------------------------------------------------------------------------
// What may reach the database at all
// ---------------------------------------------------------------------------

for (const [name, rows, expression] of [
  ["a skill outside the catalogue", [{ skill_id: "made-up-skill" }], /catalogue/i],
  ["the same skill twice", [{ skill_id: excel.id }, { skill_id: excel.id }], /twice/i],
  ["a level above the scale", [{ skill_id: excel.id, required_level: 7 }], /1 to 5/],
  ["a level as text", [{ skill_id: excel.id, required_level: "4" }], /whole number/],
  ["a thirteenth skill", Array.from({ length: 13 }, (_, i) => ({ skill_id: excel.id, required_level: i + 1 })), /at most 12/],
  ["an invented source", [{ skill_id: excel.id, source: "GUESS" }], /how it was chosen/i],
]) {
  test(`${name} is refused with nothing written`, async () => {
    const h = harness();
    const result = await h.save(openingId, rows);
    assert.equal(result.ok, false);
    assert.match(result.error, expression);
    assert.equal(h.writes().length, 0);
  });
}

test("a saved list is one upsert keyed to this opening, with the column defaults filled in", async () => {
  const h = harness();
  const result = await h.save(openingId, [
    { skill_id: excel.id, required_level: 4 },
    { skill_id: budgeting.id, source: "CATALOGUE_MATCH" },
  ]);

  assert.equal(result.ok, true);
  const post = h.queries.find((request) => request.method === "POST");
  assert.ok(post, "the save must send one write");
  assert.equal(post.table, "job_opening_skills");
  assert.equal(post.onConflict, "opening_id,skill_id");
  assert.deepEqual(plain(post.body), [
    { opening_id: openingId, skill_id: excel.id, required_level: 4, source: "RECRUITER" },
    { opening_id: openingId, skill_id: budgeting.id, required_level: 3, source: "CATALOGUE_MATCH" },
  ]);
  assert.deepEqual(plain(result.skills), [
    { skill_id: excel.id, required_level: 4, source: "RECRUITER" },
    { skill_id: budgeting.id, required_level: 3, source: "CATALOGUE_MATCH" },
  ]);
});

test("a skill deselected since the last save is deleted, and the kept rows are rewritten rather than duplicated", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 2, source: "RECRUITER" },
        { opening_id: openingId, skill_id: recruiting.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  const result = await h.save(openingId, [
    { skill_id: excel.id, required_level: 4 },
    { skill_id: budgeting.id },
  ]);

  assert.equal(result.ok, true);
  const post = h.queries.find((request) => request.method === "POST");
  assert.deepEqual(post.body.map((row) => row.skill_id), [excel.id, budgeting.id]);

  const removed = h.queries.filter((request) => request.method === "DELETE");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].table, "job_opening_skills");
  assert.ok(removed[0].operations.some(([op, column, value]) => op === "in" && column === "skill_id" && value.join() === recruiting.id));
  assert.deepEqual(
    h.state.tables.job_opening_skills.map((row) => row.skill_id).sort(),
    [budgeting.id, excel.id].sort()
  );
});

test("an empty list clears the opening's skills without writing a row", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 3, source: "RECRUITER" },
        { opening_id: openingId, skill_id: budgeting.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  const result = await h.save(openingId, []);

  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.skills), []);
  assert.equal(h.queries.filter((request) => request.method === "POST").length, 0);
  const removed = h.queries.filter((request) => request.method === "DELETE");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].operations.filter(([op]) => op === "in").length, 1);
  assert.equal(h.state.tables.job_opening_skills.length, 0);
  assert.match(h.trail[0].summary, /clear/i);
});

test("saving the list the opening already carries writes nothing and records nothing", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  const result = await h.save(openingId, [{ skill_id: excel.id, required_level: 3 }]);

  assert.equal(result.ok, true);
  assert.equal(h.writes().length, 0);
  assert.equal(h.trail.length, 0);
});

test("another opening's rows are never touched", async () => {
  const other = "30000000-0000-4000-8000-000000000009";
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: other, skill_id: excel.id, required_level: 5, source: "RECRUITER" },
      ],
    },
  });
  const result = await h.save(openingId, [{ skill_id: budgeting.id }]);

  assert.equal(result.ok, true);
  assert.deepEqual(
    h.state.tables.job_opening_skills.map((row) => [row.opening_id, row.skill_id]),
    [[other, excel.id], [openingId, budgeting.id]]
  );
});

// ---------------------------------------------------------------------------
// The unapplied migration, and the failures that are not it
// ---------------------------------------------------------------------------

const missing = { code: "42P01", message: 'relation "job_opening_skills" does not exist' };

for (const [label, error] of [
  ["the table is missing", missing],
  ["PostgREST has not reloaded its schema cache", { code: "PGRST204", message: "Could not find the table 'job_opening_skills' in the schema cache" }],
]) {
  test(`${label}: the write is refused, names 037, and sends nothing`, async () => {
    const h = harness({ errors: { job_opening_skills: error } });
    const result = await h.save(openingId, [{ skill_id: excel.id }]);

    assert.equal(result.ok, false);
    assert.equal(result.error, OPENING_SKILLS_WRITE_REFUSAL);
    assert.match(result.error, /037_opening_skills\.sql/);
    assert.match(result.error, /not applied/);
    assert.equal(h.writes().length, 0);
    assert.equal(h.trail.length, 0);
  });
}

test("a failure that is not a missing table is not reported as an unapplied migration", async () => {
  const h = harness({
    errors: { job_opening_skills: { code: "23505", message: "duplicate key value violates unique constraint" } },
  });
  const result = await h.save(openingId, [{ skill_id: excel.id }]);

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /037|not applied/);
  assert.match(result.error, /read/i);
  assert.equal(h.writes().length, 0);
});

test("a rejected write stops before the delete, so a save cannot half-apply", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: recruiting.id, required_level: 3, source: "RECRUITER" },
      ],
    },
    writeError: {
      job_opening_skills: { code: "23503", message: 'violates foreign key constraint "job_opening_skills_skill_id_fkey"' },
    },
  });
  const result = await h.save(openingId, [{ skill_id: excel.id }]);

  assert.equal(result.ok, false);
  assert.match(result.error, /skill/i);
  assert.doesNotMatch(result.error, /037/);
  assert.equal(h.queries.filter((request) => request.method === "DELETE").length, 0);
  assert.deepEqual(h.state.tables.job_opening_skills.map((row) => row.skill_id), [recruiting.id]);
  assert.equal(h.trail.length, 0);
});

test("the catalogue failing to read is told as a failed read, not an empty skills list", async () => {
  const h = harness({ errors: { skills: { code: "42501", message: "permission denied for table skills" } } });
  const result = await h.save(openingId, [{ skill_id: excel.id }]);

  assert.equal(result.ok, false);
  assert.match(result.error, /read|load/i);
  assert.equal(h.writes().length, 0);
});

// ---------------------------------------------------------------------------
// The trail and the refresh
// ---------------------------------------------------------------------------

test("one trail row names the skills a person wrote, never a uuid", async () => {
  const h = harness();
  await h.save(openingId, [{ skill_id: excel.id, required_level: 4 }, { skill_id: recruiting.id }]);

  assert.equal(h.trail.length, 1);
  const entry = h.trail[0];
  assert.equal(entry.area, "jobs");
  assert.equal(entry.entity, "job opening");
  assert.equal(entry.entityId, openingId);
  assert.match(entry.summary, /Finance Analyst/);
  assert.doesNotMatch(entry.summary, /-0000-4000-/);
  assert.ok(Array.isArray(entry.detail.added));
  assert.ok(entry.detail.added.includes("Excel (advanced)"));
});

test("the openings page is refreshed and the public board is not", async () => {
  const h = harness();
  await h.save(openingId, [{ skill_id: excel.id }]);

  assert.ok(h.revalidated.includes("/jobs"));
  assert.ok(!h.revalidated.includes("/careers"));
});

// ---------------------------------------------------------------------------
// The reads the openings page uses
// ---------------------------------------------------------------------------

test("the catalogue read offers the live rows and keeps the retired ones to name them", async () => {
  const h = harness();
  const read = await h.catalogue();

  assert.equal(read.available, true);
  assert.deepEqual(
    plain(read.skills),
    [excel, budgeting, recruiting].map(({ id, name }) => ({ id, name }))
  );
  // The retired row is absent from what may be added and present in what a
  // stored row is called. An opening that carried a skill before it was struck
  // off would otherwise print a uuid to a recruiter who cannot remove it.
  assert.deepEqual(
    plain(read.all),
    [excel, budgeting, recruiting, travel].map(({ id, name }) => ({ id, name }))
  );

  const query = h.queries.find((request) => request.table === "skills");
  assert.equal(query.method, "GET");
  assert.match(query.select, /is_active/);
  assert.ok(query.operations.some(([op, column]) => op === "order" && column === "sort_order"));
  // Every row comes back and the split is made here: one query, two vocabularies.
  assert.ok(!query.operations.some(([op, column]) => op === "eq" && column === "is_active"));
});

test("a skill the master-data console has struck off cannot be required", async () => {
  const h = harness();
  const result = await h.save(openingId, [{ skill_id: travel.id }]);

  assert.equal(result.ok, false);
  assert.match(result.error, /catalogue/i);
  assert.equal(h.writes().length, 0);
});

test("deselecting a struck-off skill the opening already carries is allowed", async () => {
  // The other half of the last test. The row is on the opening from before the
  // skill was retired, so the picker can only offer it as something to remove —
  // and refusing the save would leave a recruiter unable to clean the row up.
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: travel.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  const result = await h.save(openingId, [{ skill_id: excel.id }]);

  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.skills), [
    { skill_id: excel.id, required_level: 3, source: "RECRUITER" },
  ]);
  assert.deepEqual(
    h.state.tables.job_opening_skills.map((row) => row.skill_id),
    [excel.id]
  );
});

test("no openings means no query, and a read that ran is available", async () => {
  const h = harness();
  const read = await h.required([]);

  assert.equal(read.available, true);
  assert.equal(read.requiredById.size, 0);
  assert.equal(read.note, null);
  assert.equal(h.queries.filter((request) => request.table === "job_opening_skills").length, 0);
});

test("each opening's rows come back grouped, with the ceiling the list can hold", async () => {
  const other = "30000000-0000-4000-8000-000000000009";
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 4, source: "RECRUITER" },
        { opening_id: openingId, skill_id: budgeting.id, required_level: 2, source: "CATALOGUE_MATCH" },
        { opening_id: other, skill_id: recruiting.id, required_level: 5, source: "RECRUITER" },
      ],
    },
  });
  const read = await h.required([openingId, other]);

  assert.equal(read.available, true);
  assert.deepEqual(plain(read.requiredById.get(openingId)), [
    { skill_id: excel.id, required_level: 4, source: "RECRUITER" },
    { skill_id: budgeting.id, required_level: 2, source: "CATALOGUE_MATCH" },
  ]);
  assert.deepEqual(plain(read.requiredById.get(other)), [
    { skill_id: recruiting.id, required_level: 5, source: "RECRUITER" },
  ]);

  const query = h.queries.find((request) => request.table === "job_opening_skills");
  assert.equal(query.limit, 2 * openingSkillsDomain.MAX_REQUIRED_SKILLS);
});

test("a row the database's own checks would not allow is not printed as a requirement", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 9, source: "RECRUITER" },
        { opening_id: openingId, skill_id: budgeting.id, required_level: 3, source: "MACHINE" },
        { opening_id: openingId, skill_id: recruiting.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  const read = await h.required([openingId]);

  assert.deepEqual(plain(read.requiredById.get(openingId)), [
    { skill_id: recruiting.id, required_level: 3, source: "RECRUITER" },
  ]);
});

for (const [label, error] of [
  ["the table is missing", missing],
  ["the schema cache is behind", { code: "PGRST205", message: "Could not find the relationship or table job_opening_skills" }],
]) {
  test(`the page read says the list is not stored when ${label}`, async () => {
    const h = harness({ errors: { job_opening_skills: error } });
    const read = await h.required([openingId]);

    assert.equal(read.available, false);
    assert.equal(read.note, OPENING_SKILLS_SCHEMA_NOTE);
    assert.match(read.note, /037_opening_skills\.sql is authored but not applied/);
    assert.equal(read.requiredById.size, 0);
  });
}

test("the page read keeps a real failure as itself", async () => {
  const h = harness({ errors: { job_opening_skills: { code: "42501", message: "permission denied for table job_opening_skills" } } });
  const read = await h.required([openingId]);

  assert.equal(read.available, false);
  assert.match(read.note, /permission denied/);
  assert.doesNotMatch(read.note, /037|not applied/);
});
