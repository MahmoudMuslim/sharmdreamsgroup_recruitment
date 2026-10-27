"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

// Whether this browser has a recognizer is something only the browser knows.
// Modelled as an external store for the same reason the rail is: the server
// renders `false` and the first client render matches it, then the real answer
// is applied. A mount effect calling `setSupported` would be a second render the
// React lint rules refuse.
function subscribeToNothing() {
  return () => {};
}

const recognizerInThisBrowser = () => recognitionCtor() !== null;
const recognizerOnServer = () => false;

/**
 * The browser's own recognizer, and only while the console is armed.
 *
 * Chrome and Edge implement this; Firefox does not, and the strip says so rather
 * than offering a toggle that cannot work. The recognizer sends what it hears to
 * the browser vendor's speech service — which is why the console states that
 * before it arms, and why this hook exists nowhere else in the portal.
 *
 * It restarts itself while armed, is suspended while the tab is hidden, and is
 * aborted on unmount. A `no-speech` or `aborted` event is the recognizer's
 * ordinary silence, not an error worth showing. A denied microphone
 * (`not-allowed`), a blocked speech service (`service-not-allowed`) and a
 * missing capture device (`audio-capture`) are fatal: retrying cannot fix them,
 * so the hook stops and says why instead of looping start → error → end at event
 * speed. Toggling hands-free off and on starts a fresh run and retries.
 */
export function useWakeWord({
  enabled,
  language,
  onUtterance,
}: {
  enabled: boolean;
  language: "en" | "ar";
  onUtterance: (text: string) => void;
}) {
  const supported = useSyncExternalStore(
    subscribeToNothing,
    recognizerInThisBrowser,
    recognizerOnServer
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onUtteranceRef = useRef(onUtterance);
  // Kept current after commit rather than during render: a render-time ref write
  // is what React's lint rules refuse, and the handler is only read from the
  // recognizer's events — always later than this effect.
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  });

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || !enabled) {
      // Nothing to start. The armed run that ended here took its error with it,
      // in the cleanup below: a disarmed console says nothing is being recorded,
      // and an alert beneath it still reading "the microphone is blocked — allow
      // it and arm hands-free again" is advice for a listening state that has
      // ended. The next arm reports the same thing again if it is still true.
      return;
    }

    let active = true;
    let suspended = false;
    // Set by an error no retry can heal. `onend` fires after that error, and
    // restarting there is what turned a denied microphone into a busy loop.
    let stopped = false;
    const recognition = new Ctor();
    recognition.lang = language === "ar" ? "ar-EG" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    // Listening is a fact the recognizer reports, not a guess made after calling
    // `start()`. Clearing the last error here rather than in the effect body also
    // keeps arming a fresh run from showing the previous run's complaint.
    recognition.onstart = () => {
      setError(null);
      setListening(true);
    };

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;
        const text = String(result[0]?.transcript ?? "").trim();
        if (text) onUtteranceRef.current(text);
      }
    };

    recognition.onerror = (event) => {
      const code = event?.error ?? "";
      if (code === "aborted" || code === "no-speech") return;
      // A denied permission, a blocked service and a missing device cannot heal
      // by starting again. `stopped` keeps `onend` from restarting into the same
      // error; the toggle is the only retry, because it builds a fresh run.
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
        stopped = true;
        setError(
          code === "audio-capture"
            ? "No microphone is available to this browser. Connect one and arm hands-free again."
            : "The microphone, or the browser's speech service, is blocked. Allow it and arm hands-free again."
        );
        setListening(false);
        return;
      }
      setError(
        code === "network"
          ? "The browser's speech service could not be reached."
          : "Listening stopped unexpectedly."
      );
      setListening(false);
    };

    recognition.onend = () => {
      if (!active || suspended || stopped) return;
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    };

    const onVisibility = () => {
      suspended = document.visibilityState === "hidden";
      if (suspended) {
        try {
          recognition.abort();
        } catch {
          // Already stopped.
        }
        setListening(false);
        return;
      }
      // Returning to a tab does not overrule a fatal error: the condition that
      // stopped listening is still there, so a restart would only loop again.
      if (stopped) return;
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    try {
      recognition.start();
    } catch {
      // Reported after this effect body has run, so arming never renders twice in
      // the same commit; a start that throws synchronously gets the same message
      // as one the recognizer refuses a moment later.
      queueMicrotask(() => setError("Listening could not start in this browser."));
    }

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
      setListening(false);
      // The run is over, and so is what it had to say. Leaving a dead run's error
      // showing beside "Nothing is being recorded." is advice for a state that has
      // ended; the next arm starts clean and reports again if it is still true.
      setError(null);
    };
  }, [enabled, language]);

  // Armed and running is what "listening" describes, so a disabled hook reports
  // false without needing an effect to write it.
  return { supported, listening: enabled && listening, error };
}
