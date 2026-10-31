# The Assistant, Spoken — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the staff assistant a microphone — push-to-talk dictation in the dock and the Assistant page, a hands-free voice console, spoken replies, and a per-account autonomy level that decides whether a spoken word can release a held write — while never storing a byte of audio.

**Architecture:** One pure domain module holds every rule (wake phrase, spoken verdict, code, speech summary, language). A staff-guarded route transcribes clips through the Gemini path the pitch recorder already uses and returns text only. The existing `AssistantChat` gains a `voiceMode` prop rather than being forked: `dictate` adds a mic beside the composer, `console` adds the hands-free strip and speaks replies. Approvals gain an optional four-character code, minted when the caller's stored autonomy is `code`, verified before the single-use take. The autonomy setting is one row per profile in a new, **authored-not-applied** migration `046`.

**Tech Stack:** Next.js 16.4 (App Router, `cacheComponents`, server actions), TypeScript, React 19, MediaRecorder + Web Speech API in the browser, Gemini inline-audio transcription through `src/modules/screening/infrastructure/aiGateway.ts`, self-hosted Postgres/PostgREST with RLS, Node proof scripts under `scripts/`.

**Spec:** `docs/superpowers/specs/2026-10-27-assistant-voice-design.md`

## Global Constraints

- **This is NOT the Next.js you know.** Read `node_modules/next/dist/docs/` when an API looks unfamiliar; run `npx next typegen` before every `tsc --noEmit`.
- **Migration 046 is authored only.** Do not apply it, do not fold it into `db/schema.sql`, and do not run any DDL against the local database in this slice. Applying it is a separate, explicitly approved act (`npm run docker:psql -f db/migrations/046_assistant_voice_autonomy.sql`).
- **Audio is never stored.** Not in a bucket, not in a row, not in a log, not in the transcript, not in a generated file. Only the transcript text is kept, and only when the person sends the turn.
- **No candidate portal work.** Do not touch `src/app/(candidate)/`, `NoticeInbox`, or `communication_logs` read/dismiss paths.
- **No job-board or ATS integration.** Nothing in this plan calls an external job board.
- **Staff console copy stays English.** No new i18n dictionary keys; the voice surface uses the same English console voice.
- **Never print secrets.** Provider checks are status-only; do not echo `docker/.env` or `.env.local`.
- **Never kill the dev server on `localhost:3001`.** Use it for live proofs; do not start a conflicting production build.
- **Commits:** the owner's standing rule is commit only when asked. Each task ends with a checkpoint; treat "Commit" as "report and wait for the owner" unless commits were explicitly requested.
- **Proof scripts run with:** `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/modules/assistant/domain/voice.ts` (new) | Pure rules: autonomy vocabulary, wake phrase matching, spoken code mint/normalise, spoken verdict, speech summary, spoken language. No imports. |
| `src/modules/assistant/domain/approvals.ts` (modify) | Optional code on a held write; `checkApprovalCode` peeks without consuming. |
| `src/modules/assistant/application/voiceSettings.ts` (new) | Read/write one profile's autonomy; `open` gated by `settings.manage_platform`; activity row; 046-missing fallback. |
| `src/app/api/assistant/voice/route.ts` (new) | Staff-only transcription door: 401/413/415/429, MIME normalisation, `{ text }` only. |
| `src/modules/assistant/infrastructure/agent.ts` (modify) | Gateway engine passes autonomy to `mintApproval`. |
| `src/modules/assistant/infrastructure/qoderAgent.ts` (modify) | Qoder engine passes autonomy to `mintApproval`. |
| `src/app/(admin)/assistant/actions.ts` (modify) | Reads autonomy once per turn; approval action verifies a code and names the surface. |
| `src/app/(admin)/assistant/AssistantApprovalCard.tsx` (modify) | Shows the code, takes the code, passes it with the click. |
| `src/app/(admin)/assistant/AssistantChat.tsx` (modify) | `voiceMode`, mic, transcript insertion, spoken replies, hands-free wiring. |
| `src/app/(admin)/assistant/AssistantPrefs.tsx` (modify) | Wake phrase, speak toggle, recognition language in `localStorage`. |
| `src/app/(admin)/assistant/page.tsx` (modify) | A Voice pill in the header that opens `/assistant/voice`. |
| `src/app/(admin)/assistant/voice/useRecorder.ts` (new) | `getUserMedia` → `MediaRecorder`; format negotiation, 120 s cap, cancel on unmount/hidden tab. |
| `src/app/(admin)/assistant/voice/useSpeech.ts` (new) | `speechSynthesis`, voice chosen by script, stop, honest "no voice installed". |
| `src/app/(admin)/assistant/voice/useWakeWord.ts` (new) | Browser recognizer lifecycle while armed; restarts; reports refusal. |
| `src/app/(admin)/assistant/voice/transcribe.ts` (new) | The one client door to the route; returns text or a recruiter-readable error. |
| `src/app/(admin)/assistant/voice/VoiceButton.tsx` (new) | Small mic beside the composer (dictate mode). |
| `src/app/(admin)/assistant/voice/VoiceStrip.tsx` (new) | Console controls: push-to-talk, hands-free, wake phrase, language, speak toggle, stop. |
| `src/app/(admin)/assistant/voice/AutonomyPanel.tsx` (new) | The three levels, what each does, and the 046 fallback sentence. |
| `src/app/(admin)/assistant/voice/VoiceConsole.tsx` (new) | Page body: privacy note, the chat in console mode, the autonomy panel. |
| `src/app/(admin)/assistant/voice/page.tsx` (new) | Server page: `connection()`, `requireStaff("/assistant/voice")`, reads autonomy. |
| `src/app/(admin)/assistant/voice/actions.ts` (new) | `"use server"` reads/writes for the panel. |
| `src/modules/activity/domain/trail.ts` (modify) | `"assistant voice"` joins `ACTIVITY_SURFACES`. |
| `src/modules/shell/domain/pageGuide.ts` (modify) | The `/assistant` manual learns the voice console. |
| `db/migrations/046_assistant_voice_autonomy.sql` (new) | One row per profile, own-row RLS, **authored not applied**. |
| `scripts/prove-assistant-voice.mjs` (new) | Domain, approval-code and route proofs with mutation checks. |

---

### Task 1: The voice domain and its proof

**Files:**
- Create: `src/modules/assistant/domain/voice.ts`
- Create: `scripts/prove-assistant-voice.mjs`

**Interfaces:**
- Consumes: nothing (the module has no imports).
- Produces:
  - `VOICE_AUTONOMY: readonly ["confirm","code","open"]`, `type VoiceAutonomy`
  - `DEFAULT_VOICE_AUTONOMY: VoiceAutonomy`, `isVoiceAutonomy(value: unknown): value is VoiceAutonomy`
  - `VOICE_AUTONOMY_LABELS`, `VOICE_AUTONOMY_HINTS: Record<VoiceAutonomy, string>`
  - `interface VoiceAutonomyState { level: VoiceAutonomy; stored: boolean; canOpen: boolean }`
  - `DEFAULT_WAKE_PHRASE: string`, `MAX_WAKE_PHRASE_CHARS: number`
  - `normalizeWakePhrase(phrase: string): string`
  - `interface WakeMatch { matched: boolean; remainder: string }`, `matchWakePhrase(transcript: string, phrase: string): WakeMatch`
  - `SPOKEN_CODE_LENGTH: 4`, `mintSpokenCode(random?: () => number): string`, `normalizeSpokenCode(text: string): string`
  - `type SpokenVerdict = "approve" | "cancel" | null`, `spokenApproval(transcript: string, code: string | null): SpokenVerdict`
  - `SPOKEN_SUMMARY_CHARS: 600`, `spokenSummary(markdown: string): string`
  - `speechLanguageOf(text: string): "ar" | "en" | null`

- [ ] **Step 1: Write the failing proof**

Create `scripts/prove-assistant-voice.mjs`. This file is the whole slice's fixture proof; later tasks append checks to it.

```js
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
 * check that must notice, and restores the file in a `finally`.
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
const load = (url) => import(`${url}?v=${Date.now()}`);

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
  expect(
    problems,
    "alef maqsura and hamza alef fold",
    voice.matchWakePhrase("يا جارفيس من ينتظر", "يا جارفي\u0650س"),
    { matched: true, remainder: "من ينتظر" }
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
  const code = voice.mintSpokenCode(() => 0.999999);
  expect(problems, "length", code.length, 4);
  if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) problems.push(`alphabet: got ${code}`);
  expect(problems, "normalise lower", voice.normalizeSpokenCode("k7q2"), "K7Q2");
  expect(problems, "normalise spaced", voice.normalizeSpokenCode(" K-7-Q-2 "), "K7Q2");
  expect(problems, "normalise arabic digits kept out", voice.normalizeSpokenCode("K٧Q٢"), "KQ");
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
// Harness
// ---------------------------------------------------------------------------
const CHECKS = [
  ["1. The wake phrase matches at the start, is stripped, and never matches mid-sentence", check1],
  ["2. Arabic folds harakat, tatweel and alef forms", check2],
  ["3. Cancel wins over approve; a code in play must be said", check3],
  ["4. The code is four characters, never 0/O/1/I, and compares case-free", check4],
  ["5. A spoken answer has no markup, names a table, and says where the cut is", check5],
  ["6. The spoken language follows the script written", check6],
];

for (const [name, run] of CHECKS) {
  results.push([name, await safe(run)]);
}

// Mutation proofs are added by the tasks that own the files they break.

const failed = results.filter(([, outcome]) => !outcome.pass);
console.log("");
for (const [name, outcome] of results) {
  console.log(`${outcome.pass ? "PASS" : "FAIL"}  ${name}`);
  if (!outcome.pass) console.log(`      ${outcome.detail}`);
}
for (const entry of mutations) {
  console.log(`${entry.pass ? "PASS" : "FAIL"}  ${entry.label}`);
  if (!entry.pass) console.log(`      ${entry.detail}`);
}
console.log("");
console.log(
  `${results.length - failed.length}/${results.length} checks held, ${mutations.filter((m) => m.pass).length}/${mutations.length} mutations turned red.`
);
process.exitCode = failed.length === 0 && mutations.every((m) => m.pass) ? 0 : 1;
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: every check FAILs with `threw: Failed to load url .../voice.ts`, and the process exits non-zero.

- [ ] **Step 3: Write the domain module**

Create `src/modules/assistant/domain/voice.ts`:

```ts
/**
 * The rules the assistant's voice surfaces share.
 *
 * Pure by design — no imports, nothing async — so every rule here is provable in
 * `scripts/prove-assistant-voice.mjs` without a browser, a database or a model.
 * What lives here is the decision-making: is this utterance a wake phrase, does
 * it approve or cancel, does it carry the code, what does a markdown answer sound
 * like, and which language is being spoken. Capture, transport and playback live
 * one layer out, where they can be seen.
 */

/* ------------------------------- Autonomy -------------------------------- */

export const VOICE_AUTONOMY = ["confirm", "code", "open"] as const;
export type VoiceAutonomy = (typeof VOICE_AUTONOMY)[number];

export const DEFAULT_VOICE_AUTONOMY: VoiceAutonomy = "confirm";

export const VOICE_AUTONOMY_LABELS: Record<VoiceAutonomy, string> = {
  confirm: "Confirm with a click",
  code: "Confirm with a code",
  open: "Hands-free",
};

export const VOICE_AUTONOMY_HINTS: Record<VoiceAutonomy, string> = {
  confirm:
    "Every write waits for your click. A spoken reply never releases one; the card reads aloud so you can hear what it would do.",
  code: "Every write waits for its four-character code, said with the word approve or typed on the card. The card shows the code.",
  open: "A write runs on the one click this console sends after it hears you say yes. Only an account holding settings.manage_platform may choose this.",
};

export interface VoiceAutonomyState {
  level: VoiceAutonomy;
  /** False while migration 046 is absent: only `confirm` can be offered or enforced. */
  stored: boolean;
  /** True when the signed-in person may choose `open`. */
  canOpen: boolean;
}

export function isVoiceAutonomy(value: unknown): value is VoiceAutonomy {
  return typeof value === "string" && (VOICE_AUTONOMY as readonly string[]).includes(value);
}

/* ------------------------------ Wake phrase ------------------------------ */

export const DEFAULT_WAKE_PHRASE = "Hey Jarvis";
export const MAX_WAKE_PHRASE_CHARS = 48;

/**
 * Case, punctuation, spacing and Arabic diacritics are noise in a spoken phrase.
 * Tatweel and harakat are drawn rather than pronounced, the alef forms sound
 * identical, and a recogniser is free to return any of them for the same words.
 */
