/**
 * Provider registry for dynamic provider registration.
 * Allows adding new providers without modifying core code.
 */

// ============================================================================
// Types
// ============================================================================

/** Provider group/category for organization in the UI. */
export type ProviderGroup = "ai" | "communication" | "other";

/** Provider group display configuration. */
export interface ProviderGroupConfig {
  id: ProviderGroup;
  label: string;
  blurb: string;
}

/** Individual field configuration for provider credentials. */
export interface ProviderField {
  key: string;
  label: string;
  kind: "text" | "url" | "number";
  placeholder?: string;
  required?: boolean;
  hint?: string;
  secret?: boolean;
}

/** Verification endpoint configuration for a provider. */
export interface ProviderVerifyConfig {
  url: string;
  method: "GET" | "POST";
  header: string;
  /**
   * Set when the probe is a protocol handshake rather than an HTTP call —
   * SMTP has no "am I configured" endpoint, so the check logs in instead.
   */
  transport?: "smtp";
}

/** Complete provider definition. */
export interface ProviderDefinition {
  id: string;
  displayName: string;
  group: ProviderGroup;
  envVar: string;
  description: string;
  docsUrl?: string;
  verify?: ProviderVerifyConfig | null;
  fields: ProviderField[];
}

/** Model option from a provider catalogue. */
export interface ModelOption {
  id: string;
  name: string;
  promptPrice: number | null;
  completionPrice: number | null;
  contextLength: number | null;
  free: boolean;
  /** Which configured provider publishes this model, e.g. `openrouter`. */
  provider: string;
  /**
   * False when the portal stores the provider's credentials but has no code
   * path that can call it, so the UI must never present the row as selectable.
   */
  routable: boolean;
  /**
   * False when the provider lists the model but this account cannot use it —
   * Qoder returns disabled models alongside the enabled ones.
   */
  enabled?: boolean;
  /**
   * Provider-reported metadata with no equivalent in the fields above, e.g.
   * "2× baseline · vision · effort: low…max". Display only; never inferred.
   */
  detail?: string;
}

/** Where one catalogue page came from, and what to say about it. */
export interface CatalogueSource {
  id: string;
  displayName: string;
  count: number;
  routable: boolean;
  /** `ok` — live list; `degraded` — static list; anything else — no models shown. */
  status: "ok" | "degraded" | "no_key" | "unauthorized" | "unreachable";
  /** Plain-language reason for a non-`ok` status, or the caveat for a routable false. */
  note?: string;
}

/** Model catalogue response. */
export interface ModelCatalogue {
  models: ModelOption[];
  sources: CatalogueSource[];
  fetchedAt: string;
  degraded: boolean;
}

/** AI capability definition for model routing. */
export interface AiCapability {
  id: string;
  label: string;
  description: string;
}

/** Provider model with pricing and metadata for grouping. */
export interface ProviderModel {
  id: string;
  provider: string;
  modelId: string;
  name: string;
  promptPrice: number | null;
  completionPrice: number | null;
  contextLength: number | null;
  isFree: boolean;
  contextWindowCategory: string | null;
  capabilities: string[];
  isActive: boolean;
  fetchedAt: string;
  /** False for credential-only providers — never offer these in a picker. */
  routable: boolean;
  /** False = listed by the provider, unusable by this account. */
  enabled?: boolean;
  /** Provider-reported metadata shown verbatim. */
  detail?: string;
}

/** Grouped models by provider and cost tier. */
export interface GroupedModels {
  provider: string;
  providerName: string;
  costTier: CostTier;
  models: ProviderModel[];
}

/**
 * Cost tier classification.
 *
 * `unpriced` exists because some providers do not publish a price in their
 * model list; calling that "free" would be a claim the code cannot support.
 */
export type CostTier = "free" | "low" | "medium" | "high" | "premium" | "unpriced";

// ============================================================================
// Constants
// ============================================================================

/** Built-in provider groups for UI organization. */
export const PROVIDER_GROUPS: ProviderGroupConfig[] = [
  { id: "ai", label: "AI Providers", blurb: "Language model APIs for generation, embedding, and reasoning." },
  { id: "communication", label: "Communication", blurb: "Messaging channels that send candidate notifications." },
  { id: "other", label: "Other", blurb: "Miscellaneous integrations." },
];

