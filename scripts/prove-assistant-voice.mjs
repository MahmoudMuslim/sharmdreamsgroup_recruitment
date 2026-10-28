/* scripts/prove-assistant-voice.mjs
 * Run: node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs
 * A check that throws names only its message; PROVE_STACK=1 prints its stack too.
 *
 * Nothing here needs a database, a browser, a microphone or a model. What is
 * pinned is the voice slice's correctness boundary: the wake phrase's match and
 * its remainder, Arabic normalisation, the spoken verdict and the code it must
 * carry, what a markdown answer sounds like, which language is spoken — then the
 * approval card's single-use code, and the transcription route's refusals
 * (401/413/415/429) with an 8 MB body accepted up to the provider call.
 *
 * The mutation proofs at the foot are real edits: each breaks a file, re-runs the
 * check that must notice, and restores the saved copy in a `finally` — and from
 * `exit`/`SIGINT`/`SIGTERM` too, so a kill mid-run cannot leave the break on disk.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// `@/` alias, extensionless siblings, and the stubs the proof owns. approvals.ts
// imports the real tool registry for one value; that registry reaches every
// server action in the portal, so it is stubbed here. Later tasks add stubs for
// the route's session and transcription seams.
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
    export const getSessionUser = () => globalThis.__voiceUser ?? null;
    export const isStaff = (role) =>
      role === "SUPER_ADMIN" || role === "RECRUITER" || role === "HIRING_MANAGER";
  `,
  "@/modules/screening/infrastructure/aiGateway": `
    export class RecordingNotTranscribableError extends Error {}
    export const transcribeRecording = async (bytes, mimeType) => {
      (globalThis.__voiceCalls ??= []).push({ bytes: bytes.byteLength, mimeType });
      if (globalThis.__voiceRefuse) throw new RecordingNotTranscribableError(globalThis.__voiceRefuse);
      if (globalThis.__voiceFail) throw new Error(globalThis.__voiceFail);
      return globalThis.__voiceTranscript ?? "which openings have no applicants";
    };
  `,
};
const STUB_URLS = Object.fromEntries(
  Object.entries(STUB_SOURCES).map(([specifier, source]) => [
    specifier,
    `data:text/javascript,${encodeURIComponent(source)}`,
  ])
);
const TOOLS_PATH = path.join(root, "src/modules/assistant/domain/tools");
const TOOLS_STUB = `data:text/javascript,${encodeURIComponent(
  "export const READ_ONLY_TOOLS = ['list_jobs'];"
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUB_URLS[specifier]) return { url: STUB_URLS[specifier], shortCircuit: true };
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
        ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
        : null;
    if (base === TOOLS_PATH || base === `${TOOLS_PATH}.ts`) {
      return { url: TOOLS_STUB, shortCircuit: true };
    }
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

const VOICE_URL = pathToFileURL(
  path.join(root, "src/modules/assistant/domain/voice.ts")
).href;
// A fresh URL on every load, so a check reads the bytes now on disk. The counter
// is monotonic on purpose: two Date.now() calls in the same millisecond would
// hand a mutated run the module imported before the mutation, and the mutation
// proof would pass without ever loading the broken rule.
let loadCount = 0;
const load = (url) => import(`${url}?v=${(loadCount += 1)}`);

// ---------------------------------------------------------------------------
// 1. Wake phrase: matched at the start, stripped, never mid-sentence
// ---------------------------------------------------------------------------
async function check1() {
  const voice = await load(VOICE_URL);
  const problems = [];
  expect(problems, "phrase alone", voice.matchWakePhrase("Hey Jarvis", "Hey Jarvis"), {
    matched: true,
    remainder: "",
  });
  expect(problems, "phrase then comma", voice.matchWakePhrase("Hey Jarvis, who is waiting today", "Hey Jarvis"), {
    matched: true,
    remainder: "who is waiting today",
  });
  expect(problems, "mid-sentence", voice.matchWakePhrase("please hey jarvis show jobs", "Hey Jarvis"), {
    matched: false,
    remainder: "please hey jarvis show jobs",
  });
  expect(problems, "partial word", voice.matchWakePhrase("hey jarvisx", "Hey Jarvis"), {
    matched: false,
    remainder: "hey jarvisx",
  });
  expect(problems, "empty phrase", voice.matchWakePhrase("hello", ""), {
    matched: false,
    remainder: "hello",
  });
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 2. Arabic: harakat, tatweel, alef forms, a phrase written in Arabic
// ---------------------------------------------------------------------------
async function check2() {
  const voice = await load(VOICE_URL);
  const problems = [];
  expect(
    problems,
    "arabic phrase with harakat on both sides",
    voice.matchWakePhrase("يا جارفيـس، من ينتظر اليوم؟", "يا جارفيـس"),
    { matched: true, remainder: "من ينتظر اليوم" }
  );
  // A recogniser picks a hamza or a maqsura form freely. The phrase is written
  // one way and the transcript the other, so the alef folds carry the match.
  expect(
    problems,
    "harakat in the phrase only",
    voice.matchWakePhrase("يا جارفيس من ينتظر", "يا جارفي\u0650س"),
    { matched: true, remainder: "من ينتظر" }
  );
  expect(
    problems,
    "hamza alef in the phrase, bare alef in the transcript",
    voice.matchWakePhrase("يا استاذ من ينتظر اليوم", "يا أستاذ"),
    { matched: true, remainder: "من ينتظر اليوم" }
  );
  expect(
    problems,
    "alef maqsura in the phrase, yeh in the transcript",
    voice.matchWakePhrase("يا مصطفي من ينتظر اليوم", "يا مصطفى"),
    { matched: true, remainder: "من ينتظر اليوم" }
  );
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 3. The spoken verdict: cancel wins; a code in play must be said
// ---------------------------------------------------------------------------
async function check3() {
  const voice = await load(VOICE_URL);
  const problems = [];
  expect(problems, "plain approve", voice.spokenApproval("yes, approve it", null), "approve");
  expect(problems, "plain cancel", voice.spokenApproval("no, cancel", null), "cancel");
  expect(problems, "cancel wins", voice.spokenApproval("approve — no wait, cancel", null), "cancel");
  expect(problems, "code required, absent", voice.spokenApproval("approve it", "K7Q2"), null);
  expect(problems, "code required, present", voice.spokenApproval("approve k7q2", "K7Q2"), "approve");
  expect(problems, "code required, cancel carries it", voice.spokenApproval("cancel K-7-Q-2", "K7Q2"), "cancel");
  // An Arabic transcript writes the code's digits in Arabic-Indic form. The
  // digits must survive normalisation or hands-free approval is impossible.
  expect(problems, "code said in arabic-indic digits", voice.spokenApproval("نعم موافق K٧Q٢", "K7Q2"), "approve");
  expect(problems, "arabic-indic digits, one digit wrong", voice.spokenApproval("نعم موافق K٧Q٣", "K7Q2"), null);
  expect(problems, "no verdict", voice.spokenApproval("how is the pipeline", null), null);
  expect(problems, "arabic approve", voice.spokenApproval("نعم موافق", null), "approve");
  expect(problems, "arabic cancel", voice.spokenApproval("لا إلغاء", null), "cancel");
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 4. The code alphabet: four characters, no 0/O/1/I, normalised comparison
// ---------------------------------------------------------------------------
async function check4() {
  const voice = await load(VOICE_URL);
  const problems = [];
  // Mint across the whole input range, one bucket per alphabet position. A
  // single fixed value only ever produced "9999", so no letter path ran and a
  // broken alphabet stayed green.
  const BUCKETS = 32;
  const randoms = [() => 0, () => 1];
  for (let index = 0; index < BUCKETS; index += 1) {
    randoms.push(() => (index + 0.5) / BUCKETS);
  }
  const codes = randoms.map((random) => voice.mintSpokenCode(random));
  for (const code of codes) {
    if (code.length !== 4) problems.push(`length: expected 4, got ${JSON.stringify(code)}`);
  }
  const produced = [...new Set(codes.join(""))].sort().join("");
  if (produced.length !== BUCKETS) {
    problems.push(`alphabet sweep covered ${produced.length} of ${BUCKETS} characters: ${produced}`);
  }
  if (/[0O1I]/.test(produced)) problems.push(`alphabet holds a confusable: ${produced}`);
  if (!/[A-Z]/.test(produced)) problems.push(`alphabet has no letters: ${produced}`);
  if (!/[0-9]/.test(produced)) problems.push(`alphabet has no digits: ${produced}`);
  if (!/^[A-Z0-9]+$/.test(produced)) problems.push(`alphabet is not upper-case letters and digits: ${produced}`);

  expect(problems, "normalise lower", voice.normalizeSpokenCode("k7q2"), "K7Q2");
  expect(problems, "normalise spaced", voice.normalizeSpokenCode(" K-7-Q-2 "), "K7Q2");
  expect(problems, "normalise arabic-indic digits", voice.normalizeSpokenCode("K٧Q٢"), "K7Q2");
  expect(problems, "normalise eastern arabic digits", voice.normalizeSpokenCode("K۷Q۲"), "K7Q2");
  if (voice.normalizeSpokenCode("K٧Q٢") !== voice.normalizeSpokenCode("K7Q2")) {
    problems.push("arabic-indic digits do not normalise onto the ascii code");
  }
  if (voice.normalizeSpokenCode("K٧Q٣") === voice.normalizeSpokenCode("K7Q2")) {
    problems.push("a genuinely wrong code matched: K٧Q٣ normalised onto K7Q2");
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 5. What an answer sounds like: markup stripped, table named, nothing cut
// ---------------------------------------------------------------------------
async function check5() {
  const voice = await load(VOICE_URL);
  const problems = [];
  const spoken = voice.spokenSummary(
    "**Approved — update_application_stage ran.**\n\n| Name | Stage |\n|---|---|\n| Aisha | Interview |\n\nSee [her record](/candidates/123)."
  );
  if (spoken.includes("**") || spoken.includes("|") || spoken.includes("](")) {
    problems.push(`markup survived: ${spoken}`);
  }
  if (!spoken.includes("Approved — update_application_stage ran.")) problems.push("emphasis text lost");
  if (!spoken.includes("her record")) problems.push("link label lost");
  if (!/table is on screen/i.test(spoken)) problems.push("table not named");
  if (!/code is on screen/i.test(voice.spokenSummary("```js\nx()\n```"))) problems.push("fence not named");

  // The whole answer is handed to the voice. A summary cut at a character count was
  // half of "JARVIS stops before it finishes": the person heard part of a sentence
  // they could see all of, and then heard the assistant say the rest was on screen.
  const long = `${"A sentence that keeps going. ".repeat(40)}FINAL`;
  const full = voice.spokenSummary(long);
  if (!full.endsWith("FINAL")) problems.push(`answer cut short: it ends ${JSON.stringify(full.slice(-40))}`);
  if ("SPOKEN_SUMMARY_CHARS" in voice) problems.push("the character cap on a spoken answer is back");

  // Chunking is how the whole answer reaches the device: in pieces it can hold, with
  // every word in the order it was written. The join is the test — a lost sentence
  // makes it short, a piece broken inside a word makes it longer.
  expect(problems, "nothing to say is nothing to queue", voice.chunkForSpeech("   \n  "), []);
  const pieces = voice.chunkForSpeech(full);
  if (pieces.length < 2) problems.push(`a ${full.length}-character answer queued as one piece`);
  if (pieces.join(" ") !== full) problems.push("chunking lost or invented words");
  for (const piece of pieces) {
    if (piece.length > voice.SPOKEN_CHUNK_CHARS) problems.push(`piece over the limit: ${piece.length}`);
  }
  expect(problems, "the tail is in the last piece", pieces[pieces.length - 1].endsWith("FINAL"), true);
  expect(problems, "the piece size", voice.SPOKEN_CHUNK_CHARS, 600);

  // One sentence longer than a piece is broken between words, never inside one.
  const runOn = Array.from({ length: 300 }, (unused, index) => `word${index}`).join(" ");
  const broken = voice.chunkForSpeech(runOn);
  if (broken.join(" ") !== runOn) problems.push("breaking a long sentence lost or split a word");
  if (broken.length < 2) problems.push("a sentence past the limit was not broken");
  for (const piece of broken) {
    if (piece.length > voice.SPOKEN_CHUNK_CHARS) problems.push(`long-sentence piece over the limit: ${piece.length}`);
  }

  // Sentences are the unit, so the packing never cuts one in half — and an Arabic
  // question mark ends a sentence like a Latin full stop does.
  const arabic = voice.chunkForSpeech("من ينتظر اليوم؟ إنه في المقابلة.", 20);
  expect(problems, "arabic sentence boundary", arabic.length, 2);
  if (arabic.length === 2 && !arabic[0].endsWith("؟")) problems.push(`arabic sentence split: ${arabic[0]}`);

  // The rate a person sets. The device takes 0.1 to 10; the portal offers a slower-
  // to-double range and nothing outside it, however it arrived, is passed through.
  expect(problems, "rate default", voice.DEFAULT_SPEECH_RATE, 1);
  expect(problems, "rate floor", voice.SPEECH_RATE_MIN, 0.6);
  expect(problems, "rate ceiling", voice.SPEECH_RATE_MAX, 2);
  expect(problems, "rate kept", voice.normaliseSpeechRate(1.4), 1.4);
  expect(problems, "rate from a stored string", voice.normaliseSpeechRate("1.5"), 1.5);
  expect(problems, "rate below the floor", voice.normaliseSpeechRate(0.1), voice.SPEECH_RATE_MIN);
  expect(problems, "rate above the ceiling", voice.normaliseSpeechRate(20), voice.SPEECH_RATE_MAX);
  expect(problems, "rate not a number", voice.normaliseSpeechRate("fast"), voice.DEFAULT_SPEECH_RATE);
  expect(problems, "rate rounded to a tenth", voice.normaliseSpeechRate(1.04), 1);
  // A store with nothing in it answers null, and Number(null) is a finite 0, which
  // would otherwise be read as "the slowest pace" rather than "no pace chosen".
  expect(problems, "rate when nothing is stored", voice.normaliseSpeechRate(null), voice.DEFAULT_SPEECH_RATE);
  expect(problems, "rate from an empty store", voice.normaliseSpeechRate(""), voice.DEFAULT_SPEECH_RATE);

  // Which voice reads it. The person's own choice wins while the machine still has
  // it; a choice carried from another computer simply stops matching and the
  // language decides again.
  const device = [
    { voiceURI: "Google العربية", lang: "ar-SA" },
    { voiceURI: "Microsoft David Desktop", lang: "en-US" },
    { voiceURI: "Samantha", lang: "en-GB" },
  ];
  expect(
    problems,
    "a chosen voice wins over the language",
    voice.pickDeviceVoice(device, "Microsoft David Desktop", "ar")?.voiceURI,
    "Microsoft David Desktop"
  );
  expect(
    problems,
    "a choice this machine does not have falls back to the language",
    voice.pickDeviceVoice(device, "Zira", "ar")?.voiceURI,
    "Google العربية"
  );
  expect(
    problems,
    "no choice leaves the language to decide",
    voice.pickDeviceVoice(device, "", "en")?.voiceURI,
    "Microsoft David Desktop"
  );
  expect(problems, "no choice and no language", voice.pickDeviceVoice(device, "", null), null);
  expect(problems, "a machine with no voices", voice.pickDeviceVoice([], "Zira", "en"), null);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 6. The language being spoken
// ---------------------------------------------------------------------------
async function check6() {
  const voice = await load(VOICE_URL);
  const problems = [];
  expect(problems, "arabic", voice.speechLanguageOf("من ينتظر اليوم؟"), "ar");
  expect(problems, "english", voice.speechLanguageOf("Who is waiting today?"), "en");
  expect(problems, "mixed, arabic majority", voice.speechLanguageOf("المرشح Aisha في مرحلة المقابلة"), "ar");
  expect(problems, "no letters", voice.speechLanguageOf("123 — ?"), null);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 7. Migration 046: the table, its one CHECK, its own-row policies
// ---------------------------------------------------------------------------
const MIGRATION_046 = "db/migrations/046_assistant_voice_autonomy.sql";
const squash = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function check7() {
  const problems = [];
  const sql = squash(read(MIGRATION_046)).toLowerCase();
  for (const needle of [
    "create table if not exists public.assistant_voice_autonomy",
    "profile_id uuid primary key references public.user_profiles (id) on delete cascade",
    "check (mode in ('confirm', 'code', 'open'))",
    "alter table public.assistant_voice_autonomy enable row level security",
    "assistant_voice_autonomy_own_read",
    "assistant_voice_autonomy_own_insert",
    "assistant_voice_autonomy_own_update",
    "current_user_profile_id()",
    "grant select, insert, update on table public.assistant_voice_autonomy to authenticated",
    "revoke all on table public.assistant_voice_autonomy from anon",
    "notify pgrst, 'reload schema'",
    // The second fence: RLS may only store `open` for a grant holder, on the
    // insert and on the update. Without this the database says "your row" and
    // nothing about "this value".
    "mode <> 'open' or has_permission('settings.manage_platform')",
    // The timestamp trigger and the table comment the sibling migrations carry.
    "trg_assistant_voice_autonomy_updated before update on public.assistant_voice_autonomy",
    "comment on table public.assistant_voice_autonomy is",
  ]) {
    if (!sql.includes(needle)) problems.push(`046 is missing: ${needle}`);
  }
  if (
    !/create policy assistant_voice_autonomy_own_update on public\.assistant_voice_autonomy for update to authenticated using \([^;]*is_staff\(\)/.test(
      sql
    )
  ) {
    problems.push("046's update policy does not fence own-row writes with is_staff()");
  }
  // A column arrives either in the create table or in a later alter; both store
  // audio and both must fail. Anchored to a column declaration so a word in a
  // comment cannot satisfy it by accident.
  const STORES_AUDIO =
    /\b(?:create|alter) table\b[^;]*\baudio\w*\s+(?:uuid|text|bytea|jsonb|json|timestamptz|timestamp|boolean|smallint|integer|int|bigint|numeric|real|double|date|time)\b/;
  if (STORES_AUDIO.test(sql)) problems.push("046 stores audio");

  const settings = read("src/modules/assistant/application/voiceSettings.ts");
  for (const needle of [
    "046_assistant_voice_autonomy.sql",
    'problem: "absent"',
    'problem: "unreadable"',
    "stored: false, canOpen, problem: null",
    "stored: true, canOpen, problem: null",
    "effectiveAutonomy(",
  ]) {
    if (!settings.includes(needle)) problems.push(`voiceSettings is missing: ${needle}`);
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 8. Autonomy: a stored `open` without the grant is only ever `confirm`
// ---------------------------------------------------------------------------
async function check8() {
  const voice = await load(VOICE_URL);
  const problems = [];
  // The demotion is the whole rule: losing the grant must cost the hands-free
  // behaviour, not merely hide the option from the menu.
  expect(problems, "open, grant revoked", voice.effectiveAutonomy("open", false), "confirm");
  expect(problems, "open, grant held", voice.effectiveAutonomy("open", true), "open");
  // The other two levels never depended on the grant, and must not start to.
  expect(problems, "code, grant revoked", voice.effectiveAutonomy("code", false), "code");
  expect(problems, "code, grant held", voice.effectiveAutonomy("code", true), "code");
  expect(problems, "confirm, grant revoked", voice.effectiveAutonomy("confirm", false), "confirm");
  expect(problems, "confirm, grant held", voice.effectiveAutonomy("confirm", true), "confirm");
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 9. A code-mode card carries a code; a wrong code does not consume it
// ---------------------------------------------------------------------------
const APPROVALS_URL = pathToFileURL(
  path.join(root, "src/modules/assistant/domain/approvals.ts")
).href;
const tool = { name: "update_application_stage", label: "Move a stage", description: "Move it" };

async function check9() {
  const approvals = await load(APPROVALS_URL);
  const problems = [];

  const open = approvals.mintApproval(tool, { id: "a" }, "p1", "confirm");
  expect(problems, "confirm carries no code", open.code ?? null, null);
  expect(problems, "confirm names its level", open.autonomy, "confirm");

  const coded = approvals.mintApproval(tool, { id: "a" }, "p1", "code");
  if (!coded.code) problems.push("code mode minted no code");
  expect(problems, "code names its level", coded.autonomy, "code");
  expect(problems, "wrong code", approvals.checkApprovalCode(coded.id, "p1", "ZZZZ"), "mismatch");
  expect(
    problems,
    "wrong code left the card live",
    approvals.checkApprovalCode(coded.id, "p1", coded.code),
    "ok"
  );
  expect(problems, "missing code", approvals.checkApprovalCode(coded.id, "p1", null), "mismatch");
  expect(problems, "another person's id", approvals.checkApprovalCode(coded.id, "p2", coded.code), "missing");

  // `open` also carries no code, so the level is the only thing that tells the
  // console this card may run on a spoken yes; without it the browser would have
  // to treat every code-less card as waiting for a click.
  const handsFree = approvals.mintApproval(tool, { id: "a" }, "p1", "open");
  expect(problems, "open carries no code", handsFree.code ?? null, null);
  expect(problems, "open names its level", handsFree.autonomy, "open");

  // A wrong code must not burn the single-use card.
  approvals.checkApprovalCode(coded.id, "p1", "ZZZZ");
  const taken = approvals.takeApproval(coded.id, "p1");
  if (!taken) problems.push("the card was consumed by a wrong code");
  expect(problems, "second take", approvals.takeApproval(coded.id, "p1"), null);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 10. The transcription route: 401, 413, 415, 429, and 8 MB accepted
// ---------------------------------------------------------------------------
const ROUTE_URL = pathToFileURL(
  path.join(root, "src/app/api/assistant/voice/route.ts")
).href;

function clip(type = "audio/webm", bytes = 32) {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array(bytes)], "clip.webm", { type }));
  return form;
}

async function callRoute({ form = clip(), headers = {} } = {}) {
  const route = await load(ROUTE_URL);
  const request = new Request("http://localhost/api/assistant/voice", {
    method: "POST",
    body: form,
    headers,
  });
  const response = await route.POST(request);
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

const STAFF = { profileId: "p1", role: "RECRUITER" };

async function check10() {
  const problems = [];
  globalThis.__voiceTranscript = undefined;
  // A fresh import per single-shot call: the 429 window lives in the module, so
  // each check below starts under budget. The loops further down are the places
  // that must not re-import, and each imports once on purpose.
  const call = async (options) => {
    globalThis.__voiceCalls = [];
    globalThis.__voiceRefuse = null;
    globalThis.__voiceFail = null;
    return callRoute(options);
  };

  globalThis.__voiceUser = null;
  expect(problems, "anonymous", (await call()).status, 401);
  // The declared-length refusal sits behind the staff gate, as the sibling
  // upload door's comment explains: an anonymous body hears 401, not 413.
  expect(
    problems,
    "anonymous oversize is a 401",
    (await call({ headers: { "content-length": String(9 * 1024 * 1024) } })).status,
    401
  );

  // A signed-in candidate is not staff: the door must refuse before the file is
  // read, not transcribe a candidate's clip on a candidate's own session.
  globalThis.__voiceUser = { profileId: "p-applicant", role: "CANDIDATE" };
  expect(problems, "candidate role", (await call()).status, 401);
  expect(problems, "candidate role reached no provider", globalThis.__voiceCalls.length, 0);

  globalThis.__voiceUser = STAFF;
  expect(problems, "not an audio type", (await call({ form: clip("text/plain") })).status, 415);
  expect(problems, "safari mp4", (await call({ form: clip("audio/mp4") })).status, 415);
  // A zero-byte part is refused as missing, before it can reach the provider and
  // come back as a failure to answer.
  expect(problems, "empty clip", (await call({ form: clip("audio/webm", 0) })).status, 400);
  expect(problems, "empty clip reached no provider", globalThis.__voiceCalls.length, 0);
  expect(
    problems,
    "oversize declared",
    (await call({ headers: { "content-length": String(9 * 1024 * 1024) } })).status,
    413
  );

  // The authoritative check: a client that declares a small length and sends
  // 9 MB anyway. The declared-length door cannot see it; only `recording.size` can.
  const smuggled = await call({
    form: clip("audio/webm", 9 * 1024 * 1024),
    headers: { "content-length": "512" },
  });
  expect(problems, "9 MB behind a small declared length", smuggled.status, 413);
  expect(problems, "9 MB reached no provider", globalThis.__voiceCalls.length, 0);

  const ok = await call({ form: clip("audio/webm;codecs=opus") });
  expect(problems, "ok status", ok.status, 200);
  expect(problems, "ok body", ok.body, { text: "which openings have no applicants" });
  expect(problems, "codec dropped before the provider", globalThis.__voiceCalls[0]?.mimeType, "audio/webm");
  expect(problems, "no cache", ok.headers.get("cache-control"), "no-store");

  const eight = await call({ form: clip("audio/webm", 8 * 1024 * 1024) });
  expect(problems, "8 MB accepted", eight.status, 200);
  expect(problems, "8 MB reached the provider", globalThis.__voiceCalls[0]?.bytes, 8 * 1024 * 1024);

  globalThis.__voiceTranscript = "";
  expect(problems, "nothing heard", (await call()).body, { text: "" });
  globalThis.__voiceTranscript = undefined;

  // `call()` clears the stub flags, so the refusals are armed on direct calls:
  // the point is what the door does to a provider that refuses.
  globalThis.__voiceUser = STAFF;
  globalThis.__voiceRefuse = "No Google AI Studio key is configured, which the transcription model needs.";
  const refused = await callRoute();
  globalThis.__voiceRefuse = null;
  expect(problems, "provider refusal", refused.status, 503);
  if (!String(refused.body?.error ?? "").includes("Settings")) {
    problems.push("the missing-key refusal does not name Settings → API keys");
  }

  // The gateway's other RecordingNotTranscribableError: above its 14 MB inline
  // cap. No setting fixes that, so the Settings pointer must not appear.
  globalThis.__voiceRefuse =
    "Recording is 15.0MB, above the 14MB limit for automatic transcription.";
  const unreadable = await callRoute();
  globalThis.__voiceRefuse = null;
  expect(problems, "inline-limit refusal", unreadable.status, 503);
  if (String(unreadable.body?.error ?? "").includes("Settings")) {
    problems.push("the inline-limit refusal points at Settings, which cannot fix it");
  }

  // An upstream failure that is not a missing key: the caller gets a status, and
  // neither the response nor the server log carries anything the provider said —
  // no model id, no upstream body.
  const UPSTREAM = "gemini-2.5-flash HTTP 500: SECRET-PROVIDER-BODY";
  const logged = [];
  const consoleError = console.error;
  console.error = (...args) => logged.push(args.map((arg) => String(arg)).join(" "));
  let broken;
  try {
    globalThis.__voiceFail = UPSTREAM;
    broken = await callRoute();
  } finally {
    globalThis.__voiceFail = null;
    console.error = consoleError;
  }
  expect(problems, "upstream failure", broken.status, 502);
  for (const [where, haystack] of [
    ["response", String(broken.body?.error ?? "")],
    ["log", logged.join(" ")],
  ]) {
    if (haystack.includes("SECRET-PROVIDER-BODY")) {
      problems.push(`the 502 ${where} carried the provider's body`);
    }
    if (haystack.includes("gemini")) {
      problems.push(`the 502 ${where} carried the provider's model id`);
    }
  }

  // A refusal must not spend the window: a staff member who sends the wrong
  // container or forgets the `audio` part twenty times can still dictate next.
  const picky = await load(ROUTE_URL);
  const sendMalformed = async (body) => {
    const response = await picky.POST(
      new Request("http://localhost/api/assistant/voice", { method: "POST", body })
    );
    return response.status;
  };
  for (let index = 0; index < 21; index += 1) {
    await sendMalformed(clip("text/plain"));
    const noPart = new FormData();
    noPart.append("note", "hello");
    await sendMalformed(noPart);
  }
  expect(problems, "a refused request never charged the window", await sendMalformed(clip()), 200);

  // The window is per process and per profile: 20 accepted, the 21st refused,
  // and the sentence it carries agrees with the Retry-After it sends.
  // One import for the whole loop, or every call would start with an empty window.
  globalThis.__voiceUser = { profileId: "p-429", role: "RECRUITER" };
  globalThis.__voiceRefuse = null;
  globalThis.__voiceFail = null;
  globalThis.__voiceTranscript = "hello";
  const route = await load(ROUTE_URL);
  let last = null;
  for (let index = 0; index < 21; index += 1) {
    const request = new Request("http://localhost/api/assistant/voice", {
      method: "POST",
      body: clip(),
    });
    const response = await route.POST(request);
    last = {
      status: response.status,
      body: await response.json().catch(() => null),
      headers: response.headers,
    };
    if (index < 20 && last.status !== 200) problems.push(`call ${index + 1} refused early (${last.status})`);
  }
  expect(problems, "twenty-first refused", last?.status, 429);
  const wait = Number(last?.headers.get("retry-after"));
  if (!Number.isFinite(wait) || wait < 1 || wait > 300) {
    problems.push(`Retry-After is not a real wait: ${wait}`);
  } else {
    const minutes = Math.ceil(wait / 60);
    const words =
      wait < 60
        ? `${wait} second${wait === 1 ? "" : "s"}`
        : `${minutes} minute${minutes === 1 ? "" : "s"}`;
    if (!String(last?.body?.error ?? "").includes(words)) {
      problems.push(`the 429 says ${JSON.stringify(last?.body?.error)} but Retry-After is ${wait}`);
    }
  }
  globalThis.__voiceUser = null;
  globalThis.__voiceTranscript = undefined;
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 11. The voice page is staff-gated, and every surface states where audio goes
// ---------------------------------------------------------------------------
async function check11() {
  const problems = [];
  const page = read("src/app/(admin)/assistant/page.tsx");
  if (!page.includes('requireStaff("/assistant")')) problems.push("page is not staff-gated");
  if (!page.includes("await connection()")) problems.push("page does not await connection()");
  if (!page.includes("instant = false")) problems.push("page is not marked instant = false");

  const consoleCopy = page;
  for (const needle of [
    "never stored",
    "discarded",
    "browser vendor",
    "only while this tab is visible",
  ]) {
    if (!consoleCopy.includes(needle)) problems.push(`the privacy note is missing: ${needle}`);
  }

  // The dock's mic is the other door audio leaves by, and it carries the same
  // promise while it records.
  const button = read("src/modules/assistant/presentation/voice/VoiceButton.tsx");
  if (!button.includes("goes to the transcription model and is discarded")) {
    problems.push("the dock mic does not say where its audio goes");
  }

  // The two-minute cap is the recorder's, so the surface must say it happened.
  const strip = read("src/modules/assistant/presentation/voice/VoiceStrip.tsx");
  if (!strip.includes("Stopped at two minutes")) problems.push("the strip never reports the cap");
  // The strip is what is on screen while hands-free is armed, so the listening
  // line itself says whose service receives the words. The disclosure box below
  // it carries the same promise, but a person mid-sentence is looking here.
  if (!strip.includes("the browser sends what it hears to its own speech service")) {
    problems.push("the listening line does not say where the words go");
  }

  // Comments are stripped first: the route's own header says "no bucket, no
  // row", and a substring scan would read that promise as its opposite.
  const route = read("src/app/api/assistant/voice/route.ts");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  if (/getFileStore|storageConfig|\.upload\(|storage\.from/i.test(code)) {
    problems.push("the route appears to store audio");
  }

  // `stored` means a row was read, not that the table works: an unreadable
  // table reads no row either, so the offered levels are gated on `problem`.
  // Pinned as the exact declaration, because `problem === null` appears again
  // in the render condition below it and a loose scan would survive the break.
  const panel = read("src/modules/assistant/presentation/voice/AutonomyPanel.tsx");
  if (!panel.includes("const storable = state.problem === null;")) {
    problems.push("the autonomy panel does not gate its levels on a working table");
  }
  for (const needle of ['state.problem === "absent"', 'state.problem === "unreadable"']) {
    if (!panel.includes(needle)) problems.push(`the panel does not tell ${needle} apart`);
  }
  // Hands-free is the one level the server would refuse to store without the
  // grant, so the panel must not offer it here either.
  if (!panel.includes('(level === "open" && !state.canOpen)')) {
    problems.push("the panel offers hands-free to an account without the grant");
  }

  const chat = read("src/app/(admin)/assistant/AssistantChat.tsx");
  // Hands-free is armed by the console and nowhere else.
  if (!chat.includes('enabled: voiceMode === "console" && handsFree')) {
    problems.push("hands-free is not confined to the console");
  }
  // Every surface reads an answer when reading is switched on. The gate used to
  // name the console by hand, so the dock and the Assistant page had no voice at
  // all — the whole of the bug this slice fixes.
  if (!chat.includes("if (speakReplies && answer) {")) {
    problems.push("the chat does not speak an answer when reading is on");
  }
  if (chat.includes('voiceMode === "console" && speakReplies')) {
    problems.push("spoken answers are still confined to the voice console");
  }
  // The console keeps its own strip switch. Every other surface reaches the same
  // remembered preference through Answering settings, and only a surface that
  // passes that object renders the switch.
  if (!chat.includes('speak={voiceMode === "console" ? null : {')) {
    problems.push("the dock and the Assistant page have no read-aloud switch");
  }
  const settings = read("src/app/(admin)/assistant/AssistantSettings.tsx");
  for (const needle of [
    "Read answers aloud",
    "checked={speak.on}",
    "speak.set(event.target.checked)",
    "Stop reading",
  ]) {
    if (!settings.includes(needle)) problems.push(`the settings panel is missing: ${needle}`);
  }
  // A card minted under `confirm` is released by a click, never by a word.
  // Pinned as the whole test, not the `?? "confirm"` fragment: an inverted
  // comparison would still contain the fragment, and a slice that releases
  // confirm cards by voice would stay green.
  if (!chat.includes('if ((live.autonomy ?? "confirm") === "confirm") {')) {
    problems.push("the chat does not hold confirm-mode cards to a click");
  }

  const assistantConsole = read("src/app/(admin)/assistant/AssistantConsole.tsx");
  if (!assistantConsole.includes('voiceMode="console"')) {
    problems.push("the Assistant console does not include voice controls");
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 12. A spoken turn reaches the server as the person said it
// ---------------------------------------------------------------------------
async function check12() {
  const voice = await load(VOICE_URL);
  const approvals = await load(APPROVALS_URL);
  const problems = [];

  // Mint the exact code the fixture speaks, so the sentence and the card cannot
  // drift apart. `mintSpokenCode` draws from Math.random; the stub is restored
  // before any assertion runs.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rolls = [..."K7Q2"].map(
    (character) => (ALPHABET.indexOf(character) + 0.5) / ALPHABET.length
  );
  let next = 0;
  const savedRandom = Math.random;
  Math.random = () => rolls[next++];
  let coded;
  try {
    coded = approvals.mintApproval(tool, { id: "a" }, "p1", "code");
  } finally {
    Math.random = savedRandom;
  }
  expect(problems, "the fixture minted K7Q2", coded.code, "K7Q2");

  const said = "approve K7Q2";
  // The server's `sameCode` compares one normalised token of the same length,
  // so the four characters must be lifted out of the sentence the person said.
  expect(problems, "the token the sentence carries", voice.spokenCodeIn(said, coded.code), "K7Q2");
  expect(
    problems,
    "a code said in a sentence releases the card",
    approvals.checkApprovalCode(coded.id, "p1", voice.spokenCodeIn(said, coded.code)),
    "ok"
  );
  // The defect the fix removes, pinned as the server's own rule: the whole
  // sentence normalises to APPROVEK7Q2, which is not the token K7Q2.
  expect(
    problems,
    "the raw sentence is not the code",
    approvals.checkApprovalCode(coded.id, "p1", said),
    "mismatch"
  );
  expect(
    problems,
    "a wrong code said in a sentence is refused",
    approvals.checkApprovalCode(coded.id, "p1", voice.spokenCodeIn("approve K7Q3", coded.code)),
    "mismatch"
  );
  // A sentence that never carried the code yields no token at all, so the caller
  // leaves the card live instead of sending a phrase that can only mismatch.
  expect(
    problems,
    "a sentence without the code carries no token",
    voice.spokenCodeIn("approve that one", coded.code),
    null
  );

  // The turn that is saved is the person's own words after the wake phrase,
  // while the folded remainder is only what decided the match.
  expect(
    problems,
    "the raw remainder keeps case and punctuation",
    voice.wakeRemainder("Hey Jarvis, who is waiting?", "Hey Jarvis"),
    "who is waiting?"
  );
  expect(
    problems,
    "a blank phrase leaves the transcript whole",
    voice.wakeRemainder("hey jarvis who is waiting", ""),
    "hey jarvis who is waiting"
  );

  // The chat is where these two rules are applied, so the call sites are pinned
  // with them: a token lifted out of the sentence, and the person's own words
  // saved rather than the folded match. Reverting either to the whole utterance
  // would pass every assertion above.
  const chat = read("src/app/(admin)/assistant/AssistantChat.tsx");
  if (!chat.includes("spokenCodeIn(text, live.code)")) {
    problems.push("the chat does not lift the code out of the sentence it heard");
  }
  if (!chat.includes('approve(live, saidCode ?? "", "assistant voice")')) {
    problems.push("the chat sends something other than the code token to approve");
  }
  if (!chat.includes("wakeRemainder(text, phrase)")) {
    problems.push("the chat sends the folded remainder, not the words spoken");
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 13. The microphone reports what it is doing, and a fatal error stops
// ---------------------------------------------------------------------------
async function check13() {
  const problems = [];

  // A denied microphone, a blocked speech service and a missing device cannot
  // heal by starting again. Without the `stopped` latch the restart loop turns
  // one refusal into a start → error → end cycle at event speed, while the strip
  // goes on saying "Arming the microphone…".
  const hook = read("src/modules/assistant/presentation/voice/useWakeWord.ts");
  if (!hook.includes('code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture"')) {
    problems.push("the recognizer does not treat a refusal as fatal");
  }
  if (!hook.includes("if (!active || suspended || stopped) return;")) {
    problems.push("the recognizer restarts after a fatal error");
  }
  if (!hook.includes("if (stopped) return;")) {
    problems.push("returning to the tab restarts a fatally stopped recognizer");
  }
  // A disarmed console must not keep reporting why its last armed run stopped.
  // The strip's status line says "Nothing is being recorded." while the alert
  // beneath it still reads "the microphone is blocked — arm hands-free again":
  // advice for a listening state that has ended. Seen live in Chrome with the
  // microphone denied for localhost:3001, and unchanged 9.5s after disarming.
  // The teardown of the armed run is where that error belongs — a synchronous
  // clear in the effect body is the render-cascading shape React's rules refuse.
  if (!/\n      setError\(null\);\n    \};/.test(hook)) {
    problems.push("a disarmed console still says the microphone is blocked");
  }

  // The status line is the only thing that says what the microphone is doing, so
  // it cannot claim silence while push-to-talk is recording, and cannot name a
  // phrase that is not the one being matched.
  const strip = read("src/modules/assistant/presentation/voice/VoiceStrip.tsx");
  if (!strip.includes("Recording — this clip goes to the transcription model")) {
    problems.push("the strip says nothing is recorded while a clip is being recorded");
  }
  if (!strip.includes("const shownPhrase = wakePhrase.trim() || DEFAULT_WAKE_PHRASE;")) {
    problems.push("the strip names a phrase an empty box cannot match");
  }
  if (!strip.includes('Listening stopped — the error below says why.')) {
    problems.push("the strip keeps saying it is arming after a fatal error");
  }

  // The same fallback the strip shows is the phrase the matcher uses, or the two
  // disagree and an empty box listens for nothing.
  const chat = read("src/app/(admin)/assistant/AssistantChat.tsx");
  if (!chat.includes("const phrase = wakePhrase.trim() || DEFAULT_WAKE_PHRASE;")) {
    problems.push("an empty wake phrase leaves hands-free listening for nothing");
  }

  // The panel offers hands-free only with the grant, and a failed save has to
  // release the spinner — otherwise the one control that changes what a word may
  // release is stuck disabled with no explanation.
  const panel = read("src/modules/assistant/presentation/voice/AutonomyPanel.tsx");
  if (!panel.includes("if (busy) return;")) problems.push("the panel ignores its own spinner");
  if (!panel.includes("    } finally {\n      setBusy(null);\n    }")) {
    problems.push("a save that throws leaves the autonomy panel spinning forever");
  }
  if (!panel.includes("setNotice(")) {
    problems.push("the panel has a button that does nothing and never says so");
  }

  // The conversation id arrives on every answer; rewriting the address each time
  // would push the router once per turn.
  const consoleFile = read("src/app/(admin)/assistant/AssistantConsole.tsx");
  if (!consoleFile.includes("if (reportedSession.current !== sessionId) {")) {
    problems.push("the voice console rewrites its address on every answer");
  }

  // A spoken question must not throw away what was typed or attached, and must
  // not look sent in the caption when the in-flight guard was going to drop it.
  for (const needle of [
    "if (draftRef.current.trim() || attachment) {",
    "if (pending || extracting || inFlightRef.current) {",
  ]) {
    if (!chat.includes(needle)) {
      problems.push("a spoken turn can discard the draft, the file or an answer in flight");
    }
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 14. The console cannot hear itself, an answer is queued not cancelled, and one
//     turn runs at a time
// ---------------------------------------------------------------------------
async function check14() {
  const voice = await load(VOICE_URL);
  const problems = [];

  // The rule. A recogniser armed for hands-free listens to the same room the
  // device speaks into, so the console's own voice can come back as a final: the
  // cue it said, a refusal it read out, the answer it summarised aloud. Acting on
  // one lets the assistant answer itself — or release the very card whose code it
  // just spoke.
  const said = (text, at) => [{ text, at }];
  const NOW = 10_000;
  expect(
    problems,
    "words inside what was just spoken are an echo",
    voice.isOwnVoiceEcho("who", said("who is waiting for me", NOW - 1000), NOW),
    true
  );
  expect(
    problems,
    "folding does not break the match",
    voice.isOwnVoiceEcho(" Listening! ", said("Listening", NOW - 1000), NOW),
    true
  );
  expect(
    problems,
    "the same words after the window are the person's",
    voice.isOwnVoiceEcho("who", said("who is waiting for me", NOW - voice.OWN_VOICE_WINDOW_MS - 1), NOW),
    false
  );
  expect(
    problems,
    "words that were never spoken are not an echo",
    voice.isOwnVoiceEcho("how many candidates joined", said("who is waiting for me", NOW - 500), NOW),
    false
  );
  // Two empty guards, each failing the other way: no words spoken yet cannot make
  // every utterance an echo, and no words heard cannot match anything.
  expect(problems, "nothing spoken yet hears no echo", voice.isOwnVoiceEcho("who", said("", 0), NOW), false);
  expect(
    problems,
    "nothing heard is not an echo of a sentence",
    voice.isOwnVoiceEcho("", said("who is waiting for me", NOW - 500), NOW),
    false
  );
  expect(problems, "the window is seconds, not minutes", voice.OWN_VOICE_WINDOW_MS, 4000);
  // A word inside a longer word is not the same word. The console says
  // "OK, the change is done"; a person whose first syllable is heard as "ok" is
  // not that sentence, and dropping their utterance would be the assistant
  // refusing to hear somebody.
  expect(
    problems,
    "a heard word is not an echo of a longer word that contains it",
    voice.isOwnVoiceEcho("ok", said("token", NOW - 500), NOW),
    false
  );
  // The memory is more than the last utterance, because the console says the next
  // thing before the echo of the previous one arrives: the cue that arms the
  // recogniser cuts off the answer it was reading, so both are inside the window
  // and either can come back.
  expect(
    problems,
    "an echo of an earlier utterance is caught after a newer one replaced it",
    voice.isOwnVoiceEcho(
      "how many candidates joined",
      [{ text: "how many candidates joined this month", at: NOW - 3_000 }, { text: "Listening", at: NOW - 500 }],
      NOW
    ),
    true
  );
  expect(
    problems,
    "the older utterance outside the window does not outlive the newer inside it",
    voice.isOwnVoiceEcho(
      "how many candidates joined",
      [
        { text: "how many candidates joined this month", at: NOW - voice.OWN_VOICE_WINDOW_MS - 1 },
        { text: "Listening", at: NOW - 500 },
      ],
      NOW
    ),
    false
  );

  // The window runs from the last moment the device was producing sound. A piece of
  // a long answer plays for tens of seconds, so a window timed from the hand-over
  // would expire long before the echo of its tail arrived.
  const speechHook = read("src/modules/assistant/presentation/voice/useSpeech.ts");
  for (const needle of [
    "const SPOKEN_MEMORY = 8;",
    "const spokenRecently = useRef<{ text: string; at: number }[]>([]);",
    "{ text: next.text, at: Date.now() },",
    "].slice(-SPOKEN_MEMORY);",
    "const newest = spokenRecently.current[spokenRecently.current.length - 1];",
    "isOwnVoiceEcho(heard, spokenRecently.current, Date.now())",
    "echoedOwnVoice,",
  ]) {
    if (!speechHook.includes(needle)) problems.push(`useSpeech does not record: ${needle}`);
  }
  if (!/onend = \(\) => \{[\s\S]{0,80}hearAgain\(\);/.test(speechHook)) {
    problems.push("the echo window still runs from the hand-over, not from the end of playback");
  }
  // Each of the three restamps is pinned at its own site: the window is the last
  // moment the device was producing sound, so the start, the end and the stop
  // that never played all have to move it. A single needle matching `hearAgain`'s
  // definition would leave two of the three removable in silence.
  if (!/onstart = \(\) => \{[\s\S]{0,80}hearAgain\(\);/.test(speechHook)) {
    problems.push("the echo window is not opened when the utterance starts playing");
  }
  if (!/event\.error === "interrupted"\) \{\s*\n\s*hearAgain\(\);/.test(speechHook)) {
    problems.push("a cancelled or interrupted utterance does not restamp the echo window");
  }

  // The queue, not a cancel, is what carries an answer. `speechSynthesis` is one
  // global voice per tab, and the `cancel()` that used to open every sentence cut
  // short the sentence before it — which is what a person heard as JARVIS stopping
  // mid-word. Two silences are left, and each one is the person's own request: the
  // Stop button, and a surface unmounting while it is the one talking. So the count
  // is pinned, and the unmount's is pinned in its guarded form.
  for (const needle of [
    "const queue = useRef<Piece[]>([]);",
    "if (producing.current) return;",
    "const pieces = chunkForSpeech(text).map(",
    "queue.current = [...queue.current, ...pieces];",
    "if (producing.current) window.speechSynthesis.cancel();",
    "      stop();\n      speak(text, language);",
  ]) {
    if (!speechHook.includes(needle)) problems.push(`the speech queue is missing: ${needle.trim()}`);
  }
  const silences = speechHook.match(/window\.speechSynthesis\.cancel\(\);/g) ?? [];
  if (silences.length !== 2) {
    problems.push(`the device is silenced ${silences.length} times, not by the Stop and its own unmount`);
  }
  // A Stop that cancelled only the utterance in the air left every queued sentence
  // to play after the click that asked for silence.
  if (!/const stop = useCallback\(\(\) => \{[\s\S]{0,400}?queue\.current = \[\];/.test(speechHook)) {
    problems.push("a Stop leaves queued sentences to play after the click that cancelled them");
  }

  // A voice list that has not loaded is not a voiceless device. The piece stays at
  // the head of the queue for the `voiceschanged` pass, instead of the hook blameing
  // the person's machine for a list that was still arriving.
  if (!speechHook.includes("if (voices.current.length === 0) return;")) {
    problems.push("a still-loading voice list is not held for the voiceschanged pass");
  }
  if (/if \(voices(\.current)?\.length === 0\) \{[\s\S]{0,120}setError/.test(speechHook)) {
    problems.push("a still-loading voice list is reported as no voice installed");
  }

  // The guard is only worth anything where the finals land. Both must hold: the
  // utterance in flight, and the echo that arrives a beat after it ended.
  const chat = read("src/app/(admin)/assistant/AssistantChat.tsx");
  if (!chat.includes("if (speech.speaking || speech.echoedOwnVoice(text)) return;")) {
    problems.push("a spoken turn does not refuse the console's own voice");
  }
  if (!chat.includes("const inFlightRef = useRef(false);")) {
    problems.push("nothing outside React state says a turn is running");
  }
  // The same reason the turn latch is a ref: one `onresult` can carry the wake
  // phrase and the question as two finals in one synchronous pass, and the state
  // the first writes is not visible to the second. So the wait for the utterance
  // after a bare "Hey Jarvis" is read where the finals land, not as render state.
  // The writes go through `markAwaiting`, the one writer that also mirrors the
  // wait to the presence orb — it must still write the ref first, for that same
  // synchronous pass.
  for (const needle of [
    "const awaitingRef = useRef(false);",
    "const markAwaiting = useJarvisAwaitingWriter(awaitingRef);",
    "markAwaiting(true);",
    "markAwaiting(false);",
    "if (!awaitingRef.current) return;",
  ]) {
    if (!chat.includes(needle)) problems.push(`the wake-follow state is not a ref: ${needle}`);
  }
  const awaitingWriter = read("src/modules/assistant/presentation/voice/useJarvisHandoff.ts");
  if (
    !awaitingWriter.includes("awaitingRef.current = awaiting;") ||
    !awaitingWriter.includes("setJarvisAwaiting(awaiting);")
  ) {
    problems.push("the chat's wait is not written to both the ref and the orb");
  }
  if (/const \[awaiting, setAwaiting\] = useState/.test(chat)) {
    problems.push("the wake-follow latch is still React state");
  }
  // Refusing the console's own voice must not end the wait: a person who says the
  // wake phrase over an answer that was cut off is still answering the cue they
  // gave. Pinned as the guard *followed by* the reset, so a reset moved above the
  // guard — which would swallow the person's next utterance — cannot pass.
  if (!/if \(speech\.speaking \|\| speech\.echoedOwnVoice\(text\)\) return;\n\s*markAwaiting\(false\);/.test(chat)) {
    problems.push("an echo of the console's own voice ends the wait for the person's words");
  }
  for (const needle of [
    "if (!prompt || pending || extracting || inFlightRef.current) return;",
    "if (approving || pending || inFlightRef.current) return;",
    "    inFlightRef.current = true;\n",
  ]) {
    if (!chat.includes(needle)) problems.push(`the in-flight guard is missing: ${needle.trim()}`);
  }
  if ((chat.match(/inFlightRef\.current = false;/g) ?? []).length !== 2) {
    problems.push("an in-flight turn is never released, or released somewhere other than its finally");
  }
  // A second verdict in the same batch must not caption itself as a release the
  // server never ran. Pinned as the refusal together with the guard it sits
  // under: the sentence alone would still be on screen, unreachable, if the
  // guard went.
  if (!/if \(inFlightRef\.current\) \{\s*\n\s*setCaption\("Not released/.test(chat)) {
    problems.push("a second spoken approval claims a release that did not happen");
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 15. The presence queues its sentences and holds one for a voice list still
//     arriving
// ---------------------------------------------------------------------------
const JARVIS_VOICE_REL = "src/modules/assistant/presentation/useJarvisVoice.ts";

async function check15() {
  const problems = [];
  // Comments are stripped: the file explains the empty-list rule in prose, and a
  // substring scan would read the explanation as the code that breaks it.
  const code = read(JARVIS_VOICE_REL)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

  // A briefing is several sentences and the watchers ask for them in one pass. The
  // cancel that used to open every `say()` is what a person heard as JARVIS going
  // quiet mid-sentence, because the second line arrived while the first was still
  // being spoken. So the hook owns a queue, produces one sentence at a time, and
  // silences the device only for the person's own Stop and for its own speech.
  for (const needle of [
    "const queue = useRef<Queued[]>([]);",
    "if (producing.current) return;",
    "queue.current = [...queue.current, { text: sentence, resolve }];",
    "if (producing.current) stopDevice();",
  ]) {
    if (!code.includes(needle)) problems.push(`useJarvisVoice is missing: ${needle}`);
  }
  const silences = code.match(/stopDevice\(\);/g) ?? [];
  // Two call sites, both of them the person's own request for quiet: the Stop, and
  // this hook unmounting while it is the one talking.
  if (silences.length !== 2) {
    problems.push(`the device is silenced from ${silences.length} places, not from Stop and its own unmount`);
  }
  // The caller's latch is the sentence finishing, not the sentence being handed
  // over. A watcher released at the hand-over queued the next line onto a device
  // still busy with the last one — and a queue that never released its callers
  // would leave a briefing hanging after its first sentence.
  if (!code.includes("await new Promise<void>((resolve) => {")) {
    problems.push("say() is not a promise the watcher can wait on");
  }
  if (!/const done = \(\) => \{[\s\S]{0,160}next\.resolve\(\);[\s\S]{0,60}pumpRef\.current\(\);/.test(code)) {
    problems.push("a sentence whose playback ended does not release the watcher that awaited it");
  }
  if (!/const done = \(\) => \{[\s\S]{0,80}producing\.current = false;/.test(code)) {
    problems.push("the queue is not drained when a sentence finishes");
  }
  // A Stop that cancelled only the sentence in the air left the rest of the briefing
  // to play after the click that asked for quiet — and each waiting caller had to be
  // released, or the watcher that awaited it would never resume.
  if (!/const stop = useCallback\(\(\) => \{[\s\S]{0,200}?drain\(\);/.test(code)) {
    problems.push("a Stop leaves the queued sentences to play after the click that cancelled them");
  }
  if (!code.includes("pending.forEach((item) => item.resolve());")) {
    problems.push("a drained queue leaves its callers waiting forever");
  }

  // `getVoices()` answers with an empty list on the first call while the platform
  // loads its voices. That is not a voiceless machine, and the presence used to say
  // so, drop the sentence and leave a briefing unspoken on a device that could have
  // read it. The sentence stays at the head of the queue for the `voiceschanged`
  // pass, and only a list that never arrives is reported as a missing voice.
  for (const needle of [
    "const VOICE_LIST_GRACE_MS = 2_000;",
    "if (deviceVoices.current.length === 0) {",
    "holdTimer.current = window.setTimeout(",
    "deviceVoices.current = window.speechSynthesis.getVoices();\n      pump();",
    "This device has no voice installed, so the sentence stays on screen.",
  ]) {
    if (!code.includes(needle)) problems.push(`the voice-list hold is missing: ${needle}`);
  }
  if (/if \(deviceVoices\.current\.length === 0\) \{[\s\S]{0,80}setNotice/.test(code)) {
    problems.push("a still-loading voice list is reported as no voice installed");
  }
  // A language with no voice on this machine drops that sentence with the reason
  // and the queue moves on: one unpronounceable line must not end a briefing.
  if (!/const voice = pickDeviceVoice\(deviceVoices\.current, voiceId, wanted\);\n\s*if \(!voice\) \{\s*\n\s*queue\.current\.shift\(\);/.test(code)) {
    problems.push("a sentence the device cannot speak stops the rest of the queue");
  }
  // A sentence with no letters is not a sentence to speak, and it must not blame
  // the machine for a row of numbers.
  if (!/const wanted = speechLanguageOf\(next\.text\);\n\s*if \(!wanted\) \{\s*\n\s*queue\.current\.shift\(\);\n\s*next\.resolve\(\);/.test(code)) {
    problems.push("a letterless sentence is reported as a missing voice");
  }
  // The words still queued when the person stopped talking must not come back with
  // the voice list.
  if (!/const stop = useCallback\(\(\) => \{[\s\S]{0,200}?clearHold\(\);/.test(code)) {
    problems.push("a Stop leaves the voice-list grace running");
  }
  // The specific reason must survive `say()`: it used to be overwritten with a
  // generic "nothing to say out loud" by the caller that had just set it.
  if (code.includes("The assistant has nothing to say out loud in this tab yet.")) {
    problems.push("say() overwrites the device-voice notice with a generic one");
  }
  return verdict(problems);
}

/**
 * 16. Which voice reads a sentence, and how fast, is chosen in one place and obeyed
 * by both engines.
 *
 * The pair is a browser preference, not an account row: a voice is a fact about the
 * machine in front of the person, so a choice carried to another computer means
 * nothing there. That makes the store the only place the choice can live, and the
 * two surfaces that speak (the chat and the orb) and the one panel that edits it
 * (Settings → Assistant) must all read the same two keys — otherwise a person picks
 * a voice in Settings and the briefing keeps saying "Hello" in another one.
 *
 * The preview is the part that could undo the fix this suite exists for. The panel
 * shares one global `speechSynthesis` with the orb, so a preview that cancelled to
 * get its turn would cut a briefing mid-sentence — exactly the defect check 14 and
 * check 15 pin out of the engines. And its words are data: a sample that said the
 * wake phrase, or "stop", would be heard back by the armed recogniser and either
 * open a turn nobody asked for or silence the voice that is reading it.
 */
