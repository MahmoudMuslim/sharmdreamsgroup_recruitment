/* scripts/prove-jarvis-presence.mjs
 * Run: node --experimental-strip-types scripts/prove-jarvis-presence.mjs
 * A check that throws names only its message; PROVE_STACK=1 prints its stack too.
 *
 * The presence slice's correctness boundary, over a module that imports nothing:
 * which queues may make the assistant speak and at what count, the quiet window
 * that wraps midnight, the crossing rule that keeps a queue silent once it has
 * been reported, what a briefing sounds like (three lines at most, most urgent
 * first, counts as words), the words that cut playback off, when a briefing is
 * due, and what a raw preferences row may and may not say. Then the migration
 * that stores those preferences: the columns, the defaults, and the own-row-only
 * policies that make "an administrator cannot arm somebody else's microphone"
 * a fact of the SQL rather than of a menu.
 *
 * Nothing here needs a database, a browser, a microphone or a model. The
 * mutation proofs at the foot each break a rule, re-run the check that must
 * notice, and restore the saved copy from `finally` and from `exit`/SIGINT/
 * SIGTERM, so a kill mid-run cannot leave the break on disk.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The five stubs the server half reaches for. `@/lib/data-api/server` is the one
// REST door the reader and the writer share, so a check decides what the table
// said — absent, unreadable, a row, nothing — without a database behind it.
const STUB_SOURCES = {
  "server-only": "export {};",
  "next/server": `
    export class NextResponse extends Response {
      static json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        });
      }
    }
  `,
  "@/lib/auth/session": `
    export const getSessionUser = () => globalThis.__jarvisUser ?? null;
    export const isStaff = (role) =>
      role === "SUPER_ADMIN" || role === "RECRUITER" || role === "HIRING_MANAGER";
  `,
  "@/lib/data-api/server": `
    export const createServerRestClient = async () => globalThis.__jarvisRest;
  `,
  "@/modules/activity/application/record": `
    export const recordActivity = async (entry) => {
      (globalThis.__jarvisTrail ??= []).push(entry);
    };
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
    if (STUB_URLS[specifier]) return { url: STUB_URLS[specifier], shortCircuit: true };
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
    if (process.env.PROVE_STACK) console.error(cause.stack);
    return { pass: false, detail: `threw: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

function expect(problems, label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const DOMAIN_REL = "src/modules/assistant/domain/jarvis.ts";
const MIGRATION_REL = "db/migrations/047_assistant_jarvis_prefs.sql";
const FEED_REL = "src/modules/shell/application/shell-actions.ts";
const SETTINGS_REL = "src/modules/assistant/application/jarvisSettings.ts";

const DOMAIN_URL = pathToFileURL(path.join(root, DOMAIN_REL)).href;
const SETTINGS_URL = pathToFileURL(path.join(root, SETTINGS_REL)).href;
// A fresh URL on every load, so a check reads the bytes now on disk: a monotonic
// counter, because two Date.now() calls in one millisecond would hand a mutated
// run the module imported before the mutation.
let loadCount = 0;
const load = (url) => import(`${url}?v=${(loadCount += 1)}`);

// The server half is proved against the stubs above, so every check starts from
// a clean room: no session, no table, no key, no trail left over by its
// neighbour. A check that forgets this inherits the previous one's identity, and
// an inherited identity is exactly the bug these checks exist to catch.
const GLOBAL_KEYS = [
  "__jarvisUser",
  "__jarvisRest",
  "__jarvisTrail",
];
function resetGlobals(patch = {}) {
  for (const key of GLOBAL_KEYS) delete globalThis[key];
  Object.assign(globalThis, patch);
}

/**
 * The one REST door the reader and the writer share, with every call recorded.
 *
 * `read` and `write` answer whatever the table is meant to do in a case: a row,
 * nothing, or the error code PostgREST gives a table that was never created.
 * `throwOn` breaks the door itself, which is how a check tells "the table is
 * absent" from "the table could not be reached".
 */
function fakeRest({ read = { data: null, error: null }, write = { error: null }, throwOn = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      const entry = { table };
      calls.push(entry);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (throwOn === "read") throw new Error("the read door blew up");
          entry.op = "read";
          return typeof read === "function" ? read(entry) : read;
        },
        upsert: async (payload, opts) => {
          entry.op = "upsert";
          entry.payload = payload;
          entry.opts = opts;
          if (throwOn === "write") throw new Error("the write door blew up");
          return typeof write === "function" ? write(entry) : write;
        },
      };
      return chain;
    },
  };
  return { client, calls };
}

/** The error shape a table that was never created answers with. */
const ABSENT = { code: "42P01", message: 'relation "public.assistant_jarvis_prefs" does not exist' };
const UNREADABLE = { code: "PGRST802", message: "connection reset by peer" };

