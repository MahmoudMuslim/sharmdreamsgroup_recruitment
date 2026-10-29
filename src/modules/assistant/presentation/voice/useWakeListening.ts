"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GATE_CLOSED, sampleGate, type GateState } from "@/modules/assistant/domain/listening";
import type { JarvisMeter } from "../useJarvisMeter";
import { transcribeClip } from "./transcribe";

function subscribeToNothing() {
  return () => {};
}

const recorderInThisBrowser = () =>
  typeof window !== "undefined" && typeof window.MediaRecorder === "function";
const recorderOnServer = () => false;

/**
 * Whether this browser can capture and encode audio at all.
 *
 * It used to ask for a speech recogniser, which is a Chrome and Edge thing; the
 * gate and `MediaRecorder` are in Firefox too, so the answer and its reason both
 * change. The Settings console reads this to disable the switch with a sentence
 * rather than offer one that cannot work, and nothing else decides reach from it.
 *
 * An external store, not a mount effect: the server renders `false`, the first
 * client render matches it, and the real answer is applied after — a
 * `useEffect` calling `setAvailable` is the second render the React lint rules refuse.
 */
export function useMicrophoneAvailable(): boolean {
  return useSyncExternalStore(subscribeToNothing, recorderInThisBrowser, recorderOnServer);
}

/** The containers this portal's transcription door will read, in the order it prefers. */
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"];

function segmentType(): string | null {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return null;
  return PREFERRED_TYPES.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) ?? null;
}

function listeningMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser refused the microphone, so nothing is being heard. Allow it and arm the wake word again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone is available to this browser. Connect one and arm the wake word again.";
  }
  return "This browser cannot encode a recording the transcription model can read. Push to talk still works.";
}

/**
 * The door's own words for a segment nobody spoke into.
 *
 * `transcribe.ts` answers a `NO_SPEECH` (and an empty transcript) with this
 * sentence, and the design says silence is not a fault: nobody heard anything, so
 * nothing is shown and nothing is logged. Compared as a literal rather than by
 * pattern, and check 13 in `prove-assistant-voice.mjs` pins it to the client that
 * writes it — a reworded sentence there would otherwise turn every quiet room into
 * an error the person is blamed for.
 */
const NOTHING_HEARD = "Nothing was heard — try again.";

export interface WakeListeningState {
  /** True while a capture is open and segments are being cut from it. */
  listening: boolean;
  /** Why nothing is being heard, in words, or null. */
  error: string | null;
  /** True once the door answered 429 — the orb is still awake, the asking has stopped. */
  quotaHit: boolean;
}

/**
 * The wake word, heard through this portal's own model instead of the browser's.
 *
 * Four properties every caller depends on:
 *
 * - **No second microphone.** The levels come from the meter that already owns the
 *   capture, and the recorder is built on `meter.stream()`. A tab that opened a
 *   second `getUserMedia` would prompt again and release nothing on time.
 * - **Language-blind.** Nothing here names a language, because the gate cannot know
 *   one and the model decides. The phrase match happens on the transcript, in the
 *   caller that owns the conversation.
 * - **Nothing kept.** A segment is `stop()`-ed into a `Blob`, posted, and dropped. A
 *   transcript reaches the caller that owns the conversation, which discards one
 *   without the phrase in it silently; nothing is logged about a near-miss.
 * - **No capture of its own.** This file never calls `getUserMedia` — check 13 and
 *   Task 10's audit both hold that, because a second call is a second prompt and a
 *   second thing to release.
 *
 * Quiet hours are the caller's `quiet` flag: the gate keeps running so the orb stays
 * awake and animating, and segments are simply not sent. A hidden tab tears the whole
 * run down — the rule the recogniser, the recorder and the meter already follow.
 */
