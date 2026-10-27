"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isOwnVoiceEcho, speechLanguageOf } from "@/modules/assistant/domain/voice";

/**
 * How many utterances stay remembered as the console's own voice. The echo of a
 * sentence arrives while the console is already saying the next one, so the
 * memory has to reach back past the cue — but only as far as the echo window,
 * and the entries are short strings, not audio.
 */
const SPOKEN_MEMORY = 8;

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
  // The words handed to the device, oldest first, each with when it was last
  // being produced. The hands-free recogniser listens to the same room, so this is
  // what it can hear back — the chat needs it a beat after the utterance ends,
  // which is why it is a ref and not state.
  const spokenRecently = useRef<{ text: string; at: number }[]>([]);
  // A request made before the platform had named a single voice. It is not a
  // device with no voice, it is a voice list still loading.
  const waitingForVoices = useRef<{ text: string; language: "ar" | "en" } | null>(null);

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
    // Stopping is the person's choice, not a failed answer: a note from an
    // earlier failure must not outlive the stop that superseded it.
    setError(null);
    // Nor may words still waiting for a voice be spoken after the stop that
    // cancelled them — the list arriving later would replay a stale answer and
    // cut off whatever replaced it.
    waitingForVoices.current = null;
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
        // An empty list means the platform has not answered yet, not that the
        // device is voiceless. Hold the words for the `voiceschanged` pass below
        // rather than telling the person to install a voice they have.
        if (voices.length === 0) {
          waitingForVoices.current = { text: spoken, language: wanted };
          return;
        }
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
      // The window the chat measures an echo against runs from the last moment
      // these words were being produced, not from the call: a 600-character
      // answer plays for tens of seconds, and an echo of its tail would land far
      // outside a window timed from the hand-over. `speaking` covers the playback
      // itself; this stamp covers the beat after it.
      spokenRecently.current = [
        ...spokenRecently.current,
        { text: spoken, at: Date.now() },
      ].slice(-SPOKEN_MEMORY);
      const hearAgain = () => {
        const newest = spokenRecently.current[spokenRecently.current.length - 1];
        if (newest) newest.at = Date.now();
      };
      utterance.onstart = () => {
        setSpeaking(true);
        setError(null);
        hearAgain();
      };
      utterance.onend = () => {
        setSpeaking(false);
        hearAgain();
      };
      utterance.onerror = (event) => {
        // cancel() reports the utterance it stopped as an error event:
        // "canceled" per the Web Speech spec, "interrupted" in Chrome. Neither
        // is a playback failure — the person pressed Stop, or a newer answer
        // replaced this one (speak() cancels before every utterance), so the
        // handler must not claim the answer "could not be spoken".
        if (event.error === "canceled" || event.error === "interrupted") {
          hearAgain();
          return;
        }
        setSpeaking(false);
        setError("That answer could not be spoken.");
      };
      window.speechSynthesis.speak(utterance);
    },
    [voices]
  );

  // The list arrived. Say the one thing asked for while it was still empty.
  useEffect(() => {
    const held = waitingForVoices.current;
    if (!held || voices.length === 0) return;
    waitingForVoices.current = null;
    speak(held.text, held.language);
  }, [voices, speak]);

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
    stop,
    speaking,
    error,
    echoedOwnVoice,
    clearError: () => setError(null),
  };
}
