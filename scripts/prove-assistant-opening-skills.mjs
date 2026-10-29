/* scripts/prove-assistant-opening-skills.mjs
 * Run: node --test scripts/prove-assistant-opening-skills.mjs
 *
 * #528–#532 gave a requisition its skill list: 037 authored, the domain rules,
 * the one writer, the picker in the job form and the per-candidate match in the
 * applicants drawer. This file is #533 — the same list in the chat, through the
 * same doors. The read is the assistant's own opening read and the write is the
 * action the drawer calls, so the permission checks, the validation and the
 * activity row the drawer has are the chat's, and the assistant gains no
 * private route to `job_opening_skills`.
 *
 * `db/migrations/037_opening_skills.sql` is APPLIED on this local database; every
 * test here is written for the other case — a database where that file has never
 * run, so the table does not exist and no row can be written. There an empty skill
 * list has to say WHICH of the two it
 * means — "this opening asks for nothing" or "no requisition can carry a list
 * yet" — and a write has to refuse with the file's name instead of half-applying.
 *
 * What runs is real: the assistant's opening read
 * (`src/modules/assistant/infrastructure/reads.ts`), the two skill reads, the
 * writer action, the registry's read and write sections and the chat's link
 * table. What is stood in for is the database (a recording REST client), the
 * session, the permission table, the activity trail and `revalidatePath`. A
 * boundary nobody listed throws with its name, so the chat cannot be quietly
 * stubbed into agreeing. The last three checks are text on purpose: the
 * approval fail-safe list lives in `tools.ts`, which pulls in all twenty
 * registry sections, and the two re-export lines are wiring, not behaviour.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import * as openingSkillsDomain from "../src/modules/jobs/domain/openingSkills.ts";
import {
  OPENING_SKILLS_SCHEMA_NOTE,
  OPENING_SKILLS_WRITE_REFUSAL,
} from "../src/modules/jobs/domain/openingSkills.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
/** Objects built inside the loaded modules carry that realm's prototype. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

const SKILLS_READ = "src/modules/jobs/application/openingSkillsRead.ts";
const TERMS_READ = "src/modules/jobs/application/openingTermsRead.ts";
const ASSISTANT_READS = "src/modules/assistant/infrastructure/reads.ts";
const SKILLS_ACTION = "src/app/(admin)/jobs/opening-skills-actions.ts";
const REGISTRY_READS = "src/modules/assistant/domain/registry/reads.ts";
const REGISTRY_WRITES = "src/modules/assistant/domain/registry/writes.ts";
const LINKS = "src/modules/assistant/domain/links.ts";

/**
 * Runs a real source file in this realm.
 *
 * A pure domain module, the two jobs application reads, the assistant's own
 * read file and the skills action are loaded for real — their rules and their
 * queries are the thing under test. Anything else from `@/` throws with its
 * name unless `bindings` answers it first.
 */
const REAL = new Map([
  ["@/modules/jobs/application/openingSkillsRead", SKILLS_READ],
  ["@/modules/jobs/application/openingTermsRead", TERMS_READ],
  ["@/modules/assistant/infrastructure/reads", ASSISTANT_READS],
  ["@/app/(admin)/jobs/opening-skills-actions", SKILLS_ACTION],
  ["@/lib/files/paths", "src/lib/files/paths.ts"],
  ["@/lib/textSearch", "src/lib/textSearch.ts"],
]);

function resolveSource(name, fromFile) {
  const base = path.isAbsolute(name)
    ? name
    : REAL.has(name)
      ? path.join(root, REAL.get(name))
      : name.startsWith("@/")
        ? path.join(root, "src", ...name.slice(2).split("/"))
        : path.join(path.dirname(fromFile), ...name.split("/"));
  // Some modules name their sibling with the extension and some without; a miss
  // here must not read as an empty module, so try both before giving up.
  return existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(base) ? base : null;
}