export function useWakeListening({
  enabled,
  meter,
  quiet,
  onUtterance,
}: {
  enabled: boolean;
  meter: JarvisMeter;
  quiet: boolean;
  onUtterance: (text: string) => void;
}): WakeListeningState {
  const [error, setError] = useState<string | null>(null);
  const [quotaHit, setQuotaHit] = useState(false);
  // Set by the one condition no retry can heal: a refused microphone, a missing
  // device, or a gateway with no key. `listening` is derived from it rather than
  // written beside it, so the orb never claims to hear while the run has ended.
  const [runEnded, setRunEnded] = useState(false);

  // Kept current after commit rather than during render: the frame loop and the
  // recorder's `onstop` hold one handler for the whole run, and a re-arm to pass a
  // new closure would drop the utterance in flight.
  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  });

  // A render may not answer by setting state before its first paint, but these async
  // paths may, so `quiet` is read through a ref rather than closing over a render.
  const quietRef = useRef(quiet);
  useEffect(() => {
    quietRef.current = quiet;
  });

  // The meter is a fresh object literal on every render of the component that owns
  // it, so `meter` cannot be an effect dependency: the microphone would be torn down
  // and re-opened by the very render that reports a level. A ref keeps the frame loop
  // pointed at whichever meter this is.
  const meterRef = useRef(meter);
  useEffect(() => {
    meterRef.current = meter;
  });

  useEffect(() => {
    if (!enabled) {
      // The run is over, and so is what it had to say: a disarmed orb shows no advice
      // for a capture it no longer holds, and arming again starts clean.
      // The rule that outlives the recogniser (check 13, `prove-assistant-voice.mjs`)
      // asks for exactly these three synchronous setters in this branch, and
      // `useWakeWord.ts` carries the same suppression with the same reason.
      /* eslint-disable react-hooks/set-state-in-effect -- a disarmed console must clear the last run's error before its first paint, and this is the shape the proof pins; the lint rule's callback advice would defer the clear a frame. */
      setError(null);
      setQuotaHit(false);
      setRunEnded(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    const type = segmentType();
    if (!type) {
      setError(listeningMessage(null));
      setRunEnded(true);
      return;
    }

    let alive = true;
    let frame: number | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let gate: GateState = GATE_CLOSED;
    // The door's refusal no retry can heal: a denied microphone, a missing device or
    // a gateway with no key ends the run and says why, rather than looping
    // start → error at frame speed.
    let stopped = false;

    const stopRecorder = () => {
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already ending.
        }
      }
      recorder = null;
      chunks = [];
    };

    /** The run is over for good. Nothing here retries; arming again does. */
    const end = (message: string) => {
      stopped = true;
      alive = false;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      stopRecorder();
      gate = GATE_CLOSED;
      setError(message);
      setRunEnded(true);
    };

    const send = async (clip: Blob) => {
      if (quietRef.current) return;
      const answer = await transcribeClip(clip);
      if (!alive) return;
      if ("error" in answer) {
        if (answer.error === NOTHING_HEARD) return;
        // The ceiling is a state, not a fault to hide: the words that carry the
        // wait are shown, the panel reports the ceiling it hit, and the orb keeps
        // its gate open — the asking stops, the listening does not.
        const quota = /again in|lot of dictation/i.test(answer.error);
        setQuotaHit(quota);
        setError(answer.error);
        // A gateway with no key refuses the next segment exactly as it refused this
        // one, so the room is not posted at it every time somebody speaks.
        if (answer.error.includes("Settings → API keys")) end(answer.error);
        return;
      }
      setQuotaHit(false);
      setError(null);
      if (answer.text) onUtteranceRef.current(answer.text);
    };

    const openSegment = () => {
      const stream = meterRef.current.stream();
      if (!stream || stopped) return;
      chunks = [];
      try {
        recorder = new MediaRecorder(stream, { mimeType: type });
      } catch {
        recorder = null;
        end(listeningMessage(null));
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      // `MediaRecorder` reports no reason worth naming, and a mid-run refusal does
      // not heal by starting again — so the run ends and says what stopped.
      recorder.onerror = () => end("Listening stopped — the browser refused the recording.");
      recorder.onstop = () => {
        const kept = chunks;
        chunks = [];
        recorder = null;
        if (!alive || stopped || kept.length === 0) return;
        void send(new Blob(kept, { type: type.split(";")[0] }));
      };
      try {
        recorder.start();
      } catch {
        stopRecorder();
      }
    };

    const tick = () => {
      if (!alive) return;
      const sample = sampleGate(gate, meterRef.current.read(), performance.now());
      const wasOpen = gate.openFrom !== null;
      gate = sample.gate;
      if (!wasOpen && gate.openFrom !== null) openSegment();
      if (sample.clip) stopRecorder();
      frame = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        alive = false;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        stopRecorder();
        gate = GATE_CLOSED;
        return;
      }
      // Returning to a tab does not overrule a fatal refusal: the condition that
      // ended the run is still there, so restarting would only loop again.
      if (stopped) return;
      alive = true;
      tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // The loop starts whether or not the meter has a capture yet: no stream means a
    // level of zero, which means a gate that stays closed. That is the honest idle
    // state, and it costs no prompt — `getUserMedia` is called in one place, the
    // meter, and this hook never reaches for a second one.
    tick();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      stopRecorder();
      gate = GATE_CLOSED;
    };
    // `meter` is deliberately absent: see the `meterRef` above. The React hooks lint
    // accepts this dependency list as it stands, so there is nothing to disable here.
  }, [enabled]);

  // Listening is not a fact this hook guesses after calling `start()` — it is the
  // meter's own report of a capture that is open, minus any run-ending refusal. The
  // app bar's indicator and the strip's sentence both follow that, so neither can
  // claim to hear a room the browser will not hand over.
  return { listening: enabled && meter.armed && !runEnded, error, quotaHit };
}
