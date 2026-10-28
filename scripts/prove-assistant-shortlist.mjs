/* scripts/prove-assistant-shortlist.mjs
 * Run: node --test scripts/prove-assistant-shortlist.mjs
 *
 * The shortlist exists on one screen: the applicants drawer, where a recruiter
 * presses "Ranked by fit" and works a role's queue in order. A chat that cannot
 * answer "who is strongest for this opening?" would make the drawer the only place
 * the answer exists — and the assistant already reads that drawer's rows through
 * `get_job_applicants`, in the same order the database gave them.
 *
 * So this is the same read the drawer calls, behind a tool. `rank_candidates` runs
 * `getJobShortlist` — the action itself, not a copy of its query — which means the
 * staff gate, the mask predicate, the 200-row bound and the requisition's skill
 * list are the drawer's, and the assistant gains no private route to `applications`.
 *
 * What the checks below exist to keep is the honesty of the answer rather than the
 * arithmetic: the arithmetic is `prove-candidate-shortlist.mjs`'s job, and it is
 * already 36 checks green. Here:
 *   1. a withheld figure never reaches the chat at all — not "sent and unsaid";
 *   2. a capped read says it is capped, and a clipped answer says it was clipped;
 *   3. while 037 is unapplied the ranking still answers, without the skill
 *      component, and names the file that would have supplied it;
 *   4. a failed read is an error, never an empty list that reads as "nobody fit".
 *
 * What runs is real: the shortlist action, the pure ranker and mapper it calls, the
 * requisition-skills read, the gate parser, the registry's read section and the
 * chat's link table. What is stood in for is the database (a recording REST client),
 * the session and the mask predicate. A boundary nobody listed throws with its name.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import {
  SHORTLIST_LIMIT,
  shortlistReason,
} from "../src/modules/jobs/domain/shortlist.ts";
import { OPENING_SKILLS_SCHEMA_NOTE } from "../src/modules/jobs/domain/openingSkills.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
/** Objects built inside the loaded modules carry that realm's prototype. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

const SHORTLIST_ACTION = "src/app/(admin)/jobs/shortlist-actions.ts";
const SKILLS_READ = "src/modules/jobs/application/openingSkillsRead.ts";
const TERMS_READ = "src/modules/jobs/application/openingTermsRead.ts";
const ASSISTANT_READS = "src/modules/assistant/infrastructure/reads.ts";
const REGISTRY_READS = "src/modules/assistant/domain/registry/reads.ts";
const LINKS = "src/modules/assistant/domain/links.ts";

/** The chat clips a list answer to this many rows — see `ANSWER_ROWS` in shared.ts. */
const CHAT_ROWS = 50;