function fold(text: string): string {
  return text
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWakePhrase(phrase: string): string {
  return fold(phrase);
}

export interface WakeMatch {
  matched: boolean;
  /** Everything after the phrase; empty when the phrase was the whole utterance. */
  remainder: string;
}

export function matchWakePhrase(transcript: string, phrase: string): WakeMatch {
  const spoken = fold(transcript);
  const wanted = normalizeWakePhrase(phrase);
  if (!wanted) return { matched: false, remainder: transcript.trim() };
  if (spoken !== wanted && !spoken.startsWith(`${wanted} `)) {
    return { matched: false, remainder: transcript.trim() };
  }
  return { matched: true, remainder: spoken.slice(wanted.length).trim() };
}

/* -------------------------------- Codes ---------------------------------- */

/**
 * No 0/O and no 1/I: a code is read aloud and typed back, and those are the
 * pairs people mishear. The list is a shape check, not a secret — the browser is
 * shown the code, so its job is to stop an accidental or overheard approval.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SPOKEN_CODE_LENGTH = 4;

export function mintSpokenCode(random: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < SPOKEN_CODE_LENGTH; index += 1) {
    const at = Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[at];
  }
  return code;
}

/** Upper-case letters and digits only, so "K7Q2", "k7q2" and "k-7-q-2" agree. */
export function normalizeSpokenCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ------------------------------- Verdicts -------------------------------- */

export type SpokenVerdict = "approve" | "cancel" | null;

const APPROVE_WORDS = [
  "approve",
  "approved",
  "yes",
  "confirm",
  "go ahead",
  "do it",
  "send it",
  "موافق",
  "اوافق",
  "نعم",
];

const CANCEL_WORDS = ["cancel", "no", "stop", "don't", "do not", "الغاء", "إلغاء", "لا", "توقف"];

function saysAny(spoken: string, words: readonly string[]): boolean {
  const padded = ` ${spoken} `;
  return words.some((word) => padded.includes(` ${fold(word)} `));
}

/**
 * What a spoken utterance means about the card on screen.
 *
 * When a code is in play the utterance must carry it, for either verdict — a
 * bystander who says "yes" has not seen the code, and a "cancel" that omitted it
 * would be the only way to release a card without reading it. Cancel is checked
 * first so "approve — no, cancel" cancels.
 */
export function spokenApproval(transcript: string, code: string | null): SpokenVerdict {
  const spoken = fold(transcript);
  if (code !== null && code.trim() !== "") {
    const wanted = normalizeSpokenCode(code);
    if (!wanted || !normalizeSpokenCode(spoken).includes(wanted)) return null;
  }
  if (saysAny(spoken, CANCEL_WORDS)) return "cancel";
  if (saysAny(spoken, APPROVE_WORDS)) return "approve";
  return null;
}

/* --------------------------- Spoken summaries ---------------------------- */

export const SPOKEN_SUMMARY_CHARS = 600;

/**
 * An answer as it should be heard.
 *
 * Never markup: a synthesizer reads asterisks and pipe characters aloud. A
 * fenced block and a table are named rather than read, because they are read with
 * the eyes. Past the cap the cut is stated — an answer that silently stopped
 * halfway would sound complete.
 */
export function spokenSummary(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " — the code is on screen — ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " — the table is on screen — ")
    .replace(/(— the table is on screen —\s*)+/g, " — the table is on screen — ")
    .replace(/(— the code is on screen —\s*)+/g, " — the code is on screen — ")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length <= SPOKEN_SUMMARY_CHARS) return text;
  const cut = text.slice(0, SPOKEN_SUMMARY_CHARS);
  const boundary = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("؟"));
  const kept = boundary > SPOKEN_SUMMARY_CHARS * 0.6 ? cut.slice(0, boundary + 1) : cut.trim();
  return `${kept} … The rest is on screen.`;
}

/* ------------------------------- Language -------------------------------- */

export function speechLanguageOf(text: string): "ar" | "en" | null {
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return null;
  return arabic > latin ? "ar" : "en";
}
```

- [ ] **Step 4: Run the proof**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: `6/6 checks held, 0/0 mutations turned red.`

If check 5 fails on the clip length, the sentence boundary landed before 60% of the cap; print `spoken.length` and adjust the fixture's sentence length, not the cap.

- [ ] **Step 5: Add the mutation proofs**

Append to `scripts/prove-assistant-voice.mjs`, immediately before the `const failed = ...` line:

```js
const VOICE_REL = "src/modules/assistant/domain/voice.ts";
const mutated = (url) => import(`${url}?mutate=${Date.now()}`);
const checkIsRed = async (number, run = CHECKS[number - 1][1]) => {
  const outcome = await safe(run);
  return {
    pass: outcome.pass === false,
    detail: outcome.pass === false ? "check stayed green" : undefined,
  };
};

async function mutation(label, rel, needle, replacement, verify) {
  const file = path.join(root, rel);
  const original = readFileSync(file, "utf8");
  if (!original.includes(needle)) {
    mutations.push({ label, pass: false, detail: `needle not found in ${rel}` });
    return;
  }
  try {
    writeFileSync(file, original.replace(needle, replacement));
    mutations.push({ label, ...(await verify()) });
  } catch (cause) {
    mutations.push({ label, pass: false, detail: `threw: ${cause.message}` });
  } finally {
    writeFileSync(file, original);
  }
}

await mutation(
  "1. Wake phrase matched anywhere, not at the start → check 1 red",
  VOICE_REL,
  'if (spoken !== wanted && !spoken.startsWith(`${wanted} `)) {',
  "if (!spoken.includes(wanted)) {",
  async () => checkIsRed(1, async () => check1(await mutated(VOICE_URL)))
);

await mutation(
  "2. Cancel checked after approve → check 3 red",
  VOICE_REL,
  '  if (saysAny(spoken, CANCEL_WORDS)) return "cancel";\n  if (saysAny(spoken, APPROVE_WORDS)) return "approve";',
  '  if (saysAny(spoken, APPROVE_WORDS)) return "approve";\n  if (saysAny(spoken, CANCEL_WORDS)) return "cancel";',
  async () => checkIsRed(3, async () => check3(await mutated(VOICE_URL)))
);

await mutation(
  "3. A code in play no longer has to be said → check 3 red",
  VOICE_REL,
  "    if (!wanted || !normalizeSpokenCode(spoken).includes(wanted)) return null;",
  "    if (!wanted) return null;",
  async () => checkIsRed(3, async () => check3(await mutated(VOICE_URL)))
);
```

- [ ] **Step 6: Run the proof and confirm the mutations turn red**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: `6/6 checks held, 3/3 mutations turned red.`

- [ ] **Step 7: Checkpoint**

```bash
git status --short
```

Expected: exactly `src/modules/assistant/domain/voice.ts` and `scripts/prove-assistant-voice.mjs` are new. Report and wait for the owner before committing.

---

### Task 2: Migration 046, the autonomy reader, and its actions

**Files:**
- Create: `db/migrations/046_assistant_voice_autonomy.sql`
- Create: `src/modules/assistant/application/voiceSettings.ts`
- Create: `src/app/(admin)/assistant/voice/actions.ts`
- Modify: `scripts/prove-assistant-voice.mjs` (two text pins)

**Interfaces:**
- Consumes: `VoiceAutonomy`, `isVoiceAutonomy`, `DEFAULT_VOICE_AUTONOMY`, `VOICE_AUTONOMY_LABELS`, `VoiceAutonomyState` from `@/modules/assistant/domain/voice`.
- Produces:
  - `readVoiceAutonomy(profileId: string): Promise<VoiceAutonomyState>`
  - `saveVoiceAutonomy(level: string): Promise<{ ok: true; level: VoiceAutonomy } | { ok: false; error: string }>`
  - `getVoiceAutonomy(): Promise<VoiceAutonomyState>` and `setVoiceAutonomy(level: string)` server actions.

- [ ] **Step 1: Author the migration (do not apply it)**

Create `db/migrations/046_assistant_voice_autonomy.sql`:

```sql
-- ============================================================================
-- 046_assistant_voice_autonomy.sql
--
-- One word per person: what a spoken confirmation is allowed to do.
--
-- STATUS: authored here, NOT applied. Until it is applied the reader falls
--   back to `confirm`, and the voice console says so naming this file. `code`
--   and `open` are not offered while the table is absent, because a level that
--   cannot be stored cannot be enforced.
--
-- Why a row and not a cookie: a browser could otherwise upgrade itself from
--   "click" to "hands-free" by editing its own storage. The level is read by the
--   server when a card is minted, so the browser never gets a vote.
--
-- Why no audio anywhere: this table stores one word per person and nothing else.
--   Audio is never written to a table, a bucket or a log; only transcript text
--   reaches `assistant_messages`, and only when the person sends the turn.
--
-- See docs/superpowers/specs/2026-10-27-assistant-voice-design.md §Data model.
-- ============================================================================

create table if not exists public.assistant_voice_autonomy (
  profile_id uuid primary key references public.user_profiles (id) on delete cascade,
  mode text not null default 'confirm'
    check (mode in ('confirm', 'code', 'open')),
  updated_at timestamptz not null default now()
);

alter table public.assistant_voice_autonomy enable row level security;

-- Own row only. `current_user_profile_id()` is 020's security-definer helper, so
-- a policy does not read `user_profiles` from inside itself.
drop policy if exists assistant_voice_autonomy_own_read on public.assistant_voice_autonomy;
create policy assistant_voice_autonomy_own_read on public.assistant_voice_autonomy
  for select to authenticated
  using ((select current_user_profile_id()) = profile_id and is_staff());

drop policy if exists assistant_voice_autonomy_own_insert on public.assistant_voice_autonomy;
create policy assistant_voice_autonomy_own_insert on public.assistant_voice_autonomy
  for insert to authenticated
  with check ((select current_user_profile_id()) = profile_id and is_staff());

drop policy if exists assistant_voice_autonomy_own_update on public.assistant_voice_autonomy;
create policy assistant_voice_autonomy_own_update on public.assistant_voice_autonomy
  for update to authenticated
  using ((select current_user_profile_id()) = profile_id)
  with check ((select current_user_profile_id()) = profile_id);

-- The `open` level is not an RLS question: the policy has to let a person store
-- their own row, and `open` is refused in voiceSettings.ts by the administrative
-- grant. RLS says "this is your row"; it does not say "you may choose this value".

grant select, insert, update on table public.assistant_voice_autonomy to authenticated;
grant all on table public.assistant_voice_autonomy to service_role;
revoke all on table public.assistant_voice_autonomy from anon;

-- PostgREST caches its view of the schema, so a REST read of the new table is
-- refused as an unknown resource until the API reloads.
notify pgrst, 'reload schema';
-- Next file: 047.
```

- [ ] **Step 2: Write the reader and writer**

Create `src/modules/assistant/application/voiceSettings.ts`:

```ts
import "server-only";

import { getSessionUser } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";
import { recordActivity } from "@/modules/activity/application/record";
import {
  DEFAULT_VOICE_AUTONOMY,
  VOICE_AUTONOMY_LABELS,
  isVoiceAutonomy,
  type VoiceAutonomy,
  type VoiceAutonomyState,
} from "@/modules/assistant/domain/voice";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

/**
 * What a spoken confirmation may do, per person.
 *
 * Read on the server whenever an approval card is minted, so the level cannot be
 * upgraded by a browser. Until 046 is applied the table is absent; the reader
 * answers `confirm` and says it is not stored, which is what makes "only confirm
 * is offered" true rather than a promise in a menu.
 */

const MIGRATION_MISSING =
  /42P01|PGRST205|PGRST204|does not exist|schema cache/i;

const MIGRATION_SENTENCE =
  "db/migrations/046_assistant_voice_autonomy.sql is authored but not applied, so only “confirm with a click” can be used.";