// ---------------------------------------------------------------------------
// 1. The queues, and the feed that issues them
// ---------------------------------------------------------------------------
async function check1() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  const queues = jarvis.JARVIS_QUEUES;
  const ids = queues.map((rule) => rule.id);
  expect(problems, "the five ids", ids, [
    "failed-sends",
    "ungraded",
    "new-applications",
    "upcoming-interviews",
    "parked-jobs",
  ]);
  expect(problems, "unique ids", new Set(ids).size, ids.length);
  expect(problems, "unique ranks", new Set(queues.map((r) => r.rank)).size, ids.length);
  problems.push(
    ...queues
      .filter((rule) => !(Number.isInteger(rule.threshold) && rule.threshold >= 1))
      .map((rule) => `${rule.id}: threshold must be an integer of at least 1, got ${rule.threshold}`)
  );
  problems.push(
    ...queues
      .filter((rule) => typeof rule.spoken !== "string" || !rule.spoken.trim())
      .map((rule) => `${rule.id}: needs the words it is announced with`)
  );
  // The ids are not invented here: each must be a row the attention feed emits,
  // or the watcher would be watching a queue nobody counts.
  const feed = read(FEED_REL);
  problems.push(
    ...ids
      .filter((id) => !feed.includes(`id: "${id}"`))
      .map((id) => `${id} is not an alert the attention feed issues`)
  );
  expect(problems, "unknown rule", jarvis.queueRule("payroll"), null);
  expect(problems, "known rule id", jarvis.queueRule("ungraded")?.id, "ungraded");
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 2. A clock reading is minutes, or nothing
// ---------------------------------------------------------------------------
async function check2() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  expect(problems, "08:30", jarvis.readClock("08:30"), 510);
  expect(problems, "00:00", jarvis.readClock("00:00"), 0);
  expect(problems, "23:59", jarvis.readClock("23:59"), 1439);
  for (const bad of ["8:30", "24:00", "08:60", "0830", "abc", "", "08:3", "08:30 pm"]) {
    if (jarvis.readClock(bad) !== null) problems.push(`readClock(${JSON.stringify(bad)}) must be null`);
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 3. Quiet hours, including the window that wraps midnight
// ---------------------------------------------------------------------------
async function check3() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  // The ordinary case: 18:00 to 08:00 is quiet, the middle of the day is not.
  expect(problems, "evening inside", jarvis.withinQuietHours(19 * 60, "18:00", "08:00"), true);
  expect(problems, "deep night inside", jarvis.withinQuietHours(2 * 60, "18:00", "08:00"), true);
  expect(problems, "afternoon outside", jarvis.withinQuietHours(14 * 60, "18:00", "08:00"), false);
  // Start inclusive, end exclusive: the window's first minute is silent, its
  // last minute is the moment speech comes back.
  expect(problems, "start minute", jarvis.withinQuietHours(18 * 60, "18:00", "08:00"), true);
  expect(problems, "end minute", jarvis.withinQuietHours(8 * 60, "18:00", "08:00"), false);
  // A same-day window must not be read as a wrap.
  expect(problems, "same-day inside", jarvis.withinQuietHours(10 * 60, "09:00", "12:00"), true);
  expect(problems, "same-day outside", jarvis.withinQuietHours(13 * 60, "09:00", "12:00"), false);
  // Zero length is no window at all, not a window that swallows the day.
  expect(problems, "empty window", jarvis.withinQuietHours(10 * 60, "09:00", "09:00"), false);
  // An unreadable clock cannot justify silence.
  expect(problems, "bad start", jarvis.withinQuietHours(10 * 60, "9am", "12:00"), false);
  expect(problems, "bad end", jarvis.withinQuietHours(10 * 60, "09:00", "1260"), false);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 4. A crossing is news once
// ---------------------------------------------------------------------------
async function check4() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  const readings = [{ id: "ungraded", count: 9 }];
  // First sight is a baseline. A person who has never been briefed is not
  // interrupted by whatever the queue already held when they armed the watcher.
  expect(problems, "no baseline", jarvis.crossedQueues(null, readings), []);
  expect(problems, "unseen queue", jarvis.crossedQueues({}, readings), []);
  // At or below the threshold it stays silent however many times it is polled.
  const below = { "ungraded": 1 };
  expect(problems, "below", jarvis.crossedQueues(below, [{ id: "ungraded", count: 2 }]), []);
  expect(problems, "at threshold", jarvis.crossedQueues(below, [{ id: "ungraded", count: 5 }]), []);
  // The crossing itself, reported with the rule that made it news.
  const crossed = jarvis.crossedQueues(below, [{ id: "ungraded", count: 6 }]);
  expect(problems, "crossed once", crossed.map((c) => c.id), ["ungraded"]);
  expect(problems, "crossing carries the count", crossed[0]?.count, 6);
  expect(problems, "crossing carries the threshold", crossed[0]?.threshold, 5);
  // Staying above is not new news.
  expect(problems, "still above", jarvis.crossedQueues({ ungraded: 6 }, [{ id: "ungraded", count: 6 }]), []);
  expect(problems, "above again", jarvis.crossedQueues({ ungraded: 6 }, [{ id: "ungraded", count: 40 }]), []);
  // Draining below the threshold re-arms it: a queue that fills up again really
  // is news a second time.
  expect(problems, "re-crossed", jarvis.crossedQueues({ ungraded: 2 }, [{ id: "ungraded", count: 7 }]).map((c) => c.id), [
    "ungraded",
  ]);
  // An id the rules do not name is never spoken about, whatever the feed counts.
  expect(problems, "unknown id", jarvis.crossedQueues({ "some-new-thing": 0 }, [{ id: "some-new-thing", count: 99 }]), []);
  // Order follows the rules, not the feed: most urgent first.
  const many = jarvis.crossedQueues(
    { "failed-sends": 0, ungraded: 0, "new-applications": 0 },
    [
      { id: "new-applications", count: 9 },
      { id: "ungraded", count: 9 },
      { id: "failed-sends", count: 3 },
    ]
  );
  expect(problems, "urgency order", many.map((c) => c.id), ["failed-sends", "ungraded", "new-applications"]);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 5. Counts reach a synthesiser as words
// ---------------------------------------------------------------------------
async function check5() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  expect(problems, "zero", jarvis.countInWords(0), "zero");
  expect(problems, "twelve", jarvis.countInWords(12), "twelve");
  expect(problems, "twenty", jarvis.countInWords(20), "twenty");
  expect(problems, "twenty-one", jarvis.countInWords(21), "twenty-one");
  expect(problems, "ninety-nine", jarvis.countInWords(99), "ninety-nine");
  // Past a hundred a spoken number stops being useful; the digit is honest.
  expect(problems, "a hundred", jarvis.countInWords(100), "100");
  expect(problems, "negative is zero", jarvis.countInWords(-4), "zero");
  expect(problems, "fractional is floored", jarvis.countInWords(7.9), "seven");
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 6. A briefing is three lines at most, urgent thing first
// ---------------------------------------------------------------------------
async function check6() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  expect(problems, "nothing crossed", jarvis.briefingSentences([]), []);
  const crossed = (id, count) => {
    const rule = jarvis.queueRule(id);
    return { id, count, threshold: rule.threshold, spoken: rule.spoken, rank: rule.rank };
  };
  const two = jarvis.briefingSentences([crossed("ungraded", 6), crossed("failed-sends", 2)]);
  expect(problems, "two lines", two.length, 2);
  expect(problems, "counts as words, urgent first", two, [
    `two ${jarvis.queueRule("failed-sends").spoken}`,
    `six ${jarvis.queueRule("ungraded").spoken}`,
  ]);
  // More than three crossings still costs the listener three sentences.
  const five = jarvis.briefingSentences([
    crossed("failed-sends", 2),
    crossed("ungraded", 6),
    crossed("new-applications", 7),
    crossed("upcoming-interviews", 4),
    crossed("parked-jobs", 3),
  ]);
  expect(problems, "capped at three", five.length, 3);
  expect(problems, "cap keeps the urgent three", five, [
    `two ${jarvis.queueRule("failed-sends").spoken}`,
    `six ${jarvis.queueRule("ungraded").spoken}`,
    `seven ${jarvis.queueRule("new-applications").spoken}`,
  ]);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 7. The words that cut playback off, as whole words only
// ---------------------------------------------------------------------------
async function check7() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  for (const said of ["stop", "Stop.", "STOP", "jarvis stop", "be quiet", "quiet now", "اسكت", "توقف", "كفى"]) {
    if (!jarvis.isStopCommand(said)) problems.push(`"${said}" must stop playback`);
  }
  // A word that merely contains the command is not the command. This is the
  // mutation the whole-word rule exists to catch. The bare word `quiet` is
  // deliberately not a stopper: it is in the portal's own vocabulary ("quiet
  // hours"), so a briefing that says it must not cut its own playback off.
  for (const not of ["stopwatch", "quieten the room", "quoting", "quiet hours start now", "شكراً لك"]) {
    if (jarvis.isStopCommand(not)) problems.push(`"${not}" must not stop playback`);
  }
  // A stop word inside a longer sentence stops it: the rule is whole words, not
  // a whole utterance, because a person interrupts rather than finishes.
  expect(problems, "bare word inside a sentence", jarvis.isStopCommand("stop the clock is fine"), true);
  expect(problems, "quiet alone", jarvis.isStopCommand("quiet"), false);
  expect(problems, "empty", jarvis.isStopCommand(""), false);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 8. A briefing is due once a day, in the waking hours
// ---------------------------------------------------------------------------
async function check8() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  const at = (hour, minute = 0) => hour * 60 + minute;
  expect(
    problems,
    "due at the hour",
    jarvis.briefingDue({ lastGivenOn: null, today: "2026-10-28", nowMinutes: at(8), hour: 8, quiet: false }),
    true
  );
  expect(
    problems,
    "before the hour",
    jarvis.briefingDue({ lastGivenOn: null, today: "2026-10-28", nowMinutes: at(7, 59), hour: 8, quiet: false }),
    false
  );
  expect(
    problems,
    "already given today",
    jarvis.briefingDue({ lastGivenOn: "2026-10-28", today: "2026-10-28", nowMinutes: at(9), hour: 8, quiet: false }),
    false
  );
  expect(
    problems,
    "given yesterday",
    jarvis.briefingDue({ lastGivenOn: "2026-10-27", today: "2026-10-28", nowMinutes: at(9), hour: 8, quiet: false }),
    true
  );
  // Quiet hours defer the briefing rather than cancel it: asked at nine in the
  // evening, a briefing that would otherwise be due says nothing, and the
  // watcher asks again after the window closes. The window itself is check 3.
  expect(
    problems,
    "deferred by silence",
    jarvis.briefingDue({ lastGivenOn: null, today: "2026-10-28", nowMinutes: at(21), hour: 8, quiet: true }),
    false
  );
  expect(
    problems,
    "due once the silence lifts",
    jarvis.briefingDue({ lastGivenOn: null, today: "2026-10-28", nowMinutes: at(21), hour: 8, quiet: false }),
    true
  );
  // An hour that is not a number never speaks.
  expect(
    problems,
    "unreadable hour",
    jarvis.briefingDue({ lastGivenOn: null, today: "2026-10-28", nowMinutes: at(9), hour: null, quiet: false }),
    false
  );
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 9. A raw preferences row cannot widen its own reach
// ---------------------------------------------------------------------------
async function check9() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  expect(problems, "no row is everything off", jarvis.normalizeJarvisPrefs(null), jarvis.DEFAULT_JARVIS_PREFS);
  expect(problems, "defaults off", jarvis.DEFAULT_JARVIS_PREFS.ambient, false);
  expect(problems, "defaults not watching", jarvis.DEFAULT_JARVIS_PREFS.watching, false);
  expect(problems, "defaults no consent", jarvis.DEFAULT_JARVIS_PREFS.ambientConsentAt, null);

  const sane = jarvis.normalizeJarvisPrefs({
    profile_id: "00000000-0000-0000-0000-000000000000",
    ambient: true,
    ambient_consent_at: "2026-10-28T06:00:00.000Z",
    briefing: true,
    briefing_hour: 7,
    watching: true,
    watch_queues: ["ungraded", "failed-sends"],
    quiet_from: "20:00",
    quiet_to: "07:30",
  });
  expect(problems, "sane row keeps its hour", sane.briefingHour, 7);
  expect(problems, "sane row keeps its queues", sane.watchQueues, ["ungraded", "failed-sends"]);
  expect(problems, "sane row keeps its window", [sane.quietFrom, sane.quietTo], ["20:00", "07:30"]);

  // Every field that arrives outside its vocabulary falls back to the default,
  // so a hand-edited row cannot name a queue the watcher does not count or a
  // clock the reader cannot parse.
  const junk = jarvis.normalizeJarvisPrefs({
    ambient: "yes",
    ambient_consent_at: "tomorrow",
    briefing: 1,
    briefing_hour: 41,
    watching: true,
    watch_queues: ["ungraded", "payroll-access", "ungraded", 42, null],
    quiet_from: "9am",
    quiet_to: "1260",
  });
  expect(problems, "junk ambient", junk.ambient, false);
  expect(problems, "junk consent", junk.ambientConsentAt, null);
  expect(problems, "junk briefing", junk.briefing, false);
  expect(problems, "junk hour", junk.briefingHour, jarvis.DEFAULT_JARVIS_PREFS.briefingHour);
  expect(problems, "unknown queue dropped, duplicates folded", junk.watchQueues, ["ungraded"]);
  expect(problems, "junk window", [junk.quietFrom, junk.quietTo], [jarvis.DEFAULT_JARVIS_PREFS.quietFrom, jarvis.DEFAULT_JARVIS_PREFS.quietTo]);

  // An hour bound to the day.
  expect(problems, "hour clamped down", jarvis.normalizeJarvisPrefs({ briefing_hour: 99 }).briefingHour, jarvis.DEFAULT_JARVIS_PREFS.briefingHour);
  expect(problems, "hour 23 kept", jarvis.normalizeJarvisPrefs({ briefing_hour: 23 }).briefingHour, 23);
  // `canArmAmbient` is the door the client obeys: arming needs a consent stamp
  // that the server wrote, not a flag toggled beside it. The stamp is dated after
  // `AMBIENT_CONSENT_V2_AT` — a stale one is check 16's case, not this door's.
  expect(problems, "armed without consent", jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true }), false);
  expect(
    problems,
    "armed with consent",
    jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true, ambientConsentAt: "2026-10-29T06:00:00.000Z" }),
    true
  );
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 10. The migration the reader claims to read
// ---------------------------------------------------------------------------
async function check10() {
  const problems = [];
  const sql = read(MIGRATION_REL);
  const one = (text) => (text.test(sql) ? [] : [text.source]);
  problems.push(
    ...one(/create table if not exists public\.assistant_jarvis_prefs\b/i),
    ...one(/profile_id uuid primary key references public\.user_profiles \(id\) on delete cascade/i),
    ...one(/\bambient boolean not null default false/i),
    ...one(/\bambient_consent_at timestamptz\b/i),
    ...one(/\bbriefing boolean not null default false/i),
    ...one(/\bbriefing_hour smallint not null default 8\b[\s\S]{0,80}between 0 and 23/i),
    ...one(/\bwatching boolean not null default false/i),
    ...one(/\bwatch_queues text\[\] not null default '\{\}'/i),
    ...one(/\bquiet_from text not null default '18:00'/i),
    ...one(/\bquiet_to text not null default '08:00'/i),
    ...one(/alter table public\.assistant_jarvis_prefs enable row level security/i),
    // The own-row claim is a fact of the SQL: every policy names the caller's
    // own profile, staff-only, and no policy lets one person touch another.
    ...one(/create policy assistant_jarvis_prefs_own_read[\s\S]{0,200}current_user_profile_id\(\)\) = profile_id and is_staff\(\)/i),
    ...one(/create policy assistant_jarvis_prefs_own_insert[\s\S]{0,200}current_user_profile_id\(\)\) = profile_id and is_staff\(\)/i),
    ...one(/create policy assistant_jarvis_prefs_own_update[\s\S]{0,300}current_user_profile_id\(\)\) = profile_id and is_staff\(\)/i)
  );
  // No delete: a person turns a thing off, they do not erase the record that
  // they chose it.
  if (/create policy .*assistant_jarvis_prefs.*\n\s*for delete/i.test(sql)) {
    problems.push("the prefs table must carry no delete policy");
  }
  if (/grant[^;]*delete[^;]*assistant_jarvis_prefs/i.test(sql)) {
    problems.push("the prefs table must not grant delete to authenticated");
  }
  // The file is authored, not applied: the claim in the header must stay true
  // until the owner says otherwise, because the panel repeats it.
  if (!/STATUS: authored here, NOT applied/i.test(sql)) {
    problems.push("047's header no longer states that it is unapplied");
  }
  if (!/notify pgrst, 'reload schema';/i.test(sql)) {
    problems.push("047 must reload the PostgREST schema cache");
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 11. What a draft may write, and what only the server may write
// ---------------------------------------------------------------------------
async function check11() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  const {
    jarvisRowToSave,
    prefsToRow,
    normalizeJarvisPrefs,
    DEFAULT_JARVIS_PREFS,
    JARVIS_PREF_COLUMNS,
    canArmAmbient,
  } = jarvis;
  const columns = [...JARVIS_PREF_COLUMNS].sort();
  const noConsent = { given: false, stamp: "" };
  const save = (draft, previous = DEFAULT_JARVIS_PREFS, consent = noConsent) =>
    jarvisRowToSave(draft, previous, consent);
  const prefs = (row) => normalizeJarvisPrefs(row);

  // The row is the table's columns and nothing else: no `profile_id` a draft
  // could point at another person, no `updated_at` the browser could date, no
  // invented column the write would then have to refuse.
  expect(problems, "exactly the table's own columns", Object.keys(save({})).sort(), columns);
  expect(
    problems,
    "a row that names another profile does not carry it",
    Object.keys(save({ profile_id: "deadbeef-0000-0000-0000-000000000000", id: 7, updated_at: "2020-01-01" })).sort(),
    columns
  );
  // A prefs value survives the trip through the row's own shape, or the merge
  // would silently reset whatever it could not name.
  const merged = prefs(save({ briefing: true, briefing_hour: 6, watch_queues: ["ungraded"] }));
  expect(problems, "round trip", prefs(prefsToRow(merged)), merged);

  // The microphone is the one switch that needs more than a value.
  expect(problems, "arming without a stamp is refused", save({ ambient: true }).ambient, false);
  expect(
    problems,
    "arming with a stamp the server cannot read is refused",
    prefs(save({ ambient: true }, DEFAULT_JARVIS_PREFS, { given: true, stamp: "tomorrow" })).ambientConsentAt,
    null
  );
  expect(
    problems,
    "a consent word that is not a boolean does not arm",
    save({ ambient: true }, DEFAULT_JARVIS_PREFS, { given: "yes", stamp: "2026-10-28T06:00:00.000Z" }).ambient,
    false
  );
  const armed = prefs(save({ ambient: true }, DEFAULT_JARVIS_PREFS, { given: true, stamp: "2026-10-29T06:00:00.000Z" }));
  expect(problems, "consent heard by the server arms", [armed.ambient, armed.ambientConsentAt], [
    true,
    "2026-10-29T06:00:00.000Z",
  ]);
  expect(problems, "the armed row passes the arm door", canArmAmbient(armed), true);

  // Consent is one-time: a stored stamp is that same agreement, not a new one,
  // and switching off must not erase the record that it was given. The stamps are
  // dated after `AMBIENT_CONSENT_V2_AT`, because a retired one is check 16's case.
  const once = { ...DEFAULT_JARVIS_PREFS, ambient: true, ambientConsentAt: "2026-10-29T09:00:00.000Z" };
  const rearmed = prefs(save({ ambient: true }, once));
  expect(problems, "re-arming keeps the stamp already on the row", [rearmed.ambient, rearmed.ambientConsentAt], [
    true,
    "2026-10-29T09:00:00.000Z",
  ]);
  expect(
    problems,
    "a fresh stamp refreshes it",
    prefs(save({ ambient: true }, once, { given: true, stamp: "2026-10-30T06:00:00.000Z" })).ambientConsentAt,
    "2026-10-30T06:00:00.000Z"
  );
  const off = prefs(save({ ambient: false }, once));
  expect(problems, "off keeps the consent record", [off.ambient, off.ambientConsentAt], [
    false,
    "2026-10-29T09:00:00.000Z",
  ]);

  // A stamp the browser invents is not consent, and must not be written into the
  // row for the server to mistake for the real one later: the microphone stays
  // off, with no stamp on it either way. The forged stamp is dated after the
  // cutoff on purpose — a retired one would go quiet for the wrong reason and
  // the mutation that leaks an unmapped draft key into the row would pass.
  const forged = prefs(save({ ambient: true, ambient_consent_at: "2026-10-29T12:00:00.000Z" }));
  expect(problems, "a draft's own consent stamp does not arm", [forged.ambient, forged.ambientConsentAt], [
    false,
    null,
  ]);

  // Every ceiling a hand-edited row already faced applies to a draft, and the
  // safe direction is silence: an unknown queue names nothing.
  const widened = prefs(
    save(
      {
        ambient: "yes",
        briefing_hour: 41,
        quiet_from: "9am",
        quiet_to: "1260",
        watch_queues: ["payroll-access", "ungraded", "ungraded"],
      },
      { ...DEFAULT_JARVIS_PREFS, briefingHour: 7, quietFrom: "20:00", quietTo: "07:00" }
    )
  );
  expect(problems, "a string is not a switch", widened.ambient, false);
  expect(problems, "an hour outside the day keeps the stored one", widened.briefingHour, 7);
  expect(problems, "an unreadable clock falls back to the row's own window", [widened.quietFrom, widened.quietTo], [
    "20:00",
    "07:00",
  ]);
  expect(problems, "an unknown queue names nothing", widened.watchQueues, ["ungraded"]);

  // The safe direction is the person's own value, never a default nobody chose:
  // a garbled field must not move a quiet window, reset an hour, or flip off a
  // microphone that was already agreed to.
  const garbled = prefs(
    save(
      { ambient: "yes", briefing_hour: 99, quiet_from: "9am", quiet_to: "evening" },
      { ...once, briefingHour: 7, quietFrom: "20:00", quietTo: "07:00" }
    )
  );
  expect(problems, "a string switch does not reset a stored one", garbled.ambient, true);
  expect(problems, "an impossible hour does not reset a stored one", garbled.briefingHour, 7);
  expect(problems, "an unreadable clock does not reset a stored one", [garbled.quietFrom, garbled.quietTo], [
    "20:00",
    "07:00",
  ]);

  // A draft that names nothing changes nothing: every value stays the server's.
  expect(problems, "an empty draft keeps the stored choice", prefs(save({}, once)), once);
  // The trail sentence says what moved and nothing more — it cannot claim a
  // switch flipped, and never names the consent stamp, which is a fact about when
  // a person heard an explanation rather than a setting anybody changes.
  expect(problems, "a change is named by what it did", jarvis.summarizeJarvisChange(DEFAULT_JARVIS_PREFS, prefs(save({ briefing: true }, DEFAULT_JARVIS_PREFS))), "Assistant presence: morning briefing on");
  expect(problems, "and a save that moved nothing claims nothing", jarvis.summarizeJarvisChange(once, once), "Assistant presence settings saved");
  expect(problems, "never the consent stamp", /consent/i.test(jarvis.summarizeJarvisChange(DEFAULT_JARVIS_PREFS, armed)), false);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 12. The reader, and the two failures it must not confuse
// ---------------------------------------------------------------------------
async function check12() {
  const jarvis = await load(DOMAIN_URL);
  const settings = await load(SETTINGS_URL);
  const problems = [];

  const absent = fakeRest({ read: { error: ABSENT } });
  resetGlobals({ __jarvisRest: absent.client });
  expect(
    problems,
    "an unapplied 047 reads as everything off and names itself",
    await settings.readJarvisPrefs("staff-1"),
    { prefs: jarvis.DEFAULT_JARVIS_PREFS, stored: false, problem: "absent" }
  );
  expect(problems, "the read is on the prefs table", absent.calls.map((c) => c.table), ["assistant_jarvis_prefs"]);

  resetGlobals({ __jarvisRest: fakeRest({ read: { error: UNREADABLE } }).client });
  expect(
    problems,
    "an outage is a different answer from an unapplied file",
    await settings.readJarvisPrefs("staff-1"),
    { prefs: jarvis.DEFAULT_JARVIS_PREFS, stored: false, problem: "unreadable" }
  );

  resetGlobals({ __jarvisRest: fakeRest({ read: { data: null, error: null } }).client });
  expect(problems, "no row is not a problem", await settings.readJarvisPrefs("staff-1"), {
    prefs: jarvis.DEFAULT_JARVIS_PREFS,
    stored: false,
    problem: null,
  });

  const row = {
    profile_id: "staff-1",
    ambient: true,
    ambient_consent_at: "2026-10-28T06:00:00.000Z",
    briefing: true,
    briefing_hour: 7,
    watching: true,
    watch_queues: ["ungraded"],
    quiet_from: "20:00",
    quiet_to: "07:00",
  };
  resetGlobals({ __jarvisRest: fakeRest({ read: { data: row, error: null } }).client });
  const stored = await settings.readJarvisPrefs("staff-1");
  expect(problems, "a row is a choice", [stored.stored, stored.problem], [true, null]);
  expect(problems, "a row reaches the presence whole", stored.prefs, jarvis.normalizeJarvisPrefs(row));

  // A door that blew up entirely still answers the safe state: the orb renders,
  // it just does not listen or speak.
  resetGlobals({ __jarvisRest: fakeRest({ throwOn: "read" }).client });
  expect(
    problems,
    "a throwing read answers off rather than failing the page",
    await settings.readJarvisPrefs("staff-1"),
    { prefs: jarvis.DEFAULT_JARVIS_PREFS, stored: false, problem: "unreadable" }
  );

  // The same read as the presence's own viewer door — the shape the orb's first
  // paint and the console receive. A person who is not signed in never reaches the
  // table, and a failure is named rather than answered as a state nobody chose.
  const noSessionRest = fakeRest({ read: { data: null, error: null } });
  resetGlobals({ __jarvisRest: noSessionRest.client });
  expect(
    problems,
    "a signed-out viewer is refused before the table is read",
    [await settings.jarvisPresenceForViewer(), noSessionRest.calls.length],
    [{ reason: "no-session", message: "Sign in to use the assistant presence." }, 0]
  );

  const viewerAbsent = fakeRest({ read: { error: ABSENT } });
  resetGlobals({ __jarvisUser: { profileId: "staff-1" }, __jarvisRest: viewerAbsent.client });
  const notApplied = await settings.jarvisPresenceForViewer();
  expect(problems, "an unapplied table is named, not hidden", notApplied.reason, "absent-table");
  expect(problems, "and the person is told which file creates it", /047_assistant_jarvis_prefs/.test(notApplied.message), true);

  const viewerUnreadable = fakeRest({ read: { error: UNREADABLE } });
  resetGlobals({ __jarvisUser: { profileId: "staff-1" }, __jarvisRest: viewerUnreadable.client });
  const outage = await settings.jarvisPresenceForViewer();
  expect(problems, "an outage is not reported as an unapplied file", outage.reason, "unreadable");
  expect(problems, "and does not name a migration", /047|migration/.test(outage.message), false);

  resetGlobals({
    __jarvisUser: { profileId: "staff-1" },
    __jarvisRest: fakeRest({ read: { data: row, error: null } }).client,
  });
  expect(
    problems,
    "a reader that works hands the orb the person's own choice",
    await settings.jarvisPresenceForViewer(),
    jarvis.normalizeJarvisPrefs(row)
  );

  // No administrator's grant is consulted: a person's own switch is the only door.
  if (/hasPermissionForUser/.test(read(SETTINGS_REL))) {
    problems.push("the prefs reader must not gate a person's own switch behind a grant");
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 13. The writer: its own row, trailed, and honest about a table that is not there
// ---------------------------------------------------------------------------
async function check13() {
  const jarvis = await load(DOMAIN_URL);
  const settings = await load(SETTINGS_URL);
  const problems = [];
  const columns = [...jarvis.JARVIS_PREF_COLUMNS];
  const staff = { profileId: "staff-1", role: "RECRUITER" };

  const nowhere = fakeRest();
  resetGlobals({ __jarvisRest: nowhere.client });
  const signedOut = await settings.saveJarvisPrefs({ briefing: true });
  expect(problems, "no session, no write", [signedOut.ok, nowhere.calls, globalThis.__jarvisTrail], [
    false,
    [],
    undefined,
  ]);
  expect(problems, "the refusal says who may write", /sign in/i.test(signedOut.error), true);

  const absentWrite = fakeRest({ write: { error: ABSENT } });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: absentWrite.client });
  const unapplied = await settings.saveJarvisPrefs({ briefing: true });
  expect(problems, "an unapplied table is refused", unapplied.ok, false);
  expect(problems, "and named by its file", /047_assistant_jarvis_prefs\.sql/.test(unapplied.error), true);
  expect(problems, "no trail for a write that never happened", globalThis.__jarvisTrail, undefined);

  const good = fakeRest();
  resetGlobals({ __jarvisUser: staff, __jarvisRest: good.client });
  const saved = await settings.saveJarvisPrefs(
    { briefing: true, briefingHour: 7, watchQueues: ["ungraded"], ambient: true },
    { consentGiven: true }
  );
  expect(problems, "a good write answers the whole row", [saved.ok, saved.prefs.briefingHour], [true, 7]);
  const write = good.calls.find((call) => call.op === "upsert");
  expect(problems, "written through the prefs table", write?.table, "assistant_jarvis_prefs");
  expect(problems, "one row per person", write?.opts, { onConflict: "profile_id" });
  expect(
    problems,
    "the row is the columns plus the session's identity and the clock",
    Object.keys(write.payload).sort(),
    [...columns, "profile_id", "updated_at"].sort()
  );
  expect(problems, "the row is the caller's own", write.payload.profile_id, "staff-1");
  expect(problems, "the switch on the row is on", write.payload.briefing, true);
  expect(problems, "the hour on the row is the one asked for", write.payload.briefing_hour, 7);
  expect(problems, "the stamp is the server's clock", Number.isNaN(Date.parse(write.payload.ambient_consent_at)), false);
  expect(problems, "the update is dated", Number.isNaN(Date.parse(write.payload.updated_at)), false);
  const trail = globalThis.__jarvisTrail ?? [];
  expect(problems, "one trail row", trail.length, 1);
  expect(problems, "the trail names the setting", {
    area: trail[0]?.area,
    action: trail[0]?.action,
    entity: trail[0]?.entity,
    entityId: trail[0]?.entityId,
    actorId: trail[0]?.actorId,
  }, {
    area: "settings",
    action: "jarvis_prefs_changed",
    entity: "setting",
    entityId: "jarvis_presence",
    actorId: "staff-1",
  });
  expect(problems, "the trail carries both sides", [
    trail[0]?.detail?.from?.briefing,
    trail[0]?.detail?.to?.briefing,
  ], [false, true]);
  // The sentence names the switch that moved, so the trail is searchable by what
  // changed, and it never invents a change that did not happen.
  expect(problems, "the trail names what moved", /briefing on/.test(trail[0]?.summary ?? ""), true);
  expect(problems, "and does not name a switch that stayed", /watching/.test(trail[0]?.summary ?? ""), false);

  // A draft cannot point the row at somebody else, and a switch flipped without
  // the audio explanation is written as off rather than refused outright.
  const hijack = fakeRest();
  resetGlobals({ __jarvisUser: staff, __jarvisRest: hijack.client });
  const claimed = await settings.saveJarvisPrefs({
    profile_id: "deadbeef-0000-0000-0000-000000000000",
    ambient: true,
    ambient_consent_at: "2020-01-01T00:00:00.000Z",
    briefing_hour: 99,
  });
  expect(problems, "the claim is accepted as a switch off", claimed.ok, true);
  const hijacked = hijack.calls.find((call) => call.op === "upsert")?.payload;
  expect(problems, "the row is still the caller's", hijacked.profile_id, "staff-1");
  expect(problems, "the microphone stays off", hijacked.ambient, false);
  expect(problems, "no stamp the browser invented", hijacked.ambient_consent_at, null);
  expect(problems, "an impossible hour is not stored", hijacked.briefing_hour, jarvis.DEFAULT_JARVIS_PREFS.briefingHour);

  // A failure that is not an absent table says what happened, and trails nothing.
  const refusedWrite = fakeRest({ write: { error: { code: "PGRST301", message: "row-level security" } } });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: refusedWrite.client });
  const blocked = await settings.saveJarvisPrefs({ briefing: true });
  expect(problems, "a refused write is a refusal", blocked.ok, false);
  expect(problems, "named as it was answered", /row-level security/.test(blocked.error), true);
  expect(problems, "and not trailed", globalThis.__jarvisTrail, undefined);

  // The previous state is read for the trail, not for permission: a read that
  // blows up cannot cost a person their own settings change.
  const blindRead = fakeRest({ throwOn: "read" });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: blindRead.client });
  const afterBlindRead = await settings.saveJarvisPrefs({ briefing: true });
  expect(problems, "an unreadable previous state still saves", afterBlindRead.ok, true);
  expect(problems, "with the safe pair in the trail", [
    globalThis.__jarvisTrail[0]?.detail?.from?.briefing,
    globalThis.__jarvisTrail[0]?.detail?.to?.briefing,
  ], [false, true]);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 14. The wake phrase is a field of the row, with the same ceiling as the code