/** Built-in provider definitions. */
export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "openrouter",
    displayName: "OpenRouter",
    group: "ai",
    envVar: "OPENROUTER_API_KEY",
    description: "Unified API for 100+ LLMs including GPT-4, Claude, Llama, and more.",
    docsUrl: "https://openrouter.ai/docs",
    verify: {
      url: "https://openrouter.ai/api/v1/credits",
      method: "GET",
      header: "Authorization",
    },
    fields: [
      { key: "api_key", label: "API Key", kind: "text", placeholder: "sk-or-v1-...", required: true, secret: true },
    ],
  },
  {
    id: "google_ai_studio",
    displayName: "Google AI Studio",
    group: "ai",
    envVar: "GOOGLE_AI_STUDIO_API_KEY",
    description: "Access to Gemini models via Google AI Studio.",
    docsUrl: "https://ai.google.dev/",
    verify: {
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      method: "GET",
      header: "x-goog-api-key",
    },
    fields: [
      { key: "api_key", label: "API Key", kind: "text", placeholder: "AIza...", required: true, secret: true },
    ],
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    group: "ai",
    envVar: "OPENCODE_API_KEY",
    description:
      "OpenAI-compatible inference gateway with 80+ models. Free-tier models run only inside the OpenCode client — server-side calls require a paid model.",
    docsUrl: "https://opencode.ai/v2/docs/console/api/inference/",
    verify: {
      url: "https://opencode.ai/inference/v1/models",
      method: "GET",
      header: "Authorization",
    },
    fields: [
      { key: "api_key", label: "API Key", kind: "text", placeholder: "sk-...", required: true, secret: true },
    ],
  },
  {
    id: "qoder",
    displayName: "Qoder",
    group: "ai",
    envVar: "QODER_API_KEY",
    description:
      "Qoder Cloud Agents API. Exposes the forward model catalogue and agent execution over a personal access token.",
    docsUrl: "https://docs.qoder.com/cloud-agents/api/conventions/authentication",
    verify: {
      url: "https://api.qoder.com/api/v1/forward/models",
      method: "GET",
      header: "Authorization",
    },
    fields: [
      { key: "api_key", label: "Personal Access Token", kind: "text", placeholder: "pt-...", required: true, secret: true },
    ],
  },
  {
    id: "cloudflare_workers_ai",
    displayName: "Cloudflare Workers AI",
    group: "ai",
    envVar: "CLOUDFLARE_AI_API_TOKEN",
    description:
      "OpenAI-compatible inference running on Cloudflare's own network. The free allowance is 10,000 neurons a day, and every call is addressed to an account, so the token alone is not enough — the Account ID is required too.",
    docsUrl: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/",
    verify: {
      url: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/models/search?per_page=1",
      method: "GET",
      header: "Authorization",
    },
    fields: [
      {
        key: "api_key",
        label: "API Token",
        kind: "text",
        placeholder: "cfut_...",
        required: true,
        secret: true,
        hint: "An API token scoped to Workers AI, not the account's global API key.",
      },
      {
        key: "account_id",
        label: "Account ID",
        kind: "text",
        placeholder: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        required: true,
        hint: "On the Cloudflare dashboard home page. Falls back to CLOUDFLARE_AI_ACCOUNT_ID.",
      },
    ],
  },
  {
    id: "nvidia_nim",
    displayName: "NVIDIA NIM",
    group: "ai",
    envVar: "NVIDIA_API_KEY",
    description:
      "NVIDIA's hosted inference API: 80+ open models behind one OpenAI-compatible endpoint. A free key needs phone verification and no card, and is rate-limited to roughly 40 requests a minute — enough for screening, not for production traffic.",
    docsUrl: "https://docs.api.nvidia.com/nim/reference",
    // Deliberately not verifiable here: NVIDIA's model list is public, so it
    // answers HTTP 200 for a key that is revoked or mistyped, and a Verify button
    // built on it would report success for a credential that cannot infer
    // anything. The live check is the completion probe in the diagnostics panel.
    verify: null,
    fields: [
      { key: "api_key", label: "API Key", kind: "text", placeholder: "nvapi-...", required: true, secret: true },
    ],
  },
  {
    id: "whatsapp",
    displayName: "WhatsApp Business",
    group: "communication",
    envVar: "WHATSAPP_TOKEN",
    description: "WhatsApp Business API for messaging candidates and clients.",
    docsUrl: "https://developers.facebook.com/docs/whatsapp",
    verify: {
      url: "https://graph.facebook.com/v18.0/me",
      method: "GET",
      header: "Authorization",
    },
    fields: [
      { key: "token", label: "Access Token", kind: "text", placeholder: "EA...", required: true, secret: true },
      { key: "phone_number_id", label: "Phone Number ID", kind: "text", placeholder: "123456789", required: true },
      { key: "verify_token", label: "Webhook Verify Token", kind: "text", placeholder: "your-verify-token", required: true, secret: true },
      { key: "app_secret", label: "App Secret", kind: "text", placeholder: "app-secret", required: false, secret: true },
    ],
  },
  {
    id: "smtp",
    displayName: "Email (SMTP)",
    group: "communication",
    envVar: "SMTP_PASSWORD",
    description:
      "Any SMTP relay — Gmail, Outlook, Zoho or your own mail server. Sends the email channel: pipeline alerts, interview notices and recruiter campaigns. Gmail needs an app password, not the account password.",
    docsUrl: "https://nodemailer.com/smtp/",
    verify: { url: "", method: "GET", header: "", transport: "smtp" },
    fields: [
      {
        key: "host",
        label: "SMTP host",
        kind: "text",
        placeholder: "smtp.gmail.com",
        required: true,
        hint: "Falls back to SMTP_HOST.",
      },
      {
        key: "port",
        label: "Port",
        kind: "number",
        placeholder: "587",
        required: true,
        hint: "587 starts with a plain connection and upgrades (STARTTLS); 465 is TLS from the first byte. Falls back to SMTP_PORT.",
      },
      {
        key: "username",
        label: "Sign-in account",
        kind: "text",
        placeholder: "talent@your-domain.com",
        required: true,
        hint: "The mailbox the server logs in as. Falls back to SMTP_USER.",
      },
      {
        key: "from",
        label: "From address",
        kind: "text",
        placeholder: "Sharm Dreams Group <talent@your-domain.com>",
        required: true,
        hint: "What candidates see and reply to. Falls back to EMAIL_FROM.",
      },
    ],
  },
];