async function check16() {
  const problems = [];
  const store = read("src/app/(admin)/assistant/AssistantPrefs.tsx");
  const chat = read("src/app/(admin)/assistant/AssistantChat.tsx");
  const orb = read("src/modules/assistant/presentation/JarvisPresence.tsx");
  const panel = read("src/app/(admin)/settings/JarvisPresenceConsole.tsx");
  const listHook = read("src/modules/assistant/presentation/voice/useDeviceVoices.ts");
  const speechHook = read("src/modules/assistant/presentation/voice/useSpeech.ts");
  const jarvisHook = read("src/modules/assistant/presentation/useJarvisVoice.ts");

  /** One exported function's body, so a rule is pinned where it lives, not nearby. */
  const body = (source, name) => {
    const at = source.indexOf(`export function ${name}(`);
    if (at === -1) return null;
    const rest = source.slice(at + name.length);
    const next = rest.indexOf("export function ");
    return next === -1 ? rest : rest.slice(0, next);
  };

  // --- the store: two keys, each written and read through the same notify ------
  for (const needle of [
    'const VOICE_ID_KEY = "sdg-assistant-voice-id";',
    'const SPEECH_RATE_KEY = "sdg-assistant-speech-rate";',
    "export function readStoredVoiceId(",
    "export function writeStoredVoiceId(",
    "export function readStoredSpeechRate(",
    "export function writeStoredSpeechRate(",
  ]) {
    if (!store.includes(needle)) problems.push(`the voice store is missing: ${needle}`);
  }
  const writeVoice = body(store, "writeStoredVoiceId");
  if (!writeVoice) problems.push("writeStoredVoiceId is not exported");
  else {
    if (!writeVoice.includes("window.localStorage.setItem(VOICE_ID_KEY, clean);")) {
      problems.push("a chosen voice is not written under the voice key");
    }
    if (!writeVoice.includes("window.localStorage.removeItem(VOICE_ID_KEY);")) {
      problems.push('choosing the device default leaves the old name stored instead of clearing it');
    }
    if (!writeVoice.includes("notifyVoicePrefs();")) {
      problems.push("a chosen voice does not reach the surfaces already open");
    }
  }
  const readRate = body(store, "readStoredSpeechRate");
  if (!readRate) problems.push("readStoredSpeechRate is not exported");
  else if (!readRate.includes("normaliseSpeechRate(window.localStorage.getItem(SPEECH_RATE_KEY))")) {
    problems.push("a rate is read out of storage unclamped, so a hand-edited value can be obeyed");
  }
  const writeRate = body(store, "writeStoredSpeechRate");
  if (!writeRate) problems.push("writeStoredSpeechRate is not exported");
  else {
    if (!writeRate.includes("normaliseSpeechRate(rate)")) {
      problems.push("a rate is stored unnormalised");
    }
    if (!writeRate.includes("if (clean === DEFAULT_SPEECH_RATE) window.localStorage.removeItem(SPEECH_RATE_KEY);")) {
      problems.push("going back to a normal pace leaves a stale factor in the store");
    }
    if (!writeRate.includes("notifyVoicePrefs();")) {
      problems.push("a pace change does not reach the surfaces already open");
    }
  }

  // --- both speaking surfaces read the same two keys ---------------------------
  for (const [label, source, call] of [
    ["the chat", chat, "useSpeech({ voiceId, rate: speechRate })"],
    ["the presence", orb, "useJarvisVoice({ voiceId, rate: speechRate })"],
  ]) {
    if (!source.includes("useSyncExternalStore(subscribeVoicePrefs, readStoredVoiceId")) {
      problems.push(`${label} does not read the chosen voice from the store`);
    }
    if (!source.includes("readStoredSpeechRate")) {
      problems.push(`${label} does not read the speaking pace from the store`);
    }
    if (!source.includes(call)) {
      problems.push(`${label} does not hand the pair to its engine: ${call}`);
    }
  }

  // --- both engines obey it per sentence, so a change lands on the next one ----
  for (const [label, source] of [
    ["useSpeech", speechHook],
    ["useJarvisVoice", jarvisHook],
  ]) {
    if (!source.includes("utterance.rate = rate;")) {
      problems.push(`${label} speaks without the chosen pace`);
    }
    if (!/const voice = pickDeviceVoice\([\w.]+, voiceId, /.test(source)) {
      problems.push(`${label} picks a voice without the chosen name`);
    }
  }
  // The list hook only listens. A reader that cancelled on unmount would silence
  // the orb from the Settings panel while a briefing was still being read.
  if (listHook.includes(".cancel(")) {
    problems.push("useDeviceVoices silences the one global voice it is only meant to list");
  }
  if (!listHook.includes("voiceschanged")) {
    problems.push("useDeviceVoices never refreshes, so a list that arrives late is never shown");
  }

  // --- the panel: a select, a bounded slider, and a preview that waits ---------
  for (const needle of [
    'title="The voice and the pace"',
    "const devices = useDeviceVoices();",
    "writeStoredVoiceId(event.target.value);",
    "writeStoredSpeechRate(Number(event.target.value));",
    'type="range"',
    "min={SPEECH_RATE_MIN}",
    "max={SPEECH_RATE_MAX}",
    "const voice = pickDeviceVoice(devices, voiceId, \"en\");",
    "utterance.rate = speechRate;",
  ]) {
    if (!panel.includes(needle)) problems.push(`the voice panel is missing: ${needle}`);
  }
  if (panel.includes(".cancel(")) {
    problems.push("the preview cancels the presence's speech to get its own turn");
  }
  // A saved name this machine no longer has is a fallback, and the panel must show
  // the fallback rather than a select sitting on a choice nobody made.
  if (!panel.includes('value={voiceMissing ? "" : voiceId}')) {
    problems.push("a voice this machine does not have is shown as if it were selected");
  }
  // These are browser prefs, so the account write must not be what gates them.
  const voiceSection = panel.slice(
    panel.indexOf('title="The voice and the pace"'),
    panel.indexOf('title="The quiet window"')
  );
  if (!voiceSection) problems.push("the voice section cannot be found");
  else if (voiceSection.includes("disabled={locked}") || voiceSection.includes("disabled={busy")) {
    problems.push("the voice and the pace are disabled with the account row, though neither is stored on it");
  }

  // The sample is handed to a live recogniser as well as to the device. Neither the
  // wake phrase nor a barge-in word may be in it.
  const sample = panel.match(/const PREVIEW_SENTENCE = "([^"]*)"/);
  if (!sample) problems.push("the preview has no sample sentence");
  else {
    const said = sample[1].toLowerCase();
    if (said.includes("jarvis")) problems.push("the preview says the wake phrase, and would open a turn");
    for (const command of ["stop", "be quiet", "quiet now", "shut up"]) {
      if (said.includes(command)) problems.push(`the preview says "${command}", and would stop itself`);
    }
  }
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const CHECKS = [
  ["1. The wake phrase matches at the start, is stripped, and never matches mid-sentence", check1],
  ["2. Arabic folds harakat, tatweel and alef forms", check2],
  ["3. Cancel wins over approve; a code in play must be said", check3],
  ["4. The code is four characters, never 0/O/1/I, and compares case-free", check4],
  ["5. A spoken answer keeps every word, in pieces the device can hold", check5],
  ["6. The spoken language follows the script written", check6],
  ["7. Migration 046 is authored with own-row policies and no audio column", check7],
  ["8. A stored open without the grant is only ever confirm", check8],
  ["9. A code-mode card carries a code; a wrong code does not consume it", check9],
  ["10. The route refuses anonymous, oversize, foreign and repeated bodies", check10],
  ["11. The voice page is staff-gated, and every surface says where audio goes", check11],
  ["12. A spoken code and a spoken question reach the server as said", check12],
  ["13. The microphone reports what it is doing, and a refusal stops", check13],
  ["14. The console cannot hear itself, and one turn runs at a time", check14],
  ["15. The presence queues its sentences; a loading voice list is not a voiceless machine", check15],
  ["16. The voice and the pace are chosen once, in this browser, and both engines obey", check16],
];

for (const [name, run] of CHECKS) {
  results.push([name, await safe(run)]);
}

// Mutation proofs are added by the tasks that own the files they break.

const VOICE_REL = "src/modules/assistant/domain/voice.ts";
// A check takes no module: it loads the current bytes itself, so the check that
// a mutation re-runs is the same check the suite ran, on the mutated file.
//
// Only a check that fails on its own assertions proves a mutation. One that
// throws (a syntax error, or a symbol the check loads) never reached the rule,
// so it is not red. The failure detail diagnoses the mutation that did not bite:
// "check stayed green", or the throw that broke the load instead of the rule.
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
  // A kill between the write and the `finally` used to leave the mutated source
  // on disk. The copy is saved before the write, and restored from `exit` and
  // the two signals as well as from the normal path.
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
    if (!original.includes(needle)) {
      mutations.push({ label, pass: false, detail: `needle not found in ${rel}` });
      return;
    }
    const mutated = original.replace(needle, replacement);
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
  "1. Wake phrase matched anywhere, not at the start → check 1 red",
  VOICE_REL,
  'if (spoken !== wanted && !spoken.startsWith(`${wanted} `)) {',
  "if (!spoken.includes(wanted)) {",
  async () => checkIsRed(1)
);

