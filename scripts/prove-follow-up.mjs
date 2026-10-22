/* scripts/prove-follow-up.mjs
 * Run: node --experimental-strip-types scripts/prove-follow-up.mjs
 *
 * #266 lets a suite send a candidate on to a second test: when a fully marked
 * paper scores inside a percent band written on the source suite, the target
 * suite is issued automatically. `db/migrations/035_assessment_follow_ups.sql`
 * is authored and NOT applied, so what can be pinned without a database is:
 *
 *   1. the arithmetic — one module decides what a score is as a percentage,
 *      what a stored rule means, and whether a percentage sits in a band;
 *   2. what an author may save — a whole band, a real target, no self-link, and
 *      the loop guard that follows targets back to the suite being edited;
 *   3. the authored DDL — four columns, six checks, two foreign keys and one
 *      partial unique index, with no backfill and no transaction wrapper;
 *   4. the availability probes — two reads, one per table, so a half-applied
 *      database is named as half-applied rather than "not applied";
 *   5. the wiring markers — the router's guards, the three doors into GRADED,
 *      the suite editor, the assistant and the Guide all agree.
 *
 * (3) and (5) are text assertions, deliberately: the SQL is reviewed, never run
 * here, and the screens need a browser. They catch the files being edited
 * apart, not a runtime that was misconfigured. Whether 035 is applied to any
 * given database is a fact about that database, not about this tree, and is
 * checked separately against the local stack.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FOLLOW_UP_MIGRATION,
  FOLLOW_UP_SCHEMA_NOTE,
  FOLLOW_UP_WRITE_REFUSAL,
  describeFollowUpRule,
  followUpBandText,
  followUpLoop,
  followUpPercent,
  inFollowUpBand,
  isMissingFollowUpColumnError,
  readFollowUpRule,
  readFollowUpRuleInput,
} from "../src/modules/assessment/domain/followUp.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const gradeAttempt = read("src/modules/assessment/application/gradeAttempt.ts");
const gradeAction = read("src/app/(admin)/candidates/assessment-actions.ts");
const router = read("src/modules/assessment/application/routeFollowUp.ts");
const availability = read(
  "src/modules/assessment/application/followUpAvailability.ts"
);
const suiteActions = read("src/app/(admin)/assessments/assessment-actions.ts");
const suiteReads = read("src/app/(admin)/assessments/actions.ts");
const suitePage = read("src/app/(admin)/assessments/page.tsx");
const suiteGrid = read("src/app/(admin)/assessments/AssessmentGrid.tsx");
const assistantSources = read("src/modules/assistant/application/sources.ts");
const assistantShared = read("src/modules/assistant/domain/registry/shared.ts");
const assistantReads = read("src/modules/assistant/domain/registry/reads.ts");
const assistantAuthoring = read("src/modules/assistant/domain/registry/authoring.ts");
const guide = read("src/modules/shell/domain/pageGuide.ts");

function sourceHas(source, needle, label) {
  check(label, source.includes(needle), needle);
}

// ---------------------------------------------------------------------------
// 1. What a stored rule means
// ---------------------------------------------------------------------------
const storedRule = readFollowUpRule({
  follow_up_template_id: "tpl-2",
  follow_up_min_percent: 70,
  follow_up_max_percent: 90,
});
check(
  "a complete rule is read",
  same(storedRule, { templateId: "tpl-2", minPercent: 70, maxPercent: 90 }),
  JSON.stringify(storedRule)
);
check("a missing row carries no rule", readFollowUpRule(null) === null);
check("an empty row carries no rule", readFollowUpRule({}) === null);
check(
  "a target with no band carries no rule",
  readFollowUpRule({ follow_up_template_id: "tpl-2" }) === null
);
check(
  "a band with no target carries no rule",
  readFollowUpRule({ follow_up_min_percent: 70, follow_up_max_percent: 90 }) === null
);
check(
  "a half band carries no rule",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: 70,
    follow_up_max_percent: null,
  }) === null
);
check(
  "an inverted band carries no rule",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: 90,
    follow_up_max_percent: 70,
  }) === null
);
check(
  "a bottom below zero carries no rule",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: -1,
    follow_up_max_percent: 90,
  }) === null
);
check(
  "a top above one hundred carries no rule",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: 70,
    follow_up_max_percent: 101,
  }) === null
);
check(
  "zero and one hundred are real stored percentages",
  same(
    readFollowUpRule({
      follow_up_template_id: "tpl-2",
      follow_up_min_percent: 0,
      follow_up_max_percent: 100,
    }),
    { templateId: "tpl-2", minPercent: 0, maxPercent: 100 }
  )
);
check(
  "a stored fraction is rounded to the nearest whole",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: 70.5,
    follow_up_max_percent: 90,
  })?.minPercent === 71
);
check(
  "stored numeric strings are read",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: "70",
    follow_up_max_percent: "90",
  })?.minPercent === 70
);
check(
  "a stored value that is not a number carries no rule",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: "seventy",
    follow_up_max_percent: 90,
  }) === null
);
check(
  "an empty stored percentage carries no rule",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: "",
    follow_up_max_percent: 90,
  }) === null
);
check(
  "an infinite stored percentage carries no rule",
  readFollowUpRule({
    follow_up_template_id: "tpl-2",
    follow_up_min_percent: Infinity,
    follow_up_max_percent: 90,
  }) === null
);

// ---------------------------------------------------------------------------
// 2. What a paper's marks are as a percentage
// ---------------------------------------------------------------------------
for (const [label, total, max, want] of [
  ["37 of 50 is 74%", 37, 50, 74],
  ["a zero score is 0%", 0, 40, 0],
  ["a perfect paper is 100%", 40, 40, 100],
  ["a total above the maximum is clamped to 100", 45, 40, 100],
  ["two of three rounds to 67%", 2, 3, 67],
  ["one of eight rounds halves upward", 1, 8, 13],
  ["a negative total is clamped to 0", -5, 40, 0],
  ["zero of zero has no percentage", 0, 0, null],
  ["a positive total over zero marks has no percentage", 5, 0, null],
  ["a negative maximum has no percentage", 5, -1, null],
  ["a missing total has no percentage", null, 50, null],
  ["a missing maximum has no percentage", 5, null, null],
  ["an undefined total has no percentage", undefined, 50, null],
  ["a NaN total has no percentage", Number.NaN, 50, null],
  ["a NaN maximum has no percentage", 5, Number.NaN, null],
  ["an infinite total has no percentage", Infinity, 50, null],
  ["an infinite maximum has no percentage", 5, Infinity, null],
]) {
  const got = followUpPercent(total, max);
  check(`followUpPercent: ${label}`, got === want, String(got));
}

// ---------------------------------------------------------------------------
// 3. What "inside the band" means
// ---------------------------------------------------------------------------
const band = { templateId: "tpl-2", minPercent: 70, maxPercent: 90 };
check("the bottom of the band is inside it", inFollowUpBand(70, band) === true);
check("the top of the band is inside it", inFollowUpBand(90, band) === true);
check("a mark below the band is outside it", inFollowUpBand(69, band) === false);
check("a mark above the band is outside it", inFollowUpBand(91, band) === false);
check(
  "a one-mark band means exactly that mark",
  inFollowUpBand(85, { templateId: "tpl-2", minPercent: 85, maxPercent: 85 }) === true
);
check(
  "a one-mark band excludes the marks either side",
  inFollowUpBand(84, { templateId: "tpl-2", minPercent: 85, maxPercent: 85 }) === false &&
    inFollowUpBand(86, { templateId: "tpl-2", minPercent: 85, maxPercent: 85 }) === false
);
check(
  "the widest band takes both ends",
  inFollowUpBand(0, { templateId: "tpl-2", minPercent: 0, maxPercent: 100 }) === true &&
    inFollowUpBand(100, { templateId: "tpl-2", minPercent: 0, maxPercent: 100 }) === true
);

// ---------------------------------------------------------------------------
// 4. How a band reads
// ---------------------------------------------------------------------------
check(
  "a band is printed with an en dash and a percent sign",
  followUpBandText({ minPercent: 70, maxPercent: 90 }) === "70\u201390%",
  followUpBandText({ minPercent: 70, maxPercent: 90 })
);
check(
  "a band does not print a hyphen-minus",
  !followUpBandText({ minPercent: 70, maxPercent: 90 }).includes("-")
);
check(
  "a rule's sentence names the band and the target",
  describeFollowUpRule(band, "Technical model") ===
    "70\u201390% moves on to Technical model",
  describeFollowUpRule(band, "Technical model")
);
check(
  "the widest band reads as written",
  followUpBandText({ minPercent: 0, maxPercent: 100 }) === "0\u2013100%"
);

// ---------------------------------------------------------------------------
// 5. What an author may save
// ---------------------------------------------------------------------------
const readInput = (templateId, minPercent, maxPercent, selfId = "tpl-1") =>
  readFollowUpRuleInput({ templateId, minPercent, maxPercent }, selfId);

const cleared = readInput("", "", "");
check("an empty target and empty band clears the rule", cleared.ok && cleared.rule === null);

const bandOnly = readInput("", "70", "90");
check("a band with no target is refused", !bandOnly.ok);
check(
  "the band-without-target refusal says it can be cleared",
  !bandOnly.ok && bandOnly.error.includes("clear the band to switch the second test off"),
  bandOnly.ok ? "" : bandOnly.error
);

const targetOnly = readInput("tpl-2", "", "");
check("a target with no band is refused", !targetOnly.ok);
check(
  "the target-without-band refusal asks for two percentages",
  !targetOnly.ok && targetOnly.error.includes("two percentages from 0 to 100"),
  targetOnly.ok ? "" : targetOnly.error
);

const halfBand = readInput("tpl-2", "70", "");
check("half a band is refused", !halfBand.ok);

const valid = readInput("tpl-2", "70", "90");
check(
  "a complete rule is accepted",
  valid.ok && same(valid.rule, { templateId: "tpl-2", minPercent: 70, maxPercent: 90 }),
  valid.ok ? JSON.stringify(valid.rule) : valid.error
);
check(
  "the widest band is accepted",
  readInput("tpl-2", "0", "100").ok === true
);
check(
  "a one-mark band is accepted",
  readInput("tpl-2", "85", "85").ok === true
);
const trimmed = readInput("  tpl-2  ", " 70 ", "90 ");
check(
  "the target and both ends are trimmed",
  trimmed.ok && trimmed.rule?.templateId === "tpl-2" && trimmed.rule?.minPercent === 70,
  trimmed.ok ? JSON.stringify(trimmed.rule) : trimmed.error
);
const noSelf = readFollowUpRuleInput({ templateId: "tpl-2", minPercent: "70", maxPercent: "90" }, null);
check("a caller with no suite yet skips the self check", noSelf.ok === true);

for (const [label, min, max] of [
  ["a fractional bottom", "70.5", "90"],
  ["a fractional top", "70", "90.5"],
  ["a negative bottom", "-1", "90"],
  ["a bottom above one hundred", "101", "101"],
  ["a bottom written in words", "seventy", "90"],
  ["an empty top beside a filled bottom", "70", ""],
]) {
  const got = readInput("tpl-2", min, max);
  check(`readFollowUpRuleInput refuses ${label}`, !got.ok, got.ok ? "accepted" : "");
  check(
    `the refusal for ${label} promises whole numbers`,
    !got.ok && got.error === "Both ends of the band must be whole numbers from 0 to 100.",
    got.ok ? "" : got.error
  );
}

const inverted = readInput("tpl-2", "90", "70");
check(
  "an inverted band is refused with its own sentence",
  !inverted.ok && inverted.error === "The bottom of the band cannot be above its top.",
  inverted.ok ? "" : inverted.error
);

const self = readInput("tpl-1", "70", "90");
check(
  "a suite cannot be its own second test",
  !self.ok &&
    self.error ===
      "A suite cannot send a candidate back to itself. Choose a different second test.",
  self.ok ? "" : self.error
);

const selfWithSpaces = readInput(" tpl-1 ", "70", "90");
check("the self check compares trimmed ids", !selfWithSpaces.ok);

// ---------------------------------------------------------------------------
// 6. The loop guard
// ---------------------------------------------------------------------------
const directLoop = followUpLoop("tpl-1", "tpl-2", new Map([["tpl-2", "tpl-1"]]));
check(
  "a direct loop is reported as a chain",
  same(directLoop, ["tpl-1", "tpl-2", "tpl-1"]),
  JSON.stringify(directLoop)
);
const longLoop = followUpLoop(
  "tpl-1",
  "tpl-2",
  new Map([
    ["tpl-2", "tpl-3"],
    ["tpl-3", "tpl-1"],
  ])
);
check(
  "a longer loop is reported in order",
  same(longLoop, ["tpl-1", "tpl-2", "tpl-3", "tpl-1"]),
  JSON.stringify(longLoop)
);
check(
  "a chain that ends is not a loop",
  followUpLoop(
    "tpl-1",
    "tpl-2",
    new Map([
      ["tpl-2", "tpl-3"],
      ["tpl-3", null],
    ])
  ) === null
);
check(
  "a suite that is its own target is a loop",
  same(followUpLoop("tpl-1", "tpl-1", new Map()), ["tpl-1", "tpl-1"])
);
check(
  "a pre-existing loop elsewhere is left alone",
  followUpLoop(
    "tpl-x",
    "tpl-2",
    new Map([
      ["tpl-2", "tpl-3"],
      ["tpl-3", "tpl-2"],
    ])
  ) === null
);
check(
  "a target with no rule has no chain",
  followUpLoop("tpl-1", "tpl-2", new Map()) === null
);

// ---------------------------------------------------------------------------
// 7. The schema-missing predicate
// ---------------------------------------------------------------------------
for (const [label, error, want] of [
  ["missing column (42703)", { code: "42703", message: "" }, true],
  ["stale REST cache (PGRST204)", { code: "PGRST204", message: "" }, true],
  [
    "Postgres wording without a code",
    { message: "column assessment_templates.follow_up_template_id does not exist" },
    true,
  ],
  [
    "PostgREST schema-cache wording",
    { message: "Could not find the 'follow_up_min_percent' column of 'assessment_templates' in the schema cache" },
    true,
  ],
  ["a check violation (23514)", { code: "23514", message: "" }, false],
  ["a vanished suite (23503)", { code: "23503", message: "" }, false],
  ["a duplicate (23505)", { code: "23505", message: "" }, false],
  ["a permission refusal (42501)", { code: "42501", message: "" }, false],
  ["a different missing column", { message: "column jobs.website_url does not exist" }, false],
  ["no error at all", null, false],
  ["undefined", undefined, false],
]) {
  check(`isMissingFollowUpColumnError: ${label}`, isMissingFollowUpColumnError(error) === want);
}

// ---------------------------------------------------------------------------
// 8. The authored migration
// ---------------------------------------------------------------------------
check(
  "the migration is named by its real path",
  FOLLOW_UP_MIGRATION === "db/migrations/035_assessment_follow_ups.sql",
  FOLLOW_UP_MIGRATION
);
check(
  "the read note names the migration and says authored but not applied",
  FOLLOW_UP_SCHEMA_NOTE.includes(FOLLOW_UP_MIGRATION) &&
    /authored but not applied/.test(FOLLOW_UP_SCHEMA_NOTE),
  FOLLOW_UP_SCHEMA_NOTE
);
check(
  "the write refusal names the migration and keeps the suite saved",
  FOLLOW_UP_WRITE_REFUSAL.includes("The suite itself was saved") &&
    FOLLOW_UP_WRITE_REFUSAL.includes(FOLLOW_UP_MIGRATION) &&
    /authored but not applied/.test(FOLLOW_UP_WRITE_REFUSAL),
  FOLLOW_UP_WRITE_REFUSAL
);

const migration = read(FOLLOW_UP_MIGRATION);
for (const [label, needle] of [
  ["says it is not applied", "This migration is NOT applied to any database yet."],
  ["adds the target column", "add column if not exists follow_up_template_id uuid"],
  ["adds the bottom column", "add column if not exists follow_up_min_percent smallint"],
  ["adds the top column", "add column if not exists follow_up_max_percent smallint"],
  [
    "adds the attempt link",
    "add column if not exists follow_up_of_attempt_id uuid",
  ],
  [
    "constrains the target to a suite",
    "assessment_templates_follow_up_template_id_fkey",
  ],
  ["requires the whole rule", "assessment_templates_follow_up_complete_check"],
  ["keeps the bottom in range", "assessment_templates_follow_up_min_check"],
  ["keeps the top in range", "assessment_templates_follow_up_max_check"],
  ["keeps the band upright", "assessment_templates_follow_up_band_check"],
  ["refuses a self-link", "assessment_templates_follow_up_not_self_check"],
  [
    "keeps an issued paper when its source goes",
    "candidate_attempts_follow_up_of_attempt_id_fkey",
  ],
  [
    "makes the follow-up link unique per source paper",
    "create unique index if not exists candidate_attempts_follow_up_once",
  ],
  [
    "leaves manually assigned attempts out of the index",
    "where follow_up_of_attempt_id is not null;",
  ],
  [
    "documents the three rule columns",
    "comment on column public.assessment_templates.follow_up_template_id is",
  ],
  [
    "documents the attempt link",
    "comment on column public.candidate_attempts.follow_up_of_attempt_id is",
  ],
  ["reloads the REST schema", "notify pgrst, 'reload schema';"],
]) {
  check(`035 ${label}`, migration.includes(needle), needle);
}
check(
  "035 adds exactly four columns",
  (migration.match(/add column if not exists/gi) ?? []).length === 4,
  String((migration.match(/add column if not exists/gi) ?? []).length)
);
check(
  "035 keeps a suite when its second target is removed",
  /assessment_templates_follow_up_template_id_fkey[\s\S]{0,200}on delete set null/.test(
    migration
  )
);
check(
  "035 keeps an issued paper when its source attempt is removed",
  /candidate_attempts_follow_up_of_attempt_id_fkey[\s\S]{0,200}on delete set null/.test(
    migration
  )
);
check(
  "035 comments on exactly four columns",
  (migration.match(/comment on column/gi) ?? []).length === 4
);
check("035 creates no table", !/create table/i.test(migration));
check("035 backfills no row", !/\bupdate\s+public\./i.test(migration));
check("035 sets no default", !/\bdefault\b/i.test(migration));
check("035 opens no transaction of its own", !/^begin;/m.test(migration));
check("035 commits nothing of its own", !/^commit;/m.test(migration));
check(
  "035 stays out of the schema of record",
  !/follow_up/i.test(read("db/schema.sql"))
);
check(
  "035 declares the three columns together or not at all",
  /follow_up_min_percent is null[\s\S]{0,400}follow_up_template_id is not null/.test(
    migration
  )
);

// ---------------------------------------------------------------------------
// 9. The availability probe
// ---------------------------------------------------------------------------
sourceHas(
  availability,
  "export interface FollowUpAvailability",
  "the probe returns a named shape"
);
sourceHas(availability, "rules: boolean;", "the probe reports the rule columns");
sourceHas(availability, "routing: boolean;", "the probe reports the attempt link");
sourceHas(availability, "note: string | null;", "the probe explains what is missing");
sourceHas(availability, "await Promise.all([", "the two probes run together");
sourceHas(
  availability,
  ".select(\"id, follow_up_template_id, follow_up_min_percent, follow_up_max_percent\")",
  "the rule probe names all three columns"
);
sourceHas(
  availability,
  ".select(\"id, follow_up_of_attempt_id\")",
  "the routing probe names the attempt link on its own"
);
sourceHas(
  availability,
  ".from(\"candidate_attempts\")",
  "the routing probe reads the attempts table"
);
sourceHas(availability, "const rules = !rulesRead.error;", "the rule answer is the read's refusal");
sourceHas(
  availability,
  "const routing = !routingRead.error;",
  "the routing answer is the read's refusal"
);
sourceHas(
  availability,
  "candidate_attempts.follow_up_of_attempt_id is missing",
  "the half-applied note names the exact missing column"
);
sourceHas(
  availability,
  "was only partly applied",
  "the half-applied note says the migration was partly applied"
);
sourceHas(
  availability,
  "isMissingFollowUpColumnError(rulesRead.error)",
  "the rule probe distinguishes a missing column from a read failure"
);
sourceHas(
  availability,
  "FOLLOW_UP_SCHEMA_NOTE",
  "the rule probe quotes the shared note"
);

// ---------------------------------------------------------------------------
// 10. The router
// ---------------------------------------------------------------------------
sourceHas(
  router,
  "export async function routeFollowUp(sourceAttemptId: string): Promise<FollowUpOutcome>",
  "the router is exported by attempt id"
);
sourceHas(router, "Follow-up routing failed for attempt", "the router logs rather than throws");
sourceHas(
  router,
  "applications(full_name, archived_at, job_openings(title))",
  "the router reads the candidate and their opening"
);
sourceHas(
  router,
  "assessment_templates(id, name, tenant_id, is_active, follow_up_template_id, follow_up_min_percent, follow_up_max_percent)",
  "the source read names the rule columns"
);
sourceHas(
  router,
  "if (attempt.status !== \"GRADED\") return { routed: false };",
  "only a fully marked paper routes"
);
sourceHas(router, "const rule = readFollowUpRule(source);", "the router reads the rule through the domain");
sourceHas(router, "if (source.is_active === false) {", "a paused source does not route");
sourceHas(
  router,
  "if (percent === null) {",
  "a paper with no marks does not route"
);
sourceHas(
  router,
  "if (!inFollowUpBand(percent, rule)) {",
  "the router uses the shared band test"
);
sourceHas(router, "if (application.archived_at) {", "an archived candidate does not route");
sourceHas(
  router,
  ".select(\"id, name, tenant_id, is_active, time_limit_minutes, assessment_questions(id)\")",
  "the target is read with its company and questions"
);
sourceHas(
  router,
  "if (target.tenant_id !== source.tenant_id) {",
  "a cross-company target is refused"
);
sourceHas(router, "if (target.is_active === false) {", "a paused target is refused");
sourceHas(
  router,
  "if ((target.assessment_questions ?? []).length === 0) {",
  "a target with no questions is refused"
);
sourceHas(
  router,
  ".eq(\"follow_up_of_attempt_id\", sourceAttemptId)",
  "an existing link is looked up before insertion"
);
sourceHas(
  router,
  ".eq(\"application_id\", attempt.application_id)",
  "the same application is checked for an existing target paper"
);
sourceHas(router, ".eq(\"template_id\", target.id)", "the target suite is the one checked");
sourceHas(
  router,
  "const accessToken = randomBytes(32).toString(\"base64url\");",
  "the issued paper gets its own token"
);
sourceHas(router, "status: \"NOT_STARTED\",", "the issued paper has not been started");
sourceHas(
  router,
  "time_limit_minutes: target.time_limit_minutes ?? 60,",
  "the issued paper carries the target's clock"
);
sourceHas(
  router,
  "follow_up_of_attempt_id: sourceAttemptId,",
  "the insert records where the link came from"
);
sourceHas(
  router,
  "if (insertError.code === \"23505\") {",
  "a racing grading pass is answered by the unique index"
);
sourceHas(
  router,
  "Another grading pass already issued this follow-up.",
  "the duplicate refusal is a sentence, not a crash"
);
sourceHas(
  router,
  "This paper has already sent its follow-up.",
  "the pre-read names the already-routed case"
);
sourceHas(
  router,
  "The candidate has already been sent",
  "an existing target paper is named before inserting"
);
sourceHas(
  router,
  "The second test belongs to a different company from the first.",
  "the cross-company skip reads as a sentence"
);
sourceHas(
  router,
  "is paused, so no link was issued",
  "the paused-target skip reads as a sentence"
);
sourceHas(
  router,
  "has no questions, so no link was issued",
  "the empty-target skip reads as a sentence"
);
sourceHas(
  router,
  "engineActivityActor(\"Assessment router\")",
  "the trail names the router as the actor"
);
sourceHas(router, "action: \"follow_up_assigned\"", "the trail action is its own");
sourceHas(router, "band_min: rule.minPercent,", "the trail records the band's bottom");
sourceHas(router, "band_max: rule.maxPercent,", "the trail records the band's top");
sourceHas(router, "source_attempt_id: sourceAttemptId,", "the trail records the source paper");
sourceHas(
  router,
  "await notifyAssessmentInvite({",
  "the candidate is invited on the same channels as a manual assignment"
);
sourceHas(
  router,
  "applicationId: attempt.application_id,",
  "the invite names the application it belongs to"
);
sourceHas(
  router,
  "await processDueWhatsAppJobs(1);",
  "the WhatsApp queue is drained beside the invite"
);
sourceHas(
  router,
  "isMissingFollowUpColumnError(error)",
  "an unapplied 035 is answered quietly"
);

// ---------------------------------------------------------------------------
// 11. The three doors into GRADED
// ---------------------------------------------------------------------------
sourceHas(
  gradeAttempt,
  "import { routeFollowUp } from \"@/modules/assessment/application/routeFollowUp\";",
  "the engine imports the router"
);
sourceHas(
  gradeAttempt,
  "await routeFollowUp(attemptId);",
  "the engine routes on the crossing it records"
);
sourceHas(
  gradeAttempt,
  "A suite's second-test rule fires on the same crossing the trail records.",
  "the engine says why the router sits beside the trail row"
);
sourceHas(
  gradeAction,
  "import { after } from \"next/server\";",
  "the hand-grade door defers its routing"
);
sourceHas(
  gradeAction,
  "const completedIt = totals.complete && attempt?.status !== \"GRADED\";",
  "the hand-grade door knows when it completed the paper"
);
sourceHas(gradeAction, "if (completedIt) {", "the hand-grade door gates on completion");
sourceHas(
  gradeAction,
  "await routeFollowUp(row.attempt_id);",
  "the hand-grade door calls the router"
);
sourceHas(
  gradeAction,
  "Follow-up routing after a hand grade failed:",
  "a router failure cannot undo a hand mark"
);

// ---------------------------------------------------------------------------
// 12. The suite save path
// ---------------------------------------------------------------------------
sourceHas(suiteActions, "async function checkFollowUpTarget(", "the save path checks the target");
sourceHas(
  suiteActions,
  ".select(\"id, tenant_id, name\")",
  "the target check reads the owning company"
);
sourceHas(
  suiteActions,
  "The second test must belong to the same company as this suite",
  "a cross-company rule is refused"
);
sourceHas(
  suiteActions,
  "followUpLoop(sourceId, rule.templateId, targetOf)",
  "the save path runs the shared loop guard"
);
sourceHas(
  suiteActions,
  "That rule would send candidates in a loop:",
  "the loop refusal prints the chain"
);
sourceHas(
  suiteActions,
  "readFollowUpRuleInput(payload.follow_up, payload.id)",
  "the save path validates the typed band"
);
sourceHas(
  suiteActions,
  "const availability = await readFollowUpAvailability(restClient);",
  "the save path asks whether the columns exist"
);
sourceHas(
  suiteActions,
  "warning = FOLLOW_UP_WRITE_REFUSAL;",
  "a rule on an unapplied database is refused in words"
);
sourceHas(
  suiteActions,
  "The suite was saved, but its second-test rule was not:",
  "a half-applied database is refused in its own words"
);
sourceHas(
  suiteActions,
  "follow_up_template_id: rule?.templateId ?? null,",
  "the rule is written as three columns"
);
sourceHas(
  suiteActions,
  "writeRule ? \", follow_up_template_id, follow_up_min_percent, follow_up_max_percent\" : \"\"",
  "the edit path only names the columns it may write"
);
sourceHas(
  suiteActions,
  "if (writeRule && rule) {",
  "the target check only runs when a rule is being written"
);
sourceHas(
  suiteActions,
  "follow_up?: FollowUpRuleInput;",
  "an omitted rule leaves the stored one alone"
);
sourceHas(
  suiteActions,
  "return { ok: true, id: data?.id, warning };",
  "a refused rule still answers the saved suite"
);
sourceHas(
  suiteActions,
  "return { ok: true, id: payload.id ?? undefined, warning };",
  "an edited suite reports its warning too"
);

// ---------------------------------------------------------------------------
// 13. The suite reads and the grid
// ---------------------------------------------------------------------------
sourceHas(
  suiteReads,
  "\"id, tenant_id, name, description, role_family, time_limit_minutes, is_active, randomize_questions, randomize_options, block_copy_paste, assessment_questions(points, question_type), candidate_attempts(id, status)\"",
  "getTemplates names no follow-up column, so it survives an unapplied 035"
);
sourceHas(suiteReads, "target_exists: boolean;", "a rule says whether its target is visible");
sourceHas(
  suiteReads,
  "export async function getFollowUpRules(): Promise<FollowUpRulesRead>",
  "the suite page has its own follow-up read"
);
sourceHas(
  suiteReads,
  "\"id, tenant_id, name, is_active, follow_up_template_id, follow_up_min_percent, follow_up_max_percent, assessment_questions(id)\"",
  "the follow-up read names the rule columns"
);
sourceHas(
  suiteReads,
  "target_exists: target !== undefined,",
  "an invisible target is not called paused"
);
sourceHas(
  suiteReads,
  "rules_available",
  "the read tells the editor whether the rule can be written"
);
sourceHas(
  suiteReads,
  "routing_available",
  "the read tells the editor whether the link can be recorded"
);

sourceHas(
  suitePage,
  "getFollowUpRules(),",
  "the page loads the rules with the templates"
);
sourceHas(suitePage, "followUps,", "the page carries the follow-up read");
sourceHas(suitePage, "followUps={followUps}", "the grid receives the follow-up read");

sourceHas(
  suiteGrid,
  "const followUpEditable = followUps.rules_available && followUps.routing_available;",
  "the editor asks for both halves before offering the rule"
);
sourceHas(
  suiteGrid,
  "readFollowUpRuleInput(",
  "the editor validates with the shared reader"
);
sourceHas(
  suiteGrid,
  "notice={warning}",
  "a refused rule keeps the saved confirmation beside it"
);
sourceHas(
  suiteGrid,
  "followUpBandText({",
  "the card prints the band through the domain"
);
sourceHas(
  suiteGrid,
  "followUp.target_exists",
  "the card separates an invisible target from a paused one"
);
sourceHas(
  suiteGrid,
  "The second suite this rule names is not one this page can see",
  "the invisible-target caveat is a sentence"
);
sourceHas(
  suiteGrid,
  "The second suite is paused, so no link is issued until it is resumed.",
  "the paused-target caveat is a sentence"
);
sourceHas(
  suiteGrid,
  "The second suite has no questions, so no link is issued until it has some.",
  "the empty-target caveat is a sentence"
);
sourceHas(suiteGrid, "Second test", "the editor names the fieldset plainly");

// ---------------------------------------------------------------------------
// 14. The assistant and the Guide
// ---------------------------------------------------------------------------
sourceHas(
  assistantSources,
  "export { getFollowUpRules };",
  "the assistant's source seam re-exports the follow-up read"
);
sourceHas(
  assistantShared,
  "export { getFollowUpRules };",
  "the registry re-exports it to the tools"
);
sourceHas(
  assistantReads,
  "getFollowUpRules()",
  "list_assessment_suites reads the rules"
);
sourceHas(
  assistantReads,
  "second_test_note:",
  "the read discloses when second-test routing cannot fire"
);
sourceHas(
  assistantReads,
  "second_test: ruleFor(template.id),",
  "each suite carries its rule"
);
sourceHas(
  assistantAuthoring,
  "follow_up_suite_id:",
  "the suite writer offers the target argument"
);
sourceHas(
  assistantAuthoring,
  "const namedRule",
  "the writer tells an omitted rule from a typed one"
);
sourceHas(
  assistantAuthoring,
  "follow_up_suite_id !== undefined",
  "any one of the three arguments starts a rule"
);
sourceHas(
  guide,
  "Second-test rules arrive with db/migrations/035_assessment_follow_ups.sql",
  "the Guide names the migration while it is unapplied"
);
sourceHas(
  guide,
  "A suite's editor carries a Second test fieldset",
  "the Guide describes the fieldset"
);
sourceHas(
  guide,
  "the moment the paper becomes fully marked",
  "the Guide says when the link is issued"
);

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
const failed = results.filter((result) => !result.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed${
    failed.length ? ` — ${failed.length} FAILED` : ""
  }`
);
if (failed.length) {
  for (const result of failed) console.log(`FAIL ${result.name}${result.detail ? `  [${result.detail}]` : ""}`);
  process.exitCode = 1;
}
