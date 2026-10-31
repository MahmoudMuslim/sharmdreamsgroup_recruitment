/**
 * AI Gateway — multi-provider client with model and key failover.
 * 
 * Walks the capability's model chain AND credential chain until a provider 
 * returns a valid completion. Each hop gets its own timeout. Falls back to 
 * the Google AI Studio endpoint if OpenRouter fails entirely.
 *
 * Credentials and model routing are resolved per request from the encrypted
 * store first, falling back to the compiled-in environment variables. That is
 * what makes the Settings → API keys panel authoritative rather than cosmetic.
 *
 * Which provider serves a hop is decided by the model id itself: a routing row
 * carries no provider column, so an id prefixed `opencode:` or `qoder:` names
 * its provider explicitly, and everything else keeps the long-standing split
 * between OpenRouter's namespaced ids and Google's bare ones. That rule, the
 * Google chain it walks, and the fallback the table answers with all live in
 * `settings/domain/modelRouting.ts`, because the Settings console has to read
 * the same rule the gateway dispatches on.
 */
import { aiConfig } from "@/lib/config.server";
import { modelChains, type AiCapability } from "@/lib/config";
import {
  GOOGLE_MODEL_CHAIN,
  GOOGLE_WALK_STATUSES,
  TRANSCRIPTION_CAPABILITY,
  transcriptionChain,
  routeFor,
  type GatewayProvider,
} from "@/modules/settings/domain/modelRouting";
import {
  resolveCredentials,
  resolveSecret,
  resolveModelRouting,
} from "@/modules/settings/infrastructure/credentialResolver";
import {
  callQoderCompletion,
  QODER_COMPLETION_TIMEOUT_MS,
} from "@/modules/screening/infrastructure/qoderCompletion";
import type { ChatCompletionMessage, ChatCompletionResponse } from "@/types";

export interface CompletionRequest {
  capability: AiCapability;
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /**
   * One model, tried for this call alone, chosen by the person asking rather
   * than by the routing table. Nothing else is tried and the compiled-in chain
   * is skipped: a model picked on purpose has to report its own failure rather
   * than answer quietly from the default behind the picker.
   */
  modelOverride?: string;
}

export interface CompletionResult {
  content: string;
  model: string;
  provider: GatewayProvider;
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
 * OpenCode speaks the OpenAI wire format, so the request is the same body
 * OpenRouter gets — minus `response_format`. OpenCode documents no JSON mode and
 * a parameter it rejects would drop the hop, while `parseJsonResponse` already
 * recovers the first balanced JSON value from a reply that carries prose.
 */
async function callOpenCode(
  model: string,
  request: CompletionRequest,
  signal: AbortSignal,
  apiKey: string
): Promise<{ content: string; truncated: boolean }> {
  const response = await fetch(aiConfig.openCode.baseUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenCode ${model} ${describeOpenCodeFailure(response.status, text)}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  if (payload.error) {
    throw new Error(`OpenCode ${model}: ${payload.error.message}`);
  }
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new Error(`OpenCode ${model} returned an empty completion`);
  }
  return { content, truncated: choice?.finish_reason === "length" };
}

/**
 * OpenCode's two rejections both say something the operator can act on, and
 * neither is a code fault: its free tier answers only inside the OpenCode
 * client, and a paid model on an account without credit fails at the upstream.
 * The provider's own wording is kept; only the explanation is added.
 */
function describeOpenCodeFailure(status: number, body: string): string {
  let message = body.slice(0, 200);
  let type = "";
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } };
    message = parsed.error?.message ?? message;
    type = parsed.error?.type ?? "";
  } catch {
    // Not JSON — report what came back.
  }

  if (status === 403 && type === "FreeTierError") {
    return `HTTP 403: ${message} This id is on OpenCode's free tier, which its client alone may call; route a paid model id for server-side work.`;
  }
  if (status === 402) {
    return `HTTP 402: ${message} The OpenCode account behind this key has no credit, so every paid model answers the same way.`;
  }
  return `HTTP ${status}: ${message}`;
}

/**
 * NVIDIA's hosted inference API is OpenAI-compatible, so the body is the one
 * OpenRouter gets — minus `response_format`, which NVIDIA does not document and
 * a parameter it rejects would drop a hop `parseJsonResponse` could otherwise
 * have recovered.
 */
