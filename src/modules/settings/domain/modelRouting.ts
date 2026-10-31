export type GatewayProvider =
  | "openrouter"
  | "google"
  | "opencode"
  | "qoder"
  | "cloudflare"
  | "nvidia";

export const ROUTING_PROVIDER_NAMES: Record<GatewayProvider, string> = {
  openrouter: "OpenRouter",
  google: "Google AI Studio",
  opencode: "OpenCode",
  qoder: "Qoder",
  cloudflare: "Cloudflare Workers AI",
  nvidia: "NVIDIA NIM",
};

export interface ModelRouting {
  enabled: boolean;
  primaryModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
}

export const ROUTING_FALLBACK: ModelRouting = {
  enabled: true,
  primaryModel: "google/gemma-4-31b-it:free",
  fallbackModel: "google/gemma-4-26b-a4b-it:free",
  temperature: 0.3,
  maxTokens: 1200,
};

// These catalogues overlap Google's bare ids or OpenRouter's namespaced ids.
const ROUTING_PREFIX_BY_PROVIDER: Record<string, GatewayProvider> = {
  opencode: "opencode",
  qoder: "qoder",
  cloudflare_workers_ai: "cloudflare",
  nvidia_nim: "nvidia",
};

export const ROUTING_PREFIXES: Record<string, GatewayProvider> = Object.fromEntries(
  Object.values(ROUTING_PREFIX_BY_PROVIDER).map((provider) => [`${provider}:`, provider])
);

export function qualifiedId(providerId: string, modelId: string): string {
  const prefix = ROUTING_PREFIX_BY_PROVIDER[providerId];
  return prefix ? `${prefix}:${modelId}` : modelId;
}

export function isGoogleNativeModel(model: string): boolean {
  return !model.includes("/");
}

export function routeFor(model: string): { provider: GatewayProvider; model: string } {
  for (const [prefix, provider] of Object.entries(ROUTING_PREFIXES)) {
    if (model.startsWith(prefix)) return { provider, model: model.slice(prefix.length) };
  }
  return { provider: isGoogleNativeModel(model) ? "google" : "openrouter", model };
}

export const GOOGLE_MODEL_CHAIN = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
] as const;

export const GOOGLE_WALK_STATUSES = new Set([404, 429, 500, 502, 503, 504]);
export const TRANSCRIPTION_CAPABILITY = "transcription";

// This is audio-path eligibility, not a live model-availability check.
export function acceptsAudio(model: string): boolean {
  const routed = routeFor(model.trim());
  return routed.provider === "google" && routed.model.toLowerCase().startsWith("gemini");
}

export function transcriptionChain(
  routing?: Pick<ModelRouting, "enabled" | "primaryModel" | "fallbackModel"> | null
): string[] {
  const listed =
    routing && routing.enabled
      ? [routing.primaryModel.trim(), routing.fallbackModel?.trim() ?? ""]
      : [];
  return [...new Set([...listed.filter(acceptsAudio), ...GOOGLE_MODEL_CHAIN])];
}

export function transcriptionRefusal(
  primaryModel: string,
  fallbackModel?: string | null
): string | null {
  if (!primaryModel.trim()) return "Choose a native Gemini primary model.";
  const unusable = [primaryModel.trim(), fallbackModel?.trim() ?? ""].filter(
    (id) => id && !acceptsAudio(id)
  );
  if (unusable.length === 0) return null;
  const names = unusable
    .map((id) => `"${id}" (${ROUTING_PROVIDER_NAMES[routeFor(id).provider]})`)
    .join(" and ");
  return `Transcription uses the Google Gemini audio path; ${names} cannot be used by that path. Choose a native Gemini primary model and a native Gemini fallback, or leave the fallback empty.`;
}

export function probeCaveat(capability: string): string | null {
  if (capability !== TRANSCRIPTION_CAPABILITY) return null;
  return "Checked with a text prompt: this proves the key and the model answer, not that the model accepts an audio file.";
}