/** Fallback models when the OpenRouter catalogue is unreachable. */
export const FALLBACK_MODELS: ModelOption[] = [
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B (Free)", promptPrice: 0, completionPrice: 0, contextLength: 8192, free: true, provider: "openrouter", routable: true },
  { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B MoE (Free)", promptPrice: 0, completionPrice: 0, contextLength: 8192, free: true, provider: "openrouter", routable: true },
  { id: "meta-llama/llama-3.1-8b-instruct:free", name: "Llama 3.1 8B (Free)", promptPrice: 0, completionPrice: 0, contextLength: 131072, free: true, provider: "openrouter", routable: true },
  { id: "microsoft/phi-3-mini-128k-instruct:free", name: "Phi-3 Mini 128K (Free)", promptPrice: 0, completionPrice: 0, contextLength: 131072, free: true, provider: "openrouter", routable: true },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", promptPrice: 0.15, completionPrice: 0.6, contextLength: 128000, free: false, provider: "openrouter", routable: true },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", promptPrice: 0.25, completionPrice: 1.25, contextLength: 200000, free: false, provider: "openrouter", routable: true },
  { id: "google/gemini-flash-1.5", name: "Gemini 1.5 Flash", promptPrice: 0.075, completionPrice: 0.3, contextLength: 1000000, free: false, provider: "openrouter", routable: true },
];

/**
 * AI capabilities that can have custom model routing.
 *
 * INVARIANT: every `id` must match `AiCapability` in `src/lib/config.ts` — the
 * gateway looks up `ai_model_config` rows by exactly these keys.
 */
export const AI_CAPABILITIES: AiCapability[] = [
  { id: "resume_screening", label: "Resume screening", description: "Score CVs, cover letters and profile data against job requirements." },
  { id: "soft_skills", label: "Soft-skill signals", description: "Read tone, seniority and collaboration signals from application material." },
  { id: "case_reasoning", label: "Case & reasoning", description: "Deep-reasoning work: case studies, scoring rubrics and complex analysis." },
  { id: "feedback", label: "Feedback drafting", description: "Write candidate feedback and advance/rejection summaries." },
  { id: "interview_questions", label: "Interview questions", description: "Generate interview guides, scorecards and follow-up questions." },
  { id: "transcription", label: "Transcription", description: "Turn video pitches and interview audio into text using the Google Gemini audio path." },
  { id: "assistant", label: "Admin assistant", description: "Run the in-app assistant chat that reads and changes records across the portal." },
  { id: "chatbot", label: "Careers assistant", description: "Answer visitor questions on the public careers pages from the role and company facts that page publishes." },
  { id: "translation", label: "Interface translation", description: "Draft the Arabic wording for the interface keys in Settings → Languages. Nothing is stored until a person saves it." },
  { id: "form_authoring", label: "Application forms", description: "Draft the questions an application form asks from a recruiter's brief. Every draft is reviewed before it is stored, and nothing is published or assigned automatically." },
];

// ============================================================================
// Provider Registry
// ============================================================================