// ---------------------------------------------------------------------------
async function check14() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];

  // A row that names no phrase is the default, not an empty match.
  expect(problems, "no column is the default", jarvis.DEFAULT_JARVIS_PREFS.wakePhrase, null);
  expect(problems, "a bare row reads null", jarvis.normalizeJarvisPrefs({}).wakePhrase, null);
  expect(problems, "a row's phrase survives", jarvis.normalizeJarvisPrefs({ wake_phrase: "يا Jarvis" }).wakePhrase, "يا Jarvis");
  // 48 is MAX_WAKE_PHRASE_CHARS written here as SQL-shaped refusal; over it is not a phrase.
  const long = "a".repeat(jarvis.MAX_WAKE_PHRASE_LEN + 1);
  expect(problems, "a row longer than the ceiling reads null", jarvis.normalizeJarvisPrefs({ wake_phrase: long }).wakePhrase, null);
  expect(problems, "a blank row value reads null", jarvis.normalizeJarvisPrefs({ wake_phrase: "   " }).wakePhrase, null);
  expect(problems, "a non-string row value reads null", jarvis.normalizeJarvisPrefs({ wake_phrase: 42 }).wakePhrase, null);

  // The column travels with the eight places every other field travels through.
  expect(problems, "the column list carries wake_phrase", jarvis.JARVIS_PREF_COLUMNS.includes("wake_phrase"), true);
  const draft = jarvis.normalizeJarvisPrefs(jarvis.jarvisRowToSave({ wakePhrase: "ابدأ" }, jarvis.DEFAULT_JARVIS_PREFS, { given: false, stamp: "" }));
  expect(problems, "a draft phrase is stored", draft.wakePhrase, "ابدأ");
  // Refused, not defaulted: an over-long draft leaves the stored phrase where it was.
  const refused = jarvis.normalizeJarvisPrefs(
    jarvis.jarvisRowToSave({ wakePhrase: long }, { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "يا Jarvis" }, { given: false, stamp: "" })
  );
  expect(problems, "an over-long draft keeps the stored phrase", refused.wakePhrase, "يا Jarvis");
  // A cleared field is a real request: null, which *is* the default.
  const cleared = jarvis.normalizeJarvisPrefs(
    jarvis.jarvisRowToSave({ wakePhrase: "   " }, { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "يا Jarvis" }, { given: false, stamp: "" })
  );
  expect(problems, "a cleared field falls back to the default", cleared.wakePhrase, null);
  // The row the writer sends carries the column and nothing wider.
  const row = jarvis.jarvisRowToSave({ wakePhrase: "يا Jarvis" }, jarvis.DEFAULT_JARVIS_PREFS, { given: false, stamp: "" });
  expect(problems, "the saved row's columns", Object.keys(row).sort(), [...jarvis.JARVIS_PREF_COLUMNS].sort());

  // The trail names the phrase it moved and never copies the row into a summary.
  const said = jarvis.summarizeJarvisChange(
    { ...jarvis.DEFAULT_JARVIS_PREFS },
    { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "يا Jarvis" }
  );
  problems.push(...(said.includes("wake phrase") ? [] : [`the trail never names the wake phrase: ${said}`]));
  problems.push(...(said.includes("يا Jarvis") ? [] : [`the trail names the phrase without quoting the row: ${said}`]));
  const untouched = jarvis.summarizeJarvisChange(
    { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "Hey Jarvis" },
    { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "Hey Jarvis" }
  );
  problems.push(...(untouched.includes("wake phrase") ? ["the trail names a switch that did not move"] : []));
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 15. The ceiling in this module is the ceiling in voice.ts, in words
// ---------------------------------------------------------------------------
async function check15() {
  const jarvis = await load(DOMAIN_URL);
  const voice = await load(pathToFileURL(path.join(root, "src/modules/assistant/domain/voice.ts")).href);
  const problems = [];
  // jarvis.ts imports nothing, so the 48 is duplicated on purpose — and a proof is
  // the only thing that keeps the two copies from drifting apart.
  expect(problems, "the two ceilings agree", jarvis.MAX_WAKE_PHRASE_LEN, voice.MAX_WAKE_PHRASE_CHARS);
  expect(problems, "the default phrase matches", jarvis.DEFAULT_WAKE_PHRASE_TEXT, voice.DEFAULT_WAKE_PHRASE);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 16. A stamp taken under the browser-vendor wording does not carry over
// ---------------------------------------------------------------------------
async function check16() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  const old = new Date(Date.parse(jarvis.AMBIENT_CONSENT_V2_AT) - 86_400_000).toISOString();
  const fresh = new Date(Date.parse(jarvis.AMBIENT_CONSENT_V2_AT) + 86_400_000).toISOString();
  expect(problems, "an older stamp is refused", jarvis.consentCarriesOver(old), false);
  expect(problems, "a stamp at the cutoff carries", jarvis.consentCarriesOver(jarvis.AMBIENT_CONSENT_V2_AT), true);
  expect(problems, "a newer stamp carries", jarvis.consentCarriesOver(fresh), true);
  expect(problems, "no stamp carries nothing", jarvis.consentCarriesOver(null), false);
  expect(problems, "a garbled stamp carries nothing", jarvis.consentCarriesOver("last tuesday"), false);

  // The armed microphone obeys the cutoff, so an existing row goes quiet on its own.
  expect(
    problems,
    "an old stamp no longer arms",
    jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true, ambientConsentAt: old }),
    false
  );
  expect(
    problems,
    "a fresh stamp still arms",
    jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true, ambientConsentAt: fresh }),
    true
  );
  // A save that does not bring a new acknowledgement cannot revive a stale stamp.
  const revived = jarvis.normalizeJarvisPrefs(
    jarvis.jarvisRowToSave({ ambient: true }, { ...jarvis.DEFAULT_JARVIS_PREFS, ambient: false, ambientConsentAt: old }, { given: false, stamp: "" })
  );
  expect(problems, "a stale stamp is not re-armed by a switch flip", revived.ambient, false);
  return verdict(problems);
}

