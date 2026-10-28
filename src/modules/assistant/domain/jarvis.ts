/**
 * What the assistant's presence may do, as rules that import nothing.
 *
 * The orb, the wake word and the spoken briefing all live in the browser, so
 * every judgement that keeps a person undisturbed is decided here first: which
 * of the attention feed's queues may make the assistant speak and at what count,
 * the window in which it must not, how often a briefing is due, and what a
 * hand-edited preferences row is allowed to say about itself.
 *
 * Nothing in this file is async and nothing reaches outside it. That is what
 * lets the whole rule set be proved without a database, a microphone or a model
 * (scripts/prove-jarvis-presence.mjs), and what keeps the browser honest: the
 * page reads these answers from the server, never computes its own reach.
 */

// ---------------------------------------------------------------------------
// The queues the watcher is allowed to speak about
// ---------------------------------------------------------------------------

export interface JarvisQueueRule {
  /** The attention feed's own alert id — never a name invented here. */
  id: string;
  /** 1 is spoken about first: a briefing has three sentences, not five. */
  rank: number;
  /** The count that makes it news. A queue at its threshold is not yet news. */
  threshold: number;
  /** The phrase the briefing says, so a number and a noun reach the voice together. */
  spoken: string;
}

/**
 * The five alerts the staff feed counts, most interrupting first. A queue is
 * only watchable because the feed already counts it; anything else would be the
 * assistant inventing a reason to speak.
 */
export const JARVIS_QUEUES: JarvisQueueRule[] = [
  { id: "failed-sends", rank: 1, threshold: 2, spoken: "messages failed to send" },
  { id: "ungraded", rank: 2, threshold: 5, spoken: "papers are waiting to be graded" },
  { id: "new-applications", rank: 3, threshold: 3, spoken: "new applications arrived" },
  { id: "upcoming-interviews", rank: 4, threshold: 1, spoken: "interviews start within the hour" },
  { id: "parked-jobs", rank: 5, threshold: 3, spoken: "openings are parked" },
];

const RULE_BY_ID = new Map(JARVIS_QUEUES.map((rule) => [rule.id, rule]));

export function queueRule(id: string): JarvisQueueRule | null {
  return RULE_BY_ID.get(id) ?? null;
}

export function isJarvisQueue(id: string): boolean {
  return RULE_BY_ID.has(id);
}

// ---------------------------------------------------------------------------
// The clock, and the window speech is suppressed inside
// ---------------------------------------------------------------------------

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Minutes past midnight for a `HH:MM` wall-clock reading, or null.
 *
 * The two forms the database can hold are `08:00` and `18:00`; anything else —
 * `8:30`, `08:60`, `9am` — is not a time, and a preferences row that carries one
 * is treated as carrying nothing rather than as carrying a guess.
 */