await mutation(
  "2. Cancel checked after approve → check 3 red",
  VOICE_REL,
  '  if (saysAny(spoken, CANCEL_WORDS)) return "cancel";\n  if (saysAny(spoken, APPROVE_WORDS)) return "approve";',
  '  if (saysAny(spoken, APPROVE_WORDS)) return "approve";\n  if (saysAny(spoken, CANCEL_WORDS)) return "cancel";',
  async () => checkIsRed(3)
);

await mutation(
  "3. A code in play no longer has to be said → check 3 red",
  VOICE_REL,
  "    if (!wanted || !normalizeSpokenCode(spoken).includes(wanted)) return null;",
  "    if (!wanted) return null;",
  async () => checkIsRed(3)
);

// The two alef folds the wake phrase depends on. Each fixture in check 2 is
// written the other way round, so deleting either line turns that check red.
const HAMZA_FOLD = '    .replace(/[\\u0622\\u0623\\u0625\\u0671]/g, "\\u0627")\n';
const MAQSURA_FOLD = '    .replace(/\\u0649/g, "\\u064A")\n';

await mutation(
  "4. Hamza alef no longer folds to alef → check 2 red",
  VOICE_REL,
  HAMZA_FOLD,
  "",
  async () => checkIsRed(2)
);

await mutation(
  "5. Alef maqsura no longer folds to yeh → check 2 red",
  VOICE_REL,
  MAQSURA_FOLD,
  "",
  async () => checkIsRed(2)
);

