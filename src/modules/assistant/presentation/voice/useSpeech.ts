"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chunkForSpeech,
  DEFAULT_SPEECH_RATE,
  isOwnVoiceEcho,
  normaliseSpeechRate,
  pickDeviceVoice,
  speechLanguageOf,
  type DeviceVoiceChoice,
} from "@/modules/assistant/domain/voice";

/**
 * How many pieces stay remembered as the console's own voice. The echo of a piece
 * arrives while the console is already saying the next one, so the memory has to
 * reach back past the cue — but only as far as the echo window, and the entries are
 * short strings, not audio.
 */
const SPOKEN_MEMORY = 8;

/** One sentence-sized piece, asked of one language. */
interface Piece {
  text: string;
  language: "ar" | "en";
}

/**
 * The console's voice: the device's own, played from a queue.
 *
 * Nothing leaves the browser to say an answer. That is the whole of the design, and
 * it has one consequence the first version got wrong: `speechSynthesis` is a single
 * global object with one voice, and `cancel()` stops everything in it. Cancelling
 * before every sentence — which is what this hook used to do — means the second
 * sentence of an answer is heard as the first one cut off mid-word. So sentences
 * are queued and handed to the browser's own playback queue, and `cancel()` is only
 * ever called by the two things that genuinely mean silence: the person pressing
 * Stop, and a surface that owns the speech unmounting.
 *
 * `getVoices()` can be empty on first call while the platform loads them; the
 * listener below is what stops a working device from being reported as voiceless.
 */
export function useSpeech(choice: DeviceVoiceChoice = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The words handed to the device, oldest first, each with when it was last
  // being produced. The hands-free recogniser listens to the same room, so this is
  // what it can hear back — the chat needs it a beat after the utterance ends,
  // which is why it is a ref and not state.
  const spokenRecently = useRef<{ text: string; at: number }[]>([]);
  /** Pieces asked for and not yet finished playing, oldest first. */
  const queue = useRef<Piece[]>([]);
  /** True while an utterance handed over by THIS hook is being produced. */
  const producing = useRef(false);
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const choiceRef = useRef({ voiceId: "", rate: DEFAULT_SPEECH_RATE });

  // Kept after commit rather than during render: an in-flight utterance's handler
  // closes over the version of `pump` that started it, and reads the choice through
  // this ref so a voice changed mid-answer applies to the next piece, not the one
  // being heard.
  useEffect(() => {
    choiceRef.current = {
      voiceId: choice.voiceId ?? "",
      rate: normaliseSpeechRate(choice.rate ?? DEFAULT_SPEECH_RATE),
    };
  });

  /**
   * Hand the device the next piece, if it is not already busy with one of ours.
   *
   * A piece whose language the machine cannot speak is dropped with the reason, and
   * the queue moves on — one unpronounceable line in a long answer must not be the
   * end of the rest of it. An empty voice list is not that case: the piece stays at
   * the head of the queue for the `voiceschanged` pass to try again.
   */
  const pump = useCallback(() => {
    if (producing.current) return;
    for (;;) {
      const next = queue.current[0];
      if (!next) {
        setSpeaking(false);
        return;
      }
      if (voices.current.length === 0) return;
      const { voiceId, rate } = choiceRef.current;
      const voice = pickDeviceVoice(voices.current, voiceId, next.language);
      if (!voice) {
        queue.current.shift();
        setError(
          next.language === "ar"
            ? "This device has no Arabic voice installed — the answer stays on screen."
            : "This device has no English voice installed — the answer stays on screen."
        );
        continue;
      }
      queue.current.shift();
      producing.current = true;
      const utterance = new SpeechSynthesisUtterance(next.text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      // The window the chat measures an echo against runs from the last moment
      // these words were being produced, not from the call: a long answer plays for
      // tens of seconds, and an echo of its tail would land far outside a window
      // timed from the hand-over. `speaking` covers the playback itself; this stamp
      // covers the beat after it.
      spokenRecently.current = [
        ...spokenRecently.current,
        { text: next.text, at: Date.now() },
      ].slice(-SPOKEN_MEMORY);
      const hearAgain = () => {
        const newest = spokenRecently.current[spokenRecently.current.length - 1];
        if (newest) newest.at = Date.now();
      };
      const done = () => {
        producing.current = false;
        setSpeaking(false);
        pump();
      };
      utterance.onstart = () => {
        setSpeaking(true);
        setError(null);
        hearAgain();
      };
      utterance.onend = () => {
        hearAgain();
        done();
      };
      utterance.onerror = (event) => {
        // cancel() reports the utterance it stopped as an error event: "canceled"
        // per the Web Speech spec, "interrupted" in Chrome. Neither is a playback
        // failure — the person pressed Stop, or a cue asked to be heard now — so the
        // handler must not claim the answer "could not be spoken".
        if (event.error === "canceled" || event.error === "interrupted") {
          hearAgain();
          done();
          return;
        }
        setError("That answer could not be spoken.");
        done();
      };
      window.speechSynthesis.speak(utterance);
      return;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => {
      voices.current = window.speechSynthesis.getVoices();
      pump();
    };
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      // Only the hook that is actually producing sound may silence the device.
      // Every voice surface in this portal shares one global `speechSynthesis`, so
      // an unmount that cancelled unconditionally cut whatever the orb was saying.
      if (producing.current) window.speechSynthesis.cancel();
      queue.current = [];
    };
  }, [pump]);

  /** Silence everything this browser was saying, and forget what was queued. */
  const stop = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    queue.current = [];
    producing.current = false;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    // Stopping is the person's choice, not a failed answer: a note from an
    // earlier failure must not outlive the stop that superseded it, and pieces
    // still waiting must not play after the click that cancelled them.
    setError(null);
  }, []);

  /**
   * Say this, after anything already asked.
   *
   * The whole text is queued, never a prefix of it: an answer that stopped at a
   * character count left the person hearing half a sentence they could see all of.
   */
  const speak = useCallback(
    (text: string, language?: "ar" | "en") => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setError("This browser cannot speak answers.");
        return;
      }
      const wanted = language ?? speechLanguageOf(text);
      if (!wanted) return;
      const pieces = chunkForSpeech(text).map((piece) => ({ text: piece, language: wanted }));
      if (pieces.length === 0) return;
      queue.current = [...queue.current, ...pieces];
      pump();
    },
    [pump]
  );

  /**
   * Say this now, ahead of anything queued.
   *
   * A cue is not a second answer: "Listening" that waits behind forty seconds of a
   * reply describes a microphone that is not open any more. Cutting the queue is the
   * honest thing it has always done — it is an answer being cut that was the bug.
   */
  const speakNow = useCallback(
    (text: string, language?: "ar" | "en") => {
      stop();
      speak(text, language);
    },
    [speak, stop]
  );

  // Whether these words are the device's own voice coming back. The clock is read
  // here, beside the stamp it is measured from: a component body is render scope
  // for React's rules, and an impure call there is what they forbid — while this
  // runs only from the recogniser's own callback.
  const echoedOwnVoice = useCallback(
    (heard: string) => isOwnVoiceEcho(heard, spokenRecently.current, Date.now()),
    []
  );

  return {
    speak,
    speakNow,
    stop,
    speaking,
    error,
    echoedOwnVoice,
    clearError: () => setError(null),
  };
}
