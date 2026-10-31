/* scripts/prove-screening-skills.mjs
 * Run: node --test scripts/prove-screening-skills.mjs
 *
 * #535 makes `candidate_skills` a table the portal actually fills. Before this,
 * the applicants drawer could only ever print "no evidence" — the rows its match
 * reads are written by the sourcing convert and by onboarding, never by screening,
 * so the one engine that actually reads a CV recorded nothing about what it saw.
 *
 * Three things have to hold for that to be worth anything:
 *   1. A demonstrated skill is a catalogue row. The model is given the live `skills`
 *      names and answers with names; a name the catalogue does not offer is dropped,
 *      because `candidate_skills.skill_id` is a foreign key and a row for an
 *      invented skill is a row nobody can display or remove.
 *   2. A level is the column's own 1..5 scale, and a level the model spelled
 *      loosely is recorded at the nearest mark the scale holds rather than thrown
 *      away — losing evidence is not the safe direction.
 *   3. The write is supplementary. The score, the summary and the stage move are
 *      the screening result; if the skill rows fail, the screening still succeeded.
 *
 * What runs is real: the screening engine's own prompt and return shape
 * (`src/modules/screening/infrastructure/openRouterEngine.ts`), the use-case that
 * persists it (`src/modules/screening/application/screen-application.ts`), the
 * catalogue read (`src/modules/jobs/application/openingSkillsRead.ts`) and the
 * skills domain (`src/modules/jobs/domain/openingSkills.ts`) whose rules the
 * applicants drawer already uses — so a level the screener writes is read back by
 * the same matcher the drawer prints.
 *
 * What is stood in for is the model (a canned completion, so NO live AI call is
 * made here), the database (a recording REST client over fixtures), the settings
 * reader, the activity trail and the stage-change notifier. A boundary nobody
 * listed throws with its name.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

const ENGINE = "src/modules/screening/infrastructure/openRouterEngine.ts";
const SCREEN = "src/modules/screening/application/screen-application.ts";
const SKILLS_READ = "src/modules/jobs/application/openingSkillsRead.ts";
const SKILLS_DOMAIN = "src/modules/jobs/domain/openingSkills.ts";

/** Modules loaded from disk for real, whatever asks for them. */
const REAL = new Map([
  ["@/modules/screening/infrastructure/openRouterEngine", ENGINE],
  ["@/modules/screening/application/screen-application", SCREEN],
  ["@/modules/jobs/application/openingSkillsRead", SKILLS_READ],
  ["@/lib/files/paths", "src/lib/files/paths.ts"],
]);

function resolveSource(name, fromFile) {
  if (existsSync(path.join(root, name))) return path.join(root, name);
  const base = path.isAbsolute(name)
    ? name
    : REAL.has(name)
      ? path.join(root, REAL.get(name))
      : name.startsWith("@/")
        ? path.join(root, "src", ...name.slice(2).split("/"))
        : path.join(path.dirname(fromFile), ...name.split("/"));
  return existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(base) ? base : null;
}

