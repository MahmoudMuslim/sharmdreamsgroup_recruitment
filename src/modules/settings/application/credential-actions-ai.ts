"use server";

import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { resolveSecret, resolveConfig, resolveModelRouting } from "@/modules/settings/infrastructure/credentialResolver";
import { aiConfig } from "@/lib/config.server";
import { AI_CAPABILITIES } from "@/modules/settings/domain/providers";
import { ROUTING_PROVIDER_NAMES, probeCaveat } from "@/modules/settings/domain/modelRouting";
import {
  complete,
  AiGatewayError,
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
  cloudflare_workers_ai: "Cloudflare Workers AI",
  nvidia_nim: "NVIDIA NIM",
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

    if (provider === "cloudflare_workers_ai") {
      // Every Workers AI call is addressed to an account, so a token alone has
      // nothing to call. The account-scoped model search is the cheapest request
      // that proves the token, and it is the same call the catalogue makes.
      const config = await resolveConfig("cloudflare_workers_ai");
      const accountId =
        String(config.account_id ?? "").trim() || aiConfig.cloudflareWorkersAi.accountId;
      if (!accountId) {
        return {
          provider,
          displayName,
          ok: false,
          status: "incomplete",
          latencyMs: Date.now() - started,
          detail:
            "A token is stored but no Account ID is set. Cloudflare addresses every Workers AI call to an account, so fill the Account ID field as well.",
        };
      }

      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=1`,
        { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
      );
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        errors?: { code?: number; message?: string }[];
        result?: unknown;
      };
      const latencyMs = Date.now() - started;
      const errorMessage = body.errors?.[0]?.message ?? `HTTP ${res.status}`;

      // Cloudflare reports a bad token as HTTP 400 with an auth message rather
      // than 401, so the text is what distinguishes a mistyped token from an
      // account that has no Workers AI access.
      if (!res.ok || body.success === false) {
        return {
          provider,
          displayName,
          ok: false,
          status: `HTTP ${res.status}`,
          latencyMs,
          detail: /authentication|auth/i.test(errorMessage)
            ? `Token rejected by Cloudflare (${errorMessage}). It must be scoped to Workers AI and to this account.`
            : errorMessage,
        };
      }

      return {
        provider,
        displayName,
        ok: true,
        status: "authenticated",
        latencyMs,
        detail: "Token valid for this account's Workers AI catalogue. The free allowance is 10,000 neurons a day.",
      };
    }

    if (provider === "nvidia_nim") {
      // NVIDIA's model list is public — an invalid key still returns HTTP 200 —
      // so nothing short of a completion proves the key. This posts the probe
      // prompt for a few tokens against ids taken from that list.
      const candidates = await pickNvidiaProbeModels();
      if (candidates.length === 0) {
        return {
          provider,
          displayName,
          ok: false,
          status: "unreachable",
          latencyMs: Date.now() - started,
          detail: "NVIDIA's model list did not load, so the key could not be probed.",
        };
      }

      // The candidates are probed at once, not one after another. NVIDIA's list
      // mixes chat models that answer in a couple of seconds with reasoning
      // models that can spend half a minute on their first token, and a serial
      // loop spent the whole panel budget waiting on the slowest model it
      // happened to start with — reporting a timeout instead of the key's state.
      const probes = await Promise.all(
        candidates.map(async (model) => {
          try {
            const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ model, messages: PROBE_PROMPT, max_tokens: 64 }),
              signal: AbortSignal.timeout(9_000),
            });
            const body = (await res.json().catch(() => ({}))) as {
              choices?: { message?: { content?: string; reasoning_content?: string } }[];
            };
            return {
              model,
              status: res.status,
              content: (body.choices?.[0]?.message?.content ?? "").trim(),
              reasoned: Boolean(body.choices?.[0]?.message?.reasoning_content),
            };
          } catch {
            // A model that never answered is that model's result, not the probe's
            // failure — it must not abort the other two.
            return { model, status: 0, content: "", reasoned: false };
          }
        })
      );

      if (probes.some((probe) => probe.status === 401 || probe.status === 403)) {
        return {
          provider,
          displayName,
          ok: false,
          status: "key rejected",
          latencyMs: Date.now() - started,
          detail:
            "Key rejected by NVIDIA — revoked, expired, or mistyped. A free key needs phone verification at build.nvidia.com.",
        };
      }

      const answered = probes.find((probe) => probe.status >= 200 && probe.status < 300 && probe.content);
      if (answered) {
        return {
          provider,
          displayName,
          ok: true,
          status: "responded",
          latencyMs: Date.now() - started,
          detail: `Key valid. ${answered.model} replied “${excerpt(answered.content, 24)}”.`,
        };
      }

      // HTTP 200 with no text still passed authentication, and it is the normal
      // answer from a reasoning model whose whole probe budget went into its
      // chain of thought — reported as the key check it is, not as a model that
      // refused.
      const authenticated = probes.find((probe) => probe.status >= 200 && probe.status < 300);
      if (authenticated) {
        return {
          provider,
          displayName,
          ok: true,
          status: "authenticated",
          latencyMs: Date.now() - started,
          detail: `Key valid. ${authenticated.model} returned no text within the probe budget${
            authenticated.reasoned ? " (it spent it on reasoning)" : ""
          }.`,
        };
      }

      if (probes.some((probe) => probe.status === 429)) {
        return {
          provider,
          displayName,
          ok: false,
          status: "throttled",
          latencyMs: Date.now() - started,
          detail:
            "NVIDIA throttled the probe (a free key allows roughly 40 requests a minute), so it cannot confirm the key yet. Try again in a minute.",
        };
      }

      return {
        provider,
        displayName,
        ok: false,
        status: "no probe model answered",
        latencyMs: Date.now() - started,
        // Only the model and its outcome: NVIDIA's own text for an unavailable id
        // names the internal function id and the account hash behind the key,
        // which has no business being shown in this panel.
        detail: `${probes.map((probe) => `${probe.model} → ${describeNvidiaProbe(probe)}`).join(" | ")} — the key was never refused outright, so this says the probe models are unavailable, not that the key is bad. Test a capability in the routing console to check the key against a model you actually route to.`,
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

/**
 * Ids to probe a NVIDIA key against, taken from its public list so the check
 * never depends on an id chosen by an admin.
 *
 * The list is alphabetical and names far more models than any one key is served:
 * third-party ids answer HTTP 404 for a free account, retired ones answer 410,
 * and reasoning models can spend longer than a health check may wait. NVIDIA's
 * own Nemotron endpoints are what the free tier actually serves, and the lighter
 * of them answer in a second or two, so they are tried first — with the rest of
 * the list behind them so an account entitled to other models still gets probed.
 */
const NVIDIA_PROBE_PREFERENCE: RegExp[] = [
  /^nvidia\/nemotron-3\.5-lightning/i,
  /^nvidia\/nemotron-3-super/i,
  /^nvidia\/nemotron-3-ultra/i,
  /^nvidia\/nemotron/i,
  /^openai\/gpt-oss/i,
];

function describeNvidiaProbe(probe: { status: number }): string {
  if (probe.status === 0) return "no answer within the probe budget";
  if (probe.status === 404) return "not served to this account (HTTP 404)";
  if (probe.status === 410) return "retired by NVIDIA (HTTP 410)";
  if (probe.status === 429) return "throttled (HTTP 429)";
  if (probe.status === 503) return "temporarily unavailable (HTTP 503)";
  return `HTTP ${probe.status}`;
}

async function pickNvidiaProbeModels(): Promise<string[]> {
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { data?: { id: string }[] };
    const ids = (body.data ?? [])
      .map((model) => model.id)
      .filter((id) => !/embed|rerank|retriever|diffusion|deplot|cosmos|guard|safety|reward|parse|translate|clip|vila|neva|kosmos|fuyu/i.test(id));
    const rank = (id: string) => {
      const index = NVIDIA_PROBE_PREFERENCE.findIndex((pattern) => pattern.test(id));
      return index === -1 ? NVIDIA_PROBE_PREFERENCE.length : index;
    };
    return [...ids].sort((a, b) => rank(a) - rank(b)).slice(0, 4);
  } catch {
    return [];
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

function withCaveat(result: ChainTestResult, capability: string): ChainTestResult {
  const caveat = probeCaveat(capability);
  return caveat ? { ...result, detail: `${result.detail} · ${caveat}` } : result;
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
      detail: "Saved models are disabled. Runtime calls still use built-in models; this saved-chain probe was not run.",
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
    const answered =
      failures.length > 0
        ? `${excerpt(result.content)} · ${failures.length} hop(s) failed first: ${excerpt(
            failures.map((f) => `${f.model}: ${f.error ?? "failed"}`).join(" | "),
            180
          )}`
        : excerpt(result.content);

    return withCaveat(
      {
        capability,
        label,
        ok: true,
        status: "responded",
        latencyMs: Date.now() - started,
        detail: answered,
        servedBy: `${result.model} (${ROUTING_PROVIDER_NAMES[result.provider]})`,
      },
      capability
    );
  } catch (error) {
    if (error instanceof AiGatewayError) {
      return withCaveat(
        reportFailure(
          capability,
          label,
          started,
          error.attempts.map((a) => `${a.model}: ${a.error ?? "ok"}`)
        ),
        capability
      );
    }
    return withCaveat(
      reportFailure(capability, label, started, [
        error instanceof Error ? error.message : "unknown error",
      ]),
      capability
    );
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
    testProvider("cloudflare_workers_ai"),
    testProvider("nvidia_nim"),
  ]);
}