function loadModule(nameOrFile, bindings, cache = new Map()) {
  const target = resolveSource(nameOrFile, nameOrFile.startsWith(".") ? path.join(root, "src") : nameOrFile);
  if (!target) throw new Error(`loadModule: nothing at ${nameOrFile}`);
  if (cache.has(target)) return cache.get(target);

  const output = ts.transpileModule(readFileSync(target, "utf8"), {
    fileName: target,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  cache.set(target, loaded.exports);
  function localRequire(name) {
    if (name in bindings) return bindings[name];
    if (REAL.has(name) || /^@\/modules\/[^/]+\/domain\//.test(name) || name.startsWith(".")) {
      const resolved = resolveSource(name, target);
      if (!resolved) throw new Error(`loadModule: nothing at ${name} (from ${target})`);
      return loadModule(resolved, bindings, cache);
    }
    if (name.startsWith("@/")) {
      return new Proxy({}, { get() { throw new Error(`Unmocked boundary: ${name}`); } });
    }
    if (name === "server-only") return {};
    return nodeRequire(name);
  }
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

/* ------------------------------- Fixtures ------------------------------- */

const openingId = "10000000-0000-4000-8000-000000000001";
const excel = { id: "20000000-0000-4000-8000-000000000001", name: "Excel (advanced)", is_active: true, sort_order: 10 };
const budgeting = { id: "20000000-0000-4000-8000-000000000002", name: "Budgeting", is_active: true, sort_order: 20 };
const recruiting = { id: "20000000-0000-4000-8000-000000000003", name: "Recruiting", is_active: true, sort_order: 30 };
// Struck off in the master-data console. A stored row still has to be named.
const travel = { id: "20000000-0000-4000-8000-000000000004", name: "Travel coordination", is_active: false, sort_order: 40 };

/** The shape `JOB_SELECT` comes back with, embeds included. */
const OPENING_ROW = {
  id: openingId,
  title: "Finance Analyst",
  tenant_id: "40000000-0000-4000-8000-000000000007",
  tenants_and_companies: { name: "Sharm Dreams Group" },
  department: "Finance",
  sector: "Hospitality",
  location: "Sharm El Sheikh",
  employment_type: "FULL_TIME",
  status: "OPEN",
  description: "Owns the monthly forecast.",
  requirements: ["Advanced Excel", "Budgeting for a resort"],
  min_salary_usd: 1200,
  max_salary_usd: 1800,
  salary_currency: "USD",
  posted_at: null,
  closing_at: null,
  applicants: [{ count: 4 }],
  pipeline: [{ count: 2 }],
  hired: [{ count: 1 }],
};

function tables(options) {
  return {
    job_openings: [OPENING_ROW],
    skills: [excel, budgeting, recruiting, travel],
    job_opening_skills: [],
    ...options.tables,
  };
}

/**
 * A REST client that answers from fixtures and remembers every request.
 *
 * `.is("applicants.archived_at", null)` trims an embedded set, not the row it
 * hangs off, so a filter naming a dotted column is recorded and then ignored —
 * for `is`, `eq` and `in` alike. A read that carries `in("pipeline.stage", …)`
 * and `eq("hired.stage", …)` must still return the opening here; letting a
 * dotted predicate drop the parent row would test the stub, not the read.
 */
function makeClient(remembered, state) {
  return {
    from(table) {
      const request = { table, method: "GET", select: null, operations: [], body: null, onConflict: null, limit: null, single: false };
      remembered.push(request);
      const builder = {
        select(columns) { request.select = columns; return this; },
        eq(column, value) { if (!column.includes(".")) request.operations.push(["eq", column, value]); return this; },
        in(column, value) { if (!column.includes(".")) request.operations.push(["in", column, value]); return this; },
        is(column, value) { if (!column.includes(".")) request.operations.push(["is", column, value]); return this; },
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
            const readRequest = request.method === "GET";
            const injected = readRequest ? state.errors?.[table] : state.writeError?.[table];
            if (injected) return { data: null, error: injected };
            let rows = [...(state.tables[table] ?? [])];
            for (const [op, column, value] of request.operations) {
              if (op === "eq") rows = rows.filter((row) => row[column] === value);
              if (op === "is") rows = rows.filter((row) => row[column] === value);
              if (op === "in") rows = rows.filter((row) => value.includes(row[column]));
            }
            if (request.limit != null) rows = rows.slice(0, request.limit);
            if (request.method === "DELETE") {
              state.tables[table] = (state.tables[table] ?? []).filter((row) => !rows.includes(row));
            }
            if (request.method === "POST" && table === "job_opening_skills") {
              const incoming = Array.isArray(request.body) ? request.body : [request.body];
              const clashes = (row) =>
                incoming.some((next) => next.skill_id === row.skill_id && next.opening_id === row.opening_id);
              state.tables[table] = [
                ...(state.tables[table] ?? []).filter((row) => !clashes(row)),
                ...incoming,
              ];
            }
            return { data: request.single ? rows[0] ?? null : rows, count: rows.length, error: null };
          };
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

/* -------------------------------- Harness -------------------------------- */

function harness(options = {}) {
  const queries = [];
  const trail = [];
  const checks = [];
  const state = { tables: tables(options), errors: options.errors, writeError: options.writeError };
  const client = makeClient(queries, state);

  const bindings = {
    "@/lib/data-api/server": { createServerRestClient: async () => client },
    "@/lib/auth/session": { requireStaff: async (route) => { checks.push(route); } },
    "@/modules/settings/infrastructure/permissions": {
      hasPermissionForUser: async (key) => { checks.push(key); return options.allowed ?? true; },
    },
    "@/modules/activity/application/record": {
      recordActivity: async (entry) => { trail.push(entry); return { ok: true }; },
    },
    "next/cache": { revalidatePath: () => {} },
  };

  // The chat's one seam to the screens. `saveOpeningSkills` is the real action,
  // so a chat write goes through the gates the drawer's button goes through.
  // The rest are the values and word-builders the registry reads while its
  // modules load, to spell out the copy of the file, mail, outbox and interview
  // tools these tests never run — none of them has anything to do with a skill
  // list, and anything the registry reaches for that is not named here throws.
  const sources = {
    BUCKETS: [{ key: "candidate-resumes", label: "CVs" }],
    LIST_LIMIT: 50,
    ANSWER_ROWS: 50,
    MODEL_ROWS: 20,
    TASK_CATEGORIES: ["Documents", "Equipment", "Access"],
    TASK_OWNERS: [],
    AGENDA_CHAT_ROW_LIMIT: 50,
    INTERVIEW_ROUNDS: ["SCREENING", "TECHNICAL", "HIRING_MANAGER", "CULTURE_FIT"],
    INTERVIEW_ROUND_LABELS: {},
    OUTBOX_BUCKETS: ["queued", "sent", "failed"],
    PROSPECT_STAGES: ["NEW", "CONTACTED"],
    FILED_ENTITIES: ["jobs"],
    MASTER_ENTITIES: ["skills"],
    bucketInfo: () => null,
    fileSearchWords: () => "",
    emailSearchWords: () => "",
    prospectSearchWords: () => "",
    queueSearchWords: () => "",
    agendaReadNote: () => "",
    folderReadNote: () => "",
    candidateScopeNote: () => "",
  };
  bindings["@/modules/assistant/application/sources"] = new Proxy(sources, {
    get: (target, key) => {
      if (typeof key === "symbol" || key in target) return target[key];
      throw new Error(`Assistant boundary reached in this proof: sources.${String(key)}`);
    },
  });

  loadModule(path.join(root, SKILLS_READ), bindings);
  const actionModule = loadModule(path.join(root, SKILLS_ACTION), bindings);
  sources.saveOpeningSkills = actionModule.saveOpeningSkills;

  const registryReads = loadModule(path.join(root, REGISTRY_READS), bindings);
  const registryWrites = loadModule(path.join(root, REGISTRY_WRITES), bindings);
  const links = loadModule(path.join(root, LINKS), bindings);

  const tool = (list, name) => {
    const found = list.find((entry) => entry.name === name);
    assert.ok(found, `no ${name} tool in the registry`);
    return found;
  };

  return {
    queries,
    trail,
    checks,
    state,
    writes: () => queries.filter((request) => request.method !== "GET"),
    askedFor: (table) => queries.filter((request) => request.table === table),
    getJob: (jobId = openingId) => tool(registryReads.reads, "get_job").run({ job_id: jobId }),
    setSkills: (args) => tool(registryWrites.writes, "set_required_skills").run({ job_id: openingId, ...args }),
    skillsToolArgs: () => tool(registryWrites.writes, "set_required_skills").args,
    skillsToolDescription: () => tool(registryWrites.writes, "set_required_skills").description,
    getJobDescription: () => tool(registryReads.reads, "get_job").description,
    listJobsDescription: () => tool(registryReads.reads, "list_jobs").description,
    linkFor: (name, args, result) => links.linkForTool(name, args, result),
  };
}

const missing = { code: "42P01", message: 'relation "job_opening_skills" does not exist' };

// ---------------------------------------------------------------------------
// 1. The read — what `get_job` answers about a requisition's skills
//
// The chat already answers an opening's description, requirement prose and
// seniority. A recruiter asking "what does this role need, and how deep" gets
// paragraphs back, which is the exact claim 037 exists to replace with rows. The
// names have to come back too: a uuid in an answer is not a skill a person can
// read.
// ---------------------------------------------------------------------------

test("get_job names the skills a requisition asks for, with the catalogue's words", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 4, source: "RECRUITER" },
        { opening_id: openingId, skill_id: budgeting.id, required_level: 2, source: "CATALOGUE_MATCH" },
      ],
    },
  });
  const answer = await h.getJob();

  assert.equal(answer.ok, true);
  assert.deepEqual(plain(answer.required_skills), [
    { skill_id: excel.id, name: "Excel (advanced)", required_level: 4, source: "RECRUITER" },
    { skill_id: budgeting.id, name: "Budgeting", required_level: 2, source: "CATALOGUE_MATCH" },
  ]);
  assert.equal(answer.skills_note, undefined);
  // The opening itself is untouched — the skill list is added to the read, not
  // traded against it.
  assert.equal(answer.job.title, "Finance Analyst");
  assert.equal(answer.job.applicants, 4);
});

