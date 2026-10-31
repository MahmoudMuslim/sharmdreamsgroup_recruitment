/* scripts/prove-person-spine.mjs
 * Run: node --env-file=docker/.env --experimental-strip-types scripts/prove-person-spine.mjs
 *
 * Nothing here needs a database, a browser or a model. What is pinned is the
 * person-profile spine's correctness boundary: the registry as the only key
 * source, the precedence ladder, the consent gate, the date-of-birth bend, the
 * extraction validator, the career arithmetic, the migration's own constraints,
 * the erasure and backfill, the four boundary trees that must never read a
 * Tier-3 fact or a photo, the photo bucket's five surfaces, the three new
 * permissions, and the staff-route count.
 *
 * `db/migrations/043_person_profile_spine.sql` is APPLIED on this local database,
 * and checks 9–16 are still text pins against that file (comments stripped,
 * whitespace squashed), not assertions against a live schema.
 *
 * The nine mutation proofs are real edits: each one breaks a file, re-runs the
 * check that must notice, and restores the file in a `finally`. A mutation that
 * does not turn its check red fails the proof.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// ---------------------------------------------------------------------------
// Module resolution: the `@/` alias, extensionless siblings, and four stubs.
//
// The writer and the extractor reach `server-only`, the service REST client and
// the privileged pg pool through dynamic imports. Those are seams, not subjects:
// this proof supplies its own in-memory pool and REST builder so the real
// `applyPersonField` / `defaultConsentChecker` code runs without a database.
// ---------------------------------------------------------------------------
const STUB_SOURCES = {
  "server-only": "export {};",
  "@/lib/auth/db": "export const getAuthPool = () => globalThis.__spinePool;",
  "@/lib/data-api/service": "export const getServiceRestClient = () => globalThis.__spineRest;",
  "@/modules/screening/infrastructure/aiGateway": `
    export class AiGatewayError extends Error {}
    export class TruncatedJsonResponseError extends Error {}
    export async function complete() {
      throw new Error("aiGateway stub: complete() must not run in this proof");
    }
    export function parseJsonResponse() {
      throw new Error("aiGateway stub: parseJsonResponse() must not run in this proof");
    }
  `,
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
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const MIGRATION = "db/migrations/043_person_profile_spine.sql";
// Read fresh per check: three mutation proofs edit this file, and a snapshot
// taken at load time would keep answering with the unmutated text.
const currentSql = () => squash(stripComments(read(MIGRATION)));

function blockBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start === -1) return "";
  const end = endNeedle ? source.indexOf(endNeedle, start + startNeedle.length) : -1;
  return source.slice(start, end === -1 ? source.length : end);
}

/** The quoted values of a `constraint NAME check (... in (...))` list. */
function sqlCheckValues(migrationText, constraint) {
  const re = new RegExp(`constraint ${constraint} check \\(\\s*[a-z_]+ in \\(([^)]*)\\)`);
  const match = re.exec(migrationText);
  return match ? [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
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

// ---------------------------------------------------------------------------
// In-memory seams
// ---------------------------------------------------------------------------

/** The REST builder the consent checker sees. One table: person_consents. */
function restClient({ consentRow = null, consentError } = {}) {
  const calls = [];
  function answer(call) {
    if (call.table !== "person_consents") {
      throw new Error(`rest stub: unexpected table ${call.table}`);
    }
    const row = typeof consentRow === "function" ? consentRow(call) : consentRow;
    const error =
      consentError !== undefined
        ? consentError
        : row === null
          ? { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }
          : null;
    return { data: row, error };
  }
  const client = {
    calls,
    from(table) {
      const call = { table, select: null, filters: [], order: [], limit: null };
      calls.push(call);
      const builder = {
        select(columns) { call.select = columns; return builder; },
        eq(column, value) { call.filters.push([column, value]); return builder; },
        order(column, options) { call.order.push([column, options]); return builder; },
        limit(count) { call.limit = count; return builder; },
        single() { return Promise.resolve(answer(call)); },
        maybeSingle() { return Promise.resolve(answer(call)); },
        then(resolve, reject) { return Promise.resolve(answer(call)).then(resolve, reject); },
      };
      return builder;
    },
  };
  return client;
}

/**
 * The privileged pool the writer sees. It models exactly the four scalar
 * statements `applyPersonField` issues (read column, read held door, update
 * column, insert event) and throws on anything else — a proof that silently
 * accepted unhandled SQL would be proving nothing.
 */
function poolFor({ values = {}, doors = {} } = {}) {
  const heldValues = new Map(Object.entries(values));
  const heldDoors = new Map(Object.entries(doors));
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
      throw new Error(`pool stub: unhandled SQL — ${text}`);
    },
    release() {},
  };

  return {
    client,
    values: heldValues,
    doors: heldDoors,
    events,
    queries,
    connect: async () => client,
  };
}

const ALWAYS = { consentAlive: async () => true };
const NEVER = { consentAlive: async () => false };

// ---------------------------------------------------------------------------
// The modules under test
// ---------------------------------------------------------------------------
const fieldsFile = path.join(root, "src/modules/candidates/domain/person-fields.ts");
const fieldsUrl = pathToFileURL(fieldsFile).href;
const pf = await import(fieldsUrl);
const writer = await import(pathToFileURL(path.join(root, "src/modules/candidates/application/personWriter.ts")).href);
const indicators = await import(pathToFileURL(path.join(root, "src/modules/candidates/domain/careerIndicators.ts")).href);
const extractor = await import(pathToFileURL(path.join(root, "src/modules/candidates/infrastructure/cvProfileExtract.ts")).href);
const notice = await import(pathToFileURL(path.join(root, "src/modules/candidates/domain/person-notice.ts")).href);