function missing(error: { code?: string | null; message?: string | null }): boolean {
  return MIGRATION_MISSING.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

export async function readVoiceAutonomy(profileId: string): Promise<VoiceAutonomyState> {
  const canOpen = await hasPermissionForUser("settings.manage_platform");
  const restClient = await createServerRestClient();

  const { data, error } = await restClient
    .from("assistant_voice_autonomy")
    .select("mode")
    .eq("profile_id", profileId)
    .maybeSingle();

  // A read that fails for any reason falls back to the safe level. A voice
  // setting is never worth failing a turn over.
  if (error) {
    if (!missing(error)) console.error("readVoiceAutonomy failed:", error.message);
    return { level: DEFAULT_VOICE_AUTONOMY, stored: false, canOpen };
  }
  if (!data) return { level: DEFAULT_VOICE_AUTONOMY, stored: true, canOpen };

  const mode = (data as { mode?: unknown }).mode;
  return {
    level: isVoiceAutonomy(mode) ? mode : DEFAULT_VOICE_AUTONOMY,
    stored: true,
    canOpen,
  };
}

export async function saveVoiceAutonomy(
  level: string
): Promise<{ ok: true; level: VoiceAutonomy } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again to change this setting." };
  if (!isVoiceAutonomy(level)) {
    return { ok: false, error: "That is not a voice setting this portal offers." };
  }
  if (level === "open" && !(await hasPermissionForUser("settings.manage_platform"))) {
    return {
      ok: false,
      error:
        "Hands-free approvals need the settings.manage_platform grant. Ask an administrator, or choose a level that waits for you.",
    };
  }

  const restClient = await createServerRestClient();
  const { error } = await restClient.from("assistant_voice_autonomy").upsert(
    {
      profile_id: user.profileId,
      mode: level,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" }
  );

  if (error) {
    if (missing(error)) return { ok: false, error: MIGRATION_SENTENCE };
    return { ok: false, error: `That setting could not be saved: ${error.message}` };
  }

  await recordActivity({
    area: "settings",
    action: "voice_autonomy_changed",
    entity: "setting",
    entityId: user.profileId,
    summary: `Voice approvals set to “${VOICE_AUTONOMY_LABELS[level]}”`,
    detail: { mode: level },
    actorId: user.profileId,
  });

  return { ok: true, level };
}
```

- [ ] **Step 3: Write the server actions**

Create `src/app/(admin)/assistant/voice/actions.ts`:

```ts
"use server";

import { requireStaff } from "@/lib/auth/session";
import {
  readVoiceAutonomy,
  saveVoiceAutonomy,
} from "@/modules/assistant/application/voiceSettings";
import type { VoiceAutonomy, VoiceAutonomyState } from "@/modules/assistant/domain/voice";

/** The voice console's own read, so the panel can refresh without a page reload. */
export async function getVoiceAutonomy(): Promise<VoiceAutonomyState> {
  const staff = await requireStaff("/assistant/voice");
  return readVoiceAutonomy(staff.profileId);
}

/** Saving is the only write here, and `open` is refused inside the application layer. */
export async function setVoiceAutonomy(
  level: string
): Promise<{ ok: true; level: VoiceAutonomy } | { ok: false; error: string }> {
  await requireStaff("/assistant/voice");
  return saveVoiceAutonomy(level);
}
```

- [ ] **Step 4: Pin the migration and the fallback sentence in the proof**

Insert before the `const CHECKS = [` array in `scripts/prove-assistant-voice.mjs`:

```js
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
  ]) {
    if (!sql.includes(needle)) problems.push(`046 is missing: ${needle}`);
  }
  if (/alter table .* add column .*audio/.test(sql)) problems.push("046 stores audio");
  const settings = read("src/modules/assistant/application/voiceSettings.ts");
  if (!settings.includes("046_assistant_voice_autonomy.sql")) {
    problems.push("voiceSettings does not name 046 in its fallback");
  }
  if (!/stored: false/.test(settings)) problems.push("no un-stored fallback");
  return verdict(problems);
}
```

Add the line to `CHECKS`:

```js
  ["7. Migration 046 is authored with own-row policies and no audio column", check7],
