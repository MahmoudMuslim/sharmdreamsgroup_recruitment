/**
 * Recruiter-facing labels for assessment-integrity signals.
 *
 * Kept outside `integrity-actions.ts` because a `"use server"` module may only
 * export async functions.
 */
export const INTEGRITY_LABELS: Record<string, string> = {
  FOCUS_LOST: "Left the assessment window",
  TAB_HIDDEN: "Tab sent to background",
  PASTE_BLOCKED: "Paste blocked (question copy-out)",
  PASTE_DETECTED: "Content pasted",
  COPY_DETECTED: "Copied assessment text",
  FULLSCREEN_EXIT: "Exited full screen",
  MULTI_DEVICE: "Attempt started on a different device",
  AI_PASTE_SUSPECTED: "Pasted text looked AI-generated",
};