/* scripts/prove-offers.mjs
 * Run: node --env-file=docker/.env --experimental-strip-types scripts/prove-offers.mjs
 *
 * The offer slice, held to the four decisions that shaped it:
 *
 *   1. accepting records the answer and nothing else — the stage stays OFFER
 *      until a recruiter confirms the hire with a separate click;
 *   2. declining keeps the person in OFFER, marked declined, and the desk decides
 *      whether to archive, reject or reopen;
 *   3. the candidate answers from a signed link mailed to the address on the
 *      record, on a public page, never through the candidate portal;
 *   4. every offer carries its own deadline — seven days unless the recruiter
 *      names another, one to sixty — and expiry never decides for anybody.
 *
 * Two rules are pinned harder than the rest, because a later edit could quietly
 * break them without any screen changing:
 *
 *   - the link is mailed before the offer is written, so a failed send leaves no
 *     row that a candidate can never have answered;
 *   - the answer is a conditional write on both `state = 'SENT'` and
 *     `expires_at > now`, so two clicks racing at the deadline cannot both win.
 *
 * The database half is a text pin against db/migrations/042_offers.sql. Whether
 * a particular database has applied it is a fact about that database, answered
 * by the reader's own missing-schema branch, not by this file.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

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

const d = await import("../src/modules/offers/domain/offer.ts");
const link = await import("../src/modules/offers/application/offerToken.ts");
const privacyLink = await import("../src/modules/privacy/application/linkToken.ts");

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
/* 1. The deadline                                                            */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-10-25T09:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

{
  equal("an offer defaults to seven days", d.OFFER_DEFAULT_DAYS, 7);
  equal("the shortest offer is one day", d.OFFER_MIN_DAYS, 1);
  equal("the longest offer is sixty days", d.OFFER_MAX_DAYS, 60);

  equal("a missing number falls back to the default", d.readOfferDays(undefined), 7);
  equal("an empty box falls back to the default", d.readOfferDays(""), 7);
  equal("a word falls back to the default", d.readOfferDays("next week"), 7);
  equal("zero is a typo, not an instruction", d.readOfferDays(0), 7);
  equal("a negative is a typo too", d.readOfferDays(-3), 7);
  equal("a fraction is not a day count", d.readOfferDays(2.5), 7);
  equal("a typed number is read", d.readOfferDays("10"), 10);
  equal("a number already in range is kept", d.readOfferDays(3), 3);
  equal("the ceiling clamps a mistyped number", d.readOfferDays(90), 60);

  const expiry = d.offerExpiry(NOW, 7);
  equal(
    "seven days lands on the same hour one week later",
    expiry instanceof Date ? expiry.toISOString() : expiry,
    "2026-11-01T09:00:00.000Z"
  );
  equal("an unreadable issue date has no deadline", d.offerExpiry("not a date", 7), null);
}

/* -------------------------------------------------------------------------- */
/* 2. Where an offer stands                                                    */
/* -------------------------------------------------------------------------- */

{
  const future = "2026-11-01T09:00:00.000Z";
  const past = "2026-10-24T09:00:00.000Z";

  equal(
    "a sent offer inside its window is open",
    d.offerStanding({ state: "SENT", expiresAt: future, now: NOW }),
    "open"
  );
  equal(
    "the deadline instant itself is expired, not open",
    d.offerStanding({ state: "SENT", expiresAt: NOW.toISOString(), now: NOW }),
    "expired"
  );
  equal(
    "an offer past its deadline is expired",
    d.offerStanding({ state: "SENT", expiresAt: past, now: NOW }),
    "expired"
  );
  equal(
    "an unreadable deadline fails closed",
    d.offerStanding({ state: "SENT", expiresAt: "garbage", now: NOW }),
    "expired"
  );
  equal(
    "an answered offer keeps its answer past the deadline",
    d.offerStanding({ state: "ACCEPTED", expiresAt: past, now: NOW }),
    "accepted"
  );
  equal(
    "a declined offer reads declined",
    d.offerStanding({ state: "DECLINED", expiresAt: future, now: NOW }),
    "declined"
  );
  equal(
    "a withdrawn offer reads withdrawn",
    d.offerStanding({ state: "WITHDRAWN", expiresAt: future, now: NOW }),
    "withdrawn"
  );
}

