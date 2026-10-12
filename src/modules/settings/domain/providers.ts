/**
 * Provider registry for dynamic provider registration.
 * Allows adding new providers without modifying core code.
 */

// ============================================================================
// Types
// ============================================================================

/** Provider group/category for organization in the UI. */
export type ProviderGroup = "ai" | "communication" | "calendar" | "hr" | "other";

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

/** Model option from catalogue (e.g., OpenRouter). */
export interface ModelOption {
  id: string;
  name: string;
  promptPrice: number | null;
  completionPrice: number | null;
  contextLength: number | null;
  free: boolean;
}

/** Model catalogue response. */
export interface ModelCatalogue {
  models: ModelOption[];
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
}

/** Grouped models by provider and cost tier. */
export interface GroupedModels {
  provider: string;
  providerName: string;
  costTier: CostTier;
  models: ProviderModel[];
}

/** Cost tier classification. */
export type CostTier = "free" | "low" | "medium" | "high" | "premium";

// ============================================================================
// Constants
// ============================================================================

/** Built-in provider groups for UI organization. */
export const PROVIDER_GROUPS: ProviderGroupConfig[] = [
  { id: "ai", label: "AI Providers", blurb: "Language model APIs for generation, embedding, and reasoning." },
  { id: "communication", label: "Communication", blurb: "Messaging and notification channels (WhatsApp, SMS, Email)." },
  { id: "calendar", label: "Calendar", blurb: "Calendar integrations for scheduling and availability." },
  { id: "hr", label: "HR Systems", blurb: "Human resource platform connectors." },
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
    id: "frappe_hr",
    displayName: "Frappe HR",
    group: "hr",
    envVar: "FRAPPE_HR_API_KEY",
    description: "Frappe/ERPNext HR module integration.",
    docsUrl: "https://frappeframework.com/docs",
    verify: {
      url: "",
      method: "GET",
      header: "Authorization",
    },
    fields: [
      { key: "api_key", label: "API Key", kind: "text", placeholder: "...", required: true, secret: true },
      { key: "api_secret", label: "API Secret", kind: "text", placeholder: "...", required: true, secret: true },
      { key: "base_url", label: "Base URL", kind: "url", placeholder: "https://your-site.frappe.cloud", required: true },
    ],
  },
  {
    id: "google_calendar",
    displayName: "Google Calendar",
    group: "calendar",
    envVar: "GOOGLE_CALENDAR_CLIENT_ID",
    description: "Google Calendar integration for interview scheduling.",
    docsUrl: "https://developers.google.com/calendar",
    verify: null,
    fields: [
      { key: "client_id", label: "Client ID", kind: "text", placeholder: "...apps.googleusercontent.com", required: true },
      { key: "client_secret", label: "Client Secret", kind: "text", placeholder: "GOCSPX-...", required: true, secret: true },
      { key: "redirect_uri", label: "Redirect URI", kind: "url", placeholder: "https://your-app.com/auth/callback", required: true },
    ],
  },
  {
    id: "microsoft_calendar",
    displayName: "Microsoft 365 Calendar",
    group: "calendar",
    envVar: "MS_CALENDAR_CLIENT_ID",
    description: "Microsoft Graph Calendar integration for Outlook/Exchange.",
    docsUrl: "https://learn.microsoft.com/en-us/graph/api/resources/calendar",
    verify: null,
    fields: [
      { key: "client_id", label: "Client ID", kind: "text", placeholder: "...", required: true },
      { key: "client_secret", label: "Client Secret", kind: "text", placeholder: "...", required: true, secret: true },
      { key: "redirect_uri", label: "Redirect URI", kind: "url", placeholder: "https://your-app.com/auth/callback", required: true },
    ],
  },
];

/** Fallback models when OpenRouter catalogue is unavailable. */
export const FALLBACK_MODELS: ModelOption[] = [
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B (Free)", promptPrice: 0, completionPrice: 0, contextLength: 8192, free: true },
  { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B MoE (Free)", promptPrice: 0, completionPrice: 0, contextLength: 8192, free: true },
  { id: "meta-llama/llama-3.1-8b-instruct:free", name: "Llama 3.1 8B (Free)", promptPrice: 0, completionPrice: 0, contextLength: 131072, free: true },
  { id: "microsoft/phi-3-mini-128k-instruct:free", name: "Phi-3 Mini 128K (Free)", promptPrice: 0, completionPrice: 0, contextLength: 131072, free: true },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", promptPrice: 0.15, completionPrice: 0.6, contextLength: 128000, free: false },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", promptPrice: 0.25, completionPrice: 1.25, contextLength: 200000, free: false },
  { id: "google/gemini-flash-1.5", name: "Gemini 1.5 Flash", promptPrice: 0.075, completionPrice: 0.3, contextLength: 1000000, free: false },
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
  { id: "transcription", label: "Transcription", description: "Turn video pitches and interview audio into text." },
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
  if (isFree || promptPrice === 0 || promptPrice === null) return "free";
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
    
    // Sort tiers: free first, then low to premium
    const tierOrder: CostTier[] = ["free", "low", "medium", "high", "premium"];
    
    for (const tier of tierOrder) {
      const models = providerGroups.get(tier);
      if (models && models.length > 0) {
        // Sort models within tier: free first, then by price
        models.sort((a, b) => {
          if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
          return (a.promptPrice ?? Infinity) - (b.promptPrice ?? Infinity);
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