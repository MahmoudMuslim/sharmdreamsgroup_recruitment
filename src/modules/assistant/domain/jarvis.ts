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

/**
 * What is news at this moment, whether or not it just became news.
 *
 * The watcher interrupts only on a crossing, but a briefing is a summary read at
 * a chosen hour: the queues standing above their threshold then are what the
 * person asked to hear, including the ones that crossed while they were away. A
 * queue at its threshold is still not news here either.
 */
export function newsQueues(readings: QueueReading[]): QueueCrossing[] {
  const out: QueueCrossing[] = [];
  for (const reading of readings) {
    const rule = queueRule(reading.id);
    if (!rule) continue;
    if (reading.count <= rule.threshold) continue;
    out.push({
      id: rule.id,
      count: reading.count,
      threshold: rule.threshold,
      spoken: rule.spoken,
      rank: rule.rank,
    });
  }
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
// The wake phrase
// ---------------------------------------------------------------------------

/**
 * The longest phrase a person may be woken by, in characters.
 *
 * `domain/voice.ts` owns the same number and `jarvis.ts` imports nothing, so this
 * is a deliberate duplicate pinned by check 15 in `prove-jarvis-presence.mjs`
 * rather than a shared import that would break the pure-module rule. The SQL
 * ceiling in `db/migrations/050_jarvis_wake_phrase.sql` is the third copy.
 */
export const MAX_WAKE_PHRASE_LEN = 48;

/**
 * The phrase an account with none has, spelled here because the panel has to show
 * it before the person's own row has arrived.
 *
 * `domain/voice.ts` owns the same string; check 15 pins the two together.
 */
export const DEFAULT_WAKE_PHRASE_TEXT = "Hey Jarvis";

/**
 * The moment the microphone's destination changed from the browser's own speech
 * service to this portal's own gateway.
 *
 * A stamp taken before it was taken under an explanation that is no longer true, so
 * it no longer arms anything: the panel asks again, once, in the new words. The
 * date is this slice's, not a rolling one — a stamp written after it can only have
 * been earned by the explanation now on the screen.
 */
export const AMBIENT_CONSENT_V2_AT = "2026-10-29T00:00:00.000Z";

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
  /** The words that wake the orb, or null for `Hey Jarvis`. Stored on the account. */
  wakePhrase: string | null;
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
  wakePhrase: null,
});

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
 * A stored phrase, or null when the value is not one.
 *
 * A hand-edited row cannot name a phrase the ceiling refuses or carry a control
 * character, so an out-of-vocabulary value reads as "no choice made" rather than as
 * a phrase the orb would try to match.
 */
function wakePhraseValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > MAX_WAKE_PHRASE_LEN) return null;
  if (/[\u0000-\u001F]/.test(value)) return null;
  return clean;
}

/**
 * Whether a consent stamp was earned under the explanation now on the screen.
 *
 * Only the destination of the audio changed, so this is one comparison against a
 * fixed date rather than a new column: a stamp at exactly the cutoff counts, because
 * it could not have been taken under wording that had already been replaced.
 */
export function consentCarriesOver(stamp: unknown): boolean {
  const clean = consentStamp(stamp);
  if (clean === null) return false;
  return Date.parse(clean) >= Date.parse(AMBIENT_CONSENT_V2_AT);
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
    wakePhrase: wakePhraseValue(row.wake_phrase),
  };
}

/**
 * Whether the background wake word may run for this person.
 *
 * Three things have to be true: the switch is on, the audio explanation was
 * accepted with a stamp the server wrote, and that stamp was written under the
 * explanation now on the panel. The third is what makes the destination change
 * honest — a yes taken under "Chrome sends this to Google" is not a yes about this
 * portal's gateway, so `AMBIENT_CONSENT_V2_AT` retires it and the orb stays quiet
 * until the person answers the new question.
 */
export function canArmAmbient(prefs: JarvisPrefs): boolean {
  return prefs.ambient === true && consentCarriesOver(prefs.ambientConsentAt);
}