/* -------------------------------------------------------------------------- */
/* 3. The candidate's answer                                                 */
/* -------------------------------------------------------------------------- */

{
  const open = { state: "SENT", expiresAt: "2026-11-01T09:00:00.000Z", now: NOW };

  const accepted = d.decideOffer({ ...open, decision: "accept" });
  equal("accepting an open offer is allowed", accepted.ok, true);
  equal("accepting records ACCEPTED", accepted.ok && accepted.state, "ACCEPTED");

  const declined = d.decideOffer({ ...open, decision: "decline" });
  equal("declining an open offer is allowed", declined.ok, true);
  equal("declining records DECLINED", declined.ok && declined.state, "DECLINED");

  const late = d.decideOffer({
    ...open,
    expiresAt: "2026-10-24T09:00:00.000Z",
    decision: "accept",
  });
  equal("an expired offer cannot be answered", late.ok, false);
  equal(
    "the expiry refusal says the offer expired",
    late.ok === false && /expired/i.test(late.error),
    true
  );

  const again = d.decideOffer({ ...open, state: "ACCEPTED", decision: "decline" });
  equal("an answered offer cannot be answered again", again.ok, false);
  equal(
    "the second-answer refusal says it was already answered",
    again.ok === false && /already/i.test(again.error),
    true
  );

  const withdrawn = d.decideOffer({ ...open, state: "WITHDRAWN", decision: "accept" });
  equal("a withdrawn offer cannot be answered", withdrawn.ok, false);
  equal(
    "the withdrawal refusal names the withdrawal",
    withdrawn.ok === false && /withdrawn/i.test(withdrawn.error),
    true
  );

  const nonsense = d.decideOffer({ ...open, decision: "maybe" });
  equal("an unknown decision is refused", nonsense.ok, false);
}

/* -------------------------------------------------------------------------- */
/* 4. Who may be sent an offer                                                */
/* -------------------------------------------------------------------------- */

{
  equal("a new applicant may be offered a role", d.canIssueOffer("NEW"), true);
  equal("someone still in interview may be offered", d.canIssueOffer("INTERVIEW"), true);
  equal("an offer may be issued again from OFFER", d.canIssueOffer("OFFER"), true);
  equal("a hired person cannot be offered the role again", d.canIssueOffer("HIRED"), false);
  equal("a rejected person cannot be issued an offer", d.canIssueOffer("REJECTED"), false);
  equal("an unknown stage is refused", d.canIssueOffer("SOMEWHERE"), false);

  equal("SENT has a label", d.offerStateLabel("SENT"), "Sent");
  equal("ACCEPTED has a label", d.offerStateLabel("ACCEPTED"), "Accepted");
  equal("DECLINED has a label", d.offerStateLabel("DECLINED"), "Declined");
  equal("WITHDRAWN has a label", d.offerStateLabel("WITHDRAWN"), "Withdrawn");
}

/* -------------------------------------------------------------------------- */
/* 5. The signed link                                                        */
/* -------------------------------------------------------------------------- */

