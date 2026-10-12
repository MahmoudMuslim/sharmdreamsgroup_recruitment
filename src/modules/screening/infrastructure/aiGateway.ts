/**
 * AI Gateway — OpenRouter client with multi-model and multi-key failover.
 * 
 * Walks the capability's model chain AND credential chain until a provider 
 * returns a valid completion. Each hop gets its own timeout. Falls back to 
 * the Google AI Studio endpoint if OpenRouter fails entirely.
 *
 * Credentials and model routing are resolved per request from the encrypted
 * store first, falling back to the compiled-in environment variables. That is
 * what makes the Settings → API keys panel authoritative rather than cosmetic.
 */
import { aiConfig } from "@/lib/config.server";
import { modelChains, type AiCapability } from "@/lib/config";
import {
  resolveCredentials,
  resolveSecret,
  resolveModelRouting,
} from "@/modules/settings/infrastructure/credentialResolver";
import type { ChatCompletionMessage, ChatCompletionResponse } from "@/types";

export interface CompletionRequest {
  capability: AiCapability;
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface CompletionResult {
  content: string;
  model: string;
  provider: "openrouter" | "google";
  attempts: { model: string; ok: boolean; error?: string; credential?: string }[];
}

export class AiGatewayError extends Error {
  constructor(message: string, readonly attempts: { model: string; ok: boolean; error?: string; credential?: string }[]) {
    super(message);
    this.name = "AiGatewayError";
  }
}

async function callOpenRouter(
  model: string,
  request: CompletionRequest,
  signal: AbortSignal,
  apiKey: string
): Promise<string> {
  const response = await fetch(aiConfig.openRouter.baseUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://sharmdreams.com",
      "X-Title": "Sharm Dreams Talent Cloud",
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
      ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${model} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  if (payload.error) {
    throw new Error(`OpenRouter ${model}: ${payload.error.message}`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new Error(`OpenRouter ${model} returned an empty completion`);
  }
  return content;
}

/**
 * Google AI Studio model ids, newest first.
 *
 * Walked in order so no single entry can break the fallback path: retired ids
 * (e.g. `gemini-2.0-flash`, and `gemini-2.5-flash` for newer accounts) 404 and
 * the next one is tried. Google's per-model load also flaps — observed live,
 * 3.8/3.7 returning 503 while 3.6/3.5 answered — so transient errors walk too
 * rather than failing the screening.
 */
const GOOGLE_MODEL_CHAIN = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
] as const;

/** "This model can't serve you right now" — try the next id instead of giving up. */
const GOOGLE_WALK_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

async function callGoogleAiStudio(
  request: CompletionRequest,
  signal: AbortSignal,
  apiKey: string
): Promise<{ content: string; model: string }> {
  const systemPrompt = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const userPrompt = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");

  let lastError = "";
  const walkErrors: string[] = [];

  for (const model of GOOGLE_MODEL_CHAIN) {
    const response = await fetch(
      `${aiConfig.googleAiStudio.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxTokens ?? 2048,
            ...(request.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      lastError = `Google AI Studio ${model} HTTP ${response.status}: ${text.slice(0, 200)}`;

      // A 403 means the key itself is blocked (e.g. reported as leaked).
      // Retrying other models cannot help, so surface it immediately.
      if (response.status === 403) {
        throw new Error(
          "Google AI Studio rejected the API key (HTTP 403). This is almost always a key " +
            "flagged as leaked — generate a new one in AI Studio."
        );
      }

      // Retired ids and per-model capacity errors: record and move on.
      if (GOOGLE_WALK_STATUSES.has(response.status)) {
        walkErrors.push(lastError);
        continue;
      }

      throw new Error(lastError);
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!content || content.trim().length === 0) {
      throw new Error(`Google AI Studio ${model} returned an empty completion`);
    }
    return { content, model };
  }

  throw new Error(
    walkErrors.join(" | ") || lastError || "Google AI Studio: no available model responded"
  );
}

export async function complete(request: CompletionRequest): Promise<CompletionResult> {
  const attempts: { model: string; ok: boolean; error?: string; credential?: string }[] = [];

  // Settings win over the environment; both are optional.
  const [credentials, googleKey, routing] = await Promise.all([
    resolveCredentials("openrouter"),
    resolveSecret("google_ai_studio"),
    resolveModelRouting(request.capability),
  ]);

  if (credentials.length === 0 && !googleKey) {
    throw new AiGatewayError(
      "No AI provider is configured. Add an OpenRouter key in Settings → API keys, " +
        "or set OPENROUTER_API_KEY in the environment.",
      attempts
    );
  }

  // Chain: the capability's configured primary + fallback, then the compiled-in
  // defaults as a last resort.
  const chain = [
    ...(routing.enabled ? [routing.primaryModel, routing.fallbackModel] : []),
    ...modelChains[request.capability],
  ].filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i);

  const effective: CompletionRequest = {
    ...request,
    temperature: request.temperature ?? routing.temperature,
    maxTokens: request.maxTokens ?? routing.maxTokens,
  };

  // Try OpenRouter with each credential (by priority) and each model
  for (const credential of credentials) {
    for (const model of chain) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), aiConfig.openRouter.timeoutMs);
      try {
        const content = await callOpenRouter(model, effective, controller.signal, credential.secret);
        clearTimeout(timeout);
        attempts.push({ model, ok: true, credential: credential.secretHint });
        return { content, model, provider: "openrouter", attempts };
      } catch (error) {
        clearTimeout(timeout);
        attempts.push({
          model,
          ok: false,
          error: error instanceof Error ? error.message : "unknown error",
          credential: credential.secretHint,
        });
      }
    }
  }

  // Final fallback: Google AI Studio.
  if (!googleKey) {
    throw new AiGatewayError(
      `All AI providers failed for capability "${request.capability}": ${attempts
        .map((a) => `${a.model}: ${a.error ?? "ok"}`)
        .join(" | ")}`,
      attempts
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiConfig.googleAiStudio.timeoutMs);
  try {
    const result = await callGoogleAiStudio(effective, controller.signal, googleKey);
    clearTimeout(timeout);
    attempts.push({ model: result.model, ok: true, credential: "google" });
    return { content: result.content, model: result.model, provider: "google", attempts };
  } catch (error) {
    clearTimeout(timeout);
    attempts.push({
      model: "google-ai-studio",
      ok: false,
      error: error instanceof Error ? error.message : "unknown error",
      credential: "google",
    });
  }

  throw new AiGatewayError(
    `All AI providers failed for capability "${request.capability}": ${attempts
      .map((a) => `${a.model}: ${a.error ?? "ok"}`)
      .join(" | ")}`,
    attempts
  );
}

/** Extracts the first JSON object/array from a model response. */
export function parseJsonResponse<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  const jsonSlice = candidate.slice(start, end + 1);
  return JSON.parse(jsonSlice) as T;
}
