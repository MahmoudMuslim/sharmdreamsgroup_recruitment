import "server-only";

/**
 * Server-only configuration: AI provider keys, the Supabase service-role
 * secret and third-party integration credentials.
 *
 * The `server-only` guard makes it a build error if any Client Component ever
 * imports this file, which is what previously broke every page in the app
 * (the browser bundle tried to read OPENROUTER_API_KEY).
 *
 * Values are resolved lazily so a missing optional integration key degrades
 * gracefully instead of crashing the whole app at import time.
 */

function optional(name: string, value: string | undefined, fallback = ""): string {
  if (value && value.trim().length > 0) return value.trim();
  if (fallback) return fallback;
  return "";
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[config] Missing required environment variable: ${name}. Add it to .env.local (see .env.example).`
    );
  }
  return value.trim();
}

const AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 90_000);

export const aiConfig = {
  openRouter: {
    apiKey: optional("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY),
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
  openCode: {
    apiKey: optional("OPENCODE_API_KEY", process.env.OPENCODE_API_KEY),
    baseUrl: "https://opencode.ai/api/v1/chat/completions",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
  googleAiStudio: {
    apiKey: optional("GOOGLE_AI_STUDIO_KEY", process.env.GOOGLE_AI_STUDIO_KEY),
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
} as const;

/** True when at least one AI provider is usable. */
export function hasAiProvider(): boolean {
  return Boolean(aiConfig.openRouter.apiKey || aiConfig.googleAiStudio.apiKey);
}

export function requireOpenRouterKey(): string {
  return required("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY);
}

export const omnichannelConfig = {
  whatsapp: {
    apiToken: optional("WHATSAPP_CLOUD_API_TOKEN", process.env.WHATSAPP_CLOUD_API_TOKEN),
    phoneNumberId: optional("WHATSAPP_PHONE_NUMBER_ID", process.env.WHATSAPP_PHONE_NUMBER_ID),
    verifyToken: optional(
      "WHATSAPP_VERIFY_TOKEN",
      process.env.WHATSAPP_VERIFY_TOKEN,
      "sharm-dreams-verify"
    ),
    graphApiVersion: "v21.0",
  },
  greenhouse: {
    apiKey: optional("GREENHOUSE_API_KEY", process.env.GREENHOUSE_API_KEY),
    baseUrl: "https://harvest.greenhouse.io/v1",
  },
  lever: {
    apiKey: optional("LEVER_API_KEY", process.env.LEVER_API_KEY),
    baseUrl: "https://api.lever.co/v1",
  },
  frappeHr: {
    baseUrl: optional("FRAPPE_HR_BASE_URL", process.env.FRAPPE_HR_BASE_URL),
    apiKey: optional("FRAPPE_HR_API_KEY", process.env.FRAPPE_HR_API_KEY),
  },
  calendar: {
    google: {
      clientId: optional("GOOGLE_CALENDAR_CLIENT_ID", process.env.GOOGLE_CALENDAR_CLIENT_ID),
      clientSecret: optional(
        "GOOGLE_CALENDAR_CLIENT_SECRET",
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET
      ),
      redirectUri: optional(
        "GOOGLE_CALENDAR_REDIRECT_URI",
        process.env.GOOGLE_CALENDAR_REDIRECT_URI,
        "http://localhost:3000/api/calendar/google/callback"
      ),
      scopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    microsoft: {
      clientId: optional("MS_CALENDAR_CLIENT_ID", process.env.MS_CALENDAR_CLIENT_ID),
      clientSecret: optional(
        "MS_CALENDAR_CLIENT_SECRET",
        process.env.MS_CALENDAR_CLIENT_SECRET
      ),
      redirectUri: optional(
        "MS_CALENDAR_REDIRECT_URI",
        process.env.MS_CALENDAR_REDIRECT_URI,
        "http://localhost:3000/api/calendar/microsoft/callback"
      ),
      scopes: ["https://graph.microsoft.com/Calendars.ReadWrite", "offline_access"],
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    },
  },
} as const;

export const cronConfig = {
  /** Shared secret expected in the `x-cron-secret` header. */
  secret: optional("CRON_SECRET", process.env.CRON_SECRET),
  whatsappBatchSize: Number(process.env.WHATSAPP_CRON_BATCH_SIZE ?? 50),
} as const;