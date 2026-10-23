/* scripts/prove-settings-keys.mjs — Run: node scripts/prove-settings-keys.mjs
 *
 * Settings draws one control per entry of `SETTINGS_SCHEMA` and saves the value
 * into `app_settings`. The sibling of the role matrix's claim ("granular access
 * control") is this page's: what you tick here changes what the portal does.
 * A control no code reads is a form field, not a setting; a key code reads with
 * no control is a decision nobody can reach from the console; a row in the table
 * that belongs to neither is a switch that exists only for whoever queries the
 * database directly — and its `description` column is copy nobody maintains.
 *
 * `security.require_oauth` was the third kind: seeded by migration 001, described
 * as "Force single sign-on for all staff", read by nothing, and absent from the
 * console, so the promise lived in a table while the enforcement never existed.
 * db/migrations/036_retire_unused_oauth_setting.sql removes it and is NOT applied
 * yet; until it runs, the key sits on the waiting list below, and that list is
 * checked for being real, small and stale.
 *
 * The reads are matched by call shape, not by the key appearing in a file: the
 * Guide names switches in prose, and a sentence cannot read a row.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

// ---------------------------------------------------------------------------
// What the console offers, read out of the declarative schema.
//
// Every control object in schema.ts opens with `kind:` then `key:`, so one pair
// match recovers both. A proof that re-typed the 28 keys would only prove that it
// could copy them.
// ---------------------------------------------------------------------------
const schemaFile = read("src/modules/settings/domain/schema.ts");
const controls = [...schemaFile.matchAll(/kind:\s*"([a-z_]+)",\s*key:\s*"([a-z_.]+)"/g)].map((m) => ({
  kind: m[1],
  key: m[2],
}));
const controlKeys = new Set(controls.map((c) => c.key));
check(
  "the console's controls were read out of the schema file",
  controls.length > 0 && controlKeys.size === controls.length,
  `${controls.length} controls, ${controlKeys.size} distinct keys`
);

// The wording rows share the table with the switches, on purpose: the Languages
// console owns them and writes them under a computed key, so they are never
// supposed to appear in SETTINGS_SCHEMA. The prefix is taken from the domain that
// defines it rather than copied here.
const overridePrefix = /OVERRIDES_KEY_PREFIX\s*=\s*"([^"]+)"/.exec(
  read("src/modules/i18n/domain/translations.ts")
)?.[1];
check("the wording rows' key prefix was read out of the i18n domain", Boolean(overridePrefix), overridePrefix ?? "not found");

// ---------------------------------------------------------------------------
// Which keys the running code reads.
//
// Four call shapes are a read: an accessor (`getBoolSetting("…")`), the cached
// bundle (`settings.get("…")` / `readGlobalSettings([…])`), the console's own
// value map (`bundle.values["…"]`), and a single-row REST read (`.eq("key", "…")`
// / `.in("key", […])`). A key held in a `const` counts when that same file passes
// the const into one of those shapes — three of the assessment rules live that way.
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const files = walk("src").filter((rel) => rel !== "src/modules/settings/domain/schema.ts");
const READ_SHAPES = [
  /get(?:Bool|Number|String|StringList)Setting\(\s*(\[[^\]]*\]|[\w"'"`]+[^)]*)\)/g,
  /readGlobalSettings\(\s*(\[[^\]]*\][^)]*)\)/g,
  /\b[\w$]+\.get\(\s*(\[[^\]]*\]|[\w"']+)\s*\)/g,
  /\b[\w$]+\.values\[\s*("?[^\]"]+"?)\s*\]/g,
  /\.e[qp]\(\s*"key",\s*("[^"]+"|[^),]+)\)/g,
];

const readKeys = new Map(); // key → files that read it
function noteKey(key, where) {
  const at = readKeys.get(key) ?? new Set();
  at.add(where);
  readKeys.set(key, at);
}

for (const rel of files) {
  const text = read(rel);
  // Consts first, so `const LOCK_KEY = "assessment.lock_on_expiry"` followed by
  // `settings.get(LOCK_KEY)` resolves to the key rather than the identifier.
  const consts = new Map();
  for (const m of text.matchAll(/const\s+([A-Z0-9_]+)\s*(?::\s*string)?\s*=\s*"([a-z_]+(?:\.[a-z_]+)+)"/g)) {
    consts.set(m[1], m[2]);
  }
  for (const shape of READ_SHAPES) {
    for (const m of text.matchAll(new RegExp(shape.source, "g"))) {
      const arg = m[1] ?? "";
      for (const literal of arg.matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) noteKey(literal[1], rel);
      for (const [name, key] of consts) {
        if (new RegExp(`\\b${name}\\b`).test(arg)) noteKey(key, rel);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Part one of the claim: every control the console renders decides something.
// ---------------------------------------------------------------------------
for (const control of controls) {
  const at = readKeys.get(control.key);
  check(
    `${control.key} is read by the code that acts on it`,
    Boolean(at),
    at ? [...at].join(", ") : "no accessor, bundle read or row query names it"
  );
}

// The same claim in the other direction: a key read by code with no control is a
// decision the console cannot change, which is how a setting ends up tuned only
// by editing the database.
const uncontrolled = [...readKeys.keys()].filter(
  (k) => !controlKeys.has(k) && !(overridePrefix && k.startsWith(overridePrefix))
);
check(
  "every key the code reads is either a control or a wording row",
  uncontrolled.length === 0,
  uncontrolled.map((k) => `${k} (${[...readKeys.get(k)].join(", ")})`).join(" | ")
);

// A control whose rows the save path cannot write is a form field that always
// reports success while changing nothing. The write filter is derived from the
// same schema the console renders, so a control can never be unsaveable — but only
// while both halves hold, which is what this checks.
const derived = /ALLOWED_SETTING_KEYS[\s\S]{0,160}?new Set\(\s*SETTINGS_SCHEMA\.flatMap/.test(schemaFile);
const filtered = /ALLOWED_SETTING_KEYS\.has\(/.test(read("src/app/(admin)/settings/actions.ts"));
check(
  "every control is savable and nothing else is",
  derived && filtered,
  `${derived ? "the write filter is derived from SETTINGS_SCHEMA" : "the filter is not derived from the schema"}, ${
    filtered ? "the save path applies it" : "saveSettings does not apply it"
  }`
);

// ---------------------------------------------------------------------------
// Part two — the table's own rows.
// ---------------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(path.join(root, "docker", ".env"), "utf8")
    .split(/\r?\n/)
    .map((l) => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
      return m ? [m[1], m[2].trim()] : null;
    })
    .filter(Boolean)
);

// Rows the console cannot show and nothing reads, with the migration that removes
// them. Each entry is re-proved below: still a row (so the migration really is
// unapplied), still unread, and the named file exists. A list like this rots in
// both directions, so it is checked as hard as the rule it excepts.
const AWAITING_RETIREMENT = [
  { key: "security.require_oauth", migration: "db/migrations/036_retire_unused_oauth_setting.sql" },
];

const client = new Client({ connectionString: env.AUTH_DB_URL, connectionTimeoutMillis: 8000 });
let reachable = false;
try {
  await client.connect();
  reachable = true;
} catch (e) {
  console.log(
    `FAIL cannot reach the app database (${e.message}). ` +
      "Start the stack with `npm run docker:up` — this proof asks the running instance which switches it actually holds."
  );
  console.log("It does not print the connection string.");
  process.exitCode = 1;
}

if (reachable) {
  const rows = (
    await client.query("select scope, company_id, key from app_settings order by key")
  ).rows;
  const globalKeys = rows.filter((r) => r.scope === "GLOBAL").map((r) => r.key);
  const held = new Set(globalKeys);

  // Only `GLOBAL` is ever looked at: the console filters `eq("scope", "GLOBAL")`
  // and so does the cached reader, so a row under any other scope is written and
  // read by nothing and would survive a settings save unnoticed.
  const otherScope = rows.filter((r) => r.scope !== "GLOBAL");
  check(
    "every row sits in the one scope both the console and the reader look at",
    otherScope.length === 0,
    otherScope.length
      ? otherScope.map((r) => `${r.key} (${r.scope})`).join(", ")
      : `${rows.length} rows, all GLOBAL`
  );

  const orphans = globalKeys.filter(
    (k) => !controlKeys.has(k) && !(overridePrefix && k.startsWith(overridePrefix)) && !readKeys.has(k)
  );
  const waiting = new Set(AWAITING_RETIREMENT.map((w) => w.key));
  const unexplained = orphans.filter((k) => !waiting.has(k));
  check(
    "the table holds no switch that no console shows and no code reads",
    unexplained.length === 0,
    unexplained.length
      ? `${unexplained.join(", ")} — a setting only a database query can see`
      : `${globalKeys.length} rows, each a control, a wording row, or awaiting a named retirement`
  );

  for (const item of AWAITING_RETIREMENT) {
    const stillThere = held.has(item.key);
    const authored = (() => {
      try {
        read(item.migration).includes(item.key);
        return true;
      } catch {
        return false;
      }
    })();
    check(
      `${item.key} waits on ${item.migration} for the reason named there`,
      stillThere && !readKeys.has(item.key) && authored,
      stillThere
        ? `${readKeys.has(item.key) ? "it is read, so the exception is wrong" : "unread"}, migration ${authored ? "authored and names the key" : "missing or does not name it"}`
        : "the row is gone — drop this entry from the waiting list"
    );
  }

  // A control with no row is not a bug — every accessor takes a shipped fallback —
  // but the console has to be showing that fallback rather than an empty field it
  // then writes back as a value. The count is printed so a reviewer sees which
  // switches are defaults today.
  const unset = controls.filter((c) => !held.has(c.key)).map((c) => c.key);
  console.log(
    `     ${controls.length - unset.length} of ${controls.length} controls have a row; reading a fallback: ${unset.join(", ") || "none"}`
  );

  await client.end();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