const REAL = new Map([
  ["@/modules/jobs/application/openingSkillsRead", SKILLS_READ],
  ["@/modules/jobs/application/openingTermsRead", TERMS_READ],
  ["@/modules/assistant/infrastructure/reads", ASSISTANT_READS],
  ["@/app/(admin)/jobs/shortlist-actions", SHORTLIST_ACTION],
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
  return existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(base) ? base : null;
}

function loadModule(nameOrFile, bindings, cache = new Map()) {
  const target = resolveSource(
    nameOrFile,
    nameOrFile.startsWith(".") ? path.join(root, "src") : nameOrFile
  );
  if (!target) throw new Error(`loadModule: nothing at ${nameOrFile}`);
  if (cache.has(target)) return cache.get(target);

  const output = ts.transpileModule(readFileSync(target, "utf8"), {
    fileName: target,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
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

const jobId = "10000000-0000-4000-8000-000000000001";
const skillA = "20000000-0000-4000-8000-000000000001";
const skillB = "20000000-0000-4000-8000-000000000002";

/**
 * One applicant's row, as the bounded read returns it.
 *
 * `archived_at: null` matters: the action filters on it, and a fixture without the
 * key would be dropped by the stub and read as "the action asked for too little".
 */
function application(id, name, over = {}) {
  return {
    id,
    job_id: jobId,
    archived_at: null,
    full_name: name,
    stage: "NEW",
    created_at: "2026-10-01T09:00:00.000Z",
    ai_match_score: null,
    gate_answers: [],
    candidate_skills: [],
    candidate_attempts: [],
    interview_schedules: [],
    ...over,
  };
}

/** Everything below the pass mark, in the shape `gate_answers` is stored in. */
const failedGate = [{ question: "Can you start in Sharm El Sheikh?", answer: "No", passed: false }];

/** The requisition's own list, as `job_opening_skills` rows. */
const REQUIRED_ROWS = [
  { opening_id: jobId, skill_id: skillA, required_level: 3, source: "RECRUITER" },
  { opening_id: jobId, skill_id: skillB, required_level: 4, source: "RECRUITER" },
];

/**
 * Three applicants, one signal short of each other, so the redistribution is the
 * answer under test rather than an accident of the fixtures.
 *   Samira — 60 AI, both skills met, nobody has set her a test or interviewed her.
 *   Rana   — 80 AI, one skill met, a 40/50 paper, a panel that averaged 4.
 *   Tarek  — 80 AI, both skills met, and a gate answer below the pass mark.
 */
function applicants() {
  return [
    application("a-1", "Samira Fawzy", {
      ai_match_score: 60,
      candidate_skills: [
        { skill_id: skillA, proficiency: 4 },
        { skill_id: skillB, proficiency: 5 },
      ],
    }),
    application("a-2", "Rana Hassan", {
      ai_match_score: 80,
      candidate_skills: [
        { skill_id: skillA, proficiency: 4 },
        { skill_id: skillB, proficiency: 2 },
      ],
      candidate_attempts: [
        { created_at: "2026-09-20T10:00:00.000Z", status: "GRADED", total_score: 40, max_score: 50 },
      ],
      interview_schedules: [
        { id: "i-1", interview_scorecards: [
          { technical: 4, communication: 4, problem_solving: 4, culture: 4 },
        ] },
      ],
    }),
    application("a-3", "Tarek Nabil", {
      ai_match_score: 80,
      gate_answers: failedGate,
      candidate_skills: [
        { skill_id: skillA, proficiency: 3 },
        { skill_id: skillB, proficiency: 4 },
      ],
    }),
  ];
}

/* -------------------------------- Harness -------------------------------- */

function harness(options = {}) {
  const queries = [];
  const checks = [];
  const state = {
    tables: {
      applications: options.applications ?? applicants(),
      job_opening_skills: options.requiredRows ?? REQUIRED_ROWS,
      ...options.tables,
    },
    errors: options.errors,
  };

  const client = {
    from(table) {
      const request = { table, method: "GET", select: null, operations: [], limit: null };
      queries.push(request);
      const builder = {
        select(columns) { request.select = columns; return this; },
        eq(column, value) { if (!column.includes(".")) request.operations.push(["eq", column, value]); return this; },
        in(column, value) { if (!column.includes(".")) request.operations.push(["in", column, value]); return this; },
        is(column, value) { if (!column.includes(".")) request.operations.push(["is", column, value]); return this; },
        order(column) { request.operations.push(["order", column]); return this; },
        limit(value) { request.limit = value; return this; },
        then(resolve, reject) {
          const run = async () => {
            if (state.errors?.[table]) return { data: null, error: state.errors[table] };
            let rows = [...(state.tables[table] ?? [])];
            for (const [op, column, value] of request.operations) {
              if (op === "eq" || op === "is") rows = rows.filter((row) => row[column] === value);
              if (op === "in") rows = rows.filter((row) => value.includes(row[column]));
            }
            if (request.limit != null) rows = rows.slice(0, request.limit);
            return { data: rows, count: rows.length, error: null };
          };
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  };

  const bindings = {
    "@/lib/data-api/server": { createServerRestClient: async () => client },
    "@/lib/auth/session": { requireStaff: async (route) => { checks.push(route); } },
    // The mask is a session + settings + permission read; the ranker only obeys the
    // boolean, so the proof hands the boolean over and never pretends to be a user.
    "@/modules/settings/application/scoreVisibility": {
      scoresAreMaskedForCurrentUser: async () => options.masked ?? false,
    },
    "@/modules/assistant/infrastructure/webLookup": {
      searchWeb: async () => ({ ok: true }),
      readWebPage: async () => ({ ok: true }),
    },
  };

  // The chat's one seam to the screens: the shortlist action is loaded for real and
  // handed to the registry through it, exactly as the drawer's own button is reached.
  const sources = {
    BUCKETS: [{ key: "candidate-resumes", label: "CVs" }],
    LIST_LIMIT: 50,
    ANSWER_ROWS: CHAT_ROWS,
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

  const actionModule = loadModule(path.join(root, SHORTLIST_ACTION), bindings);
  sources.getJobShortlist = actionModule.getJobShortlist;

  const registryReads = loadModule(path.join(root, REGISTRY_READS), bindings);
  const links = loadModule(path.join(root, LINKS), bindings);

  const tool = () => {
    const found = registryReads.reads.find((entry) => entry.name === "rank_candidates");
    assert.ok(found, "no rank_candidates tool in the registry");
    return found;
  };

  return {
    queries,
    checks,
    askedFor: (table) => queries.filter((request) => request.table === table),
    rank: (id = jobId) => tool().run({ job_id: id }),
    description: () => tool().description,
    args: () => tool().args,
    linkFor: (name, args, result) => links.linkForTool(name, args, result),
  };
}

const missingSkills = { code: "42P01", message: 'relation "job_opening_skills" does not exist' };

// ---------------------------------------------------------------------------
// 1. The answer — the drawer's ranking, in the chat
//
// Samira's 77 comes from two signals whose weights redistribute over what she
// carries (60×.35 + 100×.25 ÷ .6), Rana's 72 from all four, and Tarek sits below
// both on a tie of marks because a gate answer was below the pass mark.
// ---------------------------------------------------------------------------

test("rank_candidates orders an opening's applicants over the read's own bound", async () => {
  const h = harness();
  const answer = await h.rank();

  assert.equal(answer.ok, true);
  assert.deepEqual(
    answer.applicants.map((row) => [row.rank, row.name, row.score]),
    [
      [1, "Samira Fawzy", 77],
      [2, "Rana Hassan", 72],
      [3, "Tarek Nabil", 88],
    ]
  );
  // The gate marker reorders without rewriting the number: Tarek's 88 stands, and
  // it is the highest mark on the page.
  assert.equal(answer.applicants[2].gate_failed, true);
  assert.equal(answer.applicants[0].basis.join("+"), "ai+skills");
  assert.deepEqual(plain(answer.applicants[0].missing), ["test", "interview"]);
  // Each line carries the drawer's own reason, not a paraphrase of it.
  assert.equal(
    answer.applicants[1].reason,
    shortlistReason({
      applicationId: "a-2",
      name: "Rana Hassan",
      stage: "NEW",
      score: 72,
      basis: ["ai", "skills", "test", "interview"],
      missing: [],
      hidden: [],
      gateFailed: false,
    })
  );
  assert.match(answer.basis_note, /Ranked from 3 applicants/);
  assert.equal(answer.note, null);
  assert.equal(answer.shown_note, null);
});

test("the chat read asks for this opening's live applicants, the drawer's own scope", async () => {
  const h = harness();
  await h.rank();

  const applications = h.askedFor("applications");
  assert.equal(applications.length, 1, "the ranking asks for applicants more than once");
  const request = applications[0];
  assert.ok(request.operations.some(([op, column, value]) => op === "eq" && column === "job_id" && value === jobId));
  assert.ok(
    request.operations.some(([op, column, value]) => op === "is" && column === "archived_at" && value === null),
    "an archived applicant must not be ranked at all"
  );
  // The bound is one row past the ranking's ceiling, so a capped read is knowable.
  assert.equal(request.limit, SHORTLIST_LIMIT + 1);
  // The requisition's list is read apart from the row select: while 037 is unapplied
  // the row select still answers.
  assert.equal(h.askedFor("job_opening_skills").length, 1);
  assert.ok(!request.select.includes("job_opening_skills"));
});

test("the read goes through the staff gate the drawer uses", async () => {
  const h = harness();
  await h.rank();
  assert.ok(h.checks.includes("/jobs"), "the chat opened the applicants read without the page guard");
});

test("an opening with nobody applied answers empty and says nothing false", async () => {
  const h = harness({ applications: [] });
  const answer = await h.rank();

  assert.equal(answer.ok, true);
  assert.deepEqual(plain(answer.applicants), []);
  assert.match(
    answer.basis_note,
    /cannot be ranked/,
    "an empty queue printed a header that implies someone was ranked"
  );
});

// ---------------------------------------------------------------------------
// 2. Two caps, said twice
// ---------------------------------------------------------------------------

test("more applicants than the bound: the answer says the order is over the most recent ones", async () => {
  const many = Array.from({ length: SHORTLIST_LIMIT + 1 }, (_, index) =>
    application(`b-${index}`, `Applicant ${String(index).padStart(3, "0")}`, {
      ai_match_score: 50,
      created_at: `2026-10-0${index % 9 + 1}T09:00:00.000Z`,
    })
  );
  const h = harness({ applications: many });
  const answer = await h.rank();

  assert.match(answer.note, /the 200 most recent applicants/);
  assert.equal(answer.applicants.length, CHAT_ROWS, "the answer overflowed the chat's own row bound");
  assert.match(answer.shown_note, /top 50 of 200/);
});

// ---------------------------------------------------------------------------
// 3. A withheld figure never reaches the chat
// ---------------------------------------------------------------------------

test("a masked account ranks on the skill evidence alone and the numbers never leave", async () => {
  const h = harness({ masked: true });
  const answer = await h.rank();

  assert.equal(answer.scores_hidden, true);
  assert.deepEqual(plain(answer.applicants[0].hidden), ["ai", "test", "interview"]);
  // The requisition's skill evidence is counts of names, not a score, so it is the
  // one component a masked account still ranks on — the drawer's own rule.
  assert.deepEqual(plain(answer.applicants[0].basis), ["skills"]);
  // The drawer's own line, so the screen and the chat explain the same narrower
  // ranking in the same words.
  assert.match(answer.basis_note, /withheld from your account/);
  // A withheld figure cannot be quoted, sorted by, or stored in a session turn if it
  // is never in the answer, so the line's own shape is the boundary being proved.
  assert.deepEqual(Object.keys(answer.applicants[0]).sort(), [
    "application_id",
    "basis",
    "gate_failed",
    "hidden",
    "missing",
    "name",
    "rank",
    "reason",
    "score",
    "stage",
  ]);
});

test("a masked account with no skill list cannot be ranked, and says why", async () => {
  const h = harness({ masked: true, requiredRows: [] });
  const answer = await h.rank();

  assert.equal(answer.ok, true);
  assert.match(answer.basis_note, /cannot be ranked/);
  assert.deepEqual(plain(answer.applicants[0].basis), []);
  assert.equal(answer.applicants[0].score, null);
  assert.match(answer.applicants[0].reason, /withheld from your account/);
});

// ---------------------------------------------------------------------------
// 4. What the database cannot offer
// ---------------------------------------------------------------------------

test("while 037 is unapplied the ranking answers without the skill component and names the file", async () => {
  const h = harness({ errors: { job_opening_skills: missingSkills } });
  const answer = await h.rank();

  assert.equal(answer.ok, true);
  assert.match(answer.note, /037_opening_skills\.sql/);
  assert.equal(answer.note, OPENING_SKILLS_SCHEMA_NOTE);
  // The component drops out and its weight redistributes rather than scoring zero.
  assert.ok(!answer.applicants[0].basis.includes("skills"));
  assert.ok(answer.applicants[0].missing.includes("skills"));
  assert.deepEqual(
    answer.applicants.map((row) => [row.name, row.score]),
    [
      ["Rana Hassan", 79],
      ["Samira Fawzy", 60],
      ["Tarek Nabil", 80],
    ],
    "the marks stand on what is left; Tarek stays last on the gate marker, not a number"
  );
});

test("a failed applicants read is an error, never an empty shortlist", async () => {
  const h = harness({ errors: { applications: { code: "42501", message: "permission denied for table applications" } } });
  const answer = await h.rank();

  assert.equal(answer.ok, false);
  assert.match(answer.error, /shortlist/i);
  assert.equal(answer.applicants, undefined, "a read that failed answered as a queue of nobody");
});

// ---------------------------------------------------------------------------
// 5. The copy, the link, the wiring
// ---------------------------------------------------------------------------

test("the tool's copy promises only what the answer can carry", async () => {
  const h = harness();
  assert.match(h.description(), /rank/i);
  assert.match(h.description(), /withheld/i);
  assert.match(h.description(), /most recent/i);
  // The model gets one id from a tool it already has, and is pointed at the drawer
  // for the list beyond the chat's own rows.
  assert.match(h.args().job_id, /get_job_applicants|list_jobs/);
  assert.match(h.description(), /applicants drawer/i);
});

test("the chat link lands on that opening's drawer, already in the order the answer read", async () => {
  const h = harness();
  const answer = await h.rank();
  const link = h.linkFor("rank_candidates", { job_id: jobId }, answer);
  // The answer above the link is an order, and a plain `?job=` link opens the
  // drawer newest-first — so the link has to carry the order it is promising.
  assert.deepEqual(plain(link), {
    href: `/jobs?job=${jobId}&order=ranked`,
    label: "Open the ranked shortlist",
  });
});

test("rank_candidates is a read: no approval card between a recruiter and their queue", () => {
  // The approval list is the exception list — a tool not named in `READ_ONLY_TOOLS`
  // is treated as a write and waits for a person. This read changes nothing.
  assert.match(read("src/modules/assistant/domain/tools.ts"), /"rank_candidates"/);
});

test("the action reaches the registry through the assistant's one seam", () => {
  const sources = read("src/modules/assistant/application/sources.ts");
  assert.match(sources, /getJobShortlist/);
  assert.match(sources, /@\/app\/\(admin\)\/jobs\/shortlist-actions/);
  assert.match(
    read("src/modules/assistant/domain/registry/shared.ts"),
    /export \{ getJobShortlist \};/
  );
});

test("the bound the answer quotes is the domain's, not a number this proof invented", () => {
  assert.equal(SHORTLIST_LIMIT, 200, "the action's read and the drawer's copy have drifted apart");
});