{
  const secret = "prove-offers-secret-that-is-long-enough-to-sign-anything";
  const token = link.mintOfferToken({
    applicationId: "app-1",
    offerId: "offer-1",
    now: NOW_SECONDS,
    ttlSeconds: 3600,
    secret,
  });

  const verified = link.verifyOfferToken(token, { now: NOW_SECONDS, secret });
  equal("a fresh offer token verifies", verified.ok, true);
  equal("the token names the application", verified.ok && verified.applicationId, "app-1");
  equal("the token names the one offer", verified.ok && verified.offerId, "offer-1");
  equal(
    "the token carries its own expiry",
    verified.ok && verified.expiresAt,
    NOW_SECONDS + 3600
  );

  equal(
    "a token past its expiry is refused",
    link.verifyOfferToken(token, { now: NOW_SECONDS + 3600, secret }).ok,
    false
  );

  const [version, body] = token.split(".");
  const tampered = `${version}.${body}.not-the-signature`;
  equal(
    "a tampered signature is refused",
    link.verifyOfferToken(tampered, { now: NOW_SECONDS, secret }).ok,
    false
  );

  const privacyToken = privacyLink.mintPrivacyToken({
    applicationId: "app-1",
    now: NOW_SECONDS,
    secret,
  });
  equal(
    "a privacy token cannot open an offer",
    link.verifyOfferToken(privacyToken, { now: NOW_SECONDS, secret }).ok,
    false
  );

  const offerToken = link.mintOfferToken({
    applicationId: "app-1",
    offerId: "offer-1",
    now: NOW_SECONDS,
    ttlSeconds: 3600,
    secret,
  });
  equal(
    "an offer token cannot open the privacy door",
    privacyLink.verifyPrivacyToken(offerToken, { now: NOW_SECONDS, secret }).ok,
    false
  );

  equal(
    "the offer key is derived from its own context",
    link.offerSigningKey(secret).equals(privacyLink.privacySigningKey(secret)),
    false
  );

  equal(
    "the link lives one day past the deadline",
    link.offerLinkSeconds(7),
    8 * 24 * 60 * 60
  );

  equal(
    "the mailed address is the public offer page",
    link.offerLink("https://careers.example.com/", token),
    `https://careers.example.com/offer?token=${encodeURIComponent(token)}`
  );
}

/* -------------------------------------------------------------------------- */
/* 6. The database half                                                      */
/* -------------------------------------------------------------------------- */

{
  const migration = read("db/migrations/042_offers.sql");
  check("the migration file exists", migration.length > 0, "db/migrations/042_offers.sql");
  has("it creates the offer table", migration, "create table if not exists public.application_offers");
  has("it names the four states", migration, "'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'");
  has("it holds the deadline", migration, "expires_at timestamp with time zone not null");
  has("it holds when the offer was issued", migration, "issued_at timestamp with time zone");
  has("it holds who issued it", migration, "issued_by uuid");
  has("it holds when it was answered", migration, "decided_at timestamp with time zone");
  has(
    "a decided offer has a decided time and an open one does not",
    migration,
    "(state = 'SENT') = (decided_at is null)"
  );
  has(
    "one open offer per application",
    migration,
    "create unique index if not exists application_offers_one_open_idx"
  );
  has("the unique index is partial on SENT", migration, "where state = 'SENT'");
  has("an application keeps its offers together", migration, "application_id, issued_at desc");
  has(
    "an offer goes with its application",
    migration,
    "foreign key (application_id) references applications (id) on delete cascade"
  );
  has(
    "an issuer who leaves leaves the offer behind",
    migration,
    "foreign key (issued_by) references user_profiles (id) on delete set null"
  );
  has("the table is behind row level security", migration, "enable row level security");
  has("the desk reads offers", migration, 'create policy "application_offers_staff_read"');
  has("the desk issues offers", migration, 'create policy "application_offers_staff_insert"');
  has("the desk withdraws offers", migration, 'create policy "application_offers_staff_update"');
  has("staff are the readers", migration, "using (is_staff())");
  has(
    "staff may write",
    migration,
    "grant select, insert, update on table public.application_offers to authenticated"
  );
  has(
    "the server keeps full reach for the public door",
    migration,
    "grant select, insert, update, delete on table public.application_offers to service_role"
  );
  has(
    "a visitor cannot write an offer straight through REST",
    migration,
    "revoke all on table public.application_offers from anon"
  );
  has("it reloads the schema for PostgREST", migration, "notify pgrst, 'reload schema'");
  lacks("it no longer says the file was never run", migration, "NOT APPLIED");
  has(
    "it records the apply and the date it was measured",
    migration,
    "APPLIED to the local database on 2026-10-28"
  );
  has(
    "it says the after-state was measured, and how",
    migration,
    "exercised inside a transaction that was rolled back"
  );
  has("it says the table held no rows", migration, "and zero rows");
  has(
    "it says a missing-schema screen names this file instead of pretending",
    migration,
    "both name this file rather than pretending an offer was"
  );
  check(
    "the schema note names the file and states nothing about this database",
    d.OFFER_SCHEMA_NOTE.includes(d.OFFER_MIGRATION) &&
      !/authored but not applied|is applied on this database/.test(d.OFFER_SCHEMA_NOTE),
    d.OFFER_SCHEMA_NOTE
  );
  check(
    "the write refusal names the file",
    d.OFFER_WRITE_REFUSAL.includes(d.OFFER_MIGRATION),
    d.OFFER_WRITE_REFUSAL
  );
  lacks("it carries no free-text decision note", migration, "decision_note");
}