const CHECKS = [
  ["1. The five queues are the ones the attention feed issues, ranked and thresholded", check1],
  ["2. A clock reading is minutes past midnight, or nothing at all", check2],
  ["3. The quiet window wraps midnight, starts inclusive, ends exclusive", check3],
  ["4. A queue crossing its threshold is news once, and only once", check4],
  ["5. Counts reach a synthesiser as words up to ninety-nine", check5],
  ["6. A briefing is three sentences at most, most urgent first", check6],
  ["7. Stop words cut playback as whole words, English and Arabic", check7],
  ["8. A briefing is due once a day, after its hour, outside quiet hours", check8],
  ["9. A raw preferences row cannot widen its own reach", check9],
  ["10. Migration 047 is the table the reader claims, with own-row policies and no delete", check10],
  ["11. A draft row carries the table's columns, the server's stamp, and no wider reach than a stored row", check11],
  ["12. The reader tells an unapplied table from an outage, and never asks a grant for a person's own switch", check12],
  ["13. The writer saves its own row, trails it, and refuses to claim a table that is not applied", check13],
  ["14. The wake phrase is a stored field that refuses what it cannot express", check14],
  ["15. The phrase ceiling in jarvis.ts is the ceiling in voice.ts", check15],
  ["16. A consent stamp taken under the browser-vendor wording does not carry over", check16],
];

