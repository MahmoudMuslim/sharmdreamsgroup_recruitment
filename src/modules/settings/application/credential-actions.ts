"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import { changePhrase, scalarEdits } from "@/modules/activity/domain/trail";
import {
  encryptSecret,
  isEncryptionConfigured,
  secretHint,
} from "@/lib/crypto/secrets";
import {
  resolveSecret,
  resolveConfig,
} from "@/modules/settings/infrastructure/credentialResolver";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";
import { aiConfig } from "@/lib/config.server";
import {
  AI_CAPABILITIES,
  FALLBACK_MODELS,
  PROVIDERS,
  providerById,
  type CatalogueSource,
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
  /** How many key rows a delete actually removed — a provider can hold several. */
  removed?: number;
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

  await recordActivity({
    area: "settings",
    action: hasNewSecret
      ? existing
        ? "credential_rotate"
        : "credential_create"
      : "credential_update",
    entity: "credential",
    entityId: definition.id,
    summary: hasNewSecret
      ? existing
        ? `Replaced the stored ${definition.displayName} key`
        : `Saved a ${definition.displayName} key, so the portal uses it instead of ${definition.envVar}`
      : `Updated ${definition.displayName}’s settings${
          input.isActive === false ? " and paused the provider" : ""
        }`,
    detail: {
      provider: definition.id,
      priority,
      fields: Object.keys(plainConfig).join(", ") || "none",
      ...(rotatedExtras.length ? { extra_values_replaced: rotatedExtras.join(", ") } : {}),
      is_active: input.isActive ?? true,
      note: "The key itself is encrypted in its own table and never copied here.",
    },
  });

  dropCatalogueCache();
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

  // Read the rows first: a delete is the last moment their shape can be named,
  // and removing nothing must not be reported as a change. The console hides the
  // Remove button unless a row is stored; this action is also reached from the
  // assistant, which has no such gate, so the refusal belongs here.
  const { data: stored, error: readError } = await admin
    .from("provider_credentials")
    .select("priority, is_active")
    .eq("provider", definition.id)
    .order("priority", { ascending: true });
  if (readError) return { ok: false, error: readError.message };

  const rows = (stored ?? []) as { priority: number; is_active: boolean }[];
  if (rows.length === 0) {
    return {
      ok: false,
      error: `Nothing is stored for ${definition.displayName}, so there is no key to remove — the portal already reads ${definition.envVar}.`,
    };
  }

  const { error } = await admin.from("provider_credentials").delete().eq("provider", definition.id);
  if (error) return { ok: false, error: error.message };

  await admin.from("credential_audit_log").insert({
    provider: definition.id,
    action: "DELETED",
    actor_id: profile?.id ?? null,
    detail: "Reverted to environment variable",
  });

  await recordActivity({
    area: "settings",
    action: "credential_delete",
    entity: "credential",
    entityId: definition.id,
    summary: `Removed ${rows.length} stored ${definition.displayName} key row${
      rows.length === 1 ? "" : "s"
    }, so the portal reads ${definition.envVar} again`,
    detail: {
      provider: definition.id,
      rows_removed: rows.length,
      priorities: rows.map((row) => row.priority).join(", "),
      was_active: rows.map((row) => row.is_active).join(", "),
      note: "The key was deleted with the row; only the environment variable can serve it now.",
    },
  });

  dropCatalogueCache();
  revalidatePath("/settings");
  return { ok: true, removed: rows.length };
}

export interface VerifyResult {
  ok: boolean;
  status: "working" | "failed" | "unverifiable";
  message: string;
}

/**
 * Records a Test-button outcome on the credential row and in the audit trail.
 * The message is what the admin saw, so it must never contain a secret.
 */
