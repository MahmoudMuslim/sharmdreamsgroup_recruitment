/* scripts/prove-export-audit.mjs
 * Run: node --test scripts/prove-export-audit.mjs
 *
 * A report that leaves the building should leave a record of itself. Three doors
 * hand out files — the reports route, the time ledger, and the change trail — and
 * every one of them writes a trail row before the bytes are sent. The rules below
 * are proved against the pure builder, plus a static read of the three routes
 * that have to call it.
 *
 *   1. a download is a disclosure, not a change, so it gets its own area and its
 *      own entity rather than hiding among the record edits it describes.
 *   2. the row names the file, the format, how many lines it carried and whether
 *      the score columns were masked for the account that asked. The figures are
 *      read off the document itself — a route that retypes them is a route that
 *      can lie about what it sent.
 *   3. free text never rides along. The search box and the filter bag can both be
 *      pointed at one named applicant, and the trail is read by more roles and
 *      kept longer than the screen the text was typed into. Only enum values and
 *      flags reach the row, and a filter that had to be dropped is counted.
 *   4. nothing is hidden from the row that the file itself says it left out: a
 *      trimmed download declares itself in the audit as it does in its footer.
 *   5. no file without a record. If the trail refuses the row, the door refuses
 *      the download — an audit that only works when the database feels like it is
 *      a log, not a gate.
 *   6. contact details are behind the gate that already guards them on screen.
 *      `analytics.export` opens the door; the email, phone and recipient columns
 *      ride out only with the account's View candidates permission. The file says
 *      in its own caveats which way it went, the row says it too, and the row's
 *      claim is checked against the columns the document actually carries — the
 *      file is the evidence of what left, not the route's memory of it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ACTIVITY_AREAS,
  ACTIVITY_ENTITIES,
  ACTIVITY_LIMITS,
  isActivityArea,
  redactDetail,
} from "../src/modules/activity/domain/trail.ts";

const MODULE = "../src/modules/activity/domain/exportTrail.ts";

/* Node keeps one instance of an ESM module per resolved URL, so a file rewritten
 * on disk is still the old bytes to the next `import` — unless the import names
 * it again. The query is the only way to do that, and the mutation proofs below
 * would prove nothing without it. */
let version = 0;
const fresh = (specifier) => `${specifier}?v=${++version}`;
const load = () => import(fresh(MODULE));

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

/** The writers own the format list; this proof reads it rather than trusting it. */
const EXPORT_DOCUMENT = "src/modules/analytics/domain/exportDocument.ts";

/** Every door a file leaves the portal through. */
const ROUTES = [
  "src/app/api/reports/export/route.ts",
  "src/app/api/time/export/route.ts",
  "src/app/api/activity/export/route.ts",
];

/** The part of the document the builder reads, as a route hands it over. */
function file(over = {}) {
  return {
    title: "Candidate pipeline",
    baseName: "sharm-dreams-candidates-30d-2026-10-28",
    sheets: [{ name: "Applicants", columns: ["Name"], rows: [["Samira"], ["Rana"]] }],
    limitations: [],
    ...over,
  };
}

/** A file whose columns are somebody's contact details, with a live value in each. */
function contactFile() {
  return file({
    sheets: [
      {
        name: "Candidates",
        columns: ["Candidate", "Email", "Phone", "AI fit %"],
        rows: [["Samira", "samira@example.com", "01000000000", 81]],
      },
    ],
  });
}

function facts(over = {}) {
  return {
    door: "reports",
    format: "xlsx",
    document: file(),
    scores: "open",
    contacts: "absent",
    cut: [
      { key: "report", value: "candidates" },
      { key: "window", value: "30d" },
    ],
    ...over,
  };
}

// ————————————————————————————————————————————————————————————————————————————
// the vocabulary a disclosure needs
// ————————————————————————————————————————————————————————————————————————————

test("the trail has an area and an entity for a download", () => {
  assert.ok(isActivityArea("exports"), "“exports” must be an area the console can filter by");
  assert.ok(
    ACTIVITY_ENTITIES.includes("export"),
    "a download must name the kind of record its row points at"
  );
});

