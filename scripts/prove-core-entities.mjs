/**
 * The `src/core/entities` proof: the row types are the live schema, not a copy
 * of somebody's memory of it.
 *
 * Two halves.
 *
 * OFFLINE (no database) — the boundary the layering claims: core imports nothing
 * from the layers above it, every vocabulary tuple it declares is actually used
 * by a row type, no label is listed twice, and the same words written in the
 * modules that predate core still agree with it. The repository half is checked
 * here too: the columns each projection asks Postgres for are columns the row
 * type declares, the layer imports nothing above itself, no projection ships
 * without a caller, and the three copies of the missing-schema predicate still
 * name the same four codes. These run whether or not the stack is up, because a
 * module editing its own copy of `PIPELINE_STAGES` is a bug this gate can see
 * without asking Postgres anything.
 *
 * ON DATABASE — the schema claim: for each of the six tables the interface's
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
import { readFileSync, readdirSync } from "node:fs";
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

/** The six tables this layer owns, and the interface that names each row. */
const ROW_TYPES = [
  { file: "src/core/entities/application.ts", iface: "Application", table: "applications" },
  { file: "src/core/entities/jobOpening.ts", iface: "JobOpening", table: "job_openings" },
  { file: "src/core/entities/candidateAttempt.ts", iface: "CandidateAttempt", table: "candidate_attempts" },
  { file: "src/core/entities/userProfile.ts", iface: "UserProfile", table: "user_profiles" },
  { file: "src/core/entities/sourcedProspect.ts", iface: "SourcedProspect", table: "sourced_prospects" },
  { file: "src/core/entities/company.ts", iface: "Company", table: "tenants_and_companies" },
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

const ENTITY_FILES = ["vocabularies", "company", "application", "jobOpening", "candidateAttempt", "userProfile", "sourcedProspect"];

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
 *
 * `checkVocab` is `table.column` → the tuple name, for the columns that are
 * `text` held to a word list by a CHECK instead of an enum type. Those are the
 * same ladder as an enum and must be typed the same way: naming the tuple's
 * interface, not `string`.
 */
function typeDiff(fields, columns, checkVocab = {}) {
  const out = [];
  for (const c of columns) {
    const f = fields.find((x) => x.name === c.column_name);
    if (!f) continue;
    const base = baseType(f.type);
    if (STRING_UDTS.has(c.udt_name)) {
      const tupleName = checkVocab[`${c.table_name}.${c.column_name}`];
      if (tupleName) {
        const ifaceName = vocabFile.match(new RegExp(`export type (\\w+) = \\(typeof ${tupleName}\\)\\[number\\]`))?.[1];
        if (base !== ifaceName) {
          out.push(`${c.column_name}: ${c.udt_name} held to ${tupleName} by a CHECK, field is "${base}"`);
        }
      } else if (base !== "string") {
        out.push(`${c.column_name}: ${c.udt_name} stored, "${base}" declared`);
      }
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

/**
 * A CHECK that bounds a column by shape rather than by words, as the database
 * prints it: `CHECK ((referral_code ~ '^[0-9A-F]{10}$'::text))`.
 */
function patternFromCheckDef(def) {
  const m = /~\s*'\^(.*?)\$'::text/.exec(def);
  return m ? m[1] : null;
}

/**
 * The words one CHECK constraint allows.
 *
 * A pattern CHECK comes back empty: `^[0-9A-F]{10}$` is a shape, not a
 * vocabulary, and reading it as a one-word ladder would file the column as an
 * undocumented vocabulary core has never heard of.
 */
function labelsFromCheckDef(def) {
  if (patternFromCheckDef(def)) return [];
  return [...def.matchAll(/'([^']*)'::(?:text|bpchar)/g)].map((m) => m[1]);
}

/** The column a CHECK constraint is written about, as best the definition says. */
function columnFromCheckDef(def) {
  const m = /CHECK\s*\(*\s*(\w+)/.exec(def);
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

// The three shapes a constraint definition comes in, read before the database is
// asked — every CHECK-backed claim below is only as good as these three parses.
const wordListDef = "CHECK ((locale = ANY (ARRAY['en'::text, 'ar'::text, 'ru'::text, 'de'::text])))";
const nullableWordListDef =
  "CHECK (((experience_level IS NULL) OR (experience_level = ANY (ARRAY['JUNIOR'::text, 'MID'::text]))))";
const patternDef = "CHECK ((referral_code ~ '^[0-9A-F]{10}$'::text))";
check(
  "a CHECK's column is read however deeply its parentheses nest",
  columnFromCheckDef(wordListDef) === "locale" && columnFromCheckDef(nullableWordListDef) === "experience_level"
);
check(
  "a word-list CHECK gives its words, nullable wrapper or no",
  labelsFromCheckDef(wordListDef).length === 4 && labelsFromCheckDef(nullableWordListDef).length === 2
);
check(
  "a pattern CHECK is read as a shape, never as a one-word vocabulary",
  labelsFromCheckDef(patternDef).length === 0 && patternFromCheckDef(patternDef) === "[0-9A-F]{10}"
);

// The boundary: core sits under everything and therefore imports nothing above it.
const LAYER_IMPORTS = ["@/app", "@/modules", "@/lib", "@/stores", "@/types", "@/components"];
for (const file of ENTITY_FILES) {
  const text = read(`src/core/entities/${file}.ts`);
  const offenders = LAYER_IMPORTS.filter((p) => text.includes(`from "${p}`));
  check(`core/entities/${file}.ts imports no layer above core`, offenders.length === 0, offenders.join(", "));
}
check("the entities barrel exports the seven files", ["./vocabularies", "./company", "./application", "./jobOpening", "./candidateAttempt", "./userProfile", "./sourcedProspect"].every((p) => read("src/core/entities/index.ts").includes(`export * from "${p}"`)));

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
// 3. The repositories — the thin layer sitting beside core.
// ---------------------------------------------------------------------------

/**
 * `src/infrastructure/repositories` is thin on purpose, so everything it claims
 * is measurable from the text: the columns a projection asks for are columns the
 * row type declares, it imports nothing from the layers above it, no projection
 * ships that nobody calls, and the predicate that decides "this read failed on a
 * missing column, not on a bad value" is one agreement across the three files
 * that write it — the claim `missingSchema.ts` makes about this script.
 */

const REPO_DIR = "src/infrastructure/repositories";
const repoFiles = readdirSync(path.join(root, REPO_DIR))
  .filter((n) => n.endsWith(".ts"))
  .sort();

/** Every import specifier in a file, single-line or wrapped. */
function importSpecifiers(text) {
  return [
    ...[...text.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^export[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]),
  ];
}

// A repository may reach down into core and sideways at the transport, never up
// into a module that owns a business rule: the caller passes its vocabulary in.
const REPO_ALLOWED_IMPORTS = ["@/core/entities", "@/lib", "./"];
for (const name of repoFiles) {
  const specifiers = importSpecifiers(read(`${REPO_DIR}/${name}`));
  const offenders = specifiers.filter((s) => !REPO_ALLOWED_IMPORTS.some((a) => s.startsWith(a)));
  check(
    `repositories/${name} imports only core, the transport and its siblings (${specifiers.length} import${specifiers.length === 1 ? "" : "s"})`,
    offenders.length === 0,
    offenders.join(", ")
  );
}

/**
 * The reads one file asks for, split at each `.from("table")`.
 *
 * A chain is cut at the next `.from(`, at the statement's `;`, or at the blank
 * line after it, whichever comes first — so a filter written under one read is
 * never charged to the read above it, and a `Promise.all` of two reads is two
 * reads with one table each.
 */
function readRequests(text) {
  const marks = [...text.matchAll(/\.from\("([a-z_]+)"\)/g)];
  return marks.map((mark, i) => {
    const after = text.slice(mark.index);
    const bounds = [
      i + 1 < marks.length ? after.indexOf(".from(", 1) : -1,
      after.indexOf(";"),
      after.search(/\n[ \t]*\n/),
    ].filter((n) => n > 0);
    return { table: mark[1], chain: bounds.length ? after.slice(0, Math.min(...bounds)) : after };
  });
}

/** The methods that take a column name as their first argument. */
const COLUMN_METHODS = "select|eq|neq|gt|gte|lt|lte|in|is|not|like|ilike|contains|containedBy|overlaps|order|filter";

/**
 * A `const NAME = "…"` column list, resolved so a shared string is still read.
 *
 * Only an identifier has a constant to find. A caller's argument that is a whole
 * object literal — a write's payload, or a read whose chain was cut before it
 * closed — is not a name, and searching for one would build a pattern out of the
 * payload itself.
 */
function resolveConstant(text, name) {
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const m = new RegExp(`const ${name}\\s*=\\s*\\n?\\s*"([^"]*)"`).exec(text);
  return m ? m[1] : null;
}

/**
 * The columns one chain names, and anything it names that is not a plain column.
 *
 * A select item that is not a bare name — `total_score::text`, `person(name)` —
 * is reported rather than skipped: an embed is a read across a foreign key, which
 * is a different claim than "this column exists", and a parser that quietly
 * ignored it would be a gate that passes because it stopped looking.
 */
function columnsNamed(text, chain) {
  const columns = [];
  const unparsed = [];
  const re = new RegExp(`\\.(${COLUMN_METHODS})\\(\\s*(?:"([^"]*)"|([A-Za-z_$][\\w$]*))`, "g");
  for (const m of chain.matchAll(re)) {
    const arg = m[2] ?? resolveConstant(text, m[3]);
    if (arg === null) continue;
    for (const part of arg.split(",")) {
      const word = part.trim();
      if (!word) continue;
      if (/^[a-z_][a-z0-9_]*$/.test(word)) columns.push(word);
      else unparsed.push(word);
    }
  }
  return { columns: [...new Set(columns)], unparsed };
}

const ifaceByTable = new Map(ROW_TYPES.map((t) => [t.table, t.iface]));
const repoReads = repoFiles.flatMap((name) => {
  const text = read(`${REPO_DIR}/${name}`);
  return readRequests(text).map((r) => ({ ...r, file: name, ...columnsNamed(text, r.chain) }));
});

check(`the layer holds ${repoFiles.length} files and asks ${repoReads.length} reads`, repoFiles.length > 0 && repoReads.length > 0);

/** Whether a row type in core names a table's row. */
const coreDescribes = (map, table) => Boolean(map.get(table));

for (const req of repoReads) {
  const fields = entities.get(req.table);
  if (!fields) {
    check(`repositories/${req.file} reads ${req.table}, a table core describes`, false, "no row type for it in src/core/entities");
    continue;
  }
  const offenders = req.columns.filter((c) => !fields.some((f) => f.name === c));
  check(
    `${req.file}: its ${req.table} read names only columns ${ifaceByTable.get(req.table)} declares (${req.columns.length})`,
    offenders.length === 0,
    offenders.map((c) => `no field ${c}`).join(", ")
  );
  check(
    `${req.file}: every column its ${req.table} read names is a plain name`,
    req.unparsed.length === 0,
    req.unparsed.join(", ")
  );
}

/* The rule above is only a rule if the map can miss: the same predicate, fed a
 * core with the company row taken out, must name the company read as written
 * against a table nothing describes. */
const withoutCompany = new Map(entities);
withoutCompany.delete("tenants_and_companies");
check(
  "a layer read of a table core does not describe is named",
  coreDescribes(withoutCompany, "tenants_and_companies") === false &&
    coreDescribes(entities, "tenants_and_companies") === true &&
    repoReads.some((r) => r.table === "tenants_and_companies"),
  "the mutation needs a company read in the layer and a company row in core"
);

/** The members each `Pick<Entity, "a" | "b">` in a repository names. */
function picksNamed(text) {
  return [...text.matchAll(/Pick<\s*([A-Z]\w+)\s*,\s*([\s\S]*?)>/g)].map((m) => ({
    iface: m[1],
    members: [...m[2].matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((x) => x[1]),
  }));
}

const tableByIface = new Map(ROW_TYPES.map((t) => [t.iface, t.table]));
for (const name of repoFiles) {
  for (const pick of picksNamed(read(`${REPO_DIR}/${name}`))) {
    if (!tableByIface.has(pick.iface)) continue;
    const fields = entities.get(tableByIface.get(pick.iface));
    const offenders = pick.members.filter((mem) => !fields.some((f) => f.name === mem));
    check(
      `${name}: Pick<${pick.iface}, …> names ${pick.members.length} real field${pick.members.length === 1 ? "" : "s"}`,
      pick.members.length > 0 && offenders.length === 0,
      offenders.map((mem) => `not a field: ${mem}`).join(", ")
    );
  }
}

// Every source file the app holds, read once, so a projection can be asked who
// calls it. Anything under the repositories directory is the layer talking to
// itself and does not count as a caller.
const appSources = [];
(function walk(dir) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(entry.name)) appSources.push({ rel, text: readFileSync(path.join(root, rel), "utf8") });
  }
})("src");

const outsideLayer = appSources.filter((s) => !s.rel.startsWith(`${REPO_DIR}/`));

const projections = repoFiles.flatMap((name) => {
  const text = read(`${REPO_DIR}/${name}`);
  return [...text.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => ({ file: name, fn: m[1] }));
});

/** How many files outside the layer call one projection by name. */
const callersOf = (fn, sources = outsideLayer) =>
  sources.filter((s) => new RegExp(`\\b${fn}\\(`).test(s.text)).length;

for (const p of projections) {
  check(
    `${p.fn} is called from the app (${callersOf(p.fn)} file${callersOf(p.fn) === 1 ? "" : "s"})`,
    callersOf(p.fn) > 0,
    callersOf(p.fn) === 0 ? "a repository nobody calls is dead code" : ""
  );
}

// -- 3c. The reads the layer owns are not written by hand anywhere outside it.
//
// Two callers spelling the same read differently are the same read: one writes
// `.eq("id", jobId)` and the other `.eq("id", openingId)`, one names its columns
// through a shared constant and the other types them out. So the comparison is
// made on a chain with every non-literal argument blanked and every column list
// sorted — which is what the extraction was judged by in the first place, and is
// the promise the layer keeps: a read it names is a read nobody else repeats.
function splitArguments(text) {
  const out = [];
  let depth = 0;
  let current = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function neutralize(text, arg, isColumnList) {
  if (/^".*"$/.test(arg) && isColumnList) {
    return [...new Set(arg.slice(1, -1).split(",").map((w) => w.trim()).filter(Boolean))].sort().join(",");
  }
  if (/^".*"$/.test(arg)) return arg;
  if (/^-?[\d.]+$/.test(arg) || arg === "true" || arg === "false" || arg === "null") return arg;
  if (/^\{[\s\S]*\}$/.test(arg)) return `{${arg.slice(1, -1).replace(/\s+/g, " ").trim()}}`;
  const resolved = resolveConstant(text, arg);
  if (resolved !== null && isColumnList) {
    return [...new Set(resolved.split(",").map((w) => w.trim()).filter(Boolean))].sort().join(",");
  }
  return "?";
}

/** The chain as a question to the database, with the caller's own names removed. */
function chainIdentity(text, chain) {
  const parts = [];
  const re = /\.([A-Za-z]+)\(/g;
  let match;
  while ((match = re.exec(chain))) {
    let depth = 1;
    let i = re.lastIndex;
    let quote = null;
    while (i < chain.length && depth > 0) {
      const ch = chain[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      i++;
    }
    const args = splitArguments(chain.slice(re.lastIndex, i - 1));
    parts.push(
      `.${match[1]}(${args.map((arg, n) => neutralize(text, arg, match[1] === "select" && n === 0)).join(",")})`
    );
    re.lastIndex = i;
  }
  return parts.join("");
}

const layerReads = repoFiles.flatMap((name) => {
  const text = read(`${REPO_DIR}/${name}`);
  return readRequests(text)
    .map((r) => ({ file: name, table: r.table, identity: chainIdentity(text, r.chain) }))
    .filter((r) => r.identity.includes(".select("));
});

check(
  `the layer names ${layerReads.length} read${layerReads.length === 1 ? "" : "s"} for the app to own`,
  layerReads.length === repoReads.length,
  `${repoReads.length - layerReads.length} of the layer's requests are not a read this comparison can name`
);

const outsideIdentities = new Map();
for (const source of outsideLayer) {
  for (const r of readRequests(source.text)) {
    const identity = chainIdentity(source.text, r.chain);
    if (!identity.includes(".select(")) continue;
    if (!outsideIdentities.has(identity)) outsideIdentities.set(identity, []);
    outsideIdentities.get(identity).push(source.rel);
  }
}

/**
 * The hand-written copies that were already standing when this check was
 * written, named one by one with the reason it is still standing.
 *
 * This is not an allowance. A read the layer owns may be repeated only from a
 * list like this, so the gate goes red for a copy in a file that is not named,
 * for one copy more than the number named, and for one that has been wired
 * through the layer while its entry stayed behind. Each entry is a debt with a
 * name on it, not a category that was never measured.
 */
const STANDING_COPIES = new Map([
  [
    '.from("applications").select(person_id).eq("id",?).maybeSingle()',
    {
      files: ["src/modules/privacy/application/erasure.ts"],
      because:
        "the erasure's person pass folds gone, absent spine and refused read into null on purpose, so that a database without 043 loses only what is new; naming the three would change what an in-flight erasure does.",
    },
  ],
]);

const ledgeredIdentities = new Set(layerReads.map((r) => r.identity));
for (const [identity] of STANDING_COPIES) {
  check(
    `the ledger names a read the layer actually owns (${identity.slice(0, 46)}…)`,
    ledgeredIdentities.has(identity),
    "no read in src/infrastructure/repositories answers this chain — the entry is stale"
  );
}

for (const read_ of layerReads) {
  const repeats = (outsideIdentities.get(read_.identity) ?? []).slice().sort();
  const standing = STANDING_COPIES.get(read_.identity);
  if (!standing) {
    check(
      `repositories/${read_.file} owns its ${read_.table} read alone (${repeats.length} hand-written cop${repeats.length === 1 ? "y" : "ies"} outside)`,
      repeats.length === 0,
      repeats.length ? `${read_.identity}  —  ${repeats.join(", ")}` : ""
    );
    continue;
  }
  const expected = standing.files.slice().sort();
  check(
    `repositories/${read_.file} leaves its ${read_.table} read in exactly the ${expected.length} hand-written place${expected.length === 1 ? "" : "s"} the ledger names`,
    repeats.length === expected.length && repeats.every((f, i) => f === expected[i]),
    `the ledger names ${expected.join(", ")}; the tree writes it in ${repeats.join(", ") || "nowhere"} — ${standing.because}`
  );
}

// -- 3b. The missing-schema predicate, written in three places, one agreement.
const SHARED_SCHEMA_FILE = `${REPO_DIR}/missingSchema.ts`;
const SCHEMA_PREDICATE_COPIES = [
  "src/modules/interviews/domain/interviewScorecard.ts",
  "src/modules/jobs/domain/openingTerms.ts",
];

/** The body of one exported function, from its header to the line that closes it. */
function functionBody(text, name) {
  const start = text.indexOf(`export function ${name}(`);
  if (start === -1) return null;
  const end = text.indexOf("\n}", start);
  return end === -1 ? null : text.slice(start, end);
}

/** The codes one copy of the predicate treats as "the schema is not there yet". */
function schemaCodesIn(body) {
  const literals = [...body.matchAll(/code\s*===\s*"([^"]+)"/g)].map((m) => m[1]);
  const viaTuple = body.includes("MISSING_SCHEMA_CODES") ? parseTuple(read(SHARED_SCHEMA_FILE), "MISSING_SCHEMA_CODES") ?? [] : [];
  return [...new Set([...literals, ...viaTuple])];
}

/** The message the same copies fall back to when a code is not sent. */
function schemaMessageIn(body) {
  return /\/([^/\n]+)\/i\.test\(\s*error\.message/.exec(body)?.[1] ?? null;
}

const sharedBody = functionBody(read(SHARED_SCHEMA_FILE), "isMissingSchemaError");
const sharedCodes = sharedBody ? schemaCodesIn(sharedBody) : [];
const sharedMessage = sharedBody ? schemaMessageIn(sharedBody) : null;

check(`the shared predicate names ${sharedCodes.length} codes`, sharedCodes.length === 4, sharedCodes.join(", "));

for (const file of SCHEMA_PREDICATE_COPIES) {
  const body = functionBody(read(file), "isMissingSchemaError");
  if (!body) {
    check(`${file} still writes isMissingSchemaError`, false);
    continue;
  }
  const codes = schemaCodesIn(body);
  const same = codes.length === sharedCodes.length && codes.every((c) => sharedCodes.includes(c));
  check(
    `${file.split("/").pop()}: the same ${sharedCodes.length} codes mean a missing schema`,
    same,
    [...sharedCodes.filter((c) => !codes.includes(c)).map((c) => `only here: ${c}`), ...codes.filter((c) => !sharedCodes.includes(c)).map((c) => `only there: ${c}`)].join(", ")
  );
  const message = schemaMessageIn(body);
  check(`${file.split("/").pop()}: the message fallback tests the same sentence`, message === sharedMessage, message === sharedMessage ? "" : `${message} vs ${sharedMessage}`);
}

// ---------------------------------------------------------------------------
// 4. The database answers.
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
/** `table.column` → tuple name, only for the CHECKs this run actually read. */
const checkVocab = {};

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
      WHERE t.typnamespace = 'public'::regnamespace ORDER BY t.typname, e.enumsortorder`
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
  // A text column counts as a named vocabulary only while the constraint that
  // makes it one is still on the table and still readable.
  for (const key of checksByColumn.keys()) {
    if (CHECK_TUPLES[key]) checkVocab[key] = CHECK_TUPLES[key];
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
    const td = typeDiff(fields, columns, checkVocab);
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

  // -- 3d. A text column with a word-list CHECK that core does not name is an
  //     undocumented ladder. A CHECK that bounds a shape (`referral_code ~
  //     '^[0-9A-F]{10}$'`) is not a ladder and is not reported here — see the
  //     three parser checks in section 2.
  const named = new Set(Object.keys(CHECK_TUPLES));
  for (const [key, con] of checksByColumn) {
    if (named.has(key)) continue;
    const columnType = [...columnsByTable.values()].flat().find((c) => `${c.table_name}.${c.column_name}` === key);
    if (!columnType || columnType.data_type !== "text") continue;
    check(`${key}: a CHECK over text with no core vocabulary (${con.labels.length} labels: ${con.labels.join("/")})`, false);
  }

  // -- 3e. The DTO that is a projection of a wider table.
  //
  // `Tenant` is the one row-shaped type `src/types` kept, because the staff
  // session reads six columns off a table `Company` in core describes in full.
  // Leaving twenty-one out is legal; naming a field that is not a column is not,
  // because PostgREST answers such a select with an error, not with a null.
  const tenantFields = parseInterface(typesFile, "Tenant");
  const companyRows = columnsByTable.get("tenants_and_companies") ?? [];
  if (!tenantFields || companyRows.length === 0) {
    check("the company table and its projection both answered", false);
  } else {
    const projected = fieldDiff(tenantFields, companyRows);
    check(
      `Tenant reads ${tenantFields.length} of the ${companyRows.length} columns tenants_and_companies holds, and each is one`,
      projected.extra.length === 0,
      projected.extra.map((f) => `not a column: ${f}`).join(", ")
    );
    const tnd = nullDiff(tenantFields, companyRows);
    check(`Tenant's ${tenantFields.length} fields are nullable exactly where the column is`, tnd.length === 0, tnd.join(" | "));
    const ttd = typeDiff(tenantFields, companyRows, checkVocab);
    check(`Tenant's ${tenantFields.length} fields are the family their columns store`, ttd.length === 0, ttd.join(" | "));
  }
}

// ---------------------------------------------------------------------------
// 5. The mutations — each one fed through the function above, and must go red.
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

  // The same two directions on the CHECK end of the ladder, over the table that
  // holds it: `job_openings.employment_type` is text bounded by a word list.
  const jobColumns = columnsByTable.get("job_openings");
  const jobFields = entities.get("job_openings");
  const looseVocab = jobFields.map((f) => (f.name === "employment_type" ? { ...f, type: "string" } : f));
  check(
    "a CHECK-backed vocabulary column typed as loose string is red",
    typeDiff(looseVocab, jobColumns, checkVocab).some((s) => s.startsWith("employment_type"))
  );

  const otherVocab = jobFields.map((f) => (f.name === "employment_type" ? { ...f, type: "ExperienceLevel" } : f));
  check(
    "a vocabulary column declared as the wrong tuple's interface is red",
    typeDiff(otherVocab, jobColumns, checkVocab).some((s) => s.startsWith("employment_type"))
  );

  const lostCon = jobFields.map((f) => (f.name === "employment_type" ? { ...f, type: "string" } : f));
  const withoutThatVocab = { ...checkVocab };
  delete withoutThatVocab["job_openings.employment_type"];
  check(
    "with the CHECK unreadable the named type is red and a loose string is the only legal spelling",
    typeDiff(jobFields, jobColumns, checkVocab).filter((s) => s.startsWith("employment_type")).length === 0 &&
      typeDiff(jobFields, jobColumns, withoutThatVocab).some((s) => s.startsWith("employment_type")) &&
      typeDiff(lostCon, jobColumns, withoutThatVocab).filter((s) => s.startsWith("employment_type")).length === 0
  );

  // A stored label core has never heard of — the case the header promises to name.
  const grownLabels = [...enumLabels.get("application_stage"), "ONBOARDED"];
  const d5 = labelDiff(tuples.get("APPLICATION_STAGES"), grownLabels);
  check("a label the enum gains is named against the tuple", d5.missing.includes("ONBOARDED"));

  const shrunkTuple = tuples.get("APPLICATION_SOURCES").filter((l) => l !== "REFERRAL");
  const d6 = labelDiff(shrunkTuple, enumLabels.get("application_source"));
  check("a label dropped from the tuple is named against the enum", d6.missing.includes("REFERRAL"));

  const inventedTuple = [...tuples.get("APPLICATION_SOURCES"), "TELEGRAM"];
  const d6b = labelDiff(inventedTuple, enumLabels.get("application_source"));
  check("a label the tuple invents is named against the enum", d6b.extra.includes("TELEGRAM"));

  const conKey = "user_profiles.locale";
  const grown = checksByColumn.get(conKey);
  const d7 = labelDiff(tuples.get("LOCALES"), [...grown.labels, "tr"]);
  check("a locale the CHECK gains is named against the tuple", d7.missing.includes("tr"));

  // The projection: leaving a column out is legal, naming a field that is not a
  // column is not, and each kept field still owes its column its family and its nullability.
  const companyCols = columnsByTable.get("tenants_and_companies") ?? [];
  const projection = parseInterface(typesFile, "Tenant") ?? [];
  const pruned = projection.filter((f) => f.name !== "sector");
  check(
    "a column left out of the projection is seen but not named a violation",
    fieldDiff(pruned, companyCols).missing.includes("sector") && fieldDiff(pruned, companyCols).extra.length === 0
  );

  const phantomField = projection.map((f) => (f.name === "sector" ? { ...f, name: "sector_kind" } : f));
  check("a projection field that stops being a column is named", fieldDiff(phantomField, companyCols).extra.includes("sector_kind"));

  const projectionAsNumber = projection.map((f) => (f.name === "country" ? { ...f, type: "number" } : f));
  check("a projection field retyped away from its column's family is red", typeDiff(projectionAsNumber, companyCols, checkVocab).length > 0);

  const projectionWithNull = projection.map((f) => (f.name === "created_at" ? { ...f, type: "string | null" } : f));
  check("a projection field given a null the column refuses is red", nullDiff(projectionWithNull, companyCols).length > 0);
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

// -- The repository half, mutated.
//
// Each rewrite is confined to the one line the check reads, so a mutation that
// misses its target cannot be mistaken for a check that passed.
function mutateOnce(label, text, rewrite) {
  const next = rewrite(text);
  if (next === text) {
    check(`${label}: the mutation this proof relies on lands`, false, "the rewritten text is byte-for-byte the original");
    return null;
  }
  return next;
}

const driftedSelect = mutateOnce(
  "a projection's column list",
  read(`${REPO_DIR}/candidateAttempt.ts`),
  (t) => t.replace('.select("application_id, total_score")', '.select("application_id, final_score")')
);
if (driftedSelect) {
  const mutatedRead = readRequests(driftedSelect)[0];
  const offenders = columnsNamed(driftedSelect, mutatedRead.chain).columns.filter(
    (c) => !entities.get("candidate_attempts").some((f) => f.name === c)
  );
  check("a column a projection invented is named against the row type", offenders.includes("final_score"), offenders.join(", "));
}

const castSelect = mutateOnce(
  "a projection's column list",
  read(`${REPO_DIR}/candidateAttempt.ts`),
  (t) => t.replace('.select("application_id, total_score")', '.select("application_id, total_score::text")')
);
if (castSelect) {
  const mutatedRead = readRequests(castSelect)[0];
  check(
    "a column renamed by a cast is not silently skipped",
    columnsNamed(castSelect, mutatedRead.chain).unparsed.length === 1
  );
}

const widenedPick = mutateOnce(
  "a projection's Pick",
  read(`${REPO_DIR}/sourcedProspect.ts`),
  (t) => t.replace('| "profile_captured_at"', '| "captured_profile_at"')
);
if (widenedPick) {
  const pick = picksNamed(widenedPick).find((p) => p.iface === "SourcedProspect");
  const fields = entities.get("sourced_prospects");
  check(
    "a Pick that names a field the row type lacks is red",
    pick.members.filter((mem) => !fields.some((f) => f.name === mem)).includes("captured_profile_at")
  );
}

const reachedUp = mutateOnce(
  "a repository file's imports",
  read(`${REPO_DIR}/jobOpening.ts`),
  (t) => t.replace('import type { StaffReadClient } from "./restClient";', 'import { HIREABLE_STATUSES } from "@/modules/jobs/domain/hireable";\nimport type { StaffReadClient } from "./restClient";')
);
if (reachedUp) {
  const offenders = importSpecifiers(reachedUp).filter((s) => !REPO_ALLOWED_IMPORTS.some((a) => s.startsWith(a)));
  check("a repository that imports a module's rule is red", offenders.includes("@/modules/jobs/domain/hireable"), offenders.join(", "));
}

const renamedProjection = mutateOnce(
  "a projection's name",
  read(`${REPO_DIR}/candidateAttempt.ts`),
  (t) => t.replace("export async function readAttemptScoresByApplication(", "export async function readScoresOfEveryPaper(")
);
if (renamedProjection) {
  const fn = /^export (?:async )?function (\w+)/m.exec(renamedProjection)[1];
  check("a projection left without a caller is named as dead", callersOf(fn) === 0, `${fn} has ${callersOf(fn)} callers`);
}

const driftedCopy = mutateOnce(
  "the interview scorecard's copy of the predicate",
  read("src/modules/interviews/domain/interviewScorecard.ts"),
  (t) => t.replace('error.code === "42703"', 'error.code === "42704"')
);
if (driftedCopy) {
  const codes = schemaCodesIn(functionBody(driftedCopy, "isMissingSchemaError"));
  check(
    "a copy that changes one code is named against the shared list",
    !codes.includes("42703") && codes.includes("42704") && !sharedCodes.includes("42704")
  );
}

const rewordedCopy = mutateOnce(
  "the jobs module's message fallback",
  read("src/modules/jobs/domain/openingTerms.ts"),
  (t) => t.replace("/does not exist|schema cache/i", "/column is missing/i")
);
if (rewordedCopy) {
  check(
    "a copy that rewords the message fallback is named",
    schemaMessageIn(functionBody(rewordedCopy, "isMissingSchemaError")) !== sharedMessage
  );
}

// -- 3c, mutated.
//
// The ownership check is only worth having if both directions are proven: a copy
// nobody ledgered has to be named, and a ledger that no longer matches the tree
// has to be named too.

/** Every read chain one file writes, reduced to the question it asks. */
function identitiesIn(text) {
  return readRequests(text).map((r) => chainIdentity(text, r.chain));
}

const stageDoorRead = layerReads.find((r) => r.file === "application.ts" && r.identity.includes("full_name"));
const reInlined = stageDoorRead
  ? mutateOnce(
      "the offer desk's read",
      read("src/app/(admin)/candidates/offer-actions.ts"),
      (t) =>
        t.replace(
          "  const existing = await readLatestOffer(input.applicationId);",
          `  const { data: handWritten } = await restClient
    .from("applications")
    .select("id, stage, full_name")
    .eq("id", input.applicationId)
    .maybeSingle();
  if (!handWritten) return { ok: false, error: "gone" };

  const existing = await readLatestOffer(input.applicationId);`
        )
    )
  : null;
if (reInlined) {
  const copies = identitiesIn(reInlined).filter((id) => id === stageDoorRead.identity);
  check(
    "a door that re-inlines a read the layer owns is named",
    copies.length === 1,
    `the injected chain matched ${copies.length} times against ${stageDoorRead.identity}`
  );
}

const erasureIdentity = [...STANDING_COPIES.keys()].find((id) => id.includes("person_id"));
const ERASURE_FILE = "src/modules/privacy/application/erasure.ts";
const wiredErasure = erasureIdentity
  ? mutateOnce(
      "the erasure's person read",
      read(ERASURE_FILE),
      (t) => t.replace('.select("person_id")', '.select("person_id, email")')
    )
  : null;
if (wiredErasure) {
  // What the ownership check would compare, with the mutated file standing in for
  // the real one: the copy is gone from the tree, the ledger still names it.
  const written = outsideLayer
    .flatMap((s) =>
      identitiesIn(s.rel === ERASURE_FILE ? wiredErasure : s.text)
        .filter((id) => id === erasureIdentity)
        .map(() => s.rel)
    )
    .sort();
  const expected = STANDING_COPIES.get(erasureIdentity).files.slice().sort();
  check(
    "a ledgered copy wired through the layer, with its entry left behind, is named",
    written.join(",") !== expected.join(","),
    `the gate would read ${written.join(", ") || "nowhere"} against a ledger of ${expected.join(", ")}`
  );
}

// -- 3c mutations for the repointed layer-call needles.
//
// The ownership gate went green the moment each door's inline chain became a call
// to the layer. A needle that now reads for the layer function rather than the
// chain is only worth checking if replacing it with the old chain turns the gate
// red again — so each of the three doors whose needle was repointed this session
// gets a mutation that re-inlines its read and asks whether the comparison names it.

const publishedOpeningRead = layerReads.find(
  (r) => r.file === "jobOpening.ts" && r.identity.includes("PUBLISHED")
);
const FORM_PREFILL_REL = "src/app/api/careers/form-prefill/route.ts";
const reInlinedPublished = publishedOpeningRead
  ? mutateOnce(
      "the form-prefill door's published-opening read",
      read(FORM_PREFILL_REL),
      (t) =>
        t.replace(
          "  const opening = await readPublishedOpening(restClient, jobId);",
          `  const { data: opening } = await restClient
    .from("job_openings")
    .select("id")
    .eq("id", jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();`
        )
    )
  : null;
if (reInlinedPublished) {
  const copies = identitiesIn(reInlinedPublished).filter((id) => id === publishedOpeningRead.identity);
  check(
    "the form-prefill door re-inlines the published-opening read → the 3c gate names it",
    copies.length === 1,
    `the injected chain matched ${copies.length} times against ${publishedOpeningRead.identity}`
  );
}

const experienceLevelsRead = layerReads.find(
  (r) => r.file === "jobOpening.ts" && r.identity.includes("experience_level") && r.identity.includes('in("id"')
);
const EXPERIENCE_INLINE = `  const { data, error } = await restClient
    .from("job_openings")
    .select("id, experience_level")
    .in("id", [...ids]);`;

const reInlinedCareers = experienceLevelsRead
  ? mutateOnce(
      "the public board's experience-levels read",
      read("src/app/careers/actions.ts"),
      (t) => t.replace("  const read = await readOpeningExperienceLevels(restClient, ids);", EXPERIENCE_INLINE)
    )
  : null;
if (reInlinedCareers) {
  const copies = identitiesIn(reInlinedCareers).filter((id) => id === experienceLevelsRead.identity);
  check(
    "the public board re-inlines the experience-levels read → the 3c gate names it",
    copies.length === 1,
    `the injected chain matched ${copies.length} times against ${experienceLevelsRead.identity}`
  );
}

const reInlinedTermsRead = experienceLevelsRead
  ? mutateOnce(
      "the opening-terms probe's experience-levels read",
      read("src/modules/jobs/application/openingTermsRead.ts"),
      (t) => t.replace("  const read = await readOpeningExperienceLevels(restClient, ids);", EXPERIENCE_INLINE)
    )
  : null;
if (reInlinedTermsRead) {
  const copies = identitiesIn(reInlinedTermsRead).filter((id) => id === experienceLevelsRead.identity);
  check(
    "the opening-terms probe re-inlines the experience-levels read → the 3c gate names it",
    copies.length === 1,
    `the injected chain matched ${copies.length} times against ${experienceLevelsRead.identity}`
  );
}

// The account read's ledger entry left with the last ten doors, so its ownership
// check is now the plain "no copies outside" half. That green only means
// something if a door writing the chain by hand again turns it red — so this
// mutation re-inlines one and asks what the comparison would count.
const accountReadIdentity = layerReads
  .filter((r) => r.file === "userProfile.ts")
  .map((r) => r.identity)
  .find((id) => id.includes('eq("auth_user_id"'));
const USER_ACTIONS_REL = "src/modules/settings/application/user-actions.ts";
const reInlinedAccount = accountReadIdentity
  ? mutateOnce(
      "a staff door's account read",
      read(USER_ACTIONS_REL),
      (t) =>
        t.replace(
          "      const found = await readStaffProfileIdByAuthUserId(restClient, sessionData.user.id);",
          `      const { data: accountRow } = await restClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", sessionData.user.id)
        .maybeSingle();
      const found = { ok: true, profileId: accountRow?.id ?? null };`
        )
    )
  : null;
if (reInlinedAccount) {
  const written = outsideLayer
    .flatMap((s) =>
      identitiesIn(s.rel === USER_ACTIONS_REL ? reInlinedAccount : s.text)
        .filter((id) => id === accountReadIdentity)
        .map(() => s.rel)
    )
    .sort();
  check(
    "a staff door that re-inlines the account read is named with the ledger gone",
    written.length === 1 && !STANDING_COPIES.has(accountReadIdentity),
    `the gate would count ${written.length} copy${written.length === 1 ? "" : "ies"}: ${written.join(", ") || "nowhere"}`
  );
}

// The manual-entry picker's ledger entry left the same way: the layer's picker
// read widened to carry `department`, so the door has no chain of its own left
// to name. This mutation puts the door's original pair back — the rows half the
// ledger never counted, and the head-count half it excused — and asks whether
// the ownership check now names both.
const pickerIdentities = layerReads
  .filter((r) => r.file === "jobOpening.ts")
  .map((r) => r.identity)
  .filter(
    (id) =>
      id.includes('in("status"') &&
      (id.includes('{count: "exact", head: true}') || id.includes(".limit("))
  );
const MANUAL_PICKER_REL = "src/app/(admin)/candidates/candidate-actions.ts";
const reInlinedPicker =
  pickerIdentities.length === 2
    ? mutateOnce(
        "the manual-entry picker's own pair of reads",
        read(MANUAL_PICKER_REL),
        (t) =>
          t.replace(
            // The door's file carries CRLF line endings; a `\n`-only needle
            // would match nothing and the mutation would report itself as landless.
            /const picker = await readOpeningPickerWindow\(restClient, \{[\s\S]*?\}\);/,
            `const [pickerRows, pickerCount] = await Promise.all([
    restClient
      .from("job_openings")
      .select("id, title, department, status")
      .in("status", [...HIREABLE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(PICKER_LIMIT),
    restClient
      .from("job_openings")
      .select("id", { count: "exact", head: true })
      .in("status", [...HIREABLE_STATUSES]),
  ]);
  const picker = { ok: true, rows: pickerRows, total: pickerCount.count };`
          )
      )
    : null;
if (reInlinedPicker) {
  const named = new Set();
  for (const id of pickerIdentities) {
    const written = outsideLayer.some((s) =>
      identitiesIn(s.rel === MANUAL_PICKER_REL ? reInlinedPicker : s.text).includes(id)
    );
    if (written) named.add(id);
  }
  check(
    "the manual-entry picker that re-inlines its own pair is named on both halves, with the ledger gone",
    named.size === 2 && pickerIdentities.every((id) => !STANDING_COPIES.has(id)),
    `the gate names ${named.size} of ${pickerIdentities.length}: ${[...named].map((i) => i.slice(0, 40)).join(" | ")}`
  );
}

// ---------------------------------------------------------------------------
// 6. The tally.
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