test("an opening that asks for nothing says so with no note", async () => {
  const h = harness();
  const answer = await h.getJob();

  assert.deepEqual(plain(answer.required_skills), []);
  assert.equal(answer.skills_note, undefined, "a working table printed a note it does not need");
  // Nothing to name, so the catalogue is not queried for it.
  assert.equal(h.askedFor("skills").length, 0);
});

test("on a database where 037 never ran get_job still answers the opening and names the file", async () => {
  const h = harness({ errors: { job_opening_skills: missing } });
  const answer = await h.getJob();

  assert.equal(answer.ok, true);
  assert.equal(answer.job.title, "Finance Analyst");
  assert.deepEqual(plain(answer.required_skills), []);
  assert.equal(answer.skills_note, OPENING_SKILLS_SCHEMA_NOTE);
  assert.match(answer.skills_note, /037_opening_skills\.sql is authored but not applied/);
});

test("a missing skill table costs the list alone, not the seniority note", async () => {
  // Both reads degrade, each on its own terms: 033's note and 037's note are
  // different sentences about different files, and one must not swallow the other.
  const h = harness({ errors: { job_opening_skills: missing } });
  const answer = await h.getJob();

  assert.match(answer.skills_note, /037/);
  assert.doesNotMatch(answer.skills_note, /033/);
});

