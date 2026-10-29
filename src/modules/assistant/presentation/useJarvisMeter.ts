"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The microphone's loudness, in a number the reactor can breathe with.
 *
 * ## Why the capture lives here and is handed out
 *
 * The orb's animation swells with a person's voice, and a level never comes free: it
 * has to be read out of a capture of its own, which is why this one is opt-in rather
 * than always on. This hook is that capture's one owner in the tab, and it hands the
 * stream out because the wake-word recorder cuts its segments from *this* stream —
 * a second `getUserMedia` would be a second microphone prompt and a second thing to
 * release, so the recorder reads this stream instead of holding another.
 *
 * ## What it costs, stated plainly
 *
 * A stream opened here is the tab's only microphone consumer. It is never opened for
 * a person who did not arm the ambient wake word, it is closed the moment that
 * switch goes off, and the audio is read on this machine and thrown away: no bytes
 * are kept, sent, or written. The number it hands back is a 0–1 loudness average,
 * which is what the canvas needs and nothing else.
 *
 * ## Why the level is a ref and not state
 *
 * A React state update per animation frame re-renders the whole shell sixty times a
 * second for a number only the canvas reads. The loop writes the ref; the canvas pulls
 * from it while it paints. `armed` and `error` are state because the app bar and the
 * orb's own sentence do render them.
 */
export interface JarvisMeter {
  /** 0 when nothing is captured. Called from the paint loop, never during render. */
  read(): number;
  /** True only while a capture is actually open in this browser right now. */
  armed: boolean;
  /** Why there is no level, in words, or null. The orb animates without one. */
  error: string | null;
  /**
   * The capture this hook owns, or null while it holds none.
   *
   * Handed out because a second `getUserMedia` in the same tab is a second
   * microphone prompt and a second thing to release: the wake-word recorder cuts its
   * segments from *this* stream, so one tab has exactly one owner of the capture and
   * the meter stays it. Read after commit, never during render.
   */
  stream(): MediaStream | null;
}

const ANALYSER_BINS = 64;

function meterMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser blocked the microphone, so the orb does not move with your voice.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found, so the orb does not move with your voice.";
  }
  return "The loudness reader could not start. The orb still listens as before.";
}

export function useJarvisMeter({ enabled }: { enabled: boolean }): JarvisMeter {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const level = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const read = useCallback(() => level.current, []);
  const readStream = useCallback(() => streamRef.current, []);

  useEffect(() => {
    if (!enabled) {
      // The level goes to zero here because nothing is painting it; `armed` is
      // derived from `enabled` below rather than set here, since a synchronous
      // state update in an effect body costs a second render for a value the
      // previous cleanup already reset.
      level.current = 0;
      return;
    }

    let alive = true;
    let frame: number | null = null;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    const teardown = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      streamRef.current = null;
      void context?.close().catch(() => undefined);
      context = null;
      level.current = 0;
      if (alive) setArmed(false);
    };

    const start = async () => {
      try {
        // Checked here rather than in the effect body: the body may not answer by
        // setting state before its first paint, but this async path may.
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          setError("This browser cannot read a microphone level.");
          return;
        }
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          setError("This browser cannot read a microphone level.");
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          streamRef.current = null;
          return;
        }
        streamRef.current = stream;
        context = new Ctor();
        if (context.state === "suspended") {
          // A tab nobody has clicked cannot make — or read — sound. Resuming is what
          // the orb's own `wakeAudio` click handler does; until then this stays quiet
          // and says so rather than showing a level that never moves.
          await context.resume().catch(() => undefined);
        }
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = ANALYSER_BINS;
        source.connect(analyser);

        const bytes = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(bytes);
          let sum = 0;
          for (let i = 0; i < bytes.length; i += 1) sum += bytes[i];
          // The applet's own scaling, kept: a full-scale mean of 128 reads as a
          // shouting room, and a person talking normally sits well under it.
          level.current = Math.min(1, sum / bytes.length / 128);
          frame = requestAnimationFrame(tick);
        };
        tick();
        if (alive) {
          setArmed(true);
          setError(null);
        }
      } catch (caught) {
        teardown();
        if (alive) setError(meterMessage(caught));
      }
    };

    // A hidden tab gives up the microphone: this is the rule the recogniser and the
    // recorder already follow, and a level reader that outlived the page would be the
    // one thing still holding a capture after everything else let go.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") teardown();
      else if (alive && !armed) void start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void start();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      teardown();
    };
    // `armed` is read only to decide whether a returning tab needs a fresh capture;
    // listing it as a dependency would tear down and re-open the microphone on the
    // very render that reports it armed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { read, armed: enabled && armed, error: enabled ? error : null, stream: readStream };
}
