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
  /** The provider stopped at its output cap, so `content` is cut off mid-answer. */
  truncated: boolean;
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
): Promise<{ content: string; truncated: boolean }> {
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
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new Error(`OpenRouter ${model} returned an empty completion`);
  }
  return { content, truncated: choice?.finish_reason === "length" };
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

/**
 * True for ids that only Google's own endpoint serves — the ids its catalogue
 * lists without a `models/` prefix: `gemini-2.5-flash`, `gemma-4-31b-it`,
 * `nano-banana-pro-preview`, and the rest.
 *
 * Every OpenRouter id is namespaced (`google/gemini-flash-1.5`), so the slash is
 * what tells the two apart — and it means a routing row written for OpenRouter
 * keeps going down exactly the same path it always did.
 */
function isGoogleNativeModel(model: string): boolean {
  return !model.includes("/");
}

async function callGoogleAiStudio(
  request: CompletionRequest,
  signal: AbortSignal,
  apiKey: string,
  chain: readonly string[] = GOOGLE_MODEL_CHAIN
): Promise<{ content: string; model: string; truncated: boolean }> {
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

  for (const model of chain) {
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
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
    };
    const candidate = payload.candidates?.[0];
    const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!content || content.trim().length === 0) {
      throw new Error(`Google AI Studio ${model} returned an empty completion`);
    }
    return { content, model, truncated: candidate?.finishReason === "MAX_TOKENS" };
  }

  throw new Error(
    walkErrors.join(" | ") || lastError || "Google AI Studio: no available model responded"
  );
}

/**
 * Inline Gemini requests are capped at 20MB total, and base64 inflates the
 * payload by a third, so recordings above this are not worth attempting.
 */
const MAX_INLINE_MEDIA_BYTES = 14 * 1024 * 1024;

/** Raised when a recording can never be transcribed in-line — a human must review it. */
export class RecordingNotTranscribableError extends Error {}

/**
 * Speech-to-text for a candidate's pitch recording.
 *
 * Goes straight to Gemini rather than through `complete()`: it is the only
 * provider in this stack that accepts audio, and the OpenRouter hops would
 * spend daily quota on requests that cannot succeed. The same model chain is
 * walked so a retired or overloaded id never breaks the transcript.
 */
