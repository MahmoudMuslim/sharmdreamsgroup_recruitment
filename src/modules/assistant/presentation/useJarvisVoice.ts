"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isOwnVoiceEcho, speechLanguageOf } from "@/modules/assistant/domain/voice";

/**
 * How many sentences the presence remembers as its own voice. An echo of the
 * briefing arrives while the next line is already being produced, so the memory
 * has to reach past the cue — the entries are short strings, never audio.
 */
const SPOKEN_MEMORY = 12;

/**
 * How long a sentence waits for `getVoices()` before the device is called
 * voiceless.
 *
 * The first call answers with an empty list while the platform loads its voices.
 * A list that never arrives is a different fact, and after this grace the person
 * is told that one instead of the sentence waiting in a queue nobody drains.
 */
const VOICE_LIST_GRACE_MS = 2_000;

/**
 * Two notes, no audio files.
 *
 * A chime is how a person knows the orb heard them or has something to say before
 * they look at the screen. Oscillators cost nothing to ship, never 404, and obey
 * the same autoplay gate as the voice does — so a tab that has not been touched
 * gets silence and a truthful note rather than a broken `<audio>`.
 */
const TONES: Record<"heard" | "alert", { from: number; to: number }> = {
  heard: { from: 660, to: 880 },
  alert: { from: 520, to: 392 },
};

interface Playback {
  context: AudioContext;
}

/** Silence the device voice. Needs nothing from the component, so it lives outside it. */
function stopDevice(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/** What became of one sentence handed to the device. */
type DeviceSpeech = "spoke" | "held" | "failed";

/**
 * The presence's voice: the one this device already has.
 *
 * Nothing leaves the browser to say a sentence. That is the whole of the design:
 * the briefing, an alert and a spoken answer are read by `speechSynthesis`, and a
 * machine with no voice for the sentence's language says so on screen instead of
 * pretending it spoke.
 *
 * Browsers block sound in a tab nobody has touched. That is reported as what it is
 * instead of being swallowed, because a briefing that plays nothing and claims to
 * have played is the worst kind of success.
 */
export function useJarvisVoice() {
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const playback = useRef<Playback | null>(null);
  const deviceVoices = useRef<SpeechSynthesisVoice[]>([]);
  const spoken = useRef<{ text: string; at: number }[]>([]);
  /** The sentence asked for before the platform had named a single voice. */
  const waiting = useRef<string | null>(null);
  /** When the grace for that voice list runs out. */
  const holdTimer = useRef<number | null>(null);

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const remember = useCallback((text: string, at: number) => {
    spoken.current = [...spoken.current, { text, at }].slice(-SPOKEN_MEMORY);
  }, []);

  const stop = useCallback(() => {
    stopDevice();
    setSpeaking(false);
    // A deliberate stop is not a failed sentence, so the reason for the last one
    // must not outlive it — and the words held for a voice that has not arrived
    // must not play after the stop that cancelled them.
    setNotice(null);
    clearHold();
    waiting.current = null;
  }, [clearHold]);

  /**
   * The device reads the sentence itself. Works with no key and no network.
   *
   * `"held"` is not a failure: `getVoices()` is empty on first call while the
   * platform loads its list, so the sentence waits for the `voiceschanged` pass
   * instead of being reported as a machine that has no voice.
   */
  const speakOnDevice = useCallback(
    (text: string): DeviceSpeech => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setNotice("This browser cannot read a sentence aloud.");
        return "failed";
      }
      const wanted = speechLanguageOf(text);
      if (!wanted) return "failed";
      const voices = deviceVoices.current;
      if (voices.length === 0) {
        waiting.current = text;
        clearHold();
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          if (waiting.current !== text || deviceVoices.current.length > 0) return;
          waiting.current = null;
          setNotice("This device has no voice installed, so the sentence stays on screen.");
        }, VOICE_LIST_GRACE_MS);
        return "held";
      }
      const voice = voices.find((entry) => entry.lang.toLowerCase().startsWith(wanted));
      if (!voice) {
        setNotice(
          wanted === "ar"
            ? "This device has no Arabic voice, so the sentence stays on screen."
            : "This device has no English voice, so the sentence stays on screen."
        );
        return "failed";
      }
      waiting.current = null;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        setSpeaking(false);
        remember(text, Date.now());
      };
      utterance.onerror = (event) => {
        setSpeaking(false);
        // cancel() reports the utterance it stopped, and a stop is the person's own
        // choice — the sentence still counts as heard-by-the-room for echo purposes.
        if (event.error !== "canceled" && event.error !== "interrupted") {
          setNotice("That sentence could not be spoken.");
        }
        remember(text, Date.now());
      };
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
      return "spoke";
    },
    [clearHold, remember]
  );

  // The list arrived. Say the one sentence asked for while it was still empty —
  // and read the list on mount too, so the first sentence of a sitting is not
  // held behind an event the platform may never fire again.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => {
      deviceVoices.current = window.speechSynthesis.getVoices();
      const held = waiting.current;
      if (!held || deviceVoices.current.length === 0) return;
      clearHold();
      waiting.current = null;
      if (speakOnDevice(held) === "spoke") remember(held, Date.now());
    };
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      window.speechSynthesis.cancel();
    };
  }, [clearHold, remember, speakOnDevice]);

  const say = useCallback(
    async (text: string) => {
      const sentence = text.trim();
      if (!sentence) return;
      stopDevice();
      // A newer sentence replaces anything still waiting for a voice.
      clearHold();
      waiting.current = null;
      const outcome = speakOnDevice(sentence);
      // The words are in the room, so they belong in the echo memory at once — an
      // utterance that lands before `onend` must still be recognised. A sentence
      // still waiting for the voice list is not in the room yet, and is remembered
      // when it plays.
      if (outcome === "spoke") remember(sentence, Date.now());
    },
    [clearHold, speakOnDevice, remember]
  );

  // The AudioContext is only built when something is actually about to play, so a
  // person who never lets the assistant speak is never handed a suspended context.
  const context = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctor = (window as unknown as { AudioContext?: new () => AudioContext }).AudioContext;
    if (!Ctor) return null;
    if (!playback.current) {
      try {
        playback.current = { context: new Ctor() };
      } catch {
        return null;
      }
    }
    return playback.current.context;
  }, []);

  const tone = useCallback((kind: "heard" | "alert") => {
    const audio = context();
    if (!audio || audio.state !== "running") return;
    const { from, to } = TONES[kind];
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(from, audio.currentTime);
    oscillator.frequency.linearRampToValueAtTime(to, audio.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.24);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.26);
  }, [context]);

  /** Whether these words are the presence's own voice coming back to the microphone. */
  const heardOwnVoice = useCallback(
    (text: string) => isOwnVoiceEcho(text, spoken.current, Date.now()),
    []
  );

  useEffect(
    () => () => {
      stopDevice();
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      void playback.current?.context.close();
    },
    []
  );

  /** A click is what lets a tab make sound: the orb asks for it once. */
  const wakeAudio = useCallback(() => {
    const audio = context();
    if (audio && audio.state === "suspended") void audio.resume();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      deviceVoices.current = window.speechSynthesis.getVoices();
    }
  }, [context]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { speaking, notice, dismissNotice, say, stop, tone, heardOwnVoice, wakeAudio };
}