function loadModule(nameOrFile, bindings, cache = new Map()) {
  const target = resolveSource(nameOrFile, nameOrFile.startsWith(".") ? path.join(root, "src") : nameOrFile);
  if (!target) throw new Error(`loadModule: nothing at ${nameOrFile}`);
  if (cache.has(target)) return cache.get(target);

  const output = ts.transpileModule(readFileSync(target, "utf8"), {
    fileName: target,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const applicationId = "50000000-0000-4000-8000-000000000001";
const excel = { id: "60000000-0000-4000-8000-000000000001", name: "Excel (advanced)", is_active: true, sort_order: 10 };
const budgeting = { id: "60000000-0000-4000-8000-000000000002", name: "Budgeting", is_active: true, sort_order: 20 };
const forecasting = { id: "60000000-0000-4000-8000-000000000003", name: "Forecasting", is_active: true, sort_order: 30 };
// Struck off in the master-data console: the picker refuses it, so the screener must.
const travel = { id: "60000000-0000-4000-8000-000000000004", name: "Travel coordination", is_active: false, sort_order: 40 };

const CV_TEXT = "Seven years as a finance analyst. Advanced Excel, budgeting and monthly forecasting for a resort group.";

/** The row `screenApplicationById`'s own select comes back with. */
function applicationRow(overrides = {}) {
  return {
    id: applicationId,
    stage: "NEW",
    full_name: "Nour H.",
    cv_text: CV_TEXT,
    cv_file_path: null,
    job_openings: { title: "Finance Analyst", requirements: ["Advanced Excel", "Budgeting for a resort"] },
    ...overrides,
  };
}

function tables(options = {}) {
  return {
    applications: [applicationRow(options.application)],
    skills: [excel, budgeting, forecasting, travel],
    candidate_skills: options.candidateSkills ?? [],
    job_openings: [],
    activity_log: [],
  };
}

/**
 * A REST client that answers from fixtures and remembers every request.
 *
 * `.upsert(rows, { onConflict })` is recorded with its conflict target, because
 * the target is the claim under test: a re-screen must land on the existing
 * (application, skill) row instead of raising on its primary key.
 */
function makeClient(remembered, state) {
  const client = {
    from(table) {
      const request = {
        table,
        method: "GET",
        select: null,
        operations: [],
        body: null,
        onConflict: null,
        limit: null,
        single: false,
      };
      remembered.push(request);
      const builder = {
        select(columns) { request.select = columns; return this; },
        eq(column, value) { request.operations.push(["eq", column, value]); return this; },
        in(column, value) { request.operations.push(["in", column, value]); return this; },
        is(column, value) { request.operations.push(["is", column, value]); return this; },
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
            const isRead = request.method === "GET";
            const injected = isRead ? state.errors?.[table] : state.writeErrors?.[table];
            if (injected) return { data: null, error: injected };
            let rows = [...(state.tables[table] ?? [])];
            for (const [op, column, value] of request.operations) {
              if (op === "eq") rows = rows.filter((row) => row[column] === value);
              if (op === "is") rows = rows.filter((row) => row[column] === value);
              if (op === "in") rows = rows.filter((row) => value.includes(row[column]));
            }
            for (const operation of request.operations) {
              if (operation[0] === "order") {
                const column = operation[1];
                rows = rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
              }
            }
            if (request.limit != null) rows = rows.slice(0, request.limit);
            if (request.method === "PATCH") {
              const patch = Array.isArray(rows) ? rows : [];
              for (const row of patch) Object.assign(row, request.body);
            }
            if (request.method === "POST") {
              const incoming = Array.isArray(request.body) ? request.body : [request.body];
              state.tables[table] = [...(state.tables[table] ?? []), ...incoming];
            }
            return { data: request.single ? rows[0] ?? null : rows, count: rows.length, error: null };
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
 * One screening run with the model answered from a fixture.
 *
 * `completion` is what the gateway is made to return, so the JSON the model
 * "said" is chosen per test and never fetched. The messages the engine sent are
 * kept, because what the model was told about the catalogue is part of the claim.
 */
function harness({ completion, skillsRead, errors, writeErrors, tableOverrides = {}, settings } = {}) {
  const queries = [];
  const trail = [];
  const notices = [];
  const sent = [];
  const state = {
    tables: tables(tableOverrides),
    errors,
    writeErrors,
  };
  const client = makeClient(queries, state);

  // 61 sits under both auto-disposition thresholds (75 to shortlist, 40 to filter
  // out), so a default fixture screens without the engine also moving the stage —
  // the score and the stage are the existing behaviour, not this slice's claim.
  const payload = completion ?? {
    match_score: 61.2,
    decision: "BORDERLINE",
    summary: "Strong spreadsheet history, thin on modelling.",
    key_competencies: [],
    strengths: ["Seven years in resort finance"],
    gaps: ["No stated modelling tool"],
    anonymization_applied: false,
    model_used: "fixture/model",
    demonstrated_skills: [
      { skill: "Excel (advanced)", level: 4 },
      { skill: "Photoshop", level: 5 },
      { skill: "Travel coordination", level: 3 },
    ],
  };

  const gateway = {
    TruncatedJsonResponseError: class TruncatedJsonResponseError extends Error {},
    async complete(request) {
      sent.push(request);
      return { content: JSON.stringify(payload), model: "fixture/model", truncated: false };
    },
    parseJsonResponse(content) {
      return JSON.parse(content);
    },
  };

  const bindings = {
    "@/modules/screening/infrastructure/aiGateway": gateway,
    "@/lib/data-api/service": { getServiceRestClient: () => client },
    "@/lib/data-api/server": { createServerRestClient: async () => client },
    "@/lib/config.server": { hasAiProvider: () => settings?.provider ?? true },
    "@/lib/files/store": {
      getFileStore: async () => ({ download: async () => ({ bytes: null, error: "no file in this fixture" }) }),
    },
    "@/modules/screening/infrastructure/cvParser": {
      extractCvText: async () => ({ empty: true, text: "" }),
    },
    "@/modules/settings/infrastructure/settingsReader": {
      getBoolSetting: async (_key, fallback) => settings?.bias ?? fallback,
      getNumberSetting: async (_key, fallback) => fallback,
      readGlobalSettings: async () =>
        new Map([
          ["ai.enabled", settings?.aiEnabled ?? true],
          ["ai.auto_screen_applications", false],
        ]),
    },
    "@/modules/omnichannel/application/candidate-notifications": {
      notifyStageChange: async (id, stage) => {
        notices.push({ id, stage });
      },
    },
    "@/modules/activity/application/record": {
      engineActivityActor: async (label, via) => ({ actor_label: label, actor_via: via }),
      recordActivity: async (entry) => {
        trail.push(entry);
        return { ok: true };
      },
    },
  };

  if (skillsRead) {
    bindings["@/modules/jobs/application/openingSkillsRead"] = skillsRead;
  }

  const cache = new Map();
  const screen = loadModule(SCREEN, bindings, cache);

  return {
    screen: (id) => screen.screenApplicationById(id),
    engine: loadModule(ENGINE, bindings, cache),
    domain: loadModule(SKILLS_DOMAIN, bindings, cache),
    skillsReadModule: loadModule(SKILLS_READ, bindings, cache),
    queries,
    trail,
    notices,
    sent,
    state,
    writes: () => queries.filter((request) => request.method !== "GET"),
    skillWrites: () => queries.filter((request) => request.table === "candidate_skills" && request.method !== "GET"),
    rows: () => state.tables.candidate_skills,
  };
}

/* ------------------------- 1. The domain's own rule ------------------------ */

test("a demonstrated skill is kept only when the catalogue holds that name", () => {
  const { readDemonstratedSkills } = loadModule(SKILLS_DOMAIN, {});
  const catalogue = [
    { id: excel.id, name: excel.name },
    { id: budgeting.id, name: budgeting.name },
  ];

  const kept = readDemonstratedSkills(
    [
      { skill: "Excel (advanced)", level: 4 },
      { skill: "Photoshop", level: 5 },
      { skill: "Travel coordination", level: 3 },
    ],
    catalogue
  );

  assert.deepEqual(plain(kept), [{ skill_id: excel.id, proficiency: 4 }]);
});

test("the catalogue's own spellings are the whole vocabulary", () => {
  const { readDemonstratedSkills } = loadModule(SKILLS_DOMAIN, {});
  const catalogue = [
    { id: excel.id, name: excel.name },
    { id: "60000000-0000-4000-8000-000000000009", name: "NPV / IRR analysis" },
  ];

  const kept = readDemonstratedSkills(
    [
      { skill: "  excel ", level: 3 },
      { skill: "IRR analysis", level: 2 },
      { skill: "Excelism", level: 5 },
    ],
    catalogue
  );

  assert.deepEqual(
    plain(kept).map((row) => row.proficiency),
    [3, 2],
    "case, spacing and the halves of an alternatives name are found; a word that merely resembles a name is not"
  );
  assert.ok(kept.every((row) => typeof row.skill_id === "string"));
});

test("a level the scale cannot hold is recorded at the nearest mark, and a non-number is not recorded at all", () => {
  const { readDemonstratedSkills } = loadModule(SKILLS_DOMAIN, {});
  const catalogue = [
    { id: excel.id, name: excel.name },
    { id: budgeting.id, name: budgeting.name },
    { id: forecasting.id, name: forecasting.name },
  ];

  const kept = readDemonstratedSkills(
    [
      { skill: "Excel (advanced)", level: 9 },
      { skill: "Budgeting", level: -2 },
      { skill: "Forecasting", level: "keen" },
    ],
    catalogue
  );

  assert.deepEqual(
    plain(kept),
    [
      { skill_id: excel.id, proficiency: 5 },
      { skill_id: budgeting.id, proficiency: 1 },
    ],
    "9 becomes the top the scale holds and -2 its bottom; a level that is not a number says nothing"
  );
});

test("one skill is recorded once, at its strongest", () => {
  const { readDemonstratedSkills } = loadModule(SKILLS_DOMAIN, {});
  const catalogue = [{ id: excel.id, name: excel.name }];

  const kept = readDemonstratedSkills(
    [
      { skill: "Excel (advanced)", level: 2 },
      { skill: "Excel (advanced)", level: 4 },
      { skill: "excel", level: 3 },
    ],
    catalogue
  );

  assert.deepEqual(plain(kept), [{ skill_id: excel.id, proficiency: 4 }]);
});

test("garbage where the list should be records nothing", () => {
  const { readDemonstratedSkills } = loadModule(SKILLS_DOMAIN, {});
  const catalogue = [{ id: excel.id, name: excel.name }];
  for (const raw of [undefined, null, "Excel (advanced)", 7, { skill: "Excel (advanced)", level: 4 }]) {
    assert.deepEqual(plain(readDemonstratedSkills(raw, catalogue)), [], `${JSON.stringify(raw)} is not a list of skills`);
  }
});

/* ------------------------- 2. The engine's prompt ------------------------- */

test("the model is shown the catalogue's names and asked for them back", async () => {
  const run = harness();
  const catalogue = [
    { id: excel.id, name: excel.name },
    { id: budgeting.id, name: budgeting.name },
    { id: forecasting.id, name: forecasting.name },
  ];
  await run.engine.screenCandidateCv("Finance Analyst", ["Advanced Excel"], CV_TEXT, {
    anonymize: true,
    skills: catalogue,
  });

  const prompt = run.sent[0].messages.map((message) => message.content).join("\n");
  for (const name of [excel.name, budgeting.name, forecasting.name]) {
    assert.ok(prompt.includes(name), `the prompt never offered ${name}`);
  }
  assert.match(prompt, /demonstrated_skills/);
});

test("an empty catalogue asks for nothing and returns nothing", async () => {
  const run = harness();
  const result = await run.engine.screenCandidateCv("Finance Analyst", ["Advanced Excel"], CV_TEXT, {
    anonymize: true,
    skills: [],
  });

  const prompt = run.sent[0].messages.map((message) => message.content).join("\n");
  assert.doesNotMatch(prompt, /demonstrated_skills/, "a model with no vocabulary must not be asked to name skills");
  assert.deepEqual(plain(result.demonstrated_skills ?? []), []);
});

test("the engine hands back ids, not the names the model typed", async () => {
  const run = harness();
  const result = await run.engine.screenCandidateCv("Finance Analyst", ["Advanced Excel"], CV_TEXT, {
    anonymize: true,
    skills: [
      { id: excel.id, name: excel.name },
      { id: budgeting.id, name: budgeting.name },
    ],
  });

  assert.deepEqual(plain(result.demonstrated_skills), [{ skill_id: excel.id, proficiency: 4 }]);
  assert.equal(result.match_score, 61.2, "the score the screening already returned is untouched");
});

/* --------------------- 3. The use-case writes the evidence --------------------- */

test("a screen records what the CV showed against the application", async () => {
  const run = harness();
  const outcome = await run.screen(applicationId);

  assert.equal(outcome.ok, true);
  const rows = run.rows();
  assert.deepEqual(
    plain(rows),
    [
      {
        application_id: applicationId,
        skill_id: excel.id,
        proficiency: 4,
        source: "AI_SCREENING",
      },
    ]
  );
});

test("the rows land on the table's own key so a re-screen does not clash", async () => {
  const run = harness();
  await run.screen(applicationId);
  const [write] = run.skillWrites();

  assert.equal(write.onConflict, "application_id,skill_id");
  assert.equal(write.method, "POST", "the REST verb that carries on_conflict");
});

test("a second screen of the same application updates the level instead of adding a row", async () => {
  const run = harness({
    tableOverrides: {
      candidateSkills: [
        { application_id: applicationId, skill_id: excel.id, proficiency: 2, source: "AI_SCREENING" },
      ],
    },
  });

  // The fixture client has no conflict resolution of its own, so what this can
  // prove without Postgres is the claim the wire makes: the same key is sent, and
  // the database replaces that row rather than refusing a second one.
  await run.screen(applicationId);
  const [write] = run.skillWrites();
  assert.deepEqual(
    plain(write.body),
    [{ application_id: applicationId, skill_id: excel.id, proficiency: 4, source: "AI_SCREENING" }]
  );
});

test("nothing is written when the model named no skill", async () => {
  const run = harness({
    completion: {
      match_score: 61,
      decision: "BORDERLINE",
      summary: "A generalist CV with nothing the catalogue names.",
      key_competencies: [],
      strengths: [],
      gaps: [],
      anonymization_applied: false,
      model_used: "fixture/model",
    },
  });
  const outcome = await run.screen(applicationId);

  assert.equal(outcome.ok, true);
  assert.deepEqual(run.skillWrites(), []);
  assert.deepEqual(run.rows(), []);
});

test("the catalogue is asked for, and a catalogue read that fails costs only the skills", async () => {
  const run = harness({ errors: { skills: { code: "42P01", message: 'relation "skills" does not exist' } } });
  const outcome = await run.screen(applicationId);

  assert.equal(outcome.ok, true);
  assert.equal(plain(run.state.tables.applications[0].ai_match_score), 61, "the score still lands");
  assert.deepEqual(run.skillWrites(), []);
});

test("a skills write that fails does not undo the screening", async () => {
  const run = harness({
    writeErrors: { candidate_skills: { code: "23503", message: 'violates foreign key "skills(id)"' } },
  });
  const outcome = await run.screen(applicationId);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.score, 61);
  assert.equal(plain(run.state.tables.applications[0].stage), "AI_SCREENING");
});

test("the trail says how much evidence the screen recorded", async () => {
  const run = harness();
  await run.screen(applicationId);

  const screened = run.trail.find((entry) => entry.action === "cv_screened");
  assert.ok(screened, "the screening writes its own trail row");
  assert.match(screened.summary, /recorded 1 skill the catalogue names/, "the trail counts what it wrote");
  assert.deepEqual(plain(screened.detail?.demonstrated_skills), [
    { skill: "Excel (advanced)", level: 4 },
  ]);
});

test("a screen with a retired name in it records no row for it", async () => {
  const run = harness({
    completion: {
      match_score: 70,
      decision: "BORDERLINE",
      summary: "Cites a struck-off skill.",
      key_competencies: [],
      strengths: [],
      gaps: [],
      anonymization_applied: false,
      model_used: "fixture/model",
      demonstrated_skills: [{ skill: "Travel coordination", level: 4 }],
    },
  });
  await run.screen(applicationId);

  assert.deepEqual(run.rows(), []);
});

/* ------------------- 4. What the applicants drawer reads ------------------- */

test("the level the screener wrote is the level the drawer's matcher reads", async () => {
  const run = harness();
  await run.screen(applicationId);
  const { matchRequiredSkills } = loadModule(SKILLS_DOMAIN, {});

  const lines = matchRequiredSkills(
    [
      { skill_id: excel.id, required_level: 3, source: "RECRUITER" },
      { skill_id: budgeting.id, required_level: 4, source: "RECRUITER" },
    ],
    run.rows().map((row) => ({ skill_id: row.skill_id, proficiency: row.proficiency })),
    [
      { id: excel.id, name: excel.name },
      { id: budgeting.id, name: budgeting.name },
    ]
  );

  assert.deepEqual(
    plain(lines.map((line) => [line.name, line.demonstrated_level, line.evidence])),
    [
      ["Excel (advanced)", 4, "meets"],
      ["Budgeting", null, "no_evidence"],
    ],
    "the skill the CV showed meets its requirement; the one it never named stays no evidence"
  );
});

/* ------------------- 5. The screening the slice must not break ------------------- */

test("screening still saves the score, the summary and the stage move", async () => {
  const run = harness();
  const outcome = await run.screen(applicationId);

  const saved = plain(run.state.tables.applications[0]);
  assert.equal(outcome.score, 61);
  assert.equal(saved.ai_screening_summary, "Strong spreadsheet history, thin on modelling.");
  assert.equal(saved.stage, "AI_SCREENING");
  assert.deepEqual(saved.diversity_flags, { cv_anonymization: "applied" });
});

test("a candidate already past screening is not rewound", async () => {
  const run = harness({ tableOverrides: { application: applicationRow({ stage: "INTERVIEW" }) } });
  await run.screen(applicationId);

  assert.equal(plain(run.state.tables.applications[0].stage), "INTERVIEW");
});