// ---------------------------------------------------------------------------
// The row a save is allowed to write
// ---------------------------------------------------------------------------

/**
 * Every column a person's own row may carry, and nothing else.
 *
 * `profile_id` and `updated_at` are absent on purpose: the writer adds them from
 * the session and the clock, so a draft that names another profile or a stamp of
 * its own making cannot reach the database. `ambient_consent_at` is absent for
 * the same reason in the other direction — only the server may write it, and only
 * from a consent event it is told about.
 */
export const JARVIS_PREF_COLUMNS: readonly string[] = Object.freeze([
  "ambient",
  "ambient_consent_at",
  "briefing",
  "briefing_hour",
  "watching",
  "watch_queues",
  "quiet_from",
  "quiet_to",
  "wake_phrase",
]);

/**
 * Draft field names, camelCase and the row's own spelling alike, to columns.
 *
 * The writer (`application/jarvisSettings.ts`) reads this map to name the
 * migration a refused write actually needs, so a draft that asked for a wake
 * phrase is told about the file that adds its column, not the one that created
 * the table it already has.
 */
export const COLUMN_BY_DRAFT_KEY: Record<string, string> = {
  ambient: "ambient",
  briefing: "briefing",
  briefingHour: "briefing_hour",
  briefing_hour: "briefing_hour",
  watching: "watching",
  watchQueues: "watch_queues",
  watch_queues: "watch_queues",
  quietFrom: "quiet_from",
  quiet_from: "quiet_from",
  quietTo: "quiet_to",
  quiet_to: "quiet_to",
  wakePhrase: "wake_phrase",
  wake_phrase: "wake_phrase",
};

/** A prefs value back in the row's own shape, so a merge is one normalize. */
export function prefsToRow(prefs: JarvisPrefs): Record<string, unknown> {
  return {
    ambient: prefs.ambient,
    ambient_consent_at: prefs.ambientConsentAt,
    briefing: prefs.briefing,
    briefing_hour: prefs.briefingHour,
    watching: prefs.watching,
    watch_queues: prefs.watchQueues,
    quiet_from: prefs.quietFrom,
    quiet_to: prefs.quietTo,
    wake_phrase: prefs.wakePhrase,
  };
}

/**
 * One draft value, accepted only if the field can actually express it.
 *
 * The stored choice is the fallback, not the default: a switch sent as a string
 * or a clock typed as `9am` was not a request to reset that field, and quietly
 * moving a person's quiet window back to six o'clock would make the assistant
 * speak at an hour nobody chose.
 */
function draftValue(column: string, value: unknown, previous: JarvisPrefs): unknown {
  switch (column) {
    case "ambient":
      return typeof value === "boolean" ? value : previous.ambient;
    case "briefing":
      return typeof value === "boolean" ? value : previous.briefing;
    case "watching":
      return typeof value === "boolean" ? value : previous.watching;
    case "briefing_hour":
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23
        ? value
        : previous.briefingHour;
    case "quiet_from":
      return readClock(value) === null ? previous.quietFrom : value;
    case "quiet_to":
      return readClock(value) === null ? previous.quietTo : value;
    // An empty list is the safe answer to a list nothing in it names: a watcher
    // that knows no queue says nothing, which is what nobody asked for but never
    // what a garbled field should cause.
    case "watch_queues":
      return uniqueKnownQueues(value);
    // Refused, not reset: a phrase over the ceiling, blank, or carrying a control
    // character is a field that cannot express the choice, and quietly moving a
    // person back to "Hey Jarvis" would un-wake an orb they had just tuned. A
    // cleared field *is* a request — it reads as null, which is the default.
    case "wake_phrase":
      return value === null || (typeof value === "string" && value.trim() === "") ? null : wakePhraseValue(value) ?? previous.wakePhrase;
    default:
      return undefined;
  }
}

