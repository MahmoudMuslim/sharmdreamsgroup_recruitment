/**
 * Client-safe configuration.
 *
 * IMPORTANT: this module is imported by browser code, so it must never touch
 * server-only secrets. AI provider keys and the third-party credentials live in
 * `config.server.ts`, which is guarded with `server-only`.
 *
 * Nothing here reads a `NEXT_PUBLIC_*` value any more: the app's own origin is
 * the only one a browser needs, and it is set per deployment by `APP_URL`.
 */

function optional(value: string | undefined, fallback = ""): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * The names below are the buckets *we* run, not the vendor's: they are the
 * directories under `UPLOADS_ROOT` that `src/lib/files/paths.ts` resolves within,
 * and the value a `files` row stores in its `bucket` column. Those strings are
 * load-bearing, not cosmetic: `db/schema.sql` hard-codes the same spellings inside
 * the storage RLS policies, so a value here that drifts makes a working upload fail
 * its policy check — and `candidateCvs` keeps the exact spelling the "Track your
 * application" copy and the extracted manifest use.
 */
export const storageConfig = {
  buckets: {
    candidateVideos: "candidate-videos",
    candidateAudio: "candidate-audio",
    resumes: "resumes",
    candidateCvs: "candidate-cvs",
    candidatePhotos: "candidate-photos",
  },
} as const;

export const appConfig = {
  // The app now answers on the stack's own origin (nginx publishes 3000), so an
  // `APP_URL`-less build has to fall back to a host a candidate can still reach.
  // `3001` is the dev server, and a link that points there from a production page
  // is the task-#313 bug.
  url: optional(process.env.APP_URL, "http://localhost:3000"),
  name: "Sharm Dreams Talent Cloud",
  defaultLocale: "en" as const,
} as const;

/** Locales offered by the candidate-facing surfaces. */
export const SUPPORTED_LOCALES = ["en", "ar", "ru", "de"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type AiCapability =
  | "resume_screening"
  | "soft_skills"
  | "case_reasoning"
  | "feedback"
  | "interview_questions"
  | "transcription"
  | "assistant"
  | "chatbot"
  | "translation";

const PRIMARY = optional(process.env.AI_MODEL_PRIMARY, "google/gemma-4-31b-it:free");
const FAST = optional(process.env.AI_MODEL_FAST, "nvidia/nemotron-3.5-lightning:free");
const REASONING = optional(process.env.AI_MODEL_REASONING, "google/gemma-4-31b-it:free");
const FALLBACK = optional(process.env.AI_MODEL_FALLBACK, "google/gemma-4-26b-a4b-it:free");

/**
 * Ordered failover chain per capability. The gateway walks the list until a
 * provider returns a valid completion. Contains no secrets, so it is safe to
 * ship to the browser (useful for surfacing model availability in the UI).
 */
export const modelChains: Record<AiCapability, readonly string[]> = {
  resume_screening: [PRIMARY, FALLBACK, FAST],
  soft_skills: [FAST, PRIMARY, FALLBACK],
  case_reasoning: [REASONING, FALLBACK, PRIMARY],
  feedback: [PRIMARY, FALLBACK],
  interview_questions: [FAST, PRIMARY],
  transcription: [PRIMARY, FALLBACK],
  // The assistant has to hold a JSON tool protocol across several turns, and the
  // free OpenRouter ids it would otherwise inherit are the first to rate-limit,
  // so it defaults to Google's own endpoint and keeps the shared ids as backup.
  assistant: ["gemini-3-flash-preview", "gemini-3.1-flash-lite", PRIMARY, FALLBACK],
  // The careers assistant is the one chain a stranger on a public page waits on,
  // so it starts at the same Google ids the in-app chat uses — the free
  // OpenRouter ids it would otherwise inherit are the first to rate-limit.
  chatbot: ["gemini-3-flash-preview", "gemini-3.1-flash-lite", PRIMARY, FALLBACK],
  // Interface wording, translated a batch at a time from the Settings console.
  // Its own chain rather than the chatbot's, so routing one does not silently
  // reroute the other: a recruiter watching a translation stall has to be able to
  // change its model without touching the page a candidate is waiting on.
  translation: ["gemini-3-flash-preview", "gemini-3.1-flash-lite", PRIMARY, FALLBACK],
} as const;