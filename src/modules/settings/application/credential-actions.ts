"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import {
  encryptSecret,
  isEncryptionConfigured,
  secretHint,
} from "@/lib/crypto/secrets";
import {
  resolveSecret,
  resolveConfig,
} from "@/modules/settings/infrastructure/credentialResolver";
import {
  FALLBACK_MODELS,
  PROVIDERS,
  providerById,
  type ModelCatalogue,
  type ModelOption,
  type ProviderGroup,
} from "@/modules/settings/domain/providers";

/**
 * Credential management.
 *
 * INVARIANT: no function in this file ever returns a secret value. The only
 * secret-derived data that crosses to the client is `secret_hint` (last 4
 * characters). Reads use the service-role client because the tables carry no
 * RLS policy for any client role — that is deliberate.
 */

export interface CredentialKeyView {
  provider: string;
  displayName: string;
  group: ProviderGroup;
  envVar: string;
  description: string;
  docsUrl: string | null;
  verify: boolean;
  fields: { key: string; label: string; kind: "text" | "url" | "number"; placeholder?: string; required?: boolean; hint?: string; secret?: boolean }[];
  /** Where the credential currently comes from. */
  source: "stored" | "environment" | "unset";
  /** Names of secondary secret fields that already hold a value. */
  secretFieldsSet: string[];
  /** Masked hint, e.g. '••••••••9f3a'. Empty when nothing is configured. */
  hint: string;
  /** Non-secret settings (base urls, ids). */
  config: Record<string, string>;
  isActive: boolean;
  priority: number;
  lastVerifiedAt: string | null;
  lastVerifiedStatus: string | null;
  lastVerifiedDetail: string | null;
  updatedAt: string | null;
}

/** Backward-compat alias for CredentialsConsole */
export type CredentialView = CredentialKeyView;

export interface AiModelRow {
  capability: string;
  primaryModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  isEnabled: boolean;
  updatedAt: string;
}

/** True when secrets can be stored at all. Surfaced in the UI as a blocker. */
export async function getEncryptionStatus(): Promise<{ configured: boolean }> {
  await requireStaff("/settings");
  return { configured: isEncryptionConfigured() };
}

/**
 * Loads every provider with its configuration state.
 *
 * Now supports multiple keys per provider, ordered by priority (1 = primary).
 * When no row exists the credential falls back to the environment variable.
 */
export async function listCredentials(): Promise<CredentialKeyView[]> {
  await requireStaff("/settings");
  const admin = getSupabaseServiceClient();

  const { data } = await admin
    .from("provider_credentials")
    .select(
      "provider, priority, secret_hint, config, extra_secrets_encrypted, is_active, last_verified_at, last_verified_status, last_verified_detail, updated_at"
    )
    .order("priority", { ascending: true });

  const storedByProvider = new Map<string, Array<{
      provider: string;
      priority: number;
      secret_hint: string;
      config: Record<string, string> | null;
      extra_secrets_encrypted: Record<string, string> | null;
      is_active: boolean;
      last_verified_at: string | null;
      last_verified_status: string | null;
      last_verified_detail: string | null;
      updated_at: string;
    }>>();
  for (const row of (data ?? []) as unknown[]) {
    const r = row as {
      provider: string;
      priority: number;
      secret_hint: string;
      config: Record<string, string> | null;
      extra_secrets_encrypted: Record<string, string> | null;
      is_active: boolean;
      last_verified_at: string | null;
      last_verified_status: string | null;
      last_verified_detail: string | null;
      updated_at: string;
    };
    const arr = storedByProvider.get(r.provider) ?? [];
    arr.push(r);
    storedByProvider.set(r.provider, arr);
  }

  const results: CredentialKeyView[] = [];

  for (const definition of PROVIDERS) {
    const rows = storedByProvider.get(definition.id) ?? [];
    const envValue = process.env[definition.envVar]?.trim();

    if (rows.length === 0) {
      // No stored keys - fallback to env or unset
      const hint = envValue ? secretHint(envValue) : "";
      
      results.push({
        provider: definition.id,
        displayName: definition.displayName,
        group: definition.group,
        envVar: definition.envVar,
        description: definition.description,
        docsUrl: definition.docsUrl ?? null,
        verify: definition.verify !== null,
        fields: definition.fields.map((field) => ({ ...field })),
        source: envValue ? "environment" : "unset",
        hint,
        config: {},
        secretFieldsSet: [],
        isActive: true,
        priority: 999, // env fallback has lowest priority
        lastVerifiedAt: null,
        lastVerifiedStatus: null,
        lastVerifiedDetail: null,
        updatedAt: null,
      });
    } else {
      // Multiple stored keys, one per priority
      for (const row of rows) {
        results.push({
          provider: definition.id,
          displayName: definition.displayName,
          group: definition.group,
          envVar: definition.envVar,
          description: definition.description,
          docsUrl: definition.docsUrl ?? null,
          verify: definition.verify !== null,
          fields: definition.fields.map((field) => ({ ...field })),
          source: "stored",
          hint: row.secret_hint || "",
          config: Object.fromEntries(
            Object.entries((row.config ?? {}) as Record<string, string>).filter(
              ([key]) => !definition.fields.find((f) => f.key === key)?.secret
            )
          ),
          secretFieldsSet: Object.keys(row.extra_secrets_encrypted ?? {}),
          isActive: row.is_active ?? true,
          priority: row.priority,
          lastVerifiedAt: row.last_verified_at ?? null,
          lastVerifiedStatus: row.last_verified_status ?? null,
          lastVerifiedDetail: row.last_verified_detail ?? null,
          updatedAt: row.updated_at ?? null,
        });
      }
    }
  }

  return results;
}