/* -------------------------------------------------------------------------- */
/* 7. The desk's write order                                                 */
/* -------------------------------------------------------------------------- */

{
  const actions = read("src/app/(admin)/candidates/offer-actions.ts");
  check("the desk actions exist", actions.length > 0, "offer-actions.ts");

  // Anchor on the call, not the import: the import sits above every guard and
  // would make any "mailed before" ordering pass without reading the body.
  const sentAt = actions.indexOf("await sendOfferNotice");
  const insertedAt = actions.indexOf('.from("application_offers")');
  check(
    "the link is mailed before the offer is written",
    sentAt !== -1 && insertedAt !== -1 && sentAt < insertedAt,
    "sendOfferNotice must come before the insert"
  );
  has(
    "a failed send writes nothing",
    actions,
    "if (!sent.ok) return { ok: false, error: sent.error }"
  );
  has("issuing an offer reads the same permission the desk writes with", actions, 'hasPermissionForUser("candidates.write")');
  has("an offer refuses a hired record", actions, "canIssueOffer");
  has("moving to OFFER sends no stage notice of its own", actions, "notify: false");
  has("issuing writes a trail row", actions, 'action: "offer_issued"');
  has("withdrawing writes a trail row", actions, 'action: "offer_withdrawn"');
  has(
    "withdrawing only touches an offer still open",
    actions,
    '.eq("state", "SENT")'
  );
  has(
    "a hire is confirmed only from an accepted offer",
    actions,
    'state !== "ACCEPTED"'
  );
  has(
    "confirming the hire reuses the one stage writer",
    actions,
    'stage: "HIRED"'
  );
  has(
    "the panel says when the table is not there",
    actions,
    "OFFER_SCHEMA_NOTE"
  );

  // The unique index counts an expired SENT row as open, so a new letter must
  // never be mailed over one: the send would succeed and the insert would fail.
  const expiredAt = actions.indexOf("past its deadline");
  const acceptedAt = actions.indexOf("already accepted");
  check(
    "issuing refuses an expired offer that is still on the record",
    expiredAt !== -1 && sentAt !== -1 && expiredAt < sentAt,
    "the expired check must run before sendOfferNotice"
  );
  check(
    "issuing refuses an offer the candidate already accepted",
    acceptedAt !== -1 && sentAt !== -1 && acceptedAt < sentAt,
    "the accepted check must run before sendOfferNotice"
  );
}

/* -------------------------------------------------------------------------- */
/* 8. The candidate's door                                                   */
/* -------------------------------------------------------------------------- */