test("a skill the console has struck off is still named", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: travel.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  const answer = await h.getJob();

  assert.deepEqual(plain(answer.required_skills), [
    { skill_id: travel.id, name: "Travel coordination", required_level: 3, source: "RECRUITER" },
  ]);
});

test("a failed catalogue read costs the names, not the levels, and says which read failed", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 4, source: "RECRUITER" },
      ],
    },
    errors: { skills: { code: "42501", message: "permission denied for table skills" } },
  });
  const answer = await h.getJob();

  assert.equal(answer.ok, true);
  assert.deepEqual(plain(answer.required_skills), [
    { skill_id: excel.id, name: null, required_level: 4, source: "RECRUITER" },
  ]);
  assert.match(answer.skills_note, /catalogue/i);
  assert.doesNotMatch(answer.skills_note, /037/);
});

test("the skill list is answered by get_job, and list_jobs says so instead of carrying it", async () => {
  // `list_jobs` cannot ask for the rows: its window is up to 200 ids, and a
  // 200-member `.in()` is the request-line size that already broke a read here.
  // So the grid's tool points at the one-opening tool rather than pretending.
  const h = harness();
  assert.match(h.getJobDescription(), /required skill/i);
  assert.match(h.listJobsDescription(), /get_job/);
  assert.doesNotMatch(h.listJobsDescription(), /required_skills/);
});

