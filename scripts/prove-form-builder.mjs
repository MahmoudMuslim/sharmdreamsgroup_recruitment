/* scripts/prove-form-builder.mjs
 * Run: node --env-file=docker/.env --experimental-strip-types scripts/prove-form-builder.mjs
 *
 * Nothing here needs a database, a browser or a model. What is pinned is the
 * application form builder's correctness boundary: the one layout composition
 * and its order, the duplicate-key and duplicate-binding refusals, the fifteen
 * identity-contract refusals, every field type's normaliser against 044's own
 * `type` CHECK, the eight file kinds and their byte ceilings, the snapshot
 * round-trip, the §11 ceilings as names rather than inline numbers, the binding
 * map and the rows it appends, the precedence rung a candidate's answer sits on,
 * and the wiring: the erasure read, the upload door, the public projection, the
 * nineteenth staff route, the AI capability, the consent boxes, the merged
 * `cv_text`, the bucket's doors, the orphan pass, the order of the person
 * write and the three field widths that let two questions share a row — with
 * the sentence that tells the author which half of a pair refused to — and the
 * public door that reads an attached CV into the questions a published layout
 * asks, the one model call behind it, and the wizard that fills only a blank
 * the candidate did not write in.
 *
 * Migrations 043 and 044 are applied on the local database, but nothing here
 * reads one: the checks that name a table, a policy or a CHECK are text pins
 * against those files (comments stripped, whitespace squashed), so the proof
 * runs the same on a machine with no stack up.
 *
 * The thirty-five mutation proofs are real edits: each one breaks a file,
 * re-runs the check that must notice, and restores the file in a `finally`. A
 * mutation that does not turn its check red fails the proof.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// ---------------------------------------------------------------------------
// Module resolution: the `@/` alias, extensionless siblings, and three stubs.
//
// `publicForm.ts` statically imports the service REST client; `personWriter.ts`
// reaches the client and the privileged `pg` pool through dynamic imports.
// Those are seams, not subjects: this proof supplies its own in-memory pool and
// REST builder so the real `applyPersonField` code runs without a database.
// ---------------------------------------------------------------------------
const STUB_SOURCES = {
  "server-only": "export {};",
  "@/lib/auth/db": "export const getAuthPool = () => globalThis.__formPool;",
  "@/lib/data-api/service": "export const getServiceRestClient = () => globalThis.__formRest;",
};
const STUB_URLS = Object.fromEntries(
  Object.entries(STUB_SOURCES).map(([specifier, source]) => [
    specifier,
    `data:text/javascript,${encodeURIComponent(source)}`,
  ])
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUB_URLS[specifier]) {
      return { url: STUB_URLS[specifier], shortCircuit: true };
    }
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
        ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
        : null;
    if (base) {
      for (const candidate of [base, `${base}.ts`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

// ---------------------------------------------------------------------------
// Proof harness
// ---------------------------------------------------------------------------
const results = [];
const mutations = [];

function verdict(problems) {
  return problems.length === 0
    ? { pass: true }
    : { pass: false, detail: [...new Set(problems)].slice(0, 5).join("; ") };
}

async function safe(fn) {
  try {
    return await fn();
  } catch (cause) {
    return { pass: false, detail: `threw: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

const squash = (text) => text.replace(/\s+/g, " ").trim();
const stripSqlComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/**
 * Comment-free TypeScript, for a needle that must not be satisfied by a
 * sentence in a docstring.
 *
 * Strings and template literals are skipped, and a `//` only opens a line
 * comment when the character before it is whitespace or punctuation — a regex
 * like `/[\\/]/` contains a `//` that is not a comment, and a stripper that
 * swallowed the rest of that line would quietly retire the normaliser's
 * filename rule from this proof.
 */
const COMMENT_START_AFTER = new Set([
  undefined, " ", "\t", "\n", "\r", "(", ")", ",", ";", "=", "{", "}", "[", "!",
  "&", "|", "?", ":", "<", ">", "+", "-", "*", "%", "~", "^",
]);

function stripCodeComments(text) {
  let out = "";
  let quote = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (ch === "/" && next === "/" && COMMENT_START_AFTER.has(text[i - 1])) {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const MIGRATION_043 = "db/migrations/043_person_profile_spine.sql";
const MIGRATION_044 = "db/migrations/044_application_forms.sql";
const SPEC = "docs/superpowers/specs/2026-10-25-application-form-builder-design.md";
// Read fresh per check: mutation proofs edit these files, and a snapshot taken
// at load time would keep answering with the unmutated text.
const currentSql = (rel) => squash(stripSqlComments(read(rel)));

function blockBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start === -1) return "";
  const end = endNeedle ? source.indexOf(endNeedle, start + startNeedle.length) : -1;
  return source.slice(start, end === -1 ? source.length : end);
}

/** The quoted members of a TypeScript union alias. */
function unionMembers(source, typeName) {
  const start = source.indexOf(`export type ${typeName} =`);
  if (start === -1) return [];
  const end = source.indexOf(";", start);
  const block = source.slice(start, end === -1 ? source.length : end);
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** `create policy "NAME" … ;` from a squashed, comment-free migration. */
function policyBlock(migrationText, name) {
  const start = migrationText.indexOf(`create policy "${name}"`);
  if (start === -1) return "";
  const end = migrationText.indexOf(";", start);
  return end === -1 ? migrationText.slice(start) : migrationText.slice(start, end + 1);
}

/** The quoted list of an inline `check (<col> in ('a','b'))` — 044's type CHECK names no constraint. */
function inlineCheckValues(migrationText, column) {
  const start = migrationText.indexOf(`check (${column} in (`);
  if (start === -1) return [];
  const body = migrationText.slice(start + `check (${column} in (`.length);
  const end = body.indexOf("))");
  const list = end === -1 ? body : body.slice(0, end);
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The member names of an exported object literal, in declaration order. */
function objectKeys(source, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) return [];
  const end = source.indexOf("} as const", start);
  const block = source.slice(start, end === -1 ? source.length : end);
  return [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
}

/** Every `.ts` / `.tsx` file under a tree. */
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && statSync(full).size > 0) out.push(full);
  }
  return out;
}

/** Comment-free source of every file under `src`, cached once. */
let srcCache = null;
function allSrc() {
  if (srcCache === null) {
    srcCache = walk(path.join(root, "src")).map((full) => ({
      rel: path.relative(root, full).split(path.sep).join("/"),
      code: stripCodeComments(readFileSync(full, "utf8")),
    }));
  }
  return srcCache;
}

/** The source files under `src` that mention a literal, comments stripped. */
function filesMentioning(needle) {
  return allSrc().filter((entry) => entry.code.includes(needle)).map((entry) => entry.rel);
}

const codeOf = (rel) => stripCodeComments(read(rel));
const rawOf = (rel) => read(rel);

/** The staff pages, derived from the directory listing rather than a remembered count. */
function adminPageRoutes() {
  const dir = path.join(root, "src/app/(admin)");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "page.tsx")))
    .map((entry) => `/${entry.name}`)
    .sort();
}

// ---------------------------------------------------------------------------
// In-memory seams
// ---------------------------------------------------------------------------

/**
 * The privileged pool the writer sees. It models the statements
 * `applyPersonField` issues — a column read, a held-door read, a column write,
 * a collection read, a collection append and the event — and throws on anything
 * else, because a proof that silently accepted unhandled SQL would be proving
 * nothing.
 */
