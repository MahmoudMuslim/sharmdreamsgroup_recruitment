/* scripts/prove-assistant-interview-notes.mjs
 * Run: node --test scripts/prove-assistant-interview-notes.mjs
 *
 * #536–#544 built panel notes for the people who sat the interview: the domain
 * rules, 038, the reader, the save action, the agenda's notes desk and the live
 * watch. This file is #543 — the same notes in the chat, through the same doors.
 *
 * The read is the assistant's own tool. The write is the action the notes desk
 * calls, so the session check, the authorisation on the row's own key pair, the
 * activity line and the revalidation the drawer has are the chat's, and the
 * assistant gains no private route to `interview_notes`.
 *
 * `db/migrations/038_interview_notes.sql` is APPLIED on this local database; the
 * reads are written for the other case — a database where that file has never run,
 * so the table does not exist. There an empty list has to say WHICH of the three it
 * means — "nobody wrote a note",
 * "this database has no notes table", or "no panel has that id" — because all
 * three render as zero rows and only two of them are about the panel.
 *
 * What runs is real: the notes domain, the reader, the action, the interviews
 * registry section and the chat's link table. What is stood in for is the
 * database (a recording REST client), the session, the timezone, the activity
 * trail and `revalidatePath`. A boundary nobody listed throws with its name, so
 * the chat cannot be quietly stubbed into agreeing. The approval checks are text
 * on purpose: `READ_ONLY_TOOLS` lives in `tools.ts`, which pulls in every
 * registry section, and the classification is the line that matters.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import {
  NOTES_BODY_LIMIT,
  NOTES_CHAT_CLIP,
  NOTES_SCHEMA_NOTE,
  NOTES_WRITE_REFUSAL,
} from "../src/modules/interviews/domain/interviewNotes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
/** Objects built inside the loaded modules carry that realm's prototype. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

const DOMAIN = "src/modules/interviews/domain/interviewNotes.ts";
const READER = "src/modules/interviews/infrastructure/notesReader.ts";
const ACTION = "src/app/(admin)/interviews/notes-actions.ts";
const REGISTRY = "src/modules/assistant/domain/registry/interviews.ts";
const LINKS = "src/modules/assistant/domain/links.ts";
const TOOLS = "src/modules/assistant/domain/tools.ts";

/**
 * Runs a real source file in this realm.
 *
 * The domain, the reader, the action and the registry section are loaded for
 * real — their rules and their queries are the thing under test. Anything else
 * from `@/` throws with its name unless `bindings` answers it first.
 */