const PERSON_TABLES = [
  "person_profiles",
  "person_health",
  "person_family_details",
  "person_dependants",
  "person_emergency_contacts",
  "person_emails",
  "person_languages",
  "person_education",
  "person_employment",
  "person_skills",
  "person_certifications",
  "person_consents",
  "person_events",
];

async function writeOne(pool, key, value, door, consent = ALWAYS) {
  globalThis.__spinePool = pool;
  return writer.applyPersonField(
    "11111111-1111-1111-1111-111111111111",
    [{ key, value, door, actorId: null, actorKind: door === "cv_extraction" ? "extractor" : "staff" }],
    consent
  );
}

// ---------------------------------------------------------------------------
// 1. The registry is the only key source.
// ---------------------------------------------------------------------------
const check1 = async (fields = pf) => {
  const problems = [];
  const source = read("src/modules/candidates/domain/person-fields.ts");
  const collections = unionMembers(source, "PersonCollection");
  const groups = unionMembers(source, "PersonFieldGroup");

  if (fields.personField("not_a_registry_key") !== null) {
    problems.push("an unknown key resolved to a field");
  }
  const seen = new Set();
  for (const field of fields.PERSON_FIELDS) {
    if (seen.has(field.key)) problems.push(`${field.key} is registered twice`);
    seen.add(field.key);
    if (!PERSON_TABLES.includes(field.table)) {
      problems.push(`${field.key} names table ${field.table}, which is not one of the thirteen`);
    }
    if (field.collection !== undefined && !collections.includes(field.collection)) {
      problems.push(`${field.key} names collection ${field.collection}, which is not in PersonCollection`);
    }
    if (!groups.includes(field.group)) {
      problems.push(`${field.key} names group ${field.group}, which is not in PersonFieldGroup`);
    }
  }

  // The unknown key is refused BEFORE the consent gate: a checker that throws
  // proves the gate is not consulted for a key the registry does not carry.
  const pool = poolFor({ values: { phone: "0100" } });
  globalThis.__spinePool = pool;
  const outcome = await writer.applyPersonField(
    "person-1",
    [{ key: "not_a_registry_key", value: "x", door: "hand_record", actorId: null, actorKind: "staff" }],
    { consentAlive: async () => { throw new Error("consent must not be read for an unknown key"); } }
  );
  if (!("refused" in outcome) || !outcome.refused.some((r) => r.key === "not_a_registry_key" && /is not a registry key/.test(r.reason))) {
    problems.push("an unknown key was not refused before consent");
  }
  if (pool.queries.length > 0) {
    problems.push("an unknown key reached SQL");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 2. The ladder: six rungs, and the three behaviours the rungs encode.
// ---------------------------------------------------------------------------
const check2 = async () => {
  const problems = [];
  const writerSource = read("src/modules/candidates/application/personWriter.ts");
  const block = /export const PRECEDENCE: Record<Door, number> = \{([\s\S]*?)\n\};/.exec(writerSource);
  const parsed = block
    ? Object.fromEntries([...block[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]))
    : {};

  const sqlDoors = sqlCheckValues(currentSql(), "person_events_door_check");
  const expectedDoors = sqlDoors.filter((door) => door !== "merge").sort();
  const parsedDoors = Object.keys(parsed).sort();
  if (expectedDoors.length !== 6) problems.push(`person_events_door_check named ${expectedDoors.length} non-merge doors`);
  if (expectedDoors.join(",") !== parsedDoors.join(",")) {
    problems.push(`PRECEDENCE keys [${parsedDoors}] do not equal the SQL doors minus merge [${expectedDoors}]`);
  }

  const expectedRungs = {
    privacy_page: 40,
    hand_record: 30,
    profile_edit: 30,
    candidate_form: 20,
    cv_extraction: 10,
    system: 5,
  };
  for (const [door, rung] of Object.entries(expectedRungs)) {
    if (parsed[door] !== rung) problems.push(`${door} is rung ${parsed[door]}, expected ${rung}`);
  }
  if (!(parsed.privacy_page > parsed.hand_record && parsed.hand_record === parsed.profile_edit)) {
    problems.push("the human rungs are out of order");
  }
  if (!(parsed.profile_edit > parsed.candidate_form && parsed.candidate_form > parsed.cv_extraction && parsed.cv_extraction > parsed.system)) {
    problems.push("the doors below the human rungs are out of order");
  }

  // cv_extraction fills an empty field and may never overwrite one.
  const fill = poolFor({ values: { phone: null } });
  const firstFill = await writeOne(fill, "phone", "0100", "cv_extraction");
  const secondFill = await writeOne(fill, "phone", "0200", "cv_extraction");
  if (!("applied" in firstFill) || !firstFill.applied.includes("phone")) {
    problems.push("cv_extraction did not fill an empty field");
  }
  if (!("conflicts" in secondFill) || !secondFill.conflicts.some((c) => c.key === "phone")) {
    problems.push("cv_extraction overwrote a held field instead of conflicting");
  }

  // Equal rungs overwrite, and both sides are recorded in the event.
  const equal = poolFor({ values: { phone: null } });
  const byHand = await writeOne(equal, "phone", "0300", "hand_record");
  const byEdit = await writeOne(equal, "phone", "0400", "profile_edit");
  if (!("applied" in byHand) || !byHand.applied.includes("phone")) problems.push("hand_record did not write an empty phone");
  if (!("applied" in byEdit) || !byEdit.applied.includes("phone")) problems.push("profile_edit (equal rung) did not overwrite");
  const editEvent = equal.events[equal.events.length - 1];
  if (!editEvent || editEvent.oldValue !== "0300" || editEvent.newValue !== "0400") {
    problems.push("the equal-rung event did not record both sides");
  }

  // hand_record beats candidate_form, and candidate_form cannot beat it back.
  const handWins = poolFor({ values: { phone: null } });
  await writeOne(handWins, "phone", "0500", "candidate_form");
  const handAfter = await writeOne(handWins, "phone", "0600", "hand_record");
  if (!("applied" in handAfter) || !handAfter.applied.includes("phone")) {
    problems.push("hand_record did not overwrite candidate_form");
  }
  const handHeld = poolFor({ values: { phone: null } });
  await writeOne(handHeld, "phone", "0700", "hand_record");
  const formAfter = await writeOne(handHeld, "phone", "0800", "candidate_form");
  if (!("conflicts" in formAfter) || !formAfter.conflicts.some((c) => c.key === "phone")) {
    problems.push("candidate_form overwrote hand_record");
  }

  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 3. Fourteen groups are fourteen consent purposes, and fifteen event groups.
// ---------------------------------------------------------------------------
const check3 = () => {
  const problems = [];
  const sql = currentSql();
  const source = read("src/modules/candidates/domain/person-fields.ts");
  const groups = unionMembers(source, "PersonFieldGroup");
  const purposes = sqlCheckValues(sql, "person_consents_purpose_check");
  const eventGroups = sqlCheckValues(sql, "person_events_field_group_check");

  if (groups.length !== 14) problems.push(`PersonFieldGroup has ${groups.length} members, expected 14`);
  if (purposes.length !== 14) problems.push(`person_consents_purpose_check has ${purposes.length} values, expected 14`);
  if (groups.slice().sort().join(",") !== purposes.slice().sort().join(",")) {
    problems.push(`registry groups [${groups.slice().sort()}] do not equal consent purposes [${purposes.slice().sort()}]`);
  }
  const expectedEventGroups = [...purposes, "merge"].sort();
  if (eventGroups.length !== 15) problems.push(`person_events_field_group_check has ${eventGroups.length} values, expected 15`);
  if (eventGroups.slice().sort().join(",") !== expectedEventGroups.join(",")) {
    problems.push("person_events_field_group_check is not the consent purposes plus merge");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 4. date_of_birth: human-set is immutable except on the privacy page.
// ---------------------------------------------------------------------------
const check4 = async () => {
  const problems = [];
  const pool = poolFor({ values: { date_of_birth: null } });

  const first = await writeOne(pool, "date_of_birth", "1990-01-01", "hand_record");
  if (!("applied" in first) || !first.applied.includes("date_of_birth")) {
    problems.push("the first human date_of_birth was not accepted");
  }
  for (const door of ["profile_edit", "candidate_form", "cv_extraction"]) {
    const refused = await writeOne(pool, "date_of_birth", "1991-02-02", door);
    const named = "refused" in refused && refused.refused.some((r) => r.key === "date_of_birth" && /immutable/.test(r.reason));
    if (!named) problems.push(`${door} was allowed to change a human-set date_of_birth`);
  }
  const byPrivacy = await writeOne(pool, "date_of_birth", "1992-03-03", "privacy_page");
  if (!("applied" in byPrivacy) || !byPrivacy.applied.includes("date_of_birth")) {
    problems.push("the privacy page was refused a date_of_birth correction");
  }
  if (pool.values.get("date_of_birth") !== "1992-03-03") {
    problems.push("the privacy-page correction did not land");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 5. Consent: newest row wins, the notice must be current, and refusal names
//    the group (certifications shares `skills`).
// ---------------------------------------------------------------------------
const check5 = async () => {
  const problems = [];
  const checker = await writer.defaultConsentChecker();

  const cases = [
    ["absent", null, false],
    ["refused", { granted: false, notice_version: notice.NOTICE_VERSION }, false],
    ["withdrawn (a later granted = false row)", { granted: false, notice_version: notice.NOTICE_VERSION }, false],
    ["given against an older notice", { granted: true, notice_version: "2025-01-01" }, false],
    ["live", { granted: true, notice_version: notice.NOTICE_VERSION }, true],
  ];
  for (const [label, row, expected] of cases) {
    const client = restClient({ consentRow: row });
    globalThis.__spineRest = client;
    const alive = await checker.consentAlive("person-1", "identity");
    if (alive !== expected) problems.push(`${label} read ${alive}, expected ${expected}`);
    const call = client.calls[0];
    if (!call) {
      problems.push(`${label} did not query person_consents`);
      continue;
    }
    if (call.table !== "person_consents") problems.push(`${label} read ${call.table}, expected person_consents`);
    if (call.select !== "granted, notice_version") problems.push(`${label} selected ${call.select}`);
    if (!call.filters.some(([column, value]) => column === "person_id" && value === "person-1")) {
      problems.push(`${label} did not filter on the person`);
    }
    if (!call.filters.some(([column, value]) => column === "purpose" && value === "identity")) {
      problems.push(`${label} did not filter on the purpose`);
    }
    if (call.order[0]?.[0] !== "recorded_at" || call.order[0]?.[1]?.ascending !== false) {
      problems.push(`${label} did not read newest-first`);
    }
    if (call.limit !== 1) problems.push(`${label} did not limit to one row`);
  }

  // A missing table is not an absent consent: it must name the migration.
  globalThis.__spineRest = restClient({ consentError: { code: "42P01", message: "relation does not exist" } });
  try {
    await checker.consentAlive("person-1", "identity");
    problems.push("a missing person_consents table read as an absent consent");
  } catch (cause) {
    if (!/migration 043/.test(String(cause?.message ?? ""))) {
      problems.push("a missing person_consents table did not name migration 043");
    }
  }

  // The writer refuses and names the group; certifications carries `skills`.
  const pool = poolFor({ values: {} });
  const refused = await writeOne(pool, "certifications", [{ title: "AWS" }], "hand_record", NEVER);
  const named =
    "refused" in refused &&
    refused.refused.some((r) => r.key === "certifications" && /"skills"/.test(r.reason) && /Nothing was saved/.test(r.reason));
  if (!named) problems.push("a consent refusal did not name the skills group");
  if (pool.queries.length > 0) problems.push("a consent refusal still reached SQL");

  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 6. No Tier-3 key is extractable.
// ---------------------------------------------------------------------------
const check6 = (fields = pf) => {
  const problems = [];
  const tier3 = fields.fieldsForTier(3).map((field) => field.key);
  if (tier3.length === 0) problems.push("the registry reports no Tier-3 fields");
  const extractable = fields.extractableFieldKeys();
  if (extractable.length === 0) problems.push("the extractable vocabulary is empty");
  for (const key of tier3) {
    if (extractable.includes(key)) problems.push(`Tier-3 key ${key} is extractable`);
  }
  for (const key of extractable) {
    if (!fields.personField(key)) problems.push(`extractable key ${key} is not in the registry`);
  }
  if (new Set(extractable).size !== extractable.length) problems.push("the extractable vocabulary repeats a key");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 7. Career indicators: the fixture, plus one precisely measured gap.
// ---------------------------------------------------------------------------
const check7 = () => {
  const problems = [];
  const got = indicators.computeCareerIndicators(indicators.FIXTURE.roles, indicators.FIXTURE.now);
  if (!deepEqual(got, indicators.FIXTURE.expect)) {
    problems.push(`the fixture result changed: ${JSON.stringify(got)}`);
  }
  const oneGap = indicators.computeCareerIndicators(
    [
      { employer: "A", startYear: 2020, startMonth: 1, endYear: 2020, endMonth: 12, ongoing: false },
      { employer: "B", startYear: 2021, startMonth: 1, endYear: 2021, endMonth: 12, ongoing: false },
    ],
    new Date(Date.UTC(2022, 0, 1))
  );
  if (oneGap.gapMonthsTotal !== 1.02 || oneGap.longestGapMonths !== 1.02) {
    problems.push(`a one-month gap measured ${oneGap.gapMonthsTotal} / ${oneGap.longestGapMonths}, expected 1.02`);
  }
  const ongoing = indicators.computeCareerIndicators(
    [{ employer: "C", startYear: 2026, startMonth: 8, endYear: null, endMonth: null, ongoing: true }],
    new Date(Date.UTC(2026, 9, 1))
  );
  if (ongoing.totalMonths !== 2 || ongoing.coverage.withEnd !== 1) {
    problems.push(
      `an ongoing role from 2026-08 to now measured ${ongoing.totalMonths} with ${ongoing.coverage.withEnd} known ends, expected 2 and 1`
    );
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 8. The extractor validator drops forbidden keys and never invents a level.
// ---------------------------------------------------------------------------
const check8 = (fields = pf) => {
  const problems = [];
  for (const key of fields.extractableFieldKeys()) {
    const field = fields.personField(key);
    if (!field || field.tier !== 1) problems.push(`extractable key ${key} is not Tier 1`);
  }

  const result = extractor.validateExtractedPersonProfile({
    marital_status: "married",
    nationality: "Egyptian",
    experience: [{ employer: "Acme", start_year: 2019 }],
    skills: [{ skill: "React", proficiency: 9 }],
  });
  for (const dropped of ["marital_status", "nationality", "skills[].proficiency"]) {
    if (!result.dropped.includes(dropped)) problems.push(`the validator did not name ${dropped}`);
  }
  if (result.value.skills.length !== 1 || result.value.skills[0].skill !== "React") {
    problems.push("an out-of-range skill level dropped the skill instead of the level");
  }
  if (result.value.skills[0]?.proficiency !== null) {
    problems.push("an out-of-range skill level was written rather than nulled");
  }
  if (result.value.experience.length !== 1 || result.value.experience[0].startYear !== 2019) {
    problems.push("a valid employment row did not survive validation");
  }

  // 043's person_education_level_check only accepts its eight-stage vocabulary.
  // The model reports free text ("Bachelor of Islamic Studies"), so the
  // validator must map it before the row can ever reach the store — and an
  // unstated or unrecognised stage must land in "other", never be guessed.
  const education = extractor.validateExtractedPersonProfile({
    education: [
      { institution: "Al-Azhar University", level: "Bachelor of Islamic Studies in Urdu" },
      { institution: "Cairo University", level: "Master of Science" },
      { institution: "Unknown Institute", level: "Higher National Widgetry" },
      { institution: "Unstated Institute" },
    ],
  });
  const stages = education.value.education.map((row) => row.level);
  if (stages[0] !== "bachelor") {
    problems.push(`a stated "Bachelor…" level was stored as "${stages[0]}", not the checked vocabulary`);
  }
  if (stages[1] !== "master") {
    problems.push(`a stated "Master…" level was stored as "${stages[1]}", not the checked vocabulary`);
  }
  if (stages[2] !== "other" || stages[3] !== "other") {
    problems.push(`unstated levels were stored as ${JSON.stringify([stages[2], stages[3]])}, not "other"`);
  }
  if (!education.value.education[0]?.asWritten.startsWith("Bachelor of Islamic Studies in Urdu")) {
    problems.push("the as-written line lost the CV's own wording when the level was normalised");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 9. person_emails stores a lowercased address, enforced by the store.
// ---------------------------------------------------------------------------
const check9 = () => {
  const sql = currentSql();
  return verdict(
    sql.includes("constraint person_emails_email_is_lower_check check (email = lower(email))")
      ? []
      : ["the lower(email) CHECK is missing from person_emails"]
  );
};

// ---------------------------------------------------------------------------
// 10. One primary address per person, enforced by a partial unique index.
// ---------------------------------------------------------------------------
const check10 = () => {
  const sql = currentSql();
  return verdict(
    sql.includes(
      "create unique index if not exists person_emails_one_primary_idx on public.person_emails (person_id) where is_primary;"
    )
      ? []
      : ["person_emails_one_primary_idx is missing or no longer partial"]
  );
};

// ---------------------------------------------------------------------------
// 11. Employment dates: no end before start, and an ongoing role has no end.
// ---------------------------------------------------------------------------
const check11 = () => {
  const problems = [];
  const sql = currentSql();
  if (!sql.includes("constraint person_employment_no_end_before_start_check check (")) {
    problems.push("person_employment_no_end_before_start_check is missing");
  }
  if (!sql.includes("end_year is null or end_year >= start_year")) {
    problems.push("the no-end-before-start expression is missing");
  }
  if (!sql.includes("constraint person_employment_ongoing_has_no_end_check check (")) {
    problems.push("person_employment_ongoing_has_no_end_check is missing");
  }
  if (!sql.includes("not (ongoing and (end_year is not null or end_month is not null))")) {
    problems.push("the ongoing-has-no-end expression is missing");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 12. Claim lists are case-folded at the store, not refilled on re-extraction.
// ---------------------------------------------------------------------------
const check12 = () => {
  const problems = [];
  const sql = currentSql();
  if (
    !sql.includes(
      "create unique index if not exists person_skills_person_skill_idx on public.person_skills (person_id, lower(skill));"
    )
  ) {
    problems.push("person_skills_person_skill_idx is missing or no longer lower(skill)");
  }
  if (
    !sql.includes(
      "create unique index if not exists person_certifications_person_title_idx on public.person_certifications (person_id, lower(title), lower(coalesce(issuer, '')));"
    )
  ) {
    problems.push("person_certifications_person_title_idx is missing or no longer case-folded");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 13. A certification year and title are bounded by the store.
// ---------------------------------------------------------------------------
const check13 = () => {
  const problems = [];
  const sql = currentSql();
  if (!sql.includes("constraint person_certifications_year_check check (year is null or (year between 1950 and 2200))")) {
    problems.push("person_certifications_year_check is missing");
  }
  if (
    !sql.includes(
      "constraint person_certifications_title_length_check check (char_length(title) between 1 and 160)"
    )
  ) {
    problems.push("person_certifications_title_length_check is not 1..160");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 14. Each Tier-3 read needs its own grant; history is gated by field_group.
// ---------------------------------------------------------------------------
const check14 = () => {
  const problems = [];
  const sql = currentSql();
  const readPolicies = [
    ["person_health_staff_read", "candidates.view_health_data"],
    ["person_family_details_staff_read", "candidates.view_family_data"],
    ["person_dependants_staff_read", "candidates.view_family_data"],
    ["person_emergency_contacts_staff_read", "candidates.view_emergency_contacts"],
  ];
  for (const [name, permission] of readPolicies) {
    const block = policyBlock(sql, name);
    if (!block) {
      problems.push(`policy ${name} is missing`);
      continue;
    }
    if (!block.includes(`has_permission('${permission}')`)) {
      problems.push(`policy ${name} does not require ${permission}`);
    }
  }
  const events = policyBlock(sql, "person_events_staff_read");
  if (!events) {
    problems.push("policy person_events_staff_read is missing");
    return verdict(problems);
  }
  for (const clause of [
    "and (field_group <> 'health' or has_permission('candidates.view_health_data'))",
    "and (field_group not in ('family_details','dependants') or has_permission('candidates.view_family_data'))",
    "and (field_group <> 'emergency_contacts' or has_permission('candidates.view_emergency_contacts'))",
  ]) {
    if (!events.includes(clause)) problems.push(`person_events_staff_read lost: ${clause}`);
  }
  if (!events.includes("is_staff()")) problems.push("person_events_staff_read is not staff-gated");
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 15. Erasure removes every table it owns and anonymises the profile.
// ---------------------------------------------------------------------------
const check15 = () => {
  const problems = [];
  const sql = currentSql();
  const fn = blockBetween(sql, "create or replace function public.erase_person_data", "comment on function public.erase_person_data");
  if (!fn) {
    problems.push("erase_person_data is missing");
    return verdict(problems);
  }
  const erasedTables = [
    "person_health",
    "person_family_details",
    "person_dependants",
    "person_emergency_contacts",
    "person_education",
    "person_employment",
    "person_languages",
    "person_skills",
    "person_certifications",
    "person_events",
    "person_consents",
    "person_emails",
  ];
  for (const table of erasedTables) {
    if (!fn.includes(`delete from ${table} where person_id = p_person_id;`)) {
      problems.push(`erase_person_data does not delete ${table}`);
    }
  }
  if (!fn.includes("update person_profiles set legal_name = 'Erased person',")) {
    problems.push("erase_person_data no longer anonymises person_profiles");
  }
  if (!fn.includes("erased_at = coalesce(erased_at, now())")) {
    problems.push("erase_person_data no longer stamps erased_at");
  }
  if (!sql.includes("revoke all on function public.erase_person_data(uuid) from public, anon, authenticated;")) {
    problems.push("erase_person_data is still executable by public/anon/authenticated");
  }
  if (!sql.includes("grant execute on function public.erase_person_data(uuid) to service_role;")) {
    problems.push("erase_person_data is not granted to service_role");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 16. The backfill never invents a person out of an erased address.
// ---------------------------------------------------------------------------
const check16 = () => {
  const problems = [];
  const sql = currentSql();
  if (!sql.includes("and a.email not like '%@erased.invalid'")) {
    problems.push("the backfill no longer excludes @erased.invalid addresses");
  }
  if (!sql.includes("where a.erased_at is null")) {
    problems.push("the backfill no longer excludes erased applications");
  }
  if (!sql.includes("md5(bp.email || '|person-profile-spine')::uuid")) {
    problems.push("the backfill id is no longer derived from the address");
  }
  if (!sql.includes("on conflict (id) do nothing")) {
    problems.push("the backfill profile insert is no longer idempotent");
  }
  if (!sql.includes("on conflict (email) do nothing")) {
    problems.push("the backfill email insert is no longer idempotent");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 17. Screening, reports and the assessments console never read a Tier-3 key.
// ---------------------------------------------------------------------------
const check17 = () => {
  const problems = [];
  const tier3 = pf.fieldsForTier(3).map((field) => field.key);
  const trees = [
    path.join(root, "src/modules/screening"),
    path.join(root, "src/modules/reports"),
    path.join(root, "src/app/(admin)/assessments"),
  ];
  for (const tree of trees) {
    for (const file of walk(tree)) {
      const text = readFileSync(file, "utf8");
      for (const key of tier3) {
        if (new RegExp(`\\b${key}\\b`).test(text)) {
          problems.push(`${path.relative(root, file)} reads Tier-3 key ${key}`);
        }
      }
    }
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 18. The candidate portal and the assessments console never read photo_path.
// ---------------------------------------------------------------------------
const check18 = () => {
  const problems = [];
  const trees = [path.join(root, "src/app/(candidate)"), path.join(root, "src/app/(admin)/assessments")];
  for (const tree of trees) {
    for (const file of walk(tree)) {
      if (readFileSync(file, "utf8").includes("photo_path")) {
        problems.push(`${path.relative(root, file)} reads photo_path`);
      }
    }
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 19. Erasure collects five kinds of byte, and the fifth is the photo.
// ---------------------------------------------------------------------------
const check19 = () => {
  const problems = [];
  const source = read("src/modules/privacy/application/erasure.ts");
  const collect = blockBetween(source, "async function collectPaths(", "\n/**");
  if (!collect) return verdict(["collectPaths is missing"]);
  const calls = [...collect.matchAll(/\baddPath\(\s*paths,/g)].length;
  if (calls !== 5) problems.push(`collectPaths makes ${calls} addPath(paths, …) calls, expected 5`);
  if (!source.includes('const PHOTO_BUCKET = "candidate-photos";')) {
    problems.push("PHOTO_BUCKET is not candidate-photos");
  }
  if (!collect.includes('.select("photo_path")')) {
    problems.push("collectPaths no longer reads person_profiles.photo_path");
  }
  if (!/addPath\(\s*paths,\s*PHOTO_BUCKET,\s*\(profile[^;]*photo_path\)/.test(collect)) {
    problems.push("collectPaths no longer adds the photo path under PHOTO_BUCKET");
  }
  if (!/if \(personId\)/.test(collect)) {
    problems.push("the photo read is no longer conditional on a resolved person");
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 20. candidate-photos reaches the bucket key, the browser, all three actions
//     arms and the three 043 policies.
// ---------------------------------------------------------------------------
const check20 = () => {
  const problems = [];
  const sql = currentSql();
  const types = read("src/app/(admin)/files/file-browser-types.ts");
  const actions = read("src/app/(admin)/files/actions.ts");
  if (!/BucketKey =[\s\S]*?\| "candidate-photos"/.test(types)) {
    problems.push("BucketKey does not carry candidate-photos");
  }
  if (!types.includes('key: "candidate-photos",')) {
    problems.push("BUCKETS does not register candidate-photos");
  }
  const owners = blockBetween(actions, "async function ownersFor(", "async function fileOwner(");
  const owner = blockBetween(actions, "async function fileOwner(", "async function unlinkReference(");
  const unlink = blockBetween(actions, "async function unlinkReference(", "\nfunction asRecord(");
  for (const [label, block] of [["ownersFor", owners], ["fileOwner", owner], ["unlinkReference", unlink]]) {
    if (!block) problems.push(`${label} is missing`);
    else if (!block.includes('"candidate-photos"')) problems.push(`${label} does not know candidate-photos`);
  }
  for (const [policy, extra] of [
    ["staff upload candidate photos", "split_part(path, '/', 1) = 'persons'"],
    ["staff read candidate photos", "is_staff()"],
    ["staff delete candidate photos", "has_permission('candidates.delete')"],
  ]) {
    const block = policyBlock(sql, policy);
    if (!block) {
      problems.push(`043 policy ${policy} is missing`);
      continue;
    }
    if (!block.includes("bucket = 'candidate-photos'")) problems.push(`${policy} does not target the bucket`);
    if (!block.includes(extra)) problems.push(`${policy} lost ${extra}`);
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 21. Three new permission keys, three seeded rows, three SUPER_ADMIN grants.
// ---------------------------------------------------------------------------
const check21 = () => {
  const problems = [];
  const sql = currentSql();
  const keys = ["candidates.view_health_data", "candidates.view_family_data", "candidates.view_emergency_contacts"];
  const settings = read("src/modules/settings/domain/types.ts");
  const keyBlock = blockBetween(settings, "export type PermissionKey =", ";");
  for (const key of keys) {
    if (!keyBlock.includes(`"${key}"`)) problems.push(`PermissionKey is missing ${key}`);
  }
  const permissionInsert = blockBetween(sql, "insert into public.permissions", "insert into public.role_permissions");
  const grantInsert = blockBetween(sql, "insert into public.role_permissions", "erase_person_data");
  for (const key of keys) {
    const seeded = [...permissionInsert.matchAll(new RegExp(`\\('${key.replace(/\./g, "\\.")}'`, "g"))].length;
    if (seeded !== 1) problems.push(`public.permissions seeds ${key} ${seeded} times, expected 1`);
    const granted = [...grantInsert.matchAll(new RegExp(`\\('SUPER_ADMIN', '${key.replace(/\./g, "\\.")}', true\\)`, "g"))].length;
    if (granted !== 1) problems.push(`role_permissions grants ${key} to SUPER_ADMIN ${granted} times, expected 1`);
  }
  return verdict(problems);
};

// ---------------------------------------------------------------------------
// 22. The staff route surface still holds the same nineteen pages.
// ---------------------------------------------------------------------------
const check22 = () => {
  const problems = [];
  const adminDir = path.join(root, "src/app/(admin)");
  const pages = readdirSync(adminDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(adminDir, entry.name, "page.tsx")))
    .map((entry) => `/${entry.name}`)
    .sort();
  const routesSource = read("src/lib/auth/staffRoutes.ts");
  const routesBlock = /export const STAFF_ROUTES[\s\S]*?=\s*\[([\s\S]*?)\]\s*as const/.exec(routesSource);
  const guarded = routesBlock ? [...routesBlock[1].matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]) : [];

  if (pages.length !== 19) problems.push(`the admin tree renders ${pages.length} pages, expected 19`);
  const pageSet = new Set(pages);
  const guardedSet = new Set(guarded);
  if (guarded.length !== guardedSet.size) problems.push("STAFF_ROUTES lists a path twice");
  for (const page of pages.filter((p) => !guardedSet.has(p))) {
    problems.push(`${page} renders under (admin) but STAFF_ROUTES does not guard it`);
  }
  for (const route of guarded.filter((r) => !pageSet.has(r))) {
    problems.push(`STAFF_ROUTES guards ${route}, which has no page.tsx`);
  }
  return verdict(problems);
};

const CHECKS = [
  ["1. The registry is the only key source", check1],
  ["2. The precedence ladder", check2],
  ["3. Fourteen groups, fourteen purposes, fifteen event groups", check3],
  ["4. date_of_birth is immutable after a human write", check4],
  ["5. Consent is newest-row, current-notice, group-named", check5],
  ["6. No Tier-3 key is extractable", check6],
  ["7. Career indicators", check7],
  ["8. The extractor validator", check8],
  ["9. person_emails stores a lowercased address", check9],
  ["10. One primary address per person", check10],
  ["11. Employment date checks", check11],
  ["12. Case-folded claim lists", check12],
  ["13. Certification year and title are bounded", check13],
  ["14. Tier-3 reads need their own grants", check14],
  ["15. Erasure removes every owned table", check15],
  ["16. The backfill skips erased addresses", check16],
  ["17. No Tier-3 key in screening, reports or assessments", check17],
  ["18. No photo_path in the candidate portal or assessments", check18],
  ["19. Erasure collects five kinds of byte", check19],
  ["20. candidate-photos reaches every surface", check20],
  ["21. Three permission keys, seeds and grants", check21],
  ["22. The staff route surface is still nineteen pages", check22],
];

// ---------------------------------------------------------------------------
// Mutation proofs — each mutation must turn its named check red.
// ---------------------------------------------------------------------------
const ENTRY = Object.fromEntries(CHECKS.map(([name, fn], index) => [index + 1, { name, fn }]));

async function mutation(label, rel, needle, replacement, verify) {
  const file = path.join(root, rel);
  const original = readFileSync(file, "utf8");
  if (!original.includes(needle)) {
    mutations.push({ label, pass: false, detail: `needle not found in ${rel}` });
    return;
  }
  try {
    writeFileSync(file, original.replace(needle, replacement));
    const outcome = await verify();
    mutations.push({ label, ...outcome });
  } catch (cause) {
    mutations.push({ label, pass: false, detail: `threw: ${cause instanceof Error ? cause.message : String(cause)}` });
  } finally {
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

// 1. A Tier-3 key in extractableFieldKeys() → checks 6 and 8 red.
await mutation(
  "1. Tier-3 key made extractable → checks 6 and 8 red",
  "src/modules/candidates/domain/person-fields.ts",
  "return PERSON_FIELDS.filter((field) => field.tier === 1).map((field) => field.key);",
  "return PERSON_FIELDS.filter((field) => field.tier <= 3).map((field) => field.key);",
  async () => {
    const mutated = await import(`${fieldsUrl}?mutate=${Date.now()}`);
    const six = await safe(() => check6(mutated));
    const eight = await safe(() => check8(mutated));
    return {
      pass: six.pass === false && eight.pass === false,
      detail: six.pass === false && eight.pass === false ? undefined : `check 6 ${six.pass ? "green" : "red"}, check 8 ${eight.pass ? "green" : "red"}`,
    };
  }
);

// 2. Drop field_group from the person_events read policy → check 14 red.
await mutation(
  "2. person_events loses its family gate → check 14 red",
  MIGRATION,
  "and (field_group not in ('family_details','dependants') or has_permission('candidates.view_family_data'))",
  "and (true)",
  () => checkIsRed(14)
);

// 3. Delete the @erased.invalid filter → check 16 red.
await mutation(
  "3. The backfill accepts erased addresses → check 16 red",
  MIGRATION,
  "  and a.email not like '%@erased.invalid'\n",
  "",
  () => checkIsRed(16)
);

// 4. cv_extraction promoted above hand_record → check 2 red.
await mutation(
  "4. cv_extraction promoted above the human rungs → check 2 red",
  "src/modules/candidates/application/personWriter.ts",
  "  cv_extraction: 10, // a model reading a document",
  "  cv_extraction: 35, // a model reading a document",
  () => checkIsRed(2)
);

// 5. candidate_form on the top rung → check 2 red.
await mutation(
  "5. candidate_form promoted to the top rung → check 2 red",
  "src/modules/candidates/application/personWriter.ts",
  "  candidate_form: 20, // the candidate's own answer, at a door that cannot verify it",
  "  candidate_form: 50, // the candidate's own answer, at a door that cannot verify it",
  () => checkIsRed(2)
);

// 6. Remove the photo read from collectPaths → check 19 red.
await mutation(
  "6. collectPaths loses the photo read → check 19 red",
  "src/modules/privacy/application/erasure.ts",
  `  if (personId) {
    const { data: profile } = await service
      .from("person_profiles")
      .select("photo_path")
      .eq("id", personId)
      .not("photo_path", "is", "null")
      .maybeSingle();
    addPath(paths, PHOTO_BUCKET, (profile as Record<string, unknown> | null)?.photo_path);
  }
`,
  "",
  () => checkIsRed(19)
);

// 7. Drop skills from PersonFieldGroup → check 3 red.
await mutation(
  "7. skills dropped from the registry union → check 3 red",
  "src/modules/candidates/domain/person-fields.ts",
  '  | "identity" | "contact" | "work_history" | "education" | "languages" | "skills" | "photo"',
  '  | "identity" | "contact" | "work_history" | "education" | "languages" | "photo"',
  () => checkIsRed(3)
);

// 8. Make the skills unique index case-sensitive → check 12 red.
await mutation(
  "8. person_skills stops case-folding → check 12 red",
  MIGRATION,
  "  on public.person_skills (person_id, lower(skill));",
  "  on public.person_skills (person_id, skill);",
  () => checkIsRed(12)
);

// 9. Delete person_certifications from erase_person_data → check 15 red.
await mutation(
  "9. Erasure leaves certifications behind → check 15 red",
  MIGRATION,
  "  delete from person_certifications   where person_id = p_person_id;\n",
  "",
  () => checkIsRed(15)
);

// ---------------------------------------------------------------------------
// Run the twenty-two checks
// ---------------------------------------------------------------------------
for (const [name, fn] of CHECKS) {
  results.push({ name, ...(await safe(fn)) });
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed} checks passed`);
for (const failure of results.filter((result) => !result.pass)) {
  console.log(`FAIL ${failure.name}${failure.detail ? ` — ${failure.detail}` : ""}`);
}

const mutationsHeld = mutations.filter((result) => result.pass).length;
console.log(`${mutationsHeld}/${mutations.length} mutation proofs held`);
for (const failure of mutations.filter((result) => !result.pass)) {
  console.log(`FAIL ${failure.label}${failure.detail ? ` — ${failure.detail}` : ""}`);
}

if (passed !== results.length || mutationsHeld !== mutations.length) {
  process.exitCode = 1;
}