export async function transcribeRecording(
  bytes: Uint8Array,
  mimeType: string
): Promise<string> {
  if (bytes.byteLength > MAX_INLINE_MEDIA_BYTES) {
    throw new RecordingNotTranscribableError(
      `Recording is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, above the ${
        MAX_INLINE_MEDIA_BYTES / 1024 / 1024
      }MB limit for automatic transcription.`
    );
  }

  const apiKey = await resolveSecret("google_ai_studio");
  if (!apiKey) {
    throw new RecordingNotTranscribableError(
      "No Google AI Studio key is configured, which the transcription model needs."
    );
  }

  const data = Buffer.from(bytes).toString("base64");
  const walkErrors: string[] = [];

  for (const model of GOOGLE_MODEL_CHAIN) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiConfig.googleAiStudio.timeoutMs);
    try {
      const response = await fetch(
        `${aiConfig.googleAiStudio.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: "You are a precise speech-to-text transcriber. Output only what is said." }],
            },
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType, data } },
                  {
                    text:
                      "Transcribe everything said in this recording, verbatim, in the language " +
                      "spoken. If nobody speaks, reply with exactly NO_SPEECH.",
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0, maxOutputTokens: 2000 },
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const message = `Transcription ${model} HTTP ${response.status}: ${text.slice(0, 200)}`;
        if (GOOGLE_WALK_STATUSES.has(response.status)) {
          walkErrors.push(message);
          continue;
        }
        throw new Error(message);
      }

      const payload = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const transcript = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!transcript || transcript.toUpperCase().includes("NO_SPEECH")) return "";
      return transcript;
    } catch (error) {
      if (error instanceof RecordingNotTranscribableError) throw error;
      walkErrors.push(error instanceof Error ? error.message : "unknown error");
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    walkErrors.join(" | ") || "Transcription failed: no available model responded"
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

  // Walk the chain in the order the routing table asks for it and send each id to
  // the provider that publishes it. Sweeping every OpenRouter id first would let a
  // leftover OpenRouter fallback answer before a Google model set as primary — so
  // a choice made in the console would still silently never take effect.
  for (const model of chain) {
    if (isGoogleNativeModel(model)) {
      if (!googleKey) {
        attempts.push({
          model,
          ok: false,
          error: "no Google AI Studio key configured",
          credential: "google",
        });
        continue;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), aiConfig.googleAiStudio.timeoutMs);
      try {
        const result = await callGoogleAiStudio(effective, controller.signal, googleKey, [model]);
        clearTimeout(timeout);
        attempts.push({ model: result.model, ok: true, credential: "google" });
        return {
          content: result.content,
          model: result.model,
          provider: "google",
          attempts,
          truncated: result.truncated,
        };
      } catch (error) {
        clearTimeout(timeout);
        attempts.push({
          model,
          ok: false,
          error: error instanceof Error ? error.message : "unknown error",
          credential: "google",
        });
      }
      continue;
    }

    for (const credential of credentials) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), aiConfig.openRouter.timeoutMs);
      try {
        const reply = await callOpenRouter(model, effective, controller.signal, credential.secret);
        clearTimeout(timeout);
        attempts.push({ model, ok: true, credential: credential.secretHint });
        return {
          content: reply.content,
          model,
          provider: "openrouter",
          attempts,
          truncated: reply.truncated,
        };
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

  // Final fallback: Google's compiled-in chain, minus any id just tried.
  if (!googleKey) {
    throw new AiGatewayError(
      `All AI providers failed for capability "${request.capability}": ${attempts
        .map((a) => `${a.model}: ${a.error ?? "ok"}`)
        .join(" | ")}`,
      attempts
    );
  }

  const remaining = GOOGLE_MODEL_CHAIN.filter((id) => !chain.includes(id));
  if (remaining.length > 0) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiConfig.googleAiStudio.timeoutMs);
    try {
      const result = await callGoogleAiStudio(effective, controller.signal, googleKey, remaining);
      clearTimeout(timeout);
      attempts.push({ model: result.model, ok: true, credential: "google" });
      return {
        content: result.content,
        model: result.model,
        provider: "google",
        attempts,
        truncated: result.truncated,
      };
    } catch (error) {
      clearTimeout(timeout);
      attempts.push({
        model: "google-ai-studio",
        ok: false,
        error: error instanceof Error ? error.message : "unknown error",
        credential: "google",
      });
    }
  }

  throw new AiGatewayError(
    `All AI providers failed for capability "${request.capability}": ${attempts
      .map((a) => `${a.model}: ${a.error ?? "ok"}`)
      .join(" | ")}`,
    attempts
  );
}

/** Raised when a model's reply ends before the JSON it was writing is complete. */
export class TruncatedJsonResponseError extends Error {}

/**
 * The first balanced JSON value in a reply, or null when it never closes.
 *
 * Scanning (rather than slicing to the last brace) is what separates a reply
 * that simply has prose around it from one that was cut off mid-write.
 */
function balancedJsonRegion(text: string, open: number): string | null {
  const expected: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = open; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      expected.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      if (expected[expected.length - 1] !== char) return null;
      expected.pop();
      if (expected.length === 0) return text.slice(open, i + 1);
    }
  }

  return null;
}

/** Extracts the first JSON object/array from a model response. */
export function parseJsonResponse<T>(
  raw: string,
  options: { truncated?: boolean } = {}
): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");

  const region = balancedJsonRegion(candidate, start);
  if (region === null) {
    throw new TruncatedJsonResponseError(
      options.truncated
        ? "The grading model hit its output limit while writing its verdict, so the answer arrived cut off."
        : `The grading model's reply ended in the middle of its JSON (${
            candidate.length - start
          } characters, unparsed).`
    );
  }

  try {
    return JSON.parse(region) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Model returned malformed JSON: ${reason.slice(0, 120)}`);
  }
}