const REAL = new Map([
  ["@/modules/interviews/domain/interviewNotes", DOMAIN],
  ["@/modules/interviews/infrastructure/notesReader", READER],
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

const panel = "30000000-0000-4000-8000-000000000001";
const futurePanel = "30000000-0000-4000-8000-000000000002";
const cancelledPanel = "30000000-0000-4000-8000-000000000003";
const me = "40000000-0000-4000-8000-000000000001";
const them = "40000000-0000-4000-8000-000000000002";
const missingId = "30000000-0000-4000-8000-0000000000ff";

const missingTable = { code: "42P01", message: 'relation "public.interview_notes" does not exist' };
const transportFailure = { code: null, message: "the API did not answer" };

const PAST = "2026-06-01T08:00:00.000Z";
const FUTURE = "2099-06-08T08:00:00.000Z";

function tables(options = {}) {
  return {
    interview_schedules: [
      {
        id: panel,
        application_id: "50000000-0000-4000-8000-000000000001",
        status: "COMPLETED",
        scheduled_at: PAST,
        applications: { full_name: "Rana Haddad" },
      },
      {
        id: futurePanel,
        application_id: "50000000-0000-4000-8000-000000000002",
        status: "SCHEDULED",
        scheduled_at: FUTURE,
        applications: { full_name: "Omar Saleh" },
      },
      {
        id: cancelledPanel,
        application_id: "50000000-0000-4000-8000-000000000003",
        status: "CANCELLED",
        scheduled_at: PAST,
        applications: { full_name: "Yara Fahmy" },
      },
    ],
    interview_notes: [],
    ...options.tables,
  };
}

/**
 * A REST client that answers from fixtures and remembers every request.
 *
 * `errors` injects a failure on a table's reads; `writeError` injects one on its
 * writes, which is how a refused save is separated from one that reached the
 * wire. Inserts, patches and deletes mutate the fixtures, so a test can ask what
 * the table holds afterwards instead of only what was sent. A note's primary key
 * is (interview_id, author_profile_id) and the stub repeats it: the second
 * writer is refused with 23505, never merged.
 */
function makeClient(remembered, state) {
  return {
    from(table) {
      const request = { table, method: "GET", select: null, operations: [], body: null, limit: null, single: false };
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
        update(values) { request.method = "PATCH"; request.body = values; return this; },
        delete() { request.method = "DELETE"; return this; },
        then(resolve, reject) {
          const run = async () => {
            const isRead = request.method === "GET";
            const injected = isRead ? state.errors?.[table] : state.writeError?.[table];
            if (injected) return { data: null, error: injected };

            let rows = [...(state.tables[table] ?? [])];
            for (const [op, column, value] of request.operations) {
              if (op === "eq") rows = rows.filter((row) => row[column] === value);
              if (op === "in") rows = rows.filter((row) => value.includes(row[column]));
            }
            if (request.limit != null) rows = rows.slice(0, request.limit);
            if (isRead && state.late && !state.lateApplied && table === state.late.table) {
              // The row arrives after this answer: the action's read found nothing and
              // its insert now meets a key pair that already exists. A second tab is
              // the race the composite key decides.
              state.tables[table] = [...(state.tables[table] ?? []), state.late.row];
              state.lateApplied = true;
            }
            if (request.method === "PATCH") {
              for (const row of rows) Object.assign(row, request.body);
            }
            if (request.method === "DELETE") {
              state.tables[table] = (state.tables[table] ?? []).filter((row) => !rows.includes(row));
            }
            if (request.method === "POST") {
              const incoming = Array.isArray(request.body) ? request.body : [request.body];
              if (table === "interview_notes") {
                const clash = incoming.find((row) =>
                  (state.tables[table] ?? []).some(
                    (held) =>
                      held.interview_id === row.interview_id &&
                      held.author_profile_id === row.author_profile_id
                  )
                );
                if (clash) {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message: 'duplicate key value violates unique constraint "interview_notes_pkey"',
                    },
                  };
                }
              }
              state.tables[table] = [
                ...(state.tables[table] ?? []),
                ...incoming.map((row) => ({
                  ...row,
                  created_at: "2026-06-02T09:00:00.000Z",
                  updated_at: "2026-06-02T09:00:00.000Z",
                })),
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
  const revalidated = [];
  const state = {
    tables: tables(options),
    errors: options.errors,
    writeError: options.writeError,
    late: options.late,
    lateApplied: false,
  };
  const client = makeClient(queries, state);

  const bindings = {
    "@/lib/data-api/server": { createServerRestClient: async () => client },
    "@/lib/auth/session": {
      requireStaff: async (route) => {
        checks.push(route);
        return { profileId: me, id: "staff-1" };
      },
    },
    "@/modules/settings/infrastructure/settingsReader": {
      getOrganisationTimeZone: async () => "Africa/Cairo",
    },
    "@/lib/timezone": { formatInZone: () => "01 Jun 2026, 10:00" },
    "@/modules/activity/application/record": {
      recordActivity: async (entry) => { trail.push(entry); return { ok: true }; },
    },
    "next/cache": { revalidatePath: (route) => revalidated.push(route) },
  };

  // The chat's seam to the screens. The two note functions are the real action's
  // own exports, so a chat read or write goes through the gates the notes desk
  // goes through. The rest are the values and word-builders the registry reads
  // while its modules load, to spell out the copy of tools these tests never run;
  // anything the registry reaches for that is not named here throws by name.
  const domain = loadModule(path.join(root, DOMAIN), bindings);
  const sources = {
    BUCKETS: [{ key: "candidate-resumes", label: "CVs" }],
    LIST_LIMIT: 50,
    ANSWER_ROWS: 50,
    MODEL_ROWS: 20,
    TASK_CATEGORIES: ["Documents", "Equipment", "Access"],
    TASK_OWNERS: [],
    AGENDA_CHAT_ROW_LIMIT: 50,
    INTERVIEW_OUTCOMES: ["COMPLETED", "NO_SHOW", "CANCELLED"],
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
    NOTES_BODY_LIMIT: domain.NOTES_BODY_LIMIT,
    NOTES_CHAT_CLIP: domain.NOTES_CHAT_CLIP,
    NOTES_SCHEMA_NOTE: domain.NOTES_SCHEMA_NOTE,
    clipNoteBody: domain.clipNoteBody,
    notesFor: domain.notesFor,
    getInterviewNotesForPanel: async (id) => actionModule.getInterviewNotesForPanel(id),
    saveInterviewNotes: async (input) => actionModule.saveInterviewNotes(input),
  };
  bindings["@/modules/assistant/application/sources"] = new Proxy(sources, {
    get: (target, key) => {
      if (typeof key === "symbol" || key in target) return target[key];
      throw new Error(`Assistant boundary reached in this proof: sources.${String(key)}`);
    },
  });

  const actionModule = loadModule(path.join(root, ACTION), bindings);
  const registry = loadModule(path.join(root, REGISTRY), bindings);
  const links = loadModule(path.join(root, LINKS), bindings);

  const tool = (name) => {
    const found = registry.interviews.find((entry) => entry.name === name);
    assert.ok(found, `no ${name} tool in the registry`);
    return found;
  };

  return {
    queries,
    trail,
    checks,
    revalidated,
    state,
    writes: () => queries.filter((request) => request.method !== "GET"),
    askedFor: (table) => queries.filter((request) => request.table === table),
    readNotes: (interviewId = panel) => tool("read_interview_notes").run({ interview_id: interviewId }),
    saveNotes: (args) => tool("save_interview_notes").run({ interview_id: panel, ...args }),
    readTool: () => tool("read_interview_notes"),
    saveTool: () => tool("save_interview_notes"),
    linkFor: (name, args, result) => links.linkForTool(name, args, result),
  };
}

const note = (author, body, at) => ({
  interview_id: panel,
  author_profile_id: author === "me" ? me : them,
  body,
  created_at: at,
  updated_at: at,
  user_profiles: { full_name: author === "me" ? "Mona Adel" : "Karim Sabry" },
});

// ---------------------------------------------------------------------------
// 1. The read — what the chat says about one panel's notes
// ---------------------------------------------------------------------------

test("the read names every writer, marks the reader's own, and carries the words", async () => {
  const h = harness({
    tables: {
      interview_notes: [
        note("me", "Asked about the two-year gap; answer was clear.", "2026-06-01T09:00:00.000Z"),
        note("them", "Strong on reconciliation, weak on stakeholder stories.", "2026-06-01T09:30:00.000Z"),
      ],
    },
  });
  const answer = await h.readNotes();

  assert.equal(answer.ok, true);
  assert.equal(answer.interview_id, panel);
  assert.equal(answer.notes_available, true);
  assert.equal(answer.count, 2);
  assert.match(answer.notes_note, /2 notes are below/);
  assert.doesNotMatch(answer.notes_note, /clipped/);
  assert.deepEqual(plain(answer.notes), [
    {
      author: "Mona Adel",
      mine: true,
      body: "Asked about the two-year gap; answer was clear.",
      clipped: false,
      written_at: "2026-06-01T09:00:00.000Z",
      updated_at: "2026-06-01T09:00:00.000Z",
    },
    {
      author: "Karim Sabry",
      mine: false,
      body: "Strong on reconciliation, weak on stakeholder stories.",
      clipped: false,
      written_at: "2026-06-01T09:30:00.000Z",
      updated_at: "2026-06-01T09:30:00.000Z",
    },
  ]);
  assert.ok(h.checks.includes("/interviews"), "the read did not pass the staff door");
});

test("a note longer than the chat's clip is cut and says so", async () => {
  const long = "x".repeat(NOTES_CHAT_CLIP + 250);
  const h = harness({ tables: { interview_notes: [note("me", long, "2026-06-01T09:00:00.000Z")] } });
  const answer = await h.readNotes();

  assert.equal(answer.notes[0].body.length, NOTES_CHAT_CLIP);
  assert.equal(answer.notes[0].clipped, true);
  assert.match(answer.notes_note, new RegExp(String(NOTES_CHAT_CLIP)));
  assert.match(answer.notes_note, /clipped/);
  // The cap the chat quotes is the one the domain enforces, not a number typed here.
  assert.equal(NOTES_CHAT_CLIP, 800);
});

test("a panel nobody wrote about says exactly that", async () => {
  const h = harness();
  const answer = await h.readNotes();

  assert.equal(answer.ok, true);
  assert.equal(answer.notes_available, true);
  assert.equal(answer.count, 0);
  assert.deepEqual(plain(answer.notes), []);
  assert.equal(answer.notes_note, "Nobody has written a note on this panel yet.");
});

test("on a database where 038 never ran the read names the file instead of calling the panel empty", async () => {
  const h = harness({ errors: { interview_notes: missingTable } });
  const answer = await h.readNotes();

  assert.equal(answer.ok, true);
  assert.equal(answer.notes_available, false);
  assert.equal(answer.count, 0);
  assert.equal(answer.notes_note, NOTES_SCHEMA_NOTE);
  assert.match(answer.notes_note, /038_interview_notes\.sql/);
  // Still the panel's status and slot, so the answer can say what it is about.
  assert.equal(answer.status, "COMPLETED");
  assert.equal(answer.scheduled_at, PAST);
});

test("an id no panel holds is refused, not described as a panel with no notes", async () => {
  const h = harness();
  const answer = await h.readNotes(missingId);

  assert.equal(answer.ok, false);
  assert.match(answer.error, /No interview has that id/);
  assert.equal(answer.notes_note, undefined);
});

test("a schedule read that failed is a failure, not a missing panel", async () => {
  // The same rule the scorecard layer follows: a query that did not answer proves
  // nothing about which rows exist, so "no such panel" would be a claim invented
  // out of a transport error.
  const h = harness({ errors: { interview_schedules: transportFailure } });
  const answer = await h.readNotes();

  assert.equal(answer.ok, false);
  assert.match(answer.error, /could not be read/);
  assert.doesNotMatch(answer.error, /No interview has that id/);
});

test("the read's argument copy names where the id comes from", () => {
  const h = harness();
  assert.match(h.readTool().args.interview_id, /list_interviews/);
  assert.match(h.readTool().description, /notes_note/);
  assert.match(h.readTool().description, /038_interview_notes\.sql/);
});

// ---------------------------------------------------------------------------
// 2. The write — through the same action the notes desk calls
// ---------------------------------------------------------------------------

test("the write saves as the session's recruiter even when the arguments name another", async () => {
  const h = harness();
  const result = await h.saveNotes({ body: "Asked about the gap.", author_profile_id: them });

  assert.equal(result.ok, true, result.error);
  const insert = h.writes().find((request) => request.method === "POST");
  assert.ok(insert, "the save inserted a row");
  assert.equal(insert.body.author_profile_id, me);
  assert.equal(h.trail[0].action, "interview_notes");
  assert.deepEqual(plain(h.revalidated), ["/interviews", "/candidates"]);
});

test("a second save edits the reader's own row instead of adding another", async () => {
  const h = harness({
    tables: { interview_notes: [note("me", "first draft", "2026-06-01T09:00:00.000Z")] },
  });
  const result = await h.saveNotes({ body: "second draft" });

  assert.equal(result.ok, true, result.error);
  const patch = h.writes().find((request) => request.method === "PATCH");
  assert.ok(patch);
  assert.deepEqual(
    plain(patch.operations.filter(([, column]) => column === "author_profile_id").map(([, , value]) => value)),
    [me]
  );
  assert.equal(h.state.tables.interview_notes.length, 1);
  assert.equal(h.state.tables.interview_notes[0].body, "second draft");
});

test("a blank body clears the reader's note and leaves a colleague's alone", async () => {
  const h = harness({
    tables: {
      interview_notes: [
        note("me", "written while it was happening", "2026-06-01T09:00:00.000Z"),
        note("them", "the other interviewer's account", "2026-06-01T09:30:00.000Z"),
      ],
    },
  });
  const result = await h.saveNotes({ body: "   " });

  assert.equal(result.ok, true, result.error);
  assert.ok(h.writes().some((request) => request.method === "DELETE"));
  assert.deepEqual(
    plain(h.state.tables.interview_notes.map((row) => row.author_profile_id)),
    [them]
  );
  assert.equal(h.trail[0].action, "interview_notes");
});

test("a blank from someone who never wrote is not a save", async () => {
  const h = harness();
  const result = await h.saveNotes({ body: "" });

  assert.equal(result.ok, true, result.error);
  assert.equal(h.writes().length, 0);
  assert.equal(h.trail.length, 0);
  // The slot still comes back, so the chat's link can open the right half of the agenda.
  assert.equal(result.scheduledAt, PAST);
});

test("a missing body is refused; blank is an instruction and absence is not", async () => {
  // A model that forgot the argument must not wipe words it never saw, so only
  // the explicit empty string clears.
  const h = harness();
  await assert.rejects(h.saveNotes({}), /body/);
  assert.equal(h.writes().length, 0);
});

test("a cancelled panel is refused in the domain's own words with nothing written", async () => {
  const h = harness();
  const answer = await h.saveTool().run({ interview_id: cancelledPanel, body: "anything" });

  assert.equal(answer.ok, false);
  assert.equal(answer.error, "This panel was cancelled, so there is nothing to note.");
  assert.equal(h.writes().length, 0);
  assert.equal(h.trail.length, 0);
});

test("a no-show is refused the same way", async () => {
  const h = harness({
    tables: {
      interview_schedules: [
        { id: panel, status: "NO_SHOW", scheduled_at: PAST, applications: { full_name: "Rana Haddad" } },
      ],
    },
  });
  const answer = await h.saveNotes({ body: "anything" });

  assert.equal(answer.ok, false);
  assert.equal(answer.error, "This panel was a no-show, so there is nothing to note.");
  assert.equal(h.writes().length, 0);
});

test("on a database where 038 never ran the save refuses in the file's own words and sends nothing", async () => {
  const h = harness({ errors: { interview_notes: missingTable } });
  const answer = await h.saveNotes({ body: "Asked about the gap." });

  assert.equal(answer.ok, false);
  assert.equal(answer.error, NOTES_WRITE_REFUSAL);
  assert.match(answer.error, /038_interview_notes\.sql/);
  assert.equal(h.writes().length, 0);
  assert.equal(h.trail.length, 0);
});

test("a second writer's insert meets the primary key and is told to reopen", async () => {
  const h = harness({
    late: { table: "interview_notes", row: note("me", "the row that arrived after the read", PAST) },
  });
  const answer = await h.saveNotes({ body: "my words" });

  assert.equal(answer.ok, false);
  assert.match(answer.error, /already have notes on this panel/i);
  assert.equal(h.state.tables.interview_notes.length, 1);
});

test("a stored note is capped at the same 4,000 characters the box uses", async () => {
  const h = harness();
  const answer = await h.saveNotes({ body: "x".repeat(NOTES_BODY_LIMIT + 1) });

  assert.equal(answer.ok, false);
  assert.match(answer.error, new RegExp(String(NOTES_BODY_LIMIT)));
  assert.equal(h.writes().length, 0);
  assert.equal(NOTES_BODY_LIMIT, 4000);
});

test("the write's argument copy says whose note it is and what a blank does", () => {
  const h = harness();
  assert.match(h.saveTool().description, /signed-in recruiter/i);
  assert.match(h.saveTool().description, /empty `body` clears/i);
  assert.match(h.saveTool().description, /038_interview_notes\.sql/);
  assert.match(h.saveTool().args.body, /empty string clears/i);
});

// ---------------------------------------------------------------------------
// 3. Approval and wiring
// ---------------------------------------------------------------------------

test("the notes read runs without a click and the notes write waits for one", () => {
  // `READ_ONLY_TOOLS` is an exception list: a tool not named there is treated as
  // a write. The read belongs on it; the write must never be.
  const tools = read(TOOLS);
  assert.match(tools, /"read_interview_notes"/);
  assert.doesNotMatch(tools, /"save_interview_notes"/);
});

test("both tools reach the registry through the assistant's one seam", () => {
  const sources = read("src/modules/assistant/application/sources.ts");
  assert.match(sources, /getInterviewNotesForPanel/);
  assert.match(sources, /saveInterviewNotes/);
  assert.match(sources, /@\/app\/\(admin\)\/interviews\/notes-actions/);

  const shared = read("src/modules/assistant/domain/registry/shared.ts");
  assert.match(shared, /export \{ getInterviewNotesForPanel \};/);
  assert.match(shared, /export \{ saveInterviewNotes \};/);
  assert.match(shared, /export \{ clipNoteBody \};/);
});

test("the agenda link opens the half of the calendar the panel sits in", () => {
  const h = harness();

  assert.deepEqual(plain(h.linkFor("read_interview_notes", {}, { ok: true, scheduled_at: PAST })), {
    href: "/interviews?range=past",
    label: "Open the interview agenda",
  });
  assert.deepEqual(plain(h.linkFor("read_interview_notes", {}, { ok: true, scheduled_at: FUTURE })), {
    href: "/interviews?range=upcoming",
    label: "Open the interview agenda",
  });
  // The write reports the slot under the action's own camelCase key.
  assert.deepEqual(plain(h.linkFor("save_interview_notes", {}, { ok: true, scheduledAt: PAST })), {
    href: "/interviews?range=past",
    label: "Open the interview agenda",
  });
  // A refusal names no slot, so it opens the plain agenda rather than a filter.
  assert.deepEqual(plain(h.linkFor("save_interview_notes", {}, { ok: false, error: "refused" })), {
    href: "/interviews",
    label: "Open the interview agenda",
  });
});
