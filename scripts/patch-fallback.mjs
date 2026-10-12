import { readFileSync, writeFileSync } from "fs";

const file = "src/modules/settings/domain/providers.ts";
const content = readFileSync(file, "utf8");

const oldBlock = "] as const;\n\n/* -------------------------------------------------------------------------- */\n/* Provider model catalogue (synced from provider_models table)               */\n/* -------------------------------------------------------------------------- */\n\nexport interface ProviderModel";

const newBlock = "] as const;\n\n/**\n * Offline fallback so the model picker is never empty, even when the gateway\n * is unreachable. These ids are stable on OpenRouter.\n */\nexport const FALLBACK_MODELS: readonly ModelOption[] = [\n  { id: \"google/gemma-4-31b-it:free\", name: \"Gemma 4 31B (free)\", promptPrice: 0, completionPrice: 0, contextLength: 32_768, free: true },\n  { id: \"google/gemma-4-26b-a4b-it:free\", name: \"Gemma 4 26B A4B (free)\", promptPrice: 0, completionPrice: 0, contextLength: 32_768, free: true },\n  { id: \"nvidia/nemotron-3.5-lightning:free\", name: \"Nemotron 3.5 Lightning (free)\", promptPrice: 0, completionPrice: 0, contextLength: 32_768, free: true },\n  { id: \"deepseek/deepseek-r1:free\", name: \"DeepSeek R1 (free)\", promptPrice: 0, completionPrice: 0, contextLength: 65_536, free: true },\n  { id: \"openrouter/free\", name: \"OpenRouter auto (free)\", promptPrice: 0, completionPrice: 0, contextLength: 32_768, free: true },\n  { id: \"anthropic/claude-3.5-sonnet\", name: \"Claude 3.5 Sonnet\", promptPrice: 3, completionPrice: 15, contextLength: 200_000, free: false },\n  { id: \"openai/gpt-4o-mini\", name: \"GPT-4o mini\", promptPrice: 0.15, completionPrice: 0.6, contextLength: 128_000, free: false },\n  { id: \"meta-llama/llama-3.3-70b-instruct\", name: \"Llama 3.3 70B\", promptPrice: 0.12, completionPrice: 0.3, contextLength: 131_072, free: false },\n] as const;\n\n/* -------------------------------------------------------------------------- */\n/* Provider model catalogue (synced from provider_models table)               */\n/* -------------------------------------------------------------------------- */\n\nexport interface ProviderModel";

if (content.includes(oldBlock)) {
  const newContent = content.replace(oldBlock, newBlock);
  writeFileSync("src/modules/settings/domain/providers.ts", newContent, "utf8");
  console.log("Patched successfully");
} else {
  console.log("Block not found");
  const idx = content.indexOf("] as const;");
  console.log("Found at index:", idx);
  if (idx >= 0) {
    console.log("Context:", content.substring(idx, idx + 200));
  }
}