test("the new vocabulary appears once, and is not the last resort", () => {
  assert.equal(ACTIVITY_AREAS.filter((area) => area === "exports").length, 1);
  assert.equal(ACTIVITY_ENTITIES.filter((entity) => entity === "export").length, 1);
  // The areas feed a dropdown in insertion order, so the new one has to be a
  // choice of its own rather than glued onto the “system” bucket nobody filters.
  const at = ACTIVITY_AREAS.indexOf("exports");
  assert.ok(at > -1 && at < ACTIVITY_AREAS.indexOf("system"));
});

// ————————————————————————————————————————————————————————————————————————————
// what the row says
// ————————————————————————————————————————————————————————————————————————————

test("a row names the file, the format and the door it left through", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(facts());

  assert.equal(entry.area, "exports");
  assert.equal(entry.entity, "export");
  assert.equal(entry.action, "export_download");
  // There is no record to point back at: an audit row is not a bookmark.
  assert.equal(entry.entityId ?? null, null);
  assert.match(entry.summary, /“Candidate pipeline”/);
  assert.match(entry.summary, /Excel/);
  assert.equal(entry.detail.door, "reports");
  assert.equal(entry.detail.format, "xlsx");
  assert.match(entry.detail.file, /^sharm-dreams-candidates-30d-2026-10-28\.xlsx$/);
});

test("the three doors are a closed list", async () => {
  const { EXPORT_DOORS } = await load();
  assert.deepEqual([...EXPORT_DOORS], ["reports", "time", "trail"]);
});

test("the format labels cover exactly the formats the writers know", async () => {
  const { EXPORT_FORMAT_LABELS } = await load();
  const source = read(EXPORT_DOCUMENT);
  const known = [...source.matchAll(/key: "([a-z]+)", label: "/g)].map((match) => match[1]);
  assert.deepEqual(known, ["csv", "xlsx", "pdf"], "the writers list moved; this proof did not");
  assert.deepEqual(Object.keys(EXPORT_FORMAT_LABELS).sort(), [...known].sort());
});

test("the size of a download is counted off the document, not typed by the route", async () => {
  const { exportTrailEntry, exportFileRows } = await load();
  const entry = exportTrailEntry(
    facts({
      document: file({
        sheets: [
          { name: "Summary", columns: ["Metric"], rows: [["New"], ["Hired"]] },
          { name: "Applicants", columns: ["Name"], rows: [["Samira"], ["Rana"], ["Tarek"]] },
        ],
      }),
    })
  );
  assert.equal(entry.detail.rows, 5);
  assert.equal(entry.detail.sheets, 2);
  assert.match(entry.summary, /5 rows in 2 tables/);
  assert.equal(exportFileRows(file()), 2);

  const one = exportTrailEntry(
    facts({ document: file({ sheets: [{ name: "One", columns: [], rows: [["x"]] }] }) })
  );
  assert.match(one.summary, /1 row in 1 table/);
});

test("an empty file is still a download, and says it was empty", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(facts({ document: file({ sheets: [] }) }));
  assert.equal(entry.detail.rows, 0);
  assert.match(entry.summary, /no rows/);
});

test("a masked copy and an open copy are both said out loud", async () => {
  const { exportTrailEntry } = await load();
  const masked = exportTrailEntry(facts({ scores: "masked" }));
  const open = exportTrailEntry(facts({ scores: "open" }));

  assert.equal(masked.detail.scores, "masked");
  assert.equal(open.detail.scores, "open");
  assert.match(masked.summary, /withheld from this account/);
  assert.match(open.summary, /unmasked/);
  assert.doesNotMatch(open.summary, /withheld/);
  assert.doesNotMatch(masked.summary, /unmasked/);
});

test("a file that holds no scores at all claims nothing about masking", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(facts({ door: "time", scores: "absent" }));
  assert.equal(entry.detail.scores, "absent");
  assert.doesNotMatch(entry.summary, /withheld|unmasked/);
});

test("a file that admits it was trimmed says so in the audit too", async () => {
  const { exportTrailEntry } = await load();
  const trimmed = exportTrailEntry(
    facts({ document: file({ limitations: ["The newest 200 of 640 rows are here."] }) })
  );
  const whole = exportTrailEntry(facts());

  assert.equal(trimmed.detail.declared_limits, 1);
  assert.match(trimmed.summary, /notes what it left out/);
  assert.equal(whole.detail.declared_limits, 0);
  assert.doesNotMatch(whole.summary, /notes what it left out/);
});

