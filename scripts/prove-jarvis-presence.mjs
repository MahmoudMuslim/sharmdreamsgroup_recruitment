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

// The domain module imports nothing, so only `@/` needs resolving. `server-only`
// is stubbed because the application half that grows beside it does import it.
const STUB_SOURCES = {
  "server-only": "export {};",
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

const DOMAIN_URL = pathToFileURL(path.join(root, DOMAIN_REL)).href;
// A fresh URL on every load, so a check reads the bytes now on disk: a monotonic
// counter, because two Date.now() calls in one millisecond would hand a mutated
// run the module imported before the mutation.
let loadCount = 0;
const load = (url) => import(`${url}?v=${(loadCount += 1)}`);

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
    voice: "jarvis",
    neural_voice: false,
  });
  expect(problems, "sane row keeps its hour", sane.briefingHour, 7);
  expect(problems, "sane row keeps its queues", sane.watchQueues, ["ungraded", "failed-sends"]);
  expect(problems, "sane row keeps its window", [sane.quietFrom, sane.quietTo], ["20:00", "07:30"]);
  expect(problems, "sane row keeps device voice", sane.neuralVoice, false);

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
    voice: 3_402,
    neural_voice: "true",
  });
  expect(problems, "junk ambient", junk.ambient, false);
  expect(problems, "junk consent", junk.ambientConsentAt, null);
  expect(problems, "junk briefing", junk.briefing, false);
  expect(problems, "junk hour", junk.briefingHour, jarvis.DEFAULT_JARVIS_PREFS.briefingHour);
  expect(problems, "unknown queue dropped, duplicates folded", junk.watchQueues, ["ungraded"]);
  expect(problems, "junk window", [junk.quietFrom, junk.quietTo], [jarvis.DEFAULT_JARVIS_PREFS.quietFrom, jarvis.DEFAULT_JARVIS_PREFS.quietTo]);
  expect(problems, "junk voice", junk.voice, jarvis.DEFAULT_JARVIS_PREFS.voice);
  expect(problems, "junk neural", junk.neuralVoice, jarvis.DEFAULT_JARVIS_PREFS.neuralVoice);

  // An hour bound to the day, and a name bound to what it may hold.
  expect(problems, "hour clamped down", jarvis.normalizeJarvisPrefs({ briefing_hour: 99 }).briefingHour, jarvis.DEFAULT_JARVIS_PREFS.briefingHour);
  expect(problems, "hour 23 kept", jarvis.normalizeJarvisPrefs({ briefing_hour: 23 }).briefingHour, 23);
  expect(problems, "long voice name cut", jarvis.normalizeJarvisPrefs({ voice: "x".repeat(80) }).voice.length <= 48, true);
  // `canArmAmbient` is the door the client obeys: arming needs a consent stamp
  // that the server wrote, not a flag toggled beside it.
  expect(problems, "armed without consent", jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true }), false);
  expect(
    problems,
    "armed with consent",
    jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true, ambientConsentAt: "2026-10-28T06:00:00.000Z" }),
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
    ...one(/\bvoice text not null default 'jarvis'/i),
    ...one(/\bneural_voice boolean not null default true/i),
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
  "  return prefs.ambient === true && typeof prefs.ambientConsentAt === \"string\" && prefs.ambientConsentAt.length > 0;",
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
