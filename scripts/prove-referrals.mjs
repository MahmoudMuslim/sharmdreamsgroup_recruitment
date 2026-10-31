/* scripts/prove-referrals.mjs
 * Run: node --env-file=docker/.env --experimental-strip-types scripts/prove-referrals.mjs
 *
 * The employee referral programme, held to the four decisions that shaped it:
 *
 *   1. a durable per-person link — `/careers/<job>?ref=<code>` — plus a staff
 *      hand-entry door for someone who applied another way;
 *   2. credit, a bonus decision record and a leaderboard;
 *   3. own rows for every staff member, all rows for recruiters;
 *   4. first claim wins, with a recruiter able to reassign.
 *
 * Two rules are pinned harder than the rest because they are the ones a later
 * edit could quietly break:
 *
 *   - the referral's state is the application's stage, read at display time; no
 *     stage column is ever copied onto a referral;
 *   - the claim is unique per (lower(email), job) in the database, so two staff
 *     members cannot both be credited for the same person on the same role.
 *
 * The counts are arithmetic over fixture rows, not a database probe. Whether a
 * particular database has applied db/migrations/040_referrals.sql is a fact
 * about that database, answered by the reader's own missing-schema branch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A missing file is a failed check with a name, not a stack trace that hides
// every other check in the file.
const read = (rel) => {
  const file = path.join(root, rel);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(root, "src", specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const referral = await import("../src/modules/referrals/domain/referral.ts");
const { LIVE_WATCH, watchForPath } = await import("../src/modules/live/domain/watch.ts");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? "" : `got ${a}, wanted ${e}`);
}
function has(name, text, needle) {
  check(name, text.includes(needle), `missing ${JSON.stringify(needle)}`);
}

/* -------------------------------------------------------------------------- */
/* 1. The code on the link                                                     */
/* -------------------------------------------------------------------------- */

equal("a ten-character code survives as typed", referral.readReferralCode("A1B2C3D4E5"), "A1B2C3D4E5");
equal("a lower-case code is folded", referral.readReferralCode("a1b2c3d4e5"), "A1B2C3D4E5");
equal("surrounding space is trimmed", referral.readReferralCode("  a1b2c3d4e5  "), "A1B2C3D4E5");
equal("a short code is refused", referral.readReferralCode("A1B2C3D4"), null);
equal("a long code is refused", referral.readReferralCode("A1B2C3D4E5F6"), null);
equal("a non-hex code is refused", referral.readReferralCode("A1B2C3D4EZ"), null);
equal("an empty string is refused", referral.readReferralCode(""), null);
equal("a missing code is refused", referral.readReferralCode(null), null);
equal("an object is not a code", referral.readReferralCode({ code: "A1B2C3D4E5" }), null);
equal(
  "the link carries the code on the role page",
  referral.referralLink("https://talent.example/", "11111111-2222-3333-4444-555555555555", "A1B2C3D4E5"),
  "https://talent.example/careers/11111111-2222-3333-4444-555555555555?ref=A1B2C3D4E5"
);
equal(
  "the apply step carries the same code",
  referral.referralApplyLink("", "11111111-2222-3333-4444-555555555555", "a1b2c3d4e5"),
  "/careers/apply/11111111-2222-3333-4444-555555555555?ref=a1b2c3d4e5"
);

/* -------------------------------------------------------------------------- */
/* 2. The hand-entry door                                                      */
/* -------------------------------------------------------------------------- */

