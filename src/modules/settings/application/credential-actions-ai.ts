"use server";

import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { resolveSecret, resolveModelRouting } from "@/modules/settings/infrastructure/credentialResolver";
import { AI_CAPABILITIES } from "@/modules/settings/domain/providers";
import {
  complete,
  AiGatewayError,
  type GatewayProvider,
} from "@/modules/screening/infrastructure/aiGateway";
import type { AiCapability } from "@/lib/config";
import type { ChatCompletionMessage } from "@/types";

/**
 * Live AI provider diagnostics.
 *
 * Runs a real, minimal completion against each provider and reports what came
 * back. Deliberately cheap (a few tokens, short timeout) so it is safe to run
 * from the settings screen — this is a health check, not an evaluation.
 *
 * No secret is ever returned; results carry only status, latency and a short
 * excerpt of the model's own reply.
 */

export interface ProviderTestResult {
  provider: string;
  displayName: string;
  ok: boolean;
  /** HTTP status or error class, for diagnosis. */
  status: string;
  latencyMs: number;
  /** First few words the model returned, or the error text. */
  detail: string;
}

export interface ChainTestResult {
  capability: string;
  label: string;
  ok: boolean;
  status: string;
  latencyMs: number;
  detail: string;
  /** Model that actually answered. */
  servedBy?: string;
}

const PROBE_PROMPT: ChatCompletionMessage[] = [
  { role: "system", content: "You are a connectivity probe. Reply with exactly: AI_OK" },
  { role: "user", content: "Reply with AI_OK and nothing else." },
];

function excerpt(text: string, max = 60): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

const PROVIDER_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  google_ai_studio: "Google AI Studio",
  opencode: "OpenCode",
  qoder: "Qoder",
};

/** The gateway's own provider keys, spelled for the test result's provenance line. */
const GATEWAY_PROVIDER_NAMES: Record<GatewayProvider, string> = {
  openrouter: "OpenRouter",
  google: "Google AI Studio",
  opencode: "OpenCode",
  qoder: "Qoder",
};