```

- [ ] **Step 5: Run the proof**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: `7/7 checks held, 3/3 mutations turned red.`

- [ ] **Step 6: Typecheck what exists so far**

Run: `npx next typegen && node_modules/.bin/tsc --noEmit`

Expected: no output, exit 0. (The new page file does not exist yet, so the action's `requireStaff("/assistant/voice")` is only a string here — fine.)

- [ ] **Step 7: Checkpoint**

```bash
git status --short
```

Expected: the migration, `voiceSettings.ts`, `voice/actions.ts` new; the proof script modified. **Do not run any DDL.**

---

### Task 3: The code on the card, and the surface it arrived through

**Files:**
- Modify: `src/modules/assistant/domain/approvals.ts`
- Modify: `src/modules/assistant/infrastructure/agent.ts`
- Modify: `src/modules/assistant/infrastructure/qoderAgent.ts`
- Modify: `src/app/(admin)/assistant/actions.ts`
- Modify: `src/modules/activity/domain/trail.ts`
- Modify: `src/app/(admin)/assistant/AssistantApprovalCard.tsx`
- Modify: `src/app/(admin)/assistant/AssistantChat.tsx` (the `approve()` signature only; the rest is Task 5)
- Modify: `scripts/prove-assistant-voice.mjs`

**Interfaces:**
- Consumes: `mintSpokenCode`, `normalizeSpokenCode`, `type VoiceAutonomy` from `./voice`.
- Produces:
  - `AssistantApproval.code?: string`
  - `AssistantApproval.autonomy?: VoiceAutonomy`
  - `mintApproval(tool: AssistantTool, args: ToolArgs, profileId: string, autonomy?: VoiceAutonomy): AssistantApproval`
  - `checkApprovalCode(id: string, profileId: string, spoken: string | null | undefined): "ok" | "missing" | "mismatch"`
  - `runAssistantTurn(..., allowWeb = false, autonomy: VoiceAutonomy = "confirm")`
  - `runQoderAssistantTurn(history, allowDestructive, allowWeb, profileId, autonomy: VoiceAutonomy = "confirm")`
  - `approveAssistantChange(input: { approvalId: string; sessionId?: string | null; spokenCode?: string; via?: "assistant" | "assistant voice" })`

- [ ] **Step 1: Add the failing approval checks**

Insert before `const CHECKS = [` in `scripts/prove-assistant-voice.mjs`:

```js
// ---------------------------------------------------------------------------
// 8. A code-mode card carries a code; a wrong code does not consume it
// ---------------------------------------------------------------------------
const APPROVALS_URL = pathToFileURL(
  path.join(root, "src/modules/assistant/domain/approvals.ts")
).href;
const tool = { name: "update_application_stage", label: "Move a stage", description: "Move it" };

async function check8() {
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
```

Add to `CHECKS`:

```js
  ["8. A code-mode card carries a code; a wrong code does not consume it", check8],
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: check 8 FAILs with `mintApproval is not a function`-class detail (`checkApprovalCode` missing) while checks 1–7 stay green.

- [ ] **Step 3: Implement the code on held approvals**

In `src/modules/assistant/domain/approvals.ts`:

Change the import at the top:

```ts
import { randomUUID, timingSafeEqual } from "node:crypto";
import { READ_ONLY_TOOLS, type AssistantTool, type ToolArgs } from "./tools";
import { mintSpokenCode, normalizeSpokenCode, type VoiceAutonomy } from "./voice";
```

Add to `AssistantApproval`, after `destructive`:

```ts
  /**
   * The four characters a `code`-mode card waits for.
   *
   * Absent on `confirm` and `open`. The browser is shown this — it is a challenge
   * against an accidental or overheard word, not a secret kept from the device.
   */
  code?: string;
  /**
   * The level this card was minted under.
   *
   * The browser reads it to decide whether a spoken word may release the card —
   * `confirm` never does, whatever was said. Optional because a card rehydrated
   * from an older transcript predates the field, and an unknown level must behave
   * like the safe one.
   */
  autonomy?: VoiceAutonomy;
```

`PendingApproval` inherits it.

Replace `mintApproval`'s signature and body:

```ts
/**
 * Hold one write back for a click, bound to the person who is signed in.
 *
 * `autonomy` is the person's stored level, read by the caller. Under `code` the
 * card carries a fresh challenge; under `confirm` and `open` it carries none,
 * because the click is the deliberate act.
 */
export function mintApproval(
  tool: AssistantTool,
  args: ToolArgs,
  profileId: string,
  autonomy: VoiceAutonomy = "confirm"
): AssistantApproval {
  prune();

  const expiresMs = Date.now() + APPROVAL_TTL_MS;
  const code = autonomy === "code" ? mintSpokenCode() : undefined;
  const approval: PendingApproval = {
    id: randomUUID(),
    tool: tool.name,
    label: tool.label,
    summary: summaryFor(tool, args),
    expiresAt: new Date(expiresMs).toISOString(),
    destructive: tool.destructive === true,
    code,
    autonomy,
    profileId,
    args,
    expiresMs,
  };

  pending.set(approval.id, approval);
  return {
    id: approval.id,
    tool: approval.tool,
    label: approval.label,
    summary: approval.summary,
    expiresAt: approval.expiresAt,
    destructive: approval.destructive,
    code: approval.code,
    autonomy: approval.autonomy,
  };
}
```

Add `checkApprovalCode` immediately before `takeApproval`:

```ts
function sameCode(expected: string, given: string): boolean {
  const a = Buffer.from(normalizeSpokenCode(expected));
  const b = Buffer.from(normalizeSpokenCode(given));
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Whether this click or utterance may release the card — without releasing it.
 *
 * `takeApproval` is single-use, so a wrong code checked by taking would destroy
 * the card it failed to open. This only looks: `missing` covers a used, expired
 * or foreign id (the caller cannot tell which), `mismatch` is a live card whose
 * code was wrong or absent, `ok` is a card that may now be taken.
 */
export function checkApprovalCode(
  id: string,
  profileId: string,
  spoken: string | null | undefined
): "ok" | "missing" | "mismatch" {
  const entry = pending.get(id);
  if (!entry || entry.profileId !== profileId || entry.expiresMs <= Date.now()) return "missing";
  if (!entry.code) return "ok";
  if (!spoken || !sameCode(entry.code, spoken)) return "mismatch";
  return "ok";
}
```

Extend `approvalAsReply` so the card's code is said out loud. Replace the returned `${approval.label}: ${approval.summary}` block with:

```ts
    `${approval.label}: ${approval.summary}`,
    ...(approval.code
      ? ["", `Its code is **${approval.code}**. Say “approve ${approval.code}”, or type the code on the card.`]
      : []),
```

- [ ] **Step 4: Run the proof again**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: `8/8 checks held, 3/3 mutations turned red.`

- [ ] **Step 5: Thread the level through both engines**

In `src/modules/assistant/infrastructure/agent.ts`:

Add the type import beside the existing approvals import:

```ts
import type { VoiceAutonomy } from "@/modules/assistant/domain/voice";
```

Change `runTool`'s signature — the function that contains line 420 — to take the level last:

```ts
async function runTool(
  name: string,
  args: ToolArgs,
  allowDestructive: boolean,
  profileId: string,
  allowWeb: boolean,
  autonomy: VoiceAutonomy
): Promise<{ step: AssistantStep; result: string }> {
```

and its mint call:

```ts
    const approval = mintApproval(tool, args, profileId, autonomy);
```

Change `runAssistantTurn`'s signature:

```ts
export async function runAssistantTurn(
  history: ChatCompletionMessage[],
  allowDestructive: boolean,
  /** `user_profiles.id` of the signed-in recruiter, who must approve any write. */
  profileId: string,
  /** A model the recruiter chose for this conversation, or nothing to route as usual. */
  modelOverride?: string | null,
  allowWeb = false,
  /**
   * The caller's stored voice-autonomy level. A write minted under `code` carries
   * a challenge; under the other levels the click alone releases it.
   */
  autonomy: VoiceAutonomy = "confirm"
): Promise<AssistantTurn> {
```

and the call inside the loop:

```ts
    const { step, result } = await runTool(
      answer.name,
      answer.args,
      allowDestructive,
      profileId,
      allowWeb,
      autonomy
    );
```

In `src/modules/assistant/infrastructure/qoderAgent.ts`:

Add:

```ts
import type { VoiceAutonomy } from "@/modules/assistant/domain/voice";
```

Change `definitionFor`'s signature:

```ts
function definitionFor(
  sdk: typeof import("@qoder-ai/qoder-agent-sdk"),
  tool: AssistantTool,
  steps: AssistantStep[],
  enders: TurnEnder[],
  /** The recruiter this write is held for, so only their click can release it. */
  profileId: string,
  /** Their stored autonomy: `code` mints a challenge the click must carry. */
  autonomy: VoiceAutonomy
): SdkMcpToolDefinition {
```

and its mint call:

```ts
      const approval = mintApproval(tool, input, profileId, autonomy);
```

Change the entry point's signature and its definition map:

```ts
export async function runQoderAssistantTurn(
  history: ChatCompletionMessage[],
  allowDestructive: boolean,
  /** The panel's web switch: hands the runtime its own search and page-reader for one turn. */
  allowWeb: boolean,
  /** `user_profiles.id` of the signed-in recruiter, who must approve any write. */
  profileId: string,
  /** The caller's stored voice-autonomy level; see `mintApproval`. */
  autonomy: VoiceAutonomy = "confirm"
): Promise<AssistantTurn> {
```

```ts
  const definitions = tools.map((tool) =>
    definitionFor(sdk, tool, steps, enders, profileId, autonomy)
  );
```

- [ ] **Step 6: Read the level once per turn in the action, and verify on the click**

In `src/app/(admin)/assistant/actions.ts`:

Add the import:

```ts
import { readVoiceAutonomy } from "@/modules/assistant/application/voiceSettings";
```

Change the approvals import to include the new check:

```ts
import { checkApprovalCode, requiresApproval, takeApproval } from "@/modules/assistant/domain/approvals";
```

In `sendAssistantMessage`, inside the `try {` that runs the turn, immediately after the two locals it declares:

```ts
    let turn: AssistantTurn | null = null;
    let note: string | undefined = modelNote ?? undefined;
    // Read once, before any tool runs. The engines pass the level to every card
    // they mint, so a write cannot be released by a click the server did not ask
    // for a code under. Inside the try, because a settings read that fails is a
    // failed turn like any other — not an unhandled throw before the handler.
    const voice = await readVoiceAutonomy(staff.profileId);
```

Pass it to both engines:

```ts
          turn = await withActivityContext({ via: "assistant" }, () =>
            runQoderAssistantTurn(history, allowDestructive, allowWeb, staff.profileId, voice.level)
          );
```

```ts
        turn = await withActivityContext({ via: "assistant" }, () =>
          runAssistantTurn(history, allowDestructive, staff.profileId, model, allowWeb, voice.level)
        );
```

Replace `approveAssistantChange`'s input type and the block between the id check and `takeApproval`:

```ts
export async function approveAssistantChange(input: {
  approvalId: string;
  sessionId?: string | null;
  /** Said or typed with the click when the card carries a code. */
  spokenCode?: string;
  /**
   * Which surface the click arrived through. The browser asserts this and the
   * server only accepts the two values the portal itself uses; it labels the
   * trail row, it does not widen what the click may do.
   */
  via?: "assistant" | "assistant voice";
}): Promise<AssistantReply> {
```

```ts
  const spokenCode = typeof input?.spokenCode === "string" ? input.spokenCode : null;
  const verdict = checkApprovalCode(id, staff.profileId, spokenCode);
  if (verdict === "missing") {
    return {
      ok: false,
      error:
        "That approval is no longer on the server — it was already used, it expired, or this answer is " +
        "being served by a different process than the one that wrote it. Nothing has changed. Ask me " +
        "again and I will put the card up once more.",
    };
  }
  if (verdict === "mismatch") {
    return {
      ok: false,
      error:
        "That code did not match. Nothing has changed. The card and its code stay live until they expire.",
    };
  }

  const held = takeApproval(id, staff.profileId);
  if (!held) {
    return {
      ok: false,
      error:
        "That approval is no longer on the server — it was already used, it expired, or this answer is " +
        "being served by a different process than the one that wrote it. Nothing has changed. Ask me " +
        "again and I will put the card up once more.",
    };
  }

  const via = input?.via === "assistant voice" ? "assistant voice" : "assistant";
```

and change the activity wrapper:

```ts
  const { step } = await withActivityContext({ via }, () =>
    runApprovedChange(held.tool, held.args)
  );
```

- [ ] **Step 7: Add the surface and the card's code field**

In `src/modules/activity/domain/trail.ts`, extend the list:

```ts
export const ACTIVITY_SURFACES = [
  "console",
  "assistant",
  "assistant voice",
  "career site",
  "assessment runner",
  "cron",
  "webhook",
  "system",
] as const;
```

In `src/app/(admin)/assistant/AssistantApprovalCard.tsx`, add `useState` and replace the button block. The component becomes:

```tsx
"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantApproval } from "@/modules/assistant/domain/approvals";

/**
 * The change the assistant wants to make, held until a person agrees to it.
 *
 * Nothing runs on the model's say-so: this card is the only way a chat write
 * reaches the database. The values on it are the ones the server holds for this
 * id, so what is described is exactly what the click applies — and ignoring it
 * is a real option, which is why the card says what ignoring does.
 *
 * When the card carries a code, the code is printed and must be typed. It is a
 * challenge against a stray or overheard word, not a secret kept from the
 * browser, which is why showing it here is honest rather than leaky. A card
 * minted for `open` says so, because "this runs on a spoken yes" is the one thing
 * about it a person must know before turning away.
 */
export function ApprovalCard({
  approval,
  live,
  busy,
  onApprove,
}: {
  approval: AssistantApproval;
  live: boolean;
  busy: boolean;
  onApprove: (approval: AssistantApproval, code: string) => void;
}) {
  const [code, setCode] = useState("");
  const needsCode = typeof approval.code === "string" && approval.code.length > 0;

  return (
    <div
      className={cn(
        "mt-1.5 rounded-xl border p-2.5",
        approval.destructive ? "border-rose-200 bg-rose-50/70" : "border-brand-gold bg-brand-gold/10"
      )}
    >
      <p
        className={cn(
          "text-[10px] font-bold uppercase tracking-wide",
          approval.destructive ? "text-rose-700" : "text-brand-gold-dark"
        )}
      >
        {approval.destructive ? "Delete waiting for you" : "Change waiting for you"}
      </p>
      <p className="mt-1 text-sm font-semibold leading-snug text-brand-ink">{approval.label}</p>
      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-brand-ink/65">
        {approval.summary}
      </p>
      {approval.autonomy === "open" && (
        <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-rose-700">
          Hands-free: this console may run it on the one click it sends after it hears you say
          approve.
        </p>
      )}
      {needsCode && (
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded-lg border border-brand-line bg-white px-2 py-1 font-mono text-sm font-bold tracking-[0.3em] text-brand-ink">
            {approval.code}
          </code>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            aria-label="Approval code"
            placeholder="Type the code"
            maxLength={12}
            className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 font-mono text-xs uppercase tracking-widest outline-none focus:border-brand-gold"
          />
        </div>
      )}
      {live ? (
        <>
          <button
            type="button"
            onClick={() => onApprove(approval, code)}
            disabled={busy || (needsCode && code.trim().length === 0)}
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition",
              "disabled:cursor-not-allowed disabled:opacity-50",
              approval.destructive
                ? "bg-rose-600 text-brand-on-accent hover:bg-rose-700"
                : "bg-brand-gold text-brand-ink hover:bg-brand-gold/70"
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
            {busy ? "Applying…" : approval.destructive ? "Approve the delete" : "Approve & run"}
          </button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/45">
            {`Ignoring this leaves the record exactly as it is. The offer expires at ${new Date(
              approval.expiresAt
            ).toLocaleString("en-GB")}.`}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-brand-ink/40">
          {
            "No longer clickable — either you answered it below, or the conversation has moved past it."
          }
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Match the new card signature in the chat**

In `src/app/(admin)/assistant/AssistantChat.tsx`:

Change `approve`'s signature and the action call:

```ts
  async function approve(
    approval: AssistantApproval,
    code = "",
    via: "assistant" | "assistant voice" = "assistant"
  ) {
```

```ts
      const result = await approveAssistantChange({
        approvalId: approval.id,
        sessionId: sessionId ?? null,
        spokenCode: code.trim() || undefined,
        via,
      });
```

Change the card's click:

```tsx
                        onApprove={(entry, entered) => void approve(entry, entered)}
```

- [ ] **Step 9: Run the proof and the typecheck**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: `8/8 checks held, 3/3 mutations turned red.`

Run: `npx next typegen && node_modules/.bin/tsc --noEmit`

Expected: exit 0.

- [ ] **Step 10: Add the two approval mutations**

Append after the Task 1 mutations:

```js
await mutation(
  "4. The code requirement removed from the click path → check 8 red",
  "src/modules/assistant/domain/approvals.ts",
  "  if (!spoken || !sameCode(entry.code, spoken)) return \"mismatch\";",
  "  if (false) return \"mismatch\";",
  async () => checkIsRed(8, async () => check8(await load(APPROVALS_URL)))
);

await mutation(
  "5. The owner check dropped, so another person's id opens → check 8 red",
  "src/modules/assistant/domain/approvals.ts",
  "  if (!entry || entry.profileId !== profileId || entry.expiresMs <= Date.now()) return \"missing\";",
  "  if (!entry || entry.expiresMs <= Date.now()) return \"missing\";",
  async () => checkIsRed(8, async () => check8(await load(APPROVALS_URL)))
);
```

Run the proof again — expected `8/8 checks held, 5/5 mutations turned red.`

Note: `load()` appends a timestamp, so a mutated `approvals.ts` is re-imported fresh. `tools.ts` is stubbed, so the registry never loads.

- [ ] **Step 11: Checkpoint**

```bash
git status --short
```

Expected: the six modified files, plus the proof script. Report and wait.

---

### Task 4: The transcription door

**Files:**
- Create: `src/app/api/assistant/voice/route.ts`
- Modify: `scripts/prove-assistant-voice.mjs` (route checks and stubs)

**Interfaces:**
- Consumes: `getSessionUser`, `isStaff` from `@/lib/auth/session`; `oversizeUploadResponse` from `@/lib/files/upload-guard`; `transcribeRecording`, `RecordingNotTranscribableError` from `@/modules/screening/infrastructure/aiGateway`.
- Produces: `POST(request: Request): Promise<Response>` returning `{ text: string }` or `{ error: string }`.

- [ ] **Step 1: Add the route checks (expected to fail)**

In `scripts/prove-assistant-voice.mjs`, extend `STUB_SOURCES`:

```js
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
      return globalThis.__voiceTranscript ?? "which openings have no applicants";
    };
  `,
};
```

Insert before `const CHECKS = [`:

```js
// ---------------------------------------------------------------------------
// 9. The transcription route: 401, 413, 415, 429, and 8 MB accepted
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

async function check9() {
  const problems = [];
  const call = async (options) => {
    globalThis.__voiceCalls = [];
    globalThis.__voiceRefuse = null;
    return callRoute(options);
  };

  globalThis.__voiceUser = null;
  expect(problems, "anonymous", (await call()).status, 401);

  globalThis.__voiceUser = STAFF;
  expect(problems, "not an audio type", (await call({ form: clip("text/plain") })).status, 415);
  expect(problems, "safari mp4", (await call({ form: clip("audio/mp4") })).status, 415);
  expect(
    problems,
    "oversize declared",
    (await call({ headers: { "content-length": String(9 * 1024 * 1024) } })).status,
    413
  );

  const ok = await call({ form: clip("audio/webm;codecs=opus") });
  expect(problems, "ok status", ok.status, 200);
  expect(problems, "ok body", ok.body, { text: "which openings have no applicants" });
  expect(problems, "codec dropped before the provider", globalThis.__voiceCalls[0]?.mimeType, "audio/webm");

  const eight = await call({ form: clip("audio/webm", 8 * 1024 * 1024) });
  expect(problems, "8 MB accepted", eight.status, 200);
  expect(problems, "8 MB reached the provider", globalThis.__voiceCalls[0]?.bytes, 8 * 1024 * 1024);

  globalThis.__voiceTranscript = "";
  expect(problems, "nothing heard", (await call()).body, { text: "" });

  globalThis.__voiceRefuse = "No Google AI Studio key is configured, which the transcription model needs.";
  const refused = await call();
  expect(problems, "provider refusal", refused.status, 503);
  if (!String(refused.body?.error ?? "").includes("Settings")) {
    problems.push("the refusal does not name Settings → API keys");
  }

  // The window is per process and per profile: 20 accepted, the 21st refused.
  globalThis.__voiceUser = { profileId: "p-429", role: "RECRUITER" };
  globalThis.__voiceRefuse = null;
  globalThis.__voiceTranscript = "hello";
  let last = 200;
  for (let index = 0; index < 21; index += 1) {
    const attempt = await call();
    last = attempt.status;
    if (index < 20 && attempt.status !== 200) problems.push(`call ${index + 1} refused early (${attempt.status})`);
  }
  expect(problems, "twenty-first refused", last, 429);
  globalThis.__voiceUser = null;
  return verdict(problems);
}
```

Add to `CHECKS`:

```js
  ["9. The route refuses anonymous, oversize, foreign and repeated bodies", check9],
```

Two cautions, both load-bearing: the route is re-imported through `load()` only once per `callRoute`, so the 429 loop must reuse a single import. Instead of calling `callRoute` in the loop (which re-imports and resets the in-memory window), import once:

```js
  const route = await load(ROUTE_URL);
  let last = 200;
  for (let index = 0; index < 21; index += 1) {
    const request = new Request("http://localhost/api/assistant/voice", {
      method: "POST",
      body: clip(),
    });
    last = (await route.POST(request)).status;
    if (index < 20 && last !== 200) problems.push(`call ${index + 1} refused early (${last})`);
  }
```

Use that block in place of the `for` loop above, and keep `callRoute` for the single-shot checks.

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: check 9 FAILs because `src/app/api/assistant/voice/route.ts` does not exist.

- [ ] **Step 3: Write the route**

Create `src/app/api/assistant/voice/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import {
  RecordingNotTranscribableError,
  transcribeRecording,
} from "@/modules/screening/infrastructure/aiGateway";

/**
 * Speech in, text out — and nothing else.
 *
 * The staff assistant's microphone is the one place audio enters this app that
 * is not a candidate's pitch. It is transcribed and discarded: no bucket, no
 * row, no log, no attachment. The transcript goes back to the browser, and only
 * a turn the person sends is saved, exactly as if they had typed it.
 *
 * The rate window below is per process and in memory, so it resets with the
 * process and does not span hosts. It is a cost guard, not a security boundary;
 * the provider's own quota is the backstop.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TOO_LARGE = "That recording is larger than 8 MB.";
const READABLE_TYPES = new Set(["audio/webm", "audio/ogg"]);
const WINDOW_MS = 5 * 60_000;
const MAX_UTTERANCES = 20;

const recentUtterances = new Map<string, number[]>();

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/** Seconds until this profile may speak again, or null when it is under budget. */
function retryAfter(profileId: string): number | null {
  const now = Date.now();
  const recent = (recentUtterances.get(profileId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_UTTERANCES) {
    recentUtterances.set(profileId, recent);
    const oldest = recent[0] ?? now;
    return Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
  }
  recent.push(now);
  recentUtterances.set(profileId, recent);
  return null;
}

export async function POST(request: Request) {
  // Before formData(): this door has no candidate token in front of it, so the
  // declared length is the only thing that can stop a large body being buffered.
  const oversize = oversizeUploadResponse(request, MAX_BYTES, TOO_LARGE);
  if (oversize) return oversize;

  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return json({ error: "Sign in as staff to dictate." }, 401);
  }

  const wait = retryAfter(user.profileId);
  if (wait !== null) {
    return json(
      { error: "That is a lot of dictation at once. Try again in a minute." },
      429,
      { "Retry-After": String(wait) }
    );
  }

  const form = await request.formData().catch(() => null);
  const recording = form?.get("audio");
  if (!recording || !(recording instanceof Blob)) {
    return json({ error: "A recording is required." }, 400);
  }
  if (recording.size > MAX_BYTES) return json({ error: TOO_LARGE }, 413);

  // MediaRecorder stamps `audio/webm;codecs=opus`; the provider takes the
  // container, and accepting the codec parameter here would let two spellings of
  // the same container disagree between the client and the door.
  const mime = (recording.type || "").split(";")[0].trim().toLowerCase();
  if (!READABLE_TYPES.has(mime)) {
    return json(
      {
        error:
          mime === "audio/mp4" || mime === "audio/aac"
            ? "This browser records in a format the transcription model cannot read — type it instead."
            : "That is not a recording this assistant can transcribe.",
      },
      415
    );
  }

  try {
    const bytes = new Uint8Array(await recording.arrayBuffer());
    const text = await transcribeRecording(bytes, mime);
    return json({ text }, 200);
  } catch (error) {
    if (error instanceof RecordingNotTranscribableError) {
      return json(
        {
          error: `${error.message} Add the key in Settings → API keys, or type the question instead.`,
        },
        503
      );
    }
    const detail = error instanceof Error ? error.message : "the provider did not answer";
    return json({ error: `Transcription failed: ${detail}` }, 502);
  }
}
```

- [ ] **Step 4: Run the proof**

Run: `node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs`

Expected: `9/9 checks held, 5/5 mutations turned red.`

- [ ] **Step 5: Add the route mutations**

Append:

```js
await mutation(
  "6. The staff check dropped from the door → check 9 red",
  "src/app/api/assistant/voice/route.ts",
  "  if (!user || !isStaff(user.role)) {",
  "  if (false) {",
  async () => checkIsRed(9, async () => check9())
);

await mutation(
  "7. The codec parameter kept, so the allowlist misses → check 9 red",
  "src/app/api/assistant/voice/route.ts",
  '  const mime = (recording.type || "").split(";")[0].trim().toLowerCase();',
  "  const mime = recording.type;",
  async () => checkIsRed(9, async () => check9())
);
```

Run again — expected `9/9 checks held, 7/7 mutations turned red.`

- [ ] **Step 6: Typecheck and lint**

Run: `npx next typegen && node_modules/.bin/tsc --noEmit && npm run lint`

Expected: exit 0.

- [ ] **Step 7: Probe one real clip before building the UI**

This is the spec's first risk. With the owner signed in on `localhost:3001`, record one clip with the browser's own recorder path (a temporary console snippet in DevTools is enough, or defer to Task 5 and run this immediately after the mic exists):

```js
// DevTools console on http://localhost:3001/assistant
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
const chunks = [];
recorder.ondataavailable = (event) => chunks.push(event.data);
const stopped = new Promise((resolve) => (recorder.onstop = resolve));
recorder.start();
await new Promise((resolve) => setTimeout(resolve, 3000));
recorder.stop();
await stopped;
stream.getTracks().forEach((track) => track.stop());
const body = new FormData();
body.append("audio", new Blob(chunks, { type: "audio/webm" }), "probe.webm");
const response = await fetch("/api/assistant/voice", { method: "POST", body });
console.log(response.status, await response.json());
```

Expected: `200` and `{ text: "<what was said>" }`. The browser stamps the session cookie, so no credential is printed or pasted.

If the provider refuses audio-only webm (a 502 whose message names the format), repeat the probe with `audio/ogg;codecs=opus`. If both containers are refused, **stop** — report the exact provider message, and do not ship a microphone that cannot transcribe. Do not silently fall back to a stored recording.

- [ ] **Step 8: Checkpoint**

Report the probe's status (not the audio, not any key) and wait. No secret is printed; a provider refusal is quoted from the response body only.

---

### Task 5: Dictation in the composer

**Files:**
- Create: `src/app/(admin)/assistant/voice/useRecorder.ts`
- Create: `src/app/(admin)/assistant/voice/useSpeech.ts`
- Create: `src/app/(admin)/assistant/voice/transcribe.ts`
- Create: `src/app/(admin)/assistant/voice/VoiceButton.tsx`
- Modify: `src/app/(admin)/assistant/AssistantPrefs.tsx` (speak preference)
- Modify: `src/app/(admin)/assistant/AssistantChat.tsx`

**Interfaces:**
- Consumes: `POST /api/assistant/voice`; `speechLanguageOf`, `spokenSummary` from the domain.
- Produces:
  - `MAX_CLIP_MS`, `type RecorderState`, `useRecorder({ onClip, onError })` → `{ state, start, stop, cancel, secondsLeft, hitLimit }`
  - `useSpeech()` → `{ speak(text, language?), stop, speaking, error }`
  - `transcribeClip(clip: Blob): Promise<{ text: string } | { error: string }>`
  - `VoiceButton({ onTranscript, disabled })`
  - `readStoredSpeak(): boolean | null`, `writeStoredSpeak(value: boolean)`

- [ ] **Step 1: Write the recorder hook**

Create `src/app/(admin)/assistant/voice/useRecorder.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A spoken question is a sentence or two, not a meeting. */
export const MAX_CLIP_MS = 120_000;

export type RecorderState = "idle" | "requesting" | "recording" | "transcribing" | "error";

/**
 * Formats the provider accepts, in the order this browser is asked to produce.
 * The codec parameter is a recorder preference, not a wire type — the route
 * drops it before the allowlist, because only two spellings should ever leave.
 */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/ogg",
];

const MAX_CLIP_SECONDS = MAX_CLIP_MS / 1000;

function supportedType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function readableType(recorded: string): string {
  return recorded.includes("ogg") ? "audio/ogg" : "audio/webm";
}

function microphoneMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser blocked the microphone. Allow it for this site, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found on this device.";
  }
  return "The microphone could not be started.";
}

export function useRecorder({
  onClip,
  onError,
}: {
  onClip: (clip: Blob) => unknown;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(MAX_CLIP_SECONDS);
  // Set when the cap ended the clip rather than the person. It outlives the
  // recording so the surface can say *why* the clip stopped, and is cleared when
  // the next one starts.
  const [hitLimit, setHitLimit] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setSecondsLeft(MAX_CLIP_SECONDS);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already stopped; the release below is what matters.
      }
    }
    release();
    setState("idle");
  }, [release]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const type = supportedType();
    if (!type || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError("This browser cannot record audio — type the question instead.");
      setState("error");
      return;
    }

    setState("requesting");
    setHitLimit(false);
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: type });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const recorded = readableType(recorder.mimeType || type);
        const clip = new Blob(chunks, { type: recorded });
        release();
        if (cancelledRef.current || clip.size === 0) {
          setState("idle");
          return;
        }
        setState("transcribing");
        void Promise.resolve(onClipRef.current(clip)).finally(() => setState("idle"));
      };

      recorderRef.current = recorder;
      recorder.start();
      setState("recording");

      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const left = Math.max(
          0,
          MAX_CLIP_SECONDS - Math.floor((Date.now() - startedAt) / 1000)
        );
        setSecondsLeft(left);
        if (left === 0) {
          setHitLimit(true);
          stop();
        }
      }, 250);
    } catch (error) {
      release();
      setState("error");
      onError(microphoneMessage(error));
    }
  }, [onError, release, stop]);

  // A hidden tab or a route change ends the clip. A microphone that keeps
  // listening while its page is gone is the one failure this file exists to
  // prevent; cancelling is the honest end, so nothing is sent.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already gone.
        }
      }
      release();
    };
  }, [cancel, release]);

  return { state, start, stop, cancel, secondsLeft, hitLimit };
}
```

- [ ] **Step 2: Write the client door to the route**

Create `src/app/(admin)/assistant/voice/transcribe.ts`:

```ts
"use client";

/**
 * The only client call to the transcription route.
 *
 * Returns words or a sentence a recruiter can act on. A transport failure and a
 * refusal are the same shape on purpose: both leave the composer untouched, so
 * nothing is inserted that was never heard.
 */
export async function transcribeClip(
  clip: Blob
): Promise<{ text: string } | { error: string }> {
  const body = new FormData();
  const extension = clip.type.includes("ogg") ? "ogg" : "webm";
  body.append("audio", clip, `clip.${extension}`);

  try {
    const response = await fetch("/api/assistant/voice", { method: "POST", body });
    const payload = (await response.json().catch(() => null)) as
      | { text?: unknown; error?: unknown }
      | null;

    if (!response.ok) {
      return {
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "That recording could not be transcribed.",
      };
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    return text ? { text } : { error: "Nothing was heard — try again." };
  } catch {
    return { error: "The recording could not be sent. Check the connection and try again." };
  }
}
```

- [ ] **Step 3: Write the speech hook**

Create `src/app/(admin)/assistant/voice/useSpeech.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { speechLanguageOf } from "@/modules/assistant/domain/voice";

/**
 * The device's own voices. No provider is called for playback, so an answer is
 * never sent anywhere a second time to be read aloud.
 *
 * `getVoices()` can be empty on first call while the platform loads them; the
 * listener below is what stops a working device from being reported as voiceless.
 */
export function useSpeech() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => setVoices(window.speechSynthesis.getVoices());
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, language?: "ar" | "en") => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setError("This browser cannot speak answers.");
        return;
      }
      const spoken = text.trim();
      if (!spoken) return;

      const wanted = language ?? speechLanguageOf(spoken);
      if (!wanted) return;

      const voice = voices.find((entry) => entry.lang.toLowerCase().startsWith(wanted));
      if (!voice) {
        setError(
          wanted === "ar"
            ? "This device has no Arabic voice installed — the answer stays on screen."
            : "This device has no English voice installed — the answer stays on screen."
        );
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onstart = () => {
        setSpeaking(true);
        setError(null);
      };
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => {
        setSpeaking(false);
        setError("That answer could not be spoken.");
      };
      window.speechSynthesis.speak(utterance);
    },
    [voices]
  );

  return { speak, stop, speaking, error, clearError: () => setError(null) };
}
```

- [ ] **Step 4: Add the speak preference**

In `src/app/(admin)/assistant/AssistantPrefs.tsx`, add at the end:

```ts
/* -------------------------------- Spoken --------------------------------- */

const SPEAK_KEY = "sdg-assistant-speak";

/**
 * Whether answers are read aloud, and `null` while the person has never chosen.
 *
 * The console's own default is on; the dock's is off. `null` is what lets each
 * surface pick its default without either one writing a preference the person
 * did not choose.
 */
export function readStoredSpeak(): boolean | null {
  try {
    const raw = window.localStorage.getItem(SPEAK_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeStoredSpeak(value: boolean): void {
  try {
    window.localStorage.setItem(SPEAK_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked — the choice applies to this panel only.
  }
}
```

- [ ] **Step 5: Write the mic button**

Create `src/app/(admin)/assistant/voice/VoiceButton.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeClip } from "./transcribe";
import { useRecorder } from "./useRecorder";

/**
 * The microphone beside the composer.
 *
 * Dictation only inserts text — it never sends the turn, so what the recogniser
 * heard can be read and corrected before it becomes a question. Escape cancels a
 * clip; the recorder itself stops at two minutes. While it records, the button
 * says where the audio goes and that it is discarded, which is the first-use
 * explanation the spec asks for on this surface.
 */
export function VoiceButton({
  onTranscript,
  disabled = false,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const recorder = useRecorder({
    onClip: async (clip) => {
      const result = await transcribeClip(clip);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      onTranscript(result.text);
    },
    onError: setError,
  });

  const busy = recorder.state === "requesting" || recorder.state === "transcribing";
  const recording = recorder.state === "recording";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && recorder.state === "recording") recorder.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recorder.state, recorder.cancel]);

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => {
          setError(null);
          if (recording) recorder.stop();
          else void recorder.start();
        }}
        disabled={disabled || busy}
        aria-label={recording ? "Stop dictating" : "Dictate a question"}
        title={
          recording
            ? `Recording — stops itself at two minutes (${recorder.secondsLeft}s left)`
            : "Dictate a question"
        }
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-xl border transition",
          recording
            ? "border-rose-300 bg-rose-50 text-rose-700"
            : "border-brand-line text-brand-ink/60 hover:bg-brand-sand",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : recording ? (
          <Square className="h-4 w-4" aria-hidden />
        ) : (
          <Mic className="h-4 w-4" aria-hidden />
        )}
      </button>
      {recording && (
        <span className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border border-brand-line bg-white px-2 py-1.5 text-[10px] font-semibold leading-relaxed text-brand-ink/60 shadow-sm">
          Recording — the clip goes to the transcription model and is discarded. Only the words you
          send are saved.
        </span>
      )}
      {!recording && recorder.hitLimit && !error && (
        <span className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border border-brand-line bg-white px-2 py-1.5 text-[10px] font-semibold leading-relaxed text-brand-ink/60 shadow-sm">
          Stopped at two minutes — the clip was transcribed.
        </span>
      )}
      {error && (
        <span
          role="alert"
          className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-[10px] font-semibold leading-relaxed text-rose-700 shadow-sm"
        >
          {error}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 6: Put the mic in the chat**

In `src/app/(admin)/assistant/AssistantChat.tsx`:

Add the imports:

```ts
import { VoiceButton } from "./voice/VoiceButton";
```

Extend the props interface:

```ts
export interface AssistantChatProps {
  /** The saved conversation the transcript is written to, or null for a new one. */
  sessionId: string | null;
  /** Called with the id of a conversation the first turn just created. */
  onSessionChange: (sessionId: string) => void;
  onNewConversation: () => void;
  variant: "docked" | "page";
  /**
   * `dictate` adds a microphone beside the composer; `console` is the voice
   * console, which adds hands-free and speaks answers. Defaults to `dictate`,
   * so the dock and the Assistant page need no prop of their own.
   */
  voiceMode?: "dictate" | "console";
}
```

Destructure it:

```ts
export function AssistantChat({
  sessionId,
  onSessionChange,
  onNewConversation,
  variant,
  voiceMode = "dictate",
}: AssistantChatProps) {
```

Add the insertion helper after `contentOf`:

```ts
  /**
   * A transcript lands where typing would: at the cursor, with the existing text
   * kept. Dictation never replaces a draft that is already being written.
   */
  function insertTranscript(text: string) {
    const box = inputRef.current;
    const current = draftRef.current;
    if (!box) {
      setDraft(current ? `${current} ${text}` : text);
      return;
    }
    const start = box.selectionStart ?? current.length;
    const end = box.selectionEnd ?? current.length;
    setDraft(`${current.slice(0, start)}${text}${current.slice(end)}`);
    requestAnimationFrame(() => {
      box.focus();
      const at = start + text.length;
      box.setSelectionRange(at, at);
    });
  }
```

Render the button between the attach button and the textarea, in dictate mode only — the console's push-to-talk lives in the strip, and two recorders over one composer would be two microphones for one question:

```tsx
              {voiceMode === "dictate" && (
                <VoiceButton
                  onTranscript={insertTranscript}
                  disabled={pending || extracting}
                />
              )}
```

- [ ] **Step 7: Typecheck, lint and the gates**

Run: `npx next typegen && node_modules/.bin/tsc --noEmit && npm run lint && npm run check:routes`

Expected: exit 0. `check:routes` is unchanged: `voice/page.tsx` is nested under `(admin)/assistant`, which the route script does not enumerate as a top-level area.

- [ ] **Step 8: Live-prove dictation**

With the dev server on `localhost:3001` and the owner signed in:
1. Open the dock on any admin page and press the mic; say "which openings have no applicants"; press stop.
2. Expected: the sentence appears at the cursor, the send button still requires a click, and sending it produces a normal saved turn.
3. Press Escape mid-recording once; expected: no transcript, no error, nothing sent.
4. Deny the microphone once in the browser's site settings; expected: the card names the browser setting, not a stack trace.

Report the result (not the transcript contents) and wait if the provider refused in Task 4.

---

### Task 6: Hands-free, the voice console, and the autonomy panel

**Files:**
- Create: `src/app/(admin)/assistant/voice/useWakeWord.ts`
- Create: `src/app/(admin)/assistant/voice/VoiceStrip.tsx`
- Create: `src/app/(admin)/assistant/voice/AutonomyPanel.tsx`
- Create: `src/app/(admin)/assistant/voice/VoiceConsole.tsx`
- Create: `src/app/(admin)/assistant/voice/page.tsx`
- Modify: `src/app/(admin)/assistant/AssistantPrefs.tsx` (wake phrase, language)
- Modify: `src/app/(admin)/assistant/AssistantChat.tsx`
- Modify: `src/app/(admin)/assistant/page.tsx` (a Voice link in the header)
- Modify: `scripts/prove-assistant-voice.mjs` (page and privacy pins)

**Interfaces:**
- Consumes: `matchWakePhrase`, `spokenApproval`, `spokenSummary`, `DEFAULT_WAKE_PHRASE`, `MAX_WAKE_PHRASE_CHARS`, `type VoiceAutonomy`, `VOICE_AUTONOMY`, `VOICE_AUTONOMY_HINTS`, `VOICE_AUTONOMY_LABELS`, `type VoiceAutonomyState`; `readVoiceAutonomy` (page); `getVoiceAutonomy`/`setVoiceAutonomy` (panel).
- Produces:
  - `useWakeWord({ enabled, language, onUtterance })` → `{ supported, listening, error }`
  - `VoiceStrip`, `AutonomyPanel`, `VoiceConsole({ initialSessionId, state })`
  - `readStoredWakePhrase`/`writeStoredWakePhrase`, `readStoredVoiceLanguage`/`writeStoredVoiceLanguage`

- [ ] **Step 1: Write the recognizer hook**

Create `src/app/(admin)/assistant/voice/useWakeWord.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * The browser's own recognizer, and only while the console is armed.
 *
 * Chrome and Edge implement this; Firefox does not, and the strip says so rather
 * than offering a toggle that cannot work. The recognizer sends what it hears to
 * the browser vendor's speech service — which is why the console states that
 * before it arms, and why this hook exists nowhere else in the portal.
 *
 * It restarts itself while armed, is suspended while the tab is hidden, and is
 * aborted on unmount. A `no-speech` or `aborted` event is the recognizer's
 * ordinary silence, not an error worth showing.
 */
export function useWakeWord({
  enabled,
  language,
  onUtterance,
}: {
  enabled: boolean;
  language: "en" | "ar";
  onUtterance: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || !enabled) {
      setListening(false);
      return;
    }

    let active = true;
    let suspended = false;
    const recognition = new Ctor();
    recognition.lang = language === "ar" ? "ar-EG" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    setError(null);

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;
        const text = String(result[0]?.transcript ?? "").trim();
        if (text) onUtteranceRef.current(text);
      }
    };

    recognition.onerror = (event) => {
      const code = event?.error ?? "";
      if (code === "aborted" || code === "no-speech") return;
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "The microphone, or the browser's speech service, is blocked. Allow it and arm hands-free again."
          : code === "network"
            ? "The browser's speech service could not be reached."
            : "Listening stopped unexpectedly."
      );
      setListening(false);
    };

    recognition.onend = () => {
      if (!active || suspended) return;
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    };

    const onVisibility = () => {
      suspended = document.visibilityState === "hidden";
      try {
        if (suspended) {
          recognition.abort();
          setListening(false);
        } else {
          recognition.start();
          setListening(true);
        }
      } catch {
        setListening(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("Listening could not start in this browser.");
    }

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
      setListening(false);
    };
  }, [enabled, language]);

  return { supported, listening, error };
}
```

- [ ] **Step 2: Add the wake-phrase and language preferences**

In `src/app/(admin)/assistant/AssistantPrefs.tsx`, import the constants at the top:

```ts
import {
  DEFAULT_WAKE_PHRASE,
  MAX_WAKE_PHRASE_CHARS,
} from "@/modules/assistant/domain/voice";
```

Add at the end:

```ts
/* ------------------------------- Wake phrase ----------------------------- */

