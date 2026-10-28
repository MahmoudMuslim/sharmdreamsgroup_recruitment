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

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => {
      deviceVoices.current = window.speechSynthesis.getVoices();
    };
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      window.speechSynthesis.cancel();
    };
  }, []);

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

  const remember = useCallback((text: string, at: number) => {
    spoken.current = [...spoken.current, { text, at }].slice(-SPOKEN_MEMORY);
  }, []);

  const stop = useCallback(() => {
    stopDevice();
    setSpeaking(false);
    // A deliberate stop is not a failed sentence, so the reason for the last one
    // must not outlive it.
    setNotice(null);
  }, []);

  /** The device reads the sentence itself. Works with no key and no network. */
  const speakOnDevice = useCallback((text: string): boolean => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const wanted = speechLanguageOf(text);
    if (!wanted) return false;
    const voices = deviceVoices.current;
    if (voices.length === 0) {
      setNotice("This device has no voice installed, so the sentence stays on screen.");
      return false;
    }
    const voice = voices.find((entry) => entry.lang.toLowerCase().startsWith(wanted));
    if (!voice) {
      setNotice(
        wanted === "ar"
          ? "This device has no Arabic voice, so the sentence stays on screen."
          : "This device has no English voice, so the sentence stays on screen."
      );
      return false;
    }
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
    return true;
  }, [remember]);

  const say = useCallback(
    async (text: string) => {
      const sentence = text.trim();
      if (!sentence) return;
      stopDevice();
      if (!speakOnDevice(sentence)) {
        setNotice("The assistant has nothing to say out loud in this tab yet.");
        return;
      }
      // The words are in the room, so they belong in the echo memory at once — an
      // utterance that lands before `onend` must still be recognised.
      remember(sentence, Date.now());
    },
    [speakOnDevice, remember]
  );

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