for (const [name, run] of CHECKS) {
  results.push([name, await safe(run)]);
}

// ---------------------------------------------------------------------------
// Mutation proofs
// ---------------------------------------------------------------------------

const checkIsRed = async (number) => {
  const outcome = await safe(CHECKS[number - 1][1]);
  const threw = String(outcome.detail ?? "").startsWith("threw:");
  if (threw) return { pass: false, detail: outcome.detail };
  if (outcome.pass) return { pass: false, detail: "check stayed green" };
  return { pass: true, detail: outcome.detail };
};

async function mutation(label, rel, needle, replacement, verify) {
  const file = path.join(root, rel);
  let original = null;
  const restore = () => {
    if (original === null) return;
    try {
      writeFileSync(file, original);
    } catch {
      // Nothing left to write to; the next run's read will report the damage.
    }
    original = null;
  };
  const onSignal = () => {
    restore();
    process.exit(1);
  };
  try {
    // Read inside the `try`, so a missing target is a red mutation, not a crash
    // before any results print.
    original = readFileSync(file, "utf8");
    // The repository's SQL carries CRLF and its TypeScript LF, so a multi-line
    // needle is matched in whichever form the file actually holds, and the
    // replacement is written back in that same form.
    const forms = [needle, needle.replace(/\n/g, "\r\n")];
    const matched = forms.find((form) => original.includes(form));
    if (!matched) {
      mutations.push({ label, pass: false, detail: `needle not found in ${rel}` });
      return;
    }
    const asMatched = matched === needle ? replacement : replacement.replace(/\n/g, "\r\n");
    const mutated = original.replace(matched, () => asMatched);
    process.once("exit", restore);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    writeFileSync(file, mutated);
    mutations.push({ label, ...(await verify()) });
  } catch (cause) {
    mutations.push({ label, pass: false, detail: `threw: ${cause.message}` });
  } finally {
    process.off("exit", restore);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    restore();
  }
}