// The code alphabet: a confusable put back, a character dropped. The sweep in
// check 4 is what makes both of these visible.
await mutation(
  "6. Alphabet gains 0 in place of 2 → check 4 red",
  VOICE_REL,
  'const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";',
  'const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ03456789";',
  async () => checkIsRed(4)
);

await mutation(
  "7. Alphabet loses a character → check 4 red",
  VOICE_REL,
  'const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";',
  'const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ2345678";',
  async () => checkIsRed(4)
);

// Arabic-Indic digits are what an Arabic transcript carries. Dropping the map
// makes an Arabic-digit code unmentionable, on the card and in the normaliser.
const ARABIC_DIGIT_MAP = 'return asciiDigits(text).toUpperCase().replace(/[^A-Z0-9]/g, "");';

await mutation(
  "8. Arabic-Indic digits dropped from a spoken code → check 3 red",
  VOICE_REL,
  ARABIC_DIGIT_MAP,
  'return text.toUpperCase().replace(/[^A-Z0-9]/g, "");',
  async () => checkIsRed(3)
);

await mutation(
  "9. Arabic-Indic digits dropped from the normaliser → check 4 red",
  VOICE_REL,
  ARABIC_DIGIT_MAP,
  'return text.toUpperCase().replace(/[^A-Z0-9]/g, "");',
  async () => checkIsRed(4)
);