export interface SaveCredentialResult {
  ok: boolean;
  error?: string;
}

export async function saveCredential(input: {
  provider: string;
  secret?: string;
  config?: Record<string, string>;
  isActive?: boolean;
  priority?: number;
}): Promise<SaveCredentialResult> {
  await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "You need the Manage platform settings permission." };
  }

  const definition = providerById(input.provider);
  if (!definition) return { ok: false, error: "Unknown provider." };

  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error:
        "SETTINGS_ENCRYPTION_KEY is not configured. Run `node scripts/generate-encryption-key.mjs` and add it to .env.local first.",
    };
  }

  // Split submitted fields: anything flagged `secret` is encrypted separately
  // and must never land in the plaintext `config` column.
  const submitted = input.config ?? {};
  const plainConfig: Record<string, string> = {};
  const secretFields: Record<string, string> = {};

  for (const field of definition.fields) {
    const value = submitted[field.key];
    if (value === undefined) continue;
    if (field.secret) {
      const trimmed = value.trim();
      // An empty secret field means "leave the stored value alone".
      if (trimmed.length > 0) secretFields[field.key] = trimmed;
    } else {
      plainConfig[field.key] = value.trim();
    }
  }

  const admin = getSupabaseServiceClient();
  const session = await createSupabaseServerClient();
  const { data: sessionData } = await session.auth.getUser();

  const { data: profile } = sessionData.user
    ? await session
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", sessionData.user.id)
        .maybeSingle()
    : { data: null as { id: string } | null };

  const actorId = profile?.id ?? null;
  const trimmed = input.secret?.trim() ?? "";
  const hasNewSecret = trimmed.length > 0;

  // Check if this is a new priority or updating existing
  const priority = input.priority ?? 1;

  const { data: existing } = await admin
    .from("provider_credentials")
    .select("id, secret_hint, config, extra_secrets_encrypted")
    .eq("provider", definition.id)
    .eq("priority", priority)
    .maybeSingle();

  const prior = existing as
    | {
        id: string;
        config: Record<string, string> | null;
        extra_secrets_encrypted: Record<string, string> | null;
      }
    | null;

  // Preserve previously stored secondary secrets that were not resubmitted.
  const encryptedExtras: Record<string, string> = { ...(prior?.extra_secrets_encrypted ?? {}) };
  for (const [key, value] of Object.entries(secretFields)) {
    encryptedExtras[key] = encryptSecret(value);
  }

  // Required non-secret fields must be present on create.
  if (!existing) {
    const missing = definition.fields.filter((f) => f.required && !f.secret && !plainConfig[f.key]);
    if (missing.length > 0) {
      return { ok: false, error: `Missing: ${missing.map((f) => f.label).join(", ")}.` };
    }
  }

  if (!existing) {
    if (!hasNewSecret) {
      return { ok: false, error: "Enter a value to save." };
    }
    const { error } = await admin.from("provider_credentials").insert({
      provider: definition.id,
      priority: priority,
      display_name: definition.displayName,
      env_var_name: definition.envVar,
      secret_encrypted: encryptSecret(trimmed),
      secret_hint: secretHint(trimmed),
      config: plainConfig,
      extra_secrets_encrypted: encryptedExtras,
      is_active: input.isActive ?? true,
      last_verified_status: null,
      last_verified_at: null,
      created_by: actorId,
      updated_by: actorId,
    });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin
      .from("provider_credentials")
      .update({
        config: { ...(prior?.config ?? {}), ...plainConfig },
        extra_secrets_encrypted: encryptedExtras,
        is_active: input.isActive ?? true,
        updated_by: actorId,
      })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  }

  // Audit trail records only that a credential changed — never its value.
  const rotatedExtras = Object.keys(secretFields);
  await admin.from("credential_audit_log").insert({
    provider: definition.id,
    action: hasNewSecret ? (existing ? "ROTATED" : "CREATED") : "UPDATED",
    actor_id: actorId,
    detail: hasNewSecret
      ? `Secret replaced (hint ${secretHint(trimmed)})${
          rotatedExtras.length ? ` + ${rotatedExtras.join(", ")}` : ""
        }`
      : "Config fields updated",
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Removes the stored credential so the provider falls back to its env var. */
export async function deleteCredential(provider: string): Promise<SaveCredentialResult> {
  await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "You need the Manage platform settings permission." };
  }

  const definition = providerById(provider);
  if (!definition) return { ok: false, error: "Unknown provider." };

  const admin = getSupabaseServiceClient();
  const session = await createSupabaseServerClient();
  const { data: sessionData } = await session.auth.getUser();

  const { data: profile } = sessionData.user
    ? await session.from("user_profiles").select("id").eq("auth_user_id", sessionData.user.id).maybeSingle()
    : { data: null };

  const { error } = await admin.from("provider_credentials").delete().eq("provider", definition.id);
  if (error) return { ok: false, error: error.message };

  await admin.from("credential_audit_log").insert({
    provider: definition.id,
    action: "DELETED",
    actor_id: profile?.id ?? null,
    detail: "Reverted to environment variable",
  });

  revalidatePath("/settings");
  return { ok: true };
}

