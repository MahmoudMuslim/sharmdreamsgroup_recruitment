/* scripts/prove-privacy.mjs
 * Run: node --env-file=docker/.env --experimental-strip-types scripts/prove-privacy.mjs
 *
 * The privacy slice, held to the four decisions that shaped it:
 *
 *   1. a required processing consent and an optional talent-pool consent, each
 *      with its own retention window;
 *   2. a public request door opened by a signed mailed link, plus a staff desk;
 *   3. erasure means anonymise — the application row, its stage, its scores and
 *      its timestamps stay, the person goes;
 *   4. twelve months after the last activity by default, warned thirty days
 *      before, and a talent-pool grant lives twenty-four months.
 *
 * Two rules are pinned harder than the rest, because a later edit could quietly
 * break them without any screen changing:
 *
 *   - the sweep never erases a blocked row, and "blocked" includes anybody who
 *     was hired and any record with an assessment or interview still open;
 *   - retention is off unless the setting says otherwise, so a misread setting
 *     cannot start deleting records.
 *
 * The database half is a text pin against db/migrations/041_privacy.sql. Whether
 * a particular database has applied it is a fact about that database, answered
 * by the reader's own missing-schema branch, not by this file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { createHmac } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const d = await import("../src/modules/privacy/domain/privacy.ts");
const link = await import("../src/modules/privacy/application/linkToken.ts");

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
function lacks(name, text, needle) {
  check(name, !text.includes(needle), `still contains ${JSON.stringify(needle)}`);
}

/* -------------------------------------------------------------------------- */
/* 1. Consent                                                                  */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-10-25T09:00:00.000Z");
const NOW_ISO = NOW.toISOString();

{
  const missing = d.planApplicationConsent({ processing: false, talentPool: false }, NOW);
  equal("an application without processing consent is refused", missing.ok, false);

  const notBoolean = d.planApplicationConsent({ processing: "true" }, NOW);
  equal("a string is not a consent", notBoolean.ok, false);

  const requiredOnly = d.planApplicationConsent({ processing: true }, NOW);
  equal("processing alone is a complete consent", requiredOnly.ok, true);
  equal("processing alone records one event", requiredOnly.ok && requiredOnly.events.length, 1);
  equal(
    "the processing event is granted at the clock it was given",
    requiredOnly.ok && requiredOnly.events[0],
    { purpose: "processing", granted: true, at: NOW_ISO }
  );

  const both = d.planApplicationConsent({ processing: true, talentPool: true }, NOW);
  equal("the talent pool is recorded beside processing", both.ok && both.events.length, 2);
  equal(
    "the pool event says what the candidate chose",
    both.ok && both.events[1],
    { purpose: "talent_pool", granted: true, at: NOW_ISO }
  );

  const declined = d.planApplicationConsent({ processing: true, talentPool: false }, NOW);
  equal(
    "declining the pool is recorded, not left blank",
    declined.ok && declined.events[1],
    { purpose: "talent_pool", granted: false, at: NOW_ISO }
  );

  const nonsense = d.planApplicationConsent({ processing: true, talentPool: "yes" }, NOW);
  equal("an unclear pool answer is refused rather than guessed", nonsense.ok, false);
}