// The demotion rule. Dropping the downgrade leaves a demoted account hands-free;
// inverting the permission test makes `open` unreachable for the only accounts
// allowed to hold it and reachable for everyone else. Check 8 sees both.
const AUTONOMY_RULE = 'return level === "open" && !canOpen ? "confirm" : level;';

await mutation(
  "10. The open downgrade dropped → check 8 red",
  VOICE_REL,
  AUTONOMY_RULE,
  "return level;",
  async () => checkIsRed(8)
);

await mutation(
  "11. The autonomy permission test inverted → check 8 red",
  VOICE_REL,
  AUTONOMY_RULE,
  'return level === "open" && canOpen ? "confirm" : level;',
  async () => checkIsRed(8)
);

// The card's code rule. Removing the comparison makes every spoken string open a
// coded card; dropping the owner check lets an id seen elsewhere release it.
const APPROVALS_REL = "src/modules/assistant/domain/approvals.ts";

await mutation(
  "12. The code requirement removed from the click path → check 9 red",
  APPROVALS_REL,
  '  if (!spoken || !sameCode(entry.code, spoken)) return "mismatch";',
  "  if (false) return \"mismatch\";",
  async () => checkIsRed(9)
);

await mutation(
  "13. The owner check dropped, so another person's id opens → check 9 red",
  APPROVALS_REL,
  '  if (!entry || entry.profileId !== profileId || entry.expiresMs <= Date.now()) return "missing";',
  '  if (!entry || entry.expiresMs <= Date.now()) return "missing";',
  async () => checkIsRed(9)
);

