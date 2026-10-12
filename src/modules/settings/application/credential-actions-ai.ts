"use server";

import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { resolveSecret, resolveModelRouting } from "@/modules/settings/infrastructure/credentialResolver";
import { AI_CAPABILITIES } from "@/modules/settings/domain/providers";

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

const PROBE_PROMPT = [
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

    // opencode — test credential with v2 API.
    const res = await fetch("https://opencode.ai/api/v2/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - started;
    const contentType = res.headers.get("content-type") ?? "";

    return {
      provider,
      displayName,
      ok: res.ok && contentType.includes("json"),
      status: `HTTP ${res.status}`,
      latencyMs,
      detail: res.ok
        ? contentType.includes("json")
          ? "Endpoint reachable and authenticated."
          : "Reached the host but it returned HTML — not an OpenAI-compatible API path."
        : "Endpoint unreachable or key rejected.",
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

/** Runs a real completion through one capability's configured model chain. */
export async function testCapability(capability: string): Promise<ChainTestResult> {
  await requireStaff("/settings");

  const definition = AI_CAPABILITIES.find((c) => c.id === capability);
  const label = definition?.label ?? capability;
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

  const openRouterKey = await resolveSecret("openrouter");
  const googleKey = await resolveSecret("google_ai_studio");

  if (!openRouterKey && !googleKey) {
    return {
      capability,
      label,
      ok: false,
      status: "no provider",
      latencyMs: 0,
      detail:
        "No AI key configured. Add one in Settings → API keys, or set OPENROUTER_API_KEY in the environment.",
    };
  }

  const attempts: string[] = [];
  const chain = [routing.primaryModel, routing.fallbackModel].filter(
    (m): m is string => Boolean(m)
  );

  if (openRouterKey) {
    for (const model of chain) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
            "X-Title": "Sharm Dreams Talent Cloud",
          },
          body: JSON.stringify({
            model,
            messages: PROBE_PROMPT,
            temperature: routing.temperature,
            max_tokens: Math.min(routing.maxTokens, 64),
          }),
          signal: AbortSignal.timeout(40_000),
        });

        const body = (await res.json().catch(() => ({}))) as {
          choices?: { message?: { content?: string } }[];
          error?: { message?: string };
        };

        const content = body.choices?.[0]?.message?.content;

        if (res.ok && content?.trim()) {
          return {
            capability,
            label,
            ok: true,
            status: "responded",
            latencyMs: Date.now() - started,
            detail: excerpt(content),
            servedBy: model,
          };
        }

        attempts.push(`${model}: ${body.error?.message ?? `HTTP ${res.status}`}`);
      } catch (error) {
        attempts.push(`${model}: ${error instanceof Error ? error.message : "network error"}`);
      }
    }
  }

  // Google fallback. Model ids are walked newest-first because Google retires
  // them without warning. gemini-3.8-flash is the id Google's own deprecation
  // notice points at; gemini-2.5-flash is no longer available to new accounts.
  const GOOGLE_CHAIN = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-2.0-flash"];

  if (googleKey) {
    for (const model of GOOGLE_CHAIN) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(googleKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: "You are a connectivity probe. Reply with exactly: AI_OK" }],
              },
              contents: [{ role: "user", parts: [{ text: "Reply with AI_OK and nothing else." }] }],
              generationConfig: {
                temperature: routing.temperature,
                maxOutputTokens: Math.min(routing.maxTokens, 64),
              },
            }),
            signal: AbortSignal.timeout(40_000),
          }
        );

        const body = (await res.json().catch(() => ({}))) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
          error?: { message?: string };
        };
        const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join("");

        if (res.ok && text?.trim()) {
          return {
            capability,
            label,
            ok: true,
            status: "responded",
            latencyMs: Date.now() - started,
            detail: excerpt(text),
            servedBy: `${model} (Google fallback)`,
          };
        }

        attempts.push(`${model}: ${body.error?.message ?? `HTTP ${res.status}`}`);

        // 403 means the key is blocked outright; other models will fail too.
        if (res.status === 403) break;
      } catch (error) {
        attempts.push(`${model}: ${error instanceof Error ? error.message : "network error"}`);
      }
    }
  }

  return {
    capability,
    label,
    ok: false,
    status: "all models failed",
    latencyMs: Date.now() - started,
    detail: excerpt(attempts.join(" | "), 220),
  };
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
  ]);
}