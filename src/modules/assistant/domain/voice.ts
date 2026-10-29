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
  /**
   * The level a card may act on, always safe to use directly: a stored `open`
   * without the grant has already been demoted to `confirm` by
   * `effectiveAutonomy`.
   */
  level: VoiceAutonomy;
  /**
   * True when a row was read — the person has chosen. False when there is no
   * row, the table is absent, or the read failed; `problem` says which.
   */
  stored: boolean;
  /** True when the signed-in person may choose `open`. */
  canOpen: boolean;
  /**
   * Why `level` is not the stored fact: the table is absent, the read failed,
   * or neither.
   */
  problem: "absent" | "unreadable" | null;
}

export function isVoiceAutonomy(value: unknown): value is VoiceAutonomy {
  return typeof value === "string" && (VOICE_AUTONOMY as readonly string[]).includes(value);
}

/**
 * The level an approval card may act on.
 *
 * `open` is a code-less, hands-free path, so it is only honoured while the
 * account holds `settings.manage_platform`. A demoted account keeps the stored
 * fact visible through the reader's state, but never keeps the hands-free
 * behaviour: this demotes it to `confirm` for every consumer, including the one
 * that mints a card. `code` and `confirm` need no grant and pass through.
 */
export function effectiveAutonomy(level: VoiceAutonomy, canOpen: boolean): VoiceAutonomy {
  return level === "open" && !canOpen ? "confirm" : level;
}

/* ------------------------------ Wake phrase ------------------------------ */

export const DEFAULT_WAKE_PHRASE = "Hey Jarvis";
export const MAX_WAKE_PHRASE_CHARS = 48;

/**
 * Case, punctuation, spacing and Arabic diacritics are noise in a spoken phrase.
 * Tatweel and harakat are drawn rather than pronounced, the alef forms sound
 * identical, and a recogniser is free to return any of them for the same words.
 *
 * The wake phrase and the command matcher both read through this, and must: a
 * phrase the wake test folds one way and the command test folds another is two
 * wake words, and the person only ever set one.
 */
