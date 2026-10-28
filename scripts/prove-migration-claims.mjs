/* scripts/prove-migration-claims.mjs — Run: node scripts/prove-migration-claims.mjs
 *
 * This portal's copy says, page by page, whether *this* database has a given
 * migration: "025 is applied, so the page reads real rows", "033 is authored but
 * not applied, so the drawer hides the level picker". Two slices (#440, #483) were
 * spent fixing claims that had gone stale after a migration was applied, and
 * nothing pinned the agreement afterwards — the next `db:apply-local` of 031–035
 * would silently make six sentences lie.
 *
 * So this asks the database first and the copy second. For each migration the copy
 * names, one SQL question establishes whether its signature object is here; then
 * every claim sentence is read for the polarity it states ("is applied" versus
 * "not applied" / "until that file is applied") and compared with that answer.
 * The database decides, not the file listing: an authored .sql is worth nothing
 * until something applies it, which is the whole reason these claims exist.
 *
 * Part one is pure text and runs anywhere: a sentence that names
 * `db/migrations/033_opening_terms.sql` is a pointer a recruiter is told to run,
 * so renaming or deleting that file under the copy must fail here rather than
 * send someone at `npm run db:apply-local` after a file that is not there.
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
// Which files the copy names, and how each one is asked about.
//
// One probe per migration, phrased against information_schema / pg_catalog on the
// app database: a file that only exists as text answers "absent", and a partly
// applied file answers by its own signature object. Each probe is the migration's
// first structural act — the thing the shipped read looks for.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  {
    file: "024_activity_log.sql",
    asks: "select to_regclass('public.activity_log') is not null as present",
  },
  {
    file: "025_time_entries.sql",
    asks: "select to_regclass('public.time_entries') is not null as present",
  },
  {
    file: "026_positions.sql",
    asks:
      "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='positions' and column_name='id') as present",
  },
  {
    file: "031_job_headcount.sql",
    asks:
      "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='job_openings' and column_name='positions_needed') as present",
  },
  {
    file: "032_interview_scorecards.sql",
    asks: "select to_regclass('public.interview_scorecards') is not null as present",
  },
  {
    file: "033_opening_terms.sql",
    asks:
      "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='job_openings' and column_name='experience_level') as present",
  },
  {
    file: "034_situational_judgment.sql",
    asks:
      "select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'question_type' and e.enumlabel = 'SITUATIONAL_JUDGMENT') as present",
  },
  {
    file: "035_assessment_follow_ups.sql",
    asks:
      "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='assessment_templates' and column_name='follow_up_template_id') as present",
  },
  {
    file: "037_opening_skills.sql",
    asks: "select to_regclass('public.job_opening_skills') is not null as present",
  },
  {
    file: "038_interview_notes.sql",
    asks: "select to_regclass('public.interview_notes') is not null as present",
  },
  {
    file: "039_coding_questions.sql",
    asks:
      "select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'question_type' and e.enumlabel = 'CODING') as present",
  },
  {
    file: "040_referrals.sql",
    asks: "select to_regclass('public.referrals') is not null as present",
  },
  {
    file: "046_assistant_voice_autonomy.sql",
    asks: "select to_regclass('public.assistant_voice_autonomy') is not null as present",
  },
  {
    file: "047_assistant_jarvis_prefs.sql",
    asks: "select to_regclass('public.assistant_jarvis_prefs') is not null as present",
  },
  {
    file: "048_user_permission_overrides.sql",
    asks: "select to_regclass('public.user_permission_overrides') is not null as present",
  },
  {
    file: "049_jarvis_appearance.sql",
    asks:
      "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='assistant_jarvis_prefs' and column_name='appearance') as present",
  },
];

// ---------------------------------------------------------------------------
// 1. Every migration the copy names is a file that exists.
// ---------------------------------------------------------------------------
const authored = new Set(readdirSync(path.join(root, "db", "migrations")));
const NAMED = /db\/migrations\/(\d+_[a-z0-9_]+\.sql)/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const sourceFiles = walk("src");
const dangling = [];
const namedFiles = new Set();
for (const rel of sourceFiles) {
  for (const m of read(rel).match(NAMED) ?? []) {
    namedFiles.add(path.basename(m));
    if (!authored.has(path.basename(m))) dangling.push(`${rel}: ${m}`);
  }
}
check(
  "every migration named in src/ is a file db/migrations/ holds",
  dangling.length === 0,
  dangling.join(" | ")
);
check(
  "the copy names every migration this proof asks about",
  MIGRATIONS.every((m) => namedFiles.has(m.file)),
  MIGRATIONS.filter((m) => !namedFiles.has(m.file))
    .map((m) => m.file)
    .join(", ")
);

// ---------------------------------------------------------------------------
// 2. The database answers for each one.
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

const client = new Client({ connectionString: env.AUTH_DB_URL, connectionTimeoutMillis: 8000 });
const onDatabase = new Map();
try {
  await client.connect();
} catch (e) {
  console.log(
    `\nFAIL the app database could not be reached (${e.message}) — this proof asks the\n` +
      `     database what it holds, so it needs the stack: npm run docker:up.\n` +
      `     It does not print the connection string.`
  );
  process.exitCode = 1;
}

if (client.connection) {
  for (const m of MIGRATIONS) {
    const { rows } = await client.query(m.asks);
    onDatabase.set(m.file, rows[0].present === true);
  }
  await client.end();
  console.log(
    "\n     on this database: " +
      [...onDatabase].map(([f, v]) => `${f.slice(0, 3)} ${v ? "applied" : "absent"}`).join(" | ") +
      "\n"
  );
}

// ---------------------------------------------------------------------------
// 3. What the copy claims, read against that answer.
//
// Two lists, because the two kinds of copy carry different promises.
//
// STRICT is the manual a recruiter reads — it states THIS database's state
// unconditionally, in the present tense, and is shown whether or not any probe
// ran. That is exactly the copy #440 and #483 had to be rewritten, so every
// migration it names must say which way it goes, and say it correctly.
//
// SOFT is shipped refusal and tool-description copy. Most of it only ever prints
// after a runtime probe has failed, so a stale sentence there is unreachable text
// rather than a lie on screen — still worth checking when it does state a polarity,
// but not worth demanding one: "Storing a level needs 033" is a true sentence the
// reader does not need to be handed a marker for.
// ---------------------------------------------------------------------------
const STRICT_FILES = [
  "src/modules/shell/domain/pageGuide.ts",
  "src/modules/shell/presentation/AppBarGuide.tsx",
];

const SOFT_FILES = [
  "src/modules/jobs/domain/openingTerms.ts",
  "src/modules/jobs/domain/openingSkills.ts",
  "src/modules/jobs/domain/hiringDemand.ts",
  "src/modules/assessment/domain/situational.ts",
  "src/modules/assessment/domain/followUp.ts",
  "src/modules/assessment/application/questionTypeAvailability.ts",
  "src/modules/interviews/domain/interviewScorecard.ts",
  "src/modules/interviews/domain/interviewNotes.ts",
  "src/modules/assistant/domain/registry/writes.ts",
  "src/modules/assistant/domain/registry/reads.ts",
  "src/modules/assistant/domain/registry/interviews.ts",
];

// Phrases, not verbs. `is applied` on its own cannot carry this: "REMOTE and HYBRID
// are refused until 033 is applied" and "include them once 033 is applied" both
// contain it and neither states this database's state — they name a condition and
// leave the answer open. So a mention is only read as a claim when the wording
// around it asserts this database ("not applied", "is applied on this database",
// "is applied, so <it works>") and the phrase nearest the file name decides the way
// it goes, in either direction: the Guide says "both read tables that are applied on
// this database — 024 and 025", where the wording sits behind the names. Absent wins
// a tie, because `until that file is applied` is absent wording wrapped in a verb
// that looks present.
//
// The last clause is the schema-refusal idiom — "Rounds and scorecards have not been
// created on this database yet. Apply db/migrations/032_interview_scorecards.sql".
// The file name lives in a `const` that the sentences interpolate, so the marker sits
// on the far side of the declaration, and without it every refusal file in SOFT reads
// as making no claim at all. The phrase asserts this database in as many words, so it
// belongs in the list; the scorecard and notes refusals are the copy it was added for.
const ABSENT =
  /(not\s+applied|has\s+not\s+been\s+(?:run|applied)|is\s+unapplied|not\s+yet\s+applied|until\s+(?:that\s+file|it)\s+is\b|(?:have|has)\s+not\s+been\s+created\s+on\s+this\s+database)/i;
const PRESENT = /(applied\s+on\s+this\s+database|is\s+applied,\s+so|are\s+applied,\s+so)/i;
const WINDOW = 200;

function nearest(regex, text, at) {
  const forward = text.slice(at).search(regex);
  let back = -1;
  for (const m of [...text.slice(0, at).matchAll(new RegExp(regex.source, "gi"))]) back = m.index;
  const distances = [];
  if (forward >= 0 && forward <= WINDOW) distances.push(forward);
  if (back >= 0 && at - back <= WINDOW) distances.push(at - back);
  return distances.length ? Math.min(...distances) : null;
}

function claimsOf(text) {
  const found = [];
  for (const m of [...text.matchAll(NAMED)]) {
    const at = m.index + m[0].length;
    const absentAt = nearest(ABSENT, text, at);
    const presentAt = nearest(PRESENT, text, at);
    const tooFar = (d) => d === null || d > WINDOW;
    let polarity = "none";
    if (!tooFar(absentAt) && !tooFar(presentAt)) polarity = absentAt <= presentAt ? "absent" : "present";
    else if (!tooFar(absentAt)) polarity = "absent";
    else if (!tooFar(presentAt)) polarity = "present";
    found.push({ file: path.basename(m[0]), polarity });
  }
  return found;
}

for (const rel of STRICT_FILES) {
  const claims = claimsOf(read(rel));
  const bare = claims.filter((c) => c.polarity === "none").map((c) => c.file);
  check(
    `${rel}: every migration it names says whether this database has it`,
    claims.length > 0 && bare.length === 0,
    `${claims.length} named, ${bare.length} without a claim${bare.length ? `: ${bare.join(", ")}` : ""}`
  );
  for (const c of claims) {
    const truth = onDatabase.get(c.file);
    if (truth === undefined || c.polarity === "none") continue;
    check(
      `${rel}: ${c.file} is said ${c.polarity}`,
      truth === (c.polarity === "present"),
      `the database has it ${truth}`
    );
  }
}

for (const rel of SOFT_FILES) {
  for (const c of claimsOf(read(rel)).filter((x) => x.polarity !== "none")) {
    const truth = onDatabase.get(c.file);
    if (truth === undefined) continue;
    check(
      `${rel}: ${c.file} is said ${c.polarity}`,
      truth === (c.polarity === "present"),
      `the database has it ${truth}`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. The demand note's wording is conditional because its read is.
//
// getOpeningsHeadcount() returns `unavailable` for ANY error on the
// `positions_needed` read, so the grid cannot know a missing column is the cause.
// The note therefore names 031 as a condition ("on a database where it has never
// run") and never as this database's state — an unqualified claim either way would
// be an assertion the code cannot support, and after 031 was applied it would be a
// lie. So this pins the two halves of that agreement: the file is named, and no
// polarity is stated.
// ---------------------------------------------------------------------------
const demandNote = read("src/modules/jobs/domain/hiringDemand.ts");
const noteLine = /return "([^"]*headcount target[^"]*)"/.exec(demandNote)?.[1] ?? null;
const noteClaims = noteLine ? claimsOf(noteLine) : [];
check(
  "the headcount note names 031 without claiming this database's state",
  !!noteLine &&
    noteClaims.some((c) => c.file === "031_job_headcount.sql") &&
    noteClaims.every((c) => c.polarity === "none"),
  noteLine
    ? `${noteClaims.length} mention(s), ${noteClaims.filter((c) => c.polarity !== "none").length} with a polarity`
    : "the note was not found"
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