// ————————————————————————————————————————————————————————————————————————————
// what must never reach the row
// ————————————————————————————————————————————————————————————————————————————

test("free text is dropped from the cut and the drop is counted", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(
    facts({
      cut: [
        { key: "stage", value: "NEW" },
        { key: "archived", value: false },
        { key: "q", value: "mohamed ahmed" },
        { key: "query", value: "01000000000" },
        { key: "search", value: "pass=1234" },
        { key: "company", value: "A".repeat(200) },
      ],
    })
  );
  assert.equal(entry.detail.cut, "stage: NEW · archived: no");
  assert.equal(entry.detail.cut_kept, 2);
  assert.equal(entry.detail.cut_dropped, 4);
  const written = JSON.stringify(entry.detail);
  for (const forbidden of ["mohamed", "01000000000", "pass=1234"]) {
    assert.equal(written.includes(forbidden), false, `${forbidden} must never be stored`);
  }
});

test("the cut is clamped to what the trail stores, and still counts itself truly", async () => {
  const { exportTrailEntry } = await load();
  // Every value here is a shape the trail accepts (a code, an enum, a uuid); the
  // words simply run past the column, and the count must survive the clamp.
  const entry = exportTrailEntry(
    facts({
      cut: Array.from({ length: 40 }, (_, index) => ({ key: `filter_${index}`, value: "x".repeat(36) })),
    })
  );
  assert.ok(
    entry.detail.cut.length <= ACTIVITY_LIMITS.detailValue,
    `the words of the cut ran to ${entry.detail.cut.length} chars`
  );
  assert.match(entry.detail.cut, /…$/);
  // The count is the truth even where the words were cut short.
  assert.equal(entry.detail.cut_kept, 40);
});

test("no value in the row is one the trail withholds by name", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(facts({ scores: "masked" }));
  const passed = redactDetail(entry.detail);
  assert.deepEqual(passed, entry.detail, "a value the writer would redact is a value we cannot audit");
  assert.equal(Object.values(passed).includes("[withheld]"), false);
});

test("the summary stays short enough to store", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(facts({ document: file({ title: "A".repeat(600) }) }));
  assert.ok(entry.summary.length <= ACTIVITY_LIMITS.summary, `${entry.summary.length} chars`);
});

test("a document that is not shaped like one is still described, and never throws", async () => {
  const { exportTrailEntry, exportFileRows } = await load();
  assert.equal(exportFileRows({}), 0);
  assert.equal(exportFileRows(null), 0);
  const entry = exportTrailEntry({
    door: "reports",
    format: "csv",
    document: {},
    scores: "absent",
    contacts: "absent",
  });
  assert.ok(entry.summary.length > 0);
  assert.equal(entry.detail.rows, 0);
});

test("the writer, not the builder, owns who made the download", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(facts());
  // A download is the signed-in person's own click. Filling the actor from the
  // session is `recordActivity`'s job, and an entry that pre-empted it would
  // credit a machine with a person's download.
  assert.equal(entry.actorKind, undefined);
  assert.equal(entry.actorId, undefined);
  assert.equal(entry.actorLabel, undefined);
});

// ————————————————————————————————————————————————————————————————————————————
// the refusal, when the record cannot be kept
// ————————————————————————————————————————————————————————————————————————————

test("a refused record refuses the file, in words that say why", async () => {
  const { exportAuditDenied } = await load();
  const message = exportAuditDenied("value too long for column summary");
  assert.match(message, /audit record/i);
  assert.match(message, /nothing was sent/i);
  assert.match(message, /value too long for column summary/);
});

test("an absent trail table is named as the fix it is", async () => {
  const { exportAuditDenied } = await load();
  const message = exportAuditDenied('relation "activity_log" does not exist');
  assert.match(message, /024_activity_log\.sql/);
});

// ————————————————————————————————————————————————————————————————————————————
// the PII gate: which columns are contact details, and what a refusal does
// ————————————————————————————————————————————————————————————————————————————

