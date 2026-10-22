import "server-only";

import { getServiceRestClient } from "@/lib/data-api/service";
import { decryptSecret } from "@/lib/crypto/secrets";
import { providerById } from "@/modules/settings/domain/providers";

/**
 * Runtime credential + model resolution.
 *
 * Deliberately NOT a "use server" module: this is called from the AI gateway
 * and the omnichannel connectors on every request, not from the browser. It is
 * `server-only`, so importing it from a Client Component is a build error and
 * the decrypted values cannot reach the client bundle.
 *
 * Precedence is always: stored (encrypted) value, then environment variable.
 * That makes the Settings → API keys panel authoritative while keeping a
 * working env-based deployment working unchanged.
 */

/** Represents a single credential entry with its metadata. */
export interface CredentialEntry {
  provider: string;
  priority: number;
  secret: string;
  config: Record<string, string>;
  extraSecrets: Record<string, string>;
  secretHint: string;
}

/**
 * Returns all active credentials for a provider, ordered by priority (lowest first = highest priority).
 * Returns empty array if none found and no env var fallback.
 */
export async function resolveCredentials(provider: string): Promise<CredentialEntry[]> {
  const definition = providerById(provider);
  if (!definition) return [];

  // Get all active credentials for this provider, ordered by priority
  const { data } = await getServiceRestClient()
    .from("provider_credentials")
    .select("priority, secret_encrypted, config, extra_secrets_encrypted, secret_hint")
    .eq("provider", provider)
    .eq("is_active", true)
    .order("priority", { ascending: true });

  const credentials: CredentialEntry[] = [];

  for (const row of (data ?? []) as Array<{
    priority: number;
    secret_encrypted: string;
    config: Record<string, string> | null;
    extra_secrets_encrypted: Record<string, string> | null;
    secret_hint: string | null;
  }>) {
    try {
      const decrypted = decryptSecret(row.secret_encrypted);
      if (decrypted.trim()) {
        credentials.push({
          provider,
          priority: row.priority,
          secret: decrypted,
          config: row.config ?? {},
          extraSecrets: row.extra_secrets_encrypted ?? {},
          secretHint: row.secret_hint ?? "",
        });
      }
    } catch {
      // Skip failed decryption
    }
  }

  // Add env var as lowest priority fallback
  const envValue = process.env[definition.envVar]?.trim();
  if (envValue) {
    credentials.push({
      provider,
      priority: 999,
      secret: envValue,
      config: {},
      extraSecrets: {},
      secretHint: "env",
    });
  }

  // Sort by priority (ascending = highest priority first)
  return credentials.sort((a, b) => a.priority - b.priority);
}

/**
 * Returns the highest-priority secret for a provider.
 * This is the main entry point for backward compatibility.
 */
export async function resolveSecret(provider: string): Promise<string | null> {
  const credentials = await resolveCredentials(provider);
  return credentials[0]?.secret ?? null;
}

/**
 * Non-secret settings for a provider, stored values overriding env defaults.
 *
 * Secondary secrets (e.g. the WhatsApp app secret) are deliberately NOT
 * included here — callers that need one must use `resolveExtraSecret`.
 */
export async function resolveConfig(provider: string): Promise<Record<string, string>> {
  const { data } = await getServiceRestClient()
    .from("provider_credentials")
    .select("config")
    .eq("provider", provider)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1);

  const stored = ((data?.[0] as { config: Record<string, string> | null } | undefined)?.config ?? {}) as Record<
    string,
    string
  >;

  const envDefaults: Record<string, Record<string, string>> = {
    whatsapp: {
      phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
      verify_token: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    },
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: process.env.SMTP_PORT ?? "",
      username: process.env.SMTP_USER ?? "",
      from: process.env.EMAIL_FROM ?? "",
    },
    cloudflare_workers_ai: {
      account_id: process.env.CLOUDFLARE_AI_ACCOUNT_ID ?? "",
    },
  };

  return { ...(envDefaults[provider] ?? {}), ...stored };
}

/**
 * A secondary secret for a provider (e.g. the WhatsApp app secret), decrypted
 * from `extra_secrets_encrypted`.
 */
export async function resolveExtraSecret(
  provider: string,
  field: string
): Promise<string | null> {
  const { data } = await getServiceRestClient()
    .from("provider_credentials")
    .select("extra_secrets_encrypted, is_active")
    .eq("provider", provider)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1);

  const row = data?.[0] as
    | { extra_secrets_encrypted: Record<string, string> | null; is_active: boolean }
    | undefined;

  const blob = row?.extra_secrets_encrypted?.[field];
  if (!blob) return null;

  try {
    const value = decryptSecret(blob);
    return value.trim() || null;
  } catch {
    return null;
  }
}

/** Which secondary secret fields are configured, without revealing them. */
export async function resolveExtraSecretPresence(
  provider: string
): Promise<Record<string, boolean>> {
  const { data } = await getServiceRestClient()
    .from("provider_credentials")
    .select("extra_secrets_encrypted")
    .eq("provider", provider)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1);

  const blob = (data?.[0] as { extra_secrets_encrypted: Record<string, string> | null } | undefined)
    ?.extra_secrets_encrypted;

  if (!blob) return {};
  return Object.fromEntries(Object.entries(blob).map(([key]) => [key, true]));
}

export interface ResolvedRouting {
  enabled: boolean;
  primaryModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
}

/**
 * Per-capability model routing. Falls back to sensible defaults when the table
 * has no row or the capability is unknown, so the gateway never starts empty.
 */
export async function resolveModelRouting(capability: string): Promise<ResolvedRouting> {
  const fallback: ResolvedRouting = {
    enabled: true,
    primaryModel: "google/gemma-4-31b-it:free",
    fallbackModel: "google/gemma-4-26b-a4b-it:free",
    temperature: 0.3,
    maxTokens: 1200,
  };

  try {
    const { data } = await getServiceRestClient()
      .from("ai_model_config")
      .select("primary_model, fallback_model, temperature, max_tokens, is_enabled")
      .eq("capability", capability)
      .maybeSingle();

    const row = data as {
      primary_model: string;
      fallback_model: string | null;
      temperature: number;
      max_tokens: number;
      is_enabled: boolean;
    } | null;

    if (!row) return fallback;

    return {
      enabled: row.is_enabled ?? true,
      primaryModel: row.primary_model,
      fallbackModel: row.fallback_model,
      temperature: Number(row.temperature ?? fallback.temperature),
      maxTokens: row.max_tokens ?? fallback.maxTokens,
    };
  } catch {
    return fallback;
  }
}