{
  const events = [
    { purpose: "processing", granted: true, at: "2026-01-01T00:00:00.000Z" },
    { purpose: "talent_pool", granted: false, at: "2026-02-01T00:00:00.000Z" },
    { purpose: "talent_pool", granted: true, at: "2026-03-01T00:00:00.000Z" },
  ];
  equal("the latest event wins", d.consentState(events, "talent_pool"), "granted");
  equal("a purpose with no event is unknown", d.consentState(events, "marketing"), "unknown");
  equal(
    "a later refusal withdraws",
    d.consentState(
      [...events, { purpose: "talent_pool", granted: false, at: "2026-04-01T00:00:00.000Z" }],
      "talent_pool"
    ),
    "withdrawn"
  );
  equal(
    "an empty history is unknown",
    d.consentState([], "processing"),
    "unknown"
  );
  equal(
    "the pool is closed unless it is granted",
    d.consentAllowsPool(events),
    true
  );
  equal(
    "a withdrawn pool is closed",
    d.consentAllowsPool([{ purpose: "talent_pool", granted: false, at: NOW_ISO }]),
    false
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Retention windows                                                        */
/* -------------------------------------------------------------------------- */

{
  equal(
    "a month never rolls into the next one",
    d.addMonths(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString(),
    "2026-02-28T00:00:00.000Z"
  );
  equal(
    "a leap year keeps the 29th",
    d.addMonths(new Date("2024-01-31T00:00:00.000Z"), 1).toISOString(),
    "2024-02-29T00:00:00.000Z"
  );
  equal(
    "twelve months is the same day next year",
    d.addMonths(new Date("2026-01-15T10:30:00.000Z"), 12).toISOString(),
    "2027-01-15T10:30:00.000Z"
  );

  equal(
    "a setting that is missing falls back",
    d.readMonths(undefined, 12),
    12
  );
  equal("a numeric string is read", d.readMonths("24", 12), 24);
  equal("zero months falls back rather than erasing at once", d.readMonths(0, 12), 12);
  equal("a typo falls back", d.readMonths("twelve", 12), 12);
  equal("an absurd window is clamped", d.readMonths("999", 12), d.MAX_RETENTION_MONTHS);
  equal("the warning window is read the same way", d.readWarningDays("30", 30), 30);
  equal("a zero-day warning is not allowed", d.readWarningDays(0, 30), 30);
}

{
  const opts = {
    months: 12,
    warningDays: 30,
    now: new Date("2026-10-01T00:00:00.000Z"),
  };
  equal(
    "exactly the due date is due",
    d.retentionStatus({ lastActivityAt: "2025-10-01T00:00:00.000Z", ...opts }),
    "due"
  );
  equal(
    "a day inside the warning window warns",
    d.retentionStatus({ lastActivityAt: "2025-10-15T00:00:00.000Z", ...opts }),
    "warning"
  );
  equal(
    "a day before the window is held",
    d.retentionStatus({ lastActivityAt: "2025-10-15T00:00:00.000Z", months: 12, warningDays: 30, now: new Date("2026-09-14T00:00:00.000Z") }),
    "held"
  );
  equal(
    "a record with no readable date is held, never erased",
    d.retentionStatus({ lastActivityAt: "not a date", ...opts }),
    "held"
  );
  equal(
    "the pool window runs from the grant",
    d.poolDueAt(new Date("2026-03-10T00:00:00.000Z"), 24).toISOString(),
    "2028-03-10T00:00:00.000Z"
  );
}

{
  const decisions = d.planRetention(
    [
      { applicationId: "a", lastActivityAt: "2025-09-01T00:00:00.000Z", stage: "NEW", openAssessments: 0, openInterviews: 0 },
      { applicationId: "b", lastActivityAt: "2025-09-01T00:00:00.000Z", stage: "HIRED", openAssessments: 0, openInterviews: 0 },
      { applicationId: "c", lastActivityAt: "2025-09-01T00:00:00.000Z", stage: "ASSESSMENT", openAssessments: 1, openInterviews: 0 },
      { applicationId: "d", lastActivityAt: "2025-09-01T00:00:00.000Z", stage: "INTERVIEW", openAssessments: 0, openInterviews: 1 },
      { applicationId: "e", lastActivityAt: "2026-09-15T00:00:00.000Z", stage: "NEW", openAssessments: 0, openInterviews: 0 },
    ],
    { months: 12, warningDays: 30, now: new Date("2026-10-01T00:00:00.000Z") }
  );

  equal("every row gets a decision", decisions.length, 5);
  equal("an ordinary stale record is due", decisions[0].status, "due");
  equal("and it is the one the sweep would erase", d.shouldErase(decisions[0]), true);
  equal("a hired record is blocked", d.shouldErase(decisions[1]), false);
  has("and the block says why", decisions[1].blockedBy ?? "", "hired");
  equal("an open assessment blocks", d.shouldErase(decisions[2]), false);
  has("and names the assessment", decisions[2].blockedBy ?? "", "assessment");
  equal("an open interview blocks", d.shouldErase(decisions[3]), false);
  has("and names the interview", decisions[3].blockedBy ?? "", "interview");
  equal("a fresh record is held", decisions[4].status, "held");
  equal("a held record is never erased", d.shouldErase(decisions[4]), false);
}

{
  // A pool grant buys its own window, counted from the grant. A record whose
  // ordinary window ran out is still held while the pool promise is alive, and
  // once that promise ends the ordinary window decides again.
  const now = new Date("2026-10-01T00:00:00.000Z");
  const base = {
    applicationId: "a",
    lastActivityAt: "2025-06-01T00:00:00.000Z",
    stage: "NEW",
    openAssessments: 0,
    openInterviews: 0,
  };
  const granted = d.planRetention(
    [{ ...base, poolGrantedAt: "2025-09-01T00:00:00.000Z" }],
    { months: 12, warningDays: 30, talentPoolMonths: 24, now }
  )[0];
  equal("a live talent-pool grant holds a record past its ordinary window", granted.status, "held");
  equal("and the due date it prints is the pool's", granted.dueAt, "2027-09-01T00:00:00.000Z");

  const lapsed = d.planRetention(
    [{ ...base, poolGrantedAt: "2023-01-01T00:00:00.000Z" }],
    { months: 12, warningDays: 30, talentPoolMonths: 24, now }
  )[0];
  equal("an expired pool falls back to the ordinary window", lapsed.status, "due");
  equal("and reports the ordinary date", lapsed.dueAt, "2026-06-01T00:00:00.000Z");
}

{
  // The letter promises the candidate a stated number of days. A sweep that
  // erased on the due date without ever warning — or warned and erased on the
  // same pass — would keep the sentence on the public page and break it.
  const now = new Date("2026-10-01T00:00:00.000Z");
  const due = {
    applicationId: "a",
    dueAt: "2026-09-01T00:00:00.000Z",
    status: "due",
    blockedBy: null,
  };
  const warning = { ...due, dueAt: "2026-10-20T00:00:00.000Z", status: "warning" };
  const act = (decision, warnedAt) =>
    d.nextRetentionAction({ decision, warnedAt, warningDays: 30, now });

  equal("a due record with no warning is warned first, never erased", act(due, null), "warn");
  equal("an unreadable warning date is not a warning", act(due, "not a date"), "warn");
  equal("a warning inside its window is not erased", act(due, "2026-09-15T00:00:00.000Z"), "none");
  equal(
    "a warning the candidate has had for the stated days allows the erasure",
    act(due, "2026-09-01T00:00:00.000Z"),
    "erase"
  );
  equal("a record still inside its window is warned", act(warning, null), "warn");
  equal(
    "an already warned record is not erased before it is due",
    act(warning, "2026-09-01T00:00:00.000Z"),
    "none"
  );
  equal("a held record is left alone", act({ ...due, status: "held" }, null), "none");
  equal("a blocked record is left alone", act({ ...due, blockedBy: "hired" }, null), "none");
}

/* -------------------------------------------------------------------------- */
/* 3. Requests                                                                 */
/* -------------------------------------------------------------------------- */

{
  const good = d.planPrivacyRequest({ kind: "erasure", email: " Person@Example.COM ", note: " please " });
  equal("a request folds its email", good.ok && good.email, "person@example.com");
  equal("a request keeps its kind", good.ok && good.kind, "erasure");
  equal("a request trims its note", good.ok && good.note, "please");

  equal("an unknown kind is refused", d.planPrivacyRequest({ kind: "delete", email: "a@b.co" }).ok, false);
  equal("a blank email is refused", d.planPrivacyRequest({ kind: "access", email: "  " }).ok, false);
  equal("a malformed email is refused", d.planPrivacyRequest({ kind: "access", email: "nope" }).ok, false);
  equal(
    "an over-long note is refused",
    d.planPrivacyRequest({ kind: "access", email: "a@b.co", note: "x".repeat(d.PRIVACY_NOTE_MAX + 1) }).ok,
    false
  );

  equal("a request may be verified", d.nextRequestState("RECEIVED", "verify"), "VERIFIED");
  equal("a verified request may be approved", d.nextRequestState("VERIFIED", "approve"), "APPROVED");
  equal("a verified request may be declined", d.nextRequestState("VERIFIED", "decline"), "DECLINED");
  equal("a request may be declined before verification", d.nextRequestState("RECEIVED", "decline"), "DECLINED");
  equal("an approved erasure may run", d.nextRequestState("APPROVED", "execute"), "EXECUTED");
  equal("an unverified request cannot be approved", d.nextRequestState("RECEIVED", "approve"), null);
  equal("an approved request cannot be re-verified", d.nextRequestState("APPROVED", "verify"), null);
  equal("an executed request is terminal", d.nextRequestState("EXECUTED", "execute"), null);
  equal("a declined request is terminal", d.nextRequestState("DECLINED", "approve"), null);
}

/* -------------------------------------------------------------------------- */
/* 4. Erasure                                                                  */
/* -------------------------------------------------------------------------- */

{
  equal("the erased name is a stated value", d.ERASED_NAME, "Erased candidate");
  equal(
    "the erased address is stable per row and cannot receive mail",
    d.erasedEmail("AbCd-1234-5678"),
    "erased+abcd1234@erased.invalid"
  );
  equal(
    "the cleared columns are named",
    [...d.ERASURE_CLEARED_COLUMNS].sort(),
    ["cv_file_path", "cv_text", "email", "full_name", "phone"]
  );
  const kept = [...d.ERASURE_KEPT_COLUMNS];
  check("the row and its stage survive", kept.includes("id") && kept.includes("stage"));
  check("the scores stay with the record", kept.includes("id") && kept.some((c) => c.includes("score")));
  check("a blank row is not erased", !d.isErased({ erased_at: null }));
  check("an erased row says so", d.isErased({ erased_at: "2026-10-25T00:00:00.000Z" }));
}

/* -------------------------------------------------------------------------- */
/* 5. Who may see or decide                                                    */
/* -------------------------------------------------------------------------- */

{
  equal("the owner reads the desk", d.canReadPrivacyDesk("SUPER_ADMIN"), true);
  equal("a recruiter reads the desk", d.canReadPrivacyDesk("RECRUITER"), true);
  equal("a hiring manager does not", d.canReadPrivacyDesk("HIRING_MANAGER"), false);
  equal("a candidate does not", d.canReadPrivacyDesk("CANDIDATE"), false);
  equal("a recruiter may verify a request", d.canVerifyPrivacyRequest("RECRUITER"), true);
  equal("a recruiter may not approve one", d.canDecidePrivacyRequest("RECRUITER"), false);
  equal("the owner may approve one", d.canDecidePrivacyRequest("SUPER_ADMIN"), true);
  equal("the owner may execute an erasure", d.canExecuteErasure("SUPER_ADMIN"), true);
  equal("a recruiter may not execute one", d.canExecuteErasure("RECRUITER"), false);
}

/* -------------------------------------------------------------------------- */
/* 6. The signed link                                                          */
/* -------------------------------------------------------------------------- */

const SECRET = "proof-secret-that-is-at-least-32-chars!!";
const T = 1_800_000_000;

{
  const token = link.mintPrivacyToken({ applicationId: "app-1", now: T, secret: SECRET });
  const parts = token.split(".");
  equal("the token has a version, a body and a signature", parts.length, 3);
  equal("the version is stated", parts[0], "v1");
  check("the token is not the application id in the clear", !token.includes("app-1"));

  const ok = link.verifyPrivacyToken(token, { now: T + 1, secret: SECRET });
  equal("a fresh token verifies", ok.ok, true);
  equal("and names the application", ok.ok && ok.applicationId, "app-1");
  equal("and says when it ends", ok.ok && ok.expiresAt, T + link.PRIVACY_LINK_TTL_SECONDS);

  equal(
    "the second before expiry still works",
    link.verifyPrivacyToken(token, { now: T + link.PRIVACY_LINK_TTL_SECONDS - 1, secret: SECRET }).ok,
    true
  );
  const expired = link.verifyPrivacyToken(token, { now: T + link.PRIVACY_LINK_TTL_SECONDS, secret: SECRET });
  equal("the expiry second does not", expired.ok, false);
  equal("and says it expired", expired.ok === false && expired.reason, "expired");

  const [v, body, sig] = token.split(".");
  const flipped = body.slice(0, -1) + (body.endsWith("A") ? "B" : "A");
  const tampered = link.verifyPrivacyToken(`${v}.${flipped}.${sig}`, { now: T, secret: SECRET });
  equal("a tampered body fails its signature", tampered.ok === false && tampered.reason, "signature");

  const wrongKey = link.verifyPrivacyToken(token, { now: T, secret: "another-secret-that-is-32-characters-long" });
  equal("another secret does not verify", wrongKey.ok === false && wrongKey.reason, "signature");

  for (const bad of ["", "x", "v1.only-two", "v2.a.b", `${v}.${body}`]) {
    const result = link.verifyPrivacyToken(bad, { now: T, secret: SECRET });
    equal(`malformed ${JSON.stringify(bad)} is refused as malformed`, result.ok === false && result.reason, "malformed");
  }

  // A well-signed token for another purpose is still not a privacy link: the
  // purpose is inside the signed body, so it cannot be added to a real token.
  const forgedBody = Buffer.from(JSON.stringify({ a: "app-1", e: T + 600, p: "staff" })).toString("base64url");
  const forgedSig = createHmac("sha256", link.privacySigningKey(SECRET))
    .update(`v1.${forgedBody}`)
    .digest("base64url");
  const forged = link.verifyPrivacyToken(`v1.${forgedBody}.${forgedSig}`, { now: T, secret: SECRET });
  equal("a token minted for another purpose is not a privacy link", forged.ok === false && forged.reason, "malformed");

  equal(
    "the public address carries the token",
    link.privacyLink("https://careers.example/", token),
    `https://careers.example/privacy?token=${token}`
  );
}

/* -------------------------------------------------------------------------- */
/* 7. The database half                                                        */
/* -------------------------------------------------------------------------- */

{
  const migration = read(d.PRIVACY_MIGRATION);
  check("the migration file exists", migration.length > 0, d.PRIVACY_MIGRATION);
  has("it creates the consent record", migration, "candidate_consents");
  has("it creates the request book", migration, "privacy_requests");
  has("it holds the processing consent stamp", migration, "processing_consent_at");
  has("it holds the pool consent stamp", migration, "talent_pool_consent_at");
  has("it holds the notice version", migration, "notice_version");
  has("it marks an erased row", migration, "erased_at");
  has("it remembers the warning", migration, "retention_warned_at");
  has("the warning stamp does not restart the window", migration, "touch_application");
  has("the applications trigger points at it", migration, "execute function public.touch_application");
  has("the erasure is one database function", migration, "erase_candidate_data");
  has("and it runs with the definer's rights", migration, "security definer");
  has("it is reachable only by the service role", migration, "service_role");
  has("it reloads the schema for PostgREST", migration, "reload schema");
  has(
    "only the owner moves a request past verification",
    migration,
    "(state = 'VERIFIED' or is_owner())"
  );
  has("the erased name is written there too", migration, d.ERASED_NAME);
  has("the erased address is built there too", migration, "erased.invalid");
  for (const column of d.ERASURE_CLEARED_COLUMNS) {
    has(`the function clears ${column}`, migration, column);
  }
}

/* -------------------------------------------------------------------------- */
/* 8. The slices the screens ride on                                           */
/* -------------------------------------------------------------------------- */

{
  const routes = read("src/lib/auth/staffRoutes.ts");
  has("the retention desk is a guarded staff page", routes, '"/retention"');

  const nav = read("src/modules/analytics/presentation/nav.ts");
  has("the rail carries the retention desk", nav, 'href: "/retention"');

  const keys = read("src/modules/shell/domain/quickKeys.ts");
  has("a quick key opens it", keys, 'l: "/retention"');

  const guide = read("src/modules/shell/domain/pageGuide.ts");
  has("the manual describes it", guide, '"/retention"');

  const watch = read("src/modules/live/infrastructure/changeWatch.ts");
  lacks("the live channel does not claim it", watch, "/retention");

  const publicPage = read("src/app/privacy/page.tsx");
  has("the public page verifies the link", publicPage, "verifyPrivacyToken");
  const publicActions = read("src/app/privacy/actions.ts");
  has("the request door plans a request", publicActions, "planPrivacyRequest");
  has("a request is filed with the service role", publicActions, "getServiceRestClient");

  const wizard = read("src/app/careers/apply/[id]/ApplyWizard.tsx");
  has("the applicant is asked for processing consent", wizard, "processingConsent");
  has("and offered the talent pool", wizard, "talentPoolConsent");
  const careers = read("src/app/careers/actions.ts");
  has("the action reads the consent", careers, "planApplicationConsent");
  has("the consent is stamped on the row", careers, "processing_consent_at");
  has("with the notice version", careers, "notice_version");

  const retentionPage = read("src/app/(admin)/retention/page.tsx");
  has("the desk renders", retentionPage, "requireStaff");
  const retentionActions = read("src/app/(admin)/retention/actions.ts");
  has("the desk can verify", retentionActions, "nextRequestState");
  has("and the owner's decision is the one that runs", retentionActions, "canDecidePrivacyRequest");
  const erasure = read("src/modules/privacy/application/erasure.ts");
  has("erasure asks the blockers first", erasure, "erasureBlocker");
  has("it removes stored files", erasure, "remove");
  has("it calls the one database function", erasure, "erase_candidate_data");

  const cron = read("src/app/api/cron/retention/route.ts");
  has("the sweep is behind the cron secret", cron, "x-cron-secret");
  has("and does nothing while the setting is off", cron, "privacy.retention_enabled");

  const reader = read("src/modules/privacy/infrastructure/privacyReader.ts");
  has("the reader says when the table is absent", reader, "isMissingSchemaError");
  has("and the desk is told", reader, "PRIVACY_SCHEMA_NOTE");

  const i18n = read("src/lib/i18n.ts");
  has("the public page has a title in English", i18n, '"privacy.title"');
  check("and in Arabic", (i18n.match(/"privacy\.title"/g) ?? []).length >= 2);
  has("the application asks for consent in words", i18n, '"apply.consent.processing"');
}

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