await mutation(
  "1. A quiet window that wraps midnight read as a same-day range → check 3 red",
  DOMAIN_REL,
  "  if (from < to) return nowMinutes >= from && nowMinutes < to;\n  return nowMinutes >= from || nowMinutes < to;",
  "  return nowMinutes >= from && nowMinutes < to;",
  async () => checkIsRed(3)
);

await mutation(
  "2. The window's end minute stays quiet → check 3 red",
  DOMAIN_REL,
  "  if (from === to) return false;\n  if (from < to)",
  "  if (from === to) return true;\n  if (from <= to)",
  async () => checkIsRed(3)
);

await mutation(
  "3. An unreadable clock treated as a zero-hour start → check 3 red",
  DOMAIN_REL,
  "  if (from === null || to === null) return false;",
  "  if (from === null || to === null) return true;",
  async () => checkIsRed(3)
);

await mutation(
  "4. A queue polled below its threshold still crossing → check 4 red",
  DOMAIN_REL,
  "    if (reading.count <= rule.threshold) continue;",
  "    if (reading.count < rule.threshold) continue;",
  async () => checkIsRed(4)
);

await mutation(
  "5. A queue already above its threshold crossing again → check 4 red",
  DOMAIN_REL,
  "    if (before === undefined || before > rule.threshold) continue;",
  "    if (before === undefined) continue;",
  async () => checkIsRed(4)
);

