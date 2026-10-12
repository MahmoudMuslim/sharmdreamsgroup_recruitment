/**
 * AI Gateway — OpenRouter client with multi-model failover.
 * Walks the capability's model chain until a provider returns a valid
 * completion; each hop gets its own timeout. Falls back to the Google AI
 * Studio endpoint if OpenRouter fails entirely.
 */
import { aiConfig } from "@/lib/config.server";
import { modelChains, type AiCapability } from "@/lib/config";
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
  attempts: { model: string; ok: boolean; error?: string }[];
}

export class AiGatewayError extends Error {
  constructor(message: string, readonly attempts: { model: string; ok: boolean; error?: string }[]) {
    super(message);
    this.name = "AiGatewayError";
  }
}

async function callOpenRouter(
  model: string,
  request: CompletionRequest,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(aiConfig.openRouter.baseUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${aiConfig.openRouter.apiKey}`,
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

async function callGoogleAiStudio(
  request: CompletionRequest,
  signal: AbortSignal
): Promise<string> {
  if (!aiConfig.googleAiStudio.apiKey) {
    throw new Error("Google AI Studio key is not configured");
  }
  const systemPrompt = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const userPrompt = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");

  const response = await fetch(
    `${aiConfig.googleAiStudio.baseUrl}/models/gemini-2.0-flash:generateContent?key=${aiConfig.googleAiStudio.apiKey}`,
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
    throw new Error(`Google AI Studio HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!content || content.trim().length === 0) {
    throw new Error("Google AI Studio returned an empty completion");
  }
  return content;
}

export async function complete(request: CompletionRequest): Promise<CompletionResult> {
  const chain = modelChains[request.capability];
  const attempts: { model: string; ok: boolean; error?: string }[] = [];

  for (const model of chain) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiConfig.openRouter.timeoutMs);
    try {
      const content = await callOpenRouter(model, request, controller.signal);
      clearTimeout(timeout);
      attempts.push({ model, ok: true });
      return { content, model, provider: "openrouter", attempts };
    } catch (error) {
      clearTimeout(timeout);
      attempts.push({
        model,
        ok: false,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  // Final fallback: Google AI Studio.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiConfig.googleAiStudio.timeoutMs);
  try {
    const content = await callGoogleAiStudio(request, controller.signal);
    clearTimeout(timeout);
    attempts.push({ model: "gemini-2.0-flash", ok: true });
    return { content, model: "gemini-2.0-flash", provider: "google", attempts };
  } catch (error) {
    clearTimeout(timeout);
    attempts.push({
      model: "gemini-2.0-flash",
      ok: false,
      error: error instanceof Error ? error.message : "unknown error",
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
