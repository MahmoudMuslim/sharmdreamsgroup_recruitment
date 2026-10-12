"use client";

import { useCallback, useEffect, useRef } from "react";

export type IntegrityEventType =
  | "FOCUS_LOST"
  | "TAB_HIDDEN"
  | "PASTE_BLOCKED"
  | "PASTE_DETECTED"
  | "COPY_DETECTED"
  | "FULLSCREEN_EXIT"
  | "MULTI_DEVICE"
  | "AI_PASTE_SUSPECTED";

export interface IntegrityEventInput {
  type: IntegrityEventType;
  questionId?: string | null;
  detail?: string;
}

/**
 * Phrases that suggest a pasted answer came from a generative assistant rather
 * than the candidate's own reasoning. This is a *signal for human review*, never
 * an automatic accusation — the recruiter decides.
 */
const AI_MARKERS = [
  "as an ai language model",
  "i'm just an ai",
  "i am an ai assistant",
  "chatgpt",
  "as a large language model",
  "certainly! here's",
  "here's a step-by-step solution",
  "i hope this helps",
];

function looksLikeAiText(text: string): boolean {
  const lower = text.slice(0, 600).toLowerCase();
  return AI_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * A coarse, privacy-preserving device fingerprint.
 *
 * Deliberately non-reversible: it hashes coarse browser traits so we can spot
 * "same attempt opened on two machines" without storing anything that could
 * identify the person or their device.
 */
function deviceFingerprint(): string {
  // `deviceMemory` is Chromium-only and absent from the DOM lib types.
  const nav = navigator as Navigator & { deviceMemory?: number };
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(navigator.hardwareConcurrency ?? 0),
    String(nav.deviceMemory ?? 0),
    String(new Date().getTimezoneOffset()),
  ].join("|");

  let hash = 5381;
  for (let i = 0; i < parts.length; i += 1) {
    hash = ((hash << 5) + hash + parts.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Other";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown";
  const mobile = /Mobi|Android|iPhone/.test(ua) ? "mobile" : "desktop";
  return `${browser} on ${os} (${mobile})`;
}

/**
 * Detects and reports assessment-integrity signals.
 *
 * Detection is deliberately transparent — the candidate is always told, in
 * plain language, when something is recorded. Nothing is recorded silently and
 * no keystrokes, screenshots or pasted content are ever stored: only the fact
 * that an event occurred, where, and roughly how much text was involved.
 *
 * Events are buffered and flushed in batches to avoid a request per keystroke.
 */
export function useIntegrityMonitor({
  attemptToken,
  questionId,
  enabled,
  blockCopyPaste,
  onEvent,
}: {
  attemptToken: string;
  questionId?: string | null;
  enabled: boolean;
  blockCopyPaste?: boolean;
  onEvent?: (event: IntegrityEventInput) => void;
}) {
  const bufferRef = useRef<IntegrityEventInput[]>([]);
  const fingerprintRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable per-session fingerprint + "have I seen this device before?" check.
  useEffect(() => {
    if (!enabled) return;
    const key = "sdg-attempt-fingerprint";
    const fingerprint = deviceFingerprint();
    fingerprintRef.current = fingerprint;

    let previous: string | null = null;
    try {
      previous = window.localStorage.getItem(key);
      if (previous && previous !== fingerprint) {
        // Same browser profile, different hardware characteristics.
        window.localStorage.removeItem(key);
        window.localStorage.setItem(key, fingerprint);
        bufferRef.current.push({
          type: "MULTI_DEVICE",
          detail: `Session started on a different device (${deviceLabel()})`,
        });
      } else if (!previous) {
        window.localStorage.setItem(key, fingerprint);
      }
    } catch {
      // Storage blocked (private mode) — device tracking is simply skipped.
    }
  }, [enabled]);

  const flush = useCallback(async () => {
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    try {
      await fetch(`/api/attempt/${encodeURIComponent(attemptToken)}/integrity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptToken,
          events: batch.map((event) => ({
            ...event,
            questionId: questionId ?? null,
            sessionFingerprint: fingerprintRef.current,
            deviceLabel: deviceLabel(),
          })),
        }),
        keepalive: true,
      });
    } catch {
      // Offline or network hiccup — the signal is advisory, so drop it rather
      // than block the candidate mid-assessment.
    }
  }, [attemptToken, questionId]);

  const record = useCallback(
    (event: IntegrityEventInput) => {
      if (!enabled) return;
      bufferRef.current.push(event);
      onEvent?.(event);

      // Debounce: coalesce bursts (e.g. rapid focus changes) into one request.
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => void flush(), 1200);
    },
    [enabled, flush, onEvent]
  );

  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") record({ type: "TAB_HIDDEN" });
    };

    const onBlur = () => record({ type: "FOCUS_LOST" });

    const onFullscreen = () => {
      // Fired on exit as well as enter; treat any change while testing as a signal.
      if (!document.fullscreenElement) record({ type: "FULLSCREEN_EXIT" });
    };

    const onCopy = () => {
      record({ type: "COPY_DETECTED", detail: "Candidate copied text from the assessment" });
    };

    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text") ?? "";
      const length = text.length;

      if (blockCopyPaste) {
        // Prevent the question from leaving the platform.
        event.preventDefault();
        record({
          type: "PASTE_BLOCKED",
          detail: `Pasting was blocked (${length} characters)`,
        });
        return;
      }

      record({
        type: looksLikeAiText(text) ? "AI_PASTE_SUSPECTED" : "PASTE_DETECTED",
        detail: `${length} characters pasted${looksLikeAiText(text) ? " — assistant-style phrasing detected" : ""}`,
      });
    };

    // Candidates sometimes paste into the spreadsheet grid, which renders in a
    // canvas-like widget. A capture listener catches those too.
    const onPasteCapture = (event: ClipboardEvent) => {
      if (blockCopyPaste) event.preventDefault();
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("paste", onPasteCapture, false);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("paste", onPasteCapture, false);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, record, blockCopyPaste]);

  // Best-effort final flush if the candidate submits immediately after an event.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (bufferRef.current.length > 0) void flush();
    };
  }, [flush]);

  return { flush };
}