async function recordVerificationOutcome(
  provider: string,
  status: "working" | "failed",
  message: string
): Promise<void> {
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

  await admin
    .from("provider_credentials")
    .update({
      last_verified_at: new Date().toISOString(),
      last_verified_status: status,
      last_verified_detail: message,
    })
    .eq("provider", provider);

  await admin.from("credential_audit_log").insert({
    provider,
    action: "VERIFIED",
    actor_id: profile?.id ?? null,
    detail: message,
  });

  await recordActivity({
    area: "settings",
    action: status === "working" ? "credential_verified" : "credential_verify_failed",
    entity: "credential",
    entityId: provider,
    summary: `Tested the ${providerById(provider)?.displayName ?? provider} credential — ${
      status === "working" ? "the provider answered" : "the provider refused it"
    }`,
    detail: {
      provider,
      status,
      outcome: message,
      ...(profile?.id ? {} : { note: "No profile row was found for the signed-in account." }),
    },
  });

  revalidatePath("/settings");
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

  // SMTP has no "is this key valid" endpoint, so the probe signs in instead.
  if (definition.verify.transport === "smtp") {
    const outcome = await EmailConnector.verify();
    const status = outcome.ok ? "working" : "failed";
    await recordVerificationOutcome(definition.id, status, outcome.message);
    return { ok: outcome.ok, status, message: outcome.message };
  }

  const secret = await resolveSecret(provider);
  if (!secret) {
    return { ok: false, status: "failed", message: "No credential configured." };
  }

  let url = definition.verify.url;
  const config = await resolveConfig(provider);

  // Cloudflare's endpoints are all addressed to an account, so the token alone
  // has no URL to call. Say so instead of fetching a path with an empty segment.
  if (url.includes("{account_id}")) {
    const accountId =
      String(config.account_id ?? "").trim() || aiConfig.cloudflareWorkersAi.accountId;
    if (!accountId) {
      return {
        ok: false,
        status: "failed",
        message:
          "Cloudflare Workers AI needs an Account ID as well as a token — every call is addressed to an account. Fill the Account ID field above, or set CLOUDFLARE_AI_ACCOUNT_ID.",
      };
    }
    url = url.replace("{account_id}", encodeURIComponent(accountId));
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

    const status = response.ok ? "working" : "failed";
    const message = response.ok
      ? `Connected (HTTP ${response.status}).`
      : `Rejected by the provider (HTTP ${response.status}).`;

    await recordVerificationOutcome(definition.id, status, message);
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

  const routed = {
    primary_model: input.primaryModel.trim(),
    fallback_model: input.fallbackModel?.trim() || null,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    is_enabled: input.isEnabled,
  };

  // Read first: a routing row that matches what is already stored leaves no trail
  // row, and a re-point is worth naming against the model it replaced.
  const { data: before } = await session
    .from("ai_model_config")
    .select("primary_model, fallback_model, temperature, max_tokens, is_enabled")
    .eq("capability", input.capability)
    .maybeSingle();

  const { error } = await session
    .from("ai_model_config")
    .upsert({ capability: input.capability, ...routed, updated_by: profile?.id ?? null });

  if (error) return { ok: false, error: error.message };

  const edits = scalarEdits((before as Record<string, unknown> | null) ?? {}, routed);
  if (Object.keys(edits).length > 0) {
    // The trail withholds any key that looks like a credential, and `max_tokens`
    // reads like one — while the budget is exactly what a reviewer needs to see.
    if (edits.max_tokens) {
      edits.max_output_length = edits.max_tokens;
      delete edits.max_tokens;
    }
    const label =
      AI_CAPABILITIES.find((each) => each.id === input.capability)?.label ??
      input.capability.replace(/_/g, " ");
    await recordActivity({
      area: "settings",
      action: before ? "routing_update" : "routing_create",
      entity: "model routing",
      entityId: input.capability,
      summary: `${before ? "Re-pointed" : "Pointed"} ${label} at ${routed.primary_model} — ${changePhrase(
        edits
      )}`,
      detail: edits,
    });
  }

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Fetches the live model catalogue from every AI provider whose list this
 * portal can read: OpenRouter, Google AI Studio, OpenCode and Qoder.
 *
 * Each row carries the provider that published it, because the id prefix is not
 * the provider — `google/gemma-4-31b-it:free` is an OpenRouter listing of a
 * Google model, while `gemini-2.5-flash` is Google's own endpoint.
 *
 * A provider that is listed but cannot be called by this codebase is still
 * shown, tagged `routable: false`, so the console can say so out loud instead of
 * showing an empty group that looks like a broken integration. Routability is a
 * property of the gateway's code, not of the credentials: a stored key alone
 * never earns it.
 *
 * A source that fails degrades only itself: one unreachable provider must not
 * blank out the picker, which falls back to a curated static list when
 * OpenRouter — the default inference path — is the one that failed.
 */
/**
 * The live answer, kept for a few minutes.
 *
 * Building the catalogue means one request to each of six vendor endpoints — and
 * Google pages twice while Cloudflare pages up to eight — so an uncached read
 * held the AI models console behind a spinner for twenty seconds every time it
 * mounted. Model lists change on a scale of days, so the console shows how old
 * the answer is and `Refresh catalogue` forces a new read.
 */
const CATALOGUE_TTL_MS = 5 * 60_000;
let catalogueCache: { value: ModelCatalogue; at: number } | null = null;

/** A stored key decides which provider can be listed, so a write voids the read. */
function dropCatalogueCache() {
  catalogueCache = null;
}

export async function getModelCatalogue(options?: {
  force?: boolean;
}): Promise<ModelCatalogue> {
  await requireStaff("/settings");

  if (!options?.force && catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.value;
  }

  const results = await Promise.all([
    fetchOpenRouterModels(),
    fetchGoogleModels(),
    fetchOpenCodeModels(),
    fetchQoderModels(),
    fetchCloudflareModels(),
    fetchNvidiaModels(),
  ]);

  const models = results.flatMap((r) => r.models);
  const sources = results.map((r) => r.source);
  const openRouter = sources[0];

  const value: ModelCatalogue = {
    models,
    sources,
    fetchedAt: new Date().toISOString(),
    degraded: openRouter.status !== "ok",
  };
  catalogueCache = { value, at: Date.now() };
  return value;
}

interface SourceResult {
  models: ModelOption[];
  source: CatalogueSource;
}

/**
 * The providers this portal can actually send an inference request to.
 *
 * Every member here has a caller in `aiGateway.ts`. Adding a provider to the
 * registry does not make it routable — that takes the gateway branch, and the
 * catalogue's qualified id, as well.
 */
function isRoutableProvider(id: string): boolean {
  return (
    id === "openrouter" ||
    id === "google_ai_studio" ||
    id === "opencode" ||
    id === "qoder" ||
    id === "cloudflare_workers_ai" ||
    id === "nvidia_nim"
  );
}

/** A fetch failure that only degrades its own provider's rows. */
function failedSource(
  id: string,
  status: CatalogueSource["status"],
  note: string
): SourceResult {
  return {
    models: [],
    source: {
      id,
      displayName: providerById(id)?.displayName ?? id,
      count: 0,
      routable: isRoutableProvider(id),
      status,
      note,
    },
  };
}

function okSource(id: string, models: ModelOption[], note?: string): SourceResult {
  return {
    models,
    source: {
      id,
      displayName: providerById(id)?.displayName ?? id,
      count: models.length,
      routable: isRoutableProvider(id),
      status: "ok",
      ...(note ? { note } : {}),
    },
  };
}

async function fetchOpenRouterModels(): Promise<SourceResult> {
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
      provider: "openrouter",
      routable: true,
    }));

    // Free models first (the group runs on free tiers), then cheapest.
    models.sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      return (a.promptPrice ?? Number.MAX_SAFE_INTEGER) - (b.promptPrice ?? Number.MAX_SAFE_INTEGER);
    });

    return okSource("openrouter", models);
  } catch (error) {
    // The UI silently shows the offline list; log the cause so a degraded
    // catalogue can be diagnosed from the server console.
    console.error("getModelCatalogue (openrouter) failed:", error);
    return {
      models: FALLBACK_MODELS.map((model) => ({ ...model })),
      source: {
        id: "openrouter",
        displayName: providerById("openrouter")?.displayName ?? "openrouter",
        count: FALLBACK_MODELS.length,
        routable: true,
        status: "degraded",
        note: "OpenRouter's live list did not load, so the built-in list is shown.",
      },
    };
  }
}