export interface ProviderRegistry {
  providers: Map<string, ProviderDefinition>;
  register(definition: ProviderDefinition): void;
  unregister(id: string): void;
  get(id: string): ProviderDefinition | undefined;
  getAll(): ProviderDefinition[];
  getByGroup(group: ProviderGroup): ProviderDefinition[];
}

/** Default registry instance */
export const providerRegistry: ProviderRegistry = {
  providers: new Map<string, ProviderDefinition>(),
  
  register(definition: ProviderDefinition) {
    if (this.providers.has(definition.id)) {
      console.warn(`Provider ${definition.id} already registered, overwriting`);
    }
    this.providers.set(definition.id, definition);
  },
  
  unregister(id: string) {
    this.providers.delete(id);
  },
  
  get(id: string) {
    return this.providers.get(id);
  },
  
  getAll() {
    return Array.from(this.providers.values());
  },
  
  getByGroup(group: ProviderGroup) {
    return Array.from(this.providers.values()).filter(p => p.group === group);
  },
};

// Initialize registry with built-in providers
PROVIDERS.forEach(p => providerRegistry.register(p));

/**
 * Returns the provider definition for a given id.
 */
export function providerById(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// ============================================================================
// Model Grouping & Filtering Utilities
// ============================================================================

/**
 * Determines the cost tier for a model based on its prompt price.
 */
export function getCostTier(promptPrice: number | null, isFree: boolean): CostTier {
  if (isFree || promptPrice === 0) return "free";
  if (promptPrice === null) return "unpriced";
  if (promptPrice < 0.5) return "low";
  if (promptPrice < 2) return "medium";
  if (promptPrice < 10) return "high";
  return "premium";
}

/**
 * Returns a human-readable label for a cost tier.
 */
export function costTierLabel(tier: CostTier): string {
  switch (tier) {
    case "free": return "Free";
    case "low": return "Low Cost";
    case "medium": return "Medium Cost";
    case "high": return "High Cost";
    case "premium": return "Premium";
    case "unpriced": return "Price not listed";
  }
}

/**
 * Groups models by provider and cost tier for organized display in selects.
 */
export function groupModelsByProviderAndCost(models: ProviderModel[]): GroupedModels[] {
  const grouped = new Map<string, Map<CostTier, ProviderModel[]>>();
  
  for (const model of models) {
    const tier = getCostTier(model.promptPrice, model.isFree);
    const providerGroups = grouped.get(model.provider) ?? new Map();
    const tierModels = providerGroups.get(tier) ?? [];
    tierModels.push(model);
    providerGroups.set(tier, tierModels);
    grouped.set(model.provider, providerGroups);
  }
  
  const result: GroupedModels[] = [];
  
  // Sort providers alphabetically
  const sortedProviders = Array.from(grouped.keys()).sort();
  
  for (const provider of sortedProviders) {
    const providerGroups = grouped.get(provider)!;
    const providerDef = providerById(provider);
    const providerName = providerDef?.displayName ?? provider;
    
    // Sort tiers: free first, then low to premium, then unpriced last
    const tierOrder: CostTier[] = ["free", "low", "medium", "high", "premium", "unpriced"];
    
    for (const tier of tierOrder) {
      const models = providerGroups.get(tier);
      if (models && models.length > 0) {
        // Sort models within tier: free first, then by price (unpriced last, by name)
        models.sort((a, b) => {
          if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
          const pa = a.promptPrice ?? Number.MAX_SAFE_INTEGER;
          const pb = b.promptPrice ?? Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
          return a.name.localeCompare(b.name);
        });
        
        result.push({
          provider,
          providerName,
          costTier: tier,
          models,
        });
      }
    }
  }
  
  return result;
}

/**
 * Filters models by search query (matches name or modelId).
 */
export function filterModelsBySearch(models: ProviderModel[], query: string): ProviderModel[] {
  if (!query.trim()) return models;
  
  const lowerQuery = query.toLowerCase();
  return models.filter(model => 
    model.name.toLowerCase().includes(lowerQuery) ||
    model.modelId.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Returns the full model option for a model ID by looking it up in the catalogue.
 */
export function getModelById(modelId: string, catalogue?: ModelOption[]): ModelOption | undefined {
  if (!modelId) return undefined;
  const models = catalogue ?? FALLBACK_MODELS;
  return models.find(m => m.id === modelId);
}

/**
 * Returns a display name for a model ID by looking it up in the catalogue.
 */
export function nameFor(modelId: string, catalogue?: ModelOption[]): string {
  if (!modelId) return "";
  const models = catalogue ?? FALLBACK_MODELS;
  const found = models.find(m => m.id === modelId);
  return found?.name ?? modelId;
}