/** Tests one provider's credential with a real API call. */
export async function testProvider(provider: string): Promise<ProviderTestResult> {
  await requireStaff("/settings");

  const displayName = PROVIDER_NAMES[provider] ?? provider;

  const key = await resolveSecret(provider);
  if (!key) {
    return {
      provider,
      displayName,
      ok: false,
      status: "not configured",
      latencyMs: 0,
      detail: "No key stored and no environment variable set.",
    };
  }

  const started = Date.now();

  try {
    if (provider === "openrouter") {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { total_credits?: number; total_usage?: number };
        error?: { message?: string };
      };
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        const message = body.error?.message ?? `HTTP ${res.status}`;
        return {
          provider,
          displayName,
          ok: false,
          status: `HTTP ${res.status}`,
          latencyMs,
          // OpenRouter returns the same "User not found" for a revoked key, a
          // deleted account and a well-formed-but-invalid key, so the message
          // must not claim a cause it cannot prove.
          detail:
            message === "User not found."
              ? "Key not accepted by OpenRouter — revoked, expired, or from a deleted account. Generate a new key."
              : message,
        };
      }

      const total = body.data?.total_credits ?? 0;
      const used = body.data?.total_usage ?? 0;
      return {
        provider,
        displayName,
        ok: true,
        status: "authenticated",
        latencyMs,
        detail: `Key valid. ${(total - used).toFixed(2)} credits remaining of ${total.toFixed(2)}.`,
      };
    }

    if (provider === "google_ai_studio") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      const body = (await res.json().catch(() => ({}))) as {
        models?: { name: string }[];
        error?: { message?: string };
      };
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        const message = body.error?.message ?? `HTTP ${res.status}`;
        return {
          provider,
          displayName,
          ok: false,
          status: `HTTP ${res.status}`,
          latencyMs,
          detail: message.includes("leaked")
            ? "Key flagged as leaked by Google and permanently blocked. Generate a new key in AI Studio."
            : message,
        };
      }

      const count = body.models?.length ?? 0;
      return {
        provider,
        displayName,
        ok: true,
        status: "authenticated",
        latencyMs,
        detail: `Key valid. ${count} model${count === 1 ? "" : "s"} available.`,
      };
    }

    if (provider === "opencode") {
      // `GET /inference/v1/models` is the only public-but-authenticated call:
      // it returns the full catalogue with a valid key and 401 with a bad one,
      // which makes it a cheap and precise key validator.
      const res = await fetch("https://opencode.ai/inference/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { id?: string }[];
        error?: { message?: string };
      };
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        return {
          provider,
          displayName,
          ok: false,
          status: `HTTP ${res.status}`,
          latencyMs,
          detail:
            res.status === 401 || res.status === 403
              ? "Key rejected by OpenCode — revoked, expired, or mistyped. Generate a new key in the console."
              : (body.error?.message ?? `HTTP ${res.status}`),
        };
      }

      const ids = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
      const freeCount = ids.filter((id) => id.endsWith("-free")).length;
      return {
        provider,
        displayName,
        ok: true,
        status: "authenticated",
        latencyMs,
        detail:
          ids.length > 0
            ? `Key valid. ${ids.length} models available (${freeCount} free). Free-tier models only run inside the OpenCode client — server calls need a paid model.`
            : "Key valid, but the model list came back empty.",
      };
    }

    if (provider === "qoder") {
      // Qoder Cloud Agents exposes the forward model catalogue behind a
      // personal access token (prefix `pt-`), so it doubles as a token check.
      const res = await fetch("https://api.qoder.com/api/v1/forward/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { id?: string; display_name?: string; is_enabled?: boolean }[];
        error?: { message?: string };
        message?: string;
      };
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        return {
          provider,
          displayName,
          ok: false,
          status: `HTTP ${res.status}`,
          latencyMs,
          detail:
            res.status === 401 || res.status === 403
              ? "Token rejected by Qoder — revoked, expired, or missing the required scope. Create a new personal access token."
              : (body.error?.message ?? body.message ?? `HTTP ${res.status}`),
        };
      }

      const models = body.data ?? [];
      const enabled = models.filter((m) => m.is_enabled !== false).length;
      return {
        provider,
        displayName,
        ok: true,
        status: "authenticated",
        latencyMs,
        detail:
          models.length > 0
            ? `Token valid. ${enabled} of ${models.length} model${models.length === 1 ? "" : "s"} enabled.`
            : "Token valid, but the model catalogue came back empty.",
      };
    }

    return {
      provider,
      displayName,
      ok: false,
      status: "not supported",
      latencyMs: Date.now() - started,
      detail: "No live test is implemented for this provider yet.",
    };
  } catch (error) {
    return {
      provider,
      displayName,
      ok: false,
      status: "network error",
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function reportFailure(
  capability: string,
  label: string,
  started: number,
  attempts: string[]
): ChainTestResult {
  return {
    capability,
    label,
    ok: false,
    status: "all models failed",
    latencyMs: Date.now() - started,
    // Clipped per hop, not once over the joined string: one provider that
    // explains itself at length would otherwise push every later hop — and the
    // reason the fallbacks failed too — off the end of the message.
    detail: attempts.map((a) => excerpt(a, 110)).join(" | ").slice(0, 420),
  };
}

/**
 * Runs a real completion through one capability's configured model chain.
 *
 * This is the gateway's own `complete()`, not a second copy of its logic: the
 * gateway owns the rule that decides which endpoint a routing id belongs to, and
 * probing the providers by hand here is how this screen came to report on a model
 * the admin never chose — a `qoder:` or `opencode:` id has no slash, so the old
 * check read it as a Google model and posted it to Google's endpoint. Testing the
 * real path is the only version that can keep agreeing with production.
 */
export async function testCapability(capability: string): Promise<ChainTestResult> {
  await requireStaff("/settings");

  const definition = AI_CAPABILITIES.find((c) => c.id === capability);
  if (!definition) {
    return {
      capability,
      label: capability,
      ok: false,
      status: "unknown capability",
      latencyMs: 0,
      detail: `No capability named "${capability}".`,
    };
  }

  const label = definition.label;
  const started = Date.now();

  const routing = await resolveModelRouting(capability);

  if (!routing.enabled) {
    return {
      capability,
      label,
      ok: false,
      status: "disabled",
      latencyMs: 0,
      detail: "This capability is switched off in Settings.",
    };
  }

  try {
    const result = await complete({
      capability: definition.id as AiCapability,
      messages: PROBE_PROMPT,
      temperature: routing.temperature,
      maxTokens: Math.min(routing.maxTokens, 64),
    });

    // A chain that recovered says as much: an early hop failing is the thing an
    // operator needs to see before the daily quota turns it into a mystery.
    const failures = result.attempts.filter((a) => !a.ok);

    return {
      capability,
      label,
      ok: true,
      status: "responded",
      latencyMs: Date.now() - started,
      detail:
        failures.length > 0
          ? `${excerpt(result.content)} · ${failures.length} hop(s) failed first: ${excerpt(
              failures.map((f) => `${f.model}: ${f.error ?? "failed"}`).join(" | "),
              180
            )}`
          : excerpt(result.content),
      servedBy: `${result.model} (${GATEWAY_PROVIDER_NAMES[result.provider]})`,
    };
  } catch (error) {
    if (error instanceof AiGatewayError) {
      return reportFailure(
        capability,
        label,
        started,
        error.attempts.map((a) => `${a.model}: ${a.error ?? "ok"}`)
      );
    }
    return reportFailure(capability, label, started, [
      error instanceof Error ? error.message : "unknown error",
    ]);
  }
}
/** Convenience: run every provider probe in one call for the console. */
export async function testAllProviders(): Promise<ProviderTestResult[]> {
  await requireStaff("/settings");
  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return [];
  }
  return Promise.all([
    testProvider("openrouter"),
    testProvider("google_ai_studio"),
    testProvider("opencode"),
    testProvider("qoder"),
  ]);
}