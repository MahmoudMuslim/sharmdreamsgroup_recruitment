/**
 * Client-safe configuration.
 *
 * IMPORTANT: this module is imported by browser code, so it must never touch
 * server-only secrets. AI provider keys and the service-role key live in
 * `config.server.ts`, which is guarded with `server-only`.
 *
 * Validation here is limited to the NEXT_PUBLIC_* values that are inlined into
 * the client bundle at build time.
 */

function optional(value: string | undefined, fallback = ""): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

const supabaseUrl = optional(process.env.NEXT_PUBLIC_SUPABASE_URL);

/** Raises only on the server at runtime, where the value is actually required.
 * During build (static generation), we allow missing values to avoid build failures. */
function assertServer(name: string, value: string): string {
  // Skip validation during Next.js build/static generation
  const isBuildTime = process.env.NEXT_PHASE === "phase-production-build" ||
                      process.env.NEXT_PHASE === "phase-development-build" ||
                      process.env.NODE_ENV === "production" && typeof window === "undefined" && !process.env.VERCEL;
  
  if (!value && typeof window === "undefined" && !isBuildTime) {
    throw new Error(
      `[config] Missing required environment variable: ${name}. Add it to .env.local (see .env.example).`
    );
  }
  return value || "";
}

export const supabaseConfig = {
  projectRef:
    optional(process.env.SUPABASE_PROJECT_REF) ||
    supabaseUrl.replace(/^https:\/\//, "").split(".")[0],
  url: assertServer("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl),
  restUrl:
    optional(process.env.SUPABASE_REST_URL) || `${supabaseUrl}/rest/v1/`,
  anonKey: assertServer(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    optional(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  ),
  /** Only ever read from server modules — never serialised to the client. */
  serviceRoleKey: optional(process.env.SUPABASE_SERVICE_ROLE_KEY),
  dbPassword: optional(process.env.SUPABASE_DB_PASSWORD),
  buckets: {
    candidateVideos: "candidate-videos",
    candidateAudio: "candidate-audio",
    resumes: "resumes",
  },
} as const;

export const appConfig = {
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
  | "transcription";

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
} as const;