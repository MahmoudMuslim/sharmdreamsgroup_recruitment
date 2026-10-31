/* scripts/prove-opening-terms.mjs
 * Run: node --experimental-strip-types scripts/prove-opening-terms.mjs
 *
 * #259 gives an opening a seniority level and teaches the employment-type check
 * Remote and Hybrid. Most of the feature needs a database: the column, the four
 * levels and the widened check are `db/migrations/033_opening_terms.sql`'s, and on
 * a database where that file has never run neither the level nor the two types
 * exist. What can be pinned without one is the part every door shares:
 *
 *   1. the two closed vocabularies, their labels and the one reader a write uses;
 *   2. what a submitted level means — a code, a deliberate blank, or a refusal;
 *   3. the schema-missing predicate — a missing column is not a refused value;
 *   4. the DDL — column, both checks, cache reload, and no invented level;
 *   5. the wiring markers — every screen and the chat reach the same lists, and no
 *      shared select names the column its own degradable probe reads.
 *
 * (4) and (5) are text assertions, deliberately: the SQL is reviewed, never run
 * here, and the screens need a browser. They catch the files being edited apart,
 * not a runtime that was misconfigured. Whether 033 is applied to any given
 * database is a fact about that database, not about this tree, and is checked
 * separately against the local stack.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_VALUES,
  EXPERIENCE_LABELS,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_VALUES,
  EMPLOYMENT_WRITE_REFUSAL,
  EXPERIENCE_WRITE_REFUSAL,
  OPENING_TERMS_MIGRATION,
  OPENING_TERMS_SCHEMA_NOTE,
  experienceLabel,
  isEmploymentType,
  isExperienceLevel,
  isMissingSchemaError,
  readExperienceLevel,
} from "../src/modules/jobs/domain/openingTerms.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. The two closed vocabularies
// ---------------------------------------------------------------------------
check(
  "the six employment types keep the stored order",
  same(
    EMPLOYMENT_TYPE_VALUES,
    ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "REMOTE", "HYBRID"]
  ),
  EMPLOYMENT_TYPE_VALUES.join(", ")
);
check(
  "the original four are untouched, so no stored row reads differently",
  same(EMPLOYMENT_TYPE_VALUES.slice(0, 4), ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP"])
);
check(
  "Remote and Hybrid join the list rather than replacing a value",
  same(EMPLOYMENT_TYPE_VALUES.slice(4), ["REMOTE", "HYBRID"])
);
check(
  "every employment code has exactly one entry",
  new Set(EMPLOYMENT_TYPE_VALUES).size === EMPLOYMENT_TYPES.length &&
    EMPLOYMENT_TYPES.length === 6,
  String(EMPLOYMENT_TYPES.length)
);
check(
  "the employment labels are the words the screens print",
  same(
    EMPLOYMENT_TYPES.map((type) => EMPLOYMENT_LABELS[type.value]),
    ["Full time", "Part time", "Contract", "Internship", "Remote", "Hybrid"]
  ),
  EMPLOYMENT_TYPES.map((type) => EMPLOYMENT_LABELS[type.value]).join(", ")
);

for (const [value, want] of [
  ["FULL_TIME", true],
  ["REMOTE", true],
  ["HYBRID", true],
  ["CONTRACT", true],
  ["REMOTE_WORK", false],
  ["FULL TIME", false],
  ["full_time", false],
  ["", false],
]) {
  check(`isEmploymentType(${JSON.stringify(value)}) is ${want}`, isEmploymentType(value) === want);
}

check(
  "the four levels are the spec's words, in order",
  same(EXPERIENCE_LEVEL_VALUES, ["JUNIOR", "MID", "SENIOR", "LEAD"]),
  EXPERIENCE_LEVEL_VALUES.join(", ")
);
check(
  "the level labels are the words the badges print",
  same(
    EXPERIENCE_LEVELS.map((level) => EXPERIENCE_LABELS[level.value]),
    ["Junior", "Mid", "Senior", "Lead"]
  ),
  EXPERIENCE_LEVELS.map((level) => EXPERIENCE_LABELS[level.value]).join(", ")
);

for (const [value, want] of [
  ["JUNIOR", true],
  ["MID", true],
  ["SENIOR", true],
  ["LEAD", true],
  ["PRINCIPAL", false],
  ["mid", false],
  ["", false],
]) {
  check(`isExperienceLevel(${JSON.stringify(value)}) is ${want}`, isExperienceLevel(value) === want);
}

check("a known level prints its label", experienceLabel("SENIOR") === "Senior", experienceLabel("SENIOR"));
check(
  "an unknown stored level is humanized, not dropped",
  experienceLabel("PRINCIPAL") === "Principal",
  experienceLabel("PRINCIPAL")
);
// The fallback is the board's own `humanize`, which capitalizes the first word
// only; an unknown code is a defensive path, since the CHECK holds four values.
check(
  "a compound unknown level keeps both words",
  experienceLabel("CHIEF_OFFICER") === "Chief officer",
  experienceLabel("CHIEF_OFFICER")
);

// ---------------------------------------------------------------------------
// 2. readExperienceLevel — what a submitted level means
// ---------------------------------------------------------------------------
for (const [label, value, want] of [
  ["an absent field clears nothing", undefined, null],
  ["a literal null clears", null, null],
  ["an empty string clears", "", null],
  ["whitespace clears", "   ", null],
  ["a stored code passes", "MID", "MID"],
  ["a spoken lowercase word is accepted", "senior", "SENIOR"],
  ["a padded word is trimmed", "  lead  ", "LEAD"],
  ["a mixed-case word is accepted", "Junior", "JUNIOR"],
]) {
  const got = readExperienceLevel(value);
  check(
    `readExperienceLevel: ${label}`,
    got.ok && got.level === want,
    got.ok ? String(got.level) : got.error
  );
}

for (const [label, value] of [
  ["an unknown word", "PRINCIPAL"],
  ["a number", 42],
  ["a boolean", true],
]) {
  const got = readExperienceLevel(value);
  check(`readExperienceLevel refuses ${label}`, !got.ok, got.ok ? String(got.level) : "");
  check(
    `the refusal names all four levels for ${label}`,
    !got.ok && /JUNIOR, MID, SENIOR, LEAD/.test(got.error),
    got.ok ? "" : got.error
  );
}

// ---------------------------------------------------------------------------
// 3. The migration's name and the schema-missing predicate
// ---------------------------------------------------------------------------
check(
  "the migration is named by its real path",
  OPENING_TERMS_MIGRATION === "db/migrations/033_opening_terms.sql",
  OPENING_TERMS_MIGRATION
);
check(
  "the read note names the migration and states nothing about this database",
  OPENING_TERMS_SCHEMA_NOTE.includes(OPENING_TERMS_MIGRATION) &&
    !/authored but not applied|is applied on this database/.test(OPENING_TERMS_SCHEMA_NOTE),
  OPENING_TERMS_SCHEMA_NOTE
);
check(
  "the level refusal names the migration",
  EXPERIENCE_WRITE_REFUSAL.includes(OPENING_TERMS_MIGRATION),
  EXPERIENCE_WRITE_REFUSAL
);
check(
  "the Remote/Hybrid refusal names the migration",
  EMPLOYMENT_WRITE_REFUSAL.includes(OPENING_TERMS_MIGRATION),
  EMPLOYMENT_WRITE_REFUSAL
);
check(
  "no refusal promises a retry that cannot work",
  ![OPENING_TERMS_SCHEMA_NOTE, EXPERIENCE_WRITE_REFUSAL, EMPLOYMENT_WRITE_REFUSAL].some((sentence) =>
    /try again|retry/i.test(sentence)
  )
);

for (const [label, error, want] of [
  ["a missing column (42703)", { code: "42703", message: "" }, true],
  ["a missing table (42P01)", { code: "42P01", message: "" }, true],
  ["a stale REST cache (PGRST204)", { code: "PGRST204", message: "" }, true],
  ["an unknown REST relation (PGRST205)", { code: "PGRST205", message: "" }, true],
  [
    "the column-does-not-exist wording",
    { message: 'column "experience_level" does not exist' },
    true,
  ],
  ["the schema-cache wording", { message: "Could not find the column in the schema cache" }, true],
  [
    "a refused value (23514) is not a missing schema",
    { code: "23514", message: "new row violates check constraint job_openings_employment_type_check" },
    false,
  ],
  ["a vanished company (23503) is not a missing schema", { code: "23503", message: "" }, false],
  ["a duplicate (23505) is not a missing schema", { code: "23505", message: "" }, false],
  ["no error at all", null, false],
  ["undefined", undefined, false],
]) {
  check(`isMissingSchemaError: ${label}`, isMissingSchemaError(error) === want);
}

// ---------------------------------------------------------------------------
// 4. The migration as authored (not executed here)
// ---------------------------------------------------------------------------
const migration = read("db/migrations/033_opening_terms.sql");
for (const [label, needle] of [
  ["adds the column idempotently", "add column if not exists experience_level text;"],
  ["names the level check", "job_openings_experience_level_check"],
  ["lets a row carry no level", "experience_level is null"],
  ["accepts the four levels", "array['JUNIOR', 'MID', 'SENIOR', 'LEAD']"],
  ["drops the old employment check first", "drop constraint if exists job_openings_employment_type_check"],
  ["readds the check with six values", "array['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'REMOTE', 'HYBRID']"],
  ["reloads the REST schema", "notify pgrst, 'reload schema';"],
  ["documents the column", "comment on column public.job_openings.experience_level is"],
  ["records that it was applied", "APPLIED to the local database on 2026-10-28"],
  ["says which way an unrun database is told", "`src/modules/jobs/domain/openingTerms.ts` still name this file"],
]) {
  check(`033 ${label}`, migration.includes(needle), needle);
}
check(
  "033 never defaults a level, so no existing opening is called Mid",
  // A real column default reads `default 'MID'`; the column comment's prose
  // ("a default of MID would invent an answer") is not a default.
  !/\bdefault\s+'?(?:JUNIOR|MID|SENIOR|LEAD)'?\b/i.test(migration)
);
check(
  "033 never backfills a level onto existing openings",
  !/update\s+public\.job_openings/i.test(migration)
);
check(
  "033 does not add a second column for Remote/Hybrid",
  !/add column[^;]*remote/i.test(migration) && !/add column[^;]*hybrid/i.test(migration)
);
check(
  "033 keeps the column nullable",
  !/experience_level text[^;]*not null/i.test(migration)
);

// ---------------------------------------------------------------------------
// 5. Wiring markers — one vocabulary, every door
// ---------------------------------------------------------------------------
function sourceHas(label, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(
    label,
    missing.length === 0,
    missing.length ? `missing ${missing.map((n) => JSON.stringify(n)).join(", ")}` : ""
  );
}

sourceHas("the jobs drawer offers the shared employment list", "src/app/(admin)/jobs/JobFormDrawer.tsx", [
  "EMPLOYMENT_TYPES,",
  "EXPERIENCE_LEVELS,",
  "OPENING_TERMS_MIGRATION,",
  "{options.termsAvailable && (",
]);
sourceHas("the drawer sends a level only when the column exists", "src/app/(admin)/jobs/JobFormDrawer.tsx", [
  "experience_level: options.termsAvailable ? draft.experience_level || null : undefined,",
]);
sourceHas("the drawer says which migration is missing", "src/app/(admin)/jobs/JobFormDrawer.tsx", [
  "Seniority levels and Remote/Hybrid job types arrive with",
  "{OPENING_TERMS_MIGRATION}",
]);
sourceHas("the jobs page reads levels in their own probe", "src/app/(admin)/jobs/page.tsx", [
  "getOpeningsTerms",
  "termsAvailable: terms.available",
  "experience_level: terms.experienceById.get(row.id) ?? null,",
]);
sourceHas("the grid prints the level and the read note", "src/app/(admin)/jobs/JobsBrowser.tsx", [
  "termsNote",
  "{experienceLabel(job.experience_level)}",
  "EMPLOYMENT_LABELS[job.employment_type]",
]);
sourceHas("the jobs action validates the level through the shared reader", "src/app/(admin)/jobs/job-actions.ts", [
  "readExperienceLevel",
  "EXPERIENCE_WRITE_REFUSAL",
  "EMPLOYMENT_WRITE_REFUSAL",
  '"experience_level",',
]);
sourceHas("the edit pre-reads a level only when the draft names it", "src/app/(admin)/jobs/job-actions.ts", [
  '.select("id, experience_level")',
  "levelWasRead",
]);

const publicActions = read("src/app/careers/actions.ts");
const publicColumns = publicActions.match(/const JOB_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "";
check(
  "the public board's shared select names no level column, so it still serves a database that has not run 033",
  publicColumns.length > 0 && !publicColumns.includes("experience_level"),
  publicColumns || "JOB_COLUMNS not found"
);
check(
  "the public board still selects what its cards print",
  publicColumns.includes("employment_type") && publicColumns.includes("requirements"),
  publicColumns
);
sourceHas("the public board probes the level through the read the layer owns", "src/app/careers/actions.ts", [
  "readOpeningExperienceLevels(",
  "read.missingSchema",
  "toJob(row, levels.get(id) ?? null)",
]);
sourceHas("that read names the level column and the ids it was given", "src/infrastructure/repositories/jobOpening.ts", [
  'select("id, experience_level")',
  '.in("id", [...ids])',
]);
sourceHas("the public cards label the level", "src/app/careers/CareersBoard.tsx", [
  "job.experience_level ? experienceLabel(job.experience_level, lang) : \"\",",
]);
sourceHas("the public role page prints the level", "src/app/careers/[id]/page.tsx", [
  "{job.experience_level && (",
  "enumKeyFor(job.experience_level)",
]);
sourceHas("the public chat card names the level", "src/modules/careers/chatbot/role-card.ts", [
  "experienceLabel(job.experience_level)",
]);

const assistantReads = read("src/modules/assistant/infrastructure/reads.ts");
const assistantSelect = assistantReads.match(/const JOB_SELECT =\s*"([^"]+)"/)?.[1] ?? "";
check(
  "the assistant's shared select names no level column, so its reads survive a database that has not run 033",
  assistantSelect.length > 0 && !assistantSelect.includes("experience_level"),
  assistantSelect || "JOB_SELECT not found"
);
sourceHas("the assistant merges levels from the id-scoped probe", "src/modules/assistant/infrastructure/reads.ts", [
  "getOpeningTermsByIds(",
  "termsNote: terms.note,",
]);
sourceHas("the id-scoped probe goes through the read the layer owns", "src/modules/jobs/application/openingTermsRead.ts", [
  "readOpeningExperienceLevels(restClient, ids)",
  "readOpeningExperienceLevelWindow(restClient, { limit: GRID_ROW_LIMIT })",
]);
sourceHas("the chat's list reports the level and the schema note", "src/modules/assistant/domain/registry/reads.ts", [
  "experience_level: job.experience_level,",
  "...(termsNote ? { schema_note: termsNote } : {}),",
]);
sourceHas("the chat's one-opening read carries the note too", "src/modules/assistant/domain/registry/reads.ts", [
  "...(found.termsNote ? { schema_note: found.termsNote } : {}),",
]);
sourceHas("the chat's job draft passes the level as a tri-state", "src/modules/assistant/domain/registry/shared.ts", [
  "isExperienceLevel(",
  "experienceLevel !== undefined ? { experience_level: experienceLevel } : {})",
]);
sourceHas("the chat's write tools name both new vocabulary doors", "src/modules/assistant/domain/registry/writes.ts", [
  "EMPLOYMENT_TYPE_VALUES.join",
  "EXPERIENCE_LEVEL_VALUES.join",
  "experience_level:",
  "033_opening_terms.sql",
]);

const i18n = read("src/lib/i18n.ts");
for (const key of ["enum.remote", "enum.hybrid", "enum.junior", "enum.mid", "enum.senior", "enum.lead"]) {
  const count = i18n.split(`"${key}"`).length - 1;
  check(`i18n carries ${key} in all four locales`, count === 4, `found ${count}`);
}

sourceHas("the Guide names 033 on the jobs page", "src/modules/shell/domain/pageGuide.ts", [
  "033_opening_terms.sql",
  "never a middle tier",
]);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