const ACCESS_MODULE = "../src/modules/analytics/domain/sheetAccess.ts";
const loadAccess = () => import(fresh(ACCESS_MODULE));
const DOCUMENTS = "src/modules/analytics/domain/documents.ts";
const READER = "src/modules/analytics/infrastructure/reportReader.ts";

const CLOSED = { scoresHidden: true, contactsHidden: true };
const OPEN = { scoresHidden: false, contactsHidden: false };

/* Each of these is both a test and the thing a mutation below has to turn red,
 * so it is written once and named. */
const gateTakesTheColumn = async () => {
  const { columnKept } = await loadAccess();
  assert.equal(columnKept({ contacts: true }, OPEN), true, "an allowed account keeps the column");
  assert.equal(columnKept({ contacts: true }, CLOSED), false, "a refused account must not hold it");
};

test("a contact column leaves when the account may not read candidates", gateTakesTheColumn);

test("the two guards are independent — a withheld score is not a hidden phone", async () => {
  const { columnKept } = await loadAccess();
  assert.equal(columnKept({ masked: true }, { scoresHidden: false, contactsHidden: true }), true);
  assert.equal(columnKept({ contacts: true }, { scoresHidden: true, contactsHidden: false }), true);
  assert.equal(columnKept({ masked: true }, CLOSED), false);
});

test("a column nobody guarded never leaves, however closed the account is", async () => {
  const { columnKept } = await loadAccess();
  /* The name and the stage are what make a row readable at all. A gate that took
   * unguarded columns too would hand the recruiter an empty grid and call it a
   * privacy fix — and the audit row would say the file was delivered. */
  assert.equal(columnKept({}, CLOSED), true);
  assert.equal(columnKept({ masked: false, contacts: false }, CLOSED), true);
});

const caveatsSayWhatWasTaken = async () => {
  const { accessNotes } = await loadAccess();
  const notes = accessNotes({ scoresHidden: false, contactsHidden: true }, "this file");
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Contact details are left out of this file/);
  assert.match(notes[0], /View candidates/, "a refusal has to name the permission it needs");

  const both = accessNotes(CLOSED, "this report");
  assert.equal(both.length, 2);
  assert.match(both[0], /^Score columns are left out of this report/);
  assert.match(both[1], /^Contact details are left out of this report/);

  // Nothing taken, nothing claimed: a note about columns nobody withheld reads
  // to the receiver as an apology for a refusal that never happened.
  assert.deepEqual(accessNotes(OPEN, "this file"), []);
};

test("a file says in its own caveats what the gate took from it", caveatsSayWhatWasTaken);

const headersAreTheOnesTheGateKnows = async () => {
  const { CONTACT_HEADERS } = await loadAccess();
  const written = [...read(DOCUMENTS).matchAll(/\{ header: "(Email|Phone|Recipient)",[^}]*\}/g)];
  // Three emails, two phones and one recipient: the applications list, the
  // prospect pool, the outbox and the candidates console. The count is pinned as
  // well as the set — a fifth contact column this pattern cannot see is a column
  // that would leave the building ungated and unmentioned.
  assert.equal(written.length, 6, `the builders wrote ${written.length} contact columns`);
  for (const match of written) {
    assert.match(match[0], /contacts: true/, `“${match[1]}” is exported without the gate`);
  }
  assert.deepEqual(
    [...CONTACT_HEADERS].sort(),
    [...new Set(written.map((match) => match[1]))].sort(),
    "the gate's list and the builders' headers have drifted apart"
  );
};

test(
  "the contact headers the gate knows are exactly the headers the builders write",
  headersAreTheOnesTheGateKnows
);

test("no blurb promises a contact column the gate may have taken", () => {
  /* The blurb is the first line a receiver reads and it outlives the screen the
   * file was downloaded from. One that says "recipient" or "contact details"
   * tells an account with no candidates permission that its file has them, and
   * the empty column then reads as a bug rather than as a refusal. Either the
   * word goes, or the blurb names the permission that buys it. */
  const CONTACT_WORDS = /contact details|recipient|e-?mail|phone/i;
  for (const match of read(DOCUMENTS).matchAll(/blurb:\s*\n?\s*"([^"]+)"/g)) {
    if (!CONTACT_WORDS.test(match[1])) continue;
    assert.match(
      match[1],
      /View candidates/,
      `a file says it carries “${match[1].slice(0, 48)}…” for accounts the gate refuses`
    );
  }
});