// The transcription door. Each refusal check 10 pins gets one mutation of its
// own, so a door that stops refusing one of them cannot pass quietly: the staff
// gate (401), the declared-length cap (413), the container allowlist (415) and
// the per-profile window (429), plus the codec parameter that decides whether the
// allowlist ever matches what a browser records.
const ROUTE_REL = "src/app/api/assistant/voice/route.ts";

await mutation(
  "14. The staff check dropped from the door → check 10 red",
  ROUTE_REL,
  "  if (!user || !isStaff(user.role)) {",
  "  if (!user) {",
  async () => checkIsRed(10)
);

await mutation(
  "15. The codec parameter kept, so the allowlist misses → check 10 red",
  ROUTE_REL,
  '  const mime = (recording.type || "").split(";")[0].trim().toLowerCase();',
  "  const mime = recording.type;",
  async () => checkIsRed(10)
);

await mutation(
  "16. The size cap raised past the declared 9 MB → check 10 red",
  ROUTE_REL,
  "const MAX_BYTES = 8 * 1024 * 1024;",
  "const MAX_BYTES = 9 * 1024 * 1024;",
  async () => checkIsRed(10)
);

await mutation(
  "17. A foreign type added to the allowlist → check 10 red",
  ROUTE_REL,
  'const READABLE_TYPES = new Set(["audio/webm", "audio/ogg"]);',
  'const READABLE_TYPES = new Set(["audio/webm", "audio/ogg", "text/plain"]);',
  async () => checkIsRed(10)
);

await mutation(
  "18. The utterance window widened to 21 → check 10 red",
  ROUTE_REL,
  "const MAX_UTTERANCES = 20;",
  "const MAX_UTTERANCES = 21;",
  async () => checkIsRed(10)
);

// Fix-round mutations. Each one restores a defect the review named, so the new
// assertion that pins its fix is shown failing on the exact line it guards.
await mutation(
  "19. The 502 log hands back the provider's message → check 10 red",
  ROUTE_REL,
  'error instanceof Error ? error.name : "unknown error"',
  'error instanceof Error ? error.message : "unknown error"',
  async () => checkIsRed(10)
);

