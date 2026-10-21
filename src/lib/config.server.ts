import "server-only";

/**
 * Server-only configuration: AI provider keys and third-party integration
 * credentials.
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
    baseUrl: "https://opencode.ai/inference/openai/v1/chat/completions",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
  qoder: {
    apiKey: optional("QODER_API_KEY", process.env.QODER_API_KEY),
    baseUrl: "https://api.qoder.com/api/v1",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
  googleAiStudio: {
    apiKey: optional("GOOGLE_AI_STUDIO_API_KEY", process.env.GOOGLE_AI_STUDIO_API_KEY),
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
  cloudflareWorkersAi: {
    apiKey: optional("CLOUDFLARE_AI_API_TOKEN", process.env.CLOUDFLARE_AI_API_TOKEN),
    // Workers AI addresses every model through an account, so a token without
    // this cannot be used; the stored Account ID field overrides it.
    accountId: optional("CLOUDFLARE_AI_ACCOUNT_ID", process.env.CLOUDFLARE_AI_ACCOUNT_ID),
    baseUrl: "https://api.cloudflare.com/client/v4/accounts",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
  nvidiaNim: {
    apiKey: optional("NVIDIA_API_KEY", process.env.NVIDIA_API_KEY),
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  },
} as const;

/** True when at least one AI provider is usable. */
export function hasAiProvider(): boolean {
  return Boolean(
    aiConfig.openRouter.apiKey ||
      aiConfig.googleAiStudio.apiKey ||
      aiConfig.openCode.apiKey ||
      aiConfig.qoder.apiKey ||
      aiConfig.nvidiaNim.apiKey ||
      (aiConfig.cloudflareWorkersAi.apiKey && aiConfig.cloudflareWorkersAi.accountId)
  );
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
  /**
   * SMTP relay for the email channel. Every value can be overridden by the
   * encrypted store (Settings → API keys), which the connector reads first —
   * this object is only the deployment-level default.
   */
  email: {
    host: optional("SMTP_HOST", process.env.SMTP_HOST),
    port: Number(process.env.SMTP_PORT ?? 587),
    username: optional("SMTP_USER", process.env.SMTP_USER),
    password: optional("SMTP_PASSWORD", process.env.SMTP_PASSWORD),
    from: optional("EMAIL_FROM", process.env.EMAIL_FROM),
  },
} as const;

export const cronConfig = {
  /** Shared secret expected in the `x-cron-secret` header. */
  secret: optional("CRON_SECRET", process.env.CRON_SECRET),
  whatsappBatchSize: Number(process.env.WHATSAPP_CRON_BATCH_SIZE ?? 50),
  gradingBatchSize: Number(process.env.GRADING_CRON_BATCH_SIZE ?? 10),
} as const;