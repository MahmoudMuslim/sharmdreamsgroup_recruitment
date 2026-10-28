"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isOwnVoiceEcho, speechLanguageOf } from "@/modules/assistant/domain/voice";

/**
 * How many sentences the presence remembers as its own voice. An echo of the
 * briefing arrives while the next line is already being produced, so the memory
 * has to reach past the cue — the entries are short strings, never audio.
 */
const SPOKEN_MEMORY = 12;

/** A refusal of the neural voice is not retried sentence after sentence. */
const NEURAL_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;

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

/**
 * Whether a context will actually make sound right now.
 *
 * A separate call, not an inline comparison: inside an `if (state === "suspended")`
 * block TypeScript holds that narrowing forever, so the state read *after* awaiting
 * `resume()` would be typed as still suspended and the check could never pass. The
 * browser does change it; this is where that change is allowed to be seen.
 */
function readyToPlay(context: AudioContext): boolean {
  return context.state === "running";
}

interface Playback {
  context: AudioContext;
  source: AudioBufferSourceNode | null;
}

/** Silence the device voice. Needs nothing from the component, so it lives outside it. */
function stopDevice(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * The presence's voice: the neural one first, the device's own always available.
 *
 * The door at `/api/assistant/speak` answers with mp3 bytes or with a reason. It
 * never silently substitutes a voice, and neither does this hook: when the neural
 * voice is unavailable the sentence is spoken by the machine the recruiter is
 * already sitting at, and the person is told once — not on every line.
 *
 * Browsers block sound in a tab nobody has touched. That is reported as what it is
 * instead of being swallowed, because a briefing that plays nothing and claims to
 * have played is the worst kind of success.
 */
export function useJarvisVoice({
  neural,
  voice,
}: {
  neural: boolean;
  voice: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const playback = useRef<Playback | null>(null);
  const deviceVoices = useRef<SpeechSynthesisVoice[]>([]);
  const spoken = useRef<{ text: string; at: number }[]>([]);
  const neuralUntil = useRef(0);
  // One line about the voice per visit: an orb that explains its fallback after
  // every alert is the alert the person was trying to avoid.
  const announced = useRef(false);

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
        playback.current = { context: new Ctor(), source: null };
      } catch {
        return null;
      }
    }
    return playback.current.context;
  }, []);

  /** Cut whatever is being heard, from either engine — one sentence at a time. */
  const stopEveryVoice = useCallback(() => {
    stopDevice();
    const holder = playback.current;
    if (holder?.source) {
      try {
        holder.source.stop();
      } catch {
        // Already finished — stopping a clip twice is not a failure worth a message.
      }
      holder.source = null;
    }
  }, []);

  const remember = useCallback((text: string, at: number) => {
    spoken.current = [...spoken.current, { text, at }].slice(-SPOKEN_MEMORY);
  }, []);

  const stop = useCallback(() => {
    stopEveryVoice();
    setSpeaking(false);
    // A deliberate stop is not a failed sentence, so the reason for the last one
    // must not outlive it.
    setNotice(null);
  }, [stopEveryVoice]);

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

  /** Ask the door for the neural take, and fall back only when it says why. */
  const speakWithNeural = useCallback(async (text: string): Promise<boolean> => {
    const now = Date.now();
    if (now < neuralUntil.current) return false;
    let response: Response;
    try {
      response = await fetch("/api/assistant/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
    } catch {
      neuralUntil.current = now + DEFAULT_COOLDOWN_MS;
      return false;
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "");
      neuralUntil.current = now + (retryAfter > 0 ? retryAfter * 1000 : NEURAL_COOLDOWN_MS);
      return false;
    }
    const bytes = await response.arrayBuffer().catch(() => null);
    if (!bytes || bytes.byteLength === 0) {
      neuralUntil.current = now + DEFAULT_COOLDOWN_MS;
      return false;
    }
    const audio = context();
    if (!audio) return false;
    if (audio.state === "suspended") {
      // Chrome refuses to make sound in a tab nobody has touched. Resuming from a
      // spoken alert never works, so the honest answer is the device voice plus one
      // note about what the person has to do.
      await audio.resume().catch(() => undefined);
      if (!readyToPlay(audio)) return false;
    }
    const buffer = await audio.decodeAudioData(bytes).catch(() => null);
    if (!buffer) {
      neuralUntil.current = now + DEFAULT_COOLDOWN_MS;
      return false;
    }
    const holder = playback.current;
    if (!holder) return false;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.onended = () => {
      setSpeaking(false);
      remember(text, Date.now());
    };
    source.connect(audio.destination);
    source.start();
    holder.source = source;
    setSpeaking(true);
    return true;
  }, [voice, context, remember]);

  const say = useCallback(
    async (text: string) => {
      const sentence = text.trim();
      if (!sentence) return;
      stopEveryVoice();
      let said = false;
      if (neural) said = await speakWithNeural(sentence);
      if (!said) said = speakOnDevice(sentence);
      if (!said) {
        setNotice("The assistant has nothing to say out loud in this tab yet.");
        return;
      }
      // The words are in the room either way, so they belong in the echo memory at
      // once — an utterance that lands before `onend` must still be recognised.
      remember(sentence, Date.now());
      if (neural && !announced.current && Date.now() < neuralUntil.current) {
        announced.current = true;
        setNotice("The neural voice is unavailable, so the assistant uses this device's voice.");
      }
    },
    // The hooks' internals are refs, not state, so a new prefs value must be able to
    // change which engine a sentence asks of.
    [neural, stopEveryVoice, speakWithNeural, speakOnDevice, remember]
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
      const holder = playback.current;
      try {
        holder?.source?.stop();
      } catch {
        // Nothing was playing.
      }
      void holder?.context.close();
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