export interface VerifyResult {
  ok: boolean;
  status: "working" | "failed" | "unverifiable";
  message: string;
}

/**
 * Performs a live call to the provider to confirm the credential works.
 *
 * The secret is decrypted here and immediately attached to an outgoing request;
 * it is never logged and never returned.
 */
export async function verifyCredential(provider: string): Promise<VerifyResult> {
  await requireStaff("/settings");

  const definition = providerById(provider);
  if (!definition) return { ok: false, status: "failed", message: "Unknown provider." };
  if (!definition.verify) {
    return {
      ok: false,
      status: "unverifiable",
      message: "This provider cannot be verified automatically — check the settings carefully.",
    };
  }

  const secret = await resolveSecret(provider);
  if (!secret) {
    return { ok: false, status: "failed", message: "No credential configured." };
  }

  let url = definition.verify.url;
  const config = await resolveConfig(provider);

  if (definition.id === "frappe_hr") {
    url = `${String(config.base_url ?? "").replace(/\/$/, "")}/api/method/ping`;
  }
  if (definition.id === "microsoft_calendar") {
    return {
      ok: false,
      status: "unverifiable",
      message: "Microsoft 365 uses OAuth — verify by completing the consent flow.",
    };
  }

  if (!url) {
    return { ok: false, status: "unverifiable", message: "Set a base URL before verifying." };
  }

  const headers: Record<string, string> = {};
  if (definition.verify.header === "Authorization") {
    headers.Authorization = `Bearer ${secret}`;
  } else {
    headers[definition.verify.header] = secret;
  }

  if (definition.id === "openrouter") {
    headers["HTTP-Referer"] = process.env.APP_URL ?? "http://localhost:3000";
    headers["X-Title"] = "Sharm Dreams Talent Cloud";
  }

  try {
    const response = await fetch(url, {
      method: definition.verify.method,
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    const admin = getSupabaseServiceClient();
    const session = await createSupabaseServerClient();
    const { data: sessionData } = await session.auth.getUser();
    const { data: profile } = sessionData.user
      ? await session.from("user_profiles").select("id").eq("auth_user_id", sessionData.user.id).maybeSingle()
      : { data: null };

    const status = response.ok ? "working" : "failed";
    const message = response.ok
      ? `Connected (HTTP ${response.status}).`
      : `Rejected by the provider (HTTP ${response.status}).`;

    await admin
      .from("provider_credentials")
      .update({
        last_verified_at: new Date().toISOString(),
        last_verified_status: status,
        last_verified_detail: message,
      })
      .eq("provider", definition.id);

    await admin.from("credential_audit_log").insert({
      provider: definition.id,
      action: "VERIFIED",
      actor_id: profile?.id ?? null,
      detail: message,
    });

    revalidatePath("/settings");
    return { ok: response.ok, status, message };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Timed out after 15s — check the network or base URL."
        : "Could not reach the provider.";

    return { ok: false, status: "failed", message };
  }
}

/* -------------------------------------------------------------------------- */
/* AI model routing                                                           */
/* -------------------------------------------------------------------------- */

export async function listModelRouting(): Promise<AiModelRow[]> {
  await requireStaff("/settings");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("ai_model_config")
    .select("capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_at")
    .order("capability");

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as {
      capability: string;
      primary_model: string;
      fallback_model: string | null;
      temperature: number;
      max_tokens: number;
      is_enabled: boolean;
      updated_at: string;
    };
    return {
      capability: r.capability,
      primaryModel: r.primary_model,
      fallbackModel: r.fallback_model,
      temperature: Number(r.temperature ?? 0.3),
      maxTokens: r.max_tokens ?? 1200,
      isEnabled: r.is_enabled ?? true,
      updatedAt: r.updated_at,
    };
  });
}