async function callNvidiaNim(
  model: string,
  request: CompletionRequest,
  signal: AbortSignal,
  apiKey: string
): Promise<{ content: string; truncated: boolean }> {
  const response = await fetch(aiConfig.nvidiaNim.baseUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`NVIDIA ${model} ${describeNvidiaFailure(response.status, text)}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  if (payload.error) {
    throw new Error(`NVIDIA ${model}: ${payload.error.message}`);
  }
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new Error(`NVIDIA ${model} returned an empty completion`);
  }
  return { content, truncated: choice?.finish_reason === "length" };
}

/**
 * NVIDIA retires model ids out from under a routing table, and says so with
 * 410 rather than 404 — observed live on `meta/llama-3.3-70b-instruct`. Without
 * the explanation an operator reads it as a broken integration.
 */
function describeNvidiaFailure(status: number, body: string): string {
  let message = body.slice(0, 200);
  try {
    const parsed = JSON.parse(body) as { detail?: string; error?: { message?: string } };
    message = parsed.error?.message ?? parsed.detail ?? message;
  } catch {
    // Not JSON — report what came back.
  }

  // NVIDIA's unavailable-model message names the internal function id and the
  // account hash behind the key. Neither helps an operator read the routing log,
  // and the account identifier has no business being echoed back into the UI.
  message = message.replace(/for account\s+'[^']*'/, "for this account");

  if (status === 410) {
    return `HTTP 410: ${message} This id has been retired by NVIDIA; pick a current one in Settings → AI models.`;
  }
  if (status === 404) {
    return `HTTP 404: ${message} This model is not served to this account.`;
  }
  if (status === 429) {
    return `HTTP 429: ${message} NVIDIA's free key allows roughly 40 requests a minute.`;
  }
  return `HTTP ${status}: ${message}`;
}

/**
 * Cloudflare Workers AI answers the OpenAI wire format as well, but every call
 * is addressed to an account, so the account id travels with the credential
 * instead of being a constant.
 */