{
  const actions = read("src/app/offer/actions.ts");
  const page = read("src/app/offer/page.tsx");
  const layout = read("src/app/offer/layout.tsx");
  const door = read("src/app/offer/OfferDoor.tsx");

  check("the public offer action exists", actions.length > 0, "src/app/offer/actions.ts");
  check("the public offer page exists", page.length > 0, "src/app/offer/page.tsx");
  check("the public offer chrome exists", layout.length > 0, "src/app/offer/layout.tsx");
  check("the public offer door exists", door.length > 0, "OfferDoor.tsx");

  has("the page verifies the signed link", page, "verifyOfferToken");
  has("the page is not indexed", page, "robots: { index: false, follow: false }");
  has("the action re-verifies the link", actions, "verifyOfferToken");
  has(
    "the answer door reads the company off the opening, not the application",
    actions,
    "job_openings ( tenant_id )"
  );
  has(
    "the answer is conditional on the offer still being open",
    actions,
    '.eq("state", "SENT")'
  );
  has(
    "the answer is refused past the deadline in the same write",
    actions,
    '.gt("expires_at"'
  );
  has(
    "the answer reports losing the race rather than claiming success",
    actions,
    "select(\"id\")"
  );
  has(
    "an accepted answer is recorded on the trail",
    actions,
    'action: "offer_answered"'
  );
  has(
    "the trail says the candidate answered",
    actions,
    'actorKind: "CANDIDATE"'
  );
  has("the door offers both answers", door, 'decision: "accept"');
  has("the door offers decline", door, 'decision: "decline"');
  has("the door has its own public text", door, 't("offer.accept")');
  lacks(
    "the door lives outside the candidate portal",
    `${page}${actions}${layout}${door}`,
    "(candidate)"
  );
}

/* -------------------------------------------------------------------------- */
/* 9. The desk's panel and the copy                                         */
/* -------------------------------------------------------------------------- */

{
  const panel = read("src/app/(admin)/candidates/OfferPanel.tsx");
  const drawer = read("src/app/(admin)/candidates/ProfileDrawer.tsx");
  const notifications = read(
    "src/modules/omnichannel/application/candidate-notifications.ts"
  );
  const guide = read("src/modules/shell/domain/pageGuide.ts");
  const i18n = read("src/lib/i18n.ts");

  check("the offer panel exists", panel.length > 0, "OfferPanel.tsx");
  has("the panel offers the deadline in days", panel, "OFFER_DEFAULT_DAYS");
  has("the drawer renders the panel", drawer, "<OfferPanel");
  has(
    "the drawer only shows it at the offer stage",
    drawer,
    'candidate.stage === "OFFER"'
  );

  has("the offer notice reuses the offer-letter copy", notifications, '"offer_letter"');
  has(
    "the mailed text carries the link",
    notifications,
    "Open the offer to accept or decline it"
  );
  has(
    "the mailed text carries the deadline",
    notifications,
    "This link works until"
  );
  has(
    "the attached letter is the letter, not the email wrapper",
    notifications,
    "const offerText = ["
  );
  has(
    "the email is recorded in the outbox",
    notifications,
    "channel: \"EMAIL\""
  );

  has("the Guide describes issuing an offer", guide, "Offer panel");
  has("the Guide states the default deadline", guide, "An offer defaults to 7 days");
  has(
    "the Guide says an expired offer must be closed before a new one",
    guide,
    "including one past its deadline"
  );
  has(
    "the Guide says a declined offer can be followed by a new one",
    guide,
    "A declined offer can be followed by a new one"
  );

  has(
    "the panel lets an expired offer be closed",
    panel,
    'standing === "open" || standing === "expired"'
  );
  has(
    "the panel offers a new offer after a decline",
    panel,
    'standing === null || standing === "withdrawn" || standing === "declined"'
  );
  has(
    "the declined note names the fresh deadline",
    panel,
    "starts a fresh deadline"
  );

  const EN_KEYS = [
    "offer.title",
    "offer.intro",
    "offer.back",
    "offer.accept",
    "offer.decline",
    "offer.expired",
    "offer.answered",
    "offer.unreachable",
  ];
  for (const key of EN_KEYS) {
    has(`the English dictionary has ${key}`, i18n, `"${key}"`);
  }

  const arStart = i18n.indexOf("const ar: Dictionary");
  const arabic = arStart === -1 ? "" : i18n.slice(arStart);
  for (const key of EN_KEYS) {
    has(`the Arabic dictionary has ${key}`, arabic, `"${key}"`);
  }
}

/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (passed !== results.length) {
  for (const failure of results.filter((r) => !r.pass)) {
    console.log(`FAIL ${failure.name}${failure.detail ? `  [${failure.detail}]` : ""}`);
  }
  process.exitCode = 1;
}