const readerAsksForItsGate = () => {
  const source = read(READER);
  assert.match(
    source,
    /hasPermissionForUser\("candidates\.read"\)/,
    "nothing consults the gate the columns are supposed to sit behind"
  );
  assert.match(source, /contactsHidden/, "the decision never reaches the sheets");
  assert.match(source, /accessNotes\(/, "the reader retypes its own refusal note");
};

test("the reader asks for the permission it claims to honour", readerAsksForItsGate);

// ————————————————————————————————————————————————————————————————————————————
// what the row says about contact details
// ————————————————————————————————————————————————————————————————————————————

test("a download says whether it carried contact details", async () => {
  const { exportTrailEntry } = await load();
  const carried = exportTrailEntry(facts({ contacts: "included", document: contactFile() }));
  assert.equal(carried.detail.contacts, "included");
  assert.match(carried.summary, /contact details/i);

  const refused = exportTrailEntry(facts({ contacts: "withheld" }));
  assert.equal(refused.detail.contacts, "withheld");
  assert.match(refused.summary, /Contact details were withheld from this account/);

  const none = exportTrailEntry(facts({ door: "time", contacts: "absent" }));
  assert.equal(none.detail.contacts, "absent");
  assert.doesNotMatch(none.summary, /contact/i);
});

const fileOutranksTheDoorsWord = async () => {
  const { exportTrailEntry } = await load();
  // A door that claims it carried contacts and hands over a file with no contact
  // column is corrected on the way into the row.
  const boast = exportTrailEntry(facts({ contacts: "included" }));
  assert.equal(boast.detail.contacts, "absent");
  assert.doesNotMatch(boast.summary, /contact/i);
  // And a door that reports a refusal for a file that plainly carries the columns
  // is corrected the other way: nothing in the audit may let a gate look like it
  // bit while the addresses went out beside it.
  const understated = exportTrailEntry(facts({ contacts: "withheld", document: contactFile() }));
  assert.equal(understated.detail.contacts, "included");
  const alsoUnderstated = exportTrailEntry(
    facts({ door: "time", contacts: "absent", document: contactFile() })
  );
  assert.equal(alsoUnderstated.detail.contacts, "included", "no door's word outranks its own file");
};

test("the file is the evidence of what left, not the route's memory of it", fileOutranksTheDoorsWord);

test("not one cell value of a contact column reaches the row", async () => {
  const { exportTrailEntry } = await load();
  const entry = exportTrailEntry(facts({ contacts: "included", document: contactFile() }));
  const written = JSON.stringify(entry);
  for (const forbidden of ["samira@example.com", "01000000000", "Samira"]) {
    assert.equal(written.includes(forbidden), false, `${forbidden} is somebody's own data`);
  }
});

test("a contacts fact the writer would redact is not a contacts fact", async () => {
  const { exportTrailEntry } = await load();
  for (const contacts of ["included", "withheld", "absent"]) {
    const entry = exportTrailEntry(facts({ contacts, document: contactFile() }));
    assert.deepEqual(redactDetail(entry.detail), entry.detail);
  }
});

// ————————————————————————————————————————————————————————————————————————————
// the three doors
// ————————————————————————————————————————————————————————————————————————————

test("every download door writes its row and honours the refusal", () => {
  for (const rel of ROUTES) {
    const source = read(rel);
    assert.match(source, /exportTrailEntry\(/, `${rel} must build the row`);
    assert.match(source, /recordActivity\(/, `${rel} must write the row`);
    assert.match(source, /exportAuditDenied\(/, `${rel} must refuse the file on a refused row`);
    assert.match(source, /door: "/, `${rel} must name which door the file left through`);
    /* Every door states its contacts fact. The two that never carry an address
     * can name it as a word; the reports door reads it off the gate the reader
     * worked under, so its value is necessarily a conditional. What the reports
     * door cannot get away with is leaving the field out — `contacts` is now a
     * required fact, and the pair of tests below check the claim against the
     * columns the finished file actually carries. */
    assert.match(source, /contacts:/, `${rel} must say what its file did with contact details`);
  }
});

test("the reports door names the gate the reader actually worked under", () => {
  const source = read("src/app/api/reports/export/route.ts");
  /* The mask a file was built behind is decided once, inside the reader, next to
   * the columns it filters. A second read here could disagree with the sheet the
   * bytes were made from — and the row would then describe a file that is not it. */
  assert.doesNotMatch(
    source,
    /scoresAreMaskedForCurrentUser/,
    "the route re-reads the gate instead of taking the reader's"
  );
  assert.match(source, /built\.gate/, "the reader never hands the route the access it applied");
});

test("no door hand-writes the figures the document already carries", () => {
  for (const rel of ROUTES) {
    const source = read(rel);
    assert.equal(
      /\brows:\s*(\d|read\.|total|count)/i.test(source),
      false,
      `${rel} counts rows itself instead of reading them off the document`
    );
  }
});

// ————————————————————————————————————————————————————————————————————————————
// mutation proofs — each edit must turn the check it targets red
// ————————————————————————————————————————————————————————————————————————————

/* A gate is only proved by the edit that would break it. Each entry below is one
 * way the PII rule goes wrong that the file still reads correctly afterwards:
 * the guard deleted, the note dropped, the column left unguarded, the reader
 * stopped asking, the row trusting the door instead of the file. */
const MUTATIONS = [
  {
    label: "1. the contacts guard stops applying → the column check red",
    rel: "src/modules/analytics/domain/sheetAccess.ts",
    needle: "  if (column.contacts && access.contactsHidden) return false;",
    replace: "  if (false && access.contactsHidden) return false;",
    check: gateTakesTheColumn,
  },
  {
    label: "2. a second gate is a second note, not one note about two things → the caveats red",
    rel: "src/modules/analytics/domain/sheetAccess.ts",
    needle: "  if (access.scoresHidden) {",
    replace: "  if (false) {",
    check: caveatsSayWhatWasTaken,
  },
  {
    label: "3. a builder writes an Email column nobody guarded → the header sweep red",
    rel: "src/modules/analytics/domain/documents.ts",
    needle:
      '      { header: "Email", contacts: true, value: (row) => row.email },\n      { header: "Phone", contacts: true, value: (row) => row.phone },',
    replace: '      { header: "Email", value: (row) => row.email },\n      { header: "Phone", value: (row) => row.phone },',
    check: headersAreTheOnesTheGateKnows,
  },
  {
    label: "4. the reader stops consulting the permission → the reader check red",
    rel: "src/modules/analytics/infrastructure/reportReader.ts",
    needle: '    hasPermissionForUser("candidates.read"),',
    replace: "    true,",
    check: readerAsksForItsGate,
  },
  {
    label: "5. the row takes the door's word over its own file → the evidence check red",
    rel: "src/modules/activity/domain/exportTrail.ts",
    needle: '  if (documentCarriesContacts(facts.document)) return "included";',
    replace: "  if (false) return null;",
    check: fileOutranksTheDoorsWord,
  },
];

async function mutate(entry) {
  const file = path.join(ROOT, entry.rel);
  let original = null;
  // A kill between the write and the restore would leave a guard deleted on
  // disk, so the copy goes back on the normal path, on `exit`, and on a signal.
  const restore = () => {
    if (original === null) return;
    try {
      writeFileSync(file, original);
    } catch {
      // Nothing to write to; the next run's read will report the damage.
    }
    original = null;
  };
  const onSignal = () => {
    restore();
    process.exit(1);
  };
  try {
    original = readFileSync(file, "utf8");
    if (!original.includes(entry.needle)) return `the needle is gone from ${entry.rel}`;
    process.once("exit", restore);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    writeFileSync(file, original.replace(entry.needle, entry.replace));
    try {
      await entry.check();
      return "the check stayed green — it does not test the rule it names";
    } catch (cause) {
      if (cause?.code !== "ERR_ASSERTION") return `the module broke instead of the rule: ${cause.message}`;
      return "";
    }
  } finally {
    process.off("exit", restore);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    restore();
  }
}

test("a PII gate edited away turns its own proof red", async () => {
  for (const entry of MUTATIONS) {
    assert.equal(await mutate(entry), "", entry.label);
  }
});