/**
 * The row to write for a draft, over the state the server holds.
 *
 * Three things are true of the result and of nothing else in this slice:
 *
 * - It carries exactly `JARVIS_PREF_COLUMNS`, so a draft cannot introduce a
 *   column the table does not have or claim a different `profile_id`.
 * - Only the names in `COLUMN_BY_DRAFT_KEY` are read from the draft, each through
 *   the same ceilings `normalizeJarvisPrefs` applies to a row, and a value that
 *   fails its ceiling leaves the stored choice where it was rather than falling
 *   back to a default the person never picked.
 * - `ambient` is on only where a *carrying* consent stamp exists: one this request
 *   earned by accepting the audio explanation, or one the server already wrote
 *   after `AMBIENT_CONSENT_V2_AT`. A stamp taken under the retired wording earns
 *   nothing, and a switch flipped without either is written as off, so the
 *   microphone never arms on a value the person did not agree to.
 *
 * Turning the switch off deliberately keeps a stamp that still carries. The
 * explanation was heard once, and a later re-arming is that same consent, not a
 * new one; a stamp that no longer carries is cleared, not kept.
 */
export function jarvisRowToSave(
  draft: Record<string, unknown>,
  previous: JarvisPrefs,
  consent: { given: boolean; stamp: string }
): Record<string, unknown> {
  const merged: Record<string, unknown> = prefsToRow(previous);
  for (const key of Object.keys(draft)) {
    const column = COLUMN_BY_DRAFT_KEY[key];
    if (!column) continue;
    merged[column] = draftValue(column, draft[key], previous);
  }

  const next = normalizeJarvisPrefs(merged);
  const heard = consentStamp(consent.stamp);
  const earned = consent.given === true && heard !== null;

  if (next.ambient) {
    if (earned) next.ambientConsentAt = heard;
    else if (!consentCarriesOver(next.ambientConsentAt)) {
      next.ambient = false;
      next.ambientConsentAt = null;
    }
  }

  return prefsToRow(next);
}

// ---------------------------------------------------------------------------
// What the activity trail is allowed to claim about a save
// ---------------------------------------------------------------------------

const SWITCH_LABELS: Record<"ambient" | "briefing" | "watching", string> = {
  ambient: "wake word listening",
  briefing: "morning briefing",
  watching: "threshold alerts",
};

/**
 * The fields a person moved, in words, and nothing else.
 *
 * Two rules here are about the record rather than the setting:
 *
 * - A switch that did not move is not named. The trail is read by whoever can
 *   read it, and "presence settings changed: wake word" beside a save that left
 *   the wake word alone is a false statement in a record people rely on.
 * - `ambientConsentAt` is never named. It is a timestamp the server writes when
 *   the audio explanation is accepted, and the explanation itself is the record
 *   of that moment; the trail says the switch moved, which is the fact a reader
 *   is looking for.
 *
 * The row is never copied into the summary either: a queue list is a claim about
 * what the assistant may say about other people's applications.
 */
export function summarizeJarvisChange(previous: JarvisPrefs, next: JarvisPrefs): string {
  const parts: string[] = [];

  for (const key of Object.keys(SWITCH_LABELS) as (keyof typeof SWITCH_LABELS)[]) {
    if (previous[key] !== next[key]) parts.push(`${SWITCH_LABELS[key]} ${next[key] ? "on" : "off"}`);
  }
  if (previous.briefingHour !== next.briefingHour) parts.push(`briefing from ${next.briefingHour}:00`);
  if (previous.watchQueues.join(",") !== next.watchQueues.join(",")) {
    parts.push(next.watchQueues.length ? `${next.watchQueues.length} queues watched` : "no queues watched");
  }
  if (previous.quietFrom !== next.quietFrom || previous.quietTo !== next.quietTo) {
    parts.push(`quiet ${next.quietFrom}-${next.quietTo}`);
  }
  if (next.wakePhrase !== previous.wakePhrase) {
    parts.push(
      next.wakePhrase === null
        ? "wake phrase (back to the default)"
        : `wake phrase “${next.wakePhrase}”`
    );
  }

  return parts.length ? `Assistant presence: ${parts.join(", ")}` : "Assistant presence settings saved";
}