export function fold(text: string): string {
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

/**
 * The person's own words after the wake phrase, case and punctuation intact.
 *
 * `matchWakePhrase` answers in folded text, which is right for deciding whether
 * the phrase was said and wrong for saving a question: a stored turn should read
 * as the person spoke it, not lowercased and stripped. The phrase is a prefix of
 * the folded transcript, so dropping the same number of words from the raw
 * transcript leaves the question. A missing or blank phrase leaves the transcript
 * whole, which is what `matchWakePhrase` treats as "never matched" anyway.
 */
export function wakeRemainder(transcript: string, phrase: string): string {
  const wanted = normalizeWakePhrase(phrase);
  if (!wanted) return transcript.trim();
  const words = wanted.split(" ").length;
  return transcript.trim().split(/\s+/).slice(words).join(" ");
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

/**
 * A recogniser transcribing Arabic speech writes the digits as Arabic-Indic
 * (٧, U+0667) or Eastern Arabic (۷, U+06F7) as readily as ASCII 7, and both are
 * the digit the code means. Mapped before the filter: otherwise the digits are
 * silently dropped and no spoken code ever matches.
 */
function asciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => {
    const point = digit.codePointAt(0) ?? 0;
    return String(point - (point >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * Upper-case letters and digits only, so "K7Q2", "k7q2", "k-7-q-2" and "K٧Q٢"
 * agree.
 */
export function normalizeSpokenCode(text: string): string {
  return asciiDigits(text).toUpperCase().replace(/[^A-Z0-9]/g, "");
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

/**
 * The code token an utterance carries, exactly as the server wants it.
 *
 * The server compares one normalised token to the code (`sameCode`), not a
 * sentence, so "approve K7Q2" must reach it as "K7Q2". `spokenApproval` has
 * already decided the words are a verdict and that the code was in them; this
 * answers with the characters to send. It repeats the same containment rule so
 * the two can never disagree, and returns null when the code is absent — the
 * caller then leaves the card live rather than sending a sentence that can only
 * mismatch.
 */
export function spokenCodeIn(transcript: string, code: string): string | null {
  const wanted = normalizeSpokenCode(code);
  if (!wanted) return null;
  const spoken = normalizeSpokenCode(transcript);
  const at = spoken.indexOf(wanted);
  return at === -1 ? null : spoken.slice(at, at + wanted.length);
}

/**
 * Words the console cannot mean to hear.
 *
 * A listener armed for hands-free keeps listening to the same room the device
 * speaks into, so the console's own voice comes back as a transcript — the cue it
 * said, the approval line naming a code, the answer it read aloud. None of that is
 * a person. A final whose words run inside what was just spoken is an echo of the
 * device, and acting on it would let the assistant answer itself: start a second
 * turn from its own reading, or release the very card whose code it just said.
 *
 * What is compared is every string still inside the window, not only the last one.
 * The console says something new before the echo of the old thing arrives — the
 * cue that arms the listener cuts off the answer it was reading — so a memory of
 * one sentence forgets the sentence the echo came from and lets it through.
 *
 * The heard words must line up with whole words of what was said. Folding makes
 * each side a run of space-separated words, so an unanchored test would call "ok"
 * an echo of anything containing "token", and a person's one-word answer would be
 * dropped for a letter run inside the console's own sentence.
 *
 * The window is short by design. A real echo arrives with the clip that carried
 * it, while a person thinking about an answer takes longer than that — and the
 * safe direction is to drop the utterance and keep waiting, not to act.
 */
export const OWN_VOICE_WINDOW_MS = 4000;

export function isOwnVoiceEcho(
  heard: string,
  spoken: readonly { text: string; at: number }[],
  now: number
): boolean {
  const came = fold(heard);
  if (!came) return false;
  const heardWords = ` ${came} `;
  return spoken.some(
    (entry) =>
      now - entry.at <= OWN_VOICE_WINDOW_MS && ` ${fold(entry.text)} `.includes(heardWords)
  );
}

/* --------------------------- Spoken summaries ---------------------------- */

/**
 * How much of an answer the device is handed at once.
 *
 * An answer is read whole, in pieces of about this size: one long task is the shape
 * a browser is likeliest to lose, and a person who presses Stop should not have a
 * minute of speech queued behind it. Nothing is cut — every piece reaches the
 * queue, so the last sentence of a long answer is heard like the first.
 */
export const SPOKEN_CHUNK_CHARS = 600;

/**
 * An answer as it should be heard.
 *
 * Never markup: a synthesizer reads asterisks and pipe characters aloud. A fenced
 * block and a table are named rather than read, because they are read with the
 * eyes. The whole answer comes back: a reply that stopped at a character count
 * would leave the person hearing half of a sentence they can see all of.
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
    .replace(/\*([^*]+)\*/g, "$1")
    // Underscores only mark emphasis at a word edge: `update_application_stage`
    // is an identifier a person needs to hear, not two italics around "application".
    .replace(/(?<![\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * Plain text, in the order it was written, in pieces the device can be handed.
 *
 * Sentences are kept whole and packed as tightly as the piece allows, because the
 * gaps a browser leaves between tasks are heard as hesitation. A single sentence
 * longer than a piece is broken at a word, never inside one.
 */
export function chunkForSpeech(text: string, limit = SPOKEN_CHUNK_CHARS): string[] {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return [];
  const pieces: string[] = [];
  for (const raw of source.split(/(?<=[.!?؟۔])\s+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > limit) {
      let rest = sentence;
      while (rest.length > limit) {
        const at = rest.lastIndexOf(" ", limit);
        const cut = at > limit * 0.5 ? at : limit;
        pieces.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) pieces.push(rest);
      continue;
    }
    const last = pieces[pieces.length - 1];
    if (last && `${last} ${sentence}`.length <= limit) pieces[pieces.length - 1] = `${last} ${sentence}`;
    else pieces.push(sentence);
  }
  return pieces;
}

/* ------------------------------ Device voice ------------------------------ */

export const SPEECH_RATE_MIN = 0.6;
export const SPEECH_RATE_MAX = 2;
export const DEFAULT_SPEECH_RATE = 1;

/**
 * A rate as this portal will use it.
 *
 * The device accepts anything from 0.1 to 10; this portal offers a slower-to-
 * double range and rounds to a tenth, so a value that arrived from a stale tab or a
 * hand-edited store still cannot make the assistant unintelligible.
 */
export function normaliseSpeechRate(value: unknown): number {
  // Absence answers with nothing, and Number of nothing is a finite 0 — which would
  // be read as "the slowest pace" rather than "no pace chosen".
  if (value === null || value === undefined || value === "") return DEFAULT_SPEECH_RATE;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SPEECH_RATE;
  const clamped = Math.min(SPEECH_RATE_MAX, Math.max(SPEECH_RATE_MIN, parsed));
  return Math.round(clamped * 10) / 10;
}

export interface DeviceVoiceLike {
  voiceURI: string;
  lang: string;
}

/**
 * What this browser was told about its own voice, handed to whatever speaks.
 *
 * Both fields are browser preferences, not account data: a voice chosen for one
 * machine is worth nothing on another, so the reader lives beside the store and each
 * surface passes the plain values down.
 */
export interface DeviceVoiceChoice {
  /** A `voiceURI`, or empty for "whatever the device has for this language". */
  voiceId?: string;
  /** Speed against normal. Anything outside the portal's range is clamped. */
  rate?: number;
}

/**
 * Which installed voice reads a sentence.
 *
 * The person's own choice wins while it is still on this machine — `voiceURI`
 * names a voice this device has, so a choice carried to another computer simply
 * stops matching and the language decides again. With neither a choice nor a
 * language match there is nothing to speak with, and the words stay on screen.
 */
export function pickDeviceVoice<T extends DeviceVoiceLike>(
  voices: readonly T[],
  voiceId: string,
  language: "ar" | "en" | null
): T | null {
  const wantedVoice = voiceId.trim();
  if (wantedVoice) {
    const chosen = voices.find((entry) => entry.voiceURI === wantedVoice);
    if (chosen) return chosen;
  }
  if (!language) return null;
  return voices.find((entry) => entry.lang.toLowerCase().startsWith(language)) ?? null;
}

/* ------------------------------- Language -------------------------------- */

export function speechLanguageOf(text: string): "ar" | "en" | null {
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return null;
  return arabic > latin ? "ar" : "en";
}