function poolFor({ values = {}, doors = {}, rows = {} } = {}) {
  const heldValues = new Map(Object.entries(values));
  const heldDoors = new Map(Object.entries(doors));
  const heldRows = new Map(Object.entries(rows));
  const events = [];
  const queries = [];

  const client = {
    queries,
    events,
    async query(rawSql, params = []) {
      const text = String(rawSql).replace(/\s+/g, " ").trim();
      queries.push({ text, params });
      let match;
      if (text === "begin" || text === "commit" || text === "rollback") {
        return { rows: [], rowCount: 0 };
      }
      if (
        (match = /^select (\w+) as v from (person_profiles|person_health|person_family_details) where (?:id|person_id) = \$1$/.exec(text))
      ) {
        const column = match[1];
        return { rows: [{ v: heldValues.has(column) ? heldValues.get(column) : null }], rowCount: 1 };
      }
      if (
        (match = /^select door from person_events where person_id = \$1 and field_key = \$2 order by recorded_at desc limit 1$/.exec(text))
      ) {
        const key = params[1];
        return { rows: heldDoors.has(key) ? [{ door: heldDoors.get(key) }] : [], rowCount: 0 };
      }
      if ((match = /^update person_profiles set (\w+) = \$1, updated_at = now\(\) where id = \$2$/.exec(text))) {
        heldValues.set(match[1], params[0]);
        return { rows: [], rowCount: 1 };
      }
      if (
        (match = /^insert into (person_health|person_family_details) \(person_id, (\w+)\) values \(\$1, \$2\) on conflict \(person_id\) do update set \2 = excluded\.\2, updated_at = now\(\)$/.exec(text))
      ) {
        heldValues.set(match[2], params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (
        /^insert into person_events \(person_id, field_key, field_group, old_value, new_value, door, actor_id, actor_kind\) values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8\)$/.test(text)
      ) {
        const event = {
          personId: params[0],
          fieldKey: params[1],
          fieldGroup: params[2],
          oldValue: params[3],
          newValue: params[4],
          door: params[5],
          actorId: params[6],
          actorKind: params[7],
        };
        events.push(event);
        heldDoors.set(event.fieldKey, event.door);
        return { rows: [], rowCount: 1 };
      }
      // A collection read: `select skill from person_skills where person_id = $1`.
      if (
        (match = /^select ([a-z_, ]+) from (person_\w+) where person_id = \$1$/.exec(text))
      ) {
        const table = match[2];
        const cols = match[1].split(", ");
        const held = heldRows.has(table) ? heldRows.get(table) : [];
        return { rows: held.map((row) => Object.fromEntries(cols.map((c) => [c, row[c] ?? null]))), rowCount: held.length };
      }
      // A collection append: `insert into person_skills (person_id, skill, source) values (…)`.
      if (
        (match = /^insert into (person_\w+) \(([a-z_, ]+)\) values \(\$1(?:, \$\d+)*\)$/.exec(text)) &&
        match[1] !== "person_events"
      ) {
        const table = match[1];
        const cols = match[2].split(", ");
        const row = Object.fromEntries(cols.map((c, index) => [c, params[index]]));
        const held = heldRows.has(table) ? heldRows.get(table) : [];
        held.push(row);
        heldRows.set(table, held);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`pool stub: unhandled SQL — ${text}`);
    },
    release() {},
  };

  return {
    client,
    values: heldValues,
    doors: heldDoors,
    rows: heldRows,
    events,
    queries,
    count: (re) => queries.filter((q) => re.test(q.text)).length,
    connect: async () => client,
  };
}

const ALWAYS = { consentAlive: async () => true };

// ---------------------------------------------------------------------------
// The modules under test
// ---------------------------------------------------------------------------
const fieldsUrl = pathToFileURL(path.join(root, "src/modules/candidates/domain/person-fields.ts")).href;
const resolveUrl = pathToFileURL(path.join(root, "src/modules/form-builder/domain/resolveLayout.ts")).href;
const typesUrl = pathToFileURL(path.join(root, "src/modules/form-builder/domain/field-types.ts")).href;
const identityUrl = pathToFileURL(path.join(root, "src/modules/form-builder/domain/identityIssues.ts")).href;
const limitsUrl = pathToFileURL(path.join(root, "src/modules/form-builder/domain/limits.ts")).href;
const draftIssuesUrl = pathToFileURL(path.join(root, "src/modules/form-builder/domain/draftIssues.ts")).href;
const snapshotUrl = pathToFileURL(path.join(root, "src/modules/form-builder/domain/snapshot.ts")).href;
const writerUrl = pathToFileURL(path.join(root, "src/modules/candidates/application/personWriter.ts")).href;
const i18nUrl = pathToFileURL(path.join(root, "src/lib/i18n.ts")).href;
const publicUrl = pathToFileURL(path.join(root, "src/modules/form-builder/application/publicForm.ts")).href;

const rl = await import(resolveUrl);
const ft = await import(typesUrl);
const ii = await import(identityUrl);
const LIMITS = (await import(limitsUrl)).LIMITS;
const di = await import(draftIssuesUrl);
const snap = await import(snapshotUrl);
const writer = await import(writerUrl);
const staticI18n = await import(i18nUrl);
const pf = await import(publicUrl);
const registry = await import(fieldsUrl);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const JOB = "11111111-1111-1111-1111-111111111111";
const OTHER_JOB = "22222222-2222-2222-2222-222222222222";

const form = (id, overrides = {}) => ({
  id,
  name: id,
  isGlobal: false,
  globalPosition: 0,
  status: "PUBLISHED",
  archivedAt: null,
  version: 1,
  ...overrides,
});

const field = (id, formId, key, type, overrides = {}) => ({
  id,
  formId,
  key,
  type,
  label: overrides.label ?? key,
  helpText: null,
  placeholder: null,
  required: false,
  config: {},
  systemKey: null,
  position: 0,
  ...overrides,
});

const rf = (row, rowForm) => ({ field: row, form: rowForm });

// ---------------------------------------------------------------------------
// 1. `resolveLayout` order: globals before assignments, then the tie-breaks.
// ---------------------------------------------------------------------------
const orderLayout = () => {
  const forms = [
    form("g-c", { name: "Third Global", isGlobal: true, globalPosition: 0 }),
    form("g-a", { name: "Zulu", isGlobal: true, globalPosition: 1 }),
    form("g-b", { name: "Alpha", isGlobal: true, globalPosition: 1 }),
    form("g-x", { name: "Also assigned", isGlobal: true, globalPosition: 5 }),
    form("f-z", { name: "Alpha Job" }),
    form("f-a", { name: "Zeta" }),
    form("f-draft", { name: "Draft form", isGlobal: true, globalPosition: 0, status: "DRAFT" }),
    form("f-arch", { name: "Archived form", isGlobal: true, globalPosition: 0, archivedAt: "2026-10-01" }),
    form("f-other", { name: "Other job" }),
  ];
  const fieldsByForm = {
    "g-c": [
      field("c1b", "g-c", "c1", "date", { position: 1 }),
      field("c0b", "g-c", "c0b", "short_text", { position: 0 }),
      field("c0a", "g-c", "c0", "short_text", { position: 0 }),
    ],
    "g-a": [field("za", "g-a", "zulu", "short_text")],
    "g-b": [field("ab", "g-b", "alpha", "short_text")],
    "g-x": [field("gx", "g-x", "alsog", "short_text")],
    "f-z": [field("fz", "f-z", "alphajob", "short_text")],
    "f-a": [field("fa", "f-a", "zeta", "short_text")],
    "f-draft": [field("dr", "f-draft", "drafted", "short_text")],
    "f-arch": [field("ar", "f-arch", "archived", "short_text")],
    "f-other": [field("ot", "f-other", "othersjob", "short_text")],
  };
  const assignments = [
    { jobId: JOB, formId: "g-x", position: 0 },
    { jobId: JOB, formId: "f-z", position: 0 },
    { jobId: JOB, formId: "f-a", position: 1 },
    { jobId: JOB, formId: "f-z", position: 2 },
    { jobId: OTHER_JOB, formId: "f-other", position: 0 },
  ];
  return { forms, fieldsByForm, assignments, jobId: JOB };
};

const check1 = async (mod = rl) => {
  const problems = [];
  const layout = mod.resolveLayout(orderLayout());
  const asked = layout.fields.map((entry) => entry.field.key);
  const expected = ["c0", "c0b", "c1", "zulu", "alpha", "alsog", "alphajob", "zeta"];
  if (!deepEqual(asked, expected)) {
    problems.push(`order is [${asked}], expected [${expected}]`);
  }
  if (layout.violations.length > 0) {
    problems.push(`a clean composition reported ${layout.violations.map((v) => v.kind).join(",")}`);
  }
  const twice = mod.resolveLayout(orderLayout());
  if (!deepEqual(twice.fields, layout.fields)) problems.push("two runs of the same read disagreed");

  // Steps: a heading opens a step, and the fields before the first heading of a
  // headed form sit in a `null`-heading step rather than vanishing.
  const headed = form("h1", { name: "Headed" });
  const steps = mod.resolveLayout({
    forms: [headed],
    fieldsByForm: {
      h1: [
        field("lead", "h1", "lead", "short_text", { position: 0 }),
        field("head", "h1", "About you", "section_heading", { position: 1 }),
        field("body", "h1", "body", "long_text", { position: 2 }),
      ],
    },
    assignments: [{ jobId: JOB, formId: "h1", position: 0 }],
    jobId: JOB,
  });
  if (steps.steps.length !== 2) problems.push(`a headed form gave ${steps.steps.length} steps, expected 2`);
  const first = steps.steps[0];
  const second = steps.steps[1];
  if (!first || first.heading !== null || first.fields.map((e) => e.field.key).join(",") !== "lead") {
    problems.push("the fields before the first heading are not a `heading: null` step holding them");
  }
  if (!second || second.heading?.field.key !== "About you" || second.fields.map((e) => e.field.key).join(",") !== "body") {
    problems.push("the heading did not open its own step");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 2. A duplicate `key` or `system_key` across two forms is a named violation.
// ---------------------------------------------------------------------------
const collisionLayout = () => {
  const a = form("ca", { name: "Form A", isGlobal: true, globalPosition: 0 });
  const b = form("cb", { name: "Form B" });
  return {
    forms: [a, b],
    fieldsByForm: {
      ca: [
        field("a1", "ca", "dup", "short_text"),
        field("a2", "ca", "bound", "email", { systemKey: "email" }),
      ],
      cb: [
        field("b1", "cb", "dup", "long_text"),
        field("b2", "cb", "also-bound", "phone", { systemKey: "email" }),
      ],
    },
    assignments: [{ jobId: JOB, formId: "cb", position: 0 }],
    jobId: JOB,
  };
};

const cleanLayoutFor = (mod) => mod.resolveLayout({
  forms: [form("ok", { name: "Fine" })],
  fieldsByForm: { ok: [field("k1", "ok", "one", "short_text"), field("k2", "ok", "two", "long_text")] },
  assignments: [{ jobId: JOB, formId: "ok", position: 0 }],
  jobId: JOB,
});

const check2 = async (mod = rl) => {
  const problems = [];
  const violations = mod.resolveLayout(collisionLayout()).violations;
  const dupKey = violations.find((v) => v.kind === "duplicate_key");
  if (!dupKey) problems.push("a key held by two forms was not reported");
  else if (dupKey.key !== "dup" || dupKey.firstForm !== "Form A" || dupKey.secondForm !== "Form B") {
    problems.push(`duplicate_key named ${dupKey.firstForm}/${dupKey.secondForm} for ${dupKey.key}, expected Form A/Form B for dup`);
  }
  const dupSystem = violations.find((v) => v.kind === "duplicate_system");
  if (!dupSystem) problems.push("a system key bound twice was not reported");
  else if (dupSystem.systemKey !== "email" || dupSystem.firstForm !== "Form A" || dupSystem.secondForm !== "Form B") {
    problems.push(`duplicate_system named ${dupSystem.firstForm}/${dupSystem.secondForm}, expected Form A/Form B`);
  }
  if (cleanLayoutFor(mod).violations.length > 0) problems.push("unique keys reported a violation");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 3. Every identity-contract refusal, each from its own fixture.
// ---------------------------------------------------------------------------
function baseRows(fa = form("idbase", { name: "Base" })) {
  return {
    forms: [fa],
    rows: [
      rf(field("n", fa.id, "name", "short_text", { required: true, systemKey: "name" }), fa),
      rf(field("e", fa.id, "email", "email", { required: true, systemKey: "email" }), fa),
      rf(field("a", fa.id, "about", "long_text", { required: true, systemKey: "about" }), fa),
    ],
  };
}

const withExtra = (extra) => {
  const base = baseRows();
  return [...base.rows, ...extra];
};

const IDENTITY_FIXTURES = [
  ["base", () => baseRows().rows, []],
  ["name-count", () => {
    const f = form("fc1", { name: "Count" });
    return [
      rf(field("e", "fc1", "email", "email", { required: true, systemKey: "email" }), f),
      rf(field("a", "fc1", "about", "long_text", { required: true, systemKey: "about" }), f),
    ];
  }, ["name-count"]],
  ["name-required", () => {
    const f = form("fc2", { name: "Optional name" });
    return [
      rf(field("n", "fc2", "name", "short_text", { systemKey: "name" }), f),
      rf(field("e", "fc2", "email", "email", { required: true, systemKey: "email" }), f),
      rf(field("a", "fc2", "about", "long_text", { required: true, systemKey: "about" }), f),
    ];
  }, ["name-required"]],
  ["email-count", () => {
    const f = form("fc3", { name: "No email" });
    return [
      rf(field("n", "fc3", "name", "short_text", { required: true, systemKey: "name" }), f),
      rf(field("a", "fc3", "about", "long_text", { required: true, systemKey: "about" }), f),
    ];
  }, ["email-count"]],
  ["email-required", () => {
    const f = form("fc4", { name: "Optional email" });
    return [
      rf(field("n", "fc4", "name", "short_text", { required: true, systemKey: "name" }), f),
      rf(field("e", "fc4", "email", "email", { systemKey: "email" }), f),
      rf(field("a", "fc4", "about", "long_text", { required: true, systemKey: "about" }), f),
    ];
  }, ["email-required"]],
  ["duplicate-system", () => withExtra([
    rf(field("p2", "idbase", "phone-again", "phone", { systemKey: "phone" }), form("idbase", { name: "Base" })),
    rf(field("p3", "idbase", "phone-thrice", "phone", { systemKey: "phone" }), form("idbase", { name: "Base" })),
  ]), ["duplicate-system"]],
  ["missing-cv-or-about", () => {
    const f = form("fc6", { name: "Nothing to review" });
    return [
      rf(field("n", "fc6", "name", "short_text", { required: true, systemKey: "name" }), f),
      rf(field("e", "fc6", "email", "email", { required: true, systemKey: "email" }), f),
    ];
  }, ["missing-cv-or-about"]],
  ["cv-or-about-required", () => {
    const f = form("fc7", { name: "Optional CV" });
    return [
      rf(field("n", "fc7", "name", "short_text", { required: true, systemKey: "name" }), f),
      rf(field("e", "fc7", "email", "email", { required: true, systemKey: "email" }), f),
      rf(field("cv", "fc7", "cv", "file", { systemKey: "cv" }), f),
    ];
  }, ["cv-or-about-required"]],
  ["type-mismatch", () => {
    const f = form("fc8", { name: "Wrong type" });
    return [
      rf(field("n", "fc8", "name", "long_text", { required: true, systemKey: "name" }), f),
      rf(field("e", "fc8", "email", "email", { required: true, systemKey: "email" }), f),
      rf(field("a", "fc8", "about", "long_text", { required: true, systemKey: "about" }), f),
    ];
  }, ["type-mismatch"]],
  ["unboundable-duration", () => withExtra([
    rf(field("dur", "idbase", "notice", "duration", { systemKey: "person:phone" }), form("idbase", { name: "Base" })),
  ]), ["unboundable-type"]],
  ["unboundable-geolocation", () => withExtra([
    rf(field("geo", "idbase", "where", "geolocation", { systemKey: "person:phone" }), form("idbase", { name: "Base" })),
  ]), ["unboundable-type"]],
  ["unknown-person-key", () => withExtra([
    rf(field("uk", "idbase", "ghost", "short_text", { systemKey: "person:not_a_registry_key" }), form("idbase", { name: "Base" })),
  ]), ["unknown-person-key"]],
  ["person-type-mismatch", () => withExtra([
    rf(field("pm", "idbase", "anniversary", "short_text", { systemKey: "person:anniversary_date" }), form("idbase", { name: "Base" })),
  ]), ["person-type-mismatch"]],
  ["list-not-multi", () => withExtra([
    rf(field("lm", "idbase", "skills", "select", { systemKey: "person:skills", config: { options: ["a", "b"] } }), form("idbase", { name: "Base" })),
  ]), ["list-not-multi"]],
  ["consent-required", () => withExtra([
    rf(field("cr", "idbase", "partner", "short_text", { required: true, systemKey: "person:partner_name" }), form("idbase", { name: "Base" })),
  ]), ["consent-required"]],
  ["heading-bound", () => {
    const head = form("fh1", { name: "Headed" });
    const base = baseRows();
    return [
      ...base.rows,
      rf(field("h", "fh1", "About", "section_heading", { systemKey: "phone" }), head),
    ];
  }, ["heading-bound"]],
  ["orphan-before-heading", () => {
    const head = form("fh2", { name: "Headed too" });
    const base = baseRows();
    return [
      rf(field("lead", "fh2", "loose", "short_text", { position: 0 }), head),
      rf(field("h", "fh2", "About", "section_heading", { position: 1 }), head),
      ...base.rows,
    ];
  }, ["orphan-before-heading"]],
];

const check3 = async (mod = ii) => {
  const problems = [];
  const declared = unionMembers(read("src/modules/form-builder/domain/identityIssues.ts"), "IdentityIssueKind");
  const seenKinds = new Set();

  for (const [label, build, expected] of IDENTITY_FIXTURES) {
    const issues = mod.identityIssues(build());
    const kinds = issues.map((issue) => issue.kind);
    for (const kind of kinds) seenKinds.add(kind);
    const missing = expected.filter((kind) => !kinds.includes(kind));
    if (missing.length > 0) {
      problems.push(`${label}: expected ${missing.join(",")} but got [${kinds.join(",") || "no issue"}]`);
    }
    const unexpected = kinds.filter((kind) => !expected.includes(kind));
    if (unexpected.length > 0) {
      problems.push(`${label}: also reported ${unexpected.join(",")}`);
    }
  }

  for (const kind of declared) {
    if (!seenKinds.has(kind)) problems.push(`no fixture reaches "${kind}"`);
  }
  for (const kind of seenKinds) {
    if (!declared.includes(kind)) problems.push(`a fixture reached "${kind}", which the union does not declare`);
  }
  if (declared.length !== 15) problems.push(`the union declares ${declared.length} kinds, expected 15`);

  // The message names the field by its label, so a recruiter can find it.
  const partnerIssue = mod.identityIssues(IDENTITY_FIXTURES.find(([l]) => l === "consent-required")[1]());
  if (!partnerIssue.some((issue) => issue.message.includes('"partner"'))) {
    problems.push("the consent refusal did not name the field");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 4. `normaliseAnswer` per type, and the type list 044 stores.
// ---------------------------------------------------------------------------
const NORM_CASES = {
  short_text: {
    ok: [[null, "Nader", "Nader"], [{ maxLength: 5 }, "abcde", "abcde"]],
    bad: [[{ maxLength: 3 }, "abcd"], [null, "x".repeat(301)]],
  },
  long_text: {
    ok: [[null, "hello", "hello"], [null, "x".repeat(LIMITS.long_text_chars), "x".repeat(LIMITS.long_text_chars)]],
    bad: [[null, "x".repeat(LIMITS.long_text_chars + 1)], [{ maxLength: 999999 }, "x".repeat(LIMITS.long_text_chars + 1)]],
  },
  email: {
    ok: [[null, "Nader@Example.COM", "nader@example.com"]],
    bad: [[null, "nope"], [null, "a@b.c"]],
  },
  phone: {
    ok: [[null, "0100 1234567", "0100 1234567"]],
    bad: [[null, "12345"], [null, "0100-1234"]],
  },
  url: {
    ok: [[null, "https://linkedin.com/in/nader", "https://linkedin.com/in/nader"]],
    bad: [[null, "ftp://x.com"], [null, "not a url"], [null, `https://x.com/${"y".repeat(500)}`]],
  },
  number: {
    ok: [[{ decimals: 0 }, "50", "50"], [null, "12.34", "12.34"]],
    bad: [[null, "1.234"], [{ min: 10 }, "5"], [{ max: 10 }, "11"], [null, "twelve"]],
  },
  percentage: {
    ok: [[null, "0", "0"], [null, "100", "100"], [null, "12.34", "12.34"]],
    bad: [[null, "101"], [null, "-1"], [null, "12.345"]],
  },
  currency: {
    ok: [[null, "1500.50", "1500.50"]],
    bad: [[null, "1500.505"], [null, "1,500"]],
  },
  date: {
    ok: [[null, "2026-02-28", "2026-02-28"], [{ min: "2026-01-01" }, "2026-06-01", "2026-06-01"]],
    bad: [[null, "2026-02-30"], [null, "2026-13-01"], [null, "28/02/2026"], [{ min: "2026-01-01" }, "2025-12-31"]],
  },
  time: {
    ok: [[null, "00:00", "00:00"], [null, "23:59", "23:59"]],
    bad: [[null, "24:00"], [null, "9:30"], [null, "09:30:45"], [null, "9:30 PM"]],
  },
  datetime: {
    ok: [[null, "2026-05-01T09:30Z", "2026-05-01T09:30Z"], [null, "2026-05-01T09:30:15+02:00", "2026-05-01T09:30:15+02:00"]],
    bad: [[null, "2026-05-01T09:30"], [null, "2026-02-30T09:30Z"]],
  },
  duration: {
    ok: [[null, { value: 45, unit: "minutes" }, { value: 45, unit: "minutes" }],
         [null, { value: 1, unit: "hours" }, { value: 1, unit: "hours" }],
         [{ units: ["hours"] }, { value: 2, unit: "hours" }, { value: 2, unit: "hours" }]],
    bad: [[null, { value: 0, unit: "hours" }], [null, { value: 10000, unit: "hours" }],
          [null, { value: 5, unit: "fortnights" }], [{ units: ["hours"] }, { value: 5, unit: "days" }]],
  },
  select: {
    ok: [[{ options: ["Cairo", "Giza"] }, "Cairo", "Cairo"]],
    bad: [[{ options: ["only"] }, "only"], [{ options: ["Cairo", "Giza"] }, "Alexandria"]],
  },
  radio: {
    ok: [[{ options: ["Yes", "No"] }, "Yes", "Yes"]],
    bad: [[{ options: ["Yes", "No"] }, "Maybe"], [null, "Yes"]],
  },
  multi_select: {
    ok: [[{ options: ["a", "b", "c"] }, ["a", "c"], ["a", "c"]],
         [{ options: ["a", "b"], minSelections: 2 }, ["a", "b"], ["a", "b"]],
         [{ options: ["a", "b", "c"] }, ["a", "a"], ["a"]]],
    bad: [[{ options: ["a", "b"], maxSelections: 1 }, ["a", "b"]],
          [{ options: ["a", "b"] }, "a"],
          [{ options: ["a", "b"] }, ["z"]]],
  },
  checkbox: {
    ok: [[null, true, "true"], [null, "false", "false"], [null, null, "false"]],
    bad: [[null, "maybe"], [{ mustBeTrue: true }, false]],
  },
  file: {
    ok: [[null, "cv.pdf", "cv.pdf"], [null, "C:\\uploads\\cv.pdf", "cv.pdf"], [null, { name: "a.docx" }, "a.docx"]],
    bad: [[null, ""], [null, "   "], [null, 5]],
  },
  photo: {
    ok: [[null, { name: "me.png" }, "me.png"]],
    bad: [[null, "   "], [null, null]],
  },
  address: {
    ok: [[null, { line1: "1 Tahrir", city: "Cairo" }, "1 Tahrir, Cairo"],
         [{ components: ["city"] }, { line1: "ignored", city: "Cairo" }, "Cairo"]],
    bad: [[null, { line1: "  " }], [{ components: [] }, { line1: "x" }], [null, "Cairo"]],
  },
  geolocation: {
    ok: [[null, { lat: 30.0444, lng: 31.2357 }, { lat: 30.0444, lng: 31.2357 }],
         [null, { lat: 12.123456789, lng: 1 }, { lat: 12.123457, lng: 1 }]],
    bad: [[null, { lat: 91, lng: 0 }], [null, { lat: 0, lng: -181 }], [null, { lat: "abc", lng: 0 }]],
  },
  section_heading: {
    ok: [],
    bad: [[null, "anything"], [null, null]],
  },
};

const check4 = async (typesMod = ft) => {
  const problems = [];
  const declared = typesMod.FIELD_TYPES;
  const caseKeys = Object.keys(NORM_CASES);
  if (!deepEqual([...caseKeys].sort(), [...declared].sort())) {
    problems.push(`the walk covers [${caseKeys.sort()}] but FIELD_TYPES is [${[...declared].sort()}]`);
  }

  for (const type of caseKeys) {
    const spec = NORM_CASES[type];
    for (const [config, value, expected] of spec.ok) {
      const result = typesMod.normaliseAnswer(type, config, value);
      if (!result.ok) problems.push(`${type} refused ${JSON.stringify(value)}: ${result.reason}`);
      else if (expected !== undefined && !deepEqual(result.value, expected)) {
        problems.push(`${type} normalised ${JSON.stringify(value)} to ${JSON.stringify(result.value)}, expected ${JSON.stringify(expected)}`);
      }
    }
    for (const [config, value] of spec.bad) {
      const result = typesMod.normaliseAnswer(type, config, value);
      if (result.ok) problems.push(`${type} accepted ${JSON.stringify(value)}`);
      else if (typeof result.reason !== "string" || result.reason.length === 0) {
        problems.push(`${type} refused ${JSON.stringify(value)} without a reason`);
      }
    }
  }

  // An unknown type refuses rather than passing.
  const ghost = typesMod.normaliseAnswer("rich_text", {}, "x");
  if (ghost.ok) problems.push("a type outside FIELD_TYPES normalised");

  // The same list, as 044's own CHECK stores it. A type the schema can hold but
  // the code cannot normalise — or a normaliser the schema would refuse — is red.
  const stored = inlineCheckValues(currentSql(MIGRATION_044), "type");
  if (!deepEqual([...stored].sort(), [...declared].sort())) {
    problems.push(`044's type CHECK holds [${stored}] but FIELD_TYPES is [${declared}]`);
  }

  // The four newest, each at its boundary.
  const p = typesMod.normaliseAnswer("percentage", {}, "12.345");
  if (!p.ok && !/decimal/.test(p.reason)) problems.push(`percentage said ${p.reason}`);
  const geo = typesMod.normaliseAnswer("geolocation", {}, { lat: 30.0444, lng: 31.2357 });
  if (!geo.ok) problems.push("the spec's own example coordinate was refused");

  // `DURATION_MINUTES` is a table of equivalences, so it has to agree with itself.
  // (spec §Proof 4 puts `{45, minutes}` and `{1, hours}` on one "same minute total";
  // they are not the same total — 45 ≠ 60 — so this asserts both normalise, which
  // the walk above already does, and that the arithmetic the table claims holds.)
  const minutes = typesMod.DURATION_MINUTES;
  if (minutes.days !== minutes.hours * 24) problems.push("a day is not 24 hours in DURATION_MINUTES");
  if (minutes.weeks !== minutes.days * 7) problems.push("a week is not 7 days in DURATION_MINUTES");
  if (minutes.months !== minutes.days * 30) problems.push("a month is not 30 days in DURATION_MINUTES");
  if (minutes.years !== minutes.days * 365) problems.push("a year is not 365 days in DURATION_MINUTES");
  if (minutes.minutes !== 1) problems.push("a minute is not one minute in DURATION_MINUTES");

  // A seventh unit or type reaches neither the normaliser nor the schema.
  if ((typesMod.DURATION_UNITS ?? []).length !== 6) {
    problems.push(`DURATION_UNITS holds ${(typesMod.DURATION_UNITS ?? []).length} units, expected 6`);
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 5. `kinds` → accepted types and byte ceilings.
// ---------------------------------------------------------------------------
const HEADS = {
  pdf: [0x25, 0x50, 0x44, 0x46],
  doc: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  sheet: [0x50, 0x4b, 0x03, 0x04],
  slides: [0x50, 0x4b, 0x03, 0x04],
  image: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  audio: [0x49, 0x44, 0x33],
  video: [0x1a, 0x45, 0xdf, 0xa3],
  text: [0x6e, 0x61, 0x6d, 0x65],
};

const check5 = async (typesMod = ft) => {
  const problems = [];
  const kinds = typesMod.KINDS;
  if (kinds.length !== 8) problems.push(`KINDS holds ${kinds.length}, expected 8`);

  for (const kind of kinds) {
    const rule = typesMod.kindRules(kind);
    if (!rule) {
      problems.push(`kindRules("${kind}") was null`);
      continue;
    }
    if (rule.acceptedMimes.length === 0) problems.push(`${kind} accepts no MIME`);
    if (rule.maxBytes !== LIMITS.file_bytes) {
      problems.push(`${kind}'s ceiling is ${rule.maxBytes}, not the named LIMITS.file_bytes`);
    }
    const head = Uint8Array.from(HEADS[kind]);
    if (!typesMod.headMatchesKind(kind, head)) problems.push(`${kind} refused its own signature`);
  }

  // A name outside the closed vocabulary matches nothing and has no rules.
  if (typesMod.kindRules("zip") !== null) problems.push("kindRules answered an unknown kind");
  if (typesMod.headMatchesKind("zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))) {
    problems.push("an unknown kind matched a head");
  }

  // Plain text has no signature, so the type and size are the whole check.
  if (!typesMod.headMatchesKind("text", Uint8Array.from([0x00]))) {
    problems.push("the text kind refused a head it cannot read");
  }
  if (!typesMod.headMatchesKind("text", new Uint8Array(0))) {
    problems.push("the text kind refused an empty head");
  }

  // A signature belongs to its own kind and not to an unrelated one.
  if (typesMod.headMatchesKind("image", Uint8Array.from(HEADS.pdf))) {
    problems.push("a PDF head matched the image kind");
  }
  if (typesMod.headMatchesKind("pdf", Uint8Array.from([0xff, 0xd8]))) {
    problems.push("a JPEG head matched the pdf kind");
  }
  // A head shorter than the signature is not a match.
  if (typesMod.headMatchesKind("pdf", Uint8Array.from([0x25, 0x50]))) {
    problems.push("a truncated head matched the pdf kind");
  }

  // A photo's ceiling is the named one, and it is smaller than a file's.
  if (LIMITS.photo_bytes >= LIMITS.file_bytes) problems.push("a photo may be at least as large as a file");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 6. The snapshot round-trip, and a parser that drops rather than guesses.
// ---------------------------------------------------------------------------
const snapshotFields = () => {
  const a = form("sf-a", { name: "Answers", version: 3 });
  const b = form("sf-b", { name: "More", version: 1 });
  const rows = [
    ...ft.FIELD_TYPES.map((type, index) => rf(field(`s${index}`, "sf-a", `k${index}`, type, {
      position: index,
      systemKey: type === "email" ? "email" : null,
    }), a)),
    rf(field("extra", "sf-b", "extra", "short_text", { label: "Extra" }), b),
  ];
  return rows;
};

const snapshotAnswers = () => {
  const answers = {};
  ft.FIELD_TYPES.forEach((type, index) => {
    const ok = Object.entries(NORM_CASES).find(([key]) => key === type)?.[1].ok[0];
    // The third element is the normalised answer — the shape a real submit
    // stores. The second is the raw browser value, which the snapshot never sees.
    if (!ok) answers[`k${index}`] = "unused";
    else answers[`k${index}`] = ok.length > 2 ? ok[2] : ok[1];
  });
  answers.extra = "typed";
  return answers;
};

const check6 = async (snapMod = snap) => {
  const problems = [];
  const fields = snapshotFields();
  const encoded = snapMod.encodeSnapshot(fields, snapshotAnswers(), "2026-10-26T00:00:00.000Z");

  if (encoded.fields.length !== fields.length) {
    problems.push(`the snapshot holds ${encoded.fields.length} entries for ${fields.length} fields`);
  }
  if (encoded.forms.length !== 2) problems.push(`the snapshot named ${encoded.forms.length} forms, expected 2`);
  const names = encoded.forms.map((entry) => `${entry.name}@${entry.version}`).join(",");
  if (names !== "Answers@3,More@1") problems.push(`the form versions recorded are ${names}`);
  if (encoded.resolvedAt !== "2026-10-26T00:00:00.000Z") problems.push("the caller's timestamp was not kept");

  const round = snapMod.parseSnapshot(JSON.parse(JSON.stringify(encoded)));
  if (!round) {
    problems.push("a freshly encoded snapshot did not parse");
    return verdict(problems);
  }
  if (round.fields.length !== encoded.fields.length) problems.push("the round trip lost entries");
  for (let i = 0; i < encoded.fields.length; i += 1) {
    if (!deepEqual(round.fields[i].value, encoded.fields[i].value)) {
      problems.push(`${encoded.fields[i].type} value changed across the round trip: ${JSON.stringify(encoded.fields[i].value)} → ${JSON.stringify(round.fields[i].value)}`);
    }
    if (round.fields[i].label !== encoded.fields[i].label) problems.push("a label was not carried");
  }
  // A file answer keeps the sanitised leaf, never a path.
  const fileEntry = round.fields.find((entry) => entry.type === "file");
  if (!fileEntry || fileEntry.value !== "cv.pdf") problems.push(`the file answer is ${JSON.stringify(fileEntry?.value)}`);
  const headingEntry = round.fields.find((entry) => entry.type === "section_heading");
  if (!headingEntry || headingEntry.value !== null) problems.push("a heading carried a value");

  // Malformed entries drop, one at a time, and the rest survive.
  const broken = [
    { key: "d1", label: "Duration", type: "duration", value: { value: 3 }, systemKey: null },
    { key: "d2", label: "Geo", type: "geolocation", value: { lat: 1 }, systemKey: null },
    { key: "d3", label: "Ghost", type: "rich_text", value: "x", systemKey: null },
    { key: "d4", label: "No value", type: "short_text", systemKey: null },
    { key: "d5", label: "   ", type: "short_text", value: "x", systemKey: null },
    { key: "", label: "Blank key", type: "short_text", value: "x", systemKey: null },
    "not an object",
    { key: "d7", label: "List", type: "multi_select", value: ["a", 2], systemKey: null },
    { key: "d8", label: "Scalar", type: "duration", value: "3 hours", systemKey: null },
    { key: "d9", label: "Held", type: "short_text", value: "kept", systemKey: null },
  ];
  const parsedBroken = snapMod.parseSnapshot({ fields: broken, forms: [{ id: "x", name: "X", version: 1 }], resolvedAt: "now" });
  const survived = parsedBroken?.fields.map((entry) => entry.key).join(",");
  if (survived !== "d9") problems.push(`a malformed snapshot left [${survived}], expected only d9`);
  if ((parsedBroken?.forms.length ?? 0) !== 1) problems.push("the forms list did not survive a broken field");

  if (snapMod.parseSnapshot(null) !== null) problems.push("parseSnapshot(null) answered");
  if (snapMod.parseSnapshot({}) !== null) problems.push("an object with no fields array parsed");
  if (!deepEqual(snapMod.parseSnapshot({ fields: [] }), { fields: [], forms: [] })) {
    problems.push("an empty layout did not parse to empty arrays");
  }

  // The §11 entry ceiling binds: 90 fields become 80.
  const many = [];
  for (let i = 0; i < 90; i += 1) {
    many.push(rf(field(`m${i}`, "sf-a", `m${i}`, "short_text"), form("sf-a", { name: "Answers" })));
  }
  const capped = snapMod.encodeSnapshot(many, {}, "2026-10-26T00:00:00.000Z");
  if (capped.fields.length !== LIMITS.form_answers_entries) {
    problems.push(`the snapshot held ${capped.fields.length} entries, expected ${LIMITS.form_answers_entries}`);
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 7. Every §11 ceiling, as a name.
// ---------------------------------------------------------------------------
const CEILINGS_BY_ROW = [
  ["Fields per form", "40", ["fields_per_form", 40]],
  ["`section_heading`s per form", "12", ["section_headings_per_form", 12]],
  ["Options per choice field", "30", ["options_per_choice_field", 30]],
  ["Files per field", "1", ["files_per_field", 1]],
  ["Global forms", "12", ["global_forms", 12]],
  ["Forms assigned per opening", "8", ["forms_assigned_per_opening", 8]],
  ["Resolved fields per application", "80", ["resolved_fields_per_application", 80]],
  ["`file` bytes", "10 MB", ["file_bytes", 10 * 1024 * 1024]],
  ["`photo` bytes", "5 MB", ["photo_bytes", 5 * 1024 * 1024]],
  ["Long text", "5,000 chars", ["long_text_chars", 5000]],
  ["`percentage`", "0–100, ≤ 2 dp", null, [
    ["percentage_min", 0], ["percentage_max", 100], ["percentage_decimals", 2],
  ]],
  ["`duration`", "value 1–9999", null, [
    ["duration_value_min", 1], ["duration_value_max", 9999],
  ]],
  ["`geolocation`", "≤ 6 dp", null, [
    ["geolocation_lat_range", [-90, 90]], ["geolocation_lng_range", [-180, 180]], ["geolocation_dp", 6],
  ]],
  ["`time`", "`HH:MM`", null, [["time_pattern", LIMITS.time_pattern]]],
  ["`form_answers` per row", "80 entries", ["form_answers_entries", 80]],
];

function specLimitRows() {
  const spec = read(SPEC);
  const start = spec.indexOf("## 11. Limits");
  if (start === -1) return [];
  const rest = spec.slice(start);
  const end = rest.indexOf("\n## ", 5);
  const section = end === -1 ? rest : rest.slice(0, end);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.startsWith("| ---") && !line.startsWith("| Thing"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

const check7 = async (limitsMod = { LIMITS }) => {
  const problems = [];
  const values = limitsMod.LIMITS;
  const rows = specLimitRows();
  if (rows.length !== CEILINGS_BY_ROW.length) {
    problems.push(`§11 has ${rows.length} rows, the proof pins ${CEILINGS_BY_ROW.length}`);
  }

  const covered = new Set(["orphan_upload_window_hours"]); // spec §8's constant, not a §11 row
  for (const [label, figure, single, multiple] of CEILINGS_BY_ROW) {
    const row = rows.find((cells) => cells[0] === label);
    if (!row) {
      problems.push(`§11 no longer has a "${label}" row`);
      continue;
    }
    if (!row[1].includes(figure)) {
      problems.push(`§11's "${label}" ceiling reads "${row[1]}", which does not name ${figure}`);
    }
    const pairs = single ? [single] : (multiple ?? []);
    for (const [key, expected] of pairs) {
      covered.add(key);
      if (!(key in values)) problems.push(`limits.ts does not name ${key}`);
      else if (!deepEqual(values[key], expected)) {
        problems.push(`${key} is ${JSON.stringify(values[key])} in limits.ts but §11 states ${JSON.stringify(expected)}`);
      }
    }
  }

  const declaredKeys = objectKeys(read("src/modules/form-builder/domain/limits.ts"), "export const LIMITS = {");
  if (declaredKeys.length !== 21) problems.push(`limits.ts declares ${declaredKeys.length} ceilings, expected 21`);
  for (const key of declaredKeys) {
    if (!covered.has(key) && !CEILINGS_BY_ROW.some(([, , single, multiple]) =>
      (single?.[0] === key) || (multiple ?? []).some(([name]) => name === key))) {
      problems.push(`${key} is in limits.ts but on no §11 row and not §8's orphan window`);
    }
  }

  // Enforced *by name*: every ceiling is read as `LIMITS.<key>` somewhere in the
  // portal rather than written as a number at the point of enforcement. The audit
  // looks for the NAME, not the value, so a ceiling of 0, 1 or 2 is audited
  // exactly like a ceiling of 40 — `percentage_min: 0` and `files_per_field: 1`
  // need no exemption. The one §11 ceiling with no name in the source is
  // `files_per_field`, and it is exempted because it is enforced structurally:
  // `src/app/careers/actions.ts` keeps one upload per field key in a Map, so a
  // second file for the same question is refused without ever consulting a
  // number. That is checked below rather than assumed.
  const exempt = { files_per_field: "src/app/careers/actions.ts" };
  for (const key of declaredKeys) {
    if (exempt[key]) continue;
    const refs = filesMentioning(`LIMITS.${key}`).filter((rel) => rel !== "src/modules/form-builder/domain/limits.ts");
    if (refs.length === 0) {
      problems.push(`${key} is never read by name — some caller wrote the number instead`);
    }
  }
  // The exemption is only honest if the structure it points at really refuses.
  const actions = codeOf(exempt.files_per_field);
  if (!/uploadsByField\.has\(/.test(actions) || !actions.includes("const uploadsByField = new Map")) {
    problems.push(`files_per_field leans on ${exempt.files_per_field}, whose single-upload map no longer refuses a second file`);
  }

  // And the ceilings are not inlined where they bind: a kind's own ceiling comes
  // from the name, eight times over.
  const kindRulesSource = codeOf("src/modules/form-builder/domain/field-types.ts");
  const namedCeilings = (kindRulesSource.match(/maxBytes: LIMITS\.file_bytes/g) ?? []).length;
  if (namedCeilings !== 8) problems.push(`${namedCeilings} of 8 kind rules take LIMITS.file_bytes by name`);
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 8. The binding map: registry authority, consent groups, appended rows.
// ---------------------------------------------------------------------------
const bindingLayout = (mod = rl) => {
  const globalForm = form("bl-g", { name: "Core", isGlobal: true, globalPosition: 0 });
  const assigned = form("bl-a", { name: "Extra" });
  return mod.resolveLayout({
    forms: [globalForm, assigned],
    fieldsByForm: {
      "bl-g": [
        field("n", "bl-g", "name", "short_text", { required: true, systemKey: "name" }),
        field("e", "bl-g", "email", "email", { required: true, systemKey: "email" }),
        field("a", "bl-g", "about", "long_text", { required: true, systemKey: "about" }),
        field("p", "bl-g", "tel", "short_text", { systemKey: "person:phone" }),
        field("s", "bl-g", "abilities", "multi_select", { systemKey: "person:skills" }),
      ],
      "bl-a": [
        field("h", "bl-a", "Family", "section_heading", { position: 0 }),
        field("q", "bl-a", "partner", "short_text", { systemKey: "person:partner_name", position: 1 }),
      ],
    },
    assignments: [{ jobId: JOB, formId: "bl-a", position: 0 }],
    jobId: JOB,
  });
};

const rf0 = (row, rowForm) => ({ field: row, form: rowForm });

const check8 = async (writerMod = writer, publicMod = pf, registryMod = registry) => {
  const problems = [];

  // (a) Every registry key's consent group is its own group, and nothing else answers.
  for (const entry of registryMod.PERSON_FIELDS) {
    let group;
    try {
      group = registryMod.consentPurposeFor(entry.key);
    } catch (cause) {
      problems.push(`consentPurposeFor("${entry.key}") threw: ${cause.message}`);
      continue;
    }
    if (group !== entry.group) problems.push(`${entry.key} resolves to ${group}, its registry group is ${entry.group}`);
  }
  let threw = false;
  try {
    registryMod.consentPurposeFor("not_a_registry_key");
  } catch {
    threw = true;
  }
  if (!threw) problems.push("consentPurposeFor answered a key the registry does not carry");

  // (b) The keys that append are exactly the registry's `list` keys.
  const listKeys = registryMod.PERSON_FIELDS.filter((entry) => entry.input === "list").map((entry) => entry.key);
  const collectionKeys = registryMod.PERSON_FIELDS
    .filter((entry) => registryMod.listCollectionFor(entry.key) !== null)
    .map((entry) => entry.key);
  if (!deepEqual([...listKeys].sort(), [...collectionKeys].sort())) {
    problems.push(`list keys [${listKeys}] and collection keys [${collectionKeys}] disagree`);
  }
  if (listKeys.length !== 7) problems.push(`${listKeys.length} list keys, expected 7`);
  const collections = listKeys.map((key) => registryMod.listCollectionFor(key));
  if (new Set(collections).size !== collections.length) problems.push(`two list keys share a collection: ${collections}`);

  // (c) The consent groups a layout needs are exactly the groups its bindings
  // belong to — and a layout with no bindings needs no box.
  const layout = bindingLayout();
  const projected = publicMod.project(layout);
  const expectedGroups = [];
  for (const { field: row } of layout.fields) {
    if (!row.systemKey?.startsWith("person:")) continue;
    const group = registryMod.consentPurposeFor(row.systemKey.slice("person:".length));
    if (!expectedGroups.includes(group)) expectedGroups.push(group);
  }
  if (!deepEqual(projected.consentGroups, expectedGroups)) {
    problems.push(`the projection asks [${projected.consentGroups}] for bindings in [${expectedGroups}]`);
  }
  if (!deepEqual([...expectedGroups].sort(), ["contact", "family_details", "skills"].sort())) {
    problems.push(`the fixture's bindings were expected to reach contact, skills and family_details, got [${expectedGroups}]`);
  }
  const noBindings = publicMod.project(cleanLayoutFor(rl));
  if (noBindings.consentGroups.length !== 0) {
    problems.push(`a layout with no bindings asked for ${noBindings.consentGroups.join(",")}`);
  }
  if (noBindings.steps.some((step) => step.consentGroups.length > 0)) {
    problems.push("a binding-free layout gave a step a box");
  }

  // (d) One answer, many rows: a `list` binding is the only binding that can
  // write more rows than answers, and the count is measured, not assumed.
  const listPool = poolFor({ values: {}, doors: {}, rows: {} });
  globalThis.__formPool = listPool;
  const listResult = await writerMod.applyPersonField(
    "person-1",
    [{
      key: "skills",
      value: [{ skill: "Arabic" }, { skill: "English" }, { skill: "Excel" }],
      door: "candidate_form",
      actorId: null,
      actorKind: "candidate",
    }],
    ALWAYS
  );
  if (!("applied" in listResult) || !listResult.applied.includes("skills")) {
    problems.push(`the three skills were not applied: ${JSON.stringify(listResult)}`);
  }
  const appends = listPool.count(/^insert into person_skills /);
  const events = listPool.count(/^insert into person_events /);
  if (appends !== 3) problems.push(`${appends} person_skills rows for three answers`);
  if (events !== 1) problems.push(`${events} events for one list answer`);

  const scalarPool = poolFor({ values: { phone: null }, doors: {} });
  globalThis.__formPool = scalarPool;
  await writerMod.applyPersonField(
    "person-1",
    [{ key: "phone", value: "01001234567", door: "candidate_form", actorId: null, actorKind: "candidate" }],
    ALWAYS
  );
  const writes = scalarPool.count(/^update person_profiles /);
  const scalarEvents = scalarPool.count(/^insert into person_events /);
  if (writes !== 1) problems.push(`${writes} column writes for one scalar answer`);
  if (scalarEvents !== 1) problems.push(`${scalarEvents} events for one scalar answer`);
  if (scalarPool.count(/^insert into person_skills /) !== 0) problems.push("a scalar binding appended rows");

  // A duplicated skill never becomes a second row.
  const dupPool = poolFor({ values: {}, doors: {}, rows: { person_skills: [{ skill: "Arabic" }] } });
  globalThis.__formPool = dupPool;
  const dupResult = await writerMod.applyPersonField(
    "person-1",
    [{ key: "skills", value: [{ skill: "arabic" }, { skill: "Excel" }], door: "candidate_form", actorId: null, actorKind: "candidate" }],
    ALWAYS
  );
  if (dupPool.count(/^insert into person_skills /) !== 1) {
    problems.push(`a duplicate skill appended ${dupPool.count(/^insert into person_skills /)} rows, expected one for Excel only`);
  }
  if (!("refused" in dupResult) || !dupResult.refused.some((entry) => /duplicates/.test(entry.reason))) {
    problems.push("the duplicate skill was not refused by name");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 9. The rung: a candidate's answer against what a recruiter's hand already holds.
// ---------------------------------------------------------------------------
const check9 = async (writerMod = writer, snapMod = snap) => {
  const problems = [];
  const PERSON = "11111111-1111-1111-1111-111111111111";

  const write = async (pool, value) => {
    globalThis.__formPool = pool;
    return writerMod.applyPersonField(
      PERSON,
      [{ key: "phone", value, door: "candidate_form", actorId: null, actorKind: "candidate" }],
      ALWAYS
    );
  };

  // Held by a recruiter's hand: the form loses, and the held value stands.
  const held = poolFor({ values: { phone: "01000000000" }, doors: { phone: "hand_record" } });
  const againstHand = await write(held, "02000000000");
  if (!("conflicts" in againstHand) || !againstHand.conflicts.some((c) => c.key === "phone" && c.winner === "held")) {
    problems.push("candidate_form overwrote a hand-recorded phone");
  }
  if (held.values.get("phone") !== "01000000000") problems.push("the held phone changed");

  // Empty: the candidate's answer applies.
  const empty = poolFor({ values: { phone: null }, doors: {} });
  const againstEmpty = await write(empty, "03000000000");
  if (!("applied" in againstEmpty) || !againstEmpty.applied.includes("phone")) {
    problems.push("candidate_form did not fill an empty phone");
  }
  if (empty.values.get("phone") !== "03000000000") problems.push("the empty phone was not written");

  // Held by a model reading a document: the candidate's answer wins.
  const extracted = poolFor({ values: { phone: "04000000000" }, doors: { phone: "cv_extraction" } });
  const againstModel = await write(extracted, "05000000000");
  if (!("applied" in againstModel) || !againstModel.applied.includes("phone")) {
    problems.push("candidate_form lost to a cv_extraction value");
  }
  if (extracted.values.get("phone") !== "05000000000") problems.push("the extracted phone stood over the candidate's own answer");

  // In all three, what the application says it was asked keeps the incoming answer.
  const a = form("rung", { name: "Rung" });
  const fields = [rf0(field("r1", "rung", "tel", "phone", { systemKey: "person:phone" }), a)];
  for (const value of ["02000000000", "03000000000", "05000000000"]) {
    const encoded = snapMod.encodeSnapshot(fields, { tel: value }, "2026-10-26T00:00:00.000Z");
    const round = snapMod.parseSnapshot(JSON.parse(JSON.stringify(encoded)));
    if (round?.fields[0]?.value !== value) {
      problems.push(`the snapshot holds ${JSON.stringify(round?.fields[0]?.value)}, not the answer ${value} the candidate gave`);
    }
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 10. Erasure finds the form's bytes, blanks the answers, and leaves the person.
// ---------------------------------------------------------------------------
const check10 = () => {
  const problems = [];
  const erasure = codeOf("src/modules/privacy/application/erasure.ts");
  const collect = blockBetween(erasure, "async function collectPaths(", "async function readPersonId");
  if (!collect.includes('.from("application_form_files")')) {
    problems.push("collectPaths no longer reads application_form_files, so an erased application keeps its uploaded bytes on disk");
  }
  if (!collect.includes('.eq("application_id", applicationId)')) {
    problems.push("collectPaths reads the form ledger without scoping it to the application");
  }

  const sql = currentSql(MIGRATION_044);
  const eraseBody = blockBetween(sql, "create or replace function public.erase_candidate_data", "$$;");
  if (!eraseBody) {
    problems.push("044 does not replace erase_candidate_data");
    return verdict(problems);
  }
  if (!eraseBody.includes("form_answers = null")) {
    problems.push("044's erase_candidate_data does not blank form_answers");
  }
  if (!eraseBody.includes("delete from public.application_form_files")) {
    problems.push("044's erase_candidate_data does not delete the upload ledger rows");
  }

  // The point: 043's column and the spine's to clear, so 044 must not reach it.
  if (eraseBody.includes("person_id = null")) {
    problems.push("044's erase_candidate_data nulls applications.person_id — that is 043's column and the spine's to clear");
  }
  // `currentSql` squashes the migration's whitespace, so the block is marked on
  // the squashed spellings — and the blanking must sit inside this one statement,
  // not merely somewhere in the function.
  const updateBlock = blockBetween(eraseBody, "update applications set full_name", "where id = p_application_id");
  if (!updateBlock.includes("form_answers = null")) {
    problems.push("form_answers is blanked somewhere other than the applications update");
  }
  if (updateBlock.includes("person_id")) problems.push("the applications update names person_id");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 11. The upload door resolves its constraints from the layout, not the request.
// ---------------------------------------------------------------------------
const check11 = () => {
  const problems = [];
  const route = codeOf("src/app/api/careers/form-upload/route.ts");

  const sent = [...route.matchAll(/form\.get\("([^"]+)"\)/g)].map((m) => m[1]).sort();
  if (!deepEqual(sent, ["fieldKey", "file", "jobId"])) {
    problems.push(`the body is read for [${sent}]; a fourth name means the client supplied a constraint`);
  }
  for (const needle of [
    "const layout = await resolveFormForJob(jobId);",
    "layout.fields.find((entry) => entry.field.key === fieldKey)",
    "const kinds = offeredKinds(field);",
    "const maxBytes = ceilingFor(field, kinds);",
    "matchedKinds(kinds, head)",
  ]) {
    if (!route.includes(needle)) problems.push(`the upload route no longer contains ${needle}`);
  }
  // The accept list is derived from the field, so a client-sent `accept` is not read.
  if (/accept/i.test(blockBetween(route, "form.get(\"jobId\")", "const layout = await resolveFormForJob"))) {
    problems.push("the upload route reads an accept list from the request body");
  }
  // And the ceiling is the smaller of the field's own and its kinds'.
  const ceilingFor = blockBetween(route, "function ceilingFor(", "function matchedKinds(");
  if (!ceilingFor.includes("Math.min") || !ceilingFor.includes("LIMITS.photo_bytes") || !ceilingFor.includes("LIMITS.file_bytes")) {
    problems.push("ceilingFor no longer takes the field's type ceiling and the kind ceilings together");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 12. The public projection carries no system key, config or registry key.
// ---------------------------------------------------------------------------
const PUBLIC_FIELD_KEYS = new Set([
  "key", "label", "help", "placeholder", "type", "required", "options", "accept", "maxBytes", "units",
  "width",
]);

const check12 = async (publicMod = pf, mod = rl) => {
  const problems = [];
  const declared = [...rawOf("src/modules/form-builder/application/publicForm.ts")
    .matchAll(/^ {2}(\w+)\???:/gm)]
    .map((m) => m[1]);
  const interfaceBody = blockBetween(
    rawOf("src/modules/form-builder/application/publicForm.ts"),
    "export interface PublicField {",
    "export interface PublicStep",
  );
  const interfaceKeys = [...interfaceBody.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
  if (interfaceKeys.length === 0) problems.push("PublicField was not readable");
  for (const key of interfaceKeys) {
    if (!PUBLIC_FIELD_KEYS.has(key)) problems.push(`PublicField declares ${key}, which is not on the allowed list`);
  }
  if (!declared.length) problems.push("publicForm.ts declares no two-space-indented members");

  const layout = mod.resolveLayout({
    forms: [form("pj", { name: "Project me", isGlobal: true, globalPosition: 0 })],
    fieldsByForm: {
      pj: [
        field("j1", "pj", "name", "short_text", { required: true, systemKey: "name", config: { maxLength: 40 } }),
        field("j2", "pj", "abilities", "multi_select", {
          systemKey: "person:skills",
          config: { options: ["Arabic", "English"], maxSelections: 2 },
        }),
        field("j3", "pj", "cv", "file", { required: true, systemKey: "cv", config: { kinds: ["pdf", "doc"] } }),
        field("j4", "pj", "face", "photo", { systemKey: "photo", config: { kinds: ["image"] } }),
        field("j5", "pj", "notice", "duration", { config: { units: ["weeks"] } }),
      ],
    },
    assignments: [],
    jobId: JOB,
  });
  if (layout.fields.length !== 5) problems.push(`the fixture resolved ${layout.fields.length} fields`);
  const projected = publicMod.project(layout);
  const json = JSON.stringify(projected);

  for (const forbidden of ["system_key", "systemKey", '"config"', "person:", "maxLength", "maxSelections", "kinds"]) {
    if (json.includes(forbidden)) problems.push(`the projection leaked ${forbidden}`);
  }
  const flat = projected.steps.flatMap((step) => step.fields);
  if (flat.length !== 5) problems.push(`the projection carried ${flat.length} fields, expected 5`);
  for (const entry of flat) {
    for (const key of Object.keys(entry)) {
      if (!PUBLIC_FIELD_KEYS.has(key)) problems.push(`${entry.key} crossed the boundary with ${key}`);
    }
  }

  // A registry key never becomes a field's public identity. The scan is on the
  // field keys and labels, not the whole JSON: `consentGroups` names groups on
  // purpose (spec §5 tells the browser a box is needed), and one of those group
  // names is spelled like a registry key.
  const identities = flat.flatMap((entry) => [entry.key, entry.label]);
  for (const entry of registry.PERSON_FIELDS) {
    if (identities.includes(entry.key)) {
      problems.push(`the registry key ${entry.key} crossed as a field's key or label`);
    }
  }

  // What the door does enforce crosses: the byte ceiling and the derived accept list.
  const cv = flat.find((entry) => entry.key === "cv");
  if (cv?.maxBytes !== LIMITS.file_bytes) problems.push(`the file field's ceiling is ${cv?.maxBytes}`);
  const face = flat.find((entry) => entry.key === "face");
  if (face?.maxBytes !== LIMITS.photo_bytes) problems.push(`the photo field's ceiling is ${face?.maxBytes}`);
  if (!cv?.accept?.includes("application/pdf")) problems.push("the file field's accept list is not derived from its kinds");
  if (face?.accept !== "image/jpeg,image/png,image/webp") problems.push(`a photo's accept list is ${face?.accept}`);
  const skills = flat.find((entry) => entry.key === "abilities");
  if (!deepEqual(skills?.options, ["Arabic", "English"])) problems.push("the offered options did not cross");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 13. `/forms` is a staff page, on the rail, in the Guide and on the live channel.
// ---------------------------------------------------------------------------
const check13 = () => {
  const problems = [];
  const nav = codeOf("src/modules/analytics/presentation/nav.ts");
  if (!nav.includes('{ href: "/forms"')) problems.push("/forms is not on the rail");
  const guide = codeOf("src/modules/shell/domain/pageGuide.ts");
  if (!guide.includes('"/forms": {')) problems.push("/forms has no Guide entry");
  const watch = codeOf("src/modules/live/domain/watch.ts");
  if (!watch.includes('area: "forms"')) problems.push("/forms is not a live area");
  if (!watch.includes('table: "application_forms"')) problems.push("the forms area watches no table");

  const staffSource = rawOf("src/lib/auth/staffRoutes.ts");
  const match = /export const STAFF_ROUTES[\s\S]*?=\s*\[([\s\S]*?)\]\s*as const/.exec(staffSource);
  if (!match) {
    problems.push("STAFF_ROUTES was not readable");
    return verdict(problems);
  }
  const listed = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (!listed.includes("/forms")) problems.push("/forms is not in STAFF_ROUTES — the idle sign-out and the candidate bounce stop applying to it");

  // The count is derived from the directory listing, never remembered.
  const pages = adminPageRoutes();
  if (!pages.includes("/forms")) problems.push("src/app/(admin)/forms has no page.tsx");
  if (pages.length !== listed.length) problems.push(`${pages.length} staff pages exist but STAFF_ROUTES lists ${listed.length}`);
  if (pages.length !== 19) problems.push(`the portal has ${pages.length} staff pages, expected 19`);
  const missing = pages.filter((page) => !listed.includes(page));
  const extra = listed.filter((page) => !pages.includes(page));
  if (missing.length) problems.push(`pages with no guard entry: ${missing.join(", ")}`);
  if (extra.length) problems.push(`guard entries with no page: ${extra.join(", ")}`);
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 14. `form_authoring` is a routable capability end to end.
// ---------------------------------------------------------------------------
const check14 = () => {
  const problems = [];
  const config = rawOf("src/lib/config.ts");
  const capabilities = unionMembers(config, "AiCapability");
  if (!capabilities.includes("form_authoring")) problems.push("form_authoring is not an AiCapability");
  const chains = blockBetween(config, "export const modelChains: Record<AiCapability, readonly string[]> = {", "} as const");
  if (!/^ {2}form_authoring: \[/m.test(chains)) problems.push("form_authoring has no model chain");
  // Every capability has a chain, or the routing console offers a switch that binds nothing.
  for (const capability of capabilities) {
    if (!new RegExp(`^ {2}${capability}: \\[`, "m").test(chains)) {
      problems.push(`${capability} is a capability with no chain`);
    }
  }
  if (blockBetween(config, "form_authoring: [", "]").includes("assistant:")) {
    problems.push("form_authoring's chain was not readable");
  }
  const console = codeOf("src/modules/settings/domain/providers.ts");
  if (!console.includes('{ id: "form_authoring"')) problems.push("the routing console does not offer form_authoring");
  const authoring = codeOf("src/modules/form-builder/infrastructure/formAuthoring.ts");
  if (!authoring.includes('capability: "form_authoring"')) problems.push("the AI draft path routes through no capability");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 15. The consent boxes are the wizard's, from the spine's notice file.
// ---------------------------------------------------------------------------
const check15 = () => {
  const problems = [];
  const consoleFiles = walk(path.join(root, "src/app/(admin)/forms"));
  if (consoleFiles.length === 0) {
    problems.push("the /forms console has no files");
    return verdict(problems);
  }
  for (const full of consoleFiles) {
    const source = stripCodeComments(readFileSync(full, "utf8"));
    for (const forbidden of ["ConsentBox", "consentGroups", "apply.consent."]) {
      if (source.includes(forbidden)) {
        problems.push(`${path.basename(full)} produces ${forbidden} — the boxes belong to the wizard, not the builder`);
      }
    }
    if (/export (function|const) ReviewStep/.test(source)) {
      problems.push(`${path.basename(full)} exports a Review step; the builder has no review step to give it`);
    }
  }

  const wizard = rawOf("src/app/careers/apply/[id]/DynamicApplyWizard.tsx");
  if (!wizard.includes("function ConsentBox")) problems.push("the dynamic wizard defines no ConsentBox");
  if (!wizard.includes('noticeFor')) problems.push("the box does not read the spine's notice file");
  if (!/noticeFor\(group\)/.test(wizard)) problems.push("the box does not resolve a notice per group");
  for (const member of ["notice.title", "notice.body", "notice.withdraw"]) {
    if (!wizard.includes(member)) problems.push(`the box does not render ${member} from the notice`);
  }
  if (!wizard.includes("entry.consentGroups.map")) problems.push("the per-group boxes are not produced from the projected layout");
  if (!wizard.includes("apply.consent.processing") || !wizard.includes("apply.consent.pool")) {
    problems.push("the dynamic wizard lost one of the two fixed consent boxes");
  }

  const review = rawOf("src/app/careers/apply/[id]/ApplyReviewStep.tsx");
  if (!/export function ReviewStep/.test(review)) problems.push("ApplyReviewStep no longer exports ReviewStep");
  if (!review.includes("apply.consent.processing") || !review.includes("apply.consent.pool")) {
    problems.push("the legacy review step lost a fixed consent box");
  }
  // The notice copy is the spine's file, not a string written in this slice.
  const notice = rawOf("src/modules/candidates/domain/person-notice.ts");
  for (const group of ["health", "family_details"]) {
    if (!new RegExp(`^ {2}${group}: \\{`, "m").test(notice)) problems.push(`the notice file carries no ${group} group`);
  }
  if (!/NOTICE_VERSION = "\d{4}-\d{2}-\d{2}"/.test(notice)) problems.push("the notice has no version");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 16. The dynamic submit merges the About answer AND the extracted CV.
// ---------------------------------------------------------------------------
const check16 = () => {
  const problems = [];
  const actions = codeOf("src/app/careers/actions.ts");
  const dynamic = blockBetween(actions, "function submitDynamic(", null);
  if (!dynamic) {
    problems.push("submitDynamic was not readable");
    return verdict(problems);
  }
  if (!dynamic.includes("? [about, linkedinLine, extractedCv]")) {
    problems.push("the dynamic cv_text no longer carries the About answer alongside the extracted CV");
  }
  if (!dynamic.includes("? [about, linkedinLine]") || !dynamic.includes(": [linkedinLine, extractedCv]")) {
    problems.push("the dynamic cv_text lost one of its two one-sided arms");
  }
  // The legacy door is untouched: both halves are pinned so neither silently changes the other.
  const legacyIndex = actions.indexOf("function submitLegacy(");
  const dynamicIndex = actions.indexOf("function submitDynamic(");
  if (legacyIndex === -1 || dynamicIndex === -1 || legacyIndex > dynamicIndex) {
    problems.push("submitLegacy is not the function it was before this slice");
    return verdict(problems);
  }
  const legacy = actions.slice(legacyIndex, dynamicIndex);
  if (!legacy.includes("finalCvText = extracted.text;")) {
    problems.push("the legacy overwrite at actions.ts's CV step is gone — this slice did not set out to change it");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 17. The bucket: 043's five surfaces unchanged, 044's three doors added.
// ---------------------------------------------------------------------------
const check17 = () => {
  const problems = [];
  const browserTypes = rawOf("src/app/(admin)/files/file-browser-types.ts");
  const bucketKeys = unionMembers(browserTypes, "BucketKey");
  if (!bucketKeys.includes("candidate-photos")) {
    problems.push("candidate-photos is not a BucketKey — a byte filed there is invisible to every reader");
  }
  const descriptors = [...blockBetween(browserTypes, "export const BUCKETS", "export function bucketInfo")
    .matchAll(/key: "([^"]+)"/g)].map((m) => m[1]);
  for (const key of bucketKeys) {
    if (!descriptors.includes(key)) problems.push(`${key} is a BucketKey with no descriptor`);
  }
  for (const key of descriptors) {
    if (!bucketKeys.includes(key)) problems.push(`the ${key} descriptor names a bucket the union does not carry`);
  }
  if (!descriptors.includes("candidate-photos")) problems.push("candidate-photos has no descriptor");

  // 043's: the config member, and the three staff policies.
  const config = codeOf("src/lib/config.ts");
  if (!config.includes('candidatePhotos: "candidate-photos"')) problems.push("config.ts no longer names the photo bucket");
  const sql043 = currentSql(MIGRATION_043);
  for (const [name, arm] of [
    ["staff upload candidate photos", "for insert to authenticated"],
    ["staff read candidate photos", "for select to authenticated"],
    ["staff delete candidate photos", "for delete to authenticated"],
  ]) {
    const block = policyBlock(sql043, name);
    if (!block) problems.push(`043 has no ${name} policy`);
    else if (!block.includes(arm) || !block.includes("bucket = 'candidate-photos'")) {
      problems.push(`the ${name} policy is not a staff arm on candidate-photos`);
    }
  }

  // 044's three: the anon door, the row reader, the ledger delete.
  const sql044 = currentSql(MIGRATION_044);
  const anon = policyBlock(sql044, "candidates upload photos");
  if (!anon) {
    problems.push("044 registers no anon insert policy on files — the public form cannot hand a byte over");
  } else {
    if (!anon.includes("for insert to anon")) problems.push("the candidate photo policy is not an anon insert");
    if (!anon.includes("bucket = 'candidate-photos'")) problems.push("the anon photo policy does not name the bucket");
    if (!anon.includes("split_part(path, '/', 1) = 'applications'")) {
      problems.push("the anon photo policy does not constrain the applications/ path prefix");
    }
  }

  const fileActions = codeOf("src/app/(admin)/files/actions.ts");
  const readBlock = blockBetween(fileActions, "async function mapFormUploads(", "async function ownersFor(");
  if (!readBlock.includes('.from("application_form_files")') || !readBlock.includes('.not("application_id", "is", null)')) {
    problems.push("ownersFor no longer reads claimed form upload rows, so a form byte reports unlinked");
  }
  // Both accessors are plain `async function` — the export would be a lie.
  const owners = blockBetween(fileActions, "async function ownersFor(", "async function fileOwner(");
  if (!owners.includes("mapFormUploads(restClient, bucket, map)")) {
    problems.push("the bucket's owner read is not reached from ownersFor");
  }
  const ledgerDelete = blockBetween(fileActions, "async function deleteFormUploadRows(", "async function unlinkReference(");
  if (!ledgerDelete.includes('.from("application_form_files")') || !ledgerDelete.includes(".delete()")) {
    problems.push("nothing deletes the ledger row when its byte goes");
  }
  const unlink = blockBetween(fileActions, "async function unlinkReference(", "function asRecord(");
  if (!unlink.includes("deleteFormUploadRows(restClient, bucket, path)")) {
    problems.push("unlinkReference does not clear the form ledger, so a snapshot filename outlives the photo");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 18. The orphan pass: its window, its order, and the switch it ignores.
// ---------------------------------------------------------------------------
const check18 = () => {
  const problems = [];
  const route = codeOf("src/app/api/cron/retention/route.ts");
  const sweep = blockBetween(route, "async function clearOrphanUploads(", "interface SweepSummary");
  if (!sweep) {
    problems.push("the retention route has no orphan pass");
    return verdict(problems);
  }
  if (!sweep.includes('.from("application_form_files")') || !sweep.includes('.is("application_id", null)')) {
    problems.push("the orphan pass does not read the unclaimed rows of the form ledger");
  }
  if (!sweep.includes("LIMITS.orphan_upload_window_hours")) {
    problems.push("the orphan window is a literal, not the name in limits.ts");
  }

  // Bytes before the row: a row deleted first would orphan the byte with no
  // ledger entry left to find it by.
  const removeAt = sweep.indexOf("store.remove(");
  const ledgerDeleteAt = /\.from\("application_form_files"\)\s*\.delete\(\)/.exec(sweep)?.index ?? -1;
  if (removeAt === -1) problems.push("the orphan pass removes no bytes through getFileStore().remove");
  if (ledgerDeleteAt === -1) problems.push("the orphan pass deletes no ledger row");
  if (removeAt !== -1 && ledgerDeleteAt !== -1 && ledgerDeleteAt < removeAt) {
    problems.push("the orphan pass deletes the row before removing the bytes");
  }
  if (!blockBetween(route, "const store =", "let removed").includes("await getFileStore()")) {
    problems.push("the orphan pass reaches for no store");
  }

  // And it runs before the switch is even read, while both existing passes sit behind it.
  const orphansAt = route.indexOf("clearOrphanUploads(service)");
  const switchAt = route.indexOf('getBoolSetting("privacy.retention_enabled"');
  if (orphansAt === -1) problems.push("the route never calls the orphan pass");
  if (switchAt === -1) problems.push("the retention switch was not found");
  if (orphansAt !== -1 && switchAt !== -1 && orphansAt > switchAt) {
    problems.push("the orphan pass is gated behind privacy.retention_enabled — switching the sweep off would keep stray personal bytes");
  }
  const afterSwitch = route.slice(switchAt);
  if (!afterSwitch.includes("if (!enabled)")) problems.push("the retention switch no longer gates the two existing passes");
  if (!afterSwitch.includes("for (const decision of pendingWarnings)") || !afterSwitch.includes("for (const decision of toErase.slice(0, batch))")) {
    problems.push("the warning or erasure pass moved outside the switch");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 19. The person write is last: after the application row exists.
// ---------------------------------------------------------------------------
const check19 = () => {
  const problems = [];
  const actions = codeOf("src/app/careers/actions.ts");
  const dynamic = blockBetween(actions, "function submitDynamic(", null);
  if (!dynamic) {
    problems.push("submitDynamic was not readable");
    return verdict(problems);
  }
  const insertAt = blockBetween(dynamic, "form_answers: snapshot,", "").length
    ? dynamic.indexOf("form_answers: snapshot,")
    : -1;
  if (insertAt === -1) {
    problems.push("the dynamic insert no longer writes form_answers");
    return verdict(problems);
  }
  const writeAt = dynamic.indexOf("await writePersonFromForm(");
  if (writeAt === -1) {
    problems.push("the dynamic submit writes no person fields");
    return verdict(problems);
  }
  if (writeAt < insertAt) {
    problems.push("the person write runs before the applications insert — a store failure there becomes a refused application");
  }

  const writerBlock = blockBetween(actions, "async function writePersonFromForm(", "function submitDynamic(");
  if (!writerBlock) {
    problems.push("writePersonFromForm was not readable");
    return verdict(problems);
  }
  if (!writerBlock.includes("applyPersonField(")) problems.push("writePersonFromForm calls no person writer");
  if (!/await defaultConsentChecker\(\)/.test(writerBlock)) {
    problems.push("the person write runs with no consent checker");
  }
  const doors = [...writerBlock.matchAll(/door: "([^"]+)"/g)].map((m) => m[1]);
  if (doors.length === 0) problems.push("the person write names no door");
  for (const door of new Set(doors)) {
    if (door !== "candidate_form") problems.push(`the public form writes through the ${door} door`);
  }
  if (!writerBlock.includes('consented: input.personConsents ?? {}') && !actions.includes("consented: input.personConsents ?? {}")) {
    problems.push("the consent ticks are not read from the submission");
  }
  // Every group is recorded, agreed or refused, so a decline is a fact and not an absence.
  if (!writerBlock.includes("recordPersonConsent(")) problems.push("the form records no consent row");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 20. rowLayout: three widths, one grid, and who refuses a shared row.
// ---------------------------------------------------------------------------
const ROW_LAYOUT_REL = "src/modules/form-builder/domain/rowLayout.ts";
const rowLayoutUrl = pathToFileURL(path.join(root, ROW_LAYOUT_REL)).href;

const ALWAYS_FULL = [
  "section_heading",
  "long_text",
  "file",
  "photo",
  "address",
  "geolocation",
];

const check20 = async (injected) => {
  let row;
  if (injected) {
    row = injected;
  } else {
    try {
      row = await import(rowLayoutUrl);
    } catch (cause) {
      return {
        pass: false,
        detail: `rowLayout.ts is not loadable: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }
  const problems = [];

  if (!deepEqual([...(row.FIELD_WIDTHS ?? [])], ["full", "half", "third"])) {
    problems.push(`FIELD_WIDTHS is ${JSON.stringify(row.FIELD_WIDTHS)}`);
  }
  if (row.GRID_COLUMNS !== 6) problems.push(`GRID_COLUMNS is ${row.GRID_COLUMNS}`);

  if (!row.ALWAYS_FULL_TYPES) {
    problems.push("rowLayout declares no ALWAYS_FULL_TYPES");
  } else if (!deepEqual([...row.ALWAYS_FULL_TYPES].sort(), [...ALWAYS_FULL].sort())) {
    problems.push(`the always-full set is ${JSON.stringify([...row.ALWAYS_FULL_TYPES].sort())}`);
  }

  const width = (type, config) => row.widthOf?.({ type, config });

  if (width("short_text", {}) !== "full") {
    problems.push("a field whose config names no width is not full — every form on the database today would move");
  }
  if (width("short_text", { width: "half" }) !== "half") problems.push("config.width=half did not reach the layout");
  if (width("short_text", { width: "third" }) !== "third") problems.push("config.width=third did not reach the layout");
  if (width("short_text", { width: "wide" }) !== "full") problems.push("an unknown width was taken at face value");
  if (width("short_text", { width: 2 }) !== "full") problems.push("a numeric width was taken at face value");
  if (width("short_text", null) !== "full") problems.push("a null config threw instead of defaulting to full");
  for (const type of ALWAYS_FULL) {
    if (width(type, { width: "half" }) !== "full") {
      problems.push(`a ${type} field was allowed half — its answer box would be cut in two`);
    }
  }

  // The classes are one map, written as literals so Tailwind's scanner sees them.
  if (!row.GRID_CLASS || !/grid/.test(row.GRID_CLASS) || !/grid-cols-6/.test(row.GRID_CLASS)) {
    problems.push(`GRID_CLASS is ${JSON.stringify(row.GRID_CLASS)}`);
  }
  for (const [name, mobile, desktop] of [
    ["full", "col-span-6", null],
    ["half", "col-span-6", "sm:col-span-3"],
    ["third", "col-span-6", "sm:col-span-2"],
  ]) {
    const cls = row.SPAN_CLASS?.[name];
    if (!cls) {
      problems.push(`SPAN_CLASS has no ${name}`);
      continue;
    }
    if (!cls.includes(mobile) || (desktop && !cls.includes(desktop))) {
      problems.push(`SPAN_CLASS.${name} is "${cls}"`);
    }
    if (cls.includes("${")) problems.push(`SPAN_CLASS.${name} is built by interpolation, so Tailwind never sees the class`);
  }
  if (!existsSync(path.join(root, ROW_LAYOUT_REL))) {
    problems.push("rowLayout.ts is not readable");
  } else {
    const raw = rawOf(ROW_LAYOUT_REL);
    for (const literal of ["col-span-6", "sm:col-span-3", "sm:col-span-2", "grid-cols-6"]) {
      if (!raw.includes(literal)) problems.push(`${literal} is not a literal in rowLayout.ts, so the CSS is never generated`);
    }
  }

  // Placing one field beside another is one contract: the widths the pair takes
  // and the sentence the author is told. A refusal has to name the side that
  // actually takes the whole row — the live proof caught a builder that blamed
  // the pairable field the drag was dropped on.
  const pair = (draggedType, draggedLabel, targetType, targetLabel, targetWidth) =>
    row.beside?.({
      dragged: { type: draggedType, label: draggedLabel },
      target: { type: targetType, label: targetLabel, width: targetWidth },
    });

  const ontoFull = pair("short_text", "First name", "phone", "Phone", "full");
  if (!ontoFull?.ok) {
    problems.push("two questions refused to share a row");
  } else {
    if (ontoFull.dragged !== "half" || ontoFull.target !== "half") {
      problems.push(`dropping beside a full field gave ${JSON.stringify([ontoFull.dragged, ontoFull.target])}`);
    }
    if (ontoFull.notice !== `"Phone" and "First name" are asked in one row.`) {
      problems.push(`the pairing sentence reads ${JSON.stringify(ontoFull.notice)}`);
    }
  }
  const ontoThird = pair("select", "Country", "date", "Birthday", "third");
  if (!ontoThird?.ok || ontoThird.dragged !== "third" || ontoThird.target !== "third") {
    problems.push(`dropping beside a third field gave ${JSON.stringify(ontoThird)}`);
  }

  const draggedTakesRow = pair("file", "CV", "url", "LinkedIn", "full");
  const draggedRefusal = typeof draggedTakesRow?.error === "string" ? draggedTakesRow.error : "";
  if (draggedTakesRow?.ok) {
    problems.push("an upload door was allowed beside a question");
  } else if (!draggedRefusal.includes('"CV"')) {
    problems.push(`the refusal did not name the field that takes the row: ${JSON.stringify(draggedRefusal)}`);
  } else if (draggedRefusal.includes("LinkedIn")) {
    problems.push(`the refusal blamed the pairable field it was dropped on: ${JSON.stringify(draggedRefusal)}`);
  }

  const targetTakesRow = pair("short_text", "First name", "section_heading", "Experience", "full");
  const targetRefusal = typeof targetTakesRow?.error === "string" ? targetTakesRow.error : "";
  if (targetTakesRow?.ok) {
    problems.push("a section heading accepted a field beside it");
  } else if (!targetRefusal.includes('"Experience"')) {
    problems.push(`the refusal did not name the row the drop landed on: ${JSON.stringify(targetRefusal)}`);
  }

  const bothTakeRow = pair("long_text", "About you", "address", "Home address", "full");
  const bothRefusal = typeof bothTakeRow?.error === "string" ? bothTakeRow.error : "";
  if (bothTakeRow?.ok) {
    problems.push("two whole-row fields were allowed in one row");
  } else if (!bothRefusal.includes('"Home address"')) {
    problems.push(`a double refusal named the dragged side first: ${JSON.stringify(bothRefusal)}`);
  }
  if (!/takes a whole row/.test(draggedRefusal + targetRefusal + bothRefusal)) {
    problems.push("the refusal does not say what the row is for");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 21. The width crosses to the browser, is refused at save, and is one map.
// ---------------------------------------------------------------------------
const WIDTH_SURFACES = [
  ["src/app/(admin)/forms/Canvas.tsx", ["GRID_CLASS", "SPAN_CLASS"]],
  ["src/app/(admin)/forms/Inspector.tsx", ["FIELD_WIDTHS", "ALWAYS_FULL_TYPES"]],
  ["src/app/(admin)/forms/FormsConsole.tsx", ["beside", "widthOf"]],
  ["src/app/careers/apply/[id]/DynamicApplyWizard.tsx", ["GRID_CLASS", "SPAN_CLASS"]],
];

const draftField = (key, type, config = {}) => ({
  key,
  type,
  label: `The ${key}`,
  helpText: null,
  placeholder: null,
  required: false,
  config,
  systemKey: null,
});

const check21 = (injected = {}) => {
  const layoutMod = injected.rl ?? rl;
  const publicMod = injected.pf ?? pf;
  const draftMod = injected.di ?? di;
  const problems = [];

  const layout = layoutMod.resolveLayout({
    forms: [form("wv", { name: "Width probe", isGlobal: true, globalPosition: 0 })],
    fieldsByForm: {
      wv: [
        field("w1", "wv", "first_name", "short_text", { config: { width: "half", maxLength: 40 } }),
        field("w2", "wv", "city_name", "short_text", { config: {} }),
        field("w3", "wv", "cv_file", "file", { config: { kinds: ["pdf"], width: "third" } }),
        field("w4", "wv", "years_exp", "number", { config: { width: "wide" } }),
        field("w5", "wv", "about_you", "long_text", { config: { width: "half" } }),
      ],
    },
    assignments: [],
    jobId: JOB,
  });
  const flat = publicMod.project(layout).steps.flatMap((step) => step.fields);
  if (flat.length !== 5) problems.push(`the probe resolved ${flat.length} fields`);
  const widthOfProjected = (key) => flat.find((entry) => entry.key === key)?.width;
  for (const key of flat.map((entry) => entry.key)) {
    if (widthOfProjected(key) === undefined) {
      problems.push(`${key} crossed with no width, so the browser cannot lay it out`);
    }
  }
  if (widthOfProjected("first_name") !== "half") problems.push(`first_name crossed as ${widthOfProjected("first_name")}`);
  if (widthOfProjected("city_name") !== "full") problems.push(`an unset width crossed as ${widthOfProjected("city_name")}`);
  if (widthOfProjected("cv_file") !== "full") problems.push(`the file field crossed as ${widthOfProjected("cv_file")} — its byte ceiling and door are its own`);
  if (widthOfProjected("years_exp") !== "full") problems.push(`the unusable width crossed as ${widthOfProjected("years_exp")}`);
  if (widthOfProjected("about_you") !== "full") problems.push(`the long-text field crossed as ${widthOfProjected("about_you")}`);

  const publicRaw = rawOf("src/modules/form-builder/application/publicForm.ts");
  const publicBody = blockBetween(publicRaw, "export interface PublicField {", "export interface PublicStep");
  if (!/^ {2}width:/m.test(publicBody)) problems.push("PublicField declares no width");

  // The editor refuses a width it cannot lay out, before the config is written.
  if (draftMod.draftIssues([draftField("first_name", "short_text", { width: "half" })]).length) {
    problems.push("a half-width short_text was refused");
  }
  if (!draftMod.draftIssues([draftField("years_exp", "number", { width: "wide" })]).length) {
    problems.push("draftIssues accepted a width that is not full, half or third");
  }
  if (!draftMod.draftIssues([draftField("cv_file", "file", { kinds: ["pdf"], width: "half" })]).length) {
    problems.push("draftIssues accepted a half-width file field");
  }
  if (!draftMod.draftIssues([draftField("about_you", "long_text", { width: "third" })]).length) {
    problems.push("draftIssues accepted a third-width long_text field");
  }

  // Both editors read the one map — no second copy of the grid in a component.
  for (const [rel, names] of WIDTH_SURFACES) {
    if (!existsSync(path.join(root, rel))) {
      problems.push(`${rel} is not readable`);
      continue;
    }
    const code = codeOf(rel);
    if (!code.includes('from "@/modules/form-builder/domain/rowLayout"')) {
      problems.push(`${rel} lays fields out without reading rowLayout.ts`);
    }
    for (const name of names) {
      if (!new RegExp(`\\b${name}\\b`).test(code)) problems.push(`${rel} never uses ${name}`);
    }
    if (/col-span/.test(code)) problems.push(`${rel} hardcodes a col-span class beside the one map in rowLayout.ts`);
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 22. cvAnswers: what a CV may be allowed to type into the form.
// ---------------------------------------------------------------------------
const CV_ANSWERS_REL = "src/modules/form-builder/domain/cvAnswers.ts";
const cvAnswersUrl = pathToFileURL(path.join(root, CV_ANSWERS_REL)).href;

/** An authored field, as the door sees it once the layout is resolved. */
const cvField = (key, type, config = {}, label = key) => ({
  key,
  type,
  label,
  help: null,
  config,
});

const check22 = async (injected) => {
  let cv;
  if (injected) {
    cv = injected;
  } else {
    try {
      cv = await import(cvAnswersUrl);
    } catch (cause) {
      return {
        pass: false,
        detail: `cvAnswers.ts is not loadable: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }
  const problems = [];

  // ——— the ask list ———
  const form = [
    cvField("full_name", "short_text", { maxLength: 80, width: "half" }, "Full name"),
    cvField("email", "email", {}, "Email"),
    cvField("country", "select", { options: ["Egypt", "UAE"] }, "Country"),
    cvField("cv_file", "file", { kinds: ["pdf"] }, "CV"),
    cvField("portrait", "photo", {}, "Photo"),
    cvField("agree_news", "checkbox", {}, "Newsletter"),
    cvField("office", "geolocation", {}, "Office location"),
    cvField("experience", "section_heading", {}, "Experience"),
  ];

  const listed = cv.cvAskList(form, []);
  if (!deepEqual(listed.map((ask) => ask.key), ["full_name", "email", "country"])) {
    problems.push(`the ask list is ${JSON.stringify(listed.map((ask) => ask.key))}`);
  }
  if (!deepEqual(cv.cvAskList(form, ["email"]).map((ask) => ask.key), ["full_name", "country"])) {
    problems.push("a key the candidate already answered stayed in the ask list");
  }

  // The ask carries the answer's shape and none of the author's settings.
  const askedJson = JSON.stringify(listed);
  for (const leak of ["width", "kinds", "system_key", "required", "config"]) {
    if (new RegExp(`"${leak}"`).test(askedJson)) {
      problems.push(`the ask list carries ${leak}, which the model has no business reading`);
    }
  }
  if (listed[0]?.maxLength !== 80) problems.push("a text field's ceiling did not reach the ask list");
  if (!deepEqual(listed[2]?.options, ["Egypt", "UAE"])) {
    problems.push(`the offered options did not reach the ask list: ${JSON.stringify(listed[2]?.options)}`);
  }
  if (cv.cvAskList([cvField("country", "select", {}, "Country")], []).length) {
    problems.push("a select the author left optionless was asked — nothing could validate its answer");
  }

  // ——— the answers accepted back ———
  const fields = [
    cvField("full_name", "short_text", { maxLength: 80 }, "Full name"),
    cvField("email", "email", {}, "Email"),
    cvField("phone", "phone", {}, "Phone"),
    cvField("birthday", "date", { max: "2020-01-01" }, "Date of birth"),
    cvField("salary", "number", { decimals: 2 }, "Expected salary"),
    cvField("country", "select", { options: ["Egypt", "UAE"] }, "Country"),
    cvField("langs", "multi_select", { options: ["Arabic", "English", "French"] }, "Languages"),
    cvField("about", "long_text", {}, "About you"),
    cvField("home", "address", { components: ["line1", "city", "country"] }, "Home address"),
    cvField("notice", "duration", { units: ["days", "weeks"] }, "Notice period"),
    cvField("cv_file", "file", { kinds: ["pdf"] }, "CV"),
    cvField("agree_news", "checkbox", {}, "Newsletter"),
  ];

  const filled = cv.acceptCvAnswers(fields, {
    full_name: "  Mahmoud Muslim  ",
    email: "MAHMOUD@Example.COM",
    phone: "+20 100 000 0000",
    birthday: "1994-06-15",
    salary: "45000.555",
    country: "Libya",
    langs: ["Arabic", "German"],
    about: "x".repeat(5_001),
    home: { line1: "12 Tahrir St", city: "Cairo", country: "Egypt", street: "not a component" },
    notice: { value: 30, unit: "days" },
    cv_file: "CV.pdf",
    agree_news: true,
    national_id: "51422",
  });

  const accepted = Object.keys(filled).sort();
  if (!deepEqual(accepted, ["birthday", "email", "full_name", "home", "notice", "phone"])) {
    problems.push(`the accepted answers are ${JSON.stringify(accepted)}`);
  }
  if (filled.full_name !== "Mahmoud Muslim") problems.push("a name was not trimmed");
  if (filled.email !== "mahmoud@example.com") problems.push("an email reached the form unnormalised");
  // The address box edits parts, so what it is handed must stay parts — the
  // normaliser's joined line is the snapshot's shape, not the input's.
  if (!deepEqual(filled.home, { line1: "12 Tahrir St", city: "Cairo", country: "Egypt" })) {
    problems.push(`the address answer is ${JSON.stringify(filled.home)}`);
  }

  // A blank is not an answer: it would read as filled and then fail `required`.
  for (const blank of [
    [cvField("full_name", "short_text", {}), { full_name: "   " }],
    [cvField("langs", "multi_select", { options: ["Arabic", "English"] }), { langs: [] }],
    [cvField("home", "address", {}), { home: { city: "  " } }],
  ]) {
    if (Object.keys(cv.acceptCvAnswers([blank[0]], blank[1])).length) {
      problems.push(`an empty ${blank[0].type} answer was kept — the step would call it answered`);
    }
  }

  // A value the normaliser refuses never reaches the browser, whatever it is.
  if (
    Object.keys(
      cv.acceptCvAnswers(
        [cvField("notice", "duration", { units: ["days", "weeks"] })],
        { notice: { value: 1, unit: "months" } }
      )
    ).length
  ) {
    problems.push("a duration in a unit the field does not offer was accepted");
  }
  if (
    Object.keys(
      cv.acceptCvAnswers([cvField("birthday", "date", { max: "2020-01-01" })], {
        birthday: "2025-01-01",
      })
    ).length
  ) {
    problems.push("a date after the field's own ceiling was accepted");
  }

  // And a door that hands back anything but an object answers with nothing.
  for (const garbage of [null, undefined, "Mahmoud", ["email"], 42]) {
    if (Object.keys(cv.acceptCvAnswers(fields, garbage)).length) {
      problems.push(`proposals of ${JSON.stringify(garbage) ?? "undefined"} produced answers`);
    }
  }

  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 23. The CV autofill door: same guards as the contact reader, one model call,
//     and a wizard that fills only what the candidate left blank.
// ---------------------------------------------------------------------------
const FORM_PREFILL_REL = "src/app/api/careers/form-prefill/route.ts";
const CV_FORM_READ_REL = "src/modules/careers/cv-form-answers.ts";
const WIZARD_REL = "src/app/careers/apply/[id]/DynamicApplyWizard.tsx";
const UPLOAD_BOX_REL = "src/app/careers/apply/[id]/fields/UploadBox.tsx";
const FIELD_TYPES_REL = "src/app/careers/apply/[id]/fields/types.ts";

const CV_FILL_KEYS = [
  "apply.dyn.cvFillButton",
  "apply.dyn.cvFillBusy",
  "apply.dyn.cvFillNoFile",
  "apply.dyn.cvFillNote",
];

const check23 = (injected = {}) => {
  const problems = [];
  const i18n = injected.i18n ?? staticI18n;

  if (!existsSync(path.join(root, FORM_PREFILL_REL))) {
    problems.push(`${FORM_PREFILL_REL} does not exist`);
  } else {
    const route = codeOf(FORM_PREFILL_REL);

    const sent = [...route.matchAll(/form\.get\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    if (!deepEqual(sent, ["file", "jobId"])) {
      problems.push(`the body is read for [${sent}]`);
    }
    if (!route.includes('form.getAll("skip")')) {
      problems.push("the keys the candidate already answered are not read from the body");
    }

    // Every guard that keeps a public door from costing a model call.
    const oversize = route.indexOf("oversizeUploadResponse(request, CV_MAX_BYTES)");
    const parsed = route.indexOf("await request.formData()");
    if (oversize === -1 || parsed === -1 || oversize > parsed) {
      problems.push("an oversize file is buffered and read before the byte ceiling refuses it");
    }
    for (const needle of [
      "isAcceptedCvType(",
      "cvContentError(",
      "cvSizeError(",
      'eq("status", "PUBLISHED")',
      "extractCvText(",
      "resolveFormForJob(jobId)",
      "cvAskList(",
      "acceptCvAnswers(",
    ]) {
      if (!route.includes(needle)) problems.push(`the form-prefill door no longer contains ${needle}`);
    }
    if (!/no-store/.test(route)) problems.push("the answers a model inferred are left cacheable");
    if (/system_key/.test(route)) problems.push("the door reads a registry key");
  }

  if (!existsSync(path.join(root, CV_FORM_READ_REL))) {
    problems.push(`${CV_FORM_READ_REL} does not exist`);
  } else {
    const reader = codeOf(CV_FORM_READ_REL);
    if (!reader.includes('capability: "resume_screening"')) {
      problems.push("the form read is not the screening capability the CV reader already uses");
    }
    for (const needle of ["temperature: 0", "jsonMode: true", "MAX_INPUT_CHARS"]) {
      if (!reader.includes(needle)) problems.push(`the CV form reader no longer contains ${needle}`);
    }
    // The gateway's own parser, generic and all — the model's JSON is never sliced
    // out by hand, the way the contact reader does it. Same line only, so the
    // import alone cannot satisfy it.
    if (!/parseJsonResponse[^(\n]*\(/.test(reader)) {
      problems.push("the CV form reader no longer parses through the gateway");
    }
    if (!/never guess/i.test(rawOf(CV_FORM_READ_REL))) {
      problems.push("the prompt no longer tells the model to leave out what the CV does not print");
    }
  }

  if (!existsSync(path.join(root, WIZARD_REL))) {
    problems.push(`${WIZARD_REL} does not exist`);
  } else {
    const wizard = codeOf(WIZARD_REL);
    for (const needle of [
      "/api/careers/form-prefill",
      "touched.current.add(",
      "touched.current.has(",
      "cvFile.current",
    ]) {
      if (!wizard.includes(needle)) problems.push(`the wizard no longer contains ${needle}`);
    }
    if (!wizard.includes('t("apply.dyn.cvFillButton")')) {
      problems.push("no step offers the candidate a fill from their CV");
    }
  }

  for (const [rel, needle, what] of [
    [UPLOAD_BOX_REL, "upload.onFile?.(file)", "the upload box"],
    [FIELD_TYPES_REL, "onFile", "the upload door's type"],
  ]) {
    if (!existsSync(path.join(root, rel))) problems.push(`${rel} does not exist`);
    else if (!codeOf(rel).includes(needle)) problems.push(`${what} no longer hands the file over (${needle})`);
  }

  for (const key of CV_FILL_KEYS) {
    const en = i18n.translate("en", key);
    const ar = i18n.translate("ar", key);
    if (en === key) problems.push(`${key} ships no English copy`);
    if (ar === key || ar === en || !ar.trim()) problems.push(`${key} ships no Arabic copy`);
  }

  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 24. The filed answers read back on the candidate's own row.
//
// Spec §"Live proof": "read the row back in `/candidates` and confirm the
// snapshot renders the questions as asked." The snapshot is only worth writing
// if a recruiter can read it, so this pins both halves — the dossier read that
// fetches and parses the column, and the drawer section that prints it.
// ---------------------------------------------------------------------------
const DOSSIER_ACTIONS_REL = "src/app/(admin)/candidates/dossier-actions.ts";
const DOSSIER_REL = "src/app/(admin)/candidates/CandidateDossier.tsx";

const check24 = async () => {
  const problems = [];
  for (const rel of [DOSSIER_ACTIONS_REL, DOSSIER_REL]) {
    if (!existsSync(path.join(root, rel))) problems.push(`${rel} does not exist`);
  }
  if (problems.length > 0) return verdict(problems);

  const actions = codeOf(DOSSIER_ACTIONS_REL);
  if (!actions.includes('parseSnapshot')) {
    problems.push("the dossier read does not import parseSnapshot");
  }
  // The select must ask for the column, not merely mention it in a comment.
  if (!actions.includes("gate_answers, form_answers, job_openings")) {
    problems.push("the dossier query does not select form_answers");
  }
  if (!/parseSnapshot\(\s*row\.form_answers\s*\)/.test(actions)) {
    problems.push("the dossier hands the raw jsonb on instead of parsing it");
  }
  if (!/form_answers:\s*snapshot/.test(actions)) {
    problems.push("no parsed form_answers reaches the dossier");
  }

  const dossier = codeOf(DOSSIER_REL);
  if (!dossier.includes("dossier.form_answers")) {
    problems.push("the drawer never reads dossier.form_answers");
  }
  for (const needle of ['"Form answers"', "Not answered", "section_heading", "snapshotAnswer(field)"]) {
    if (!dossier.includes(needle)) problems.push(`the drawer no longer renders ${needle}`);
  }
  // The version is what makes "as asked" a fact rather than a claim.
  if (!/\.version/.test(dossier)) {
    problems.push("the drawer does not print the form version the answers were filed against");
  }

  return verdict(problems);
};

// ---------------------------------------------------------------------------
// The checks, in the spec's own numbering.
// ---------------------------------------------------------------------------
const CHECKS = [
  ["1. resolveLayout: globals then assignments, every tie ending at an id", check1],
  ["2. A key or binding held twice names both forms", check2],
  ["3. Every identity-contract refusal, each from its own fixture", check3],
  ["4. normaliseAnswer for all 21 types, and 044's own type CHECK", check4],
  ["5. The eight kinds, their MIME lists, signatures and ceilings", check5],
  ["6. The snapshot round-trip, and a parser that drops rather than guesses", check6],
  ["7. Every §11 ceiling enforced by name, not by an inline number", check7],
  ["8. The binding map, the consent groups, and the rows a list appends", check8],
  ["9. The rung: what a candidate's answer may and may not overwrite", check9],
  ["10. Erasure finds the form bytes, blanks the answers, leaves the person", check10],
  ["11. The upload door resolves its constraints from the layout", check11],
  ["12. The public projection stops at key, label, type and the answer's shape", check12],
  ["13. /forms is the nineteenth staff page, on the rail, Guide and live channel", check13],
  ["14. form_authoring routes from the catalogue to the AI call", check14],
  ["15. The consent boxes are the wizard's, in the spine's own words", check15],
  ["16. The dynamic cv_text merges both halves; the legacy door is untouched", check16],
  ["17. candidate-photos: 043's five surfaces, 044's three doors", check17],
  ["18. The orphan pass sweeps unclaimed uploads, bytes first, ungated", check18],
  ["19. The person write runs last, on one door, behind a consent checker", check19],
  ["20. rowLayout: three widths, six types that never sit beside, the pairing sentence", check20],
  ["21. The width reaches the browser, is refused at save, and has one map", check21],
  ["22. cvAnswers: the ask list a CV is read against, and the answers it may leave", check22],
  ["23. The CV autofill door, the model read behind it, and the wizard that keeps its blanks", check23],
  ["24. The filed answers read back on the candidate's own row", check24],
];

const ENTRY = Object.fromEntries(CHECKS.map(([name, fn], index) => [index + 1, { name, fn }]));

// ---------------------------------------------------------------------------
// Mutation proofs
// ---------------------------------------------------------------------------
const mutated = (url) => import(`${url}?mutate=${Date.now()}`);

/** A needle written with `\n` must still match a source file saved with CRLF. */
const withFileEol = (text, source) =>
  source.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;

async function mutation(label, rel, needle, replacement, verify) {
  const file = path.join(root, rel);
  const original = readFileSync(file, "utf8");
  const from = withFileEol(needle, original);
  const to = withFileEol(replacement, original);
  if (!original.includes(from)) {
    mutations.push({ label, pass: false, detail: `needle not found in ${rel}` });
    return;
  }
  try {
    srcCache = null;
    writeFileSync(file, original.replace(from, to));
    const outcome = await verify();
    mutations.push({ label, ...outcome });
  } catch (cause) {
    mutations.push({ label, pass: false, detail: `threw: ${cause instanceof Error ? cause.message : String(cause)}` });
  } finally {
    srcCache = null;
    writeFileSync(file, original);
  }
}

/** The same, for a mutation that needs two ordered edits in one file. */
async function mutationEdits(label, rel, edits, verify) {
  const file = path.join(root, rel);
  const original = readFileSync(file, "utf8");
  const pairs = edits.map(([from, to]) => [withFileEol(from, original), withFileEol(to, original)]);
  if (pairs.some(([from]) => !original.includes(from))) {
    mutations.push({ label, pass: false, detail: `an edit needle was not found in ${rel}` });
    return;
  }
  try {
    srcCache = null;
    let text = original;
    for (const [from, to] of pairs) text = text.replace(from, to);
    writeFileSync(file, text);
    const outcome = await verify();
    mutations.push({ label, ...outcome });
  } catch (cause) {
    mutations.push({ label, pass: false, detail: `threw: ${cause instanceof Error ? cause.message : String(cause)}` });
  } finally {
    srcCache = null;
    writeFileSync(file, original);
  }
}

const checkIsRed = async (number, run = ENTRY[number].fn) => {
  const outcome = await safe(run);
  return {
    pass: outcome.pass === false,
    detail: outcome.pass === false ? `${ENTRY[number].name} stayed green` : undefined,
  };
};

const RESOLVE_REL = "src/modules/form-builder/domain/resolveLayout.ts";
const IDENTITY_REL = "src/modules/form-builder/domain/identityIssues.ts";
const LIMITS_REL = "src/modules/form-builder/domain/limits.ts";
const ERASURE_REL = "src/modules/privacy/application/erasure.ts";
const UPLOAD_REL = "src/app/api/careers/form-upload/route.ts";
const STAFF_ROUTES_REL = "src/lib/auth/staffRoutes.ts";
const ACTIONS_REL = "src/app/careers/actions.ts";
const BROWSER_TYPES_REL = "src/app/(admin)/files/file-browser-types.ts";
const RETENTION_REL = "src/app/api/cron/retention/route.ts";
const WRITER_REL = "src/modules/candidates/application/personWriter.ts";
const PUBLIC_FORM_REL = "src/modules/form-builder/application/publicForm.ts";
const DRAFT_ISSUES_REL = "src/modules/form-builder/domain/draftIssues.ts";
const CANVAS_REL = "src/app/(admin)/forms/Canvas.tsx";

// 1. The two assignment orders swapped → check 1 red.
await mutation(
  "1. Assigned forms placed before globals → check 1 red",
  RESOLVE_REL,
  "const ordered = [...globals, ...assigned.map((entry) => entry.form)];",
  "const ordered = [...assigned.map((entry) => entry.form), ...globals];",
  async () => checkIsRed(1, async () => check1(await mutated(resolveUrl)))
);

// 2. A renamed key so two forms no longer collide → check 2 red.
await mutation(
  "2. The duplicate-key owner map keyed by something the lookup never asks for → check 2 red",
  RESOLVE_REL,
  "        keyOwner.set(row.key, form.name);",
  "        keyOwner.set(row.key + \"__x\", form.name);",
  async () => checkIsRed(2, async () => check2(await mutated(resolveUrl)))
);

// 3. The cv-or-about clause dropped → check 3 red.
await mutation(
  "3. A form that asks for neither a CV nor an About publishes → check 3 red",
  IDENTITY_REL,
  "if (cvFields.length === 0 && aboutFields.length === 0) {",
  "if (false) {",
  async () => checkIsRed(3, async () => check3(await mutated(identityUrl)))
);

// 4. A ceiling one higher than §11 states → check 7 red.
await mutation(
  "4. resolved_fields_per_application widened to 81 → check 7 red",
  LIMITS_REL,
  "  resolved_fields_per_application: 80,",
  "  resolved_fields_per_application: 81,",
  async () => {
    const mod = await mutated(limitsUrl);
    return checkIsRed(7, () => check7({ LIMITS: mod.LIMITS }));
  }
);

// 5. The form-ledger read deleted from collectPaths → check 10 red.
await mutation(
  "5. Erasure stops reading the form ledger → check 10 red",
  ERASURE_REL,
  `  const { data: formFiles, error: formError } = await service
    .from("application_form_files")
    .select("bucket, storage_path")
    .eq("application_id", applicationId);
`,
  "",
  () => checkIsRed(10)
);

// 6. The upload door fed a client-sent accept list → check 11 red.
await mutation(
  "6. The upload route takes its kinds from the request body → check 11 red",
  UPLOAD_REL,
  "  const kinds = offeredKinds(field);",
  "  const kinds = String(form.get(\"kinds\") ?? \"pdf\").split(\",\") as Kind[];",
  () => checkIsRed(11)
);

// 7. `/forms` removed from STAFF_ROUTES → check 13 red.
await mutation(
  "7. /forms dropped from the staff-route table → check 13 red",
  STAFF_ROUTES_REL,
  '  "/forms",\n',
  "",
  () => checkIsRed(13)
);

// 8. The About answer dropped from the merged cv_text → check 16 red.
await mutation(
  "8. The dynamic cv_text forgets the About answer → check 16 red",
  ACTIONS_REL,
  "      ? [about, linkedinLine, extractedCv]",
  "      ? [linkedinLine, extractedCv]",
  () => checkIsRed(16)
);

// 9. `candidate-photos` out of BucketKey while its descriptor stays → check 17 red.
await mutation(
  "9. A bucket that exists on disk but is not a BucketKey → check 17 red",
  BROWSER_TYPES_REL,
  '  | "candidate-photos";',
  ";",
  () => checkIsRed(17)
);

// 10. The orphan pass deletes the row before removing the bytes → check 18 red.
await mutation(
  "10. The orphan pass unlinks the metadata and leaves the photo on disk → check 18 red",
  RETENTION_REL,
  "    const gone = await store.remove({ bucket: row.bucket, paths: [row.storage_path] });",
  `    await service
      .from("application_form_files")
      .delete()
      .eq("id", row.id);
    const gone = await store.remove({ bucket: row.bucket, paths: [row.storage_path] });`,
  () => checkIsRed(18)
);

// 11. The orphan pass put back behind the retention switch → check 18 red.
await mutation(
  "11. The orphan pass quietly gated behind a switch that ships off → check 18 red",
  RETENTION_REL,
  "  const orphans = await clearOrphanUploads(service);",
  "  const enabled = await getBoolSetting(\"privacy.retention_enabled\", false);\n  const orphans = await (enabled ? clearOrphanUploads(service) : Promise.resolve({ available: true, scanned: 0, removed: 0, failed: 0 }));",
  () => checkIsRed(18)
);

// 12. The person write moved above the applications insert → check 19 red.
await mutationEdits(
  "12. A person write that can veto an application by running first → check 19 red",
  ACTIONS_REL,
  [
    [`  // Last, and after the row exists: a person write may be refused or fail and
  // the application still stands (spec §5, §9).
  if (personId) {
    await writePersonFromForm({
      personId,
      layout,
      normalised,
      uploadsByField,
      consented: input.personConsents ?? {},
    });
  }

`, ""],
    ["  const snapshot = encodeSnapshot(", `  if (personId) {
    await writePersonFromForm({
      personId,
      layout,
      normalised,
      uploadsByField,
      consented: input.personConsents ?? {},
    });
  }

  const snapshot = encodeSnapshot(`],
  ],
  () => checkIsRed(19)
);

// 13. 044's rewrite nulls applications.person_id → check 10 red.
await mutation(
  "13. 044 clears a column the spine owns → check 10 red",
  MIGRATION_044,
  "         cv_file_path = null,",
  "         cv_file_path = null,\n         person_id = null,",
  () => checkIsRed(10)
);

// 14. `candidate_form` promoted to the top rung → check 9 red.
await mutation(
  "14. An anonymous door promoted into the authority to rewrite a stranger's profile → check 9 red",
  WRITER_REL,
  "  candidate_form: 20,",
  "  candidate_form: 50,",
  async () => checkIsRed(9, async () => check9(await mutated(writerUrl), snap))
);

// 15. A health-group binding marked required publishes → check 3 red.
await mutation(
  "15. A consent-gated binding allowed to be required → check 3 red",
  IDENTITY_REL,
  "    if (f.field.required && reg.tier === 3) {",
  "    if (false) {",
  async () => checkIsRed(3, async () => check3(await mutated(identityUrl)))
);

// 16. The anon files insert policy deleted while the bucket stays registered → check 17 red.
await mutation(
  "16. The public upload door has no policy → check 17 red",
  MIGRATION_044,
  `drop policy if exists "candidates upload photos" on public.files;
create policy "candidates upload photos" on public.files
  for insert to anon
  with check (
    bucket = 'candidate-photos'
    and split_part(path, '/', 1) = 'applications'
  );`,
  "",
  () => checkIsRed(17)
);

// 17. An eighth name added to 044's type CHECK with no normaliser → check 4 red.
await mutation(
  "17. A type the schema stores and the code cannot normalise → check 4 red",
  MIGRATION_044,
  "    'file','photo','address','geolocation','section_heading')),",
  "    'file','photo','address','geolocation','section_heading','rich_text')),",
  () => checkIsRed(4)
);

// 18. A `duration` field allowed to carry a person binding → check 3 red.
await mutation(
  "18. duration dropped from the unbindable set → check 3 red",
  IDENTITY_REL,
  'export const UNBINDABLE_TYPES: ReadonlySet<FieldType> = new Set(["time", "percentage", "duration", "geolocation"]);',
  'export const UNBINDABLE_TYPES: ReadonlySet<FieldType> = new Set(["time", "percentage", "geolocation"]);',
  async () => checkIsRed(3, async () => check3(await mutated(identityUrl)))
);

// 19. A long-text answer allowed into a half row → check 20 red.
await mutation(
  "19. long_text dropped from the always-full set → check 20 red",
  ROW_LAYOUT_REL,
  `export const ALWAYS_FULL_TYPES: ReadonlySet<FieldType> = new Set([
  "section_heading",
  "long_text",
  "file",`,
  `export const ALWAYS_FULL_TYPES: ReadonlySet<FieldType> = new Set([
  "section_heading",
  "file",`,
  async () => checkIsRed(20, async () => check20(await mutated(rowLayoutUrl)))
);

// 20. A field that names no width no longer reads as full → check 20 red.
await mutation(
  "20. The no-width fallback flipped to half, so every form already on the database moves → check 20 red",
  ROW_LAYOUT_REL,
  `  return (FIELD_WIDTHS as readonly string[]).includes(String(raw))
    ? (raw as FieldWidth)
    : "full";`,
  `  return (FIELD_WIDTHS as readonly string[]).includes(String(raw))
    ? (raw as FieldWidth)
    : "half";`,
  async () => checkIsRed(20, async () => check20(await mutated(rowLayoutUrl)))
);

// 21. A half field given no mobile span → check 20 red.
await mutation(
  "21. SPAN_CLASS.half narrowed to the desktop break, so a phone gets two boxes in one row → check 20 red",
  ROW_LAYOUT_REL,
  '  half: "col-span-6 sm:col-span-3",',
  '  half: "sm:col-span-3",',
  async () => checkIsRed(20, async () => check20(await mutated(rowLayoutUrl)))
);

// 22. `beside` stops refusing an always-full partner → check 20 red.
await mutation(
  "22. The pairing rule asks nothing about the two types → check 20 red",
  ROW_LAYOUT_REL,
  `  if (ALWAYS_FULL_TYPES.has(input.target.type)) {
    return { ok: false, error: wholeRowSentence(input.target) };
  }
  if (ALWAYS_FULL_TYPES.has(input.dragged.type)) {
    return { ok: false, error: wholeRowSentence(input.dragged) };
  }`,
  "",
  async () => checkIsRed(20, async () => check20(await mutated(rowLayoutUrl)))
);

// 26. The refusal names the dragged side first, so a drop onto a heading is
//     blamed on the question rather than on the row it landed on → check 20 red.
await mutation(
  "26. The pairing refusal blames the wrong half of the pair → check 20 red",
  ROW_LAYOUT_REL,
  `  if (ALWAYS_FULL_TYPES.has(input.target.type)) {
    return { ok: false, error: wholeRowSentence(input.target) };
  }
  if (ALWAYS_FULL_TYPES.has(input.dragged.type)) {
    return { ok: false, error: wholeRowSentence(input.dragged) };
  }`,
  `  if (ALWAYS_FULL_TYPES.has(input.dragged.type)) {
    return { ok: false, error: wholeRowSentence(input.dragged) };
  }
  if (ALWAYS_FULL_TYPES.has(input.target.type)) {
    return { ok: false, error: wholeRowSentence(input.target) };
  }`,
  async () => checkIsRed(20, async () => check20(await mutated(rowLayoutUrl)))
);

// 23. The width dropped from the projection → check 21 red.
await mutation(
  "23. The width never crosses the projection, so the candidate's page lays every field full → check 21 red",
  PUBLIC_FORM_REL,
  "    width: widthOf(field),\n",
  "",
  async () => checkIsRed(21, async () => check21({ pf: await mutated(publicUrl) }))
);

// 24. The editor's width guard switched off → check 21 red.
await mutation(
  "24. Save accepts a width the grid cannot lay out → check 21 red",
  DRAFT_ISSUES_REL,
  "    if (width !== undefined && width !== null && width !== \"\") {",
  "    if (false) {",
  async () => checkIsRed(21, async () => check21({ di: await mutated(draftIssuesUrl) }))
);

// 25. The console ships its own grid class → check 21 red.
await mutation(
  "25. The builder hardcodes a full row beside the one map → check 21 red",
  CANVAS_REL,
  "              SPAN_CLASS[widthOf(field)],",
  '              "col-span-6",',
  () => checkIsRed(21)
);

// 27. An answer the field's own normaliser refused is filed anyway → check 22 red.
await mutation(
  "27. A model's answer goes into the form without passing the field's normaliser → check 22 red",
  CV_ANSWERS_REL,
  "    if (!normalised.ok) continue;",
  "    if (false) continue;",
  async () => checkIsRed(22, async () => check22(await mutated(cvAnswersUrl)))
);

// 28. A blank is kept as an answer → check 22 red.
await mutation(
  "28. An empty answer is filed, so the step calls the field answered and the door refuses it → check 22 red",
  CV_ANSWERS_REL,
  "    if (isEmptyAnswer(field.type, normalised.value)) continue;",
  "    if (false) continue;",
  async () => checkIsRed(22, async () => check22(await mutated(cvAnswersUrl)))
);

// 29. The model's raw output goes straight back to the browser → check 23 red.
await mutation(
  "29. A proposal skips the field that asks for it, and reaches the page unjudged → check 23 red",
  FORM_PREFILL_REL,
  "    const answers = acceptCvAnswers(fields, proposals);",
  "    const answers = proposals;",
  () => checkIsRed(23, async () => check23())
);

// 30. The byte ceiling read after the buffer → check 23 red.
await mutation(
  "30. The form is parsed before the Content-Length ceiling is asked, so a 40 MB file costs the read → check 23 red",
  FORM_PREFILL_REL,
  `  const oversize = oversizeUploadResponse(request, CV_MAX_BYTES);
  if (oversize) return oversize;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read that file." }, { status: 400 });
  }`,
  `  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read that file." }, { status: 400 });
  }

  const oversize = oversizeUploadResponse(request, CV_MAX_BYTES);
  if (oversize) return oversize;`,
  () => checkIsRed(23, async () => check23())
);

// 31. Both readings of the touched set vanish → check 23 red. One `mutation`
//     cannot do it: it replaces the first occurrence, and the set is read twice.
await mutationEdits(
  "31. The wizard fills over what the candidate typed → check 23 red",
  WIZARD_REL,
  [
    [
      "  return answerableFields(entry, answers).filter((field) => !touched.current.has(field.key));",
      "  return answerableFields(entry, answers);",
    ],
    ["        if (touched.current.has(field.key)) {", "        if (false) {"],
  ],
  () => checkIsRed(23, async () => check23())
);

// 32. The upload box keeps the bytes to itself → check 23 red.
await mutation(
  "32. The attached CV never reaches the wizard, so the button has nothing to read → check 23 red",
  UPLOAD_BOX_REL,
  "      upload.onFile?.(file);",
  "      void 0;",
  () => checkIsRed(23, async () => check23())
);

// 33. One Arabic line of the four deleted → check 23 red. The missing key falls
//     back to English, which is exactly the silence this guard refuses to accept.
await mutation(
  "33. A fill button with no Arabic copy ships the English words to an Arabic page → check 23 red",
  "src/lib/i18n.ts",
  '  "apply.dyn.cvFillButton": "املأ من سيرتي الذاتية",\n',
  "",
  async () => checkIsRed(23, async () => check23({ i18n: await mutated(i18nUrl) }))
);

// 34. The dossier query stops asking for the snapshot → check 24 red. The
//     drawer then shows only the four fixed columns of a pre-044 application.
await mutation(
  "34. The dossier read drops the snapshot column, so the filed questions vanish → check 24 red",
  DOSSIER_ACTIONS_REL,
  "gate_answers, form_answers, job_openings",
  "gate_answers, job_openings",
  () => checkIsRed(24, async () => check24())
);

// 35. The answers are fetched but never printed → check 24 red. Both the
//     duration pair and the blank-answer wording disappear with this line.
await mutation(
  "35. The drawer maps the snapshot but prints an empty cell instead of the answer → check 24 red",
  DOSSIER_REL,
  "                    {snapshotAnswer(field)}",
  "                    {null}",
  () => checkIsRed(24, async () => check24())
);

// ---------------------------------------------------------------------------
// Run the twenty-four checks
// ---------------------------------------------------------------------------
for (const [name, fn] of CHECKS) {
  results.push({ name, ...(await safe(fn)) });
}

const failed = results.filter((entry) => !entry.pass);
const mutationsHeld = mutations.filter((entry) => entry.pass).length;

for (const entry of results) {
  if (!entry.pass) console.log(`FAIL ${entry.name}\n     ${entry.detail}`);
}
for (const entry of mutations) {
  if (!entry.pass) console.log(`FAIL mutation — ${entry.label}\n     ${entry.detail}`);
}

console.log(`\n${results.length - failed.length} checks passed`);
console.log(`${mutationsHeld}/${mutations.length} mutation proofs held`);

if (failed.length > 0 || mutationsHeld !== mutations.length) process.exitCode = 1;
