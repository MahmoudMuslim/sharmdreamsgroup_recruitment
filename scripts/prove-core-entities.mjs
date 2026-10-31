/**
 * The `src/core/entities` proof: the row types are the live schema, not a copy
 * of somebody's memory of it.
 *
 * Two halves.
 *
 * OFFLINE (no database) — the boundary the layering claims: core imports nothing
 * from the layers above it, every vocabulary tuple it declares is actually used
 * by a row type, no label is listed twice, and the same words written in the
 * modules that predate core still agree with it. These run whether or not the
 * stack is up, because a module editing its own copy of `PIPELINE_STAGES` is a
 * bug this gate can see without asking Postgres anything.
 *
 * ON DATABASE — the schema claim: for each of the five tables the interface's
 * fields must equal `information_schema.columns` in name, order, nullability and
 * type family; each enum-backed tuple must equal `pg_enum`; each CHECK-backed
 * text vocabulary must equal the constraint's own labels. This is what makes the
 * header sentence in `vocabularies.ts` — "the database is the authority" — a
 * checked sentence rather than an aspiration.
 *
 * Every claim is paired with a mutation fed through the same pure comparison, so
 * a check that cannot go red is not counted as a check.
 *
 *   node scripts/prove-core-entities.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. What the source says.
// ---------------------------------------------------------------------------

/** The five tables this layer owns, and the interface that names each row. */
const ROW_TYPES = [
  { file: "src/core/entities/application.ts", iface: "Application", table: "applications" },
  { file: "src/core/entities/jobOpening.ts", iface: "JobOpening", table: "job_openings" },
  { file: "src/core/entities/candidateAttempt.ts", iface: "CandidateAttempt", table: "candidate_attempts" },
  { file: "src/core/entities/userProfile.ts", iface: "UserProfile", table: "user_profiles" },
  { file: "src/core/entities/sourcedProspect.ts", iface: "SourcedProspect", table: "sourced_prospects" },
];

/** Postgres enum type name → the tuple in core that lists its labels. */
const ENUM_TUPLES = {
  user_role: "USER_ROLES",
  business_sector: "BUSINESS_SECTORS",
  job_status: "JOB_STATUSES",
  application_stage: "APPLICATION_STAGES",
  application_source: "APPLICATION_SOURCES",
  attempt_status: "ATTEMPT_STATUSES",
};

/**
 * The vocabularies that are `text` with a CHECK rather than an enum type.
 *
 * The list is keyed `table.column` and is looked up from the constraint the
 * database actually holds, so renaming a CHECK cannot quietly disarm it.
 */
const CHECK_TUPLES = {
  "job_openings.employment_type": "EMPLOYMENT_TYPES",
  "job_openings.experience_level": "EXPERIENCE_LEVELS",
  "sourced_prospects.origin": "PROSPECT_ORIGINS",
  "sourced_prospects.stage": "PROSPECT_STAGES",
  "sourced_prospects.profile_source": "PROSPECT_PROFILE_SOURCES",
  "user_profiles.locale": "LOCALES",
};

/** The other places these words are written down, which must say the same thing. */
const DUPLICATES = [
  { file: "src/modules/candidates/domain/listFilters.ts", tuple: "PIPELINE_STAGES", core: "APPLICATION_STAGES" },
  { file: "src/modules/candidates/domain/listFilters.ts", tuple: "APPLICATION_SOURCES", core: "APPLICATION_SOURCES" },
  { file: "src/modules/jobs/domain/hireable.ts", tuple: "JOB_STATUSES", core: "JOB_STATUSES" },
  { file: "src/modules/settings/domain/vocabularies.ts", tuple: "SECTORS", core: "BUSINESS_SECTORS" },
  { file: "src/modules/settings/domain/vocabularies.ts", tuple: "APPLICATION_SOURCES", core: "APPLICATION_SOURCES" },
];

const ENTITY_FILES = ["vocabularies", "application", "jobOpening", "candidateAttempt", "userProfile", "sourcedProspect"];

/**
 * The fields of one exported interface, in the order they are written.
 *
 * Comments go first: a docstring that contains `foo: bar;` would otherwise be
 * read as a column.
 */
