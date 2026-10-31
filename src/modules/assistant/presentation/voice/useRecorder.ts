"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A spoken question is a sentence or two, not a meeting. */
export const MAX_CLIP_MS = 120_000;

export type RecorderState = "idle" | "requesting" | "recording" | "transcribing" | "error";

/**
 * Formats the provider accepts, in the order this browser is asked to produce.
 * The codec parameter is a recorder preference, not a wire type — the route
 * drops it before the allowlist, because only two spellings should ever leave.
 */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/ogg",
];

const MAX_CLIP_SECONDS = MAX_CLIP_MS / 1000;

function supportedType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/**
 * The two containers the transcription door accepts. A recording in anything
 * else is refused here rather than uploaded under a label that lies about it.
 */
const READABLE_TYPES = ["audio/webm", "audio/ogg"];

function readableType(recorded: string): string | null {
  const container = recorded.split(";")[0].trim().toLowerCase();
  return READABLE_TYPES.find((type) => type === container) ?? null;
}

function microphoneMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser blocked the microphone. Allow it for this site, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found on this device.";
  }
  return "The microphone could not be started.";
}

export function useRecorder({
  onClip,
  onError,
}: {
  onClip: (clip: Blob) => unknown;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(MAX_CLIP_SECONDS);
  // True only when the cap ended a clip that was then handed to `onClip`: a
  // capped clip that produced no bytes, or one cancelled before it reached
  // `onClip`, never sets it. It outlives the recording so the surface can say
  // *why* the clip stopped, and is cleared when the next one starts.
  const [hitLimit, setHitLimit] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  // The cap fired, so whichever way this recording ends, it ended at two
  // minutes. Read in `onstop` when the clip is produced, never during render.
  const cappedRef = useRef(false);
  const onClipRef = useRef(onClip);
  // Kept current after commit rather than during render: a render-time ref write
  // is what React's lint rules refuse, and this handler is only read once the
  // recorder stops — always later than this effect.
  useEffect(() => {
    onClipRef.current = onClip;
  });

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setSecondsLeft(MAX_CLIP_SECONDS);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already stopped; the release below is what matters.
      }
    }
    release();
    setState("idle");
  }, [release]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const type = supportedType();
    if (!type || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError("This browser cannot record audio — type the question instead.");
      setState("error");
      return;
    }

    setState("requesting");
    setHitLimit(false);
    cancelledRef.current = false;
    cappedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: type });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const recorded = readableType(recorder.mimeType || type);
        release();
        if (cancelledRef.current) {
          setState("idle");
          return;
        }
        // A browser that ignored the constructor option and produced a container
        // the door would refuse is refused here too: sending mp4 bytes labelled
        // webm would be a lie only the provider would discover.
        if (!recorded) {
          setState("error");
          onError("This browser cannot record audio — type the question instead.");
          return;
        }
        const clip = new Blob(chunks, { type: recorded });
        if (clip.size === 0) {
          setState("idle");
          return;
        }
        // A non-empty clip handed over from a cap-ended recording is the only
        // thing that makes the cap note true. Set here, at the moment the clip
        // is produced, rather than after the words land: the surface hides the
        // note while busy and whenever an error is showing, so it can only be
        // seen once this clip has been transcribed without an error.
        if (cappedRef.current) setHitLimit(true);
        setState("transcribing");
        // Wrapped so a synchronous throw from onClip still reaches `finally`;
        // called directly, it would escape onstop and leave the hook stuck in
        // "transcribing", with the mic disabled until a remount.
        void Promise.resolve()
          .then(() => onClipRef.current(clip))
          .finally(() => setState("idle"));
      };

      recorderRef.current = recorder;
      recorder.start();
      setState("recording");

      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const left = Math.max(
          0,
          MAX_CLIP_SECONDS - Math.floor((Date.now() - startedAt) / 1000)
        );
        setSecondsLeft(left);
        if (left === 0) {
          // Only marks *why* the recording ended; the note itself is set once
          // the bytes exist and are on their way to `onClip`.
          cappedRef.current = true;
          stop();
        }
      }, 250);
    } catch (error) {
      release();
      setState("error");
      onError(microphoneMessage(error));
    }
  }, [onError, release, stop]);

  // A hidden tab or a route change ends the clip. A microphone that keeps
  // listening while its page is gone is the one failure this file exists to
  // prevent; cancelling is the honest end, so nothing is sent.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already gone.
        }
      }
      release();
    };
  }, [cancel, release]);

  return { state, start, stop, cancel, secondsLeft, hitLimit };
}
