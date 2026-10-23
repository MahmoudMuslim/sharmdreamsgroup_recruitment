# AI Integration

All model calls go through one gateway: **`src/modules/screening/infrastructure/aiGateway.ts`**. It is a multi-provider client with **model failover** *and* **credential failover** — it walks a capability's model chain, and for each model it walks every stored key for that model's provider, until one returns a valid completion.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [AUTHENTICATION.md](AUTHENTICATION.md) · [DATABASE.md](DATABASE.md)

---

## What can call the AI

Nine **capabilities**, each independently routable to its own model (`AI_CAPABILITIES` in `src/modules/settings/domain/providers.ts`, mirrored by the `AiCapability` union in `src/lib/config.ts`):

| Capability | Used for |
|------------|----------|
| `resume_screening` | Score CVs / cover letters / profile data against a role. |
| `soft_skills` | Read tone, seniority and collaboration signals. |
| `case_reasoning` | Deep-reasoning: case studies, rubrics, complex analysis. |
| `feedback` | Draft candidate feedback and advance/reject summaries. |
| `interview_questions` | Generate interview guides and follow-ups. |
| `transcription` | Turn video pitches and interview audio into text — **not** a `complete()` call, see [Transcription](#transcription). |
| `assistant` | The in-app agentic assistant (reads/changes portal records). |
| `chatbot` | The public careers assistant. |
| `translation` | Draft the Arabic wording behind the Settings → Languages editor. |

> **Invariant:** the `id`s in `AI_CAPABILITIES` must match the `AiCapability` union — the gateway looks up `ai_model_config` rows by exactly these keys. And every one of them must have a caller: a capability nobody asks for is a card in Settings that decides nothing.

---

## Providers

Eight providers are registered in `providers.ts`, grouped for the Settings UI. Six are AI and **routable** from the gateway (`GatewayProvider`); two are communication channels.

| Provider | Group | Env var | Notes |
|----------|-------|---------|-------|
| `openrouter` | ai | `OPENROUTER_API_KEY` | Unified API for namespaced model ids (`google/…`, `meta-llama/…`). Verifiable via `/credits`. |
| `google_ai_studio` | ai | `GOOGLE_AI_STUDIO_API_KEY` | Gemini/Gemma on Google's own endpoint; bare model ids. |
| `opencode` | ai | `OPENCODE_API_KEY` | OpenAI-compatible gateway; free-tier models only run client-side, server calls need a paid model. |
| `qoder` | ai | `QODER_API_KEY` | Qoder Cloud Agents (personal access token). |
| `cloudflare_workers_ai` | ai | `CLOUDFLARE_AI_API_TOKEN` (+ `CLOUDFLARE_AI_ACCOUNT_ID`) | Needs an Account ID too — every call is addressed to an account. |
| `nvidia_nim` | ai | `NVIDIA_API_KEY` | OpenAI-compatible; **not verifiable** (its public model list 200s even for a bad key) — use the diagnostics completion probe. |
| `whatsapp` | communication | `WHATSAPP_TOKEN` | `resolveSecret("whatsapp")` reads a stored key first, this env var as the fallback — the connector does not use `omnichannelConfig` for the token. |
| `smtp` | communication | `SMTP_PASSWORD` | Verified by logging in (no HTTP "am I configured" endpoint). |

The registry supports **dynamic registration** (`providerRegistry.register/unregister/get/getByGroup`) so a new provider can be added without editing core code.

---

## Credential resolution order

Per request, the gateway resolves everything in one round trip:

```
resolveCredentials("openrouter")        ┐  encrypted store (provider_credentials)
resolveSecret("google_ai_studio")       │  ↓ falls back to
resolveCredentials("opencode")          │  compiled-in env (config.server.ts)
resolveSecret("qoder")                  │
resolveCredentials("nvidia_nim")        │
resolveCredentials("cloudflare_workers_ai") ┘
resolveModelRouting(capability)  ← ai_model_config row for this capability
```

**Settings win over the environment** — that is what makes the Settings → API keys panel authoritative rather than cosmetic. If *nothing* is configured for any provider, the gateway throws `AiGatewayError` with a "No AI provider is configured" message.

Secrets are stored AES-256-GCM encrypted (see [AUTHENTICATION.md](AUTHENTICATION.md#credential--secret-handling)); the gateway decrypts them server-side only.

---

## How a model id picks its provider

A routing row carries **no provider column** — the model id itself names the provider. The whole rule lives in one pure module, **`src/modules/settings/domain/modelRouting.ts`**, because the Settings console, the catalogue writers and the gateway all have to agree on it:

1. **Explicit prefix** (`ROUTING_PREFIXES`): `opencode:…`, `qoder:…`, `cloudflare:…`, `nvidia:…` → that provider (prefix stripped before the call).
2. **Namespaced id** (contains a `/`, e.g. `google/gemma-4-31b-it:free`) → **OpenRouter**.
3. **Bare id** (e.g. `gemini-3.5-flash`) → **Google AI Studio**.

The same module holds `ROUTING_FALLBACK` — the row the gateway answers with when `ai_model_config` has no row for a capability — so a routing card that has nothing saved shows what actually runs instead of a blank.

---

## The failover chain

For a call, the ordered list of models to try is:

```
modelOverride (if the caller forced one model — tried alone, nothing else)
  └─ else:
     routing.primaryModel, routing.fallbackModel   (from ai_model_config, if enabled)
     …modelChains[capability]                       (compiled-in defaults)
```

…deduped, then **walked in that order**, each id sent to whichever provider publishes it. Walking in routing order (not "all OpenRouter first") is deliberate: a Google model set as primary must be able to answer before an OpenRouter fallback, or a console choice would never take effect.

### Compiled-in chains (`modelChains` in `config.ts`)

Defaults, overridable per capability in the DB:

| Env default | Value |
|-------------|-------|
| `AI_MODEL_PRIMARY` | `google/gemma-4-31b-it:free` |
| `AI_MODEL_FAST` | `nvidia/nemotron-3.5-lightning:free` |
| `AI_MODEL_REASONING` | `google/gemma-4-31b-it:free` |
| `AI_MODEL_FALLBACK` | `google/gemma-4-26b-a4b-it:free` |

| Capability | Chain |
|------------|-------|
| `resume_screening` | PRIMARY → FALLBACK → FAST |
| `soft_skills` | FAST → PRIMARY → FALLBACK |
| `case_reasoning` | REASONING → FALLBACK → PRIMARY |
| `feedback` | PRIMARY → FALLBACK |
| `interview_questions` | FAST → PRIMARY |
| `transcription` | PRIMARY → FALLBACK — **not what the audio path walks**; see [Transcription](#transcription) |
| `assistant` / `chatbot` / `translation` | `gemini-3-flash-preview` → `gemini-3.1-flash-lite` → PRIMARY → FALLBACK |

The two chat chains start on Google's own endpoint because the free OpenRouter ids they would otherwise inherit are the first to rate-limit, and the assistant must hold a JSON tool protocol across turns.

> The **seeded `ai_model_config`** rows set `qoder:qfmodel` as primary with a `google/gemma-…:free` fallback for most capabilities — so on a fresh database the routing table (Settings) is what actually answers, and the compiled chains are the safety net beneath it.

### Google-specific resilience

Google is reached through `GOOGLE_MODEL_CHAIN` (`gemini-3.8-flash → 3.7 → 3.6 → 3.5`), newest first. Retired or momentarily-overloaded ids (statuses `404/429/500/502/503/504`) are **walked**, not fatal — Google's per-model load flaps in practice.

---

## Transcription

`transcribeRecording(bytes, mimeType)` sends audio/video **inline** to Google's Gemini endpoint. The enabled transcription row's native Gemini picks lead, followed by the deduplicated `GOOGLE_MODEL_CHAIN`. Other picks are skipped: existing rows may contain Qoder/OpenRouter models, but saving new incompatible picks is refused. This family check is not a live guarantee that a particular model or account supports audio.

Audio uses temperature **0** and a **2,000-token** output limit; the routing row's sampling fields affect its text probe, not audio. Settings **Test** sends text through `complete()` and explicitly does **not** verify a recording. Disabling saved models skips those picks, not transcription itself.

Anything above `MAX_INLINE_MEDIA_BYTES` (**14 MB**) throws `RecordingNotTranscribableError` so a human reviews it instead of the request silently failing on payload size.

---

## Result shape

```ts
CompletionResult {
  content: string;
  model: string;          // the id that actually answered
  provider: GatewayProvider;
  attempts: { model; ok; error?; credential? }[];  // full failover trail
  truncated: boolean;     // provider hit its output cap mid-answer
}
```

`attempts` records every hop (model + which credential hint), so a screening page can show *why* a call degraded, and `truncated` flags an answer cut off at `max_tokens`.

---

## Model catalogues & cost tiers

- **`provider_models`** holds each provider's live catalogue (pricing per million tokens, `context_length`, `is_free`, `capabilities[]`, `enabled`).
- **`FALLBACK_MODELS`** (7 OpenRouter ids) is the static list shown when a live catalogue fetch is unreachable.
- **`getCostTier(promptPrice, isFree)`** classifies models: `free` → `low` (<0.5) → `medium` (<2) → `high` (<10) → `premium` (≥10), plus `unpriced` when a provider publishes no price (calling that "free" would be a claim the code can't support).
- `routable: false` marks a provider whose credentials the portal stores but the gateway cannot call — the UI must never present those models as selectable.

---

## Configuring routing (Settings → AI models)

An admin with `settings.manage_platform` edits `ai_model_config` per capability (`primary_model`, `fallback_model`, `temperature`, `max_tokens`, `is_enabled`) via `settings/application/credential-actions-ai.ts`. Writes are audited. Disabling routing for a capability makes the gateway fall back to the compiled chains above.

---

## Adding a provider (sketch)

1. Register a `ProviderDefinition` (id, group, `envVar`, `fields`, optional `verify`) — via `providerRegistry.register` or by adding to `PROVIDERS`.
2. Add a `call<Provider>()` in `aiGateway.ts` and a `ROUTING_PREFIXES` entry so its model ids resolve to it.
3. Extend the `GatewayProvider` union and add a branch in `complete()`.
4. Add its env var to `config.server.ts` and `.env.example`.