export function readClock(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = CLOCK.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Whether `nowMinutes` sits inside the quiet window.
 *
 * The window usually wraps midnight (18:00 to 08:00), so the wrap is the normal
 * path and not an edge case. Its start minute is silent and its end minute is
 * the moment speech comes back. `18:00` to `18:00` is no window at all: it is a
 * person who has not set one, not an instruction to stay quiet all day.
 */
export function withinQuietHours(nowMinutes: number, quietFrom: unknown, quietTo: unknown): boolean {
  const from = readClock(quietFrom);
  const to = readClock(quietTo);
  if (from === null || to === null) return false;
  if (from === to) return false;
  if (from < to) return nowMinutes >= from && nowMinutes < to;
  return nowMinutes >= from || nowMinutes < to;
}

// ---------------------------------------------------------------------------
// Crossings: the only thing the watcher is allowed to interrupt for
// ---------------------------------------------------------------------------

export interface QueueReading {
  id: string;
  count: number;
}

export interface QueueCrossing {
  id: string;
  count: number;
  threshold: number;
  spoken: string;
  rank: number;
}

/**
 * The queues that moved from not-news to news since the last poll.
 *
 * `previous` is the last set of counts the assistant showed this person, or null
 * when there has been none. A first poll is never news: somebody who has just
 * armed the watcher is not interrupted by whatever had already piled up.
 * After that, a queue crossing its threshold is reported once — staying above it
 * is the same news, and only a drain back below the threshold re-arms it.
 */
export function crossedQueues(
  previous: Record<string, number> | null,
  readings: QueueReading[]
): QueueCrossing[] {
  const out: QueueCrossing[] = [];
  for (const reading of readings) {
    const rule = queueRule(reading.id);
    if (!rule) continue;
    if (reading.count <= rule.threshold) continue;
    const before = previous?.[reading.id];
    // Whatever a poll finds that the last one did not hold is a baseline, not
    // news: nobody is interrupted by what had already piled up before the
    // watcher was armed, and a queue the feed has just started counting is not
    // yet the queue the person agreed to be woken for.
    if (before === undefined || before > rule.threshold) continue;
    out.push({
      id: rule.id,
      count: reading.count,
      threshold: rule.threshold,
      spoken: rule.spoken,
      rank: rule.rank,
    });
  }
  // The feed's order is whatever PostgREST returned; the person hears urgency.
  return out.sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// Speech: counts as words, three lines at most
// ---------------------------------------------------------------------------

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * A count the way a voice should read it.
 *
 * Digits reach a synthesiser as "one hundred" or "4 5" depending on the engine,
 * so under a hundred the number is spelled. Past it, digits are more honest than
 * a spoken figure nobody can check in one hearing.
 */
export function countInWords(value: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  if (whole < 20) return ONES[whole];
  if (whole < 100) {
    const tens = Math.floor(whole / 10);
    const rest = whole % 10;
    if (rest === 0) return TENS[tens];
    return `${TENS[tens]}-${ONES[rest]}`;
  }
  return String(whole);
}

/** A briefing is an interruption, so it has three sentences whatever the feed holds. */
export const BRIEFING_MAX_LINES = 3;

/** The crossings as spoken lines: most urgent first, at most three. */
export function briefingSentences(crossings: QueueCrossing[]): string[] {
  const ordered = [...crossings].sort((a, b) => a.rank - b.rank);
  return ordered.slice(0, BRIEFING_MAX_LINES).map(
    (crossing) => `${countInWords(crossing.count)} ${crossing.spoken}`
  );
}

// ---------------------------------------------------------------------------
// Barge-in: the words that cut playback off
// ---------------------------------------------------------------------------

/**
 * Single words only. `quiet` is deliberately absent: it is in the portal's own
 * vocabulary ("quiet hours"), and a briefing that says it must not stop itself
 * halfway through.
 */
const STOP_WORDS = new Set([
  "stop",
  "توقف",
  "اسكت",
  "كفى",
  "كفي",
  "اقف",
  "أقف",
]);

/** Two-word commands a single token cannot carry. */
const STOP_PHRASES = ["be quiet", "quiet now", "shut up"];

const TOKEN_SPLIT = /[\s,.;:!?"'()]+/;

function normalizeSpokenText(utterance: string): string {
  return utterance.trim().toLowerCase();
}

/**
 * Whether the person told the assistant to stop speaking.
 *
 * Whole words, not substrings: `stopwatch` and `quieten` are not commands. A
 * stop word inside a longer sentence still stops playback, because a person who
 * interrupts does not finish the sentence first.
 */
export function isStopCommand(utterance: string): boolean {
  const text = normalizeSpokenText(utterance);
  if (!text) return false;
  const tokens = text.split(TOKEN_SPLIT).filter(Boolean);
  return tokens.some((token) => STOP_WORDS.has(token)) || STOP_PHRASES.some((phrase) => text.includes(phrase));
}

// ---------------------------------------------------------------------------
// The daily briefing: once a day, in the waking hours
// ---------------------------------------------------------------------------

export interface BriefingDueInput {
  /** The date the briefing was last given, `YYYY-MM-DD`, or null if never. */
  lastGivenOn: string | null;
  /** Today, in the same form, as the group's wall clock. */
  today: string;
  nowMinutes: number;
  hour: number | null;
  quiet: boolean;
}

/**
 * Whether the spoken briefing is due now.
 *
 * Quiet hours defer a briefing rather than cancel it: asked during the window
 * the answer is no, and the watcher asks again after it closes, so a person who
 * keeps the assistant silent overnight still gets their one line in the morning.
 */
export function briefingDue({ lastGivenOn, today, nowMinutes, hour, quiet }: BriefingDueInput): boolean {
  if (hour === null) return false;
  if (quiet) return false;
  if (lastGivenOn === today) return false;
  if (nowMinutes < hour * 60) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Preferences: what a raw row is allowed to say about itself
// ---------------------------------------------------------------------------

export interface JarvisPrefs {
  ambient: boolean;
  ambientConsentAt: string | null;
  briefing: boolean;
  briefingHour: number;
  watching: boolean;
  watchQueues: string[];
  quietFrom: string;
  quietTo: string;
  voice: string;
  neuralVoice: boolean;
}

/**
 * Everything off. A person with no row — and there is no row until migration
 * 047 is applied — is not listening, not watching, and not speaking.
 */
export const DEFAULT_JARVIS_PREFS: JarvisPrefs = Object.freeze({
  ambient: false,
  ambientConsentAt: null,
  briefing: false,
  briefingHour: 8,
  watching: false,
  watchQueues: [],
  quietFrom: "18:00",
  quietTo: "08:00",
  voice: "jarvis",
  neuralVoice: true,
});

const VOICE_NAME_MAX = 48;

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampHour(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : DEFAULT_JARVIS_PREFS.briefingHour;
}

function clockOrDefault(value: unknown, fallback: string): string {
  return readClock(value) === null ? fallback : (value as string);
}

function uniqueKnownQueues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isJarvisQueue(item) || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

/**
 * The moment the audio explanation was accepted, or null.
 *
 * A stamp the browser invents is not consent, so only a readable date the server
 * wrote counts. The text is never copied anywhere else — this is a timestamp, not
 * a transcript.
 */
function consentStamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || Number.isNaN(Date.parse(trimmed))) return null;
  return trimmed;
}

/**
 * A row from `assistant_jarvis_prefs` as the values the presence code may use.
 *
 * Every field that arrives outside its vocabulary falls back to its default, so
 * a hand-edited row cannot name a queue the watcher does not count, a clock it
 * cannot parse, or an hour that never arrives. The shape is the row's; the
 * meaning is this file's.
 */
export function normalizeJarvisPrefs(row: Record<string, unknown> | null): JarvisPrefs {
  if (!row) return DEFAULT_JARVIS_PREFS;
  return {
    ambient: flag(row.ambient, DEFAULT_JARVIS_PREFS.ambient),
    ambientConsentAt: consentStamp(row.ambient_consent_at),
    briefing: flag(row.briefing, DEFAULT_JARVIS_PREFS.briefing),
    briefingHour: clampHour(row.briefing_hour),
    watching: flag(row.watching, DEFAULT_JARVIS_PREFS.watching),
    watchQueues: uniqueKnownQueues(row.watch_queues),
    quietFrom: clockOrDefault(row.quiet_from, DEFAULT_JARVIS_PREFS.quietFrom),
    quietTo: clockOrDefault(row.quiet_to, DEFAULT_JARVIS_PREFS.quietTo),
    voice: voiceName(row.voice),
    neuralVoice: flag(row.neural_voice, DEFAULT_JARVIS_PREFS.neuralVoice),
  };
}

function voiceName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_JARVIS_PREFS.voice;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, VOICE_NAME_MAX) : DEFAULT_JARVIS_PREFS.voice;
}

/**
 * Whether the background wake word may run for this person.
 *
 * Both halves have to be true: the switch is on, and the audio explanation was
 * accepted with a stamp the server wrote. A browser that flipped `ambient` alone
 * arms nothing, because it cannot produce that stamp.
 */
export function canArmAmbient(prefs: JarvisPrefs): boolean {
  return prefs.ambient === true && typeof prefs.ambientConsentAt === "string" && prefs.ambientConsentAt.length > 0;
}
