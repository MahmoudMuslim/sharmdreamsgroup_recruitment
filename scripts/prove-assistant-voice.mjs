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
// 5. What an answer sounds like: markup stripped, table named, cut stated
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

  const long = `${"A sentence that keeps going. ".repeat(40)}FINAL`;
  const clipped = voice.spokenSummary(long);
  if (clipped.length > voice.SPOKEN_SUMMARY_CHARS + 40) problems.push(`clip too long: ${clipped.length}`);
  if (!/rest is on screen/i.test(clipped)) problems.push("clip did not say it cut");
  if (clipped.includes("FINAL")) problems.push("clip kept the tail");
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
  const page = read("src/app/(admin)/assistant/voice/page.tsx");
  if (!page.includes('requireStaff("/assistant/voice")')) problems.push("page is not staff-gated");
  if (!page.includes("await connection()")) problems.push("page does not await connection()");
  if (!page.includes("instant = false")) problems.push("page is not marked instant = false");

  const consoleCopy = read("src/app/(admin)/assistant/voice/VoiceConsole.tsx");
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
  const button = read("src/app/(admin)/assistant/voice/VoiceButton.tsx");
  if (!button.includes("goes to the transcription model and is discarded")) {
    problems.push("the dock mic does not say where its audio goes");
  }

  // The two-minute cap is the recorder's, so the surface must say it happened.
  const strip = read("src/app/(admin)/assistant/voice/VoiceStrip.tsx");
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
  const panel = read("src/app/(admin)/assistant/voice/AutonomyPanel.tsx");
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

  // The Assistant page links to the console the Guide describes.
  const assistantPage = read("src/app/(admin)/assistant/page.tsx");
  if (!assistantPage.includes("/assistant/voice")) {
    problems.push("the Assistant page does not link to the voice console");
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
  const hook = read("src/app/(admin)/assistant/voice/useWakeWord.ts");
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
  const strip = read("src/app/(admin)/assistant/voice/VoiceStrip.tsx");
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
  const panel = read("src/app/(admin)/assistant/voice/AutonomyPanel.tsx");
  if (!panel.includes("if (busy) return;")) problems.push("the panel ignores its own spinner");
  if (!panel.includes("    } finally {\n      setBusy(null);\n    }")) {
    problems.push("a save that throws leaves the autonomy panel spinning forever");
  }
  if (!panel.includes("setNotice(")) {
    problems.push("the panel has a button that does nothing and never says so");
  }

  // The conversation id arrives on every answer; rewriting the address each time
  // would push the router once per turn.
  const consoleFile = read("src/app/(admin)/assistant/voice/VoiceConsole.tsx");
  if (!consoleFile.includes("if (reportedSession.current === id) return;")) {
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
// 14. The console cannot hear itself, and one turn runs at a time
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

  // The window runs from the last moment the device was producing sound. A
  // 600-character answer plays for tens of seconds, so a window timed from the
  // hand-over would expire long before the echo of its tail arrived.
  const speechHook = read("src/app/(admin)/assistant/voice/useSpeech.ts");
  for (const needle of [
    "const SPOKEN_MEMORY = 8;",
    "const spokenRecently = useRef<{ text: string; at: number }[]>([]);",
    "{ text: spoken, at: Date.now() },",
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
  // The words a Stop cancelled must not come back when the voice list arrives:
  // replaying them would cut off whatever the person moved on to.
  if (!/const stop = useCallback\(\(\) => \{[\s\S]{0,600}?waitingForVoices\.current = null;/.test(speechHook)) {
    problems.push("a Stop leaves held words that play when the voice list finally arrives");
  }

  // A voice list that has not loaded is not a voiceless device. The words are
  // held for the `voiceschanged` pass instead of blaming the person's machine.
  if (!speechHook.includes("if (voices.length === 0) {")) {
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
  const awaitingWriter = read("src/app/(admin)/assistant/voice/useJarvisHandoff.ts");
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
// 15. The presence holds a sentence until the device names its voices
// ---------------------------------------------------------------------------
const JARVIS_VOICE_REL = "src/modules/assistant/presentation/useJarvisVoice.ts";

async function check15() {
  const problems = [];
  // Comments are stripped: the file explains the empty-list rule in prose, and a
  // substring scan would read the explanation as the code that breaks it.
  const code = read(JARVIS_VOICE_REL)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  // `getVoices()` answers with an empty list on the first call while the platform
  // loads its voices. That is not a voiceless machine, and the presence used to
  // say so, drop the sentence and leave a briefing unspoken on a device that
  // could have read it. The words are held for the `voiceschanged` pass instead.
  for (const needle of [
    "const waiting = useRef<string | null>(null);",
    "waiting.current = text;",
    "if (!held || deviceVoices.current.length === 0) return;",
    "speakOnDevice(held)",
    "const outcome = speakOnDevice(sentence);",
  ]) {
    if (!code.includes(needle)) problems.push(`useJarvisVoice is missing: ${needle}`);
  }
  // A list that never arrives is not a list still loading: after the grace the
  // hold is given up with the sentence the machine can act on — the note.
  if (!code.includes("This device has no voice installed, so the sentence stays on screen.")) {
    problems.push("a voice list that never arrives leaves the sentence held forever");
  }
  // The specific reason must survive `say()`: it used to be overwritten with a
  // generic "nothing to say out loud" by the caller that had just set it.
  if (code.includes("The assistant has nothing to say out loud in this tab yet.")) {
    problems.push("say() overwrites the device-voice notice with a generic one");
  }
  // The empty list must not set the notice on the spot.
  if (/if \(voices\.length === 0\) \{\s*setNotice/.test(code)) {
    problems.push("a still-loading voice list is reported as no voice installed");
  }
  // A Stop cancels held words, or the list arriving later replays a sentence the
  // person already silenced.
  if (!/const stop = useCallback\(\(\) => \{[\s\S]{0,400}?waiting\.current = null;/.test(code)) {
    problems.push("a Stop leaves held words to play when the voice list arrives");
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
  ["5. A spoken answer has no markup, names a table, and says where the cut is", check5],
  ["6. The spoken language follows the script written", check6],
  ["7. Migration 046 is authored with own-row policies and no audio column", check7],
  ["8. A stored open without the grant is only ever confirm", check8],
  ["9. A code-mode card carries a code; a wrong code does not consume it", check9],
  ["10. The route refuses anonymous, oversize, foreign and repeated bodies", check10],
  ["11. The voice page is staff-gated, and every surface says where audio goes", check11],
  ["12. A spoken code and a spoken question reach the server as said", check12],
  ["13. The microphone reports what it is doing, and a refusal stops", check13],
  ["14. The console cannot hear itself, and one turn runs at a time", check14],
  ["15. The presence holds a sentence until the device names its voices", check15],
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
const VOICE_PAGE_REL = "src/app/(admin)/assistant/voice/page.tsx";
const VOICE_CONSOLE_REL = "src/app/(admin)/assistant/voice/VoiceConsole.tsx";
const AUTONOMY_PANEL_REL = "src/app/(admin)/assistant/voice/AutonomyPanel.tsx";
const VOICE_STRIP_REL = "src/app/(admin)/assistant/voice/VoiceStrip.tsx";
const VOICE_BUTTON_REL = "src/app/(admin)/assistant/voice/VoiceButton.tsx";
const ASSISTANT_PAGE_REL = "src/app/(admin)/assistant/page.tsx";
const CHAT_REL = "src/app/(admin)/assistant/AssistantChat.tsx";

await mutation(
  "26. The voice page guards a different route → check 11 red",
  VOICE_PAGE_REL,
  'requireStaff("/assistant/voice")',
  'requireStaff("/assistant")',
  async () => checkIsRed(11)
);

await mutation(
  "27. The console's privacy note stops naming the browser vendor → check 11 red",
  VOICE_CONSOLE_REL,
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
  "31. The Assistant page loses its Voice link → check 11 red",
  ASSISTANT_PAGE_REL,
  'href="/assistant/voice"',
  'href="/assistant"',
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

const WAKE_HOOK_REL = "src/app/(admin)/assistant/voice/useWakeWord.ts";

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
  "if (reportedSession.current === id) return;",
  "if (false) return;",
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

const USE_SPEECH_REL = "src/app/(admin)/assistant/voice/useSpeech.ts";

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
  "      utterance.onend = () => {\n        setSpeaking(false);\n        hearAgain();\n      };",
  "      utterance.onend = () => setSpeaking(false);",
  async () => checkIsRed(14)
);

await mutation(
  "48. The words are never recorded, so nothing can be recognised as an echo → check 14 red",
  USE_SPEECH_REL,
  "{ text: spoken, at: Date.now() },",
  "// recorded by the platform, not here",
  async () => checkIsRed(14)
);

await mutation(
  "49. A voice list still loading is called a voiceless device → check 14 red",
  USE_SPEECH_REL,
  "if (voices.length === 0) {",
  "if (false) {",
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
  "61. A Stop leaves the held words to play when the voice list arrives → check 14 red",
  USE_SPEECH_REL,
  "    waitingForVoices.current = null;\n  }, []);",
  "  }, []);",
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
  "          hearAgain();\n          return;",
  "          return;",
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
  "        waiting.current = text;",
  '        setNotice("This device has no voice installed, so the sentence stays on screen.");',
  async () => checkIsRed(15)
);

await mutation(
  "70. Nothing replays a held sentence → check 15 red",
  JARVIS_VOICE_REL,
  "      if (!held || deviceVoices.current.length === 0) return;",
  "      return;",
  async () => checkIsRed(15)
);

await mutation(
  "71. say() overwrites the note the device voice just wrote → check 15 red",
  JARVIS_VOICE_REL,
  "      const outcome = speakOnDevice(sentence);",
  '      const outcome = speakOnDevice(sentence);\n      if (outcome === "failed") setNotice("The assistant has nothing to say out loud in this tab yet.");',
  async () => checkIsRed(15)
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
