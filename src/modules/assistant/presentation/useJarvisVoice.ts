"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SPEECH_RATE,
  isOwnVoiceEcho,
  normaliseSpeechRate,
  pickDeviceVoice,
  speechLanguageOf,
  type DeviceVoiceChoice,
} from "@/modules/assistant/domain/voice";

/**
 * How many pieces the presence remembers as its own voice. An echo of the
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

/** One sentence the presence was asked to say, with the caller waiting on it. */
interface Queued {
  text: string;
  /** Called once this sentence has been produced, dropped or silenced. */
  resolve: () => void;
}

/** Silence the device voice. Needs nothing from the component, so it lives outside it. */
function stopDevice(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * The presence's voice: the one this device already has, played from a queue.
 *
 * Nothing leaves the browser to say a sentence. That is the whole of the design:
 * the briefing, an alert and a spoken answer are read by `speechSynthesis`, and a
 * machine with no voice for the sentence's language says so on screen instead of
 * pretending it spoke.
 *
 * A briefing is several sentences and the watchers produce them in one pass, so
 * this hook owns a queue instead of cancelling before every line. `speechSynthesis`
 * is one global voice per tab: the cancel that used to open every `say()` is what a
 * person heard as the assistant stopping mid-sentence, because the second line
 * arrived while the first was still being spoken. Now only two things silence it —
 * the person asking to be quiet, and this hook unmounting while it is the one
 * talking — and `say()` resolves when its own sentence has been produced, so a
 * caller cannot overwrite a sentence that is still in the air.
 *
 * Browsers block sound in a tab nobody has touched. That is reported as what it is
 * instead of being swallowed, because a briefing that plays nothing and claims to
 * have played is the worst kind of success.
 */
export function useJarvisVoice(choice: DeviceVoiceChoice = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const playback = useRef<Playback | null>(null);
  const deviceVoices = useRef<SpeechSynthesisVoice[]>([]);
  const spoken = useRef<{ text: string; at: number }[]>([]);
  /** What has been asked and not yet finished playing, oldest first. */
  const queue = useRef<Queued[]>([]);
  /** True while an utterance handed over by THIS hook is being produced. */
  const producing = useRef(false);
  /** When the grace for a voice list that has not arrived runs out. */
  const holdTimer = useRef<number | null>(null);
  const choiceRef = useRef({ voiceId: "", rate: DEFAULT_SPEECH_RATE });

  // Kept after commit: an in-flight utterance's handler closes over the pump that
  // started it, and reads the choice through this ref, so a voice or rate changed
  // mid-briefing applies to the next sentence rather than cutting this one short.
  useEffect(() => {
    choiceRef.current = {
      voiceId: choice.voiceId ?? "",
      rate: normaliseSpeechRate(choice.rate ?? DEFAULT_SPEECH_RATE),
    };
  });

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const remember = useCallback((text: string, at: number) => {
    spoken.current = [...spoken.current, { text, at }].slice(-SPOKEN_MEMORY);
  }, []);

  /** The most recently produced words, restamped: the echo window runs from them. */
  const hearAgain = useCallback(() => {
    const newest = spoken.current[spoken.current.length - 1];
    if (newest) newest.at = Date.now();
  }, []);

  /** Forget everything queued, releasing each caller whose sentence it held. */
  const drain = useCallback(() => {
    const pending = queue.current;
    queue.current = [];
    pending.forEach((item) => item.resolve());
  }, []);

  const pumpRef = useRef<() => void>(() => {});

  /**
   * Hand the device the next sentence, if it is not already busy with one of ours.
   *
   * A sentence in a language this machine cannot speak is dropped with the reason
   * and the queue moves on, so one unpronounceable line does not end a briefing. An
   * empty voice list is not that case: the sentence stays at the head of the queue,
   * and the `voiceschanged` pass below plays it — with a note only if the list
   * never comes.
   */
  const pump = useCallback(() => {
    if (producing.current) return;
    for (;;) {
      const next = queue.current[0];
      if (!next) {
        clearHold();
        setSpeaking(false);
        return;
      }
      if (deviceVoices.current.length === 0) {
        if (holdTimer.current === null) {
          holdTimer.current = window.setTimeout(() => {
            holdTimer.current = null;
            if (deviceVoices.current.length > 0) return;
            setNotice("This device has no voice installed, so the sentence stays on screen.");
            drain();
            setSpeaking(false);
          }, VOICE_LIST_GRACE_MS);
        }
        return;
      }
      /**
       * Which language to ask for. A sentence with no letters in it is not a
       * sentence to speak, and it is dropped without a note: "no English voice"
       * would blame the machine for a row of numbers.
       */
      const wanted = speechLanguageOf(next.text);
      if (!wanted) {
        queue.current.shift();
        next.resolve();
        continue;
      }
      const { voiceId, rate } = choiceRef.current;
      const voice = pickDeviceVoice(deviceVoices.current, voiceId, wanted);
      if (!voice) {
        queue.current.shift();
        next.resolve();
        setNotice(
          wanted === "ar"
            ? "This device has no Arabic voice, so the sentence stays on screen."
            : "This device has no English voice, so the sentence stays on screen."
        );
        continue;
      }
      clearHold();
      queue.current.shift();
      producing.current = true;
      // The words are in the room from this moment, so they belong in the echo
      // memory now — an utterance that lands before its end event must still be
      // recognised as the presence's own voice.
      remember(next.text, Date.now());
      const utterance = new SpeechSynthesisUtterance(next.text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      const done = () => {
        producing.current = false;
        setSpeaking(false);
        // The sentence has been produced, so the watcher that awaited it may ask
        // for the next one. Released here, and nowhere else: a caller released at
        // the hand-over is how the second line came to cut the first one short.
        next.resolve();
        pumpRef.current();
      };
      utterance.onstart = () => {
        setSpeaking(true);
        hearAgain();
      };
      utterance.onend = () => {
        hearAgain();
        done();
      };
      utterance.onerror = (event) => {
        // cancel() reports the utterance it stopped, and a stop is the person's own
        // choice — the sentence still counts as heard-by-the-room for echo purposes.
        if (event.error !== "canceled" && event.error !== "interrupted") {
          setNotice("That sentence could not be spoken.");
        }
        hearAgain();
        done();
      };
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
      return;
    }
  }, [clearHold, drain, hearAgain, remember]);

  useEffect(() => {
    pumpRef.current = pump;
  });

  // Read the list on mount too, so the first sentence of a sitting is not held
  // behind an event the platform may never fire again.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => {
      deviceVoices.current = window.speechSynthesis.getVoices();
      pump();
    };
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      // Only this hook's own speech is silenced here. The orb and the chat share one
      // global `speechSynthesis`, so an unmount that cancelled unconditionally cut
      // whatever the other surface was saying mid-sentence.
      if (producing.current) stopDevice();
      drain();
      clearHold();
    };
  }, [clearHold, drain, pump]);

  /**
   * Say this, after anything already asked.
   *
   * The promise settles when THIS sentence has been produced, not when it was
   * handed over, because the watchers use it as the latch that keeps a second
   * sentence off a device that is still busy with the first.
   */
  const say = useCallback(
    async (text: string) => {
      const sentence = text.trim();
      if (!sentence) return;
      await new Promise<void>((resolve) => {
        queue.current = [...queue.current, { text: sentence, resolve }];
        pumpRef.current();
      });
    },
    []
  );

  /** Say nothing more, and be quiet now. */
  const stop = useCallback(() => {
    drain();
    clearHold();
    producing.current = false;
    stopDevice();
    setSpeaking(false);
    // A deliberate stop is not a failed sentence, so the reason for the last one
    // must not outlive it.
    setNotice(null);
  }, [clearHold, drain]);

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
      pumpRef.current();
    }
  }, [context]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { speaking, notice, dismissNotice, say, stop, tone, heardOwnVoice, wakeAudio };
}
