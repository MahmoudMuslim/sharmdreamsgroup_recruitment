/* scripts/prove-interview-notes-actions.mjs
 * Run: node --test scripts/prove-interview-notes-actions.mjs
 *
 * `src/modules/interviews/domain/interviewNotes.ts` says what a note may contain.
 * This file runs the two pieces of production code that touch the database —
 * `src/modules/interviews/infrastructure/notesReader.ts` and
 * `src/app/(admin)/interviews/notes-actions.ts` — against a synthetic REST client
 * that records every request, so what is asserted is the bytes a save puts on the
 * wire and the sentence a failure prints, not the shape of the source.
 *
 * The rule this exists for is authorship. `scripts/prove-interview-notes.mjs` hands
 * it over deliberately: a note is only ever the writer's own, and the only person
 * who decides whose note a save touches is the session. So the tests below send a
 * browser that lies about its author and check that the row still comes out owned
 * by the signed-in profile; they check a clear reaches one row and not the other
 * interviewer's; and they check the same bound on the wire for the update, not only
 * in the RLS policy nobody is executing here.
 *
 * `db/migrations/038_interview_notes.sql` is APPLIED on this local database, so the
 * table behind these files exists here. The other case is still the second thing to
 * prove: on a database where that file has never run, a missing table must cost the
 * notes and nothing else. So the tests check the
 * refusal names the file, that a refusal writes nothing, that a failure which is NOT
 * a missing table is not dressed up as one, and that the read downgrades to an empty
 * layer with a note instead of throwing at the page render.
 *
 * Both files are transpiled to CommonJS and run in a fresh context whose only outside
 * calls are the stubs below — no database, session, permission table or provider is
 * touched. The domain module is the real one.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

import * as interviewNotesDomain from "../src/modules/interviews/domain/interviewNotes.ts";
import * as scorecardDomain from "../src/modules/interviews/domain/interviewScorecard.ts";
import {
  NOTES_SCHEMA_NOTE,
  NOTES_WRITE_REFUSAL,
} from "../src/modules/interviews/domain/interviewNotes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The values the action and the reader build live in a `vm` context, so their objects
 * carry that realm's `Object.prototype` and `assert.deepEqual` refuses them as not
 * reference-equal to a literal written here. Round-tripping through JSON compares the
 * data a recruiter receives, which is the thing under test.
 */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const compile = (rel) =>
  ts.transpileModule(readFileSync(path.join(root, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

const READER_SOURCE = "src/modules/interviews/infrastructure/notesReader.ts";
const ACTION_SOURCE = "src/app/(admin)/interviews/notes-actions.ts";

const panel = "30000000-0000-4000-8000-000000000001";
const otherPanel = "30000000-0000-4000-8000-000000000002";
const me = "40000000-0000-4000-8000-000000000001";
const them = "40000000-0000-4000-8000-000000000002";

const missingTable = { code: "42P01", message: 'relation "public.interview_notes" does not exist' };
const transportFailure = { code: null, message: "the API did not answer" };

function tables(options = {}) {
  return {
    interview_schedules: [
      {
        id: panel,
        application_id: "50000000-0000-4000-8000-000000000001",
        status: "COMPLETED",
        scheduled_at: "2026-06-01T08:00:00.000Z",
        applications: { full_name: "Rana Haddad" },
      },
      {
        id: otherPanel,
        application_id: "50000000-0000-4000-8000-000000000002",
        status: "SCHEDULED",
        scheduled_at: "2026-06-08T08:00:00.000Z",
        applications: { full_name: "Omar Saleh" },
      },
    ],
    interview_notes: [],
    ...options.tables,
  };
}

/**
 * A REST client that answers from fixtures and remembers what was asked.
 *
 * `errors` injects a failure on a table's reads; `writeError` injects one on its
 * writes — which is how a save that stopped at the first read is separated from one
 * that got a row on the wire. Inserts, patches and deletes mutate the fixtures, so a
 * test can ask what the table looks like afterwards instead of only what was sent.
 */
function makeClient(remembered, state) {
  const client = {
    from(table) {
      const request = { table, method: "GET", select: null, operations: [], body: null, limit: null };
      remembered.push(request);
      const builder = {
        select(columns) {
          request.select = columns;
          return this;
        },
        eq(column, value) {
          request.operations.push(["eq", column, value]);
          return this;
        },
        in(column, value) {
          request.operations.push(["in", column, value]);
          return this;
        },
        order(column) {
          request.operations.push(["order", column]);
          return this;
        },
        limit(value) {
          request.limit = value;
          return this;
        },
        maybeSingle() {
          request.single = true;
          return this;
        },
        single() {
          request.single = true;
          return this;
        },
        insert(values) {
          request.method = "POST";
          request.body = values;
          return this;
        },
        update(values) {
          request.method = "PATCH";
          request.body = values;
          return this;
        },
        delete() {
          request.method = "DELETE";
          return this;
        },
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
            if (read && state.late && !state.lateApplied && table === state.late.table) {
              // The row arrives after this answer, which is the whole point: the
              // action's read finds nothing and its insert then meets a key pair
              // that already exists. A second tab or a double click is not a
              // theory here, it is the one race the composite key decides.
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
                // The wire's answer to the primary key (interview_id,
                // author_profile_id): the second writer is refused, not merged.
                const clashes = (row) =>
                  (state.tables[table] ?? []).some(
                    (held) =>
                      held.interview_id === row.interview_id &&
                      held.author_profile_id === row.author_profile_id
                  );
                const conflict = incoming.find(clashes);
                if (conflict) {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        "duplicate key value violates unique constraint \"interview_notes_pkey\"",
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
 * Runs the real action and the real reader over one synthetic database.
 *
 * The action's import of the reader is wired to the reader's own exports, so a save
 * exercises the same code the agenda page uses instead of a paraphrase of it. The
 * session profile is `me` and every call below is made as that person.
 */
function harness(options = {}) {
  const queries = [];
  const trail = [];
  const revalidated = [];
  const checks = [];
  const state = {
    tables: tables(options),
    errors: options.errors,
    writeError: options.writeError,
    late: options.late,
    lateApplied: false,
  };
  const client = makeClient(queries, state);

  const rest = { createServerRestClient: async () => client };
  const session = {
    requireStaff: async (route) => {
      checks.push(route);
      if (options.unauthenticated) throw new Error("login redirect");
      return { profileId: me, id: "staff-1" };
    },
  };
  const cache = { revalidatePath: (route) => revalidated.push(route) };
  const activity = {
    recordActivity: async (entry) => {
      trail.push(entry);
      return { ok: true };
    },
  };
  const timezone = { formatInZone: () => "01 Jun 2026, 10:00" };
  const settings = { getOrganisationTimeZone: async () => "Asia/Dubai" };

  const reader = {};
  new Script(compile(READER_SOURCE)).runInNewContext(
    {
      exports: reader,
      require: (name) => {
        if (name === "server-only") return {};
        if (name === "@/lib/data-api/server") return rest;
        if (name === "@/modules/interviews/domain/interviewNotes") return interviewNotesDomain;
        if (name === "@/modules/interviews/domain/interviewScorecard") return scorecardDomain;
        throw new Error(`Unmocked boundary in the reader: ${name}`);
      },
    },
    { timeout: 5000 }
  );

  const action = {};
  new Script(compile(ACTION_SOURCE)).runInNewContext(
    {
      exports: action,
      require: (name) => {
        if (name === "next/cache") return cache;
        if (name === "@/lib/data-api/server") return rest;
        if (name === "@/lib/auth/session") return session;
        if (name === "@/lib/timezone") return timezone;
        if (name === "@/modules/settings/infrastructure/settingsReader") return settings;
        if (name === "@/modules/activity/application/record") return activity;
        if (name === "@/modules/interviews/domain/interviewNotes") return interviewNotesDomain;
        if (name === "@/modules/interviews/domain/interviewScorecard") return scorecardDomain;
        if (name === "@/modules/interviews/infrastructure/notesReader") return reader;
        throw new Error(`Unmocked boundary in the action: ${name}`);
      },
    },
    { timeout: 5000 }
  );

  return {
    save: (input) => action.saveInterviewNotes(input),
    saveGuide: (input) => action.saveInterviewGuideInNotes(input),
    layer: (ids) => action.getInterviewNotesLayer(ids),
    readLayer: (ids) => reader.readInterviewNotesLayer(client, ids),
    queries,
    trail,
    revalidated,
    checks,
    state,
    writes: () => queries.filter((request) => request.method !== "GET"),
    notesTable: () => state.tables.interview_notes,
  };
}

// ---------------------------------------------------------------------------
// 1. The door: who is asked first, and what stops before a query
// ---------------------------------------------------------------------------

test("a staff session is required before the notes table is touched", async () => {
  const h = harness({ unauthenticated: true });
  await assert.rejects(h.save({ interviewId: panel, body: "asked about tenure" }), /login redirect/);
  assert.equal(h.queries.length, 0);
});

test("the agenda's staff door is the one the layer read stands on", async () => {
  const h = harness();
  await h.layer([panel]);
  assert.ok(h.checks.includes("/interviews"));
});

test("a body longer than the limit is refused before anything is read", async () => {
  const h = harness();
  const result = await h.save({ interviewId: panel, body: "x".repeat(4001) });
  assert.equal(result.ok, false);
  assert.match(result.error, /4,?000/);
  assert.equal(h.queries.length, 0);
  assert.equal(h.writes().length, 0);
});

test("a panel that is not on the schedule is named, not called unnoted", async () => {
  const h = harness();
  const result = await h.save({
    interviewId: "00000000-0000-4000-8000-000000000009",
    body: "asked about tenure",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /panel|interview/i);
  assert.match(result.error, /exist/i);
  assert.equal(h.writes().length, 0);
});

for (const [status, expected] of [
  ["CANCELLED", /cancel/i],
  ["NO_SHOW", /no-show/i],
]) {
  test(`a ${status.toLowerCase()} panel is refused without a word written`, async () => {
    const h = harness({
      tables: {
        interview_schedules: [
          {
            id: panel,
            application_id: "50000000-0000-4000-8000-000000000001",
            status,
            scheduled_at: "2026-06-01T08:00:00.000Z",
            applications: { full_name: "Rana Haddad" },
          },
        ],
        interview_notes: [],
      },
    });
    const result = await h.save({ interviewId: panel, body: "asked about tenure" });
    assert.equal(result.ok, false);
    assert.match(result.error, expected);
    assert.equal(h.writes().length, 0);
    assert.equal(h.trail.length, 0);
  });
}

// ---------------------------------------------------------------------------
// 2. Authorship: the session decides whose note a save touches
// ---------------------------------------------------------------------------

test("the row is owned by the session, whatever the browser sent", async () => {
  const h = harness();
  const result = await h.save({
    interviewId: panel,
    authorProfileId: them,
    body: "asked about tenure",
  });
  assert.equal(result.ok, true, result.error);
  const insert = h.writes().find((request) => request.method === "POST");
  assert.ok(insert, "the save inserted a row");
  assert.equal(insert.body.author_profile_id, me);
});

test("an existing note is changed through the author's own key pair", async () => {
  const h = harness({
    tables: {
      interview_schedules: tables().interview_schedules,
      interview_notes: [
        {
          interview_id: panel,
          author_profile_id: me,
          body: "first draft",
          created_at: "2026-06-02T09:00:00.000Z",
          updated_at: "2026-06-02T09:00:00.000Z",
        },
      ],
    },
  });
  const result = await h.save({ interviewId: panel, body: "second draft" });
  assert.equal(result.ok, true, result.error);
  const patch = h.writes().find((request) => request.method === "PATCH");
  assert.ok(patch, "the save updated the row instead of inserting a second one");
  const scoped = patch.operations.filter(([, column]) => column === "author_profile_id");
  assert.deepEqual(
    plain(scoped.map(([, , value]) => value)),
    [me]
  );
  assert.equal(h.notesTable().length, 1);
  assert.equal(h.notesTable()[0].body, "second draft");
});

test("one interviewer's edit never reaches another's row", async () => {
  const h = harness({
    tables: {
      interview_schedules: tables().interview_schedules,
      interview_notes: [
        {
          interview_id: panel,
          author_profile_id: me,
          body: "first draft",
          created_at: "2026-06-02T09:00:00.000Z",
          updated_at: "2026-06-02T09:00:00.000Z",
        },
        {
          interview_id: panel,
          author_profile_id: them,
          body: "the other interviewer's account",
          created_at: "2026-06-02T09:30:00.000Z",
          updated_at: "2026-06-02T09:30:00.000Z",
        },
      ],
    },
  });
  await h.save({ interviewId: panel, body: "my own words" });
  const theirs = h.notesTable().find((row) => row.author_profile_id === them);
  assert.equal(theirs.body, "the other interviewer's account");
});

test("a blank clears the author's own row and leaves the panel's other notes", async () => {
  const h = harness({
    tables: {
      interview_schedules: tables().interview_schedules,
      interview_notes: [
        {
          interview_id: panel,
          author_profile_id: me,
          body: "written while it was happening",
          created_at: "2026-06-02T09:00:00.000Z",
          updated_at: "2026-06-02T09:00:00.000Z",
        },
        {
          interview_id: panel,
          author_profile_id: them,
          body: "the other interviewer's account",
          created_at: "2026-06-02T09:30:00.000Z",
          updated_at: "2026-06-02T09:30:00.000Z",
        },
      ],
    },
  });
  const result = await h.save({ interviewId: panel, body: "   " });
  assert.equal(result.ok, true, result.error);
  const del = h.writes().find((request) => request.method === "DELETE");
  assert.ok(del, "a blank deleted the row rather than storing an empty one");
  assert.deepEqual(
    plain(del.operations.filter(([, column]) => column === "author_profile_id").map(([, , value]) => value)),
    [me]
  );
  assert.deepEqual(
    plain(h.notesTable().map((row) => row.author_profile_id)),
    [them]
  );
});

test("a blank from someone who never wrote is not a save", async () => {
  const h = harness();
  const result = await h.save({ interviewId: panel, body: "" });
  assert.equal(result.ok, true, result.error);
  assert.equal(h.writes().length, 0);
  assert.equal(h.trail.length, 0);
});

// ---------------------------------------------------------------------------
// 3. On a database where 038 never ran: the missing table costs the notes and nothing else
// ---------------------------------------------------------------------------

test("a missing table on the read is a refusal that names the file, with no write", async () => {
  const h = harness({ errors: { interview_notes: missingTable } });
  const result = await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.equal(result.ok, false);
  assert.equal(result.error, NOTES_WRITE_REFUSAL);
  assert.match(result.error, /038_interview_notes\.sql/);
  assert.equal(h.writes().length, 0);
});

test("a missing table on the write is the same refusal", async () => {
  const h = harness({ writeError: { interview_notes: missingTable } });
  const result = await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.equal(result.ok, false);
  assert.equal(result.error, NOTES_WRITE_REFUSAL);
});

test("a failure that is not a missing table is not dressed up as one", async () => {
  const h = harness({ errors: { interview_notes: transportFailure } });
  const result = await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /038_interview_notes\.sql/);
  assert.match(result.error, /did not answer/);
});

test("the same save twice does not put a second row on the table", async () => {
  const h = harness();
  const first = await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.equal(first.ok, true, first.error);
  const second = await h.save({ interviewId: panel, body: "asked about tenure and left early" });
  assert.equal(second.ok, true, second.error);
  assert.equal(h.notesTable().length, 1);
  assert.equal(h.notesTable()[0].body, "asked about tenure and left early");
});

test("a note that arrived between the read and the insert is not written twice", async () => {
  const h = harness({
    late: {
      table: "interview_notes",
      row: {
        interview_id: panel,
        author_profile_id: me,
        body: "typed in the other tab",
        created_at: "2026-06-02T09:00:00.000Z",
        updated_at: "2026-06-02T09:00:00.000Z",
      },
    },
  });
  const result = await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.equal(result.ok, false);
  assert.match(result.error, /already have notes/i);
  assert.equal(h.notesTable().length, 1);
  assert.equal(h.notesTable()[0].body, "typed in the other tab");
  assert.equal(h.trail.length, 0);
});

// ---------------------------------------------------------------------------
// 4. What the page is handed
// ---------------------------------------------------------------------------

test("rows become notes with the author's name beside them", async () => {
  const h = harness({
    tables: {
      interview_schedules: tables().interview_schedules,
      interview_notes: [
        {
          interview_id: panel,
          author_profile_id: me,
          body: "asked about tenure",
          created_at: "2026-06-02T09:00:00.000Z",
          updated_at: "2026-06-02T09:00:00.000Z",
          user_profiles: { full_name: "Mahmoud Muslim" },
        },
      ],
    },
  });
  const layer = plain(await h.layer([panel]));
  assert.equal(layer.available, true);
  assert.equal(layer.note, null);
  assert.equal(layer.notes.length, 1);
  assert.equal(layer.notes[0].interviewId, panel);
  assert.equal(layer.notes[0].authorProfileId, me);
  assert.equal(layer.notes[0].authorName, "Mahmoud Muslim");
  assert.equal(layer.notes[0].body, "asked about tenure");
});

test("an unapplied table empties the layer and names the file", async () => {
  const h = harness({ errors: { interview_notes: missingTable } });
  const layer = plain(await h.layer([panel]));
  assert.equal(layer.available, false);
  assert.equal(layer.notes.length, 0);
  assert.equal(layer.note, NOTES_SCHEMA_NOTE);
  assert.match(layer.note, /038_interview_notes\.sql/);
});

test("an empty week still asks the table whether it exists", async () => {
  const h = harness({ errors: { interview_notes: missingTable } });
  const layer = plain(await h.layer([]));
  assert.equal(layer.available, false);
  assert.match(layer.note, /038_interview_notes\.sql/);
  const probe = h.queries.find((request) => request.table === "interview_notes");
  assert.equal(probe.limit, 1);
  assert.equal(probe.operations.length, 0);
});

test("the read asks for the author's name in the same select", async () => {
  const h = harness();
  await h.layer([panel]);
  const request = h.queries.find((query) => query.table === "interview_notes");
  assert.match(request.select, /author_profile_id/);
  assert.match(request.select, /user_profiles/);
});

// ---------------------------------------------------------------------------
// 6. Saving the generated guide into the interviewer's own note
//
// The guide is the model's draft and the note is the person's account, so the one
// rule this door has to hold is that the two arrive in the right order with the
// draft labelled. `prove-interview-notes.mjs` owns the formatting and the overflow
// arithmetic; what is proved here is that the action reaches the writer with the
// same heading the domain prints, and that a guide which does not fit is refused
// before a row is touched.
// ---------------------------------------------------------------------------

const GUIDE = [
  { question: "Why did you leave the last role?", rationale: "Tests tenure intent", skill_probed: "Team leadership" },
  { question: "Walk me through a budget you owned." },
];

test("the guide is refused before the panel is read when there is nothing to save", async () => {
  const h = harness();
  const result = await h.saveGuide({ interviewId: panel, questions: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /no questions/i);
  assert.equal(h.queries.length, 0);
});

test("the guide reaches the row with the model labelled as its author", async () => {
  const h = harness();
  const result = await h.saveGuide({ interviewId: panel, questions: GUIDE });
  assert.equal(result.ok, true, result.error);
  const insert = h.writes().find((request) => request.method === "POST");
  assert.match(insert.body.body, /drafted by the model/i);
  assert.match(insert.body.body, /Why did you leave the last role\?/);
  assert.match(insert.body.body, /Team leadership/);
  assert.equal(insert.body.author_profile_id, me);
});

test("a guide joins the author's own words without replacing them", async () => {
  const h = harness({
    tables: {
      interview_schedules: tables().interview_schedules,
      interview_notes: [
        {
          interview_id: panel,
          author_profile_id: me,
          body: "She talked me through three budgets.",
          created_at: "2026-06-02T09:00:00.000Z",
          updated_at: "2026-06-02T09:00:00.000Z",
        },
      ],
    },
  });
  const result = await h.saveGuide({ interviewId: panel, questions: GUIDE });
  assert.equal(result.ok, true, result.error);
  const patch = h.writes().find((request) => request.method === "PATCH");
  assert.ok(patch, "the author's own row was updated");
  assert.equal(patch.body.body.startsWith("She talked me through three budgets."), true);
  assert.equal(h.notesTable()[0].body.startsWith("She talked me through three budgets."), true);
});

test("a guide that does not fit leaves the note exactly as it was", async () => {
  const long = [{ question: "x".repeat(3990) }];
  const h = harness({
    tables: {
      interview_schedules: tables().interview_schedules,
      interview_notes: [
        {
          interview_id: panel,
          author_profile_id: me,
          body: "y".repeat(300),
          created_at: "2026-06-02T09:00:00.000Z",
          updated_at: "2026-06-02T09:00:00.000Z",
        },
      ],
    },
  });
  const result = await h.saveGuide({ interviewId: panel, questions: long });
  assert.equal(result.ok, false);
  assert.match(result.error, /characters left/);
  assert.equal(h.writes().length, 0);
  assert.equal(h.notesTable()[0].body, "y".repeat(300));
});

test("a guide onto a cancelled panel is refused with the panel's own words", async () => {
  const h = harness({
    tables: {
      interview_schedules: [
        {
          id: panel,
          application_id: "50000000-0000-4000-8000-000000000001",
          status: "CANCELLED",
          scheduled_at: "2026-06-01T08:00:00.000Z",
          applications: { full_name: "Rana Haddad" },
        },
      ],
      interview_notes: [],
    },
  });
  const result = await h.saveGuide({ interviewId: panel, questions: GUIDE });
  assert.equal(result.ok, false);
  assert.match(result.error, /cancel/i);
  assert.equal(h.writes().length, 0);
});

test("a guide onto a database with no notes table says so and names the file", async () => {
  const h = harness({ errors: { interview_notes: missingTable } });
  const result = await h.saveGuide({ interviewId: panel, questions: GUIDE });
  assert.equal(result.ok, false);
  assert.equal(result.error, NOTES_WRITE_REFUSAL);
  assert.equal(h.writes().length, 0);
});

test("the guide says so on the trail, with the count it put in", async () => {
  const h = harness();
  await h.saveGuide({ interviewId: panel, questions: GUIDE });
  assert.equal(h.trail.length, 1);
  assert.equal(h.trail[0].action, "interview_notes");
  assert.match(h.trail[0].summary, /guide/i);
  assert.equal(h.trail[0].detail.guide_questions, GUIDE.length);
});


test("a save puts one line on the trail that says who and which panel", async () => {
  const h = harness();
  await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.equal(h.trail.length, 1);
  const entry = h.trail[0];
  assert.equal(entry.area, "interviews");
  assert.equal(entry.action, "interview_notes");
  assert.equal(entry.entity, "interview");
  assert.equal(entry.entityId, panel);
  assert.match(entry.summary, /Rana Haddad/);
  assert.match(entry.summary, /01 Jun 2026/);
  assert.equal(entry.detail.application_id, "50000000-0000-4000-8000-000000000001");
  assert.equal(entry.detail.interview_status, "COMPLETED");
  assert.equal(entry.detail.edited, false);
});

test("a second save says it changed a note, and a clear says it removed one", async () => {
  const h = harness();
  await h.save({ interviewId: panel, body: "asked about tenure" });
  await h.save({ interviewId: panel, body: "asked about tenure, then about budget" });
  await h.save({ interviewId: panel, body: "" });
  assert.equal(h.trail.length, 3);
  assert.match(h.trail[0].summary, /wrote/i);
  assert.equal(h.trail[0].detail.edited, false);
  assert.match(h.trail[1].summary, /updated|changed/i);
  assert.equal(h.trail[1].detail.edited, true);
  assert.match(h.trail[2].summary, /removed|cleared/i);
  assert.equal(h.trail[2].detail.cleared, true);
});

test("a refused save leaves nothing on the trail and revalidates nothing", async () => {
  const h = harness({ writeError: { interview_notes: missingTable } });
  await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.equal(h.trail.length, 0);
  assert.deepEqual(plain(h.revalidated), []);
});

test("a save refreshes the agenda and the candidate page that shows the same panel", async () => {
  const h = harness();
  await h.save({ interviewId: panel, body: "asked about tenure" });
  assert.ok(h.revalidated.includes("/interviews"));
  assert.ok(h.revalidated.includes("/candidates"));
});