test("the chat read goes through the same staff gate as the grid", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 4, source: "RECRUITER" },
      ],
    },
  });
  await h.getJob();
  assert.ok(h.checks.includes("/jobs"));
});

// ---------------------------------------------------------------------------
// 2. The write — the drawer's own action behind a chat tool
// ---------------------------------------------------------------------------

test("the chat records what a requisition asks for through the drawer's action", async () => {
  const h = harness();
  const result = await h.setSkills({
    skills: [{ skill_id: excel.id, required_level: 4 }, { skill_id: budgeting.id, source: "CATALOGUE_MATCH" }],
  });

  assert.equal(result.ok, true);
  const post = h.queries.find((request) => request.method === "POST");
  assert.equal(post.table, "job_opening_skills");
  assert.equal(post.onConflict, "opening_id,skill_id");
  assert.deepEqual(plain(post.body), [
    { opening_id: openingId, skill_id: excel.id, required_level: 4, source: "RECRUITER" },
    { opening_id: openingId, skill_id: budgeting.id, required_level: 3, source: "CATALOGUE_MATCH" },
  ]);
  assert.equal(h.trail.length, 1);
  assert.match(h.trail[0].summary, /Finance Analyst/);
});

test("an empty list clears the requisition", async () => {
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  const result = await h.setSkills({ skills: [] });

  assert.equal(result.ok, true);
  assert.equal(h.state.tables.job_opening_skills.length, 0);
});

test("a call that never mentions skills empties nothing", async () => {
  // A model that drops the argument must not read as a recruiter who removed
  // every requirement, so the argument is required and the refusal costs no rows.
  const h = harness({
    tables: {
      job_opening_skills: [
        { opening_id: openingId, skill_id: excel.id, required_level: 3, source: "RECRUITER" },
      ],
    },
  });
  await assert.rejects(h.setSkills({}), /skills/);
  assert.equal(h.writes().length, 0);
  assert.equal(h.state.tables.job_opening_skills.length, 1);
});

test("a level a model quoted as text is stored as the number it stands for", async () => {
  const h = harness();
  const result = await h.setSkills({ skills: [{ skill_id: excel.id, required_level: "4" }] });

  assert.equal(result.ok, true);
  const post = h.queries.find((request) => request.method === "POST");
  assert.deepEqual(plain(post.body), [
    { opening_id: openingId, skill_id: excel.id, required_level: 4, source: "RECRUITER" },
  ]);
});