const WAKE_KEY = "sdg-assistant-wake";
const VOICE_LANG_KEY = "sdg-assistant-voice-lang";

export function readStoredWakePhrase(): string {
  try {
    const raw = window.localStorage.getItem(WAKE_KEY)?.trim() ?? "";
    return raw ? raw.slice(0, MAX_WAKE_PHRASE_CHARS) : DEFAULT_WAKE_PHRASE;
  } catch {
    return DEFAULT_WAKE_PHRASE;
  }
}

export function writeStoredWakePhrase(phrase: string): void {
  const clean = phrase.trim().slice(0, MAX_WAKE_PHRASE_CHARS);
  try {
    if (clean) window.localStorage.setItem(WAKE_KEY, clean);
    else window.localStorage.removeItem(WAKE_KEY);
  } catch {
    // Storage blocked — the phrase lives only in this panel.
  }
}

export type VoiceLanguage = "en" | "ar";

export function readStoredVoiceLanguage(): VoiceLanguage {
  try {
    return window.localStorage.getItem(VOICE_LANG_KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

export function writeStoredVoiceLanguage(value: VoiceLanguage): void {
  try {
    window.localStorage.setItem(VOICE_LANG_KEY, value === "ar" ? "ar" : "en");
  } catch {
    // Storage blocked — the choice applies to this panel only.
  }
}
```

- [ ] **Step 3: Write the console strip**

Create `src/app/(admin)/assistant/voice/VoiceStrip.tsx`:

```tsx
"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_WAKE_PHRASE_CHARS } from "@/modules/assistant/domain/voice";
import type { VoiceLanguage } from "../AssistantPrefs";

/**
 * The voice console's controls, above its composer.
 *
 * Every control here describes what it does plainly: hands-free is a listening
 * state with a visible indicator, the wake phrase is a browser preference, and
 * "Speak answers" changes playback only. Nothing here approves anything — the
 * autonomy panel below the chat decides that.
 */
export function VoiceStrip({
  pushToTalk,
  recording,
  transcribing,
  secondsLeft,
  hitLimit,
  supported,
  handsFree,
  onHandsFree,
  listening,
  wakePhrase,
  onWakePhrase,
  language,
  onLanguage,
  speakReplies,
  onSpeakReplies,
  speaking,
  onStopSpeaking,
  caption,
  error,
}: {
  pushToTalk: () => void;
  recording: boolean;
  transcribing: boolean;
  secondsLeft: number;
  /** The two-minute cap ended the last clip, not the person. */
  hitLimit: boolean;
  supported: boolean;
  handsFree: boolean;
  onHandsFree: (next: boolean) => void;
  listening: boolean;
  wakePhrase: string;
  onWakePhrase: (phrase: string) => void;
  language: VoiceLanguage;
  onLanguage: (next: VoiceLanguage) => void;
  speakReplies: boolean;
  onSpeakReplies: (next: boolean) => void;
  speaking: boolean;
  onStopSpeaking: () => void;
  caption: string;
  error: string | null;
}) {
  return (
    <div className="mb-2 rounded-xl border border-brand-line bg-brand-cream/70 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pushToTalk}
          disabled={transcribing}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition",
            recording
              ? "bg-rose-600 text-brand-on-accent hover:bg-rose-700"
              : "bg-brand-ink text-brand-cream hover:bg-brand-ink/85",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : recording ? (
            <Square className="h-4 w-4" aria-hidden />
          ) : (
            <Mic className="h-4 w-4" aria-hidden />
          )}
          {recording
            ? `Stop · ${secondsLeft}s`
            : transcribing
              ? "Transcribing…"
              : "Push to talk"}
        </button>

        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/70">
          <input
            type="checkbox"
            checked={handsFree}
            onChange={(event) => onHandsFree(event.target.checked)}
            disabled={!supported}
          />
          Hands-free
        </label>

        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/70">
          <input
            type="checkbox"
            checked={speakReplies}
            onChange={(event) => onSpeakReplies(event.target.checked)}
          />
          Speak answers
        </label>

        {speaking && (
          <button
            type="button"
            onClick={onStopSpeaking}
            className="rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-bold text-brand-ink/60 transition hover:bg-brand-sand"
          >
            Stop speaking
          </button>
        )}

        <label className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/60">
          Listening language
          <select
            value={language}
            onChange={(event) => onLanguage(event.target.value === "ar" ? "ar" : "en")}
            className="rounded-lg border border-brand-line bg-white px-1.5 py-1 text-[11px] outline-none focus:border-brand-gold"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </label>
      </div>

      {handsFree && supported && (
        <label className="mt-2 flex items-center gap-2 text-[10px] font-semibold text-brand-ink/60">
          Wake phrase
          <input
            value={wakePhrase}
            onChange={(event) => onWakePhrase(event.target.value)}
            maxLength={MAX_WAKE_PHRASE_CHARS}
            aria-label="Wake phrase"
            className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] outline-none focus:border-brand-gold"
          />
        </label>
      )}

      <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/55">
        {handsFree
          ? listening
            ? `Listening for “${wakePhrase}”.`
            : "Arming the microphone…"
          : "Nothing is being recorded."}
        {caption ? ` ${caption}` : ""}
      </p>

      {hitLimit && !recording && (
        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-brand-ink/60">
          Stopped at two minutes — the clip was transcribed.
        </p>
      )}

      {!supported && (
        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-amber-700">
          Hands-free needs Chrome or Edge&apos;s speech recognition. Push-to-talk works in this
          browser.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[10px] font-semibold leading-relaxed text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the autonomy panel**

Create `src/app/(admin)/assistant/voice/AutonomyPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VOICE_AUTONOMY,
  VOICE_AUTONOMY_HINTS,
  VOICE_AUTONOMY_LABELS,
  type VoiceAutonomy,
  type VoiceAutonomyState,
} from "@/modules/assistant/domain/voice";
import { setVoiceAutonomy } from "./actions";

/**
 * What a spoken word may release.
 *
 * Stored on the server, so the browser cannot upgrade itself; this panel is the
 * only place it is written. While 046 is absent only `confirm` is offered and
 * the panel names the file — a level that cannot be stored cannot be enforced.
 */
export function AutonomyPanel({ initial }: { initial: VoiceAutonomyState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<VoiceAutonomy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<VoiceAutonomy | null>(null);

  async function choose(level: VoiceAutonomy) {
    if (level === state.level || busy) return;
    setBusy(level);
    setError(null);
    setSaved(null);
    const result = await setVoiceAutonomy(level);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That setting could not be saved.");
      return;
    }
    setState((current) => ({ ...current, level: result.level, stored: true }));
    setSaved(result.level);
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-white p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        What a spoken word may release
      </p>
      <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">
        This is stored on your account, not in this browser, and the server reads it every time a
        card is raised.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {VOICE_AUTONOMY.map((level) => {
          const disabled =
            busy !== null ||
            (!state.stored && level !== "confirm") ||
            (level === "open" && !state.canOpen);
          return (
            <button
              key={level}
              type="button"
              onClick={() => void choose(level)}
              disabled={disabled}
              aria-pressed={state.level === level}
              className={cn(
                "rounded-xl border p-3 text-left transition",
                state.level === level
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-brand-line bg-white hover:bg-brand-cream",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <p className="flex items-center gap-1.5 text-xs font-bold text-brand-ink">
                {VOICE_AUTONOMY_LABELS[level]}
                {busy === level && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
                {VOICE_AUTONOMY_HINTS[level]}
              </p>
              {level === "open" && !state.canOpen && (
                <p className="mt-1 text-[10px] font-semibold text-amber-700">
                  Needs settings.manage_platform.
                </p>
              )}
            </button>
          );
        })}
      </div>

      {!state.stored && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-800">
          db/migrations/046_assistant_voice_autonomy.sql is authored but not applied, so only
          “Confirm with a click” can be used. The other two need the table that stores them.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[11px] font-semibold leading-relaxed text-rose-700">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-3 text-[11px] font-semibold text-brand-ink/60">
          Saved — {VOICE_AUTONOMY_LABELS[saved]}.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Write the console body and page**

Create `src/app/(admin)/assistant/voice/VoiceConsole.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VoiceAutonomyState } from "@/modules/assistant/domain/voice";
import { AssistantChat } from "../AssistantChat";
import { AutonomyPanel } from "./AutonomyPanel";

/**
 * `/assistant/voice`: the same conversation, at full size, with a microphone.
 *
 * There is no separate transcript here. The chat below is the one the Assistant
 * page renders, so a spoken turn is saved exactly like a typed one and a
 * conversation started by voice opens in both places.
 */
export function VoiceConsole({
  initialSessionId,
  state,
}: {
  initialSessionId: string | null;
  state: VoiceAutonomyState;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(initialSessionId);

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-brand-line bg-brand-cream/70 p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
          What happens to your voice
        </p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-brand-ink/65">
          Push-to-talk records a clip and sends it to Google&apos;s speech model for transcription;
          the audio is discarded the moment the words come back and is never stored, logged or
          attached to a conversation. Only the text you send is saved, exactly as if you typed it.
          Hands-free uses this browser&apos;s own speech recognition, which sends what it hears to
          the browser vendor&apos;s service — it runs only on this page, only while the toggle is
          on, and only while this tab is visible.
        </p>
      </section>

      <section className="flex h-[calc(100vh-16rem)] min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-brand-line bg-white">
        <AssistantChat
          variant="page"
          voiceMode="console"
          sessionId={sessionId}
          onSessionChange={(id) => {
            setSessionId(id);
            router.replace(`/assistant/voice?session=${encodeURIComponent(id)}`, { scroll: false });
          }}
          onNewConversation={() => {
            setSessionId(null);
            router.replace("/assistant/voice", { scroll: false });
          }}
        />
      </section>

      <AutonomyPanel initial={state} />
    </div>
  );
}
```

Create `src/app/(admin)/assistant/voice/page.tsx`:

```tsx
import { Mic } from "lucide-react";
import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { readVoiceAutonomy } from "@/modules/assistant/application/voiceSettings";
import { VoiceConsole } from "./VoiceConsole";

export const metadata = {
  title: "Voice · Assistant",
  description: "Dictate a question, listen to the answer, and decide what a spoken word may release",
};

/** Auth-gated route: the autonomy level and the saved conversation are per person. */
export const instant = false;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function AssistantVoicePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const staff = await requireStaff("/assistant/voice");

  const params = await searchParams;
  const session = typeof params.session === "string" ? params.session : null;
  const state = await readVoiceAutonomy(staff.profileId);

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Operations assistant"
        title="Voice"
        description="Speak a question, hear the answer, and keep your hands free — the same conversation, saved to your account."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <Mic className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            Listening only while armed
          </span>
        }
      />
      <VoiceConsole initialSessionId={session} state={state} />
    </PageTransition>
  );
}
```

`PageTransition` lives in the shell module and `PageHeader` in the analytics UI module — the same pair `assistant/page.tsx` imports. There is no combined export.

Then put the door where the Guide says it is. In `src/app/(admin)/assistant/page.tsx`, change the icon import and add the link import:

```tsx
import Link from "next/link";
import { Mic, Sparkles } from "lucide-react";
```

and replace the header's `actions` with the two pills:

```tsx
        actions={
          <span className="inline-flex items-center gap-2">
            <Link
              href="/assistant/voice"
              className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              <Mic className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
              Voice
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
              <Sparkles className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
              Saved to your account
            </span>
          </span>
        }
```

- [ ] **Step 6: Wire the console into the chat**

In `src/app/(admin)/assistant/AssistantChat.tsx`:

Add the imports:

```ts
import {
  DEFAULT_WAKE_PHRASE,
  matchWakePhrase,
  spokenApproval,
  spokenSummary,
} from "@/modules/assistant/domain/voice";
import {
  readStoredSpeak,
  readStoredVoiceLanguage,
  readStoredWakePhrase,
  writeStoredSpeak,
  writeStoredVoiceLanguage,
  writeStoredWakePhrase,
  type VoiceLanguage,
} from "./AssistantPrefs";
import { transcribeClip } from "./voice/transcribe";
import { useRecorder } from "./voice/useRecorder";
import { useSpeech } from "./voice/useSpeech";
import { useWakeWord } from "./voice/useWakeWord";
import { VoiceStrip } from "./voice/VoiceStrip";
```

Add state beside `opening`:

```ts
  /** Console-only: what the strip shows and whether the recognizer is armed. */
  const [caption, setCaption] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [wakePhrase, setWakePhrase] = useState(DEFAULT_WAKE_PHRASE);
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>("en");

  const speech = useSpeech();
  const recorder = useRecorder({
    onClip: async (clip) => {
      setVoiceError(null);
      setCaption("Transcribing…");
      const result = await transcribeClip(clip);
      if ("error" in result) {
        setVoiceError(result.error);
        setCaption("");
        return;
      }
      setCaption(result.text);
      insertTranscript(result.text);
    },
    onError: (message) => setVoiceError(message),
  });
```

Restore the voice preferences in an effect (client-only, like the engine restore):

```ts
  // Voice preferences are browser preferences, restored after mount so the
  // server render and the first client render agree.
  useEffect(() => {
    setWakePhrase(readStoredWakePhrase());
    setVoiceLanguage(readStoredVoiceLanguage());
    setSpeakReplies(readStoredSpeak() ?? voiceMode === "console");
  }, [voiceMode]);
```

Add the utterance handler after `approve`:

```ts
  /**
   * One final utterance from the browser recognizer.
   *
   * The wake phrase may carry the question ("Hey Jarvis, who is waiting?") or
   * stand alone, in which case the next utterance is the question. While a card
   * is live, an approve/cancel phrase is a verdict instead — but only for a card
   * minted under `code` or `open`. A `confirm` card is released by a click, so a
   * spoken "approve" is acknowledged and nothing else.
   */
  function hearUtterance(text: string) {
    const wake = matchWakePhrase(text, wakePhrase);
    if (wake.matched) {
      setAwaiting(false);
      if (wake.remainder) {
        setCaption(wake.remainder);
        void send(wake.remainder);
      } else {
        setAwaiting(true);
        setCaption("Listening…");
        speech.speak("Listening", "en");
      }
      return;
    }
    if (!awaiting) return;
    // The cue itself is spoken while the recognizer is armed, so a final that
    // arrives mid-speech is the assistant hearing its own voice, not the person.
    if (speech.speaking) return;
    setAwaiting(false);

    const last = messages[messages.length - 1];
    const live =
      last?.role === "assistant"
        ? last.steps?.find((step) => step.approval)?.approval ?? null
        : null;
    if (live) {
      const verdict = spokenApproval(text, live.code ?? null);
      if (verdict === "cancel") {
        setCaption("Cancelled — the card stays live until it expires or you click it.");
        speech.speak("Cancelled. The card has not been released.", "en");
        return;
      }
      if (verdict === "approve") {
        // A card minted under `confirm` is released by a click and never by a
        // word, so saying "approve" only asks whether the card was heard. The
        // card rehydrated from an older transcript carries no level, and an
        // unknown level behaves like the safe one.
        if ((live.autonomy ?? "confirm") === "confirm") {
          setCaption(`Waiting for your click: ${live.summary}`);
          speech.speak("That change is waiting for your click.", "en");
          return;
        }
        // `code` reaches here only with the code said in the same utterance
        // (`spokenApproval` refused it otherwise); `open` carries no code.
        setCaption(`Approved: ${live.summary}`);
        void approve(live, live.code ? text : "", "assistant voice");
        return;
      }
    }

    // "Send" spoken after dictating submits the composer rather than asking the
    // assistant about the word "send".
    if (/^(send|send it|أرسل|ارسال|إرسال)$/i.test(text.trim()) && draftRef.current.trim()) {
      void send();
      return;
    }

    setCaption(text);
    void send(text);
  }

  const wake = useWakeWord({
    enabled: voiceMode === "console" && handsFree,
    language: voiceLanguage,
    onUtterance: hearUtterance,
  });
```

Speak an answer when it arrives — inside `send`, replace the assistant append and add the playback after it. The whole block becomes:

```ts
      const answer = result.reply ?? "";
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          text: answer,
          steps: result.steps,
          model: result.model,
          provider: result.provider,
          note: result.note,
        },
      ]);
      // The console reads the answer aloud when speaking is on. The dock and the
      // page only do when the person switched it on there; the pref defaults to
      // console-only for that reason.
      if (voiceMode === "console" && speakReplies && answer) {
        speech.speak(spokenSummary(answer));
      }