function parseInterface(text, name) {
  const head = `export interface ${name} {`;
  const start = text.indexOf(head);
  if (start === -1) return null;
  const end = text.indexOf("\n}", start);
  if (end === -1) return null;
  const body = text
    .slice(start + head.length, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const fields = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s{2}([a-z_][a-z0-9_]*)(\??):\s*(.+);/.exec(line);
    if (m) fields.push({ name: m[1], optional: m[2] === "?", type: m[3].trim() });
  }
  return fields;
}

/** The labels of one `as const` tuple, in the order they are written. */
function parseTuple(text, name) {
  const start = text.indexOf(`export const ${name} =`);
  if (start === -1) return null;
  const open = text.indexOf("[", start);
  const close = text.indexOf("]", open);
  if (open === -1 || close === -1) return null;
  return [...text.slice(open, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const entities = new Map();
for (const t of ROW_TYPES) {
  entities.set(t.table, parseInterface(read(t.file), t.iface));
}
const vocabFile = read("src/core/entities/vocabularies.ts");
const tuples = new Map();
for (const name of [...Object.values(ENUM_TUPLES), ...Object.values(CHECK_TUPLES)]) {
  tuples.set(name, parseTuple(vocabFile, name));
}

check("every row type declares at least one field", ROW_TYPES.every((t) => (entities.get(t.table) ?? []).length > 0));
check("every vocabulary tuple core names is written in vocabularies.ts", [...tuples].every(([, v]) => v && v.length > 0), [...tuples].filter(([, v]) => !v).map(([k]) => k).join(", "));

// ---------------------------------------------------------------------------
// 2. The pure comparisons — the same functions the mutations below drive.
// ---------------------------------------------------------------------------

function fieldDiff(fields, columns) {
  const names = fields.map((f) => f.name);
  const cols = columns.map((c) => c.column_name);
  const missing = cols.filter((c) => !names.includes(c));
  const extra = names.filter((n) => !cols.includes(n));
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  const outOfOrder = !missing.length && !extra.length && names.join(",") !== cols.join(",");
  return { missing, extra, duplicates, outOfOrder };
}

/** A column admits null when the field says `| null` — or when it is `unknown`. */
function admitsNull(type) {
  return /\|\s*null\b/.test(type) || type === "unknown";
}

function baseType(type) {
  return type.replace(/\s*\|\s*(null|undefined)\b/g, "").trim();
}

const STRING_UDTS = new Set(["uuid", "text", "varchar", "bpchar", "timestamp", "timestamptz", "date", "time", "interval"]);
const NUMBER_UDTS = new Set(["int2", "int4", "int8", "numeric", "float4", "float8", "money"]);

function nullDiff(fields, columns) {
  const out = [];
  for (const c of columns) {
    const f = fields.find((x) => x.name === c.column_name);
    if (!f) continue;
    const nullable = c.is_nullable === "YES";
    if (nullable !== admitsNull(f.type)) {
      out.push(`${c.column_name}: column ${nullable ? "is nullable" : "is NOT NULL"}, field is "${f.type}"`);
    }
    if (!nullable && f.optional) out.push(`${c.column_name}: column is NOT NULL, field is optional`);
  }
  return out;
}

/**
 * The declared type must be the family the column stores.
 *
 * A jsonb column may be `unknown`, a `Record`, an array, or a named report
 * shape — anything else is a guess about bytes the database never promised.
 */
function typeDiff(fields, columns) {
  const out = [];
  for (const c of columns) {
    const f = fields.find((x) => x.name === c.column_name);
    if (!f) continue;
    const base = baseType(f.type);
    if (STRING_UDTS.has(c.udt_name)) {
      if (base !== "string") out.push(`${c.column_name}: ${c.udt_name} stored, "${base}" declared`);
    } else if (NUMBER_UDTS.has(c.udt_name)) {
      if (base !== "number") out.push(`${c.column_name}: ${c.udt_name} stored, "${base}" declared`);
    } else if (c.udt_name === "bool") {
      if (base !== "boolean") out.push(`${c.column_name}: bool stored, "${base}" declared`);
    } else if (c.udt_name.startsWith("_")) {
      if (base !== "string[]") out.push(`${c.udt_name} stored, "${base}" declared`);
    } else if (c.udt_name === "jsonb" || c.udt_name === "json") {
      if (!/^(unknown|Record<|string\[\]|[A-Z])/.test(base)) out.push(`jsonb stored, "${base}" declared`);
    } else if (ENUM_TUPLES[c.udt_name]) {
      const tuple = ENUM_TUPLES[c.udt_name];
      const ifaceName = base;
      const wanted = vocabFile.match(new RegExp(`export type ${ifaceName} = \\(typeof ([A-Z_]+)\\)\\[number\\]`));
      if (!wanted || wanted[1] !== tuple) {
        out.push(`${c.column_name}: ${c.udt_name} enum backed by ${tuple}, field is "${ifaceName}"`);
      }
    } else {
      out.push(`${c.column_name}: ${c.udt_name} is a type this proof has no rule for`);
    }
  }
  return out;
}

function labelDiff(declared, stored) {
  const missing = stored.filter((l) => !declared.includes(l));
  const extra = declared.filter((l) => !stored.includes(l));
  return { missing, extra };
}

/** The words one CHECK constraint allows, or an empty list if it bounds a range. */
function labelsFromCheckDef(def) {
  const anyList = [...def.matchAll(/'([^']*)'::(?:text|bpchar)/g)].map((m) => m[1]);
  if (anyList.length) return anyList;
  const pattern = /~\s*'\^(.*?)\$'::text/.exec(def);
  if (pattern) return pattern[1].split("|");
  return [];
}

/** The column a CHECK constraint is written about, as best the definition says. */
function columnFromCheckDef(def) {
  const m = /CHECK \(\s*\(?(\w+)/.exec(def);
  return m ? m[1] : null;
}

// The checks over the real tree, before the database is involved.
for (const [table, fields] of entities) {
  if (!fields) continue;
  const d = fieldDiff(fields, fields.map((f) => ({ column_name: f.name })));
  check(`${table}: no field is declared twice`, d.duplicates.length === 0, d.duplicates.join(", "));
}

for (const [name, tuple] of tuples) {
  const d = labelDiff(tuple, [...new Set(tuple)]);
  check(`${name}: lists each label once`, d.extra.length === 0, d.extra.join(", "));
}

// Every tuple is written into a row type — otherwise it is a vocabulary nobody uses.
for (const name of tuples.keys()) {
  const ifaceName = vocabFile.match(new RegExp(`export type (\\w+) = \\(typeof ${name}\\)\\[number\\]`))?.[1];
  const used = ifaceName && [...entities.values()].some((fields) => fields.some((f) => baseType(f.type) === ifaceName));
  check(`${name} is the type of a real column (${ifaceName ?? "unnamed type"})`, Boolean(used));
}

// The boundary: core sits under everything and therefore imports nothing above it.
const LAYER_IMPORTS = ["@/app", "@/modules", "@/lib", "@/stores", "@/types", "@/components"];
for (const file of ENTITY_FILES) {
  const text = read(`src/core/entities/${file}.ts`);
  const offenders = LAYER_IMPORTS.filter((p) => text.includes(`from "${p}`));
  check(`core/entities/${file}.ts imports no layer above core`, offenders.length === 0, offenders.join(", "));
}
check("the entities barrel exports the six files", ["./vocabularies", "./application", "./jobOpening", "./candidateAttempt", "./userProfile", "./sourcedProspect"].every((p) => read("src/core/entities/index.ts").includes(`export * from "${p}"`)));

// `src/types` kept the DTOs and gave up the rows.
const typesFile = read("src/types/index.ts");
for (const t of ROW_TYPES) {
  check(`src/types no longer declares ${t.iface}`, !typesFile.includes(`interface ${t.iface} {`));
}
check("src/types still declares the DTOs that are not rows", ["CvScreeningResult", "DashboardAnalytics", "QuestionConfig", "RubricCriterion"].every((n) => typesFile.includes(`interface ${n} {`)));

// The duplicates written before core agree with core, label for label.
for (const d of DUPLICATES) {
  const theirs = parseTuple(read(d.file), d.tuple);
  const ours = tuples.get(d.core);
  if (!theirs || !ours) {
    check(`${d.file} still writes ${d.tuple}`, false, theirs ? "core tuple missing" : "");
    continue;
  }
  const diff = labelDiff(theirs, ours);
  check(
    `${d.tuple} in ${d.file.split("/").pop()} says what core's ${d.core} says`,
    diff.missing.length === 0 && diff.extra.length === 0,
    [...diff.missing.map((l) => `missing ${l}`), ...diff.extra.map((l) => `only here: ${l}`)].join(", ")
  );
}

// ---------------------------------------------------------------------------
// 3. The database answers.
// ---------------------------------------------------------------------------

const env = Object.fromEntries(
  read(path.join("docker", ".env"))
    .split(/\r?\n/)
    .map((l) => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
      return m ? [m[1], m[2].trim()] : null;
    })
    .filter(Boolean)
);

const client = new Client({ connectionString: env.AUTH_DB_URL, connectionTimeoutMillis: 8000 });
let onDatabase = false;
try {
  await client.connect();
  onDatabase = true;
} catch (e) {
  console.log(
    `\nFAIL the app database could not be reached (${e.message || e.code || "no reason given"}) — the\n` +
      `     schema half of this proof asks the live database what its columns are, so it\n` +
      `     needs the stack: npm run docker:up. It does not print the connection string.`
  );
  process.exitCode = 1;
}

const columnsByTable = new Map();
const enumLabels = new Map();
const checksByColumn = new Map();

if (onDatabase) {
  const tables = ROW_TYPES.map((t) => t.table);
  const { rows: colRows } = await client.query(
    `SELECT table_name, column_name, ordinal_position, is_nullable, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [[...tables, "tenants_and_companies"]]
  );
  for (const r of colRows) {
    if (!columnsByTable.has(r.table_name)) columnsByTable.set(r.table_name, []);
    columnsByTable.get(r.table_name).push(r);
  }

  const { rows: enumRows } = await client.query(
    `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = 'public'::regnamespace ORDER BY t.typname, e.enumsort`
  );
  for (const r of enumRows) {
    if (!enumLabels.has(r.typname)) enumLabels.set(r.typname, []);
    enumLabels.get(r.typname).push(r.enumlabel);
  }

  const { rows: conRows } = await client.query(
    `SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE con.contype = 'c' AND c.relnamespace = 'public'::regnamespace
        AND c.relname = ANY($1::text[])`,
    [tables]
  );
  for (const r of conRows) {
    const labels = labelsFromCheckDef(r.def);
    if (!labels.length) continue;
    const column = columnFromCheckDef(r.def);
    if (column) checksByColumn.set(`${r.table_name}.${column}`, { name: r.conname, labels });
  }

  await client.end();
}

if (onDatabase) {
  // -- 3a. One interface, one table, column for column.
  for (const t of ROW_TYPES) {
    const columns = columnsByTable.get(t.table);
    const fields = entities.get(t.table);
    if (!columns || !fields) {
      check(`${t.table}: the database and the interface both answered`, false, columns ? "interface missing" : "no such table");
      continue;
    }
    const diff = fieldDiff(fields, columns);
    check(
      `${t.iface}: ${columns.length} columns, ${fields.length} fields, nothing between them`,
      diff.missing.length === 0 && diff.extra.length === 0,
      [...diff.missing.map((c) => `no field for ${c}`), ...diff.extra.map((f) => `no column ${f}`)].join(", ")
    );
    check(`${t.iface}: the fields are in the order the database holds them`, !diff.outOfOrder);
    const nd = nullDiff(fields, columns);
    check(`${t.iface}: every nullable column is nullable here and no other is`, nd.length === 0, nd.join(" | "));
    const td = typeDiff(fields, columns);
    check(`${t.iface}: every field's type is the family its column stores`, td.length === 0, td.join(" | "));
  }

  // -- 3b. The enum end of the ladder.
  for (const [udt, tupleName] of Object.entries(ENUM_TUPLES)) {
    const stored = enumLabels.get(udt);
    if (!stored) {
      check(`${udt} exists as an enum on this database`, false);
      continue;
    }
    const d = labelDiff(tuples.get(tupleName), stored);
    check(
      `${tupleName} is exactly the ${udt} enum (${stored.length} labels)`,
      d.missing.length === 0 && d.extra.length === 0,
      [...d.missing.map((l) => `enum has ${l}`), ...d.extra.map((l) => `tuple has ${l}`)].join(", ")
    );
  }

  // -- 3c. The CHECK end, read out of the constraint rather than retyped here.
  for (const [key, tupleName] of Object.entries(CHECK_TUPLES)) {
    const con = checksByColumn.get(key);
    if (!con) {
      check(`${key} still carries a CHECK this proof can read`, false, "no label-listing constraint found");
      continue;
    }
    const d = labelDiff(tuples.get(tupleName), con.labels);
    check(
      `${tupleName} is exactly what ${con.name} allows (${con.labels.length} labels)`,
      d.missing.length === 0 && d.extra.length === 0,
      [...d.missing.map((l) => `CHECK allows ${l}`), ...d.extra.map((l) => `tuple lists ${l}`)].join(", ")
    );
  }

  // -- 3d. A text column with a CHECK that core does not name is an undocumented ladder.
  const named = new Set(Object.keys(CHECK_TUPLES));
  for (const [key, con] of checksByColumn) {
    if (named.has(key)) continue;
    const column = key.split(".")[1];
    const columnType = [...columnsByTable.values()].flat().find((c) => `${c.table_name}.${c.column_name}` === key);
    if (!columnType || columnType.data_type !== "text") continue;
    check(`${key}: a CHECK over text with no core vocabulary (${con.labels.length} labels: ${con.labels.join("/")})`, false);
  }

  // -- 3e. The DTO that is a projection of a wider table.
  //
  // `Tenant` is the one row-shaped type `src/types` kept, because the staff
  // session reads six columns off a table the console reads twenty-seven from.
  // It is legal as a projection, and this is the line that keeps it honest: a
  // field that stops being a column stops being readable.
  const tenantFields = parseInterface(typesFile, "Tenant");
  const companyRows = columnsByTable.get("tenants_and_companies") ?? [];
  if (!tenantFields || companyRows.length === 0) {
    check("the company table and its projection both answered", false);
  } else {
    const projected = fieldDiff(tenantFields, companyRows);
    check(
      `Tenant reads ${tenantFields.length} of the ${companyRows.length} columns tenants_and_companies holds`,
      projected.missing.length === 0 && projected.extra.length === 0,
      [...projected.missing.map((c) => `no column ${c}`), ...projected.extra.map((f) => `not a column: ${f}`)].join(", ")
    );
    const pruned = tenantFields.filter((f) => f.name !== "sector");
    check("a column dropped from that projection is named", fieldDiff(pruned, companyRows).missing.includes("sector"));
  }
}

// ---------------------------------------------------------------------------
// 4. The mutations — each one fed through the function above, and must go red.
// ---------------------------------------------------------------------------

if (onDatabase) {
  const table = "applications";
  const columns = columnsByTable.get(table);
  const fields = entities.get(table);

  const dropped = fields.filter((f) => f.name !== "email");
  const d1 = fieldDiff(dropped, columns);
  check("a field deleted from the interface is named as missing", d1.missing.includes("email"));

  const phantom = [...fields, { name: "date_of_birth", optional: false, type: "string | null" }];
  const d2 = fieldDiff(phantom, columns);
  check("a field added to no column is named as extra", d2.extra.includes("date_of_birth"));

  const swapped = [...fields];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  check("the same fields written in the wrong order are red", fieldDiff(swapped, columns).outOfOrder);

  const reNamed = fields.map((f) => (f.name === "cv_file_path" ? { ...f, name: "resume_path" } : f));
  const d4 = fieldDiff(reNamed, columns);
  check("a column spelled differently in TS is caught both ways", d4.missing.includes("cv_file_path") && d4.extra.includes("resume_path"));

  const forced = columns.map((c) => (c.column_name === "phone" ? { ...c, is_nullable: "NO" } : c));
  check("a column turned NOT NULL under the interface is red", nullDiff(fields, forced).length > 0);

  const loosened = fields.map((f) => (f.name === "tracking_code" ? { ...f, type: "string | null" } : f));
  check("a NOT NULL field given a null is red", nullDiff(loosened, columns).length > 0);

  const retyped = columns.map((c) => (c.column_name === "ai_match_score" ? { ...c, udt_name: "text", data_type: "text" } : c));
  check("a numeric column read as text is red", typeDiff(fields, retyped).length > 0);

  const misdeclared = fields.map((f) => (f.name === "erased_at" ? { ...f, type: "number | null" } : f));
  check("a timestamp field declared as a number is red", typeDiff(misdeclared, columns).length > 0);

  const jsonbGuess = fields.map((f) => (f.name === "form_answers" ? { ...f, type: "string" } : f));
  check("a jsonb column typed as a plain string is red", typeDiff(jsonbGuess, columns).length > 0);

  const unknownEnum = fields.map((f) => (f.name === "stage" ? { ...f, type: "string" } : f));
  check("an enum column typed as loose string is red", typeDiff(unknownEnum, columns).length > 0);

  // A stored label core has never heard of — the case the header promises to name.
  const grownLabels = [...enumLabels.get("application_stage"), "ONBOARDED"];
  const d5 = labelDiff(tuples.get("APPLICATION_STAGES"), grownLabels);
  check("a label the enum gains is named against the tuple", d5.missing.includes("ONBOARDED"));

  const shrunkTuple = tuples.get("APPLICATION_SOURCES").filter((l) => l !== "REFERRAL");
  const d6 = labelDiff(shrunkTuple, enumLabels.get("application_source"));
  check("a label dropped from the tuple is named against the enum", d6.extra.includes("REFERRAL"));

  const conKey = "user_profiles.locale";
  const grown = checksByColumn.get(conKey);
  const d7 = labelDiff(tuples.get("LOCALES"), [...grown.labels, "tr"]);
  check("a locale the CHECK gains is named against the tuple", d7.missing.includes("tr"));
}

// The duplicate-vocabulary check, mutated: a module that edits its own copy.
//
// The rewrite is confined to the tuple's own brackets — a bare string replace
// would land on whichever label happens to be written first in the file, and a
// mutation that misses its target reads as a passing check that never ran.
function mutateTuple(text, name, rewrite) {
  const start = text.indexOf(`export const ${name} =`);
  const open = text.indexOf("[", start);
  const close = text.indexOf("]", open);
  const head = text.slice(0, open + 1);
  const tail = text.slice(close);
  return head + rewrite(text.slice(open + 1, close)) + tail;
}

const mutatedFilters = mutateTuple(
  read("src/modules/candidates/domain/listFilters.ts"),
  "PIPELINE_STAGES",
  (inner) => inner.replace('"REJECTED"', '"DENIED"')
);
const mutated = parseTuple(mutatedFilters, "PIPELINE_STAGES");
if (!mutated || mutated.includes("REJECTED")) {
  check("the mutation this proof relies on actually lands", false, "PIPELINE_STAGES still holds REJECTED");
} else {
  const d = labelDiff(mutated, tuples.get("APPLICATION_STAGES"));
  check("a module editing its own copy of the pipeline is red", d.missing.includes("REJECTED") && d.extra.includes("DENIED"));
}

// The boundary check, mutated: an import from a layer above core.
const polluted = read("src/core/entities/application.ts").replace(
  'import type { ApplicationSource, ApplicationStage } from "./vocabularies";',
  'import { parseGateAnswers } from "@/modules/careers/gate-questions";\nimport type { ApplicationSource, ApplicationStage } from "./vocabularies";'
);
check(
  "an import from @/modules into core is red",
  LAYER_IMPORTS.some((p) => polluted.includes(`from "${p}`))
);

// The parser, mutated: a docstring must not be read as a column.
const commented = read("src/core/entities/userProfile.ts").replace(
  "  referral_code: string;",
  "  /** referral_code: nothing; the comment is prose, not a column. */\n  referral_code: string;"
);
const commentedFields = parseInterface(commented, "UserProfile");
check(
  "a sentence inside a doc comment is not read as a field",
  commentedFields.length === entities.get("user_profiles").length &&
    !commentedFields.some((f) => f.name === "the comment is prose, not a column")
);

// ---------------------------------------------------------------------------
// 5. The tally.
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks green` +
    (onDatabase ? "" : " — the schema half did not run: this database was not reachable") +
    "\n"
);
if (failed.length) {
  console.log("Red:");
  for (const f of failed) console.log(`  · ${f.name}`);
  process.exitCode = 1;
}
