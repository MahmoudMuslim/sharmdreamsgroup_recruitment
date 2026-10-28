"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeClip } from "./transcribe";
import { useRecorder } from "./useRecorder";

/**
 * The microphone beside the composer.
 *
 * Dictation only inserts text — it never sends the turn, so what the recogniser
 * heard can be read and corrected before it becomes a question. Escape cancels a
 * clip; the recorder itself stops at two minutes. While it records, the button
 * says where the audio goes and that it is discarded, which is the first-use
 * explanation the spec asks for on this surface.
 */
export function VoiceButton({
  onTranscript,
  disabled = false,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const recorder = useRecorder({
    onClip: async (clip) => {
      const result = await transcribeClip(clip);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      onTranscript(result.text);
    },
    onError: setError,
  });

  const busy = recorder.state === "requesting" || recorder.state === "transcribing";
  const recording = recorder.state === "recording";
  const cancelRecording = recorder.cancel;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && recording) cancelRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, cancelRecording]);

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => {
          setError(null);
          if (recording) recorder.stop();
          else void recorder.start();
        }}
        disabled={disabled || busy}
        aria-label={recording ? "Stop dictating" : "Dictate a question"}
        title={
          recording
            ? `Recording — stops itself at two minutes (${recorder.secondsLeft}s left)`
            : "Dictate a question"
        }
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-xl border transition",
          recording
            ? "border-rose-300 bg-rose-50 text-rose-700"
            : "border-brand-line text-brand-ink/60 hover:bg-brand-sand",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : recording ? (
          <Square className="h-4 w-4" aria-hidden />
        ) : (
          <Mic className="h-4 w-4" aria-hidden />
        )}
      </button>
      {recording && (
        <span className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border border-brand-line bg-white px-2 py-1.5 text-[10px] font-semibold leading-relaxed text-brand-ink/60 shadow-sm">
          Recording — the clip goes to the transcription model and is discarded. Only the words you
          send are saved.
        </span>
      )}
      {!recording && !busy && recorder.hitLimit && !error && (
        <span className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border border-brand-line bg-white px-2 py-1.5 text-[10px] font-semibold leading-relaxed text-brand-ink/60 shadow-sm">
          Stopped at two minutes — the clip was transcribed.
        </span>
      )}
      {error && (
        <span
          role="alert"
          className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-[10px] font-semibold leading-relaxed text-rose-700 shadow-sm"
        >
          {error}
        </span>
      )}
    </span>
  );
}