async function callCloudflareWorkersAi(
  model: string,
  request: CompletionRequest,
  signal: AbortSignal,
  apiKey: string,
  accountId: string
): Promise<{ content: string; truncated: boolean }> {
  const response = await fetch(
    `${aiConfig.cloudflareWorkersAi.baseUrl}/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,
    {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 2048,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Cloudflare Workers AI ${model} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  if (payload.error) {
    throw new Error(`Cloudflare Workers AI ${model}: ${payload.error.message}`);
  }
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new Error(`Cloudflare Workers AI ${model} returned an empty completion`);
  }
  return { content, truncated: choice?.finish_reason === "length" };
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
 * spend daily quota on requests that cannot succeed.
 *
 * The transcription row leads the walk when it names a Gemini model, so the card
 * in Settings decides the order the ids are tried in. A pick from another
 * provider is skipped rather than sent — it cannot take the file, and `saveModelRouting`
 * now refuses one — and the shipped chain always stays behind the row, so the
 * walk can only ever be longer than the one this function started with.
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

  const [apiKey, routing] = await Promise.all([
    resolveSecret("google_ai_studio"),
    resolveModelRouting(TRANSCRIPTION_CAPABILITY),
  ]);
  if (!apiKey) {
    throw new RecordingNotTranscribableError(
      "No Google AI Studio key is configured, which the transcription model needs."
    );
  }

  const data = Buffer.from(bytes).toString("base64");
  const walkErrors: string[] = [];

  for (const model of transcriptionChain(routing)) {
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

  // Settings win over the environment; every provider is optional. Resolved
  // together so the wall clock costs one round trip, and all of them are needed
  // up front because the "nothing is configured" message has to be true for the
  // provider the chain is actually about to try.
  const [credentials, googleKey, openCodeKeys, qoderKey, nvidiaKeys, cloudflareKeys, routing] =
    await Promise.all([
      resolveCredentials("openrouter"),
      resolveSecret("google_ai_studio"),
      resolveCredentials("opencode"),
      resolveSecret("qoder"),
      resolveCredentials("nvidia_nim"),
      resolveCredentials("cloudflare_workers_ai"),
      resolveModelRouting(request.capability),
    ]);

  if (
    credentials.length === 0 &&
    !googleKey &&
    openCodeKeys.length === 0 &&
    !qoderKey &&
    nvidiaKeys.length === 0 &&
    cloudflareKeys.length === 0
  ) {
    throw new AiGatewayError(
      "No AI provider is configured. Add an OpenRouter key in Settings → API keys, " +
        "or set OPENROUTER_API_KEY in the environment.",
      attempts
    );
  }

  // Chain: the model chosen for this call, or the capability's configured
  // primary + fallback, then the compiled-in defaults as a last resort.
  const chosen = request.modelOverride?.trim();
  const chain = (
    chosen
      ? [chosen]
      : [
          ...(routing.enabled ? [routing.primaryModel, routing.fallbackModel] : []),
          ...modelChains[request.capability],
        ]
  ).filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i);

  const effective: CompletionRequest = {
    ...request,
    temperature: request.temperature ?? routing.temperature,
    maxTokens: request.maxTokens ?? routing.maxTokens,
  };

  // Walk the chain in the order the routing table asks for it and send each id to
  // the provider that publishes it. Sweeping every OpenRouter id first would let a
  // leftover OpenRouter fallback answer before a Google model set as primary — so
  // a choice made in the console would still silently never take effect.
  for (const routed of chain) {
    const { provider: hop, model } = routeFor(routed);

    if (hop === "opencode") {
      if (openCodeKeys.length === 0) {
        attempts.push({
          model: routed,
          ok: false,
          error: "no OpenCode key configured",
          credential: "opencode",
        });
        continue;
      }
      for (const credential of openCodeKeys) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), aiConfig.openCode.timeoutMs);
        try {
          const reply = await callOpenCode(model, effective, controller.signal, credential.secret);
          clearTimeout(timeout);
          attempts.push({ model: routed, ok: true, credential: credential.secretHint });
          return {
            content: reply.content,
            model,
            provider: "opencode",
            attempts,
            truncated: reply.truncated,
          };
        } catch (error) {
          clearTimeout(timeout);
          attempts.push({
            model: routed,
            ok: false,
            error: error instanceof Error ? error.message : "unknown error",
            credential: credential.secretHint,
          });
        }
      }
      continue;
    }

    if (hop === "qoder") {
      if (!qoderKey) {
        attempts.push({
          model: routed,
          ok: false,
          error: "no Qoder token configured",
          credential: "qoder",
        });
        continue;
      }
      // An agent turn, not a completion: its runtime sets its own sampling, so
      // `effective`'s temperature and token budget do not travel with it.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), QODER_COMPLETION_TIMEOUT_MS);
      try {
        const reply = await callQoderCompletion(model, effective.messages, qoderKey, controller);
        clearTimeout(timeout);
        attempts.push({ model: routed, ok: true, credential: "qoder" });
        return {
          content: reply.content,
          model: reply.model,
          provider: "qoder",
          attempts,
          truncated: false,
        };
      } catch (error) {
        clearTimeout(timeout);
        attempts.push({
          model: routed,
          ok: false,
          error: error instanceof Error ? error.message : "unknown error",
          credential: "qoder",
        });
      }
      continue;
    }

    if (hop === "google") {
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

    if (hop === "nvidia") {
      if (nvidiaKeys.length === 0) {
        attempts.push({
          model: routed,
          ok: false,
          error: "no NVIDIA API key configured",
          credential: "nvidia",
        });
        continue;
      }
      for (const credential of nvidiaKeys) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), aiConfig.nvidiaNim.timeoutMs);
        try {
          const reply = await callNvidiaNim(model, effective, controller.signal, credential.secret);
          clearTimeout(timeout);
          attempts.push({ model: routed, ok: true, credential: credential.secretHint });
          return {
            content: reply.content,
            model,
            provider: "nvidia",
            attempts,
            truncated: reply.truncated,
          };
        } catch (error) {
          clearTimeout(timeout);
          attempts.push({
            model: routed,
            ok: false,
            error: error instanceof Error ? error.message : "unknown error",
            credential: credential.secretHint,
          });
        }
      }
      continue;
    }

    if (hop === "cloudflare") {
      if (cloudflareKeys.length === 0) {
        attempts.push({
          model: routed,
          ok: false,
          error: "no Cloudflare Workers AI token configured",
          credential: "cloudflare",
        });
        continue;
      }
      for (const credential of cloudflareKeys) {
        // The token is not addressable on its own — every Workers AI call names
        // an account, so a hop without one must say that rather than report a
        // 404 from a URL built with an empty path segment.
        const accountId =
          credential.config.account_id?.trim() || aiConfig.cloudflareWorkersAi.accountId.trim();
        if (!accountId) {
          attempts.push({
            model: routed,
            ok: false,
            error:
              "no Cloudflare Account ID set — fill the Account ID field in Settings → API keys, or set CLOUDFLARE_AI_ACCOUNT_ID",
            credential: credential.secretHint,
          });
          continue;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), aiConfig.cloudflareWorkersAi.timeoutMs);
        try {
          const reply = await callCloudflareWorkersAi(
            model,
            effective,
            controller.signal,
            credential.secret,
            accountId
          );
          clearTimeout(timeout);
          attempts.push({ model: routed, ok: true, credential: credential.secretHint });
          return {
            content: reply.content,
            model,
            provider: "cloudflare",
            attempts,
            truncated: reply.truncated,
          };
        } catch (error) {
          clearTimeout(timeout);
          attempts.push({
            model: routed,
            ok: false,
            error: error instanceof Error ? error.message : "unknown error",
            credential: credential.secretHint,
          });
        }
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

  // A model chosen for this call gets no rescue: whatever the routing table or
  // Google's compiled chain would have answered with is not what was asked for.
  if (chosen) {
    throw new AiGatewayError(
      `"${chosen}" did not answer: ${attempts.map((a) => a.error ?? "ok").join(" | ") || "no provider is configured for it"}`,
      attempts
    );
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