await mutation(
  "6. A queue the last poll did not hold treated as a crossing → check 4 red",
  DOMAIN_REL,
  "    if (before === undefined || before > rule.threshold) continue;",
  "    if (before !== undefined && before > rule.threshold) continue;",
  async () => checkIsRed(4)
);

await mutation(
  "7. A queue the rules do not name spoken about → check 4 red",
  DOMAIN_REL,
  "    const rule = queueRule(reading.id);\n    if (!rule) continue;",
  "    const rule = { id: reading.id, spoken: reading.id, rank: 99, threshold: 0 };\n    if (!rule) continue;",
  async () => checkIsRed(4)
);

await mutation(
  "8. Twenty-one spoken as two digits → check 5 red",
  DOMAIN_REL,
  "  return `${TENS[tens]}-${ONES[rest]}`;",
  "  return `${tens * 10}${rest}`;",
  async () => checkIsRed(5)
);

await mutation(
  "9. A briefing allowed to run past three sentences → check 6 red",
  DOMAIN_REL,
  "  return ordered.slice(0, BRIEFING_MAX_LINES).map(",
  "  return ordered.map(",
  async () => checkIsRed(6)
);

await mutation(
  "10. A briefing ordered by count, not by which queue is worst → check 6 red",
  DOMAIN_REL,
  "  const ordered = [...crossings].sort((a, b) => a.rank - b.rank);",
  "  const ordered = [...crossings].sort((a, b) => b.count - a.count);",
  async () => checkIsRed(6)
);

await mutation(
  "11. Stop matched as a substring → check 7 red",
  DOMAIN_REL,
  "  return tokens.some((token) => STOP_WORDS.has(token)) || STOP_PHRASES.some((phrase) => text.includes(phrase));",
  '  return STOP_WORDS.has(text) || ["stop", "quiet"].some((word) => text.includes(word));',
  async () => checkIsRed(7)
);

await mutation(
  "12. Arabic stop words dropped → check 7 red",
  DOMAIN_REL,
  '  "توقف",\n  "اسكت",\n  "كفى",\n  "كفي",\n  "اقف",\n  "أقف",\n',
  "",
  async () => checkIsRed(7)
);

await mutation(
  "13. A briefing repeats itself the same day → check 8 red",
  DOMAIN_REL,
  "  if (lastGivenOn === today) return false;",
  "  if (lastGivenOn && lastGivenOn < today) return false;",
  async () => checkIsRed(8)
);

await mutation(
  "14. Quiet hours cancelling the deferred briefing instead of delaying it → check 8 red",
  DOMAIN_REL,
  "  if (quiet) return false;",
  "  void quiet;",
  async () => checkIsRed(8)
);

await mutation(
  "15. A watch_queues entry outside the vocabulary kept → check 9 red",
  DOMAIN_REL,
  "    watchQueues: uniqueKnownQueues(row.watch_queues),",
  "    watchQueues: Array.isArray(row.watch_queues) ? row.watch_queues.map(String) : [],",
  async () => checkIsRed(9)
);

await mutation(
  "16. An out-of-range briefing hour accepted → check 9 red",
  DOMAIN_REL,
  "    briefingHour: clampHour(row.briefing_hour),",
  "    briefingHour: Number.isFinite(row.briefing_hour) ? row.briefing_hour : 8,",
  async () => checkIsRed(9)
);

await mutation(
  "17. A boolean read from a truthy string → check 9 red",
  DOMAIN_REL,
  "    ambient: flag(row.ambient, DEFAULT_JARVIS_PREFS.ambient),",
  "    ambient: Boolean(row.ambient),",
  async () => checkIsRed(9)
);