```

`send` declares no `answer` today — `text` was written inline as `result.reply ?? ""`. Introduce `answer` as above and use it for `text`, so the spoken copy and the on-screen copy are the same string.

The strip in the footer, immediately after the `{saveError && (...)}` block:

```tsx
            {voiceMode === "console" && (
              <VoiceStrip
                pushToTalk={() => {
                  setVoiceError(null);
                  if (recorder.state === "recording") recorder.stop();
                  else void recorder.start();
                }}
                recording={recorder.state === "recording"}
                transcribing={recorder.state === "transcribing" || recorder.state === "requesting"}
                secondsLeft={recorder.secondsLeft}
                hitLimit={recorder.hitLimit}
                supported={wake.supported}
                handsFree={handsFree}
                onHandsFree={(next) => {
                  setHandsFree(next);
                  setAwaiting(false);
                  setCaption("");
                  if (!next) speech.stop();
                }}
                listening={wake.listening}
                wakePhrase={wakePhrase}
                onWakePhrase={(phrase) => {
                  setWakePhrase(phrase);
                  writeStoredWakePhrase(phrase);
                }}
                language={voiceLanguage}
                onLanguage={(next) => {
                  setVoiceLanguage(next);
                  writeStoredVoiceLanguage(next);
                }}
                speakReplies={speakReplies}
                onSpeakReplies={(next) => {
                  setSpeakReplies(next);
                  writeStoredSpeak(next);
                  if (!next) speech.stop();
                }}
                speaking={speech.speaking}
                onStopSpeaking={speech.stop}
                caption={caption}
                error={voiceError ?? wake.error ?? speech.error}
              />
            )}