export async function saveModelRouting(input: {
  capability: string;
  primaryModel: string;
  fallbackModel?: string | null;
  temperature: number;
  maxTokens: number;
  isEnabled: boolean;
}): Promise<SaveCredentialResult> {
  await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "You need the Manage platform settings permission." };
  }

  if (!input.primaryModel?.trim()) {
    return { ok: false, error: "Choose a primary model." };
  }
  if (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) {
    return { ok: false, error: "Temperature must be between 0 and 2." };
  }
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 64 || input.maxTokens > 32_000) {
    return { ok: false, error: "Max tokens must be between 64 and 32000." };
  }

  const session = await createSupabaseServerClient();
  const { data: sessionData } = await session.auth.getUser();
  const { data: profile } = sessionData.user
    ? await session
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", sessionData.user.id)
        .maybeSingle()
    : { data: null as { id: string } | null };

  const { error } = await session
    .from("ai_model_config")
    .upsert({
      capability: input.capability,
      primary_model: input.primaryModel.trim(),
      fallback_model: input.fallbackModel?.trim() || null,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      is_enabled: input.isEnabled,
      updated_by: profile?.id ?? null,
    });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Fetches the live model catalogue from OpenRouter.
 *
 * Falls back to a curated static list when the gateway is unreachable so the
 * picker is never empty.
 */
export async function getModelCatalogue(): Promise<ModelCatalogue> {
  await requireStaff("/settings");

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = (await response.json()) as {
      data?: {
        id: string;
        name: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }[];
    };

    const models: ModelOption[] = (payload.data ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      promptPrice: model.pricing?.prompt ? Number(model.pricing.prompt) * 1_000_000 : null,
      completionPrice: model.pricing?.completion ? Number(model.pricing.completion) * 1_000_000 : null,
      contextLength: model.context_length ?? null,
      free: (model.pricing?.prompt ?? "0") === "0",
    }));

    // Free models first (the group runs on free tiers), then cheapest.
    models.sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      return (a.promptPrice ?? Infinity) - (b.promptPrice ?? Infinity);
    });

    return { models, fetchedAt: new Date().toISOString(), degraded: false };
  } catch {
    return {
      models: [...FALLBACK_MODELS],
      fetchedAt: new Date().toISOString(),
      degraded: true,
    };
  }
}

export interface AuditEntryView {
  id: string;
  provider: string | null;
  action: string;
  detail: string | null;
  actor: string | null;
  createdAt: string;
}

/** Credential change history. Contains no secret material by construction. */
export async function listCredentialAudit(limit = 30): Promise<AuditEntryView[]> {
  await requireStaff("/settings");

  const { data } = await getSupabaseServiceClient()
    .from("credential_audit_log")
    .select("id, provider, action, detail, created_at, actor_id, user_profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: string;
      provider: string | null;
      action: string;
      detail: string | null;
      created_at: string;
      user_profiles?: { full_name?: string } | { full_name?: string }[] | null;
    };
    const actor = Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles;
    return {
      id: r.id,
      provider: r.provider,
      action: r.action,
      detail: r.detail,
      actor: actor?.full_name ?? null,
      createdAt: r.created_at,
    };
  });
}