await mutation(
  "18. Ambient armable without the server's consent stamp → check 9 red",
  DOMAIN_REL,
  "  return prefs.ambient === true && consentCarriesOver(prefs.ambientConsentAt);",
  "  return prefs.ambient === true;",
  async () => checkIsRed(9)
);

await mutation(
  "19. The reader's own-row claim unpinned from the SQL → check 10 red",
  MIGRATION_REL,
  "create policy assistant_jarvis_prefs_own_read on public.assistant_jarvis_prefs\n  for select to authenticated\n  using ((select current_user_profile_id()) = profile_id and is_staff());",
  "create policy assistant_jarvis_prefs_own_read on public.assistant_jarvis_prefs\n  for select to authenticated\n  using (is_staff());",
  async () => checkIsRed(10)
);

await mutation(
  "20. RLS switched off in the file the panel calls own-row-only → check 10 red",
  MIGRATION_REL,
  "alter table public.assistant_jarvis_prefs enable row level security;",
  "alter table public.assistant_jarvis_prefs disable row level security;",
  async () => checkIsRed(10)
);

await mutation(
  "21. Crossings left in the feed's order, not the portal's urgency → check 4 red",
  DOMAIN_REL,
  "  return out.sort((a, b) => a.rank - b.rank);",
  "  return out;",
  async () => checkIsRed(4)
);

// The draft merge: what a hand-edited or buggy panel is allowed to write.

await mutation(
  "22. A draft key the table does not know copied into the row verbatim → check 11 red",
  DOMAIN_REL,
  "    if (!column) continue;",
  "    if (!column) {\n      merged[key] = draft[key];\n      continue;\n    }",
  async () => checkIsRed(11)
);

await mutation(
  "23. The briefing hour's upper bound dropped → check 11 red",
  DOMAIN_REL,
  "      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23",
  "      return Number.isInteger(value) && (value as number) >= 0",
  async () => checkIsRed(11)
);

await mutation(
  "24. An unreadable quiet-hour start written as it arrived → check 11 red",
  DOMAIN_REL,
  "    case \"quiet_from\":\n      return readClock(value) === null ? previous.quietFrom : value;",
  "    case \"quiet_from\":\n      return value;",
  async () => checkIsRed(11)
);

await mutation(
  "25. A microphone armed without the server's stamp left on → check 11 red",
  DOMAIN_REL,
  "    else if (!consentCarriesOver(next.ambientConsentAt)) {",
  "    else if (false) {",
  async () => checkIsRed(11)
);

// The reader, the viewer door and the writer, and the things only they can get wrong.

await mutation(
  "26. An outage reported as an unapplied migration → check 12 red",
  SETTINGS_REL,
  "      console.error(\"[jarvis-prefs] read failed:\", error.message ?? \"unknown\");\n      return { prefs: DEFAULT_JARVIS_PREFS, stored: false, problem: \"unreadable\" };",
  "      console.error(\"[jarvis-prefs] read failed:\", error.message ?? \"unknown\");\n      return { prefs: DEFAULT_JARVIS_PREFS, stored: false, problem: \"absent\" };",
  async () => checkIsRed(12)
);

// The viewer door the orb's first paint and the console both stand behind.

await mutation(
  "27. A table that is not applied answered as a set of choices → check 12 red",
  SETTINGS_REL,
  '  if (state.problem === "absent") return { reason: "absent-table", message: MIGRATION_SENTENCE };',
  "  if (state.problem === \"absent\") return state.prefs;",
  async () => checkIsRed(12)
);

await mutation(
  "28. A signed-out viewer reaching the table as an anonymous profile → check 12 red",
  SETTINGS_REL,
  '  if (!user) return { reason: "no-session", message: "Sign in to use the assistant presence." };\n  const state = await readJarvisPrefs(user.profileId);',
  '  const state = await readJarvisPrefs(user?.profileId ?? "");',
  async () => checkIsRed(12)
);

await mutation(
  "29. An unapplied table reported as a database refusal → check 13 red",
  SETTINGS_REL,
  "    if (absent(error)) return { ok: false, error: MIGRATION_SENTENCE };",
  "    if (absent(error)) return { ok: false, error: \"That setting could not be saved.\" };",
  async () => checkIsRed(13)
);

await mutation(
  "30. A save that writes the profile the draft names → check 13 red",
  SETTINGS_REL,
  "    .upsert({ ...row, profile_id: user.profileId, updated_at: new Date().toISOString() }, {",
  "    .upsert({ ...row, profile_id: (draft.profile_id as string) ?? user.profileId, updated_at: new Date().toISOString() }, {",
  async () => checkIsRed(13)
);

await mutation(
  "31. A microphone armed by the browser's own claim → check 13 red",
  SETTINGS_REL,
  "    given: consent.consentGiven === true,",
  "    given: draft.ambient === true,",
  async () => checkIsRed(13)
);

await mutation(
  "32. A trail sentence that names nothing about the change → check 13 red",
  SETTINGS_REL,
  "    summary: summarizeJarvisChange(previous, prefs),",
  "    summary: \"Assistant presence settings saved\",",
  async () => checkIsRed(13)
);

await mutation(
  "33. The trail filed under another setting's action → check 13 red",
  SETTINGS_REL,
  "    action: \"jarvis_prefs_changed\",",
  "    action: \"voice_autonomy_changed\",",
  async () => checkIsRed(13)
);

await mutation(
  "34. A wake phrase over the ceiling silently reset to the default → check 14 red",
  DOMAIN_REL,
  '      return value === null || (typeof value === "string" && value.trim() === "") ? null : wakePhraseValue(value) ?? previous.wakePhrase;',
  "      return wakePhraseValue(value);",
  async () => checkIsRed(14)
);

await mutation(
  "35. A trail sentence that never quotes the chosen phrase → check 14 red",
  DOMAIN_REL,
  '        : `wake phrase “${next.wakePhrase}”`',
  '        : "wake phrase"',
  async () => checkIsRed(14)
);

await mutation(
  "36. The two ceilings drifting apart → check 15 red",
  DOMAIN_REL,
  "export const MAX_WAKE_PHRASE_LEN = 48;",
  "export const MAX_WAKE_PHRASE_LEN = 47;",
  async () => checkIsRed(15)
);

await mutation(
  "37. A stamp taken under the old wording still arming → check 16 red",
  DOMAIN_REL,
  "  return prefs.ambient === true && consentCarriesOver(prefs.ambientConsentAt);",
  "  return prefs.ambient === true && typeof prefs.ambientConsentAt === \"string\" && prefs.ambientConsentAt.length > 0;",
  async () => checkIsRed(16)
);

await mutation(
  "38. A switch flip reviving a retired stamp → check 16 red",
  DOMAIN_REL,
  "    else if (!consentCarriesOver(next.ambientConsentAt)) {",
  "    else if (next.ambientConsentAt === null) {",
  async () => checkIsRed(16)
);

const failed = results.filter(([, outcome]) => !outcome.pass);
console.log("");
for (const [name, outcome] of results) {
  console.log(`${outcome.pass ? "PASS" : "FAIL"}  ${name}`);
  if (!outcome.pass) console.log(`      ${outcome.detail}`);
}
for (const entry of mutations) {
  console.log(`${entry.pass ? "PASS" : "FAIL"}  ${entry.label}`);
  if (entry.detail) console.log(`      ${entry.detail}`);
}
console.log("");
console.log(
  `${results.length - failed.length}/${results.length} checks held, ${mutations.filter((m) => m.pass).length}/${mutations.length} mutations turned red.`
);
process.exitCode = failed.length === 0 && mutations.every((m) => m.pass) ? 0 : 1;