```

- [ ] **Step 7: Pin the page and the privacy sentence**

Insert before `const CHECKS = [` in `scripts/prove-assistant-voice.mjs`:

```js
// ---------------------------------------------------------------------------
// 10. The voice page is staff-gated, and every surface states where audio goes
// ---------------------------------------------------------------------------
async function check10() {
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

  // Comments are stripped first: the route's own header says "no bucket, no
  // row", and a substring scan would read that promise as its opposite.
  const route = read("src/app/api/assistant/voice/route.ts");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  if (/getFileStore|storageConfig|\.upload\(|storage\.from/i.test(code)) {
    problems.push("the route appears to store audio");
  }

  const chat = read("src/app/(admin)/assistant/AssistantChat.tsx");
  if (!chat.includes('voiceMode === "console"')) problems.push("the chat has no console mode");
  // A card minted under `confirm` is released by a click, never by a word.
  if (!chat.includes('live.autonomy ?? "confirm"')) {
    problems.push("the chat does not hold confirm-mode cards to a click");
  }

  // The Assistant page links to the console the Guide describes.
  const assistantPage = read("src/app/(admin)/assistant/page.tsx");
  if (!assistantPage.includes("/assistant/voice")) {
    problems.push("the Assistant page does not link to the voice console");
  }
  return verdict(problems);
}
```

Add to `CHECKS`:

```js
  ["10. The voice page is staff-gated, and every surface says where audio goes", check10],
```

- [ ] **Step 8: Run the proof, then every gate**

```bash
node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs
npx next typegen && node_modules/.bin/tsc --noEmit
npm run lint
npm run check:routes
```

Expected: `10/10 checks held, 7/7 mutations turned red`; tsc 0; lint 0 (watch for `react-hooks/exhaustive-deps` on the new effects — the repo's rule is on, so list every dependency the effect reads); routes 0.

- [ ] **Step 9: Live-prove the console**

On `localhost:3001/assistant/voice`, with the owner signed in:
1. Push-to-talk one sentence, confirm it lands in the composer, then type "send" or press send; the reply is read aloud and the stop control appears while it speaks.
2. Arm hands-free in Chrome; the strip says it is listening for "Hey Jarvis". Say "Hey Jarvis" — the strip says "Listening…" and the assistant says "Listening". Ask "how is the pipeline looking this fortnight" — a normal saved turn answers aloud.
3. Hide the tab and return; the recognizer resumes only if the toggle is still armed.
4. Open the same page in Firefox; hands-free is disabled with the reason, push-to-talk works.
5. Confirm the autonomy panel offers only "Confirm with a click" and prints the 046 sentence (the migration is not applied).

- [ ] **Step 10: Checkpoint**

```bash
git status --short
```

Expected: the new `voice/` files and the two modified assistant files. Report what each live step showed and wait.

---

### Task 7: Whole-slice gates, the Guide, and the honest live proof

**Files:**
- Modify: `src/modules/shell/domain/pageGuide.ts`
- Modify: `docs/superpowers/specs/2026-10-27-assistant-voice-design.md` only if a live result contradicted it (record, do not rewrite history)
- Verify: every file above

**Interfaces:**
- Consumes: everything produced by Tasks 1–6.
- Produces: a green gate run and a recorded live-proof result.

- [ ] **Step 1: Add the voice console to the Guide manual**

In `src/modules/shell/domain/pageGuide.ts`, inside the `"/assistant"` entry, add to `use`:

```ts
      "The Voice button beside the composer dictates a question into the box — it never sends it, so the words can be corrected first. “Voice” in this page's header opens /assistant/voice, which is the same conversation with hands-free mode, spoken answers and the autonomy panel.",
```

and to `edges`:

```ts
      "Audio is never stored. Push-to-talk sends one clip to the transcription model and keeps only the words; hands-free uses the browser's own recognizer, which sends what it hears to the browser vendor, and runs only on /assistant/voice, only while armed. The autonomy level lives on your account, so a browser cannot upgrade it; while db/migrations/046_assistant_voice_autonomy.sql is unapplied, only “confirm with a click” is offered and a code or hands-free level is refused by name.",
```

- [ ] **Step 2: Run the full gate set**

```bash
node --env-file=docker/.env --experimental-strip-types scripts/prove-assistant-voice.mjs
npx next typegen
node_modules/.bin/tsc --noEmit
npm run lint
npm run check:routes
```

Expected: proof prints `10/10 checks held, 7/7 mutations turned red.`; the rest exit 0.

If `eslint` reports an unused import or a hook dependency, fix the code — do not silence the rule.

- [ ] **Step 3: Run the neighbouring proofs the slice touched**

```bash
node --env-file=docker/.env --experimental-strip-types scripts/prove-form-builder.mjs
```

Expected: the same counts it printed before this slice (the activity surface tuple is read by the trail, not by the forms proof; this run is the regression check that the shared modules still load).

If the repo has a proof for the assistant or activity, run it too (`ls scripts/prove-*.mjs`); a red one that names `ACTIVITY_SURFACES` is this slice's regression, not an old failure.

- [ ] **Step 4: The unauthenticated door**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/assistant/voice
```

Expected: `401`.

- [ ] **Step 5: The live proof, stated with what it could not show**

With the owner signed in, record:
1. A dictation lands in the dock and is sent by a click.
2. A console turn is answered aloud, and "Stop speaking" stops it.
3. One hands-free turn in Chrome starts from "Hey Jarvis".
4. The autonomy panel names 046 and offers only "confirm".
5. Pressing "Confirm with a code" is refused by the server with the 046 sentence (it is not offered, and `setVoiceAutonomy("code")` returns that refusal).

**What this run cannot show without applying 046:** a code-mode approval by voice, and an `open` level. Do not claim either. Report them as blocked on the owner's approval to apply `046_assistant_voice_autonomy.sql`, with the exact steps that will prove them once it is applied:

- apply 046 on explicit approval;
- set the level to `code`, ask the assistant for a stage move, hear the code, say "approve <code>", and read the trail row whose `via` is `assistant voice`;
- set the level to `open` from an account with `settings.manage_platform`, say "yes" after a card is read, and confirm the one click landed.

- [ ] **Step 6: Report and stop**

Report:
- the gate output (counts, not claims);
- the live-proof results, including the two blocked items;
- the one live risk from Task 4: whether the provider accepted audio-only webm, and what was done if it did not;
- that no audio was stored anywhere, and that `046` remains unapplied;
- `git status --short` for the owner to review.

Then wait. Do not commit, do not apply 046, and do not start a production build.

---

## Self-review notes (for the executor)

- **Spec coverage:** every spec section has a task — surfaces (Tasks 5–6), hybrid speech-to-text (Tasks 4–6), wake phrase (Tasks 1, 6), autonomy (Tasks 1–3, 6), no audio retention (Tasks 4, 6, 7), errors (Tasks 4, 5, 6), language (Tasks 1, 5, 6), data model (Task 2), proofs and gates (Tasks 1, 3, 4, 6, 7), out-of-scope items are untouched.
- **The one deliberate divergence to watch:** the spec names `VoiceConsole.tsx` as the surface that owns the voice controls. This plan puts the controls in `VoiceStrip.tsx`, rendered by `AssistantChat` in console mode, so the recorder, the recognizer and `send()` have one owner. `VoiceConsole.tsx` remains the page body. If a reviewer objects, the alternative is an imperative handle from the console into the chat — more plumbing for the same behaviour.
- **One name differs from the spec, deliberately:** the spec calls the peek `verifyApprovalCode`; the implementation is `checkApprovalCode` in `approvals.ts`. Same semantics — reads a `pending` entry, compares, deletes nothing — so the card survives a wrong or missing code.
- **`useWakeWord` is mounted in every chat, inert unless armed.** `AssistantChat` calls the hook unconditionally (hooks cannot be conditional), and its `enabled` flag is `voiceMode === "console" && handsFree`. In the dock and on the Assistant page that is false, so no recognizer is constructed and no microphone is opened. The Guide copy says the same thing in the person's words.
- **Five defects were found and fixed in this self-review, and each is now pinned:** a spoken verdict could release a `confirm` card (the card now carries `autonomy`, the chat branches on it, and check 10 reads the branch); check 10 scanned the route's own comment and would have read "no bucket" as storage (comments are stripped first); the dock mic had no first-use privacy note (the recording popover carries it, and check 10 reads it); the two-minute cap stopped silently (the recorder reports `hitLimit` and both surfaces say it, and check 10 reads it); the Guide promised a Voice link that no task built (`assistant/page.tsx` now gains the pill, and check 10 reads it).
- **Mutations that must stay red:** the seven in Tasks 1, 3 and 4. The autonomy branch in check 10 is a static read, not a mutation target — a behaviour-proof of `spokenApproval` already covers the verdict rule, and the branch is the client's rendering of that rule.
- **Two live behaviours the plan can only invite, not prove:** (1) the recognizer can hear the assistant's own "Listening" cue, so `hearUtterance` drops any final that arrives while the device is speaking — if the live proof still shows a self-triggered turn, the fallback is to disarm the recognizer during playback rather than to remove the cue; (2) under `confirm`, the spec's "voice reads the card aloud" is satisfied by the assistant's answer that announced the card (the approval reply carries the tool and summary and is spoken like any answer), then the verdict path speaks "waiting for your click". There is no separate card-reading call; if the live proof shows the announcement is unclear, speaking `live.summary` in the confirm branch is the smallest fix.