await mutation(
  "20. The post-buffer size check loosened past a lied-about 9 MB → check 10 red",
  ROUTE_REL,
  "if (recording.size > MAX_BYTES) return json({ error: TOO_LARGE }, 413);",
  "if (recording.size > MAX_BYTES * 2) return json({ error: TOO_LARGE }, 413);",
  async () => checkIsRed(10)
);

await mutation(
  "21. A zero-byte clip accepted again → check 10 red",
  ROUTE_REL,
  "if (!recording || !(recording instanceof Blob) || recording.size === 0) {",
  "if (!recording || !(recording instanceof Blob)) {",
  async () => checkIsRed(10)
);

await mutation(
  "22. The Settings pointer offered for every refusal → check 10 red",
  ROUTE_REL,
  "const needsKey = /key/i.test(error.message);",
  "const needsKey = true;",
  async () => checkIsRed(10)
);

await mutation(
  "23. The 429 copy back to a fixed minute → check 10 red",
  ROUTE_REL,
  "${waitWords(wait)}",
  "a minute",
  async () => checkIsRed(10)
);

await mutation(
  "24. The window charged on arrival, before validation → check 10 red",
  ROUTE_REL,
  "  const form = await request.formData().catch(() => null);",
  '  if (retryAfter(user.profileId) !== null) {\n    return json({ error: "That is a lot of dictation at once." }, 429);\n  }\n  const form = await request.formData().catch(() => null);',
  async () => checkIsRed(10)
);

await mutation(
  "25. The declared-length cap moved in front of the staff gate → check 10 red",
  ROUTE_REL,
  '  const user = await getSessionUser();\n  if (!user || !isStaff(user.role)) {\n    return json({ error: "Sign in as staff to dictate." }, 401);\n  }',
  '  const early = oversizeUploadResponse(request, MAX_BYTES, TOO_LARGE);\n  if (early) return early;\n\n  const user = await getSessionUser();\n  if (!user || !isStaff(user.role)) {\n    return json({ error: "Sign in as staff to dictate." }, 401);\n  }',
  async () => checkIsRed(10)
);

// The voice console's page and its privacy pins. Each mutation restores one
// defect the page or a surface could plausibly ship with, so check 11 is shown
// failing on the exact line it guards.
const VOICE_PAGE_REL = "src/app/(admin)/assistant/page.tsx";
const VOICE_CONSOLE_REL = "src/app/(admin)/assistant/AssistantConsole.tsx";
const AUTONOMY_PANEL_REL = "src/modules/assistant/presentation/voice/AutonomyPanel.tsx";
const VOICE_STRIP_REL = "src/modules/assistant/presentation/voice/VoiceStrip.tsx";
const VOICE_BUTTON_REL = "src/modules/assistant/presentation/voice/VoiceButton.tsx";
const CHAT_REL = "src/app/(admin)/assistant/AssistantChat.tsx";

await mutation(
  "26. The voice page guards a different route → check 11 red",
  VOICE_PAGE_REL,
  'requireStaff("/assistant")',
  'requireStaff("/assistant/voice")',
  async () => checkIsRed(11)
);

await mutation(
  "27. The console's privacy note stops naming the browser vendor → check 11 red",
  VOICE_PAGE_REL,
  "the browser vendor&apos;s service",
  "its own speech service",
  async () => checkIsRed(11)
);

await mutation(
  "28. The autonomy panel offers stored levels off an unreadable table → check 11 red",
  AUTONOMY_PANEL_REL,
  "const storable = state.problem === null;",
  "const storable = true;",
  async () => checkIsRed(11)
);

await mutation(
  "29. The chat stops speaking its answers → check 11 red",
  CHAT_REL,
  "if (speakReplies && answer) {",
  "if (false) {",
  async () => checkIsRed(11)
);

await mutation(
  "30. Hands-free armed outside the console → check 11 red",
  CHAT_REL,
  'enabled: voiceMode === "console" && handsFree && !ambientArmed,',
  "enabled: handsFree,",
  async () => checkIsRed(11)
);

await mutation(
  "31. The Assistant console loses its voice controls → check 11 red",
  VOICE_CONSOLE_REL,
  'voiceMode="console"',
  'voiceMode="dictate"',
  async () => checkIsRed(11)
);

await mutation(
  "32. A storage call added to the transcription route → check 11 red",
  ROUTE_REL,
  "const MAX_UTTERANCES = 20;",
  "const MAX_UTTERANCES = 20;\nconst storageConfig = {};",
  async () => checkIsRed(11)
);

await mutation(
  "33. The strip stops reporting the two-minute cap → check 11 red",
  VOICE_STRIP_REL,
  "Stopped at two minutes — the clip was transcribed.",
  "The clip ended.",
  async () => checkIsRed(11)
);

await mutation(
  "34. The dock mic stops saying where its audio goes → check 11 red",
  VOICE_BUTTON_REL,
  "goes to the transcription model and is discarded",
  "is recorded",
  async () => checkIsRed(11)
);

const WAKE_HOOK_REL = "src/modules/assistant/presentation/voice/useWakeWord.ts";

await mutation(
  "35. The whole sentence is sent as the approval code → check 12 red",
  CHAT_REL,
  'approve(live, saidCode ?? "", "assistant voice")',
  'approve(live, live.code ? text : "", "assistant voice")',
  async () => checkIsRed(12)
);

await mutation(
  "36. A code that was never said is answered as if it had been → check 12 red",
  VOICE_REL,
  '  return at === -1 ? null : spoken.slice(at, at + wanted.length);',
  '  return at === -1 ? wanted : spoken.slice(at, at + wanted.length);',
  async () => checkIsRed(12)
);

await mutation(
  "37. The saved turn is the folded match, not the words spoken → check 12 red",
  VOICE_REL,
  '  return transcript.trim().split(/\\s+/).slice(words).join(" ");',
  '  return fold(transcript).split(" ").slice(words).join(" ");',
  async () => checkIsRed(12)
);

await mutation(
  "38. The recognizer restarts into a refused microphone → check 13 red",
  WAKE_HOOK_REL,
  "if (!active || suspended || stopped) return;",
  "if (!active || suspended) return;",
  async () => checkIsRed(13)
);

await mutation(
  "39. The strip claims silence while a clip is being recorded → check 13 red",
  VOICE_STRIP_REL,
  "Recording — this clip goes to the transcription model, and is discarded once the words come back.",
  "Nothing is being recorded.",
  async () => checkIsRed(13)
);

await mutation(
  "40. An empty wake phrase leaves hands-free listening for nothing → check 13 red",
  CHAT_REL,
  "const phrase = wakePhrase.trim() || DEFAULT_WAKE_PHRASE;",
  "const phrase = wakePhrase;",
  async () => checkIsRed(13)
);

await mutation(
  "41. A save that throws leaves the autonomy panel spinning → check 13 red",
  AUTONOMY_PANEL_REL,
  "    } finally {\n      setBusy(null);\n    }",
  "    } finally {\n      // released by the caller\n    }",
  async () => checkIsRed(13)
);

await mutation(
  "42. The console rewrites its address on every answer → check 13 red",
  VOICE_CONSOLE_REL,
  "if (reportedSession.current !== sessionId) {",
  "if (true) {",
  async () => checkIsRed(13)
);

await mutation(
  "43. The panel offers hands-free to an account without the grant → check 11 red",
  AUTONOMY_PANEL_REL,
  '            (level === "open" && !state.canOpen);',
  "            false;",
  async () => checkIsRed(11)
);

await mutation(
  "44. A spoken question discards what was typed → check 13 red",
  CHAT_REL,
  "if (draftRef.current.trim() || attachment) {",
  "if (false) {",
  async () => checkIsRed(13)
);

await mutation(
  "45. A disarmed console keeps the last run's blocked-microphone alert → check 13 red",
  WAKE_HOOK_REL,
  "      setError(null);\n    };",
  "    };",
  async () => checkIsRed(13)
);

const USE_SPEECH_REL = "src/modules/assistant/presentation/voice/useSpeech.ts";

// The two defects the whole-slice review found in the voice path: the console
// hearing itself, and a recogniser batch starting two turns at once. Each
// mutation removes exactly one half of the fix, so a check that stayed green
// would be a fix that does not hold.

await mutation(
  "46. The echo guard dropped where the finals land → check 14 red",
  CHAT_REL,
  "if (speech.speaking || speech.echoedOwnVoice(text)) return;",
  "if (speech.speaking) return;",
  async () => checkIsRed(14)
);

await mutation(
  "47. The window timed from the hand-over, never from the end of playback → check 14 red",
  USE_SPEECH_REL,
  "      utterance.onend = () => {\n        hearAgain();\n        done();\n      };",
  "      utterance.onend = done;",
  async () => checkIsRed(14)
);

await mutation(
  "48. The words are never recorded, so nothing can be recognised as an echo → check 14 red",
  USE_SPEECH_REL,
  "{ text: next.text, at: Date.now() },",
  "// recorded by the platform, not here",
  async () => checkIsRed(14)
);

await mutation(
  "49. A voice list still loading is called a voiceless device → check 14 red",
  USE_SPEECH_REL,
  "      if (voices.current.length === 0) return;",
  '      if (voices.current.length === 0) {\n        setError("This device has no English voice installed — the answer stays on screen.");\n        queue.current = [];\n        return;\n      }',
  async () => checkIsRed(14)
);

await mutation(
  "50. A spoken turn never checks the latch → check 14 red",
  CHAT_REL,
  "if (!prompt || pending || extracting || inFlightRef.current) return;",
  "if (!prompt || pending || extracting) return;",
  async () => checkIsRed(14)
);

await mutation(
  "51. An approval never checks the latch → check 14 red",
  CHAT_REL,
  "if (approving || pending || inFlightRef.current) return;",
  "if (approving || pending) return;",
  async () => checkIsRed(14)
);

await mutation(
  "52. A finished turn keeps the latch held → check 14 red",
  CHAT_REL,
  "inFlightRef.current = false;",
  "// held by whoever set it",
  async () => checkIsRed(14)
);

await mutation(
  "53. A second spoken verdict claims a release that did not run → check 14 red",
  CHAT_REL,
  'if (inFlightRef.current) {\n          setCaption("Not released — the first approval is still running.");',
  'if (false) {\n          setCaption("Not released — the first approval is still running.");',
  async () => checkIsRed(14)
);

// The gap the review named in check 11: it pinned a fragment, so inverting the
// test kept the fragment and stayed green. These are the checks a fragment could
// never fail.

await mutation(
  "54. A confirm card is released by a word → check 11 red",
  CHAT_REL,
  'if ((live.autonomy ?? "confirm") === "confirm") {',
  'if ((live.autonomy ?? "confirm") !== "confirm") {',
  async () => checkIsRed(11)
);

await mutation(
  "55. The listening line stops saying where the words go → check 11 red",
  VOICE_STRIP_REL,
  " — the browser sends what it hears to its own speech service.",
  ".",
  async () => checkIsRed(11)
);

// The chat cannot read the clock itself — a component-body function handed to a
// hook is render scope, and `react-hooks/purity` refuses `Date.now()` there — so
// the comparison lives behind a hook method. A stubbed method would keep every
// word the console says and still report it as someone else's voice.
await mutation(
  "56. The hook's echo test stops comparing → check 14 red",
  USE_SPEECH_REL,
  "isOwnVoiceEcho(heard, spokenRecently.current, Date.now())",
  "false",
  async () => checkIsRed(14)
);

// What the first fix round left open. Each of these is the half of that round the
// review named: a memory of one string, a comparison that ignores word edges, a
// Stop that does not cancel held words, and a wait read as render state.

await mutation(
  "57. The memory keeps only the newest utterance → check 14 red",
  VOICE_REL,
  "return spoken.some(",
  "return spoken.slice(-1).some(",
  async () => checkIsRed(14)
);

await mutation(
  "58. The memory is unbounded instead of the window's few strings → check 14 red",
  USE_SPEECH_REL,
  "].slice(-SPOKEN_MEMORY);",
  "];",
  async () => checkIsRed(14)
);