test("a level that is not a number is refused, not stored as the default", async () => {
  // The trap this tool could easily set: a numeric-string reader that turns
  // "advanced" into nothing would let the column default quietly write 3, and
  // the recruiter would be told a level nobody chose.
  const h = harness();
  const result = await h.setSkills({ skills: [{ skill_id: excel.id, required_level: "advanced" }] });

  assert.equal(result.ok, false);
  assert.match(result.error, /whole number/i);
  assert.equal(h.writes().length, 0);
});

for (const [name, skills, expression] of [
  ["a skill outside the catalogue", [{ skill_id: "made-up-skill" }], /catalogue/i],
  ["the same skill twice", [{ skill_id: excel.id }, { skill_id: excel.id }], /twice/i],
  ["a level above the scale", [{ skill_id: excel.id, required_level: 7 }], /1 to 5/],
  ["an invented source", [{ skill_id: excel.id, source: "GUESS" }], /how it was chosen/i],
  ["a thirteenth skill", Array.from({ length: 13 }, (_, i) => ({ skill_id: `s${i}`, required_level: i + 1 })), /at most 12/],
]) {
  test(`${name} is refused from the chat with nothing written`, async () => {
    const h = harness();
    const result = await h.setSkills({ skills });
    assert.equal(result.ok, false);
    assert.match(result.error, expression);
    assert.equal(h.writes().length, 0);
  });
}

for (const [label, error] of [
  ["the table is missing", missing],
  ["PostgREST has not reloaded its schema cache", { code: "PGRST204", message: "Could not find the table 'job_opening_skills' in the schema cache" }],
]) {
  test(`${label}: the chat is refused in the file's own words and sends nothing`, async () => {
    const h = harness({ errors: { job_opening_skills: error } });
    const result = await h.setSkills({ skills: [{ skill_id: excel.id }] });

    assert.equal(result.ok, false);
    assert.equal(result.error, OPENING_SKILLS_WRITE_REFUSAL);
    assert.match(result.error, /037_opening_skills\.sql/);
    assert.equal(h.writes().length, 0);
    assert.equal(h.trail.length, 0);
  });
}

test("the chat cannot write a skill list without the permission the drawer needs", async () => {
  const h = harness({ allowed: false });
  const result = await h.setSkills({ skills: [{ skill_id: excel.id }] });

  assert.equal(result.ok, false);
  assert.match(result.error, /permission/i);
  assert.equal(h.writes().length, 0);
});

test("the argument copy says where a skill id comes from and what a level means", async () => {
  const h = harness();
  const args = h.skillsToolArgs();
  assert.match(args.skills, /get_master_data/);
  assert.match(args.skills, /1 to 5/);
  assert.match(h.skillsToolDescription(), /replaces/i);
});

// ---------------------------------------------------------------------------
// 3. The wiring, as text
// ---------------------------------------------------------------------------

test("the skills write waits for a human approval", () => {
  // `READ_ONLY_TOOLS` is the exception list: a tool not named in it is treated
  // as a write and needs an approval. Naming it here would open the table to the
  // chat without a person confirming.
  assert.doesNotMatch(read("src/modules/assistant/domain/tools.ts"), /"set_required_skills"/);
});

test("the action reaches the registry through the assistant's one seam", () => {
  const sources = read("src/modules/assistant/application/sources.ts");
  assert.match(sources, /saveOpeningSkills/);
  assert.match(sources, /@\/app\/\(admin\)\/jobs\/opening-skills-actions/);
  assert.match(read("src/modules/assistant/domain/registry/shared.ts"), /export \{ saveOpeningSkills \};/);
});

test("the chat link lands on the opening whose list changed", () => {
  const h = harness();
  const link = h.linkFor("set_required_skills", { job_id: openingId }, { ok: true, skills: [] });
  assert.deepEqual(plain(link), { href: `/jobs?job=${openingId}`, label: "View the opening" });
});

test("a skill level ceiling is the domain's, not a number this proof invented", () => {
  assert.equal(
    openingSkillsDomain.MAX_REQUIRED_SKILLS,
    12,
    "the chat's argument copy and the drawer's cap have drifted apart"
  );
});
