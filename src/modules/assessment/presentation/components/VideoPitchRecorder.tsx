"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Radio, Redo2, Square, Video } from "lucide-react";
import { useAssessmentStore } from "@/stores/useAssessmentStore";
import type { AttemptQuestionClient } from "@/stores/useAssessmentStore";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";

interface VideoPitchRecorderProps {
  question: AttemptQuestionClient;
}

export function VideoPitchRecorder({ question }: VideoPitchRecorderProps) {
  const videoPath = useAssessmentStore((state) => state.videoPathsMap[question.id]);
  const setVideoBlob = useAssessmentStore((state) => state.setVideoBlob);
  const clearVideoBlob = useAssessmentStore((state) => state.clearVideoBlob);
  const setVideoPath = useAssessmentStore((state) => state.setVideoPath);
  const isRecording = useAssessmentStore((state) => state.isRecordingVideo);
  const setRecording = useAssessmentStore((state) => state.setRecordingVideo);
  const attemptToken = useAssessmentStore((state) => state.attemptToken);

  const previewRef = useRef<HTMLVideoElement>(null);
  const reviewRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [previewReady, setPreviewReady] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const maxDuration = question.config.max_duration_seconds ?? 120;
  const minDuration = question.config.min_duration_seconds ?? 30;

  const recordedBlob = useAssessmentStore((state) => state.videoBlobMap[question.id]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setPreviewReady(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopCamera();
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
  }, [stopCamera, reviewUrl]);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
      setPreviewReady(true);
    } catch {
      setError("Camera and microphone access is required for the video pitch. Please allow access and try again.");
    }
  }, []);

  const finalizeRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    chunksRef.current = [];
    if (blob.size < 1000) return;
    setVideoBlob(question.id, blob);
    const url = URL.createObjectURL(blob);
    setReviewUrl(url);
    stopCamera();
  }, [question.id, setVideoBlob, setRecording, stopCamera]);

  const startRecording = useCallback(async () => {
    setError(null);
    setReviewUrl(null);
    clearVideoBlob(question.id);
    let stream = streamRef.current;
    if (!stream) {
      await startCamera();
      stream = streamRef.current;
    }
    if (!stream) return;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = finalizeRecording;
    recorder.start(1000);
    mediaRecorderRef.current = recorder;

    setRecordingSeconds(0);
    setRecording(true);
    timerRef.current = setInterval(() => {
      setRecordingSeconds((seconds) => {
        const next = seconds + 1;
        if (next >= maxDuration) {
          mediaRecorderRef.current?.stop();
        }
        return next;
      });
    }, 1000);
  }, [maxDuration, startCamera, finalizeRecording, setRecording, clearVideoBlob, question.id]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const uploadVideo = useCallback(async () => {
    if (!attemptToken || !recordedBlob) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("video", recordedBlob, `pitch-${question.id}.webm`);
      const response = await fetch(
        `/api/attempt/${encodeURIComponent(attemptToken)}/video?questionId=${question.id}`,
        { method: "POST", body: formData }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }
      const body = (await response.json()) as { path: string };
      setVideoPath(question.id, body.path);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [attemptToken, recordedBlob, question.id, setVideoPath]);

  const tooShort = useMemo(
    () => recordedBlob !== undefined && recordingSeconds < minDuration,
    [recordedBlob, recordingSeconds, minDuration]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-brand-ink/55">
        <span className="rounded-full bg-brand-sand px-3 py-1">
          Min {Math.floor(minDuration / 60)}:{(minDuration % 60).toString().padStart(2, "0")}
        </span>
        <span className="rounded-full bg-brand-sand px-3 py-1">
          Max {Math.floor(maxDuration / 60)}:{(maxDuration % 60).toString().padStart(2, "0")}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <div className="relative overflow-hidden rounded-xl border border-brand-line bg-black">
        {reviewUrl ? (
          <video ref={reviewRef} src={reviewUrl} controls className="aspect-video w-full" />
        ) : (
          <video ref={previewRef} muted playsInline className="aspect-video w-full object-cover" />
        )}

        {!previewReady && !reviewUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-brand-sand text-brand-ink/40">
            <Video className="h-9 w-9" aria-hidden />
            <p className="text-sm">Camera preview appears here</p>
          </div>
        )}

        {isRecording && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-rose-600/90 px-3 py-1 text-xs font-bold text-white">
            <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden />
            REC {formatDuration(recordingSeconds)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {!previewReady && !reviewUrl && (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 py-3 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90 sm:w-auto"
          >
            <Video className="h-4 w-4" aria-hidden />
            Enable camera &amp; mic
          </button>
        )}

        {previewReady && !isRecording && !reviewUrl && (
          <button
            type="button"
            onClick={() => void startRecording()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-rose-500 sm:w-auto"
          >
            <Mic className="h-4 w-4" aria-hidden />
            Start recording
          </button>
        )}

        {isRecording && (
          <button
            type="button"
            onClick={stopRecording}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-5 py-3 text-sm font-bold text-brand-ink transition hover:bg-brand-sand sm:w-auto"
          >
            <Square className="h-4 w-4" aria-hidden />
            Stop &amp; review
          </button>
        )}

        {reviewUrl && (
          <>
            {!videoPath ? (
              <button
                type="button"
                onClick={() => void uploadVideo()}
                disabled={uploading || tooShort}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition sm:w-auto",
                  uploading || tooShort
                    ? "cursor-not-allowed bg-brand-sand text-brand-ink/40"
                    : "bg-brand-ink text-brand-cream hover:bg-brand-ink/90"
                )}
              >
                {uploading ? "Uploading…" : "Use this recording"}
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700">
                Recording attached
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setReviewUrl(null);
                setRecordingSeconds(0);
                clearVideoBlob(question.id);
                void startRecording();
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-5 py-3 text-sm font-bold text-brand-ink transition hover:bg-brand-sand sm:w-auto"
            >
              <Redo2 className="h-4 w-4" aria-hidden />
              Re-record
            </button>
          </>
        )}
      </div>

      {tooShort && (
        <p className="text-xs text-amber-700">
          Your recording is {recordingSeconds}s — the minimum is {minDuration}s. Please re-record a
          longer pitch.
        </p>
      )}
    </div>
  );
}