await mutation(
  "59. A restamp lands on the oldest utterance, not the one playing → check 14 red",
  USE_SPEECH_REL,
  "const newest = spokenRecently.current[spokenRecently.current.length - 1];",
  "const newest = spokenRecently.current[0];",
  async () => checkIsRed(14)
);

await mutation(
  "60. A heard word matches inside a longer spoken word → check 14 red",
  VOICE_REL,
  "const heardWords = ` ${came} `;",
  "const heardWords = came;",
  async () => checkIsRed(14)
);

await mutation(
  "61. A Stop leaves the queued sentences to play after the click that asked for quiet → check 14 red",
  USE_SPEECH_REL,
  "    queue.current = [];\n    producing.current = false;",
  "    producing.current = false;",
  async () => checkIsRed(14)
);

await mutation(
  "62. The wake-follow wait is read as render state → check 14 red",
  CHAT_REL,
  "if (!awaitingRef.current) return;",
  "if (!awaiting) return;",
  async () => checkIsRed(14)
);

// The two halves of the echo window the review found unpinned, and the wait the
// guard is supposed to keep open. Each mutation removes exactly one restamp site
// or moves one line, so a check that stayed green would be a window that closes
// early or a person's next sentence dropped.

await mutation(
  "63. The window is not opened when playback starts → check 14 red",
  USE_SPEECH_REL,
  "      utterance.onstart = () => {\n        setSpeaking(true);\n        setError(null);\n        hearAgain();\n      };",
  "      utterance.onstart = () => {\n        setSpeaking(true);\n        setError(null);\n      };",
  async () => checkIsRed(14)
);

await mutation(
  "64. A cancelled utterance does not restamp the window → check 14 red",
  USE_SPEECH_REL,
  "          hearAgain();\n          done();\n          return;",
  "          done();\n          return;",
  async () => checkIsRed(14)
);

await mutation(
  "65. An echo ends the wait for the person's own next words → check 14 red",
  CHAT_REL,
  "if (speech.speaking || speech.echoedOwnVoice(text)) return;\n    markAwaiting(false);",
  "markAwaiting(false);\n    if (speech.speaking || speech.echoedOwnVoice(text)) return;",
  async () => checkIsRed(14)
);

// The voice slice this round fixes: every surface speaks when reading is on, the
// switch that turns it on exists outside the console, and a voice list still
// loading is no longer reported as a voiceless machine.

const SETTINGS_REL = "src/app/(admin)/assistant/AssistantSettings.tsx";

await mutation(
  "66. Spoken answers are confined to the console again → check 11 red",
  CHAT_REL,
  "if (speakReplies && answer) {",
  'if (voiceMode === "console" && speakReplies && answer) {',
  async () => checkIsRed(11)
);

await mutation(
  "67. The settings panel's read-aloud switch is stuck off → check 11 red",
  SETTINGS_REL,
  "checked={speak.on}",
  "checked={false}",
  async () => checkIsRed(11)
);

await mutation(
  "68. The dock and the Assistant page are given no switch at all → check 11 red",
  CHAT_REL,
  'speak={voiceMode === "console" ? null : {',
  "speak={true ? null : {",
  async () => checkIsRed(11)
);

await mutation(
  "69. A loading voice list is called a voiceless device again → check 15 red",
  JARVIS_VOICE_REL,
  "        if (holdTimer.current === null) {",
  '        setNotice("This device has no voice installed, so the sentence stays on screen.");\n        if (false) {',
  async () => checkIsRed(15)
);

await mutation(
  "70. Nothing replays a queued sentence when the voice list arrives → check 15 red",
  JARVIS_VOICE_REL,
  "      deviceVoices.current = window.speechSynthesis.getVoices();\n      pump();",
  "      deviceVoices.current = window.speechSynthesis.getVoices();",
  async () => checkIsRed(15)
);

await mutation(
  "71. A finished sentence releases its watcher only when the next one is handed over → check 15 red",
  JARVIS_VOICE_REL,
  "        next.resolve();\n        pumpRef.current();",
  "        pumpRef.current();",
  async () => checkIsRed(15)
);

// The truncation itself. Each of these restores one of the three ways the console
// cut off its own speech, and check 14 or 15 must see it: the cancel that opened
// every sentence, the unmount that silenced the other surface, and the queue that
// kept speaking after a Stop.

await mutation(
  "72. Every queued sentence cancels the one being heard → check 14 red",
  USE_SPEECH_REL,
  "      queue.current = [...queue.current, ...pieces];\n      pump();",
  "      window.speechSynthesis.cancel();\n      queue.current = [...queue.current, ...pieces];\n      pump();",
  async () => checkIsRed(14)
);

await mutation(
  "73. An unmount silences whatever the other surface was saying → check 14 red",
  USE_SPEECH_REL,
  "if (producing.current) window.speechSynthesis.cancel();",
  "window.speechSynthesis.cancel();",
  async () => checkIsRed(14)
);

await mutation(
  "74. The orb cancels the sentence it was handed → check 15 red",
  JARVIS_VOICE_REL,
  "      const sentence = text.trim();\n      if (!sentence) return;",
  "      const sentence = text.trim();\n      if (!sentence) return;\n      stopDevice();",
  async () => checkIsRed(15)
);

await mutation(
  "75. The orb's unmount silences the chat mid-answer → check 15 red",
  JARVIS_VOICE_REL,
  "      if (producing.current) stopDevice();",
  "      stopDevice();",
  async () => checkIsRed(15)
);

await mutation(
  "76. A queued answer is cut to the piece the device was handed → check 5 red",
  VOICE_REL,
  "      if (rest) pieces.push(rest);",
  "      // the device is not handed more than a piece",
  async () => checkIsRed(5)
);

await mutation(
  "77. Sentences are packed without a ceiling, so one piece is the whole answer → check 5 red",
  VOICE_REL,
  "    if (last && `${last} ${sentence}`.length <= limit) pieces[pieces.length - 1] = `${last} ${sentence}`;",
  "    if (last) pieces[pieces.length - 1] = `${last} ${sentence}`;",
  async () => checkIsRed(5)
);

await mutation(
  "78. A spoken answer is clipped to a size again → check 5 red",
  VOICE_REL,
  "  return text;\n}",
  '  return text.length > 600 ? `${text.slice(0, 600)} — the rest is on screen —` : text;\n}',
  async () => checkIsRed(5)
);

await mutation(
  "79. A rate from a stale tab is passed to the device unchecked → check 5 red",
  VOICE_REL,
  "  const clamped = Math.min(SPEECH_RATE_MAX, Math.max(SPEECH_RATE_MIN, parsed));",
  "  const clamped = parsed;",
  async () => checkIsRed(5)
);

await mutation(
  "80. A voice chosen on another machine is kept, so nothing speaks → check 5 red",
  VOICE_REL,
  "    if (chosen) return chosen;",
  "    if (chosen) return chosen;\n    if (wantedVoice) return null;",
  async () => checkIsRed(5)
);

const PREFS_REL = "src/app/(admin)/assistant/AssistantPrefs.tsx";
const ORB_REL = "src/modules/assistant/presentation/JarvisPresence.tsx";
const PANEL_REL = "src/app/(admin)/settings/JarvisPresenceConsole.tsx";

await mutation(
  "81. A chosen voice is stored under the wake-phrase key → check 16 red",
  PREFS_REL,
  "window.localStorage.setItem(VOICE_ID_KEY, clean);",
  "window.localStorage.setItem(WAKE_KEY, clean);",
  async () => checkIsRed(16)
);

await mutation(
  "82. Going back to the device default leaves the old name in the store → check 16 red",
  PREFS_REL,
  "    else window.localStorage.removeItem(VOICE_ID_KEY);",
  "    else window.localStorage.setItem(VOICE_ID_KEY, \"\");",
  async () => checkIsRed(16)
);

await mutation(
  "83. A pace change is stored but never reaches the orb that is speaking → check 16 red",
  PREFS_REL,
  "    else window.localStorage.setItem(SPEECH_RATE_KEY, String(clean));\n  } catch {\n    // Storage blocked — the choice is not remembered.\n  }\n  notifyVoicePrefs();",
  "    else window.localStorage.setItem(SPEECH_RATE_KEY, String(clean));\n  } catch {\n    // Storage blocked — the choice is not remembered.\n  }",
  async () => checkIsRed(16)
);

await mutation(
  "84. A pace is read out of the store unclamped → check 16 red",
  PREFS_REL,
  "return normaliseSpeechRate(window.localStorage.getItem(SPEECH_RATE_KEY));",
  "return Number(window.localStorage.getItem(SPEECH_RATE_KEY)) || DEFAULT_SPEECH_RATE;",
  async () => checkIsRed(16)
);

await mutation(
  "85. The chat is given the chosen voice but not the chosen pace → check 16 red",
  CHAT_REL,
  "const speech = useSpeech({ voiceId, rate: speechRate });",
  "const speech = useSpeech({ voiceId });",
  async () => checkIsRed(16)
);

await mutation(
  "86. The orb is given the chosen voice but not the chosen pace → check 16 red",
  ORB_REL,
  "const voice = useJarvisVoice({ voiceId, rate: speechRate });",
  "const voice = useJarvisVoice({ voiceId });",
  async () => checkIsRed(16)
);

await mutation(
  "87. The presence speaks every sentence at the device default → check 16 red",
  "src/modules/assistant/presentation/useJarvisVoice.ts",
  "      utterance.rate = rate;",
  "",
  async () => checkIsRed(16)
);

await mutation(
  "88. The chat picks a voice by language alone, ignoring the chosen name → check 16 red",
  "src/modules/assistant/presentation/voice/useSpeech.ts",
  "const voice = pickDeviceVoice(voices.current, voiceId, next.language);",
  "const voice = pickDeviceVoice(voices.current, \"\", next.language);",
  async () => checkIsRed(16)
);

await mutation(
  "89. The voice list silences the orb when the panel closes → check 16 red",
  "src/modules/assistant/presentation/voice/useDeviceVoices.ts",
  "      window.speechSynthesis.removeEventListener(\"voiceschanged\", read);",
  "      window.speechSynthesis.removeEventListener(\"voiceschanged\", read);\n      window.speechSynthesis.cancel();",
  async () => checkIsRed(16)
);

await mutation(
  "90. The preview cancels the briefing to get its own turn → check 16 red",
  PANEL_REL,
  "    window.speechSynthesis.speak(utterance);",
  "    window.speechSynthesis.cancel();\n    window.speechSynthesis.speak(utterance);",
  async () => checkIsRed(16)
);

await mutation(
  "91. The preview sample says the wake phrase → check 16 red",
  PANEL_REL,
  "const PREVIEW_SENTENCE = \"Two offers are waiting for an answer today.\";",
  "const PREVIEW_SENTENCE = \"Hey Jarvis, two offers are waiting.\";",
  async () => checkIsRed(16)
);

await mutation(
  "92. A voice this machine lost is displayed as if it were chosen → check 16 red",
  PANEL_REL,
  "value={voiceMissing ? \"\" : voiceId}",
  "value={voiceId}",
  async () => checkIsRed(16)
);

await mutation(
  "93. The pace and the voice grey out with the account row they are not stored on → check 16 red",
  PANEL_REL,
  "            aria-label=\"Voice\"",
  "            aria-label=\"Voice\"\n            disabled={locked}",
  async () => checkIsRed(16)
);

await mutation(
  "94. The slider offers the device's whole range rather than the portal's → check 16 red",
  PANEL_REL,
  "              min={SPEECH_RATE_MIN}\n              max={SPEECH_RATE_MAX}",
  "              min={0.1}\n              max={10}",
  async () => checkIsRed(16)
);

await mutation(
  "95. An absent pace reads as the number zero, so the reset lands on the floor → check 5 red",
  VOICE_REL,
  '  if (value === null || value === undefined || value === "") return DEFAULT_SPEECH_RATE;',
  "  // absence is not answered here",
  async () => checkIsRed(5)
);

await mutation(
  "96. Going back to a normal pace re-writes the factor instead of clearing it → check 16 red",
  PREFS_REL,
  "    if (clean === DEFAULT_SPEECH_RATE) window.localStorage.removeItem(SPEECH_RATE_KEY);",
  "    if (clean === DEFAULT_SPEECH_RATE) window.localStorage.setItem(SPEECH_RATE_KEY, \"1\");",
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
