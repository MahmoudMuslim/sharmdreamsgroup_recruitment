/**
 * When a room is worth a transcription call, as numbers that import nothing.
 *
 * The browser's recogniser could only be told one language at a time, so listening
 * meant choosing what a person was about to speak. This portal's own model removes
 * that choice, and what replaces it is louder and dumber: something is happening, so
 * capture a segment and ask. This module is the whole decision, kept away from the
 * microphone so every rule here can be driven by a fixture — see checks 18 and 19 in
 * `scripts/prove-jarvis-presence.mjs`.
 *
 * What it does *not* decide: whether the person armed the wake word (that is
 * `canArmAmbient` in `jarvis.ts`), whether quiet hours are running (that is
 * `withinQuietHours`), or what a transcript means (that is `matchWakePhrase`).
 */

/* ------------------------------ The gate --------------------------------- */

/**
 * Mean loudness, on the meter's own 0–1 scale, that counts as somebody talking.
 *
 * `useJarvisMeter.ts` divides a frequency-bin mean by 128, so a person speaking
 * normally in a quiet room sits well under full scale. This is the one number a
 * noisy office will need retuned, and retuning it touches nothing else.
 */
export const GATE_LEVEL_THRESHOLD = 0.08;

/**
 * How far below the threshold a level must fall before the segment is over.
 *
 * Speech is not a square wave: a sentence dips between words, and a gate that closed
 * at its own threshold would cut every answer into one-word clips, each of which
 * costs a call.
 */
export const GATE_HYSTERESIS = 0.03;

/**
 * The shortest segment worth a transcription call, in milliseconds.
 *
 * A chair, a cough, and a key are all real sounds under two thirds of a second. The
 * discard is silent and nothing is logged, because a near-miss is not a fact about
 * the person.
 */
export const GATE_MIN_SEGMENT_MS = 350;

/**
 * The longest segment one call will carry, in milliseconds.
 *
 * A cap, not a target: a person who talks without a pause gets their words cut at
 * the ceiling and a fresh clip opened, rather than an ever-growing upload that the
 * door refuses at 8 MB with no transcript to show for it.
 */
export const GATE_MAX_SEGMENT_MS = 5_000;

/** A segment is a span of wall time on the frame clock, in milliseconds. */
export interface Clip {
  startMs: number;
  endMs: number;
}

/**
 * The gate's whole state: when the open segment began, or null while closed.
 *
 * Nothing else is remembered, which is what makes it replayable from a list of
 * `(level, nowMs)` samples in a test and resettable by dropping the value.
 */
export interface GateState {
  openFrom: number | null;
}

/** Closed, with no segment in flight. The starting state of every armed orb. */
export const GATE_CLOSED: GateState = Object.freeze({ openFrom: null });

export interface GateSample {
  gate: GateState;
  /** The segment to transcribe, or null when this sample produced none. */
  clip: Clip | null;
}

/**
 * One loudness reading, and what it does to the segment.
 *
 * Three rules and their order both matter:
 *
 * - The cap is applied before the silence test, so a long speech burst that ends
 *   exactly at the ceiling yields one capped clip rather than a capped clip and a
 *   discarded sliver.
 * - A re-open after the cap needs the level still above the threshold on that same
 *   sample; a person who stopped speaking at the cap is not handed a silent second
 *   clip to transcribe.
 * - A close keeps its clip only at or above the floor.
 *
 * Time comes in as `nowMs` from the caller's `performance.now()`, never from a clock
 * this module reads, so a fixture controls every boundary.
 */
export function sampleGate(gate: GateState, level: number, nowMs: number): GateSample {
  if (gate.openFrom === null) {
    return level >= GATE_LEVEL_THRESHOLD ? { gate: { openFrom: nowMs }, clip: null } : { gate, clip: null };
  }

  if (nowMs - gate.openFrom >= GATE_MAX_SEGMENT_MS) {
    const endMs = gate.openFrom + GATE_MAX_SEGMENT_MS;
    return {
      gate: { openFrom: level >= GATE_LEVEL_THRESHOLD ? endMs : null },
      clip: { startMs: gate.openFrom, endMs },
    };
  }

  if (level < GATE_LEVEL_THRESHOLD - GATE_HYSTERESIS) {
    const kept = nowMs - gate.openFrom >= GATE_MIN_SEGMENT_MS;
    return {
      gate: { openFrom: null },
      clip: kept ? { startMs: gate.openFrom, endMs: nowMs } : null,
    };
  }

  return { gate, clip: null };
}

/* ------------------------------- The quota ------------------------------- */

/** The voice door's window, mirrored from `MAX_BYTES`-adjacent `WINDOW_MS`. */
export const TRANSCRIPTION_WINDOW_MS = 5 * 60_000;

/** The voice door's per-profile ceiling inside that window. */
export const TRANSCRIPTION_MAX_SEGMENTS = 20;

/**
 * The cap, in the words the panel prints.
 *
 * A person who is interrupted mid-sentence by a limit they were never told about has
 * been lied to by an interface, so the ceiling is stated where the switch is, and
 * check 19 keeps it equal to the number the route actually enforces.
 */
export const LISTENING_QUOTA_SENTENCE =
  "Heard segments are transcribed up to 20 times every five minutes for your account. The orb keeps its gate open when that ceiling is reached and says so; nothing is queued or retried behind your back.";