const JOB = "11111111-2222-3333-4444-555555555555";
const good = referral.planHandEntry({
  email: "  Maya.Hassan@Example.COM ",
  fullName: "  Maya Hassan  ",
  jobId: JOB,
  note: "  Met at the Cairo hospitality fair.  ",
});
equal("a hand entry is cleaned", good, {
  ok: true,
  email: "maya.hassan@example.com",
  fullName: "Maya Hassan",
  jobId: JOB,
  note: "Met at the Cairo hospitality fair.",
});
equal(
  "a hand entry may leave the name and note out",
  referral.planHandEntry({ email: "a@b.co", jobId: JOB }),
  { ok: true, email: "a@b.co", fullName: null, jobId: JOB, note: null }
);
equal(
  "a blank email is refused",
  referral.planHandEntry({ email: "   ", jobId: JOB }).ok,
  false
);
equal(
  "a malformed email is refused",
  referral.planHandEntry({ email: "maya.example.com", jobId: JOB }).ok,
  false
);
equal(
  "a missing role is refused",
  referral.planHandEntry({ email: "a@b.co", jobId: "" }).ok,
  false
);
equal(
  "a role id that is not a uuid is refused",
  referral.planHandEntry({ email: "a@b.co", jobId: "job-1" }).ok,
  false
);
equal(
  "the note is capped at 600 characters",
  referral.planHandEntry({ email: "a@b.co", jobId: JOB, note: "x".repeat(601) }).ok,
  false
);
equal(
  "a 600-character note is accepted",
  referral.planHandEntry({ email: "a@b.co", jobId: JOB, note: "x".repeat(600) }).ok,
  true
);
equal(
  "a name longer than 160 characters is refused",
  referral.planHandEntry({ email: "a@b.co", jobId: JOB, fullName: "x".repeat(161) }).ok,
  false
);

/* -------------------------------------------------------------------------- */
/* 3. State is the application's stage, read at display time                   */
/* -------------------------------------------------------------------------- */

equal("no application reads as invited", referral.referralProgress(null), {
  key: "invited",
  label: "Not applied yet",
});
equal("NEW reads as screening", referral.referralProgress("NEW"), {
  key: "screening",
  label: "In screening",
});
equal("AI_SCREENING reads as screening", referral.referralProgress("AI_SCREENING").key, "screening");
equal("ASSESSMENT keeps its own state", referral.referralProgress("ASSESSMENT").key, "assessment");
equal("INTERVIEW keeps its own state", referral.referralProgress("INTERVIEW").key, "interview");
equal("OFFER keeps its own state", referral.referralProgress("OFFER").key, "offer");
equal("HIRED is the only hired state", referral.referralProgress("HIRED"), {
  key: "hired",
  label: "Hired",
});
equal("REJECTED reads as closed", referral.referralProgress("REJECTED"), {
  key: "closed",
  label: "Closed",
});
equal("an unknown stage is not silently called hired", referral.referralProgress("ARCHIVED"), {
  key: "screening",
  label: "In the pipeline",
});

const row = (stage, bonusState = "NONE") => ({ stage, bonusState });
const fixture = [
  row(null),
  row("NEW"),
  row("AI_SCREENING"),
  row("ASSESSMENT", "PENDING"),
  row("INTERVIEW"),
  row("OFFER"),
  row("HIRED", "PAID"),
  row("REJECTED"),
];
equal("the counts are populations, not conversions", referral.referralCounts(fixture), {
  total: 8,
  invited: 1,
  applied: 7,
  active: 5,
  hired: 1,
  closed: 1,
  bonusPending: 1,
  bonusPaid: 1,
});
const counts = referral.referralCounts(fixture);
equal(
  "every row lands in exactly one pipeline bucket",
  counts.invited + counts.active + counts.hired + counts.closed,
  counts.total
);
equal("an empty board counts nothing", referral.referralCounts([]), {
  total: 0,
  invited: 0,
  applied: 0,
  active: 0,
  hired: 0,
  closed: 0,
  bonusPending: 0,
  bonusPaid: 0,
});

// The comment on `referralProgress` promises that a stage move reaches the book
// through the live channel. Before this watch existed the promise was false and
// the page silently never refreshed, so the scope is asserted here rather than
// trusted from the watch table's own proof.
const claims = LIVE_WATCH.find((watch) => watch.area === "referrals");
check(
  "the claim table is watched by its own area",
  claims?.table === "referrals" && claims?.stamp === "updated_at",
  JSON.stringify(claims)
);
check(
  "and on the referral book alone, so an unapplied 040 refuses only this area",
  JSON.stringify(claims?.paths) === JSON.stringify(["/referrals"]),
  JSON.stringify(claims?.paths)
);
equal(
  "the book refreshes on its own claims and on the pipeline",
  watchForPath("/referrals").map((watch) => watch.area),
  ["pipeline", "referrals"]
);

/* -------------------------------------------------------------------------- */
/* 4. The leaderboard                                                          */
/* -------------------------------------------------------------------------- */