/** Google's list is paginated and caps at 100 rows, so two pages are fetched. */
async function fetchGoogleModels(): Promise<SourceResult> {
  const key = await resolveSecret("google_ai_studio");
  if (!key) {
    return failedSource("google_ai_studio", "no_key", "No key stored — add one under API keys to list Gemini models.");
  }

  try {
    const rows: {
      name?: string;
      displayName?: string;
      inputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }[] = [];

    let pageToken = "";
    for (let page = 0; page < 2; page += 1) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const response = await fetch(url, {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401 || response.status === 403) {
        return failedSource(
          "google_ai_studio",
          "unauthorized",
          `Google rejected the stored key (HTTP ${response.status}).`
        );
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as {
        models?: typeof rows;
        nextPageToken?: string;
      };
      rows.push(...(payload.models ?? []));
      pageToken = payload.nextPageToken ?? "";
      if (!pageToken) break;
    }

    // Only models that can actually answer a chat request are useful here —
    // the same endpoint list also carries embeddings, TTS and image models.
    const models: ModelOption[] = rows
      .filter((row) => row.name && row.supportedGenerationMethods?.includes("generateContent"))
      .map((row) => ({
        // The gateway puts this id straight into `/models/{id}:generateContent`,
        // so it must be the bare id, not `models/gemini-…`.
        id: String(row.name).replace(/^models\//, ""),
        name: row.displayName ?? String(row.name).replace(/^models\//, ""),
        promptPrice: null,
        completionPrice: null,
        contextLength: row.inputTokenLimit ?? null,
        free: false,
        provider: "google_ai_studio",
        routable: true,
      }));

    return okSource("google_ai_studio", models, "Google does not publish per-model prices in this list.");
  } catch (error) {
    console.error("getModelCatalogue (google) failed:", error);
    return failedSource("google_ai_studio", "unreachable", "Google AI Studio did not answer.");
  }
}

async function fetchOpenCodeModels(): Promise<SourceResult> {
  const key = await resolveSecret("opencode");
  if (!key) {
    return failedSource("opencode", "no_key", "No token stored for OpenCode.");
  }

  try {
    const response = await fetch("https://opencode.ai/inference/v1/models", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      return failedSource("opencode", "unauthorized", "OpenCode rejected the stored token.");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = (await response.json()) as { data?: { id: string; created?: number }[] };
    const models: ModelOption[] = (payload.data ?? []).map((model) => ({
      // Qualified with its provider: OpenCode's ids are flat (`claude-haiku-4-5`),
      // which is the shape the gateway reads as "Google's own endpoint", so an
      // unqualified id would be stored in the routing table and then sent to the
      // wrong provider.
      id: `opencode:${model.id}`,
      name: model.id,
      promptPrice: null,
      completionPrice: null,
      contextLength: null,
      free: false,
      provider: "opencode",
      routable: true,
      detail: model.created
        ? `listed ${new Date(model.created * 1000).toISOString().slice(0, 10)}`
        : undefined,
    }));

    return okSource(
      "opencode",
      models,
      "OpenCode's hosted list carries only model ids — no prices, context sizes or display names. Requests go to its OpenAI-compatible inference endpoint, so this portal does send to it; what decides the answer is the account. Its free-tier ids are rejected server-side (HTTP 403: that tier is only callable inside the OpenCode client) and paid ids need credit (HTTP 402 when the balance is empty). The routing log shows which of the two each hop hit."
    );
  } catch (error) {
    console.error("getModelCatalogue (opencode) failed:", error);
    return failedSource("opencode", "unreachable", "OpenCode did not answer.");
  }
}

/**
 * Qoder's documented model list (GET /api/v1/cloud/models).
 *
 * The response carries relative pricing and capability metadata rather than
 * USD rates, and it lists models the account has switched off, so both are
 * surfaced verbatim instead of being folded into the price tiers.
 */
async function fetchQoderModels(): Promise<SourceResult> {
  const key = await resolveSecret("qoder");
  if (!key) {
    return failedSource("qoder", "no_key", "No personal access token stored for Qoder.");
  }

  try {
    const response = await fetch("https://api.qoder.com/api/v1/cloud/models", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      return failedSource("qoder", "unauthorized", "Qoder rejected the stored token.");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = (await response.json()) as {
      data?: {
        id: string;
        display_name?: string;
        is_enabled?: boolean;
        is_vl?: boolean;
        price_factor?: number;
        efforts?: string[];
        default_effort?: string;
        max_input_tokens?: number;
        available_context_windows?: number[];
      }[];
    };

    const models: ModelOption[] = (payload.data ?? []).map((model) => ({
      // Qualified like OpenCode's ids: `auto` and `qfmodel` carry no namespace,
      // and the routing table has no provider column, so the prefix is the only
      // thing that tells the gateway these are not a Google model.
      id: `qoder:${model.id}`,
      name: model.display_name ?? model.id,
      promptPrice: null,
      completionPrice: null,
      contextLength: model.max_input_tokens ?? null,
      free: false,
      provider: "qoder",
      routable: true,
      enabled: model.is_enabled !== false,
      detail: describeQoderModel(model),
    }));

    const usable = models.filter((m) => m.enabled).length;

    return okSource(
      "qoder",
      models,
      `Qoder's agent model aliases — ${usable} of ${models.length} enabled on this account. Qoder publishes no endpoint that answers a completion request, so a routed Qoder id is served by the Agent SDK runtime, the same engine the assistant runs on. That is an agent turn rather than a completion: the runtime picks its own sampling, so the temperature and max-token fields on this row do not travel with it, and JSON is asked for in the prompt instead of enforced by the API. An account out of credit answers every alias with its own limit message.`
    );
  } catch (error) {
    console.error("getModelCatalogue (qoder) failed:", error);
    return failedSource("qoder", "unreachable", "Qoder did not answer.");
  }
}

/** Compact, provider-worded metadata line: pricing is relative, never USD. */
function describeQoderModel(model: {
  is_vl?: boolean;
  price_factor?: number;
  efforts?: string[];
  default_effort?: string;
  available_context_windows?: number[];
}): string | undefined {
  const parts: string[] = [];
  if (typeof model.price_factor === "number") parts.push(`${model.price_factor}× baseline price`);
  if (model.is_vl) parts.push("vision input");
  if (model.efforts?.length) {
    const efforts = [...model.efforts].sort().join("/");
    parts.push(`effort: ${efforts}${model.default_effort ? ` (default ${model.default_effort})` : ""}`);
  }
  if (model.available_context_windows?.length) {
    parts.push(`context ${model.available_context_windows.map((t) => `${Math.round(t / 1000)}k`).join("/")}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * NVIDIA's model list is public — it answers without a key — so the picker is
 * never blank simply because nobody has signed up yet. What a missing key does
 * decide is whether a chosen id can actually be called, and the note says so
 * instead of an empty group implying a broken integration.
 */
async function fetchNvidiaModels(): Promise<SourceResult> {
  const key = await resolveSecret("nvidia_nim");

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: {
        Accept: "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = (await response.json()) as {
      data?: { id: string; owned_by?: string }[];
    };

    // The list is flat and carries no capability field, so embedding, retrieval
    // and image endpoints are removed by name. Anything else an account cannot
    // serve reports itself from the gateway: NVIDIA answers a retired id with
    // HTTP 410, which `describeNvidiaFailure` spells out in the routing log.
    const models: ModelOption[] = (payload.data ?? [])
      .filter((model) => !/embed|rerank|retriever|diffusion|deplot|cosmos/i.test(model.id))
      .map((model) => ({
        id: `nvidia:${model.id}`,
        name: model.id,
        promptPrice: null,
        completionPrice: null,
        contextLength: null,
        free: false,
        provider: "nvidia_nim",
        routable: true,
        detail: model.owned_by ? `by ${model.owned_by}` : undefined,
      }));

    return okSource(
      "nvidia_nim",
      models,
      key
        ? "NVIDIA publishes ids only — no prices, context sizes or display names — and the list still carries retired models, which answer HTTP 410 when routed. A free key allows roughly 40 requests a minute."
        : "NVIDIA's list is public, so these are shown without a key, but none of them can be routed until a key is stored under API keys. A free one needs phone verification and no card."
    );
  } catch (error) {
    console.error("getModelCatalogue (nvidia) failed:", error);
    return failedSource("nvidia_nim", "unreachable", "NVIDIA did not answer.");
  }
}

/**
 * Cloudflare's catalogue is account-scoped and behind its API, so unlike
 * NVIDIA's public list this one needs the token *and* the Account ID before it
 * will answer.
 */
async function fetchCloudflareModels(): Promise<SourceResult> {
  const [key, config] = await Promise.all([
    resolveSecret("cloudflare_workers_ai"),
    resolveConfig("cloudflare_workers_ai"),
  ]);
  const accountId =
    String(config.account_id ?? "").trim() || aiConfig.cloudflareWorkersAi.accountId;

  if (!key || !accountId) {
    return failedSource(
      "cloudflare_workers_ai",
      "no_key",
      !key
        ? "No Workers AI token stored — add one under API keys to list Cloudflare's models."
        : "Cloudflare lists its models per account, so the Account ID field is required as well as the token."
    );
  }

  type Row = {
    /** An opaque UUID. Not the addressable model name — see `name`. */
    id?: string;
    name?: string;
    description?: string;
    task?: { id?: string; name?: string };
  };

  try {
    const rows: Row[] = [];
    const perPage = 100;

    for (let page = 1; page <= 8; page += 1) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=${perPage}&page=${page}`,
        {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (response.status === 401 || response.status === 403) {
        return failedSource(
          "cloudflare_workers_ai",
          "unauthorized",
          `Cloudflare rejected the stored token (HTTP ${response.status}). It needs Workers AI read access on this account.`
        );
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as {
        success?: boolean;
        errors?: { message?: string }[];
        result?: unknown;
      };
      if (payload.success === false) {
        throw new Error(payload.errors?.[0]?.message ?? "Cloudflare refused the request");
      }

      // Confirmed live: `result` is the page as a bare array, and `success`
      // carries the auth verdict even when HTTP itself says 200.
      const items = Array.isArray(payload.result) ? (payload.result as Row[]) : [];
      rows.push(...items);
      if (items.length < perPage) break;
    }

    if (rows.length === 0) {
      return failedSource(
        "cloudflare_workers_ai",
        "unreachable",
        "Cloudflare answered but returned no models for this account — check the token's Workers AI permission."
      );
    }

    const models: ModelOption[] = rows
      .filter((row) => isCloudflareChatModel(row) && String(row.name).startsWith("@cf/"))
      .map((row) => {
        const modelId = String(row.name).trim();
        return {
          // Qualified for the routing table, which has no provider column:
          // `@cf/…` is namespaced the way an OpenRouter id is, so an unqualified
          // one would quietly be billed to OpenRouter.
          id: `cloudflare:${modelId}`,
          name: modelId,
          promptPrice: null,
          completionPrice: null,
          contextLength: null,
          // Not tagged free: the account gets a daily neuron allowance, not a set
          // of no-cost models, and this list carries no pricing to tell them apart.
          free: false,
          provider: "cloudflare_workers_ai",
          routable: true,
          detail: row.description?.slice(0, 160),
        } satisfies ModelOption;
      });

    return okSource(
      "cloudflare_workers_ai",
      models,
      "Cloudflare lists models per account, and its account list carries names and descriptions only — no prices or context sizes. The free allowance is 10,000 neurons a day, which measures work per token rather than requests, so the day a routing table exhausts it depends on how long the prompts are."
    );
  } catch (error) {
    console.error("getModelCatalogue (cloudflare) failed:", error);
    return failedSource(
      "cloudflare_workers_ai",
      "unreachable",
      "Cloudflare did not answer — the account may not have Workers AI enabled."
    );
  }
}

/**
 * Only models that answer a chat request belong in a routing table, and
 * Cloudflare's list is a task catalogue: alongside text generation it carries
 * embeddings, classification, image and speech models, each labelled with a
 * UUID that means nothing here, so the human-readable task name is the signal.
 */
function isCloudflareChatModel(row: { task?: { name?: string } }): boolean {
  return /text[ _/-]?generation|llm|\bchat\b/i.test(row.task?.name ?? "");
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