const board = referral.referralLeaderboard([
  { profileId: "b", name: "Bilal", stage: "HIRED", bonusState: "NONE" },
  { profileId: "a", name: "Aya", stage: "HIRED", bonusState: "NONE" },
  { profileId: "a", name: "Aya", stage: "INTERVIEW", bonusState: "NONE" },
  { profileId: "a", name: "Aya", stage: null, bonusState: "NONE" },
  { profileId: "c", name: "Carmen", stage: null, bonusState: "NONE" },
  { profileId: "d", name: "Dina", stage: "HIRED", bonusState: "NONE" },
]);
equal(
  "hired first, then the larger book, then the name",
  board.map((entry) => [entry.name, entry.hired, entry.total, entry.rank]),
  [
    ["Aya", 1, 3, 1],
    ["Bilal", 1, 1, 2],
    ["Dina", 1, 1, 3],
    ["Carmen", 0, 1, 4],
  ]
);
equal(
  "a referrer with two rows is one leaderboard line",
  board.filter((entry) => entry.profileId === "a").length,
  1
);
equal(
  "the same fixture read twice ranks the same",
  referral.referralLeaderboard([
    { profileId: "d", name: "Dina", stage: "HIRED", bonusState: "NONE" },
    { profileId: "b", name: "Bilal", stage: "HIRED", bonusState: "NONE" },
    { profileId: "a", name: "Aya", stage: "HIRED", bonusState: "NONE" },
    { profileId: "a", name: "Aya", stage: "INTERVIEW", bonusState: "NONE" },
    { profileId: "a", name: "Aya", stage: null, bonusState: "NONE" },
    { profileId: "c", name: "Carmen", stage: null, bonusState: "NONE" },
  ]).map((entry) => entry.profileId),
  ["a", "b", "d", "c"]
);
equal("an empty board has no leader", referral.referralLeaderboard([]), []);

/* -------------------------------------------------------------------------- */
/* 5. Who sees and decides                                                     */
/* -------------------------------------------------------------------------- */

equal("the owner sees every referral", referral.seesAllReferrals("SUPER_ADMIN"), true);
equal("a recruiter sees every referral", referral.seesAllReferrals("RECRUITER"), true);
equal("a hiring manager sees their own", referral.seesAllReferrals("HIRING_MANAGER"), false);
equal("a candidate sees nothing", referral.seesAllReferrals("CANDIDATE"), false);
equal("the reassignment door is the recruiter's", referral.canReassignReferral("RECRUITER"), true);
equal("the reassignment door is shut to a hiring manager", referral.canReassignReferral("HIRING_MANAGER"), false);
equal("the bonus decision is the recruiter's", referral.canDecideBonus("SUPER_ADMIN"), true);
equal("the bonus decision is shut to a hiring manager", referral.canDecideBonus("HIRING_MANAGER"), false);

equal("the four bonus states are the whole vocabulary", referral.BONUS_STATES, [
  "NONE",
  "PENDING",
  "PAID",
  "DECLINED",
]);
equal(
  "a bonus decision is recorded with its note",
  referral.planBonusDecision({ state: "PENDING", note: "  Confirm after the guarantee period. " }),
  { ok: true, state: "PENDING", note: "Confirm after the guarantee period." }
);
equal(
  "an unknown bonus state is refused",
  referral.planBonusDecision({ state: "PAID_OUT" }).ok,
  false
);
equal(
  "a 400-character bonus note is accepted",
  referral.planBonusDecision({ state: "PAID", note: "x".repeat(400) }).ok,
  true
);
equal(
  "a 401-character bonus note is refused",
  referral.planBonusDecision({ state: "PAID", note: "x".repeat(401) }).ok,
  false
);

/* -------------------------------------------------------------------------- */
/* 6. The migration                                                            */
/* -------------------------------------------------------------------------- */

const migration = read("db/migrations/040_referrals.sql");
has("the migration creates the referrals table", migration, "create table if not exists public.referrals");
has("the migration adds a durable code to the profile", migration, "add column if not exists referral_code");
has("a new staff member gets a code from the database", migration, "upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))");
// The default must not be `encode(gen_random_bytes(5), 'hex')`: this stack installs
// pgcrypto into the `extensions` schema and a migration session runs with
// search_path = public, so the unqualified name aborts the whole file. The backfill's
// comment still names the function to explain the choice, so the guard reads only the
// lines the database actually executes.
const migrationStatements = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
check("the code default resolves without pgcrypto", !/gen_random_bytes/.test(migrationStatements));
has(
  "the claim is unique per person and role",
  migration,
  "create unique index if not exists referrals_person_job_uniq"
);
has("the unique claim is case-insensitive", migration, "lower(email), job_id");
has(
  "one application carries at most one referral",
  migration,
  "create unique index if not exists referrals_application_uniq"
);
has("the bonus is a recorded decision", migration, "bonus_state in ('NONE', 'PENDING', 'PAID', 'DECLINED')");
check("no stage is copied onto the referral", !/\bstage\s+(text|application_stage)/i.test(migration));
has("the table is behind RLS", migration, "enable row level security");
has(
  "a staff member reads their own rows",
  migration,
  "referrer_profile_id = current_user_profile_id()"
);
has("a recruiter reads every row", migration, "is_recruiter()");
has("the migration says it is applied", migration, "-- APPLIED. The owner approved");
check("the migration no longer claims the file was never run", !/NOT APPLIED/.test(migration));
has("the migration names the next file", migration, "041");

/* -------------------------------------------------------------------------- */
/* 7. The reader, the actions and the page                                     */
/* -------------------------------------------------------------------------- */

const reader = read("src/modules/referrals/infrastructure/referralReader.ts");
has("the reader reads referrals", reader, '.from("referrals")');
has("the reader embeds the role", reader, "job_openings");
has("the reader embeds the referrer", reader, "user_profiles");
has("the reader embeds the application", reader, "applications");
has("the reader scopes staff to their own rows", reader, 'eq("referrer_profile_id"');
has("the reader names the missing migration", reader, "REFERRAL_SCHEMA_NOTE");
has("the reader caps its list", reader, "REFERRAL_READ_LIMIT");

const actions = read("src/app/(admin)/referrals/actions.ts");
has("every action is behind the staff door", actions, 'requireStaff("/referrals")');
has("a write refuses on an unapplied migration", actions, "REFERRAL_WRITE_REFUSAL");
has("a second claim names first-claim-wins", actions, 'error.code === "23505"');
has("a recruiter can reassign", actions, "canReassignReferral");
has("a recruiter records the bonus", actions, "canDecideBonus");
has("the hand entry writes a referral", actions, '.from("referrals")');
has("the actions are on the change trail", actions, "recordActivity");

const page = read("src/app/(admin)/referrals/page.tsx");
has("the page guards itself", page, 'requireStaff("/referrals")');
has("the page reads the board", page, "getReferralBoard");
const routes = read("src/lib/auth/staffRoutes.ts");
has("the page is a staff route", routes, '"/referrals"');
const nav = read("src/modules/analytics/presentation/nav.ts");
has("the page is on the rail", nav, 'href: "/referrals"');

/* -------------------------------------------------------------------------- */
/* 8. The public door                                                          */
/* -------------------------------------------------------------------------- */

const careers = read("src/app/careers/actions.ts");
has("the application accepts a referral code", careers, "referralCode");
has("only a real code earns a referral", careers, "readReferralCode");
has("a resolved code becomes the REFERRAL source", careers, '"REFERRAL"');
has("the credit is best-effort", careers, "creditReferral");
const credit = read("src/modules/referrals/application/credit.ts");
has("the credit links an existing claim", credit, 'from("referrals")');
has("the credit inserts a code-earned claim", credit, "referrer_profile_id");
has("a missing table costs the credit and not the application", credit, "isMissingSchemaError");
has("the claimant is resolved from the code", credit, "referral_code");
check(
  "the resolve refuses a candidate's code",
  credit.includes('"SUPER_ADMIN"') && credit.includes('"HIRING_MANAGER"')
);
const wizard = read("src/app/careers/apply/[id]/ApplyWizard.tsx");
has("the wizard carries the code", wizard, "referralCode");
has("the wizard starts a referred application as REFERRAL", wizard, 'referralCode ? "REFERRAL"');
const bits = read("src/app/careers/apply/[id]/ApplyBits.tsx");
check(
  "an applicant no longer declares a referral by hand",
  !/value: "REFERRAL"/.test(bits)
);
const applyPage = read("src/app/careers/apply/[id]/page.tsx");
has("the apply page reads the code from the URL", applyPage, "searchParams");
const rolePage = read("src/app/careers/[id]/page.tsx");
has("the role page keeps the code into the apply link", rolePage, "referralApplyLink");

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  if (!result.pass) console.log(`FAIL ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
